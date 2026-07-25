import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, reset, type Pool } from '@dealpilot/db';
import { Deal, DeskingOutputs, paginated } from '@dealpilot/schemas';
import { buildApp } from './app.js';

/**
 * F-05 integration suite — desking on the A-06 money engine.
 * Journey: from a lead, price a deal → see payment/taxes/gross → save it →
 * it lists under the lead. The golden numbers below are the engine's, verified
 * by hand: QC taxable $27,500 → GST $1,375.00 + QST $2,743.13 = $4,118.13;
 * financed $33,117.13; front gross $4,000; total gross $4,500.
 */

const ADMIN_URL = 'postgresql://dealpilot:dealpilot@localhost:5434/dealpilot';
const APP_URL = 'postgresql://dealpilot_app:dealpilot_app_dev@localhost:5434/dealpilot';
const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'packages', 'db', 'migrations',
);

const run = Date.now().toString(36);
const OWNER = { email: `f05-owner-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Alice Owner' };
const OUTSIDER = { email: `f05-out-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Olive Outsider' };

let admin: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookieOwner = '';
let cookieOutsider = '';
let orgId = '';
let storeId = '';
let leadId = '';
let dealId = '';

const DealPage = paginated(Deal);

/** The worksheet the owner would type (QC, trade, rebate, fees, F&I). */
const WORKSHEET = {
  province: 'QC' as const,
  deal_type: 'finance' as const,
  sale_price_cents: 3_500_000,
  vehicle_cost_cents: 3_100_000,
  trade_allowance_cents: 1_000_000,
  trade_acv_cents: 950_000,
  trade_lien_cents: 300_000,
  rebate_cents: 200_000,
  fees_cents: 49_900,
  fees_taxable: false,
  fi_price_cents: 250_000,
  fi_cost_cents: 150_000,
  interest_rate_bps: 599,
  term_months: 60,
};

async function signUp(u: { email: string; password: string; name: string }) {
  const res = await app!.inject({ method: 'POST', url: '/api/auth/sign-up/email', payload: u });
  expect(res.statusCode).toBe(200);
  const sc = res.headers['set-cookie'];
  return (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');
}

beforeAll(async () => {
  admin = createPool({ connectionString: ADMIN_URL, max: 2 });
  try {
    await admin.query('SELECT 1');
    dbUp = true;
  } catch {
    if (process.env['RLS_REQUIRED']) throw new Error('RLS_REQUIRED set but database unreachable');
    return;
  }
  await reset(admin, migrationsDir, ADMIN_URL);
  ({ app } = await buildApp({ DATABASE_URL: APP_URL, NODE_ENV: 'test' }));
  cookieOwner = await signUp(OWNER);
  cookieOutsider = await signUp(OUTSIDER);

  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie: cookieOwner },
    payload: { name: 'Groupe F05', slug: `groupe-f05-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie: cookieOwner },
    payload: { organization_id: orgId, name: 'F05 Kia', code: 'F05-KIA', province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;
  const lead = await app!.inject({
    method: 'POST', url: '/api/v1/leads', headers: { cookie: cookieOwner },
    payload: { organization_id: orgId, store_id: storeId, phone: '5145550180', source: 'walk_in', first_name: 'Buyer' },
  });
  leadId = (JSON.parse(lead.body) as { id: string }).id;
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('F-05 desking calculator', () => {
  it('prices a QC deal exactly as the money engine does (golden numbers)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/deals/calculate', headers: { cookie: cookieOwner },
      payload: WORKSHEET,
    });
    expect(res.statusCode).toBe(200);
    const out = DeskingOutputs.parse(JSON.parse(res.body));
    expect(out.gst_cents).toBe(137_500);
    expect(out.pst_cents).toBe(274_313);
    expect(out.tax_total_cents).toBe(411_813);
    expect(out.amount_financed_cents).toBe(3_311_713);
    expect(out.monthly_payment_cents).toBe(64_009);
    expect(out.front_gross_cents).toBe(400_000);
    expect(out.total_gross_cents).toBe(450_000);
    // Payment frequencies are derived, never re-entered.
    expect(out.biweekly_payment_cents).toBe(Math.round((64_009 * 12) / 26));
  });

  it('an Ontario deal uses HST, not GST/QST', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/deals/calculate', headers: { cookie: cookieOwner },
      payload: { ...WORKSHEET, province: 'ON' },
    });
    const out = DeskingOutputs.parse(JSON.parse(res.body));
    expect(out.gst_cents).toBe(0);
    expect(out.pst_cents).toBe(0);
    expect(out.hst_cents).toBe(Math.round(2_750_000 * 0.13));
  });

  it('calculate is preview only — it stores nothing', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const before = await admin.query('SELECT count(*)::int AS n FROM deals');
    await app!.inject({
      method: 'POST', url: '/api/v1/deals/calculate', headers: { cookie: cookieOwner }, payload: WORKSHEET,
    });
    const after = await admin.query('SELECT count(*)::int AS n FROM deals');
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('requires a session', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({ method: 'POST', url: '/api/v1/deals/calculate', payload: WORKSHEET });
    expect(res.statusCode).toBe(401);
  });
});

describe('HO-05: a lease is priced from the typed rate, term and residual', () => {
  const LEASE = {
    province: 'QC' as const,
    deal_type: 'lease' as const,
    sale_price_cents: 3_500_000,
    msrp_cents: 3_800_000,
    vehicle_cost_cents: 3_100_000,
    cash_down_cents: 200_000,
    interest_rate_bps: 599,
    term_months: 48,
    residual_percent: 55,
  };

  it('uses the typed values, not the engine defaults (golden)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/deals/calculate', headers: { cookie: cookieOwner }, payload: LEASE,
    });
    expect(res.statusCode).toBe(200);
    const out = DeskingOutputs.parse(JSON.parse(res.body));
    // 5.99% APR -> money factor 5.99/2400; residual 55% of $38,000 = $20,900.
    expect(out.monthly_payment_cents).toBe(44_450);
  });

  it('changing the term or the residual changes the payment', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const longer = await app!.inject({
      method: 'POST', url: '/api/v1/deals/calculate', headers: { cookie: cookieOwner },
      payload: { ...LEASE, term_months: 60 },
    });
    const lowerResidual = await app!.inject({
      method: 'POST', url: '/api/v1/deals/calculate', headers: { cookie: cookieOwner },
      payload: { ...LEASE, residual_percent: 45 },
    });
    const base = 44_450;
    expect(DeskingOutputs.parse(JSON.parse(longer.body)).monthly_payment_cents).not.toBe(base);
    // Less residual value left at the end = more to depreciate = higher payment.
    expect(DeskingOutputs.parse(JSON.parse(lowerResidual.body)).monthly_payment_cents).toBeGreaterThan(base);
  });

  it('a saved lease persists the residual it was priced with', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/deals', headers: { cookie: cookieOwner },
      payload: { ...LEASE, organization_id: orgId, store_id: storeId, residual_percent: 50 },
    });
    expect(res.statusCode).toBe(201);
    const deal = Deal.parse(JSON.parse(res.body));
    expect(deal.residual_percent).toBe(50);
    expect(deal.monthly_payment_cents).toBeGreaterThan(0);
  });
});

describe('F-05 saved deals', () => {
  it('saves a deal on a lead with the engine outputs persisted', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/deals', headers: { cookie: cookieOwner },
      payload: { ...WORKSHEET, organization_id: orgId, store_id: storeId, lead_id: leadId },
    });
    expect(res.statusCode).toBe(201);
    const deal = Deal.parse(JSON.parse(res.body));
    expect(deal.status).toBe('working');
    expect(deal.lead_id).toBe(leadId);
    expect(deal.tax_total_cents).toBe(411_813);
    expect(deal.monthly_payment_cents).toBe(64_009);
    expect(deal.total_gross_cents).toBe(450_000);
    dealId = deal.id;
  });

  it('engine outputs are never accepted from the client', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/deals', headers: { cookie: cookieOwner },
      payload: { ...WORKSHEET, organization_id: orgId, store_id: storeId, total_gross_cents: 99_999_900 },
    });
    expect(res.statusCode).toBe(422);
  });

  it('editing inputs RECOMPUTES the outputs', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}`, headers: { cookie: cookieOwner },
      payload: { sale_price_cents: 3_600_000 },
    });
    expect(res.statusCode).toBe(200);
    const deal = Deal.parse(JSON.parse(res.body));
    expect(deal.sale_price_cents).toBe(3_600_000);
    // A higher price means more tax and more front gross than the original.
    expect(deal.tax_total_cents).toBeGreaterThan(411_813);
    expect(deal.front_gross_cents).toBe(500_000);
  });

  it('lists by lead and by status; a status move is allowed', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const byLead = await app!.inject({
      method: 'GET', url: `/api/v1/deals?organization_id=${orgId}&lead_id=${leadId}`,
      headers: { cookie: cookieOwner },
    });
    expect(byLead.statusCode).toBe(200);
    expect(DealPage.parse(JSON.parse(byLead.body)).items.map((d) => d.id)).toEqual([dealId]);

    const move = await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}`, headers: { cookie: cookieOwner },
      payload: { status: 'submitted' },
    });
    expect(move.statusCode).toBe(200);
    expect(Deal.parse(JSON.parse(move.body)).status).toBe('submitted');

    const submitted = await app!.inject({
      method: 'GET', url: `/api/v1/deals?organization_id=${orgId}&status=submitted`,
      headers: { cookie: cookieOwner },
    });
    expect(DealPage.parse(JSON.parse(submitted.body)).items).toHaveLength(1);
  });

  it('a non-member sees nothing: get 404, list 404', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const get = await app!.inject({ method: 'GET', url: `/api/v1/deals/${dealId}`, headers: { cookie: cookieOutsider } });
    expect(get.statusCode).toBe(404);
    const list = await app!.inject({
      method: 'GET', url: `/api/v1/deals?organization_id=${orgId}`, headers: { cookie: cookieOutsider },
    });
    expect(list.statusCode).toBe(404);
  });

  it('a lead from another org cannot be attached', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const otherOrg = await app!.inject({
      method: 'POST', url: '/api/v1/organizations', headers: { cookie: cookieOutsider },
      payload: { name: 'Groupe Rival', slug: `groupe-rival-f05-${run}` },
    });
    const otherOrgId = (JSON.parse(otherOrg.body) as { id: string }).id;
    const otherStore = await app!.inject({
      method: 'POST', url: '/api/v1/stores', headers: { cookie: cookieOutsider },
      payload: { organization_id: otherOrgId, name: 'Rival', code: 'RIVAL-5', province: 'ON' },
    });
    const otherStoreId = (JSON.parse(otherStore.body) as { id: string }).id;
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/deals', headers: { cookie: cookieOutsider },
      payload: { ...WORKSHEET, organization_id: otherOrgId, store_id: otherStoreId, lead_id: leadId },
    });
    expect(res.statusCode).toBe(422);
  });
});
