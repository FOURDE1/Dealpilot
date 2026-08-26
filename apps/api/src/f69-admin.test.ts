import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import {
  AdminMeResponse,
  AdminTenantDetail,
  AdminTenantEventsResponse,
  AdminTenantPage,
  OrganizationStatus,
  PlanList,
  PlatformStaffList,
  TenantStatusChangeResult,
} from '@dealpilot/schemas';
import { apiV1 } from '@dealpilot/contracts';
import { TENANT_TRANSITIONS } from '@dealpilot/core';
import { buildApp } from './app.js';
import { enrol, signInWithTotp } from './testing/totp.js';

/**
 * F-69 — the platform console, slice 1. What is worth proving:
 *  - the gate: non-staff learn nothing (404), unenrolled staff are walled,
 *    a console session expires on its own clock, trustDevice is refused;
 *  - the directory and detail never leak customer data and respect the
 *    capability matrix;
 *  - the lifecycle matrix is enforced by the DATABASE, suspension revokes
 *    sessions and closes intake, read_only turns writes into 402;
 *  - staff management keeps one super admin and revokes immediately.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';

let admin: Pool;
let appPool: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;

// Tenants
let ownerA = ''; let orgA = ''; let storeA = ''; let ownerAEmail = '';
let ownerB = ''; let orgB = ''; let storeB = ''; let ownerBEmail = '';
let colleague = ''; let colleagueEmail = '';
// Staff
let superCookie = ''; let superEmail = ''; let superSecret = ''; let superId = '';
let supportCookie = ''; let supportEmail = '';
let billingCookie = ''; let billingEmail = '';

function cookiesOf(res: { headers: Record<string, unknown> }): string {
  const sc = res.headers['set-cookie'];
  const list = Array.isArray(sc) ? sc : sc ? [String(sc)] : [];
  return list.map((c) => String(c).split(';')[0] ?? '').filter((c) => c !== '' && !c.endsWith('=')).join('; ');
}

async function signUp(email: string, name: string): Promise<string> {
  const res = await app!.inject({ method: 'POST', url: '/api/auth/sign-up/email', payload: { email, password: PASSWORD, name } });
  expect(res.statusCode, res.body).toBe(200);
  return cookiesOf(res);
}

async function signIn(email: string): Promise<string> {
  const res = await app!.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email, password: PASSWORD } });
  expect(res.statusCode, res.body).toBe(200);
  return cookiesOf(res);
}

async function userId(email: string): Promise<string> {
  return (await admin.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [email])).rows[0]!.id;
}

async function org(cookie: string, name: string, slug: string): Promise<{ orgId: string; storeId: string }> {
  const o = await app!.inject({ method: 'POST', url: '/api/v1/organizations', headers: { cookie }, payload: { name, slug } });
  expect(o.statusCode, o.body).toBe(201);
  const orgId = (JSON.parse(o.body) as { id: string }).id;
  const s = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: `${name} Laval`, code: slug.slice(0, 4).toUpperCase(), province: 'QC' },
  });
  expect(s.statusCode, s.body).toBe(201);
  return { orgId, storeId: (JSON.parse(s.body) as { id: string }).id };
}

/** Grant + enrol + sign in through TOTP: a console-ready staffer. */
async function staffer(email: string, name: string, role: string, actor: string | null): Promise<{ cookie: string; secret: string }> {
  const first = await signUp(email, name);
  const g = await admin.query('SELECT * FROM platform_staff_grant($1, $2, $3, $4)', [actor, email, role, 'test fixture']);
  expect(g.rows).toHaveLength(1);
  const { secret } = await enrol(app!, first, PASSWORD);
  const cookie = await signInWithTotp(app!, email, PASSWORD, secret);
  return { cookie, secret };
}

async function adminGet(url: string, cookie = superCookie) {
  return app!.inject({ method: 'GET', url, headers: { cookie } });
}

async function setStatus(id: string, body: Record<string, unknown>, cookie = superCookie) {
  return app!.inject({ method: 'POST', url: `/api/v1/admin/tenants/${id}/status`, headers: { cookie }, payload: body });
}

/** Put an org in a status directly (fixture only — the API is what is under test). */
async function forceStatus(orgId: string, status: string): Promise<void> {
  await admin.query(
    `UPDATE organizations SET status = $2, suspended_at = CASE WHEN $2 = 'suspended' THEN now() ELSE suspended_at END WHERE id = $1`,
    [orgId, status],
  );
}

