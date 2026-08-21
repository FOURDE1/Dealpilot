import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { buildApp } from './app.js';

/**
 * F-55 — win/loss analytics (reports-analytics.md §9). Fixtures arrive
 * through the product; admin SQL appears only for time travel (backdating a
 * lead out of the period window) and to simulate the SYSTEM loss path (the
 * STOP handler's raw status write — the 'unknown' reason bucket, D-055 #6).
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';

const WORKSHEET = {
  province: 'QC' as const,
  deal_type: 'finance' as const,
  sale_price_cents: 2_500_000,
  vehicle_cost_cents: 2_100_000,
  trade_allowance_cents: 0,
  trade_acv_cents: 0,
  trade_lien_cents: 0,
  rebate_cents: 0,
  fees_cents: 0,
  fees_taxable: false,
  fi_price_cents: 0,
  fi_cost_cents: 0,
  interest_rate_bps: 599,
  term_months: 60,
};

let admin: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookie = '';
let salesCookie = '';
let orgId = '';
let storeId = '';

function cookiesOf(res: { headers: Record<string, unknown> }): string {
  const sc = res.headers['set-cookie'];
  return (Array.isArray(sc) ? sc : [sc!]).map((c) => String(c).split(';')[0]).join('; ');
}

async function makeLead(n: number, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await app!.inject({
    method: 'POST', url: '/api/v1/leads', headers: { cookie },
    payload: {
      organization_id: orgId, store_id: storeId, source: 'walk_in',
      first_name: `Client${n}`, last_name: `Essai${n}`, phone: `+1514555${String(8000 + n)}`,
      ...extra,
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (JSON.parse(res.body) as { id: string }).id;
}

async function loseLead(id: string, reasonName: string): Promise<void> {
  const reasons = await app!.inject({
    method: 'GET', url: `/api/v1/lost-reasons?organization_id=${orgId}`, headers: { cookie },
  });
  const reason = (JSON.parse(reasons.body) as { items: { id: string; name: string }[] }).items
    .find((r) => r.name === reasonName)!;
  const res = await app!.inject({
    method: 'PATCH', url: `/api/v1/leads/${id}`, headers: { cookie },
    payload: { status: 'lost', lost_reason_id: reason.id },
  });
  expect(res.statusCode, res.body).toBe(200);
}

interface Report {
  summary: { total: number; won: number; lost: number; open: number; win_rate: number | null; loss_rate: number | null };
  lost_reasons: { name: string; name_fr: string; count: number; percentage: number }[];
  monthly_trend: { month: string; won: number; lost: number }[];
  source_performance: { source: string; total: number; won: number }[];
}

async function report(qs = '', c = cookie): Promise<{ status: number; body: Report }> {
  const res = await app!.inject({
    method: 'GET', url: `/api/v1/analytics/win-loss?organization_id=${orgId}${qs}`, headers: { cookie: c },
  });
  return { status: res.statusCode, body: JSON.parse(res.body) as Report };
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

  const owner = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f55-${run}@dealpilot.test`, password: PASSWORD, name: 'Patron Rapports' },
  });
  cookie = cookiesOf(owner);
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe Rapports', slug: `groupe-rapports-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Rapports Laval', code: 'RPLV', province: 'QC', timezone: 'America/Toronto', business_hours: {}, holiday_dates: [] },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;

  // A salesperson: allowed to work leads, NOT to read the business's numbers.
  const sales = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f55-s-${run}@dealpilot.test`, password: PASSWORD, name: 'Vendeur Rapports' },
  });
  salesCookie = cookiesOf(sales);
  const added = await app!.inject({
    method: 'POST', url: '/api/v1/members', headers: { cookie },
    payload: { organization_id: orgId, email: `f55-s-${run}@dealpilot.test`, name: 'Vendeur Rapports', roles: ['salesperson'] },
  });
  expect(added.statusCode, added.body).toBe(201);

  // The funnel: 1 converted-by-status, 1 won-by-deal, 3 lost (2 price, 1
  // system/no-reason), 1 open, 1 outside the 30d window (lost, bad timing).
  const byStatus = await makeLead(1);
  await app!.inject({
    method: 'PATCH', url: `/api/v1/leads/${byStatus}`, headers: { cookie },
    payload: { status: 'qualified' },
  });
  const deal = await app!.inject({
    method: 'POST', url: '/api/v1/deals', headers: { cookie },
    payload: { organization_id: orgId, store_id: storeId, lead_id: byStatus, ...WORKSHEET },
  });
  expect(deal.statusCode, deal.body).toBe(201);

  const wonByDeal = await makeLead(2, { source: 'website' });
  // Simulate the pre-§12 gap: a deal exists but status never moved — the
  // classifier must still count it won. Deal-create now stamps converted,
  // so wind the STATUS back the way legacy data would look.
  const deal2 = await app!.inject({
    method: 'POST', url: '/api/v1/deals', headers: { cookie },
    payload: { organization_id: orgId, store_id: storeId, lead_id: wonByDeal, ...WORKSHEET },
  });
  expect(deal2.statusCode, deal2.body).toBe(201);
  await admin.query(`UPDATE leads SET status = 'contacted' WHERE id = $1`, [wonByDeal]);

  await loseLead(await makeLead(3), 'Price too high');
  await loseLead(await makeLead(4), 'Price too high');
  // The system path (STOP): raw status write, no reason — f18's exact shape.
  const sysLost = await makeLead(5);
  await admin.query(`UPDATE leads SET status = 'lost' WHERE id = $1`, [sysLost]);

  await makeLead(6); // open

  const outside = await makeLead(7);
  await loseLead(outside, 'Bad timing');
  await admin.query(`UPDATE leads SET created_at = now() - interval '60 days' WHERE id = $1`, [outside]);
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('win/loss analytics (F-55, reports-analytics.md §9)', () => {
  it('a deal born from a lead converts it in the same transaction (leads.md §12 step 4)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const r = await report();
    // byStatus was PATCHed to qualified, then desked: the deal stamped it.
    expect(r.body.summary.won).toBeGreaterThanOrEqual(2);
  });

  it('classifies the funnel: deal-carrying leads are won whatever their status; open leads sit in no denominator', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const { status, body } = await report();
    expect(status).toBe(200);
    expect(body.summary.total).toBe(7);
    expect(body.summary.won).toBe(2);
    expect(body.summary.lost).toBe(4);
    expect(body.summary.open).toBe(1);
    // 2 won / 6 decided = 33.3; loss is its OWN quotient (4/6), never 100-33.3
    expect(body.summary.win_rate).toBe(33.3);
    expect(body.summary.loss_rate).toBe(66.7);
  });

  it("lost reasons aggregate bilingually, sorted, with the reason-less system loss under 'unknown'", async (ctx) => {
    if (!dbUp) return ctx.skip();
    const { body } = await report();
    expect(body.lost_reasons[0]).toMatchObject({ name: 'Price too high', name_fr: 'Prix trop élevé', count: 2, percentage: 50 });
    expect(body.lost_reasons.find((r) => r.name === 'unknown')?.count).toBe(1);
  });

  it('the period window filters by creation date — 30d hides the 60-day-old loss', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const all = await report('&period=all');
    expect(all.body.summary.total).toBe(7);
    const month = await report('&period=30d');
    expect(month.body.summary.total).toBe(6);
    expect(month.body.lost_reasons.some((r) => r.name === 'Bad timing')).toBe(false);
  });

  it('per-source performance splits walk-in from website', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const { body } = await report();
    const website = body.source_performance.find((x) => x.source === 'website')!;
    expect(website).toMatchObject({ total: 1, won: 1 });
  });

  it("a salesperson is refused: the business's aggregate numbers are manager authority (report:view)", async (ctx) => {
    if (!dbUp) return ctx.skip();
    const { status } = await report('', salesCookie);
    expect(status).toBe(403);
  });
});
