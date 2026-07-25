import type { FastifyInstance } from 'fastify';
import { withTenant, withUser, type Pool, type PoolClient } from '@dealpilot/db';
import { calculateCommission, type CommissionPlan, type Overrider } from '@dealpilot/core';
import {
  ActivityListQuery,
  CommissionListQuery,
  CreatePayPlanInput,
  PayPlanListQuery,
  UpdatePayPlanInput,
} from '@dealpilot/schemas';
import { AppError, forbidden, notFound, parseOrThrow } from './errors.js';
import { conflictFrom, idParam, keysetPage, requireMember, sessionUser } from './f01-routes.js';
import { diff, recordEvent } from './activity.js';

/**
 * F-09 pay plans + commissions (commissions-clawbacks.md §11).
 *
 * The MATH is not here: `calculateCommission` in @dealpilot/core is the single
 * tested implementation (A-06 golden tests cover pad-before-rate, the tier
 * threshold, and paying every overrider). This module supplies its inputs and
 * writes the result.
 *
 * WHO SEES PAY: money is personal. Reading someone else's plan or commission
 * needs `owner`/`gm`/`fi_manager`; anyone can read their own (RLS self-read
 * policies in migration 0011). Writing a plan is owner/gm only.
 *
 * TRIGGER: lines are written when a deal's `funded_at` is first set — the
 * commission belongs to the month the money arrived, never to the stage. The
 * unique (deal_id, user_id, kind) index makes re-running it a no-op, so a
 * retried or double-clicked funding can never double-pay.
 */

const PAY_WRITE_ROLES = ['owner', 'gm'] as const;
const PAY_READ_ROLES = ['owner', 'gm', 'fi_manager'] as const;

interface PayPlanRow {
  user_id: string;
  commission_rate: string;
  has_pad: boolean;
  pad_cents: number;
  has_tiered_rate: boolean;
  tier_threshold_cents: number | null;
  tier_rate: string | null;
  override_on_user_id: string | null;
  override_rate: string | null;
}

/** numeric(5,4) arrives as a string from pg — never trust it as a number. */
const num = (v: string | null): number => (v === null ? 0 : Number(v));

function toEnginePlan(row: PayPlanRow): CommissionPlan {
  return {
    rate: num(row.commission_rate),
    hasPad: row.has_pad,
    padCents: row.pad_cents,
    ...(row.has_tiered_rate
      ? {
          hasTieredRate: true,
          tierThresholdCents: row.tier_threshold_cents ?? 0,
          tierRate: num(row.tier_rate),
        }
      : {}),
  };
}

/**
 * The seller's funded gross for the month the deal funded — the tier input.
 * Half-open [monthStart, nextMonthStart) per §11, computed in SQL so the
 * boundary is the database's, not the API process's clock.
 */
async function fundedMonthlyGross(
  client: PoolClient,
  sellerId: string,
  fundedAt: string,
  excludeDealId: string,
): Promise<number> {
  const r = await client.query<{ gross: string }>(
    `SELECT COALESCE(SUM((sale_price_cents - vehicle_cost_cents) + fi_reserve_cents), 0)::bigint AS gross
     FROM deals
     WHERE salesperson_id = $1
       AND funded_at >= date_trunc('month', $2::timestamptz)
       AND funded_at <  date_trunc('month', $2::timestamptz) + interval '1 month'
       AND id <> $3
       AND deleted_at IS NULL`,
    [sellerId, fundedAt, excludeDealId],
  );
  return Number(r.rows[0]?.gross ?? 0);
}

/**
 * Write the commission lines for a freshly funded deal. Call inside the SAME
 * tenant transaction that set `funded_at`, so pay and funding commit together.
 */