function sign(ts: string, body: string, key: string): string {
  return `v1=${createHmac('sha256', key).update(`${ts}.${body}`).digest('hex')}`;
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
  appPool = createPool({ connectionString: APP_URL, max: 2 });
  // This suite signs up and signs in a dozen accounts through TOTP in a few
  // seconds — far past the per-IP credential budget (F-44). The limiter is
  // its own suite's concern; here it is injected open.
  ({ app } = await buildApp(
    { DATABASE_URL: APP_URL, NODE_ENV: 'test' },
    { rateLimiter: { take: async () => ({ allowed: true, retryAfterS: 0 }), close: async () => {} } },
  ));

  ownerAEmail = `f69-a-${run}@dealpilot.test`;
  ownerA = await signUp(ownerAEmail, 'Patronne A');
  ({ orgId: orgA, storeId: storeA } = await org(ownerA, 'Groupe Alpha', `groupe-alpha-${run}`));
  ownerBEmail = `f69-b-${run}@dealpilot.test`;
  ownerB = await signUp(ownerBEmail, 'Patron B');
  ({ orgId: orgB, storeId: storeB } = await org(ownerB, 'Groupe Beta', `groupe-beta-${run}`));
  colleagueEmail = `f69-c-${run}@dealpilot.test`;
  colleague = await signUp(colleagueEmail, 'Collègue');
  for (const [cookie, orgId] of [[ownerA, orgA], [ownerB, orgB]] as const) {
    const added = await app!.inject({
      method: 'POST', url: '/api/v1/members', headers: { cookie },
      payload: { organization_id: orgId, email: colleagueEmail, name: 'Collègue', roles: ['salesperson'] },
    });
    expect(added.statusCode, added.body).toBe(201);
  }

  superEmail = `f69-super-${run}@dealpilot.test`;
  ({ cookie: superCookie, secret: superSecret } = await staffer(superEmail, 'Super Admin', 'platform_super_admin', null));
  superId = await userId(superEmail);
  supportEmail = `f69-support-${run}@dealpilot.test`;
  ({ cookie: supportCookie } = await staffer(supportEmail, 'Soutien', 'platform_support', superId));
  billingEmail = `f69-billing-${run}@dealpilot.test`;
  ({ cookie: billingCookie } = await staffer(billingEmail, 'Facturation', 'platform_billing', superId));
});

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await admin?.end();
});

function contractPaths(node: unknown, found: { method: string; path: string }[] = []): { method: string; path: string }[] {
  if (!node || typeof node !== 'object') return found;
  const record = node as Record<string, unknown>;
  if (typeof record['path'] === 'string' && typeof record['method'] === 'string') {
    found.push({ method: String(record['method']), path: String(record['path']) });
    return found;
  }
  for (const value of Object.values(record)) contractPaths(value, found);
  return found;
}

