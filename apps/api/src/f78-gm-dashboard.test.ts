import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { GmDashboardReport, type GmDashboardReportT } from '@dealpilot/schemas';
import { buildApp } from './app.js';

/**
 * F-78 — the GM Command Center report (reports-analytics.md §14.1, D-079).
 * Fixtures arrive through the product API; admin SQL appears ONLY for time
 * travel (backdating delivered_at / stage_entered_at / leads.created_at —
 * the F-55 licence).
 *
 * THE GOLDEN WORLD (org A, store S1; every number computed BY HAND, engine
 * outputs asserted at creation so the goldens are the ENGINE's, not the
 * plan's):
 *
 *   Worksheets (QC finance, no trade, no fees):
 *     sale 30 000 $ / cost 23 000 $            → front = total gross 7 000 $;
 *       GST 1 500,00 + QST 2 992,50            → amount financed 34 492,50 $
 *     sale 40 000 $ / cost 32 000 $ + F&I 2 000/1 000
 *                                              → front 8 000 $, total 9 000 $
 *     sale 20 000 $ / cost 16 000 $            → front = total 4 000 $;
 *       GST 1 000,00 + QST 1 995,00            → amount financed 22 995,00 $
 *     sale 26 000 $ / cost 20 000 $            → front = total 6 000 $
 *
 *   Deals: D1 new (lead Carla, rotting −8d) · D2 new (−6d, NOT rotting) ·
 *   D3 submitted+funding submitted (queue; financed 3 449 250) · D8 delivered
 *   then REGRESSED to sourcing (delivered_at sticky) · D9 lost while funding
 *   submitted (queue excluded) · D10 submitted+funding funded (not delivered:
 *   month excluded, queue excluded) · D11 new, contact-only "Solange"
 *   (rotting −9d) · D12 approved+stips_required (queue; financed 2 299 500) ·
 *   D4/D5/D6 delivered this month (Vicky/Vicky/unattributed; 7 000 + 9 000 +
 *   4 000 = 20 000 $ gross) all funded · D7 delivered LAST month, funded.
 *
 *   Static figures: pipeline total 7 (new 3, submitted 2, approved 1,
 *   sourcing 1); funding_by_status not_submitted 4 / submitted 1 /
 *   stips_required 1 / funded 1; month units 3, gross 2 000 000 cents,
 *   avg_front round((700000+800000+400000)/3) = 633 333, avg_back
 *   round((0+100000+0)/3) = 33 333; queue count 2, amount 3 449 250 +
 *   2 299 500 = 5 748 750; vehicles in_stock 3, over_30 2, buckets 1/1/1;
 *   leads created 6 (4 walk_in + 2 website), converted 2 (Carla via deal,
 *   Webbe via the WON deal-clause on a status-new lead), rate 33.3;
 *   salespeople Vicky {2 units, 1 600 000} + 1 unattributed; rotting
 *   [Solange 9d, Carla 8d] count 2.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';

/** QC finance worksheet skeleton; front gross = sale − cost here (no trade,
 * no fees), total gross = front + (fi_price − fi_cost). */
function worksheet(sale: number, cost: number, fi: { price: number; cost: number } = { price: 0, cost: 0 }) {
  return {
    province: 'QC' as const,
    deal_type: 'finance' as const,
    sale_price_cents: sale,
    vehicle_cost_cents: cost,
    trade_allowance_cents: 0,
    trade_acv_cents: 0,
    trade_lien_cents: 0,
    rebate_cents: 0,
    fees_cents: 0,
    fees_taxable: false,
    fi_price_cents: fi.price,
    fi_cost_cents: fi.cost,
    interest_rate_bps: 599,
    term_months: 60,
  };
}

/** The UTC instant at which `tz`'s wall clock reads the 1st of its current
 * month, 00:00:00 — computed independently of the server (Intl parts). */
function zonedMonthStart(tz: string, at = new Date()): Date {
  const ym = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).formatToParts(at);
  const get = (parts: Intl.DateTimeFormatPart[], t: string) => Number(parts.find((p) => p.type === t)!.value);
  const y = get(ym, 'year');
  const m = get(ym, 'month');
  const target = Date.UTC(y, m - 1, 1, 0, 0, 0);
  let guess = target;
  for (let i = 0; i < 3; i += 1) {
    const f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(new Date(guess));
    const wall = Date.UTC(get(f, 'year'), get(f, 'month') - 1, get(f, 'day'), get(f, 'hour') % 24, get(f, 'minute'), get(f, 'second'));
    if (wall === target) break;
    guess += target - wall;
  }
  return new Date(guess);
}

