import type { FastifyInstance } from 'fastify';
import { withTenant, withUser, type Pool, type PoolClient } from '@dealpilot/db';
import { computeDeal, type DeskingInput } from '@dealpilot/core';
import {
  CalculateDealInput,
  CreateDealInput,
  DealListQuery,
  UpdateDealInput,
  type DeskingInputsT,
  type DeskingOutputsT,
} from '@dealpilot/schemas';
import { AppError, notFound, parseOrThrow } from './errors.js';
import { conflictFrom, idParam, keysetPage, requireMember, sessionUser } from './f01-routes.js';
import { writeCommissionsForFundedDeal } from './f09-commissions-routes.js';

/**
 * F-05 desking (apiV1.deals) — the A-06 money engine behind the API.
 * `POST /deals/calculate` is a pure preview (nothing stored) so the worksheet
 * can recompute on every keystroke; create/update PERSIST the engine's answer
 * alongside the inputs, because a saved deal must reproduce exactly what the
 * customer was shown. Outputs are engine-owned: the schemas never accept them.
 *
 * Same tenancy model as F-02/F-04: reads under withUser, writes under
 * withTenant behind the membership gate. Any active member may desk a deal
 * (that is the sales floor's job); status moves are free within the vocabulary
 * until the approval workflow slice lands.
 */

/** Wire shape (cents + basis points) → the engine's input shape. */
function toEngineInput(i: DeskingInputsT): DeskingInput {
  return {
    salePriceCents: i.sale_price_cents,
    ...(i.msrp_cents === undefined ? {} : { msrpCents: i.msrp_cents }),
    vehicleCostCents: i.vehicle_cost_cents,
    provinceCode: i.province,
    dealType: i.deal_type,
    interestRatePct: i.interest_rate_bps / 100,
    termMonths: i.term_months,
    // HO-05: a lease is priced from a money factor, a lease term and a
    // residual — not from the finance fields. Without this mapping the engine
    // silently used its defaults, so a saved lease stored a rate and term that
    // had nothing to do with its payment. MF = APR / 2400 (industry standard).
    moneyFactor: i.interest_rate_bps / 100 / 2400,
    leaseTermMonths: i.term_months,
    residualPercent: i.residual_percent,
    cashDownCents: i.cash_down_cents,
    taxExempt: i.tax_exempt,
    ...(i.trade_allowance_cents || i.trade_acv_cents || i.trade_lien_cents
      ? {
          trades: [
            {
              allowanceCents: i.trade_allowance_cents,
              acvCents: i.trade_acv_cents,
              lienCents: i.trade_lien_cents,
            },
          ],
        }
      : {}),
    ...(i.rebate_cents ? { rebatesCents: [i.rebate_cents] } : {}),
    ...(i.fees_cents ? { fees: [{ amountCents: i.fees_cents, taxable: i.fees_taxable }] } : {}),
    ...(i.fi_price_cents || i.fi_cost_cents
      ? { fiProducts: [{ priceCents: i.fi_price_cents, costCents: i.fi_cost_cents, taxable: true }] }
      : {}),
  };
}

function computeOutputs(i: DeskingInputsT): DeskingOutputsT {
  const d = computeDeal(toEngineInput(i));
  const monthly = i.deal_type === 'lease' ? d.leaseMonthlyCents : d.financeMonthlyCents;
  return {
    gst_cents: d.taxes.gst_cents,
    pst_cents: d.taxes.pst_cents,
    hst_cents: d.taxes.hst_cents,
    tax_total_cents: d.taxes.total_cents,
    amount_financed_cents: i.deal_type === 'cash' ? d.cashTotalDueCents : d.amountFinancedCents,
    monthly_payment_cents: monthly,
    biweekly_payment_cents: Math.round((monthly * 12) / 26),
    weekly_payment_cents: Math.round((monthly * 12) / 52),
    front_gross_cents: d.frontGrossCents,
    total_gross_cents: d.totalGrossCents,
  };
}

const INPUT_COLUMNS = [
  'province', 'deal_type', 'sale_price_cents', 'msrp_cents', 'vehicle_cost_cents',
  'cash_down_cents', 'trade_allowance_cents', 'trade_acv_cents', 'trade_lien_cents',
  'rebate_cents', 'fees_cents', 'fees_taxable', 'fi_price_cents', 'fi_cost_cents',
  'interest_rate_bps', 'term_months', 'residual_percent', 'tax_exempt',
] as const;

const OUTPUT_COLUMNS = [
  'gst_cents', 'pst_cents', 'hst_cents', 'tax_total_cents',
  'amount_financed_cents', 'monthly_payment_cents', 'front_gross_cents', 'total_gross_cents',
] as const;