describe('the platform gate (F-69, admin-console.md §2)', () => {
  it('no session → 401; a tenant owner → 404 on EVERY admin path, never 403', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const anon = await app!.inject({ method: 'GET', url: '/api/v1/admin/me' });
    expect(anon.statusCode).toBe(401);
    for (const { method, path } of contractPaths(apiV1.admin)) {
      const url = path.replace(/:id/g, orgA).replace(/:userId/g, superId);
      const res = await app!.inject({
        method: method as 'GET', url, headers: { cookie: ownerA },
        ...(method === 'GET' || method === 'DELETE' ? {} : { payload: {} }),
      });
      expect(res.statusCode, `${method} ${path} → ${res.body}`).toBe(404);
    }
  });

  it('granted but not enrolled → 403 mfa_enrolment_required; enrolled → /me with role, capabilities, reauth_by', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const email = `f69-raw-${run}@dealpilot.test`;
    const raw = await signUp(email, 'Pas Encore');
    await admin.query('SELECT * FROM platform_staff_grant($1, $2, $3, $4)', [superId, email, 'platform_support', null]);
    const walled = await adminGet('/api/v1/admin/me', raw);
    expect(walled.statusCode, walled.body).toBe(403);
    expect(JSON.parse(walled.body)).toMatchObject({ error: { code: 'mfa_enrolment_required' } });

    const me = await adminGet('/api/v1/admin/me');
    expect(me.statusCode, me.body).toBe(200);
    const body = AdminMeResponse.parse(JSON.parse(me.body));
    expect(body.role).toBe('platform_super_admin');
    expect(body.capabilities).toContain('staff:manage');
    expect(new Date(body.session.reauth_by).getTime() - new Date(body.session.created_at).getTime()).toBe(12 * 3_600_000);
  });

  it('a console session expires on its own clock (13h old → 401), a fresh TOTP sign-in restores it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await admin.query(`UPDATE "session" SET "createdAt" = now() - interval '13 hours' WHERE "userId" = $1`, [superId]);
    const stale = await adminGet('/api/v1/admin/me');
    expect(stale.statusCode, stale.body).toBe(401);
    expect(JSON.parse(stale.body)).toMatchObject({ error: { code: 'admin_reauth_required' } });
    // Activity refreshes expiresAt only — that must not reset the clock.
    await admin.query(`UPDATE "session" SET "expiresAt" = now() + interval '7 days' WHERE "userId" = $1`, [superId]);
    expect((await adminGet('/api/v1/admin/me')).statusCode).toBe(401);
    superCookie = await signInWithTotp(app!, superEmail, PASSWORD, superSecret);
    expect((await adminGet('/api/v1/admin/me')).statusCode).toBe(200);
  });

  it('trustDevice is refused for every account (O-1)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const first = await app!.inject({ method: 'POST', url: '/api/auth/sign-in/email', payload: { email: superEmail, password: PASSWORD } });
    const res = await app!.inject({
      method: 'POST', url: '/api/auth/two-factor/verify-totp', headers: { cookie: cookiesOf(first) },
      payload: { code: '000000', trustDevice: true },
    });
    expect(res.statusCode, res.body).toBe(422);
    expect(JSON.parse(res.body)).toMatchObject({ error: { code: 'trust_device_disabled' } });
    // Better Auth routes on the normalised pathname; so must the refusal
    // (review: dot-segments walked past a raw-url regex).
    for (const url of ['/api/auth/two-factor/./verify-totp', '/api/auth/two-factor/x/../verify-totp', '/api/auth/two-factor/verify-backup-code', '/api/auth/two-factor/verify-otp']) {
      const again = await app!.inject({
        method: 'POST', url, headers: { cookie: cookiesOf(first) }, payload: { code: '000000', trustDevice: true },
      });
      expect(again.statusCode, `${url} → ${again.body}`).toBe(422);
    }
  });

  it('/api/v1/me names the platform role for staff and null for tenants', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const staff = await app!.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: superCookie } });
    expect(JSON.parse(staff.body)).toMatchObject({ platform_role: 'platform_super_admin' });
    const tenant = await app!.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: ownerA } });
    expect(JSON.parse(tenant.body)).toMatchObject({ platform_role: null });
  });

  it('the definers refuse a tenant owner as actor even when called directly on the app pool', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const ownerAId = await userId(ownerAEmail);
    await expect(
      appPool.query('SELECT * FROM admin_list_tenants($1::uuid, NULL, NULL, NULL, NULL, NULL, 10)', [ownerAId]),
    ).rejects.toMatchObject({ code: 'PA001' });
  });
});

