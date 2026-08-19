import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { buildApp } from './app.js';

/**
 * F-40 — the assignment engine behind the API.
 *
 * The rotation math is golden-tested in @dealpilot/core (13 cases); what this
 * suite proves is the plumbing: a lead is ROUTED at birth, the auto path never
 * takes a lead off somebody, every refusal is a named value, the audit row is
 * written, and none of it reaches across tenants.
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
let userId = '';

let seq = 600;
function nextPhone(): string {
  seq += 1;
  return `+1514555${String(seq).padStart(4, '0')}`;
}

function makeRule(payload: Record<string, unknown>, who = cookie) {
  return app!.inject({
    method: 'POST', url: '/api/v1/assignment-rules', headers: { cookie: who },
    payload: { organization_id: orgId, ...payload },
  });
}

function makeLead(payload: Record<string, unknown> = {}) {
  return app!.inject({
    method: 'POST', url: '/api/v1/leads', headers: { cookie },
    payload: { organization_id: orgId, store_id: storeId, phone: nextPhone(), source: 'walk_in', ...payload },
  });
}

async function clearRules() {
  await admin.query(`DELETE FROM lead_assignment_rules WHERE organization_id = $1`, [orgId]);
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
    payload: { email: `f40-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Rita Routage' },
  });
  const sc = su.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe F40', slug: `groupe-f40-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Routage', code: `F40-${run.slice(-4)}`, province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;
  const me = await app!.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
  userId = (JSON.parse(me.body) as { user: { id: string } }).user.id;

  const rival = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f40-rival-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Rival' },
  });
  const rsc = rival.headers['set-cookie'];
  rivalCookie = (Array.isArray(rsc) ? rsc : [rsc!]).map((c) => c!.split(';')[0]).join('; ');
  const rivalOrg = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie: rivalCookie },
    payload: { name: 'Rival F40', slug: `rival-f40-${run}` },
  });
  expect(rivalOrg.statusCode, rivalOrg.body).toBe(201);
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('routed at birth (§7.2)', () => {
  it('with no rules, a lead is born unassigned — the engine changes nothing until asked', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await clearRules();
    const lead = JSON.parse((await makeLead()).body) as { assigned_to: string | null; status: string };
    expect(lead.assigned_to).toBeNull();
    expect(lead.status).toBe('new');
  });

  it('a catch-all round_robin rule assigns the new lead and bumps new → assigned', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await clearRules();
    const rule = await makeRule({ name: 'Tour de rôle' });
    expect(rule.statusCode, rule.body).toBe(201);

    const res = await makeLead();
    const lead = JSON.parse(res.body) as { id: string; assigned_to: string | null; status: string; assigned_at: string | null };
    expect(lead.assigned_to).toBe(userId);
    expect(lead.status).toBe('assigned');
    expect(lead.assigned_at).not.toBeNull();

    // The audit says WHO decided: the rule, by name and strategy.
    const history = await admin.query<{ rule_name: string; strategy: string; lead_source: string }>(
      `SELECT rule_name, strategy, lead_source FROM lead_assignment_history WHERE lead_id = $1`,
      [lead.id],
    );
    expect(history.rows[0]).toMatchObject({ rule_name: 'Tour de rôle', strategy: 'round_robin', lead_source: 'walk_in' });
  });

  it('a source-scoped rule ignores other sources', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await clearRules();
    await makeRule({ name: 'Web seulement', sources: ['web'] });
    const lead = JSON.parse((await makeLead({ source: 'walk_in' })).body) as { assigned_to: string | null };
    expect(lead.assigned_to).toBeNull();
  });
});

describe('the named refusals', () => {
  it('already_assigned: the auto path never takes a lead off somebody', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await clearRules();
    await makeRule({ name: 'Rotation' });
    const lead = JSON.parse((await makeLead()).body) as { id: string; assigned_to: string };
    expect(lead.assigned_to).toBe(userId);

    const again = await app!.inject({
      method: 'POST', url: `/api/v1/leads/${lead.id}/assign`, headers: { cookie },
    });
    expect(again.statusCode, again.body).toBe(200);
    expect(JSON.parse(again.body)).toMatchObject({ outcome: 'already_assigned', lead_id: lead.id });
  });

  it('all_at_capacity: the cap counts ACTIVE leads and refuses by name', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await clearRules();
    await makeRule({ name: 'Plafond serré', max_leads_per_user: 1 });

    // The sole member already carries active leads from the cases above, so the
    // very first attempt hits the cap — which is the point.
    const lead = JSON.parse((await makeLead()).body) as { id: string; assigned_to: string | null };
    expect(lead.assigned_to).toBeNull();

    const res = await app!.inject({
      method: 'POST', url: `/api/v1/leads/${lead.id}/assign`, headers: { cookie },
    });
    expect(JSON.parse(res.body)).toMatchObject({ outcome: 'all_at_capacity' });
  });

  it('no_eligible_users: excluding the whole roster is its own answer', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await clearRules();
    await makeRule({ name: 'Personne', excluded_users: [userId] });
    const lead = JSON.parse((await makeLead()).body) as { id: string };
    const res = await app!.inject({
      method: 'POST', url: `/api/v1/leads/${lead.id}/assign`, headers: { cookie },
    });
    expect(JSON.parse(res.body)).toMatchObject({ outcome: 'no_eligible_users' });
  });
});

describe('another dealership (all three 0046 tables)', () => {
  it('cannot see, edit, delete our rules, or assign our leads', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await clearRules();
    const rule = JSON.parse((await makeRule({ name: 'Privée' })).body) as { id: string };
    const lead = JSON.parse((await makeLead({ source: 'referral' })).body) as { id: string };

    const list = await app!.inject({
      method: 'GET', url: `/api/v1/assignment-rules?organization_id=${orgId}`, headers: { cookie: rivalCookie },
    });
    expect(list.statusCode).toBe(404);
    for (const attempt of [
      app!.inject({ method: 'PATCH', url: `/api/v1/assignment-rules/${rule.id}`, headers: { cookie: rivalCookie }, payload: { priority: 999 } }),
      app!.inject({ method: 'DELETE', url: `/api/v1/assignment-rules/${rule.id}`, headers: { cookie: rivalCookie } }),
      app!.inject({ method: 'POST', url: `/api/v1/leads/${lead.id}/assign`, headers: { cookie: rivalCookie } }),
    ]) {
      expect((await attempt).statusCode).toBe(404);
    }

    // And the audit trail they cannot rewrite even from inside: the app role
    // holds INSERT+SELECT only on history — same shape as activity_events.
    const grants = await admin.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_name = 'lead_assignment_history' AND grantee = 'dealpilot_app'`,
    );
    expect(grants.rows.map((g) => g.privilege_type).sort()).toEqual(['INSERT', 'SELECT']);
  });
});