/** Stored outputs + the derived payment frequencies the contract promises. */
function withDerived(row: Record<string, unknown>): Record<string, unknown> {
  const monthly = Number(row['monthly_payment_cents'] ?? 0);
  return {
    ...row,
    biweekly_payment_cents: Math.round((monthly * 12) / 26),
    weekly_payment_cents: Math.round((monthly * 12) / 52),
  };
}

async function requireLiveStore(client: PoolClient, storeId: string): Promise<void> {
  const r = await client.query(
    `SELECT 1 FROM stores WHERE id = $1 AND deleted_at IS NULL AND status <> 'closed'`,
    [storeId],
  );
  if (r.rows.length === 0) {
    throw new AppError(422, 'validation_failed', 'Unknown store for this organization', [
      { path: 'store_id', code: 'invalid_reference', message: 'Store not found in this organization (or closed)' },
    ]);
  }
}

/** The car must live in the SAME tenant (RLS makes a foreign one invisible). */
async function requireVehicleInOrg(client: PoolClient, vehicleId: string): Promise<void> {
  const r = await client.query(`SELECT 1 FROM vehicles WHERE id = $1 AND deleted_at IS NULL`, [vehicleId]);
  if (r.rows.length === 0) {
    throw new AppError(422, 'validation_failed', 'Unknown vehicle for this organization', [
      { path: 'vehicle_id', code: 'invalid_reference', message: 'Vehicle not found in this organization' },
    ]);
  }
}

/** The lead must live in the SAME tenant (RLS makes a foreign one invisible). */
async function requireLeadInOrg(client: PoolClient, leadId: string): Promise<void> {
  const r = await client.query(`SELECT 1 FROM leads WHERE id = $1 AND deleted_at IS NULL`, [leadId]);
  if (r.rows.length === 0) {
    throw new AppError(422, 'validation_failed', 'Unknown lead for this organization', [
      { path: 'lead_id', code: 'invalid_reference', message: 'Lead not found in this organization' },
    ]);
  }
}

async function dealOrg(pool: Pool, userId: string, dealId: string): Promise<string> {
  return withUser(pool, userId, async (c) => {
    const r = await c.query<{ organization_id: string }>(
      `SELECT d.organization_id FROM deals d
       JOIN organizations o ON o.id = d.organization_id AND o.deleted_at IS NULL
       WHERE d.id = $1 AND d.deleted_at IS NULL`,
      [dealId],
    );
    if (r.rows.length === 0) throw notFound();
    return r.rows[0]!.organization_id;
  });
}

