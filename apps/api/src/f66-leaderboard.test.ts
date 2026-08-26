import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { LeaderboardReport } from '@dealpilot/schemas';
import { buildApp } from './app.js';

/**
 * F-66 — the leaderboard. Golden numbers over real FKs: two salespeople,
 * known deals and leads, every metric computed once by hand.
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
let anneId = '';
let benId = '';

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

async function member(email: string, name: string, roles: string[]): Promise<string> {
  const su = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email, password: PASSWORD, name },
  });
  if (email.includes('-s-')) salesCookie = cookiesOf(su);
  const added = await app!.inject({
    method: 'POST', url: '/api/v1/members', headers: { cookie },
    payload: { organization_id: orgId, email, name, roles },
  });
  expect(added.statusCode, added.body).toBe(201);
  return (await admin.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email])).rows[0]!.id;
}

async function lead(n: number, assignedTo: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await app!.inject({
    method: 'POST', url: '/api/v1/leads', headers: { cookie },
    payload: {
      organization_id: orgId, store_id: storeId, source: 'website',
      first_name: `Classe${n}`, phone: `+1514555${String(9700 + n)}`,
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  const id = (JSON.parse(res.body) as { id: string }).id;
  await admin.query(`UPDATE leads SET assigned_to = $2 WHERE id = $1`, [id, assignedTo]);
  for (const [k, v] of Object.entries(extra)) {
    await admin.query(`UPDATE leads SET ${k} = $2 WHERE id = $1`, [id, v]);
  }
  return id;
}

async function deal(leadId: string, salespersonId: string, stage: string, gross: number, fi: number): Promise<void> {
  const res = await app!.inject({
    method: 'POST', url: '/api/v1/deals', headers: { cookie },
    payload: { organization_id: orgId, store_id: storeId, lead_id: leadId, ...WORKSHEET },
  });
  expect(res.statusCode, res.body).toBe(201);
  const id = (JSON.parse(res.body) as { id: string }).id;
  await admin.query(
    `UPDATE deals SET salesperson_id = $2, pipeline_stage = $3, total_gross_cents = $4, fi_reserve_cents = $5
     WHERE id = $1`,
    [id, salespersonId, stage, gross, fi],
  );
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
    payload: { email: `f66-${run}@dealpilot.test`, password: PASSWORD, name: 'Patron Podium' },
  });
  cookie = cookiesOf(owner);
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe Podium', slug: `groupe-podium-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Podium Laval', code: 'PDLV', province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;

  anneId = await member(`f66-s-anne-${run}@dealpilot.test`, 'Anne Vendeuse', ['salesperson']);
  benId = await member(`f66-ben-${run}@dealpilot.test`, 'Ben Vendeur', ['salesperson']);

  // Anne: 2 deals (1 delivered $25k / gross $4k / F&I $500), 4 leads.
  // BOTH deal-carrying leads flip to converted at deal creation (F-05's
  // rule, stage-independent), one is lost → exactly ONE active.
  const a1 = await lead(1, anneId, {});
  await admin.query(
    `UPDATE leads SET first_contacted_at = now(), contact_attempts = 1, response_time_seconds = 120 WHERE id = $1`, [a1],
  );
  await deal(a1, anneId, 'delivered', 400_000, 50_000);
  const a2 = await lead(2, anneId, {});
  await admin.query(
    `UPDATE leads SET first_contacted_at = now(), contact_attempts = 1, response_time_seconds = 240 WHERE id = $1`, [a2],
  );
  await deal(a2, anneId, 'submitted', 0, 0);
  await lead(3, anneId, {});
  const a4 = await lead(4, anneId, {});
  await admin.query(`UPDATE leads SET status = 'lost' WHERE id = $1`, [a4]);

  // Ben: 1 delivered deal, gross $6k, F&I $1k; 1 lead; no response stamps.
  const b1 = await lead(5, benId, {});
  await deal(b1, benId, 'complete', 600_000, 100_000);
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

async function report(qs = 'period=90d'): Promise<ReturnType<typeof LeaderboardReport.parse>> {
  const res = await app!.inject({
    method: 'GET', url: `/api/v1/analytics/leaderboard?organization_id=${orgId}&${qs}`, headers: { cookie },
  });
  expect(res.statusCode, res.body).toBe(200);
  return LeaderboardReport.parse(JSON.parse(res.body));
}

describe('salesperson leaderboard (F-66, §10) — golden numbers', () => {
  it('ranks by delivered gross by default, with every metric hand-checked', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const r = await report();
    expect(r.rows.map((x) => x.name)).toEqual(['Ben Vendeur', 'Anne Vendeuse']);

    const ben = r.rows[0]!;
    expect(ben).toMatchObject({
      deals: 1, closed_deals: 1, total_sales_cents: 2_500_000,
      gross_profit_cents: 600_000, fi_reserve_cents: 100_000,
      total_leads: 1, active_leads: 0, conversion_rate: 100, avg_response_seconds: null,
    });

    const anne = r.rows[1]!;
    expect(anne).toMatchObject({
      deals: 2, closed_deals: 1, total_sales_cents: 2_500_000,
      gross_profit_cents: 400_000, fi_reserve_cents: 50_000,
      total_leads: 4, active_leads: 1,
      // 1 delivered / 4 leads = 25%; (120+240)/2 = 180s.
      conversion_rate: 25, avg_response_seconds: 180,
    });
  });

  it('the sorts reorder honestly — response puts the never-responded last', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const byResponse = await report('period=90d&sort=response');
    expect(byResponse.rows.map((x) => x.name)).toEqual(['Anne Vendeuse', 'Ben Vendeur']);
    const byLeads = await report('period=90d&sort=leads');
    expect(byLeads.rows[0]!.name).toBe('Anne Vendeuse');
  });

  it('ties break deterministically — the medal cannot swap between refreshes', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Two fresh reps tied at zero everything: alphabetical order must hold
    // on every request.
    await member(`f66-zoe-${run}@dealpilot.test`, 'Zoé Égalité', ['salesperson']).then((id) =>
      lead(20, id),
    );
    await member(`f66-carl-${run}@dealpilot.test`, 'Carl Égalité', ['salesperson']).then((id) =>
      lead(21, id),
    );
    const first = await report('period=90d&sort=gross');
    const second = await report('period=90d&sort=gross');
    const tied = (r: Awaited<ReturnType<typeof report>>) =>
      r.rows.filter((x) => x.name.includes('Égalité')).map((x) => x.name);
    expect(tied(first)).toEqual(['Carl Égalité', 'Zoé Égalité']);
    expect(tied(second)).toEqual(tied(first));
  });

  it('a delivery counts in the month it HAPPENED — January paperwork, August car (review)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const old = await lead(20, benId, {});
    await deal(old, benId, 'delivered', 900_000, 0);
    // The deal was opened 200 days ago but delivered now.
    await admin.query(
      `UPDATE deals SET created_at = now() - interval '200 days', delivered_at = now()
       WHERE lead_id = $1`,
      [old],
    );
    const r = await report('period=30d');
    const ben = r.rows.find((x) => x.user_id === benId)!;
    // Gross from that delivery lands in the 30d window; the deal itself (opened
    // 200 days ago) does not inflate this month's deal COUNT.
    expect(ben.gross_profit_cents).toBeGreaterThanOrEqual(900_000);
    expect(ben.closed_deals).toBeGreaterThanOrEqual(2);
  });

  it('a store-bound manager ranks THEIR store only; a foreign store_id is a 404 (F-55 scope)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const email = `f66-m-${run}@dealpilot.test`;
    const su = await app!.inject({
      method: 'POST', url: '/api/auth/sign-up/email',
      payload: { email, password: PASSWORD, name: 'Gérant Borné' },
    });
    const mgrCookie = cookiesOf(su);
    const added = await app!.inject({
      method: 'POST', url: '/api/v1/members', headers: { cookie },
      payload: { organization_id: orgId, email, name: 'Gérant Borné', roles: ['sales_manager'] },
    });
    expect(added.statusCode, added.body).toBe(201);
    const other = await app!.inject({
      method: 'POST', url: '/api/v1/stores', headers: { cookie },
      payload: { organization_id: orgId, name: 'Podium Nord', code: 'PDNO', province: 'QC' },
    });
    const otherStoreId = (JSON.parse(other.body) as { id: string }).id;
    await admin.query(
      `UPDATE memberships SET store_id = $3
       WHERE organization_id = $1 AND user_id = (SELECT id FROM users WHERE email = $2)`,
      [orgId, email, otherStoreId],
    );
    // One lead in the bound store, assigned to Ben.
    const there = await lead(21, benId, {});
    await admin.query(`UPDATE leads SET store_id = $2 WHERE id = $1`, [there, otherStoreId]);

    const scoped = await app!.inject({
      method: 'GET', url: `/api/v1/analytics/leaderboard?organization_id=${orgId}&period=90d`, headers: { cookie: mgrCookie },
    });
    expect(scoped.statusCode, scoped.body).toBe(200);
    const rows = LeaderboardReport.parse(JSON.parse(scoped.body)).rows;
    // Only Ben appears (one lead there), with none of the main store's deals.
    expect(rows.map((x) => x.user_id)).toEqual([benId]);
    expect(rows[0]).toMatchObject({ total_leads: 1, deals: 0 });

    const foreign = await app!.inject({
      method: 'GET',
      url: `/api/v1/analytics/leaderboard?organization_id=${orgId}&period=90d&store_id=${storeId}`,
      headers: { cookie: mgrCookie },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it("a deal cannot carry a salesperson who is not a member here — and a stranger never ranks (review)", async (ctx) => {
    if (!dbUp) return ctx.skip();
    // A user who exists in the system but belongs to nobody here.
    const stranger = await app!.inject({
      method: 'POST', url: '/api/auth/sign-up/email',
      payload: { email: `f66-x-${run}@dealpilot.test`, password: PASSWORD, name: 'Étranger Rival' },
    });
    expect(stranger.statusCode).toBe(200);
    // A REAL stranger: a member of another dealer group (which is what gives
    // them a domain users row for the FK to accept).
    const rivalOrg = await app!.inject({
      method: 'POST', url: '/api/v1/organizations', headers: { cookie: cookiesOf(stranger) },
      payload: { name: 'Groupe Rival', slug: `groupe-rival-${run}` },
    });
    expect(rivalOrg.statusCode, rivalOrg.body).toBe(201);
    const strangerId = (
      await admin.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [`f66-x-${run}@dealpilot.test`])
    ).rows[0]!.id;
    const victim = await lead(22, anneId, {});
    const created = await app!.inject({
      method: 'POST', url: '/api/v1/deals', headers: { cookie },
      payload: { organization_id: orgId, store_id: storeId, lead_id: victim, ...WORKSHEET },
    });
    const dealId = (JSON.parse(created.body) as { id: string }).id;
    const patched = await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}`, headers: { cookie },
      payload: { salesperson_id: strangerId },
    });
    expect(patched.statusCode, patched.body).toBe(422);
    expect(patched.body).toContain('not_a_member');

    // Even a row smuggled in past the API (raw SQL) never surfaces a name.
    await admin.query(`UPDATE deals SET salesperson_id = $2 WHERE id = $1`, [dealId, strangerId]);
    const r = await report('period=90d');
    expect(r.rows.find((x) => x.user_id === strangerId)).toBeUndefined();
    expect(r.rows.some((x) => x.name === 'Étranger Rival')).toBe(false);
  });

  it('a salesperson is refused — rankings over money are manager material', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'GET', url: `/api/v1/analytics/leaderboard?organization_id=${orgId}`, headers: { cookie: salesCookie },
    });
    expect(res.statusCode, res.body).toBe(403);
  });
});
