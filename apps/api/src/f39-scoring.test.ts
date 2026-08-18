import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { buildApp } from './app.js';

/**
 * F-39 — the scoring rules engine behind the API.
 *
 * The engine's math is golden-tested in @dealpilot/core; what this suite proves
 * is the plumbing the spec cares about: a lead is scored AT BIRTH on every
 * create path, the number the list shows (leads.score) and the why
 * (lead_scores.breakdown) move together, rules are an owner power, and none of
 * it leaks across tenants.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);

let admin: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookie = '';
let rivalCookie = '';
let orgId = '';
let storeId = '';

let seq = 400;
function nextPhone(): string {
  seq += 1;
  return `+1514555${String(seq).padStart(4, '0')}`;
}

function makeRule(payload: Record<string, unknown>, who = cookie) {
  return app!.inject({
    method: 'POST', url: '/api/v1/scoring-rules', headers: { cookie: who },
    payload: { organization_id: orgId, ...payload },
  });
}

function makeLead(payload: Record<string, unknown> = {}) {
  return app!.inject({
    method: 'POST', url: '/api/v1/leads', headers: { cookie },
    payload: { organization_id: orgId, store_id: storeId, phone: nextPhone(), source: 'walk_in', ...payload },
  });
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

  const su = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f39-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Solange' },
  });
  const sc = su.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe F39', slug: `groupe-f39-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Pointage', code: `F39-${run.slice(-4)}`, province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;

  const rival = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f39-rival-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Rival' },
  });
  const rsc = rival.headers['set-cookie'];
  rivalCookie = (Array.isArray(rsc) ? rsc : [rsc!]).map((c) => c!.split(';')[0]).join('; ');
  // The rival needs an org for active membership; its id is never used — every
  // cross-tenant probe names OUR org, which is the point.
  const rivalOrg = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie: rivalCookie },
    payload: { name: 'Rival F39', slug: `rival-f39-${run}` },
  });
  expect(rivalOrg.statusCode, rivalOrg.body).toBe(201);
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('rules', () => {
  it('creates one, and a comparison rule with no value is refused', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const ok = await makeRule({
      name: 'A un téléphone', field: 'has_phone', operator: 'exists', score: 10, priority: 100,
    });
    expect(ok.statusCode, ok.body).toBe(201);

    // The engine fails closed on a valueless comparison, so storing one would
    // store a rule that silently never fires.
    const bad = await makeRule({ name: 'Cassée', field: 'source', operator: 'eq', score: 5 });
    expect(bad.statusCode).toBe(422);
  });

  it('lists rules; soft-off via PATCH; hard delete removes', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const created = JSON.parse((await makeRule({
      name: 'Temporaire', field: 'has_email', operator: 'exists', score: 5,
    })).body) as { id: string };

    const off = await app!.inject({
      method: 'PATCH', url: `/api/v1/scoring-rules/${created.id}`, headers: { cookie },
      payload: { is_active: false },
    });
    expect(off.statusCode, off.body).toBe(200);
    expect((JSON.parse(off.body) as { is_active: boolean }).is_active).toBe(false);

    const gone = await app!.inject({
      method: 'DELETE', url: `/api/v1/scoring-rules/${created.id}`, headers: { cookie },
    });
    expect(gone.statusCode).toBe(204);
    const list = await app!.inject({
      method: 'GET', url: `/api/v1/scoring-rules?organization_id=${orgId}`, headers: { cookie },
    });
    const ids = (JSON.parse(list.body) as { items: { id: string }[] }).items.map((r) => r.id);
    expect(ids).not.toContain(created.id);
  });
});

describe('scored at birth (§6.2 triggers)', () => {
  it('a new lead carries its score in the create response', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // has_phone(+10) exists from the first test; add a budget rule in DOLLARS.
    await makeRule({ name: 'Budget sérieux', field: 'budget', operator: 'gte', value: '400', score: 20, priority: 90 });

    const res = await makeLead({ monthly_budget_cents: 45_000 });
    expect(res.statusCode, res.body).toBe(201);
    const lead = JSON.parse(res.body) as { id: string; score: number };
    // +10 (phone) +20 (budget $450 ≥ $400): the response, the column and the
    // cache all say 30 — the number the list shows IS the number the engine
    // computed, not a stale zero waiting for a button.
    expect(lead.score).toBe(30);

    const cache = await admin.query<{ score: number; breakdown: unknown[] }>(
      `SELECT score, breakdown FROM lead_scores WHERE lead_id = $1`, [lead.id],
    );
    expect(cache.rows[0]!.score).toBe(30);
    expect(cache.rows[0]!.breakdown).toHaveLength(2);
  });

  it('an inactive rule contributes nothing', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const noisy = JSON.parse((await makeRule({
      name: 'Bruit', field: 'source', operator: 'eq', value: 'walk_in', score: 50, priority: 10,
    })).body) as { id: string };
    await app!.inject({
      method: 'PATCH', url: `/api/v1/scoring-rules/${noisy.id}`, headers: { cookie },
      payload: { is_active: false },
    });
    const res = await makeLead({ monthly_budget_cents: 45_000 });
    expect((JSON.parse(res.body) as { score: number }).score).toBe(30);
  });

  it('a store-scoped rule reaches only its store', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const other = await app!.inject({
      method: 'POST', url: '/api/v1/stores', headers: { cookie },
      payload: { organization_id: orgId, name: 'Autre toit', code: `F39B-${run.slice(-4)}`, province: 'QC' },
    });
    const otherStoreId = (JSON.parse(other.body) as { id: string }).id;
    await makeRule({
      name: 'Bonus du toit', field: 'has_phone', operator: 'exists', score: 5,
      priority: 80, store_id: otherStoreId,
    });

    const home = JSON.parse((await makeLead({ monthly_budget_cents: 45_000 })).body) as { score: number };
    const away = JSON.parse((await makeLead({ store_id: otherStoreId, monthly_budget_cents: 45_000 })).body) as { score: number };
    expect(home.score).toBe(30);
    expect(away.score).toBe(35);
  });

  it('recalculates on demand and reports the why', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const lead = JSON.parse((await makeLead()).body) as { id: string; score: number };
    expect(lead.score).toBe(10); // has_phone only — no budget on this one

    const res = await app!.inject({
      method: 'POST', url: `/api/v1/leads/${lead.id}/score`, headers: { cookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = JSON.parse(res.body) as { score: number; band: string; breakdown: { rule_name: string }[] };
    expect(body.score).toBe(10);
    expect(body.band).toBe('cold');
    expect(body.breakdown.map((b) => b.rule_name)).toContain('A un téléphone');
  });
});

describe('another dealership (lead_scoring_rules + lead_scores)', () => {
  it('cannot read, edit, delete or even find our rules', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const rule = JSON.parse((await makeRule({
      name: 'Secrète', field: 'has_email', operator: 'exists', score: 5,
    })).body) as { id: string };

    const list = await app!.inject({
      method: 'GET', url: `/api/v1/scoring-rules?organization_id=${orgId}`, headers: { cookie: rivalCookie },
    });
    expect(list.statusCode).toBe(404);

    for (const attempt of [
      app!.inject({ method: 'PATCH', url: `/api/v1/scoring-rules/${rule.id}`, headers: { cookie: rivalCookie }, payload: { score: 100 } }),
      app!.inject({ method: 'DELETE', url: `/api/v1/scoring-rules/${rule.id}`, headers: { cookie: rivalCookie } }),
    ]) {
      expect((await attempt).statusCode).toBe(404);
    }
  });

  it('cannot reach our lead scores through the recalc endpoint', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const lead = JSON.parse((await makeLead()).body) as { id: string };
    const res = await app!.inject({
      method: 'POST', url: `/api/v1/leads/${lead.id}/score`, headers: { cookie: rivalCookie },
    });
    expect(res.statusCode).toBe(404);
    // And their own org's rule create cannot name OUR org.
    const cross = await makeRule({ name: 'Intrusion', field: 'has_phone', operator: 'exists', score: 99 }, rivalCookie);
    expect([403, 404]).toContain(cross.statusCode);
  });
});
