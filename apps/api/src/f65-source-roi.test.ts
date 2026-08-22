import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { SourceRoiReport } from '@dealpilot/schemas';
import { buildApp } from './app.js';

/**
 * F-65 — spend ledger + source ROI. Golden numbers throughout: money math
 * is a 90%+ path, and a percent computed once by hand is worth ten computed
 * twice by the same code under test.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';

let admin: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookie = '';
let salesCookie = '';
let orgId = '';
let storeId = '';

const THIS_MONTH = new Date().toISOString().slice(0, 7);

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
};

function cookiesOf(res: { headers: Record<string, unknown> }): string {
  const sc = res.headers['set-cookie'];
  return (Array.isArray(sc) ? sc : [sc!]).map((c) => String(c).split(';')[0]).join('; ');
}

async function makeLead(n: number, source: string): Promise<string> {
  const res = await app!.inject({
    method: 'POST', url: '/api/v1/leads', headers: { cookie },
    payload: {
      organization_id: orgId, store_id: storeId, source,
      first_name: `Roi${n}`, phone: `+1514555${String(9600 + n)}`,
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (JSON.parse(res.body) as { id: string }).id;
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
    payload: { email: `f65-${run}@dealpilot.test`, password: PASSWORD, name: 'Patron Rendement' },
  });
  cookie = cookiesOf(owner);
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe Rendement', slug: `groupe-rendement-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Rendement Laval', code: 'RDLV', province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;

  const sales = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f65-s-${run}@dealpilot.test`, password: PASSWORD, name: 'Vendeur Rendement' },
  });
  salesCookie = cookiesOf(sales);
  const added = await app!.inject({
    method: 'POST', url: '/api/v1/members', headers: { cookie },
    payload: { organization_id: orgId, email: `f65-s-${run}@dealpilot.test`, name: 'Vendeur Rendement', roles: ['salesperson'] },
  });
  expect(added.statusCode, added.body).toBe(201);

  // The funnel: website 3 leads / 1 converted (deal $25,000); meta 1 lead.
  await makeLead(1, 'website');
  await makeLead(2, 'website');
  const winner = await makeLead(3, 'website');
  const deal = await app!.inject({
    method: 'POST', url: '/api/v1/deals', headers: { cookie },
    payload: { organization_id: orgId, store_id: storeId, lead_id: winner, ...WORKSHEET },
  });
  expect(deal.statusCode, deal.body).toBe(201);
  await makeLead(4, 'meta_lead_form');
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('the spend ledger (F-65, §10)', () => {
  it('POST is an UPSERT: one row per source/month/store, re-posting overwrites', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const first = await app!.inject({
      method: 'POST', url: '/api/v1/source-costs', headers: { cookie },
      payload: { organization_id: orgId, source: 'website', month: THIS_MONTH, spend_cents: 40_000 },
    });
    expect(first.statusCode, first.body).toBe(201);
    const second = await app!.inject({
      method: 'POST', url: '/api/v1/source-costs', headers: { cookie },
      payload: { organization_id: orgId, source: 'website', month: THIS_MONTH, spend_cents: 50_000, notes: 'corrigé' },
    });
    expect(second.statusCode, second.body).toBe(201);

    const list = await app!.inject({
      method: 'GET', url: `/api/v1/source-costs?organization_id=${orgId}&source=website`, headers: { cookie },
    });
    const items = (JSON.parse(list.body) as { items: { spend_cents: number; notes: string | null; store_id: string | null }[] }).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ spend_cents: 50_000, notes: 'corrigé', store_id: null });
  });

  it('an org-wide row and a store row for the same source+month coexist — different scopes', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const storeRow = await app!.inject({
      method: 'POST', url: '/api/v1/source-costs', headers: { cookie },
      payload: { organization_id: orgId, store_id: storeId, source: 'chatbot', month: THIS_MONTH, spend_cents: 10_000 },
    });
    expect(storeRow.statusCode, storeRow.body).toBe(201);
    const orgRow = await app!.inject({
      method: 'POST', url: '/api/v1/source-costs', headers: { cookie },
      payload: { organization_id: orgId, source: 'chatbot', month: THIS_MONTH, spend_cents: 5_000 },
    });
    expect(orgRow.statusCode, orgRow.body).toBe(201);
    const list = await app!.inject({
      method: 'GET', url: `/api/v1/source-costs?organization_id=${orgId}&source=chatbot`, headers: { cookie },
    });
    expect((JSON.parse(list.body) as { items: unknown[] }).items).toHaveLength(2);
  });

  it('a spend row can be deleted — managers only, hard delete (§10)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const created = await app!.inject({
      method: 'POST', url: '/api/v1/source-costs', headers: { cookie },
      payload: { organization_id: orgId, source: 'referral', month: THIS_MONTH, spend_cents: 7_500 },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = (JSON.parse(created.body) as { id: string }).id;

    const refused = await app!.inject({
      method: 'DELETE', url: `/api/v1/source-costs/${id}`, headers: { cookie: salesCookie },
    });
    expect(refused.statusCode).toBe(403);

    const gone = await app!.inject({
      method: 'DELETE', url: `/api/v1/source-costs/${id}`, headers: { cookie },
    });
    expect(gone.statusCode, gone.body).toBe(204);
    const list = await app!.inject({
      method: 'GET', url: `/api/v1/source-costs?organization_id=${orgId}&source=referral`, headers: { cookie },
    });
    expect((JSON.parse(list.body) as { items: unknown[] }).items).toHaveLength(0);
  });

  it('a salesperson reads the ledger but cannot write it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const read = await app!.inject({
      method: 'GET', url: `/api/v1/source-costs?organization_id=${orgId}`, headers: { cookie: salesCookie },
    });
    expect(read.statusCode).toBe(200);
    const write = await app!.inject({
      method: 'POST', url: '/api/v1/source-costs', headers: { cookie: salesCookie },
      payload: { organization_id: orgId, source: 'website', month: THIS_MONTH, spend_cents: 1 },
    });
    expect(write.statusCode, write.body).toBe(403);
  });
});

describe('source ROI (F-65, §8) — golden numbers', () => {
  it('computes cost-per-lead, conversion and ROI per source, cents-native', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'GET', url: `/api/v1/analytics/source-roi?organization_id=${orgId}&period=90d`, headers: { cookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    const report = SourceRoiReport.parse(JSON.parse(res.body));

    const website = report.sources.find((s) => s.source === 'website')!;
    // spend $500.00, 3 leads, 1 converted at $25,000 gross.
    expect(website).toMatchObject({
      total_leads: 3,
      converted_leads: 1,
      total_revenue_cents: 2_500_000,
      spend_cents: 50_000,
      cost_per_lead_cents: 16_667,
      cost_per_conversion_cents: 50_000,
      conversion_rate: 33.3,
      roi: 4900,
    });

    // No spend recorded → ROI is NULL, not 0% — 0/0 is not a return.
    const meta = report.sources.find((s) => s.source === 'meta_lead_form')!;
    expect(meta).toMatchObject({ total_leads: 1, spend_cents: 0, roi: null });

    // chatbot: spend ($150 org+store) but zero leads still appears (§8.4).
    const chatbot = report.sources.find((s) => s.source === 'chatbot')!;
    expect(chatbot).toMatchObject({ total_leads: 0, spend_cents: 15_000, cost_per_lead_cents: 0, roi: -100 });

    expect(report.totals).toMatchObject({
      total_leads: 4,
      total_converted: 1,
      total_spend_cents: 65_000,
      total_revenue_cents: 2_500_000,
      avg_cost_per_lead_cents: 16_250,
      avg_conversion_rate: 25,
    });
    // (2,500,000 − 65,000) / 65,000 × 100 = 3746.2 (1dp)
    expect(report.totals.overall_roi).toBe(3746.2);

    const monthlyWebsite = report.monthly.find((m) => m.source === 'website' && m.month === THIS_MONTH)!;
    expect(monthlyWebsite).toMatchObject({ leads: 3, converted: 1, revenue_cents: 2_500_000, spend_cents: 50_000 });
  });

  it('the STORE view is strict: org-wide spend rows stay out of a store cut', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'GET',
      url: `/api/v1/analytics/source-roi?organization_id=${orgId}&period=90d&store_id=${storeId}`,
      headers: { cookie },
    });
    const report = SourceRoiReport.parse(JSON.parse(res.body));
    const chatbot = report.sources.find((s) => s.source === 'chatbot')!;
    expect(chatbot.spend_cents).toBe(10_000);
  });

  it("period=all is ALL — a lead from 200 days ago is out of 90d and in 'all' (review blocker)", async (ctx) => {
    if (!dbUp) return ctx.skip();
    const oldId = await makeLead(10, 'walk_in');
    await admin.query(`UPDATE leads SET created_at = now() - interval '200 days' WHERE id = $1`, [oldId]);

    const quarter = SourceRoiReport.parse(
      JSON.parse((await app!.inject({
        method: 'GET', url: `/api/v1/analytics/source-roi?organization_id=${orgId}&period=90d`, headers: { cookie },
      })).body),
    );
    expect(quarter.sources.find((s) => s.source === 'walk_in')).toBeUndefined();

    const all = SourceRoiReport.parse(
      JSON.parse((await app!.inject({
        method: 'GET', url: `/api/v1/analytics/source-roi?organization_id=${orgId}&period=all`, headers: { cookie },
      })).body),
    );
    expect(all.sources.find((s) => s.source === 'walk_in')).toMatchObject({ total_leads: 1 });
  });

  it("a lead whose deal exists counts as converted even if its STATUS drifted (F-55's WON clause)", async (ctx) => {
    if (!dbUp) return ctx.skip();
    const driftId = await makeLead(11, 'chatbot');
    const deal = await app!.inject({
      method: 'POST', url: '/api/v1/deals', headers: { cookie },
      payload: { organization_id: orgId, store_id: storeId, lead_id: driftId, ...WORKSHEET },
    });
    expect(deal.statusCode, deal.body).toBe(201);
    // The drift: status moved off 'converted' after the deal existed — the
    // two reports must still agree this lead is WON.
    await admin.query(`UPDATE leads SET status = 'qualified' WHERE id = $1`, [driftId]);

    const report = SourceRoiReport.parse(
      JSON.parse((await app!.inject({
        method: 'GET', url: `/api/v1/analytics/source-roi?organization_id=${orgId}&period=90d`, headers: { cookie },
      })).body),
    );
    const chatbotRow = report.sources.find((s) => s.source === 'chatbot')!;
    expect(chatbotRow.converted_leads).toBe(1);
    expect(chatbotRow.total_revenue_cents).toBe(2_500_000);
  });

  it('a store-bound manager sees THEIR store, and a foreign store_id is a 404 (F-55 scope)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const mgr = await app!.inject({
      method: 'POST', url: '/api/auth/sign-up/email',
      payload: { email: `f65-m-${run}@dealpilot.test`, password: PASSWORD, name: 'Gérant Borné' },
    });
    const mgrCookie = cookiesOf(mgr);
    const added = await app!.inject({
      method: 'POST', url: '/api/v1/members', headers: { cookie },
      payload: { organization_id: orgId, email: `f65-m-${run}@dealpilot.test`, name: 'Gérant Borné', roles: ['sales_manager'] },
    });
    expect(added.statusCode, added.body).toBe(201);
    const otherStore = await app!.inject({
      method: 'POST', url: '/api/v1/stores', headers: { cookie },
      payload: { organization_id: orgId, name: 'Rendement Nord', code: 'RDNO', province: 'QC' },
    });
    const otherStoreId = (JSON.parse(otherStore.body) as { id: string }).id;
    await admin.query(
      `UPDATE memberships SET store_id = $3
       WHERE organization_id = $1 AND user_id = (SELECT id FROM users WHERE email = $2)`,
      [orgId, `f65-m-${run}@dealpilot.test`, otherStoreId],
    );
    await makeLead(12, 'referral').then((id) =>
      admin.query(`UPDATE leads SET store_id = $2 WHERE id = $1`, [id, otherStoreId]),
    );

    const scoped = await app!.inject({
      method: 'GET', url: `/api/v1/analytics/source-roi?organization_id=${orgId}&period=90d`, headers: { cookie: mgrCookie },
    });
    expect(scoped.statusCode, scoped.body).toBe(200);
    const report = SourceRoiReport.parse(JSON.parse(scoped.body));
    // Only the bound store's lead is visible — the org's website funnel is not.
    expect(report.totals.total_leads).toBe(1);
    expect(report.sources.find((s) => s.source === 'referral')).toMatchObject({ total_leads: 1 });

    const foreign = await app!.inject({
      method: 'GET',
      url: `/api/v1/analytics/source-roi?organization_id=${orgId}&period=90d&store_id=${storeId}`,
      headers: { cookie: mgrCookie },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('the report is manager material — a salesperson is refused (report:view)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'GET', url: `/api/v1/analytics/source-roi?organization_id=${orgId}`, headers: { cookie: salesCookie },
    });
    expect(res.statusCode, res.body).toBe(403);
  });
});