export function registerF05Routes(app: FastifyInstance, pool: Pool): void {
  app.post('/api/v1/deals/calculate', async (request, reply) => {
    // Pure: no tenant context, no writes — just the engine.
    const input = parseOrThrow(CalculateDealInput, request.body);
    return reply.send(computeOutputs(input));
  });

  app.post('/api/v1/deals', async (request, reply) => {
    const input = parseOrThrow(CreateDealInput, request.body);
    const user = sessionUser(request);
    const outputs = computeOutputs(input);
    try {
      const deal = await withTenant(pool, input.organization_id, async (c) => {
        await requireMember(c, user.id);
        await requireLiveStore(c, input.store_id);
        if (input.lead_id) await requireLeadInOrg(c, input.lead_id);
        if (input.vehicle_id) await requireVehicleInOrg(c, input.vehicle_id);
        const cols = ['organization_id', 'store_id', 'lead_id', 'vehicle_id', 'salesperson_id',
          'fi_reserve_cents', ...INPUT_COLUMNS, ...OUTPUT_COLUMNS];
        const values: unknown[] = [
          input.organization_id,
          input.store_id,
          input.lead_id ?? null,
          input.vehicle_id ?? null,
          input.salesperson_id ?? null,
          input.fi_reserve_cents ?? 0,
          ...INPUT_COLUMNS.map((k) => (input as Record<string, unknown>)[k] ?? null),
          ...OUTPUT_COLUMNS.map((k) => (outputs as unknown as Record<string, number>)[k]),
        ];
        const r = await c.query<Record<string, unknown>>(
          `INSERT INTO deals (${cols.join(', ')})
           VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
          values,
        );
        return r.rows[0]!;
      });
      return await reply.status(201).send(withDerived(deal));
    } catch (err) {
      throw conflictFrom(err) ?? err;
    }
  });

  app.get('/api/v1/deals/:id', async (request, reply) => {
    const dealId = idParam(request);
    const user = sessionUser(request);
    const deal = await withUser(pool, user.id, async (c) => {
      const r = await c.query<Record<string, unknown>>(
        `SELECT d.* FROM deals d
         JOIN organizations o ON o.id = d.organization_id AND o.deleted_at IS NULL
         WHERE d.id = $1 AND d.deleted_at IS NULL`,
        [dealId],
      );
      if (r.rows.length === 0) throw notFound();
      return r.rows[0]!;
    });
    return reply.send(withDerived(deal));
  });

  app.get('/api/v1/deals', async (request, reply) => {
    const query = parseOrThrow(DealListQuery, request.query);
    const user = sessionUser(request);
    const page = await withUser(pool, user.id, async (c) => {
      let orgId = query.organization_id;
      if (orgId) {
        const member = await c.query(
          `SELECT 1 FROM memberships m
           JOIN organizations o ON o.id = m.organization_id AND o.deleted_at IS NULL
           WHERE m.organization_id = $1 AND m.status = 'active' LIMIT 1`,
          [orgId],
        );
        if (member.rows.length === 0) throw notFound();
      } else {
        const r = await c.query<{ organization_id: string }>(
          `SELECT DISTINCT m.organization_id FROM memberships m
           JOIN organizations o ON o.id = m.organization_id AND o.deleted_at IS NULL
           WHERE m.status = 'active'`,
        );
        if (r.rows.length === 0) return { items: [], next_cursor: null };
        if (r.rows.length > 1) {
          throw new AppError(400, 'organization_required', 'Pass organization_id — you belong to several organizations');
        }
        orgId = r.rows[0]!.organization_id;
      }
      let sql = `SELECT * FROM deals WHERE organization_id = $1 AND deleted_at IS NULL`;
      const params: unknown[] = [orgId];
      for (const [key, value] of [
        ['store_id', query.store_id],
        ['lead_id', query.lead_id],
        ['pipeline_stage', query.pipeline_stage],
        ['funding_status', query.funding_status],
      ] as const) {
        if (value) {
          params.push(value);
          sql += ` AND ${key} = $${params.length}`;
        }
      }
      return keysetPage<Record<string, unknown> & { id: string }>(c, sql, params, query);
    });
    return reply.send({ ...page, items: page.items.map(withDerived) });
  });

  app.patch('/api/v1/deals/:id', async (request, reply) => {
    const dealId = idParam(request);
    const input = parseOrThrow(UpdateDealInput, request.body);
    const user = sessionUser(request);
    const orgId = await dealOrg(pool, user.id, dealId);
    const deal = await withTenant(pool, orgId, async (c) => {
      await requireMember(c, user.id);
      if (input.lead_id) await requireLeadInOrg(c, input.lead_id);
      if (input.vehicle_id) await requireVehicleInOrg(c, input.vehicle_id);

      const current = await c.query<Record<string, unknown>>(
        `SELECT * FROM deals WHERE id = $1 AND deleted_at IS NULL`,
        [dealId],
      );
      if (current.rows.length === 0) throw notFound();

      // Inputs changed ⇒ the engine speaks again: stored outputs must never
      // drift from the inputs beside them.
      const merged = { ...current.rows[0]!, ...input } as unknown as DeskingInputsT;
      const outputs = computeOutputs(merged);

      const setEntries: [string, unknown][] = [
        ...Object.entries(input),
        ...OUTPUT_COLUMNS.map((k) => [k, (outputs as unknown as Record<string, number>)[k]] as [string, unknown]),
      ];
      // The two tracks stamp their own moments: the commission engine keys its
      // monthly tier on funded_at, never on the stage (commissions §11).
      if (input.funding_status === 'funded' && !current.rows[0]!['funded_at']) {
        setEntries.push(['funded_at', new Date().toISOString()]);
      }
      if (input.pipeline_stage === 'delivered' && !current.rows[0]!['delivered_at']) {
        setEntries.push(['delivered_at', new Date().toISOString()]);
      }
      const sets = setEntries.map(([k], i) => `${k} = $${i + 2}`).join(', ');
      const r = await c.query<Record<string, unknown>>(
        `UPDATE deals SET ${sets} WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
        [dealId, ...setEntries.map(([, v]) => v)],
      );
      if (r.rows.length === 0) throw notFound();
      const updated = r.rows[0]!;

      // F-09: pay is written in the SAME transaction that records the money
      // arriving, so a funded deal and its commission can never disagree.
      // The engine (A-06) owns the math; the unique index makes it idempotent.
      if (input.funding_status === 'funded' && updated['funded_at']) {
        await writeCommissionsForFundedDeal(c, {
          id: String(updated['id']),
          organization_id: String(updated['organization_id']),
          salesperson_id: (updated['salesperson_id'] as string | null) ?? null,
          sale_price_cents: Number(updated['sale_price_cents']),
          vehicle_cost_cents: Number(updated['vehicle_cost_cents']),
          fi_reserve_cents: Number(updated['fi_reserve_cents'] ?? 0),
          funded_at: new Date(updated['funded_at'] as string | Date).toISOString(),
        });
      }
      return updated;
    });
    return reply.send(withDerived(deal));
  });
}