const HOUR = 3_600_000;
const DAY = 86_400_000;

let admin: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookieA = '';
let cookieVicky = '';
let cookieMarc = '';
let cookieB = '';
let orgA = '';
let s1 = '';
let s2 = '';
let s1Timezone = '';
let vickyUserId = '';
let remiMemberId = '';
let remiUserId = '';
let carlaLeadId = '';
let d1 = ''; // rotting −8d, lead Carla
let d8 = ''; // delivered then regressed to sourcing
let monthStartA: Date;

function cookiesOf(res: { headers: Record<string, unknown> }): string {
  const sc = res.headers['set-cookie'];
  return (Array.isArray(sc) ? sc : [sc!]).map((c) => String(c).split(';')[0]).join('; ');
}

async function signUp(email: string, name: string): Promise<string> {
  const res = await app!.inject({ method: 'POST', url: '/api/auth/sign-up/email', payload: { email, password: PASSWORD, name } });
  expect(res.statusCode, res.body).toBe(200);
  return cookiesOf(res);
}

async function makeLead(
  orgId: string, storeId: string, n: number, source: string,
  names: { first?: string; last?: string } = {},
): Promise<string> {
  const res = await app!.inject({
    method: 'POST', url: '/api/v1/leads', headers: { cookie: cookieA },
    payload: {
      organization_id: orgId, store_id: storeId, source,
      first_name: names.first ?? `Client${n}`, last_name: names.last ?? `Essai${n}`,
      phone: `+1514555${String(9100 + n)}`,
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (JSON.parse(res.body) as { id: string }).id;
}

async function makeDeal(payload: Record<string, unknown>, cookie = cookieA): Promise<Record<string, unknown>> {
  const res = await app!.inject({ method: 'POST', url: '/api/v1/deals', headers: { cookie }, payload });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body) as Record<string, unknown>;
}

async function patchDeal(id: string, payload: Record<string, unknown>, cookie = cookieA): Promise<void> {
  const res = await app!.inject({ method: 'PATCH', url: `/api/v1/deals/${id}`, headers: { cookie }, payload });
  expect(res.statusCode, res.body).toBe(200);
}

/** The product's delivery walk: complete every outstanding checklist item,
 * then move the stage (the F-05/F-08 path — never a raw stage write). */
async function deliver(dealId: string, cookie = cookieA): Promise<void> {
  const checklist = await app!.inject({
    method: 'GET', url: `/api/v1/deals/${dealId}/checklist`, headers: { cookie },
  });
  expect(checklist.statusCode, checklist.body).toBe(200);
  const outstanding = (JSON.parse(checklist.body) as { readiness: { outstanding: string[] } }).readiness.outstanding;
  for (const code of outstanding) {
    const tick = await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}/checklist/${code}`, headers: { cookie },
      payload: { completed: true },
    });
    expect(tick.statusCode, tick.body).toBe(200);
  }
  await patchDeal(dealId, { pipeline_stage: 'delivered' }, cookie);
}

async function report(orgId: string, cookie = cookieA): Promise<GmDashboardReportT> {
  const res = await app!.inject({
    method: 'GET', url: `/api/v1/reports/gm-dashboard?organization_id=${orgId}`, headers: { cookie },
  });
  expect(res.statusCode, res.body).toBe(200);
  // Parsed against the WIRE schema on every read — the contract is asserted
  // as often as the figures are.
  return GmDashboardReport.parse(JSON.parse(res.body));
}

/** Wire invariants that must hold on EVERY response (D-079). */
function assertInvariants(r: GmDashboardReportT): void {
  expect(r.pipeline.by_stage).toHaveLength(7);
  expect(r.funding_by_status).toHaveLength(4);
  expect(r.pipeline.by_stage.reduce((a, x) => a + x.count, 0)).toBe(r.pipeline.total);
  expect(r.funding_by_status.reduce((a, x) => a + x.count, 0)).toBe(r.pipeline.total);
  expect(r.inventory.over_30_days).toBe(r.inventory.aging_31_60 + r.inventory.aging_over_60);
  expect(r.salespeople.rows.reduce((a, x) => a + x.units, 0) + r.salespeople.unattributed_units)
    .toBe(r.month_sales.units);
  expect(r.attention.rotting.rows.length).toBeLessThanOrEqual(10);
  expect(r.attention.delivered_unfunded.rows.length).toBeLessThanOrEqual(10);
}

beforeAll(async () => {
  await ensureTestDatabase();
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

  cookieA = await signUp(`f78-owner-${run}@dealpilot.test`, 'Gaston Gérant');
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie: cookieA },
    payload: { name: 'Groupe F78', slug: `groupe-f78-${run}` },
  });
  orgA = (JSON.parse(org.body) as { id: string }).id;
  // S1 carries the DEFAULT timezone; every timezone assertion reads the
  // STORE ROW's value from this response, never a literal (MUST ADD #1).
  const store1 = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie: cookieA },
    payload: { organization_id: orgA, name: 'F78 Un', code: 'F78-UN', province: 'QC' },
  });
  const s1Row = JSON.parse(store1.body) as { id: string; timezone: string };
  s1 = s1Row.id;
  s1Timezone = s1Row.timezone;
  // Sequential creation (A15): distinct created_at keeps "first store"
  // deterministic under f67's ORDER BY created_at LIMIT 1.
  const store2 = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie: cookieA },
    payload: { organization_id: orgA, name: 'F78 Deux', code: 'F78-DEUX', province: 'QC' },
  });
  s2 = (JSON.parse(store2.body) as { id: string }).id;
  monthStartA = zonedMonthStart(s1Timezone);

  // People: Vicky sells (and is the 403 persona), Rémi sells then leaves
  // (A2), Marc manages S1 only (the store-scope split).
  cookieVicky = await signUp(`f78-vicky-${run}@dealpilot.test`, 'Vicky Vendeuse');
  const vicky = await app!.inject({
    method: 'POST', url: '/api/v1/members', headers: { cookie: cookieA },
    payload: { organization_id: orgA, email: `f78-vicky-${run}@dealpilot.test`, name: 'Vicky Vendeuse', roles: ['salesperson'] },
  });
  expect(vicky.statusCode, vicky.body).toBe(201);
  vickyUserId = (JSON.parse(vicky.body) as { user_id: string }).user_id;
  await signUp(`f78-remi-${run}@dealpilot.test`, 'Rémi Parti');
  const remi = await app!.inject({
    method: 'POST', url: '/api/v1/members', headers: { cookie: cookieA },
    payload: { organization_id: orgA, email: `f78-remi-${run}@dealpilot.test`, name: 'Rémi Parti', roles: ['salesperson'] },
  });
  expect(remi.statusCode, remi.body).toBe(201);
  remiMemberId = (JSON.parse(remi.body) as { id: string }).id;
  remiUserId = (JSON.parse(remi.body) as { user_id: string }).user_id;
  cookieMarc = await signUp(`f78-marc-${run}@dealpilot.test`, 'Marc Manager');
  const marc = await app!.inject({
    method: 'POST', url: '/api/v1/members', headers: { cookie: cookieA },
    payload: { organization_id: orgA, email: `f78-marc-${run}@dealpilot.test`, name: 'Marc Manager', roles: ['sales_manager'], store_id: s1 },
  });
  expect(marc.statusCode, marc.body).toBe(201);

  // ---- Leads (this month: 4 walk_in + 2 website; L0 backdated out) ----
  const l0 = await makeLead(orgA, s1, 0, 'walk_in');
  await makeLead(orgA, s1, 1, 'walk_in');
  await makeLead(orgA, s1, 2, 'walk_in');
  carlaLeadId = await makeLead(orgA, s1, 3, 'walk_in', { first: 'Carla', last: 'Cliente' });
  const webbeLeadId = await makeLead(orgA, s1, 4, 'website', { first: 'Webbe', last: 'Client' });
  await makeLead(orgA, s1, 5, 'walk_in');
  await makeLead(orgA, s1, 6, 'website');

  // Contact with ONLY a first name (A3's one-name fixture) for the
  // contact-born attention row.
  const contact = await app!.inject({
    method: 'POST', url: '/api/v1/contacts', headers: { cookie: cookieA },
    payload: { organization_id: orgA, first_name: 'Solange', phone: '+15145559200' },
  });
  expect(contact.statusCode, contact.body).toBe(201);
  const solangeId = (JSON.parse(contact.body) as { contact: { id: string } }).contact.id;

  const base = { organization_id: orgA, store_id: s1 };

  // ---- Deals (see the golden block) ----
  const dealD1 = await makeDeal({ ...base, ...worksheet(3_000_000, 2_300_000), lead_id: carlaLeadId });
  d1 = String(dealD1['id']);
  const d2 = String((await makeDeal({ ...base, ...worksheet(3_000_000, 2_300_000) }))['id']);

  // D3 — the queue's first deal: the engine's amount financed for a QC
  // 30 000 $ no-extras worksheet, pinned HERE (it feeds the e2e strings).
  const dealD3 = await makeDeal({ ...base, ...worksheet(3_000_000, 2_300_000) });
  expect(dealD3['amount_financed_cents']).toBe(3_449_250);
  expect(dealD3['front_gross_cents']).toBe(700_000);
  expect(dealD3['total_gross_cents']).toBe(700_000);
  const d3 = String(dealD3['id']);
  await patchDeal(d3, { pipeline_stage: 'submitted' });
  await patchDeal(d3, { funding_status: 'submitted' });

  // D8 — delivered then REGRESSED: delivered_at is stamped once and sticky,
  // so only the STATE-based Q9 predicate keeps this deal out of the table.
  d8 = String((await makeDeal({ ...base, ...worksheet(3_000_000, 2_300_000) }))['id']);
  await deliver(d8);
  await patchDeal(d8, { pipeline_stage: 'sourcing' });

  // D9 — lost while funding was submitted: the queue must not count it.
  const d9 = String((await makeDeal({ ...base, ...worksheet(3_000_000, 2_300_000) }))['id']);
  await patchDeal(d9, { funding_status: 'submitted' });
  await patchDeal(d9, { pipeline_stage: 'lost' });

  // D10 — funded but never delivered: no month sale, no queue row.
  const d10 = String((await makeDeal({ ...base, ...worksheet(3_000_000, 2_300_000) }))['id']);
  await patchDeal(d10, { pipeline_stage: 'submitted' });
  await patchDeal(d10, { funding_status: 'funded' });

  // D11 — contact-born, no lead (rots at −9d; row must read « Solange »).
  const d11 = String((await makeDeal({ ...base, ...worksheet(3_000_000, 2_300_000), contact_id: solangeId }))['id']);

  // D12 — the queue's second deal (stips_required).
  const dealD12 = await makeDeal({ ...base, ...worksheet(2_000_000, 1_600_000) });
  expect(dealD12['amount_financed_cents']).toBe(2_299_500);
  const d12 = String(dealD12['id']);
  await patchDeal(d12, { pipeline_stage: 'approved' });
  await patchDeal(d12, { funding_status: 'stips_required' });

  // D4/D5/D6 — this month's deliveries (engine outputs asserted).
  const dealD4 = await makeDeal({ ...base, ...worksheet(3_000_000, 2_300_000), lead_id: carlaLeadId, salesperson_id: vickyUserId });
  expect(dealD4['total_gross_cents']).toBe(700_000);
  const d4 = String(dealD4['id']);
  await deliver(d4);
  await patchDeal(d4, { funding_status: 'funded' });
  const dealD5 = await makeDeal({
    ...base, ...worksheet(4_000_000, 3_200_000, { price: 200_000, cost: 100_000 }),
    lead_id: webbeLeadId, salesperson_id: vickyUserId,
  });
  expect(dealD5['front_gross_cents']).toBe(800_000);
  expect(dealD5['total_gross_cents']).toBe(900_000);
  const d5 = String(dealD5['id']);
  await deliver(d5);
  await patchDeal(d5, { funding_status: 'funded' });
  const dealD6 = await makeDeal({ ...base, ...worksheet(2_000_000, 1_600_000) });
  expect(dealD6['total_gross_cents']).toBe(400_000);
  const d6 = String(dealD6['id']);
  await deliver(d6);
  await patchDeal(d6, { funding_status: 'funded' });

  // D7 — delivered LAST month (time travel below), funded.
  const d7 = String((await makeDeal({ ...base, ...worksheet(3_000_000, 2_300_000) }))['id']);
  await deliver(d7);
  await patchDeal(d7, { funding_status: 'funded' });

  // ---- Vehicles: today, −45d, −75d (acquisition_date is a product field) ----
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  for (const [i, date] of [undefined, iso(Date.now() - 45 * DAY), iso(Date.now() - 75 * DAY)].entries()) {
    const v = await app!.inject({
      method: 'POST', url: '/api/v1/vehicles', headers: { cookie: cookieA },
      payload: {
        organization_id: orgA, store_id: s1, stock_number: `F78-V${i}`,
        year: 2024, make: 'Kia', model: 'Sorento', acquisition_type: 'auction',
        ...(date ? { acquisition_date: date } : {}),
      },
    });
    expect(v.statusCode, v.body).toBe(201);
  }

  // ---- Time travel (admin SQL — the only raw writes in this suite) ----
  await admin.query(`UPDATE leads SET created_at = $2 WHERE id = $1`, [l0, new Date(monthStartA.getTime() - 10 * DAY)]);
  await admin.query(`UPDATE deals SET stage_entered_at = now() - interval '8 days' WHERE id = $1`, [d1]);
  await admin.query(`UPDATE deals SET stage_entered_at = now() - interval '6 days' WHERE id = $1`, [d2]);
  await admin.query(`UPDATE deals SET stage_entered_at = now() - interval '9 days' WHERE id = $1`, [d11]);
  // Closed deals never rot, however old their stage entry.
  await admin.query(
    `UPDATE deals SET stage_entered_at = now() - interval '30 days', delivered_at = $2 WHERE id = $1`,
    [d7, new Date(monthStartA.getTime() - 15 * DAY)],
  );
}, 120_000);

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('F-78 GM dashboard — gate and personas', () => {
  it('no organization_id → 400 organization_required', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'GET', url: '/api/v1/reports/gm-dashboard', headers: { cookie: cookieA },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ error: { code: 'organization_required' } });
  });

  it('a salesperson holds no report:view → 403', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'GET', url: `/api/v1/reports/gm-dashboard?organization_id=${orgA}`,
      headers: { cookie: cookieVicky },
    });
    expect(res.statusCode).toBe(403);
  });

  it('empty world WITH a store: zeros, nulls (never fabricated 0 rates), the store row’s timezone', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // A separate owner and org: doubles as the second-org isolation persona —
    // org A is full and none of it shows here.
    cookieB = await signUp(`f78-b-${run}@dealpilot.test`, 'Berthe Second');
    const orgB = await app!.inject({
      method: 'POST', url: '/api/v1/organizations', headers: { cookie: cookieB },
      payload: { name: 'Groupe Vide', slug: `groupe-vide-${run}` },
    });
    const orgBId = (JSON.parse(orgB.body) as { id: string }).id;
    const storeB = await app!.inject({
      method: 'POST', url: '/api/v1/stores', headers: { cookie: cookieB },
      payload: { organization_id: orgBId, name: 'Vide', code: 'F78-VIDE', province: 'QC' },
    });
    const storeBTz = (JSON.parse(storeB.body) as { timezone: string }).timezone;

    const r = await report(orgBId, cookieB);
    assertInvariants(r);
    expect(r.month.timezone).toBe(storeBTz);
    expect(r.pipeline.total).toBe(0);
    expect(r.pipeline.by_stage.map((x) => x.count)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(r.funding_by_status.map((x) => x.count)).toEqual([0, 0, 0, 0]);
    expect(r.month_sales).toEqual({ units: 0, gross_cents: 0, avg_front_gross_cents: null, avg_back_gross_cents: null });
    expect(r.funding).toEqual({ count: 0, amount_financed_cents: 0 });
    expect(r.inventory).toEqual({ in_stock: 0, over_30_days: 0, aging_0_30: 0, aging_31_60: 0, aging_over_60: 0 });
    expect(r.leads).toEqual({ created: 0, converted: 0, conversion_rate: null });
    expect(r.lead_sources).toEqual([]);
    expect(r.salespeople).toEqual({ rows: [], unattributed_units: 0 });
    expect(r.attention.rotting).toEqual({ count: 0, rows: [] });
    expect(r.attention.delivered_unfunded).toEqual({ count: 0, rows: [] });
  });
});

describe('F-78 GM dashboard — the golden month (org A)', () => {
  it('every figure matches the hand-computed world; wire invariants hold', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const r = await report(orgA);
    assertInvariants(r);

    // The clock and window: the FIRST store's row value, never a literal.
    expect(r.month.timezone).toBe(s1Timezone);
    expect(r.month.start).toBe(monthStartA.toISOString());

    // Q1 — open pipeline (delivered/complete/lost excluded).
    expect(r.pipeline.total).toBe(7);
    expect(Object.fromEntries(r.pipeline.by_stage.map((x) => [x.stage, x.count]))).toEqual({
      new: 3, submitted: 2, approved: 1, signed: 0, sourcing: 1, pending_delivery: 0, scheduled: 0,
    });

    // Q10 — the same open deals by funding status.
    expect(Object.fromEntries(r.funding_by_status.map((x) => [x.status, x.count]))).toEqual({
      not_submitted: 4, submitted: 1, stips_required: 1, funded: 1,
    });

    // Q2 — month sales golden (engine-derived; feeds the e2e strings).
    expect(r.month_sales.units).toBe(3);
    expect(r.month_sales.gross_cents).toBe(2_000_000);
    expect(r.month_sales.avg_front_gross_cents).toBe(633_333);
    expect(r.month_sales.avg_back_gross_cents).toBe(33_333);

    // Q3 — the funding queue: D3 + D12; D9 (lost) and D10 (funded) excluded.
    expect(r.funding.count).toBe(2);
    expect(r.funding.amount_financed_cents).toBe(5_748_750);

    // Q4 — inventory ages on the store clock's date.
    expect(r.inventory).toEqual({ in_stock: 3, over_30_days: 2, aging_0_30: 1, aging_31_60: 1, aging_over_60: 1 });

    // Q5 — leads & conversion: 6 created (L0 is last month), 2 converted
    // (Webbe is status-new — the WON deal-clause), rate 33.3 exactly.
    expect(r.leads).toEqual({ created: 6, converted: 2, conversion_rate: 33.3 });

    // Q6 — sources, count DESC.
    expect(r.lead_sources).toEqual([
      { source: 'walk_in', count: 4 },
      { source: 'website', count: 2 },
    ]);

    // Q7 — salespeople: Vicky 2/1 600 000; D6 unattributed.
    expect(r.salespeople.rows).toEqual([
      { user_id: vickyUserId, name: 'Vicky Vendeuse', units: 2, gross_cents: 1_600_000 },
    ]);
    expect(r.salespeople.unattributed_units).toBe(1);

    // Q9 — nothing delivered-unfunded: D4–D7 are funded and D8 (delivered_at
    // stamped, unfunded) REGRESSED out of delivered — the state-based
    // predicate keeps it out where a delivered_at-only predicate would lie.
    expect(r.attention.delivered_unfunded).toEqual({ count: 0, rows: [] });
  });

  it('Q8 rotting: floor ages, oldest first, contact and lead names, closed never rots', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const r = await report(orgA);
    expect(r.attention.rotting.count).toBe(2);
    expect(r.attention.rotting.rows).toHaveLength(2);
    const [oldest, next] = r.attention.rotting.rows;
    // D11 (−9d): contact-born, ONE name on file — concat_ws keeps it.
    expect(oldest!.customer).toBe('Solange');
    expect(oldest!.lead_id).toBeNull();
    expect(oldest!.days_in_stage).toBe(9);
    expect(oldest!.stage).toBe('new');
    // D1 (−8d): named from its lead.
    expect(next!.deal_id).toBe(d1);
    expect(next!.customer).toBe('Carla Cliente');
    expect(next!.lead_id).toBe(carlaLeadId);
    expect(next!.days_in_stage).toBe(8);
    // D2 (−6d) under the threshold, D7 (−30d but delivered) absent — the
    // count is the whole story: 2, not 3 or 4.
  });

  it('P1 cross-proof: a stage PATCH re-stamps and the deal leaves the rotting table', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await patchDeal(d1, { pipeline_stage: 'submitted' });
    const r = await report(orgA);
    expect(r.attention.rotting.count).toBe(1);
    expect(r.attention.rotting.rows.map((x) => x.deal_id)).not.toContain(d1);
  });

  it('Q7 revoked membership: the row STAYS with name null and the invariant holds', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Rémi delivers a 6 000 $ deal, gets funded, then loses his membership
    // through the product member route.
    const deal = await makeDeal({
      organization_id: orgA, store_id: s1, ...worksheet(2_600_000, 2_000_000), salesperson_id: remiUserId,
    });
    expect(deal['total_gross_cents']).toBe(600_000);
    const id = String(deal['id']);
    await deliver(id);
    await patchDeal(id, { funding_status: 'funded' });
    const revoke = await app!.inject({
      method: 'PATCH', url: `/api/v1/members/${remiMemberId}`, headers: { cookie: cookieA },
      payload: { status: 'revoked' },
    });
    expect(revoke.statusCode, revoke.body).toBe(200);

    const r = await report(orgA);
    assertInvariants(r); // Σ rows.units + unattributed === units, structurally
    expect(r.month_sales.units).toBe(4);
    const remiRow = r.salespeople.rows.find((x) => x.user_id === remiUserId);
    expect(remiRow).toEqual({ user_id: remiUserId, name: null, units: 1, gross_cents: 600_000 });
  });

  it('Q9 delivered-unfunded: appears with its age, drains when funded', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Fresh S2 deal so the month golden above stays untouched whatever the
    // calendar says (−3d can cross a month boundary; this figure has no
    // window, so the row is asserted on its own).
    const deal = await makeDeal({ organization_id: orgA, store_id: s2, ...worksheet(3_000_000, 2_300_000) });
    const id = String(deal['id']);
    await deliver(id);
    await admin.query(`UPDATE deals SET delivered_at = now() - interval '3 days' WHERE id = $1`, [id]);

    const r1 = await report(orgA);
    expect(r1.attention.delivered_unfunded.count).toBe(1);
    const row = r1.attention.delivered_unfunded.rows[0]!;
    expect(row.deal_id).toBe(id);
    expect(row.funding_status).toBe('not_submitted');
    expect(row.days_since_delivery).toBe(3);

    await patchDeal(id, { funding_status: 'funded' });
    const r2 = await report(orgA);
    expect(r2.attention.delivered_unfunded).toEqual({ count: 0, rows: [] });
  });

  it('a store-bound sales_manager reports on S1 only (F-55 scope)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // S2 grows data the S1-bound manager must never count.
    await makeLead(orgA, s2, 7, 'walk_in');
    await makeDeal({ organization_id: orgA, store_id: s2, ...worksheet(3_000_000, 2_300_000) });
    const v = await app!.inject({
      method: 'POST', url: '/api/v1/vehicles', headers: { cookie: cookieA },
      payload: {
        organization_id: orgA, store_id: s2, stock_number: 'F78-V9',
        year: 2024, make: 'Kia', model: 'EV9', acquisition_type: 'auction',
      },
    });
    expect(v.statusCode, v.body).toBe(201);

    const owner = await report(orgA);
    const marc = await report(orgA, cookieMarc);
    assertInvariants(marc);
    // Owner (org-wide): S2's lead, open deal and vehicle count.
    expect(owner.leads.created).toBe(7);
    expect(owner.pipeline.total).toBe(8);
    expect(owner.inventory.in_stock).toBe(4);
    // Marc (S1-bound): the S1 world only — hand-computed split.
    expect(marc.month.timezone).toBe(s1Timezone);
    expect(marc.leads.created).toBe(6);
    expect(marc.pipeline.total).toBe(7);
    expect(marc.inventory.in_stock).toBe(3);
    expect(marc.month_sales.units).toBe(4);
    expect(marc.month_sales.gross_cents).toBe(2_600_000);
  });
});

describe('F-78 GM dashboard — the clock is the store’s', () => {
  it('Montreal ±1h month boundary: only the +1h delivery counts; the wire says the window', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const org = await app!.inject({
      method: 'POST', url: '/api/v1/organizations', headers: { cookie: cookieA },
      payload: { name: 'Groupe Borne', slug: `groupe-borne-${run}` },
    });
    const orgD = (JSON.parse(org.body) as { id: string }).id;
    const store = await app!.inject({
      method: 'POST', url: '/api/v1/stores', headers: { cookie: cookieA },
      payload: { organization_id: orgD, name: 'Borne', code: 'F78-BORNE', province: 'QC' },
    });
    const tz = (JSON.parse(store.body) as { timezone: string }).timezone;
    const storeId = (JSON.parse(store.body) as { id: string }).id;
    const start = zonedMonthStart(tz);

    const before = await makeDeal({ organization_id: orgD, store_id: storeId, ...worksheet(3_000_000, 2_300_000) });
    await deliver(String(before['id']));
    await admin.query(`UPDATE deals SET delivered_at = $2 WHERE id = $1`, [String(before['id']), new Date(start.getTime() - HOUR)]);
    const after = await makeDeal({ organization_id: orgD, store_id: storeId, ...worksheet(3_000_000, 2_300_000) });
    await deliver(String(after['id']));
    await admin.query(`UPDATE deals SET delivered_at = $2 WHERE id = $1`, [String(after['id']), new Date(start.getTime() + HOUR)]);

    const r = await report(orgD);
    // Montreal's offset (4–5 h) guarantees start−1h shares the UTC month
    // with start+1h: a UTC date_trunc would count BOTH (this is the red
    // line). No SQL upper bound, so the +1h fixture cannot flake in the
    // first hour of a month.
    expect(r.month_sales.units).toBe(1);
    expect(r.month_sales.gross_cents).toBe(700_000);
    expect(r.month.timezone).toBe(tz);
    expect(r.month.start).toBe(start.toISOString());
  });

  it('a Vancouver first store sets the whole report’s clock (red-lines hardcoded Montreal)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const org = await app!.inject({
      method: 'POST', url: '/api/v1/organizations', headers: { cookie: cookieA },
      payload: { name: 'Groupe Pacifique', slug: `groupe-pacifique-${run}` },
    });
    const orgE = (JSON.parse(org.body) as { id: string }).id;
    // Vancouver FIRST, a default-tz store second — created sequentially so
    // f67's ORDER BY created_at LIMIT 1 is deterministic (A15).
    const storeV = await app!.inject({
      method: 'POST', url: '/api/v1/stores', headers: { cookie: cookieA },
      payload: { organization_id: orgE, name: 'Pacifique', code: 'F78-PAC', province: 'QC', timezone: 'America/Vancouver' },
    });
    expect(storeV.statusCode, storeV.body).toBe(201);
    const vRow = JSON.parse(storeV.body) as { id: string; timezone: string };
    const storeM = await app!.inject({
      method: 'POST', url: '/api/v1/stores', headers: { cookie: cookieA },
      payload: { organization_id: orgE, name: 'Est', code: 'F78-EST', province: 'QC' },
    });
    expect(storeM.statusCode, storeM.body).toBe(201);
    const vanStart = zonedMonthStart(vRow.timezone);

    // vanStart−1h is INSIDE the Montreal month (Montreal's start is 3 h
    // earlier): a hardcoded-Montreal implementation counts both deals.
    const inMonth = await makeDeal({ organization_id: orgE, store_id: vRow.id, ...worksheet(3_000_000, 2_300_000) });
    await deliver(String(inMonth['id']));
    await admin.query(`UPDATE deals SET delivered_at = $2 WHERE id = $1`, [String(inMonth['id']), new Date(vanStart.getTime() + HOUR)]);
    const outMonth = await makeDeal({ organization_id: orgE, store_id: vRow.id, ...worksheet(3_000_000, 2_300_000) });
    await deliver(String(outMonth['id']));
    await admin.query(`UPDATE deals SET delivered_at = $2 WHERE id = $1`, [String(outMonth['id']), new Date(vanStart.getTime() - HOUR)]);

    const r = await report(orgE);
    expect(r.month.timezone).toBe(vRow.timezone);
    expect(r.month.start).toBe(vanStart.toISOString());
    expect(r.month_sales.units).toBe(1);
  });
});
