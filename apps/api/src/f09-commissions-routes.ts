import type { FastifyInstance } from 'fastify';
import { withTenant, withUser, type Pool, type PoolClient } from '@dealpilot/db';
import { buildClawbackLine, calculateCommission, type CommissionPlan, type Overrider } from '@dealpilot/core';
import {
  ActivityListQuery,
  ClawbackListQuery,
  CommissionListQuery,
  CreatePayPlanInput,
  FlagClawbackInput,
  PayPlanListQuery,
  UpdatePayPlanInput,
} from '@dealpilot/schemas';
import { AppError, forbidden, notFound, parseOrThrow } from './errors.js';
import { conflictFrom, idParam, keysetPage, requireMember, sessionUser } from './f01-routes.js';
import { diff, recordEvent } from './activity.js';
import { notify } from './notifications.js';
import { hasPermission, requirePermission } from './permissions.js';

/**
 * F-09 pay plans + commissions (commissions-clawbacks.md §11).
 *
 * The MATH is not here: `calculateCommission` in @dealpilot/core is the single
 * tested implementation (A-06 golden tests cover pad-before-rate, the tier
 * threshold, and paying every overrider). This module supplies its inputs and
 * writes the result.
 *
 * WHO SEES PAY: money is personal. Reading someone else's plan or commission
 * needs `commission:read_all`; anyone reads their own. That privacy is
 * ROUTE-enforced (the user_id clamp below) — migration 0013 dropped 0011's
 * self-read policies because bare user-keyed policies OR across organizations.
 * Writing a plan needs `pay_plan:write`.
 *
 * TRIGGER: lines are written when a deal's `funded_at` is first set — the
 * commission belongs to the month the money arrived, never to the stage. The
 * unique (deal_id, user_id, kind) index makes re-running it a no-op, so a
 * retried or double-clicked funding can never double-pay. A confirmed clawback
 * (F-79) writes exactly one negative `kind='clawback'` line dated into the
 * OPEN period — the same unique index makes a duplicate reversal an error,
 * never a second line.
 */


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
        await requirePermission(c, user.id, 'pay_plan:write');
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
           RETURNING *, (xmax = 0) AS _inserted`,
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
        // xmax = 0 means this INSERT actually inserted; anything else means the
        // ON CONFLICT branch rewrote an existing plan. Calling both "updated"
        // would make a new hire's first plan indistinguishable from a pay cut.
        const wasInsert = String(r.rows[0]!['_inserted']) === 'true';
        await recordEvent(c, {
          organizationId: input.organization_id,
          storeId: input.store_id ?? null,
          actorUserId: user.id,
          entityType: 'pay_plan',
          entityId: String(r.rows[0]!['id']),
          action: wasInsert ? 'created' : 'updated',
          changes: {
            user_id: { from: null, to: input.user_id },
            commission_rate: { from: null, to: input.commission_rate },
            pad_cents: { from: null, to: input.pad_cents },
          },
        });
        const { _inserted, ...plan } = r.rows[0]!;
        void _inserted;
        return plan;
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
      await requireMember(c, user.id);
      const canSeeEveryone = await hasPermission(c, user.id, 'commission:read_all');
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
      await requirePermission(c, user.id, 'pay_plan:write');
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
      await requirePermission(c, user.id, 'activity:read');
      const canSeePay = await hasPermission(c, user.id, 'pay_plan:read');
      const params: unknown[] = [orgId];
      // F-69 §12: a restricted (suspended-investigation) platform event is
      // never shown to the tenant; only the platform's own reader sees it.
      let where = 'organization_id = $1 AND NOT restricted';
      // Pay-plan history spells out commission rates from/to. The commissions
      // route restricts those to PAY_READ_ROLES because pay is personal; an
      // audit feed that hands the same numbers to the whole floor would be a
      // way around that door rather than a window onto it.
      if (!canSeePay) where += ` AND entity_type <> 'pay_plan'`;
      // Filtering by an entity returns what happened TO it and what happened
      // UNDER it — a deal's timeline includes its checklist acts without the
      // caller having to know checklist items exist (CR-04).
      if (query.entity_id) {
        params.push(query.entity_id);
        where += ` AND (entity_id = $${params.length} OR parent_entity_id = $${params.length})`;
      }
      for (const [col, val] of [
        ['entity_type', query.entity_type],
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
        // A forged or foreign cursor (every other endpoint's is base64 JSON)
        // decodes to NaN, which Postgres rejects as a bigint — a 500 for what
        // is a client mistake. Same contract as decodeCursor: 400, never 500.
        const decoded = Number(Buffer.from(query.cursor, 'base64url').toString('utf8'));
        if (!Number.isSafeInteger(decoded) || decoded < 0) {
          throw new AppError(400, 'invalid_cursor', 'That page cursor is not valid');
        }
        params.push(decoded);
        where += ` AND seq < $${params.length}`;
      }
      params.push(query.limit + 1);
      const r = await c.query<Record<string, unknown>>(
        `SELECT id, organization_id, store_id, actor_user_id, entity_type, entity_id,
                action, changes, reason, parent_entity_type, parent_entity_id, created_at, seq,
                actor_type, restricted, impersonation_id
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
      await requireMember(c, user.id);
      const canSeeEveryone = await hasPermission(c, user.id, 'commission:read_all');
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

  /**
   * F-79 flag (commissions-clawbacks.md §8, §11.4): mark a paid line for
   * reversal. Writes NO money — the negative line is written only by the human
   * confirm below, derived from the STORED clawback row, never from a client.
   */
  app.post('/api/v1/commission-clawbacks', async (request, reply) => {
    const input = parseOrThrow(FlagClawbackInput, request.body);
    const user = sessionUser(request);
    try {
      const cc = await withTenant(pool, input.organization_id, async (c) => {
        await requirePermission(c, user.id, 'commission:clawback');
        const cm = await c.query<Record<string, unknown>>(
          `SELECT * FROM commissions WHERE id = $1`,
          [input.commission_id],
        );
        // RLS makes a rival's commission invisible — the cross-tenant case IS
        // this line, driven as the APP role (rls-coverage's behavioural case).
        if (cm.rows.length === 0) throw notFound();
        const commission = cm.rows[0]!;
        if (commission['kind'] === 'clawback') {
          throw new AppError(422, 'validation_failed', 'A clawback line cannot be clawed back', [
            { path: 'commission_id', code: 'not_clawbackable', message: 'This line is itself a reversal' },
          ]);
        }
        const amountCents = commission['amount_cents'] as number;
        if (amountCents <= 0) {
          // REACHABLE, not decorative: a loss deal writes a $0 kind='sale'
          // line (the funding INSERT is unconditional; the engine floors at 0).
          throw new AppError(422, 'validation_failed', 'There is nothing to recover on this line', [
            { path: 'commission_id', code: 'nothing_to_recover', message: 'The line paid nothing' },
          ]);
        }
        if (input.reversed_amount_cents > amountCents) {
          throw new AppError(422, 'validation_failed', 'Cannot reverse more than the line paid', [
            { path: 'reversed_amount_cents', code: 'over_amount', message: `At most ${amountCents}` },
          ]);
        }
        // Terminal check (D-080 a). FOR UPDATE with NO status predicate locks
        // EVERY existing clawback row for this commission, so a flag racing a
        // confirm blocks on the confirm's row lock and re-reads 'reversed'
        // here once it commits — no zombie flag on a reversed commission. A
        // 'flagged' row deliberately falls THROUGH to the INSERT: the partial
        // unique index stays the ONLY duplicate gate (race-proof 409).
        const existing = await c.query<{ status: string }>(
          `SELECT status FROM commission_clawbacks WHERE commission_id = $1 FOR UPDATE`,
          [input.commission_id],
        );
        if (existing.rows.some((r) => r.status === 'reversed')) {
          throw new AppError(422, 'clawback_terminal', 'This commission has already been reversed — one clawback per line');
        }
        const r = await c.query<Record<string, unknown>>(
          `INSERT INTO commission_clawbacks
             (organization_id, deal_id, commission_id, reason, original_amount_cents, reversed_amount_cents, flagged_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [
            input.organization_id, commission['deal_id'], input.commission_id,
            input.reason, amountCents, input.reversed_amount_cents, user.id,
          ],
        );
        const row = r.rows[0]!;
        const deal = await c.query<{ store_id: string | null }>(
          `SELECT store_id FROM deals WHERE id = $1`,
          [commission['deal_id'] as string],
        );
        // STATUS ONLY in changes — activity:read is floor-wide and the f10 pay
        // filter is deliberately not extended; the reason rides its own field.
        await recordEvent(c, {
          organizationId: input.organization_id,
          storeId: deal.rows[0]?.store_id ?? null,
          actorUserId: user.id,
          entityType: 'commission_clawback',
          entityId: String(row['id']),
          action: 'created',
          reason: input.reason,
          changes: { status: { from: null, to: 'flagged' } },
          parentEntityType: 'deal',
          parentEntityId: commission['deal_id'] as string,
        });
        return row;
      });
      return await reply.status(201).send(cc);
    } catch (err) {
      throw conflictFrom(err) ?? err;
    }
  });

  /**
   * F-79 confirm — the human confirmation that writes the money. ONE
   * withTenant transaction: the negative line, the status flip, the event and
   * the bells commit together or roll back together.
   */
  app.post('/api/v1/commission-clawbacks/:id/confirm', async (request, reply) => {
    const ccId = idParam(request);
    const user = sessionUser(request);
    const orgId = await clawbackOrg(pool, user.id, ccId);
    const out = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'commission:clawback');
      // The lock is on the CLAWBACK row only — commissions are immutable and
      // the live UNIQUE is the cross-path backstop. Two racing confirms
      // serialize here; the second reads 'reversed' below and 422s (never a
      // silent 200 — a double-click must learn it did not write twice).
      const r = await c.query<Record<string, unknown>>(
        `SELECT * FROM commission_clawbacks WHERE id = $1 FOR UPDATE`,
        [ccId],
      );
      if (r.rows.length === 0) throw notFound();
      const cc = r.rows[0]!;
      if (cc['status'] !== 'flagged') {
        throw new AppError(422, 'already_reversed', 'This clawback is already confirmed');
      }
      const cm = await c.query<Record<string, unknown>>(
        `SELECT * FROM commissions WHERE id = $1`,
        [cc['commission_id'] as string],
      );
      const commission = cm.rows[0]!; // exists by the NOT NULL FK
      const deal = await c.query<{ store_id: string | null }>(
        `SELECT store_id FROM deals WHERE id = $1`,
        [cc['deal_id'] as string],
      );
      const storeId = deal.rows[0]?.store_id ?? null;
      // ONE stamp for BOTH confirmed_at and the negative line's funded_at
      // (the f05 stamping precedent; pinned byte-equal by T-A4).
      const confirmedAt = new Date().toISOString();
      const line = buildClawbackLine(
        {
          totalGrossCents: commission['total_gross_cents'] as number,
          grossForCommissionCents: commission['gross_for_commission_cents'] as number,
          // numeric(5,4) arrives as a string — num() is the typed boundary.
          appliedRate: num(commission['applied_rate'] as string),
          amountCents: commission['amount_cents'] as number,
        },
        cc['reversed_amount_cents'] as number,
        confirmedAt,
      );
      try {
        // Plain INSERT — ON CONFLICT DO NOTHING is BANNED here: a flipped
        // status with no line is the recorded no-op-feature class.
        await c.query(
          `INSERT INTO commissions (organization_id, deal_id, user_id, kind, total_gross_cents,
                                    gross_for_commission_cents, applied_rate, amount_cents, funded_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            orgId, cc['deal_id'], commission['user_id'], line.kind,
            line.total_gross_cents, line.gross_for_commission_cents, line.applied_rate,
            line.amount_cents, line.funded_at,
          ],
        );
      } catch (err) {
        const e = err as { code?: string; constraint?: string };
        // The commissions UNIQUE (deal_id, user_id, kind) 23505 IS reachable,
        // in exactly ONE configuration: the same-person sale+override edge —
        // two commission lines, ONE (deal, user, 'clawback') slot — whether
        // the two flags are confirmed sequentially (T-A5b) or as a
        // sibling-commission race (this confirm losing the race to the
        // sibling flag's confirm). A same-commission fresh flag cannot race
        // this confirm: the flag route's FOR-UPDATE terminal check closes
        // that path (its 'no zombie flag on a reversed commission' comment
        // above). Mapped to 422 clawback_cap_reached — truthful: THIS
        // commission was not reversed, its sibling holds the slot — and
        // thrown so the WHOLE transaction rolls back: the status never
        // flips lineless.
        if (e.code === '23505' && e.constraint === 'commissions_deal_id_user_id_kind_key') {
          throw new AppError(422, 'clawback_cap_reached', 'The clawback line for this deal and person already exists');
        }
        throw err;
      }
      const upd = await c.query<Record<string, unknown>>(
        `UPDATE commission_clawbacks
         SET status = 'reversed', confirmed_by = $2, confirmed_at = $3
         WHERE id = $1 RETURNING *`,
        [ccId, user.id, confirmedAt],
      );
      const earnerId = commission['user_id'] as string;
      // params carry ONE locale-free number (bell.tsx's law: every producer's
      // params are locale-free); each recipient's own locale renders it via
      // the ICU ::currency/CAD argument in the key.
      const params = { amount: (cc['reversed_amount_cents'] as number) / 100 };
      const notifyOne = (userId: string, urgency: 'high' | 'medium') =>
        notify(c, {
          organizationId: orgId, userId, urgency,
          titleKey: 'notif_commission_clawback', params,
          link: '/commissions', entityType: 'commission_clawback', entityId: ccId, storeId,
        });
      // The earner is NEVER dropped — the person whose pay moved is told even
      // when they confirmed it themselves. HIGH: their pay moved.
      await notifyOne(earnerId, 'high');
      let managerIds = await storeRoleIds(c, orgId, storeId, 'gm');
      if (managerIds.length === 0) {
        // Owner is the FALLBACK for a no-GM store, never a co-recipient.
        managerIds = await storeRoleIds(c, orgId, storeId, 'owner');
      }
      for (const managerId of managerIds) {
        // The confirming ACTOR is dropped from the MANAGER set (the f40
        // no-self-notify precedent), and the earner already has their bell.
        if (managerId === user.id || managerId === earnerId) continue;
        await notifyOne(managerId, 'medium');
      }
      await recordEvent(c, {
        organizationId: orgId,
        storeId,
        actorUserId: user.id,
        entityType: 'commission_clawback',
        entityId: ccId,
        action: 'updated',
        changes: { status: { from: 'flagged', to: 'reversed' } },
        parentEntityType: 'deal',
        parentEntityId: cc['deal_id'] as string,
      });
      return upd.rows[0]!;
    });
    return reply.send(out);
  });

  /**
   * F-79 list — pay privacy mirrored from the commissions list above: without
   * `commission:read_all` the mandatory FK JOIN clamps to the caller's OWN
   * lines. No user_id filter parameter exists, deliberately: the clamp is the
   * only door.
   */
  app.get('/api/v1/commission-clawbacks', async (request, reply) => {
    const query = parseOrThrow(ClawbackListQuery, request.query);
    const user = sessionUser(request);
    const orgId = await resolveOrg(pool, user.id, query.organization_id);
    const page = await withTenant(pool, orgId, async (c) => {
      await requireMember(c, user.id);
      const canSeeEveryone = await hasPermission(c, user.id, 'commission:read_all');
      const params: unknown[] = [orgId];
      let where = 'cc.organization_id = $1';
      if (!canSeeEveryone) {
        params.push(user.id);
        where += ` AND cm.user_id = $${params.length}`;
      }
      for (const [col, val] of [
        ['cc.deal_id', query.deal_id],
        ['cc.commission_id', query.commission_id],
      ] as const) {
        if (val) {
          params.push(val);
          where += ` AND ${col} = $${params.length}`;
        }
      }
      // keysetPage's sortAlias exists for exactly this JOIN shape (both sides
      // carry created_at/id); the 0072 org index matches the sort.
      return keysetPage(
        c,
        `SELECT cc.* FROM commission_clawbacks cc
         JOIN commissions cm ON cm.id = cc.commission_id
         WHERE ${where}`,
        params, query, 'cc',
      );
    });
    return reply.send(page);
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

/** planOrg's shape against commission_clawbacks (F-79): iterate the caller's
 * orgs under withTenant; a rival's (or unknown) clawback id is a 404. */
async function clawbackOrg(pool: Pool, userId: string, clawbackId: string): Promise<string> {
  const orgs = await withUser(pool, userId, async (c) => {
    const r = await c.query<{ organization_id: string }>(
      `SELECT DISTINCT organization_id FROM memberships WHERE status = 'active'`,
    );
    return r.rows.map((x) => x.organization_id);
  });
  for (const orgId of orgs) {
    const found = await withTenant(pool, orgId, async (c) => {
      const r = await c.query('SELECT 1 FROM commission_clawbacks WHERE id = $1', [clawbackId]);
      return r.rows.length > 0;
    });
    if (found) return orgId;
  }
  throw notFound();
}

/**
 * Active members holding `role` for the deal's store (org-wide membership, or
 * that store's). The role is DATA picking notification recipients here —
 * access itself was already decided by requirePermission above (the task-sweep
 * recipient precedent, split into GM-then-owner-fallback per F-79's scope).
 */
async function storeRoleIds(
  client: PoolClient,
  orgId: string,
  storeId: string | null,
  role: string,
): Promise<string[]> {
  const r = await client.query<{ user_id: string }>(
    `SELECT DISTINCT m.user_id FROM memberships m
     WHERE m.organization_id = $1 AND m.status = 'active'
       AND m.roles && $2::text[]
       AND (m.store_id IS NULL OR $3::uuid IS NULL OR m.store_id = $3::uuid)`,
    [orgId, [role], storeId],
  );
  return r.rows.map((x) => x.user_id);
}

export { forbidden };