export async function writeCommissionsForFundedDeal(
  client: PoolClient,
  deal: {
    id: string;
    organization_id: string;
    salesperson_id: string | null;
    sale_price_cents: number;
    vehicle_cost_cents: number;
    fi_reserve_cents: number;
    funded_at: string;
  },
): Promise<void> {
  if (!deal.salesperson_id) return; // nobody credited yet — nothing to pay

  const plan = await client.query<PayPlanRow>(
    `SELECT * FROM pay_plans WHERE user_id = $1 AND active ORDER BY store_id NULLS LAST LIMIT 1`,
    [deal.salesperson_id],
  );
  if (plan.rows.length === 0) return; // no plan on file: pay is computed when one exists

  const overriderRows = await client.query<PayPlanRow>(
    `SELECT * FROM pay_plans WHERE override_on_user_id = $1 AND active`,
    [deal.salesperson_id],
  );
  const overriders: Overrider[] = overriderRows.rows.map((o) => ({
    salespersonId: o.user_id,
    overrideRate: num(o.override_rate),
  }));

  const result = calculateCommission({
    salePriceCents: deal.sale_price_cents,
    vehicleCostCents: deal.vehicle_cost_cents,
    fiReserveCents: deal.fi_reserve_cents,
    plan: toEnginePlan(plan.rows[0]!),
    fundedMonthlyGrossCents: await fundedMonthlyGross(
      client,
      deal.salesperson_id,
      deal.funded_at,
      deal.id,
    ),
    overriders,
  });

  const lines: [string, string, number, number][] = [
    [deal.salesperson_id, 'sale', result.commissionCents, result.appliedRate],
    ...result.overrides.map(
      (o) =>
        [o.salespersonId, 'override', o.amountCents, num(
          overriderRows.rows.find((r) => r.user_id === o.salespersonId)?.override_rate ?? null,
        )] as [string, string, number, number],
    ),
  ];

  for (const [userId, kind, amount, appliedRate] of lines) {
    // ON CONFLICT DO NOTHING: the unique (deal_id, user_id, kind) index makes
    // this idempotent, so a retried funding never pays twice.
    await client.query(
      `INSERT INTO commissions (organization_id, deal_id, user_id, kind, total_gross_cents,
                                gross_for_commission_cents, applied_rate, amount_cents, funded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (deal_id, user_id, kind) DO NOTHING`,
      [
        deal.organization_id, deal.id, userId, kind,
        result.totalGrossCents, result.grossForCommissionCents, appliedRate, amount, deal.funded_at,
      ],
    );
  }
}