describe('the tenant directory and detail (§4, §11)', () => {
  it('lists every organization with counts for every platform role, and never a customer field', async (ctx) => {
    if (!dbUp) return ctx.skip();
    for (const cookie of [superCookie, supportCookie, billingCookie]) {
      const res = await adminGet('/api/v1/admin/tenants?limit=50', cookie);
      expect(res.statusCode, res.body).toBe(200);
      const page = AdminTenantPage.parse(JSON.parse(res.body));
      const a = page.items.find((t) => t.id === orgA)!;
      expect(a).toMatchObject({ slug: `groupe-alpha-${run}`, status: 'active', plan_code: 'core', store_count: 1, member_count: 2 });
      expect(res.body).not.toMatch(/phone_e164|first_name|vehicle_interest|sale_price_cents/);
    }
  });

  it('filters by status, plan and q; a wildcard in q is text; pages walk without skipping', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const byQ = AdminTenantPage.parse(JSON.parse((await adminGet(`/api/v1/admin/tenants?q=beta-${run}`)).body));
    expect(byQ.items.map((t) => t.id)).toEqual([orgB]);
    // '%' and '_' are TEXT in the search, never LIKE wildcards (review).
    for (const raw of ['%', '_', 'a_c']) {
      const wild = await adminGet(`/api/v1/admin/tenants?q=${encodeURIComponent(raw)}`);
      expect(wild.statusCode, wild.body).toBe(200);
      expect(AdminTenantPage.parse(JSON.parse(wild.body)).items, `q=${raw}`).toEqual([]);
    }
    const byPlan = AdminTenantPage.parse(JSON.parse((await adminGet('/api/v1/admin/tenants?plan=enterprise')).body));
    expect(byPlan.items).toEqual([]);

    const seen = new Set<string>();
    let cursor: string | null = null;
    for (let i = 0; i < 10; i += 1) {
      const res = await adminGet(`/api/v1/admin/tenants?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      const page = AdminTenantPage.parse(JSON.parse(res.body));
      for (const t of page.items) {
        expect(seen.has(t.id), 'a page repeated a tenant').toBe(false);
        seen.add(t.id);
      }
      cursor = page.next_cursor;
      if (!cursor) break;
    }
    expect(seen.has(orgA) && seen.has(orgB)).toBe(true);
    const bad = await adminGet('/api/v1/admin/tenants?cursor=nope');
    expect(bad.statusCode).toBe(400);
  });

  it('the detail carries stores, owners and the transitions THIS caller may make', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await adminGet(`/api/v1/admin/tenants/${orgA}`);
    expect(res.statusCode, res.body).toBe(200);
    const d = AdminTenantDetail.parse(JSON.parse(res.body));
    expect(d.stores.map((s) => s.id)).toEqual([storeA]);
    expect(d.owner_emails).toEqual([ownerAEmail]);
    expect(d.allowed_transitions.sort()).toEqual(['past_due', 'suspended']);
    const support = AdminTenantDetail.parse(JSON.parse((await adminGet(`/api/v1/admin/tenants/${orgA}`, supportCookie)).body));
    expect(support.allowed_transitions).toEqual([]);
    expect((await adminGet('/api/v1/admin/tenants/00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    const plans = PlanList.parse(JSON.parse((await adminGet('/api/v1/admin/plans', billingCookie)).body));
    expect(plans.items.map((p) => p.code)).toEqual(['core', 'growth', 'scale', 'enterprise']);
  });

  it('the events feed parses against the contract, and a soft-deleted tenant offers no transition', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const feed = await adminGet(`/api/v1/admin/tenants/${orgA}/events`);
    expect(feed.statusCode, feed.body).toBe(200);
    const parsed = AdminTenantEventsResponse.parse(JSON.parse(feed.body));
    expect(parsed.items.length).toBeGreaterThan(0);
    expect(typeof parsed.items[0]!.seq).toBe('number');

    const gone = await signUp(`f69-gone-${run}@dealpilot.test`, 'Parti');
    const { orgId } = await org(gone, 'Groupe Parti', `groupe-parti-${run}`);
    const del = await app!.inject({ method: 'DELETE', url: `/api/v1/organizations/${orgId}`, headers: { cookie: gone } });
    expect([200, 204]).toContain(del.statusCode);
    const detail = AdminTenantDetail.parse(JSON.parse((await adminGet(`/api/v1/admin/tenants/${orgId}`)).body));
    expect(detail.deleted_at).not.toBeNull();
    expect(detail.allowed_transitions).toEqual([]);
    const bad = await app!.inject({ method: 'DELETE', url: '/api/v1/admin/staff/not-a-uuid-at-all-but-36-chars-x', headers: { cookie: superCookie } });
    expect(bad.statusCode, bad.body).toBe(404);
  });

  it('the capability matrix: support reads only; billing reprices only; super admin everything', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const patch = (cookie: string, body: Record<string, unknown>) =>
      app!.inject({ method: 'PATCH', url: `/api/v1/admin/tenants/${orgA}`, headers: { cookie }, payload: body });
    expect((await patch(supportCookie, { legal_name: 'Alpha inc.' })).statusCode).toBe(403);
    expect((await setStatus(orgA, { status: 'past_due', reason: 'support tries' }, supportCookie)).statusCode).toBe(403);
    expect((await adminGet('/api/v1/admin/staff', supportCookie)).statusCode).toBe(403);
    expect((await patch(billingCookie, { legal_name: 'Alpha inc.' })).statusCode).toBe(403);
    const growth = PlanList.parse(JSON.parse((await adminGet('/api/v1/admin/plans')).body)).items.find((p) => p.code === 'growth')!;
    const repriced = await patch(billingCookie, { plan_id: growth.id, reason: 'upgrade signed' });
    expect(repriced.statusCode, repriced.body).toBe(200);
    expect(AdminTenantDetail.parse(JSON.parse(repriced.body)).plan_code).toBe('growth');
    // The tenant's own read shows the cached tier moved with it (0065 trigger).
    const own = await app!.inject({ method: 'GET', url: `/api/v1/organizations/${orgA}`, headers: { cookie: ownerA } });
    expect(JSON.parse(own.body)).toMatchObject({ plan_tier: 'growth', plan_id: growth.id });
  });

  it('a profile edit persists, clears with null, refuses an unknown plan, and writes ONE platform event the tenant can see', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const patch = (body: Record<string, unknown>) =>
      app!.inject({ method: 'PATCH', url: `/api/v1/admin/tenants/${orgA}`, headers: { cookie: superCookie }, payload: body });
    const edited = await patch({ legal_name: 'Groupe Alpha inc.', province: 'QC', privacy_officer_email: 'Vie.Privee@alpha.test', reason: 'onboarding form' });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(AdminTenantDetail.parse(JSON.parse(edited.body))).toMatchObject({
      legal_name: 'Groupe Alpha inc.', province: 'QC', privacy_officer_email: 'vie.privee@alpha.test',
    });
    const cleared = await patch({ province: null });
    expect(AdminTenantDetail.parse(JSON.parse(cleared.body)).province).toBeNull();
    const unknown = await patch({ plan_id: '00000000-0000-4000-8000-000000000000' });
    expect(unknown.statusCode, unknown.body).toBe(422);
    expect(unknown.body).toContain('unknown_plan');

    const before = await admin.query<{ n: string }>(`SELECT count(*) AS n FROM activity_events WHERE organization_id = $1 AND actor_type = 'platform'`, [orgA]);
    expect((await patch({ legal_name: 'Groupe Alpha inc.' })).statusCode).toBe(200);
    const after = await admin.query<{ n: string }>(`SELECT count(*) AS n FROM activity_events WHERE organization_id = $1 AND actor_type = 'platform'`, [orgA]);
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);

    // §12 transparency: the tenant sees the platform's act in its own trail.
    const trail = await app!.inject({ method: 'GET', url: `/api/v1/activity?organization_id=${orgA}&entity_id=${orgA}`, headers: { cookie: ownerA } });
    const events = (JSON.parse(trail.body) as { items: { actor_type: string; changes: Record<string, unknown> }[] }).items;
    expect(events.find((e) => e.actor_type === 'platform' && 'legal_name' in e.changes), JSON.stringify(events).slice(0, 800)).toBeDefined();
  });
});

describe('the lifecycle (§4.2)', () => {
  it('the DATABASE enforces the matrix: every legal pair succeeds, every other pair is 409 invalid_transition', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const throwaway = await signUp(`f69-t-${run}@dealpilot.test`, 'Jetable');
    const { orgId } = await org(throwaway, 'Groupe Jetable', `groupe-jetable-${run}`);
    const slug = `groupe-jetable-${run}`;
    const legal = new Set(TENANT_TRANSITIONS.map(([f, t]) => `${f}>${t}`));
    for (const from of OrganizationStatus.options) {
      for (const to of OrganizationStatus.options) {
        await forceStatus(orgId, from);
        const res = await setStatus(orgId, { status: to, reason: `matrix ${from} → ${to}`, confirm_slug: slug });
        if (legal.has(`${from}>${to}`)) {
          expect(res.statusCode, `${from} → ${to}: ${res.body}`).toBe(200);
          expect(TenantStatusChangeResult.parse(JSON.parse(res.body)).status).toBe(to);
        } else {
          expect(res.statusCode, `${from} → ${to}: ${res.body}`).toBe(409);
          expect(JSON.parse(res.body)).toMatchObject({ error: { code: 'invalid_transition' } });
        }
      }
    }
    await forceStatus(orgId, 'active');
    // Stamps: activated once, suspended on suspension.
    const detail = AdminTenantDetail.parse(JSON.parse((await adminGet(`/api/v1/admin/tenants/${orgId}`)).body));
    expect(detail.activated_at).not.toBeNull();
    expect(detail.suspended_at).not.toBeNull();
  });

  it('a short reason, a wrong slug, and a stale expected_from are each refused', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const slug = `groupe-beta-${run}`;
    expect((await setStatus(orgB, { status: 'past_due', reason: 'no' })).statusCode).toBe(422);
    const wrong = await setStatus(orgB, { status: 'suspended', reason: 'wrong slug typed', confirm_slug: 'nope' });
    expect(wrong.statusCode, wrong.body).toBe(422);
    expect(wrong.body).toContain('slug_mismatch');
    const stale = await setStatus(orgB, { status: 'past_due', reason: 'stale view', expected_from: 'trial' });
    expect(stale.statusCode, stale.body).toBe(409);
    expect(JSON.parse(stale.body)).toMatchObject({ error: { code: 'stale_status' } });
    void slug;
  });

  it('suspension revokes the tenant’s sessions, refuses re-entry with tenant_suspended, closes intake with 410, and hides a restricted event; reinstatement restores', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // An intake key on A, signed like a provider would.
    const key = await app!.inject({
      method: 'POST', url: '/api/v1/intake-keys', headers: { cookie: ownerA },
      payload: { organization_id: orgA, store_id: storeA, label: 'Site web', default_source: 'website' },
    });
    expect(key.statusCode, key.body).toBe(201);
    const { token, secret } = JSON.parse(key.body) as { token: string; secret: string };
    const intake = async (sig?: string) => {
      const ts = Math.floor(Date.now() / 1000).toString();
      const body = JSON.stringify({ phone: '514 555 0199', first_name: 'Suspendu', vehicle_interest: 'Kia EV6' });
      return app!.inject({
        method: 'POST', url: `/in/v1/leads/${token}`,
        headers: { 'content-type': 'application/json', 'x-intake-timestamp': ts, 'x-intake-signature': sig ?? sign(ts, body, secret) },
        payload: body,
      });
    };
    expect((await intake()).statusCode).toBe(202);

    const colleagueBefore = await app!.inject({ method: 'GET', url: `/api/v1/leads?organization_id=${orgB}`, headers: { cookie: colleague } });
    expect(colleagueBefore.statusCode).toBe(200);

    const suspended = await setStatus(orgA, {
      status: 'suspended', reason: 'chargeback investigation', confirm_slug: `groupe-alpha-${run}`, restricted: true, expected_from: 'active',
    });
    expect(suspended.statusCode, suspended.body).toBe(200);
    const result = TenantStatusChangeResult.parse(JSON.parse(suspended.body));
    expect(result.status).toBe('suspended');
    // Owner A and the colleague both held sessions; both are gone.
    expect(result.sessions_revoked).toBeGreaterThanOrEqual(2);
    expect((await app!.inject({ method: 'GET', url: `/api/v1/leads?organization_id=${orgA}`, headers: { cookie: ownerA } })).statusCode).toBe(401);

    // Re-sign-in works (the account is fine) — the ORGANIZATION is not.
    ownerA = await signIn(ownerAEmail);
    const refused = await app!.inject({ method: 'GET', url: `/api/v1/leads?organization_id=${orgA}`, headers: { cookie: ownerA } });
    expect(refused.statusCode, refused.body).toBe(403);
    expect(JSON.parse(refused.body)).toMatchObject({ error: { code: 'tenant_suspended' } });
    // The colleague's OTHER organization still works after re-sign-in (O-6).
    colleague = await signIn(colleagueEmail);
    expect((await app!.inject({ method: 'GET', url: `/api/v1/leads?organization_id=${orgB}`, headers: { cookie: colleague } })).statusCode).toBe(200);

    // Intake: a valid signature → 410 and no lead; a bad signature stays 401 (no oracle).
    const gone = await intake();
    expect(gone.statusCode, gone.body).toBe(410);
    expect((await intake('v1=deadbeef')).statusCode).toBe(401);
    const leads = await admin.query<{ n: string }>(`SELECT count(*) AS n FROM leads WHERE organization_id = $1 AND first_name = 'Suspendu'`, [orgA]);
    expect(leads.rows[0]!.n).toBe('1');

    // The restricted event: absent from the tenant's trail, present in the platform's.
    const reinstated = await setStatus(orgA, { status: 'active', reason: 'cleared', expected_from: 'suspended' });
    expect(reinstated.statusCode, reinstated.body).toBe(200);
    ownerA = await signIn(ownerAEmail);
    const trail = await app!.inject({ method: 'GET', url: `/api/v1/activity?organization_id=${orgA}&entity_id=${orgA}`, headers: { cookie: ownerA } });
    expect(trail.statusCode, trail.body).toBe(200);
    const tenantSees = (JSON.parse(trail.body) as { items: { changes: Record<string, { to?: string }> }[] }).items;
    expect(tenantSees.find((e) => e.changes['status']?.to === 'suspended')).toBeUndefined();
    expect(tenantSees.find((e) => e.changes['status']?.to === 'active')).toBeDefined();
    const platformSees = await adminGet(`/api/v1/admin/tenants/${orgA}/events`);
    const all = (JSON.parse(platformSees.body) as { items: { restricted: boolean; changes: Record<string, { to?: string }> }[] }).items;
    expect(all.find((e) => e.changes['status']?.to === 'suspended')).toMatchObject({ restricted: true });
    expect((await intake()).statusCode).toBe(202);
  });

  it('read_only: writes answer 402 payment_required, reads keep working, past_due allows everything', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const pastDue = await setStatus(orgB, { status: 'past_due', reason: 'invoice failed', expected_from: 'active' });
    expect(pastDue.statusCode, pastDue.body).toBe(200);
    const lead = (extra = '') => app!.inject({
      method: 'POST', url: '/api/v1/leads', headers: { cookie: ownerB },
      payload: { organization_id: orgB, store_id: storeB, source: 'walk_in', first_name: `Lecture${extra}`, phone: `+1514555${extra}0177`.slice(0, 12), vehicle_interest: 'Kia Niro' },
    });
    const first = await lead('1');
    expect(first.statusCode, first.body).toBe(201);
    const readOnly = await setStatus(orgB, { status: 'read_only', reason: 'grace expired', expected_from: 'past_due' });
    expect(readOnly.statusCode, readOnly.body).toBe(200);

    const blocked = await lead('2');
    expect(blocked.statusCode, blocked.body).toBe(402);
    expect(JSON.parse(blocked.body)).toMatchObject({ error: { code: 'payment_required' } });
    const member = await app!.inject({
      method: 'POST', url: '/api/v1/members', headers: { cookie: ownerB },
      payload: { organization_id: orgB, email: `f69-x-${run}@dealpilot.test`, name: 'X', roles: ['salesperson'] },
    });
    expect(member.statusCode).toBe(402);
    const rename = await app!.inject({ method: 'PATCH', url: `/api/v1/organizations/${orgB}`, headers: { cookie: ownerB }, payload: { name: 'Beta renommé' } });
    expect(rename.statusCode).toBe(402);

    for (const url of [`/api/v1/leads?organization_id=${orgB}`, `/api/v1/activity?organization_id=${orgB}`, `/api/v1/contacts?organization_id=${orgB}`, `/api/v1/organizations/${orgB}`, '/api/v1/me', `/api/v1/permissions/mine?organization_id=${orgB}`]) {
      const res = await app!.inject({ method: 'GET', url, headers: { cookie: ownerB } });
      expect(res.statusCode, `${url} → ${res.body}`).toBe(200);
    }
    expect((await app!.inject({ method: 'POST', url: '/api/auth/sign-out', headers: { cookie: ownerB } })).statusCode).toBe(200);
    ownerB = await signIn(ownerBEmail);

    const paid = await setStatus(orgB, { status: 'active', reason: 'paid in full', expected_from: 'read_only' });
    expect(paid.statusCode, paid.body).toBe(200);
    const third = await lead('3');
    expect(third.statusCode, third.body).toBe(201);
  });
});

describe('platform staff (§3)', () => {
  it('grants need an account first; a new staffer is walled until enrolled; roles change; revocation is immediate; one super admin always remains', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const grant = (body: Record<string, unknown>, cookie = superCookie) =>
      app!.inject({ method: 'POST', url: '/api/v1/admin/staff', headers: { cookie }, payload: body });
    const nobody = await grant({ email: `f69-nobody-${run}@dealpilot.test`, role: 'platform_support' });
    expect(nobody.statusCode, nobody.body).toBe(422);
    expect(nobody.body).toContain('needs_account');

    const email = `f69-new-${run}@dealpilot.test`;
    const newCookie = await signUp(email, 'Nouvelle Recrue');
    const granted = await grant({ email, role: 'platform_support', note: 'ticket desk' });
    expect(granted.statusCode, granted.body).toBe(201);
    expect(JSON.parse(granted.body)).toMatchObject({ email, role: 'platform_support', outcome: 'granted', mfa_enabled: false });
    expect((await adminGet('/api/v1/admin/me', newCookie)).statusCode).toBe(403);
    const { secret } = await enrol(app!, newCookie, PASSWORD);
    const enrolledCookie = await signInWithTotp(app!, email, PASSWORD, secret);
    expect((await adminGet('/api/v1/admin/me', enrolledCookie)).statusCode).toBe(200);

    const rerole = await grant({ email, role: 'platform_billing' });
    expect(JSON.parse(rerole.body)).toMatchObject({ role: 'platform_billing', outcome: 'role_changed' });
    const roster = PlatformStaffList.parse(JSON.parse((await adminGet('/api/v1/admin/staff')).body));
    const newId = roster.items.find((m) => m.email === email)!.user_id;

    const revoked = await app!.inject({ method: 'DELETE', url: `/api/v1/admin/staff/${newId}`, headers: { cookie: superCookie } });
    expect(revoked.statusCode, revoked.body).toBe(204);
    expect((await adminGet('/api/v1/admin/me', enrolledCookie)).statusCode).toBe(401);
    const back = await signInWithTotp(app!, email, PASSWORD, secret);
    expect((await adminGet('/api/v1/admin/me', back)).statusCode).toBe(404);
    expect(JSON.parse((await app!.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: back } })).body)).toMatchObject({ platform_role: null });
    const reinstated = await grant({ email, role: 'platform_support' });
    expect(JSON.parse(reinstated.body)).toMatchObject({ outcome: 'reinstated' });

    const self = await app!.inject({ method: 'DELETE', url: `/api/v1/admin/staff/${superId}`, headers: { cookie: superCookie } });
    expect(self.statusCode, self.body).toBe(422);
    expect(self.body).toContain('cannot_revoke_self');
    // Promote nobody: the super admin is the last one → a colleague cannot remove them either.
    const second = await grant({ email: supportEmail, role: 'platform_super_admin' });
    expect(JSON.parse(second.body)).toMatchObject({ outcome: 'role_changed' });
    const supportId = await userId(supportEmail);
    const demote = await app!.inject({ method: 'DELETE', url: `/api/v1/admin/staff/${supportId}`, headers: { cookie: superCookie } });
    expect(demote.statusCode).toBe(204);
    const staffRoster = PlatformStaffList.parse(JSON.parse((await adminGet('/api/v1/admin/staff')).body));
    expect(staffRoster.items.filter((m) => m.role === 'platform_super_admin' && m.status === 'active')).toHaveLength(1);
    // Now the only super admin cannot be revoked by a definer call either (PA003).
    await expect(admin.query('SELECT platform_staff_revoke($1, $1, NULL)', [superId])).rejects.toMatchObject({ code: 'PA006' });
    const bootstrapClosed = admin.query('SELECT * FROM platform_staff_grant(NULL, $1, $2, NULL)', [email, 'platform_super_admin']);
    await expect(bootstrapClosed).rejects.toMatchObject({ code: 'PA010' });
    const register = await admin.query<{ event: string }>(`SELECT event FROM platform_audit_events WHERE target_user_id = $1 ORDER BY seq`, [newId]);
    expect(register.rows.map((r) => r.event)).toEqual(['staff.granted', 'staff.role_changed', 'staff.revoked', 'staff.reinstated']);
    // Demoting yourself as the last super admin is refused like revoking
    // yourself would be (review: it locked the console and reopened bootstrap).
    const demoteSelf = await grant({ email: superEmail, role: 'platform_support' });
    expect(demoteSelf.statusCode, demoteSelf.body).toBe(409);
    expect(JSON.parse(demoteSelf.body)).toMatchObject({ error: { code: 'last_super_admin' } });
    expect((await adminGet('/api/v1/admin/me')).statusCode).toBe(200);
  });
});