export function registerF09Routes(app: FastifyInstance, pool: Pool): void {
  app.post('/api/v1/pay-plans', async (request, reply) => {
    const input = parseOrThrow(CreatePayPlanInput, request.body);
    const user = sessionUser(request);
    try {
      const plan = await withTenant(pool, input.organization_id, async (c) => {
        await requireMember(c, user.id, PAY_WRITE_ROLES);
        await requireOrgMember(c, input.user_id, 'user_id');
        if (input.override_on_user_id) await requireOrgMember(c, input.override_on_user_id, 'override_on_user_id');
        // One plan per person per store: re-posting updates it, which is how a
        // rate change is recorded without hunting for the row id.
        const r = await c.query<Record<string, unknown>>(
          `INSERT INTO pay_plans (organization_id, user_id, store_id, commission_rate, has_pad, pad_cents,
                                  has_tiered_rate, tier_threshold_cents, tier_rate, override_on_user_id, override_rate)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (organization_id, user_id, store_id) DO UPDATE SET
             commission_rate = EXCLUDED.commission_rate, has_pad = EXCLUDED.has_pad,
             pad_cents = EXCLUDED.pad_cents, has_tiered_rate = EXCLUDED.has_tiered_rate,
             tier_threshold_cents = EXCLUDED.tier_threshold_cents, tier_rate = EXCLUDED.tier_rate,
             override_on_user_id = EXCLUDED.override_on_user_id, override_rate = EXCLUDED.override_rate,
             active = true
           RETURNING *`,
          [
            input.organization_id, input.user_id, input.store_id ?? null, input.commission_rate,
            input.has_pad, input.pad_cents, input.has_tiered_rate,
            input.tier_threshold_cents ?? null, input.tier_rate ?? null,
            input.override_on_user_id ?? null, input.override_rate ?? null,
          ],
        );
        // This is an UPSERT: re-posting quietly rewrites what a person is paid.
        // The row keeps only the new rate, so without this the change leaves no
        // trace at all.
        await recordEvent(c, {
          organizationId: input.organization_id,
          storeId: input.store_id ?? null,
          actorUserId: user.id,
          entityType: 'pay_plan',
          entityId: String(r.rows[0]!['id']),
          action: 'updated',
          changes: {
            user_id: input.user_id,
            commission_rate: input.commission_rate,
            pad_cents: input.pad_cents,
          },
        });
        return r.rows[0]!;
      });
      return await reply.status(201).send(numericToNumbers(plan));
    } catch (err) {
      throw conflictFrom(err) ?? err;
    }
  });

  app.get('/api/v1/pay-plans', async (request, reply) => {
    const query = parseOrThrow(PayPlanListQuery, request.query);
    const user = sessionUser(request);
    const orgId = await resolveOrg(pool, user.id, query.organization_id);
    const page = await withTenant(pool, orgId, async (c) => {
      const roles = await requireMember(c, user.id);
      const canSeeEveryone = roles.some((r) => PAY_READ_ROLES.includes(r as (typeof PAY_READ_ROLES)[number]));
      const params: unknown[] = [orgId];
      let where = 'organization_id = $1 AND active';
      // Pay is personal: without a manager role you see only your own plan.
      const target = canSeeEveryone ? query.user_id : user.id;
      if (target) {
        params.push(target);
        where += ` AND user_id = $${params.length}`;
      }
      return keysetPage(c, `SELECT * FROM pay_plans WHERE ${where}`, params, query);
    });
    return reply.send({ ...page, items: page.items.map((p) => numericToNumbers(p as Record<string, unknown>)) });
  });

  app.patch('/api/v1/pay-plans/:id', async (request, reply) => {
    const planId = idParam(request);
    const input = parseOrThrow(UpdatePayPlanInput, request.body);
    const user = sessionUser(request);
    const orgId = await planOrg(pool, user.id, planId);
    const plan = await withTenant(pool, orgId, async (c) => {
      await requireMember(c, user.id, PAY_WRITE_ROLES);
      const beforeRow = await c.query<Record<string, unknown>>(`SELECT * FROM pay_plans WHERE id = $1`, [planId]);
      if (beforeRow.rows.length === 0) throw notFound();
      const prior = beforeRow.rows[0]!;

      const fields = Object.entries(input);
      if (fields.length === 0) return prior;
      const sets = fields.map(([k], i) => `${k} = $${i + 2}`).join(', ');
      const r = await c.query<Record<string, unknown>>(
        `UPDATE pay_plans SET ${sets} WHERE id = $1 RETURNING *`,
        [planId, ...fields.map(([, v]) => v)],
      );
      if (r.rows.length === 0) throw notFound();
      // numeric arrives from pg as a string ("0.2500"); diff() normalizes so a
      // rate that did not move is not reported as though it did.
      const changed = diff(prior, input as Record<string, unknown>, Object.keys(input));
      if (Object.keys(changed).length > 0) {
        await recordEvent(c, {
          organizationId: orgId,
          actorUserId: user.id,
          entityType: 'pay_plan',
          entityId: planId,
          action: 'updated',
          changes: changed,
        });
      }
      return r.rows[0]!;
    });
    return reply.send(numericToNumbers(plan));
  });

  /**
   * F-10: one entity's history, or the organization's recent activity.
   * Tenant-scoped like everything else; any active member may read it, because
   * an audit trail only visible to the people who could tamper with it is not
   * an audit trail.
   */
  app.get('/api/v1/activity', async (request, reply) => {
    const query = parseOrThrow(ActivityListQuery, request.query);
    const user = sessionUser(request);
    const orgId = await resolveOrg(pool, user.id, query.organization_id);
    const page = await withTenant(pool, orgId, async (c) => {
      const roles = await requireMember(c, user.id);
      const canSeePay = roles.some((r) => PAY_READ_ROLES.includes(r as (typeof PAY_READ_ROLES)[number]));
      const params: unknown[] = [orgId];
      let where = 'organization_id = $1';
      // Pay-plan history spells out commission rates from/to. The commissions
      // route restricts those to PAY_READ_ROLES because pay is personal; an
      // audit feed that hands the same numbers to the whole floor would be a
      // way around that door rather than a window onto it.
      if (!canSeePay) where += ` AND entity_type <> 'pay_plan'`;
      for (const [col, val] of [
        ['entity_type', query.entity_type],
        ['entity_id', query.entity_id],
        ['actor_user_id', query.actor_user_id],
      ] as const) {
        if (val) {
          params.push(val);
          where += ` AND ${col} = $${params.length}`;
        }
      }
      // A dedicated keyset on `seq` rather than the shared created_at+id one:
      // every event from a single request shares created_at to the microsecond
      // (now() is transaction-start), so a uuid tiebreak would order a stage
      // change and the funding change beside it at random. `seq` is monotonic
      // and unique, which makes it both the causal order and a sufficient
      // cursor on its own.
      if (query.cursor) {
        params.push(Number(Buffer.from(query.cursor, 'base64url').toString('utf8')));
        where += ` AND seq < $${params.length}`;
      }
      params.push(query.limit + 1);
      const r = await c.query<Record<string, unknown>>(
        `SELECT id, organization_id, store_id, actor_user_id, entity_type, entity_id,
                action, changes, reason, created_at, seq
         FROM activity_events WHERE ${where} ORDER BY seq DESC LIMIT $${params.length}`,
        params,
      );
      const hasMore = r.rows.length > query.limit;
      const rows = hasMore ? r.rows.slice(0, query.limit) : r.rows;
      const last = rows[rows.length - 1];
      return {
        items: rows.map((row) => {
          const item = { ...row };
          delete item['seq'];
          return item;
        }),
        next_cursor:
          hasMore && last
            ? Buffer.from(String(last['seq']), 'utf8').toString('base64url')
            : null,
      };
    });
    return reply.send(page);
  });

  app.get('/api/v1/commissions', async (request, reply) => {
    const query = parseOrThrow(CommissionListQuery, request.query);
    const user = sessionUser(request);
    const orgId = await resolveOrg(pool, user.id, query.organization_id);
    const page = await withTenant(pool, orgId, async (c) => {
      const roles = await requireMember(c, user.id);
      const canSeeEveryone = roles.some((r) => PAY_READ_ROLES.includes(r as (typeof PAY_READ_ROLES)[number]));
      const params: unknown[] = [orgId];
      let where = 'organization_id = $1';
      const target = canSeeEveryone ? query.user_id : user.id;
      if (target) {
        params.push(target);
        where += ` AND user_id = $${params.length}`;
      }
      if (query.deal_id) {
        params.push(query.deal_id);
        where += ` AND deal_id = $${params.length}`;
      }
      return keysetPage(c, `SELECT * FROM commissions WHERE ${where}`, params, query);
    });
    return reply.send({ ...page, items: page.items.map((c) => numericToNumbers(c as Record<string, unknown>)) });
  });
}

/** pg returns numeric as a string; the contract promises numbers. */
function numericToNumbers(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  for (const key of ['commission_rate', 'tier_rate', 'override_rate', 'applied_rate']) {
    if (typeof out[key] === 'string') out[key] = Number(out[key]);
  }
  return out;
}

async function requireOrgMember(client: PoolClient, userId: string, path: string): Promise<void> {
  const r = await client.query(
    `SELECT 1 FROM memberships WHERE user_id = $1 AND status = 'active' LIMIT 1`,
    [userId],
  );
  if (r.rows.length === 0) {
    throw new AppError(422, 'validation_failed', 'That person is not a member of this organization', [
      { path, code: 'invalid_reference', message: 'Not an active member' },
    ]);
  }
}

async function resolveOrg(pool: Pool, userId: string, selector?: string): Promise<string> {
  if (selector) return selector;
  const orgs = await withUser(pool, userId, async (c) => {
    const r = await c.query<{ organization_id: string }>(
      `SELECT DISTINCT m.organization_id FROM memberships m
       JOIN organizations o ON o.id = m.organization_id AND o.deleted_at IS NULL
       WHERE m.status = 'active'`,
    );
    return r.rows.map((x) => x.organization_id);
  });
  if (orgs.length === 0) throw notFound();
  if (orgs.length > 1) {
    throw new AppError(400, 'organization_required', 'Pass organization_id — you belong to several organizations');
  }
  return orgs[0]!;
}

async function planOrg(pool: Pool, userId: string, planId: string): Promise<string> {
  const orgs = await withUser(pool, userId, async (c) => {
    const r = await c.query<{ organization_id: string }>(
      `SELECT DISTINCT organization_id FROM memberships WHERE status = 'active'`,
    );
    return r.rows.map((x) => x.organization_id);
  });
  for (const orgId of orgs) {
    const found = await withTenant(pool, orgId, async (c) => {
      const r = await c.query('SELECT 1 FROM pay_plans WHERE id = $1', [planId]);
      return r.rows.length > 0;
    });
    if (found) return orgId;
  }
  throw notFound();
}

export { forbidden };
