import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { connectionScope, createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, withUser, type Pool } from '@dealpilot/db';
import {
  AdminMeResponse,
  AdminTenantEventsResponse,
  AdminTenantMembers,
  DEFAULT_ROLE_PERMISSIONS,
  IMPERSONATION_BLOCKED_PERMISSIONS,
  ImpersonationEndReason,
  ImpersonationList,
  ImpersonationMode,
  ImpersonationSession,
  ImpersonationSessionDetail,
  MeResponse,
  NOTIFICATION_TITLE_KEYS,
  PERMISSIONS,
  ROLES,
  SupportAccessList,
} from '@dealpilot/schemas';
import { apiV1 } from '@dealpilot/contracts';
import { IMPERSONATION_END_REASONS, IMPERSONATION_MODES, IMPERSONATION_TTL_MINUTES } from '@dealpilot/core';
import { buildApp } from './app.js';
import type { EmailMessage } from './email.js';
import { enrol, signInWithTotp } from './testing/totp.js';

/**
 * F-71 — impersonation with audit (admin-console.md §7, D-072). What is worth
 * proving:
 *  - a session is a register row on the STAFFER's session — no cookie
 *    changes, the auth mount still sees the staffer, the tenant app sees
 *    the target;
 *  - the refusals: console closed, read-only verbs, two blocked routes, the
 *    blocked permissions in full mode, the scope of a multi-org target
 *    (enforced by the DATABASE);
 *  - the tenant sees it: journal rows attributed to both, the owner's bell
 *    and inbox, the register on /security;
 *  - every way a session ends: End, TTL, sign-out, staff revoke, suspension,
 *    membership revoked, tenant deleted — and that a closed row never lies.
 * Every blocked-behaviour case opens its OWN session (shared fixtures hide
 * no-op features).
 */

const here = dirname(fileURLToPath(import.meta.url));
const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(here, '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';
const sent: EmailMessage[] = [];
const REASON = 'Ticket SUP-4812: the deal board does not load for this user';

let admin: Pool;
let appPool: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;

// Tenant A: owner, a salesperson colleague, a GM who also works at rival B.
let ownerA = ''; let ownerAId = ''; let ownerAEmail = ''; let orgA = ''; let storeA = ''; let slugA = '';
let colleagueId = ''; let colleagueEmail = ''; let colleagueMembership = '';
let gmId = ''; let gmEmail = '';
let ownerB = ''; let orgB = ''; let storeB = ''; let leadB = '';
// Staff
let superCookie = ''; let superEmail = ''; let superId = '';
let supportCookie = ''; let supportSecret = ''; let supportEmail = ''; let supportId = '';
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
    payload: { organization_id: orgId, name: `${name} Laval`, code: slug.slice(0, 6).toUpperCase(), province: 'QC' },
  });
  expect(s.statusCode, s.body).toBe(201);
  return { orgId, storeId: (JSON.parse(s.body) as { id: string }).id };
}

async function addMember(cookie: string, orgId: string, email: string, name: string, roles: string[]): Promise<string> {
  const res = await app!.inject({ method: 'POST', url: '/api/v1/members', headers: { cookie }, payload: { organization_id: orgId, email, name, roles } });
  expect(res.statusCode, res.body).toBe(201);
  return (JSON.parse(res.body) as { id: string }).id;
}

async function staffer(email: string, name: string, role: string, actor: string | null): Promise<{ cookie: string; secret: string }> {
  const first = await signUp(email, name);
  await admin.query('SELECT * FROM platform_staff_grant($1, $2, $3, $4)', [actor, email, role, 'test fixture']);
  const { secret } = await enrol(app!, first, PASSWORD);
  return { cookie: await signInWithTotp(app!, email, PASSWORD, secret), secret };
}

async function start(cookie: string, body: Record<string, unknown>) {
  return app!.inject({ method: 'POST', url: '/api/v1/admin/impersonation-sessions', headers: { cookie }, payload: body });
}
async function end(cookie: string, id: string) {
  return app!.inject({ method: 'DELETE', url: `/api/v1/admin/impersonation-sessions/${id}`, headers: { cookie } });
}
async function get(url: string, cookie: string) {
  return app!.inject({ method: 'GET', url, headers: { cookie } });
}
async function startedSession(cookie: string, target: string, over: Record<string, unknown> = {}) {
  const res = await start(cookie, { tenant_id: orgA, target_user_id: target, reason: REASON, ...over });
  expect(res.statusCode, res.body).toBe(201);
  return ImpersonationSession.parse(JSON.parse(res.body));
}
async function row(id: string) {
  return (await admin.query<{ ended_at: Date | null; end_reason: string | null; ended_by: string | null; expires_at: Date; platform_session_id: string; platform_user_email: string }>(
    `SELECT ended_at, end_reason, ended_by, expires_at, platform_session_id, platform_user_email FROM impersonation_sessions WHERE id = $1`, [id],
  )).rows[0]!;
}
async function count(sql: string, params: unknown[] = []): Promise<number> {
  return Number((await admin.query<{ n: string }>(sql, params)).rows[0]!.n);
}
/** Put an org in a status directly (fixture only — the API is what is under test). */
async function forceStatus(orgId: string, status: string): Promise<void> {
  await admin.query(
    `UPDATE organizations SET status = $2, suspended_at = CASE WHEN $2 = 'suspended' THEN now() ELSE suspended_at END WHERE id = $1`,
    [orgId, status],
  );
}
/** The trail is written from an onResponse hook, after inject() resolves: wait for it. */
async function settled(sessionId: string, atLeast: number): Promise<{ method: string; route: string; status_code: number }[]> {
  for (let i = 0; i < 40; i += 1) {
    const r = await admin.query<{ method: string; route: string; status_code: number }>(
      `SELECT method, route, status_code FROM impersonation_requests WHERE impersonation_id = $1 ORDER BY seq`, [sessionId],
    );
    if (r.rows.length >= atLeast) return r.rows;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`trail never reached ${atLeast} rows`);
}
async function createLead(cookie: string, orgId: string, storeId: string) {
  return app!.inject({
    method: 'POST', url: '/api/v1/leads', headers: { cookie },
    payload: { organization_id: orgId, store_id: storeId, first_name: 'Prospect', phone: '(819) 555-0142', source: 'manual' },
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
  appPool = createPool({ connectionString: APP_URL, max: 2 });
  ({ app } = await buildApp(
    { DATABASE_URL: APP_URL, NODE_ENV: 'test' },
    {
      rateLimiter: { take: async () => ({ allowed: true, retryAfterS: 0 }), close: async () => {} },
      mailer: { deliversToRecipient: true, async send(m) { sent.push(m); return true; } },
    },
  ));

  ownerAEmail = `f71-owner-a-${run}@dealpilot.test`;
  ownerA = await signUp(ownerAEmail, 'Patronne A');
  ownerAId = await userId(ownerAEmail);
  slugA = `groupe-alpha-${run}`;
  ({ orgId: orgA, storeId: storeA } = await org(ownerA, 'Groupe Alpha', slugA));
  colleagueEmail = `f71-vendeur-${run}@dealpilot.test`;
  await signUp(colleagueEmail, 'Vendeur');
  colleagueId = await userId(colleagueEmail);
  colleagueMembership = await addMember(ownerA, orgA, colleagueEmail, 'Vendeur', ['salesperson']);
  gmEmail = `f71-gm-${run}@dealpilot.test`;
  await signUp(gmEmail, 'Directeur');
  gmId = await userId(gmEmail);
  await addMember(ownerA, orgA, gmEmail, 'Directeur', ['gm']);

  ownerB = await signUp(`f71-owner-b-${run}@dealpilot.test`, 'Patron B');
  ({ orgId: orgB, storeId: storeB } = await org(ownerB, 'Groupe Beta', `groupe-beta-${run}`));
  await addMember(ownerB, orgB, gmEmail, 'Directeur', ['gm']);
  const lb = await createLead(ownerB, orgB, storeB);
  expect(lb.statusCode, lb.body).toBe(201);
  leadB = (JSON.parse(lb.body) as { id: string }).id;

  superEmail = `f71-super-${run}@dealpilot.test`;
  ({ cookie: superCookie } = await staffer(superEmail, 'Super Admin', 'platform_super_admin', null));
  superId = await userId(superEmail);
  supportEmail = `f71-support-${run}@dealpilot.test`;
  ({ cookie: supportCookie, secret: supportSecret } = await staffer(supportEmail, 'Soutien', 'platform_support', superId));
  supportId = await userId(supportEmail);
  billingEmail = `f71-billing-${run}@dealpilot.test`;
  ({ cookie: billingCookie } = await staffer(billingEmail, 'Facturation', 'platform_billing', superId));
  // Billing also holds a seat at A — the "platform staff cannot be a target" case.
  await addMember(ownerA, orgA, billingEmail, 'Facturation', ['admin_office']);
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

describe('the gate (F-71 on the F-69 door)', () => {
  it('a tenant owner gets 404 on every impersonation path; billing 403 naming the capability; support cannot open full mode', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const paths = contractPaths(apiV1.admin).filter((p) => p.path.includes('impersonation') || p.path.endsWith('/members'));
    expect(paths).toHaveLength(5);
    for (const { method, path } of paths) {
      const res = await app!.inject({
        method: method as 'GET', url: path.replace(/:id/g, orgA), headers: { cookie: ownerA },
        ...(method === 'GET' || method === 'DELETE' ? {} : { payload: {} }),
      });
      expect(res.statusCode, `${method} ${path} → ${res.body}`).toBe(404);
    }
    const bill = await start(billingCookie, { tenant_id: orgA, target_user_id: colleagueId, reason: REASON });
    expect(bill.statusCode, bill.body).toBe(403);
    expect(JSON.parse(bill.body)).toMatchObject({ error: { code: 'forbidden', details: [{ message: 'impersonation:start_read_only' }] } });
    expect((await get('/api/v1/admin/impersonation-sessions', billingCookie)).statusCode).toBe(403);
    const full = await start(supportCookie, { tenant_id: orgA, target_user_id: colleagueId, reason: REASON, mode: 'full' });
    expect(full.statusCode, full.body).toBe(403);
    expect(JSON.parse(full.body)).toMatchObject({ error: { details: [{ message: 'impersonation:start_full' }] } });
    expect(await count(`SELECT count(*) AS n FROM impersonation_sessions`)).toBe(0);
  });

  it('refuses a short reason, an unknown or foreign target, platform staff as target, and a tenant without standing — writing nothing', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const short = await start(supportCookie, { tenant_id: orgA, target_user_id: colleagueId, reason: 'nineteen characters' });
    expect(short.statusCode, short.body).toBe(422);
    expect(JSON.parse(short.body)).toMatchObject({ error: { details: [{ path: 'reason' }] } });
    const unknown = await start(supportCookie, { tenant_id: orgA, target_user_id: randomUUID(), reason: REASON });
    expect(unknown.statusCode, unknown.body).toBe(404);
    const foreign = await start(supportCookie, { tenant_id: orgA, target_user_id: await userId(`f71-owner-b-${run}@dealpilot.test`), reason: REASON });
    expect(foreign.statusCode, foreign.body).toBe(404);
    expect(JSON.parse(foreign.body)).toEqual(expect.objectContaining({ error: expect.objectContaining({ code: JSON.parse(unknown.body).error.code }) }));
    const staff = await start(supportCookie, { tenant_id: orgA, target_user_id: await userId(billingEmail), reason: REASON });
    expect(staff.statusCode, staff.body).toBe(403);
    expect(JSON.parse(staff.body)).toMatchObject({ error: { code: 'cannot_impersonate_staff' } });

    const ownerC = await signUp(`f71-owner-c-${run}@dealpilot.test`, 'Patron C');
    const { orgId: orgC } = await org(ownerC, 'Groupe Gamma', `groupe-gamma-${run}`);
    await forceStatus(orgC, 'suspended');
    const suspended = await start(supportCookie, { tenant_id: orgC, target_user_id: await userId(`f71-owner-c-${run}@dealpilot.test`), reason: REASON });
    expect(suspended.statusCode, suspended.body).toBe(409);
    expect(JSON.parse(suspended.body)).toMatchObject({ error: { code: 'tenant_not_impersonable' } });
    const ownerD = await signUp(`f71-owner-d-${run}@dealpilot.test`, 'Patron D');
    const { orgId: orgD } = await org(ownerD, 'Groupe Delta', `groupe-delta-${run}`);
    expect([200, 204]).toContain((await app!.inject({ method: 'DELETE', url: `/api/v1/organizations/${orgD}`, headers: { cookie: ownerD } })).statusCode);
    const deleted = await start(supportCookie, { tenant_id: orgD, target_user_id: await userId(`f71-owner-d-${run}@dealpilot.test`), reason: REASON });
    expect(deleted.statusCode, deleted.body).toBe(409);
    expect(await count(`SELECT count(*) AS n FROM impersonation_sessions`)).toBe(0);
    expect(sent.filter((m) => m.subject.includes('soutien'))).toHaveLength(0);
  });
});

describe('a read-only session (support, acting as a salesperson)', () => {
  let sessionId = '';
  let mailsBefore = 0;

  it('opens the session: the register row, the tenant journal row, the owner’s bell and inbox', async (ctx) => {
    if (!dbUp) return ctx.skip();
    mailsBefore = sent.length;
    const s = await startedSession(supportCookie, colleagueId, { ticket_ref: 'SUP-4812' });
    sessionId = s.id;
    expect(s).toMatchObject({
      tenant: { id: orgA, slug: slugA }, platform_user: { id: supportId, email: supportEmail }, target_user: { id: colleagueId, email: colleagueEmail },
      mode: 'read_only', reason: REASON, ticket_ref: 'SUP-4812', ended_at: null, end_reason: null, ended_by: null, active: true,
    });
    expect(Math.abs(new Date(s.expires_at).getTime() - new Date(s.started_at).getTime() - IMPERSONATION_TTL_MINUTES * 60_000)).toBeLessThan(1_000);
    const r = await row(sessionId);
    const sessions = (await admin.query<{ id: string }>(`SELECT id FROM "session" WHERE "userId" = $1`, [supportId])).rows.map((x) => x.id);
    expect(sessions).toContain(r.platform_session_id);
    expect(r.platform_user_email).toBe(supportEmail);

    // A second start on the same console session is refused.
    const again = await start(supportCookie, { tenant_id: orgA, target_user_id: gmId, reason: REASON });
    expect(again.statusCode, again.body).toBe(409);
    expect(JSON.parse(again.body)).toMatchObject({ error: { code: 'impersonation_active' } });

    // §12: the tenant sees the session open — journal, admin events with the staffer named, the owner's bell, the owner's inbox.
    const trail = await get(`/api/v1/activity?organization_id=${orgA}&limit=50`, ownerA);
    expect(trail.statusCode, trail.body).toBe(200);
    const opened = (JSON.parse(trail.body) as { items: { entity_type: string; action: string; actor_type: string; impersonation_id: string | null; restricted: boolean; changes: Record<string, unknown> }[] }).items
      .find((e) => e.entity_type === 'impersonation_session' && e.action === 'created');
    expect(opened).toMatchObject({ actor_type: 'platform', impersonation_id: sessionId, restricted: false });
    expect(opened?.changes).toMatchObject({ mode: { to: 'read_only' }, target_email: { to: colleagueEmail } });
    const events = AdminTenantEventsResponse.parse(JSON.parse((await get(`/api/v1/admin/tenants/${orgA}/events`, superCookie)).body)).items;
    // The session's OWN row names the staffer as its actor and carries NO
    // impersonator_email — that column is for acts made UNDER the session
    // (review: "staffer acting as staffer" was a lie).
    expect(events.find((e) => e.entity_type === 'impersonation_session' && e.action === 'created')).toMatchObject({ impersonation_id: sessionId, impersonator_email: null, actor_email: supportEmail });
    const bell = await get('/api/v1/notifications', ownerA);
    expect(bell.statusCode, bell.body).toBe(200);
    const rung = (JSON.parse(bell.body) as { items: { title_key: string; link: string | null; params: Record<string, unknown>; entity_id: string | null }[] }).items
      .find((n) => n.entity_id === sessionId);
    expect(rung).toMatchObject({ title_key: 'notif_support_access_started_read_only', link: '/security', params: { name: 'Vendeur' } });
    const mails = sent.slice(mailsBefore);
    expect(mails.map((m) => m.to)).toEqual([ownerAEmail]);
    expect(mails[0]!.subject).toContain('soutien');
    expect(mails[0]!.text).toContain('Vendeur');
    expect(mails[0]!.text).toContain('SUP-4812');
  });

  it('the same cookie now acts as the target in the tenant app, and the console is closed but for the probe', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const me = MeResponse.parse(JSON.parse((await get('/api/v1/me', supportCookie)).body));
    expect(me.user).toMatchObject({ id: colleagueId, email: colleagueEmail });
    expect(me.platform_role).toBeNull();
    expect(me.impersonation).toMatchObject({ id: sessionId, mode: 'read_only', tenant: { id: orgA }, acting_as: { id: colleagueId, email: colleagueEmail } });
    // The auth mount is public and never impersonates: the staffer's credentials stay the staffer's.
    const authSession = await get('/api/auth/get-session', supportCookie);
    expect(authSession.statusCode, authSession.body).toBe(200);
    expect((JSON.parse(authSession.body) as { user: { id: string } }).user.id).toBe(supportId);

    expect((await get(`/api/v1/leads?organization_id=${orgA}`, supportCookie)).statusCode).toBe(200);
    const orgs = JSON.parse((await get('/api/v1/organizations', supportCookie)).body) as { items: { id: string }[] };
    expect(orgs.items.map((o) => o.id)).toEqual([orgA]);

    const closed = await get('/api/v1/admin/tenants', supportCookie);
    expect(closed.statusCode, closed.body).toBe(409);
    expect(JSON.parse(closed.body)).toMatchObject({ error: { code: 'impersonation_active', details: [{ message: sessionId }] } });
    expect((await start(supportCookie, { tenant_id: orgA, target_user_id: gmId, reason: REASON })).statusCode).toBe(409);
    const probe = AdminMeResponse.parse(JSON.parse((await get('/api/v1/admin/me', supportCookie)).body));
    expect(probe.impersonation?.id).toBe(sessionId);
    expect(probe.user.id).toBe(supportId);
  });

  it('read-only: every mutating verb is refused and nothing is written; reads and the pure calculation pass; every request is in the trail', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const before = await count(`SELECT count(*) AS n FROM leads WHERE organization_id = $1`, [orgA]);
    const create = await createLead(supportCookie, orgA, storeA);
    expect(create.statusCode, create.body).toBe(403);
    expect(JSON.parse(create.body)).toMatchObject({ error: { code: 'impersonation_read_only', details: [{ message: sessionId }] } });
    expect(await count(`SELECT count(*) AS n FROM leads WHERE organization_id = $1`, [orgA])).toBe(before);
    expect((await app!.inject({ method: 'PATCH', url: `/api/v1/members/${colleagueMembership}`, headers: { cookie: supportCookie }, payload: { status: 'active' } })).statusCode).toBe(403);
    expect((await app!.inject({ method: 'DELETE', url: `/api/v1/organizations/${orgA}`, headers: { cookie: supportCookie } })).statusCode).toBe(403);
    const calc = await app!.inject({
      method: 'POST', url: '/api/v1/deals/calculate', headers: { cookie: supportCookie },
      payload: {
        province: 'QC', deal_type: 'finance', sale_price_cents: 3_500_000, vehicle_cost_cents: 3_100_000, trade_allowance_cents: 1_000_000,
        trade_acv_cents: 950_000, trade_lien_cents: 300_000, rebate_cents: 200_000, fees_cents: 49_900, fees_taxable: false,
        fi_price_cents: 250_000, fi_cost_cents: 150_000, interest_rate_bps: 599, term_months: 60,
      },
    });
    expect(calc.statusCode, calc.body).toBe(200);

    // Refused requests are in the trail too (§7 "every request"), the closed console included.
    const trail = await settled(sessionId, 11);
    expect(trail).toEqual(expect.arrayContaining([
      { method: 'POST', route: '/api/v1/leads', status_code: 403 },
      { method: 'PATCH', route: '/api/v1/members/:id', status_code: 403 },
      { method: 'GET', route: '/api/v1/me', status_code: 200 },
      { method: 'GET', route: '/api/v1/admin/tenants', status_code: 409 },
      { method: 'POST', route: '/api/v1/deals/calculate', status_code: 200 },
    ]));
    const detail = ImpersonationSessionDetail.parse(JSON.parse((await get(`/api/v1/admin/impersonation-sessions/${sessionId}`, superCookie)).body));
    expect(detail.request_count).toBe(trail.length);
    expect(detail.requests.map((r) => r.route)).toContain('/api/v1/leads');
  });

  it('ends on request: the closed row, the journal, and the plain staffer again', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await end(supportCookie, sessionId);
    expect(res.statusCode, res.body).toBe(200);
    const closed = ImpersonationSession.parse(JSON.parse(res.body));
    expect(closed).toMatchObject({ active: false, end_reason: 'manual', ended_by: supportId });
    expect(closed.ended_at).not.toBeNull();
    expect((await get('/api/v1/admin/tenants', supportCookie)).statusCode).toBe(200);
    const me = MeResponse.parse(JSON.parse((await get('/api/v1/me', supportCookie)).body));
    expect(me.user.id).toBe(supportId);
    expect(me.impersonation).toBeNull();
    // No tenant context outside the session: the staffer is nobody at A.
    expect((await get(`/api/v1/leads?organization_id=${orgA}`, supportCookie)).statusCode).toBe(404);
    const events = AdminTenantEventsResponse.parse(JSON.parse((await get(`/api/v1/admin/tenants/${orgA}/events`, superCookie)).body)).items;
    const ended = events.find((e) => e.entity_type === 'impersonation_session' && e.action === 'updated' && e.entity_id === sessionId);
    expect(ended?.changes).toMatchObject({ end_reason: { to: 'manual' }, status: { to: 'ended' } });
    // Twice is a 409; a stranger's id is a 404; the register lists it closed.
    expect((await end(supportCookie, sessionId)).statusCode).toBe(409);
    expect((await end(supportCookie, randomUUID())).statusCode).toBe(404);
    const list = ImpersonationList.parse(JSON.parse((await get(`/api/v1/admin/impersonation-sessions?tenant_id=${orgA}&active=false`, supportCookie)).body));
    expect(list.items.map((s) => s.id)).toContain(sessionId);
    expect(ImpersonationList.parse(JSON.parse((await get('/api/v1/admin/impersonation-sessions?active=true', supportCookie)).body)).items).toEqual([]);
  });
});

describe('the scope of a multi-organization target is decided by the database', () => {
  let sessionId = '';

  it('the GM of A and B, impersonated at A, has no B: list, by id, organizations, notifications, and the raw predicates', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await admin.query(
      `INSERT INTO notifications (organization_id, user_id, urgency, title_key, params) VALUES ($1, $2, 'low', 'notif_lead_assigned', '{}')`,
      [orgB, gmId],
    );
    sessionId = (await startedSession(supportCookie, gmId)).id;
    const listB = await get(`/api/v1/leads?organization_id=${orgB}`, supportCookie);
    expect(listB.statusCode, listB.body).toBe(403);
    expect(JSON.parse(listB.body)).toMatchObject({ error: { code: 'impersonation_scope', details: [{ message: orgA }] } });
    expect((await get(`/api/v1/leads/${leadB}`, supportCookie)).statusCode).toBe(404);
    const orgs = JSON.parse((await get('/api/v1/organizations', supportCookie)).body) as { items: { id: string }[] };
    expect(orgs.items.map((o) => o.id)).toEqual([orgA]);
    const bell = JSON.parse((await get('/api/v1/notifications', supportCookie)).body) as { items: { organization_id: string }[] };
    expect(bell.items.every((n) => n.organization_id === orgA)).toBe(true);

    // The predicates themselves, as the app role: the scope GUC halves the GM's world.
    const scoped = await connectionScope.run({ impersonationOrgId: orgA }, () =>
      withUser(appPool, gmId, (c) => c.query<{ organization_id: string }>(`SELECT organization_id FROM memberships`)),
    );
    expect(scoped.rows.map((r) => r.organization_id)).toEqual([orgA]);
    const unscoped = await withUser(appPool, gmId, (c) => c.query<{ organization_id: string }>(`SELECT organization_id FROM memberships`));
    expect(unscoped.rows.map((r) => r.organization_id).sort()).toEqual([orgA, orgB].sort());
    const c = await appPool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.impersonation_org', $1, true)", [orgA]);
      expect((await c.query<{ ok: boolean }>('SELECT has_permission($1::uuid, $2::uuid, $3) AS ok', [orgB, gmId, 'lead:create'])).rows[0]!.ok).toBe(false);
      expect((await c.query<{ ok: boolean }>('SELECT has_permission($1::uuid, $2::uuid, $3) AS ok', [orgA, gmId, 'lead:create'])).rows[0]!.ok).toBe(true);
      await c.query('ROLLBACK');
      expect((await c.query<{ ok: boolean }>('SELECT has_permission($1::uuid, $2::uuid, $3) AS ok', [orgB, gmId, 'lead:create'])).rows[0]!.ok).toBe(true);
    } finally {
      c.release();
    }
    expect((await end(supportCookie, sessionId)).statusCode).toBe(200);
  });
});

describe('a full session (super admin, acting as the owner)', () => {
  let sessionId = '';

  it('writes as the target, attributed to both; the blocked powers and routes are refused even here', async (ctx) => {
    if (!dbUp) return ctx.skip();
    sessionId = (await startedSession(superCookie, ownerAId, { mode: 'full' })).id;
    const created = await createLead(superCookie, orgA, storeA);
    expect(created.statusCode, created.body).toBe(201);
    const leadId = (JSON.parse(created.body) as { id: string }).id;
    const rows = await admin.query<{ actor_user_id: string; actor_type: string; impersonation_id: string | null }>(
      `SELECT actor_user_id, actor_type, impersonation_id FROM activity_events WHERE entity_type = 'lead' AND entity_id = $1 AND action = 'created'`, [leadId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toEqual({ actor_user_id: ownerAId, actor_type: 'platform', impersonation_id: sessionId });
    // The tenant reads the same row, attributed to its owner AND flagged as a support act.
    const seen = (JSON.parse((await get(`/api/v1/activity?organization_id=${orgA}&entity_type=lead&entity_id=${leadId}`, ownerA)).body) as { items: { actor_user_id: string; actor_type: string; impersonation_id: string | null }[] }).items;
    expect(seen.find((e) => e.actor_type === 'platform')).toMatchObject({ actor_user_id: ownerAId, impersonation_id: sessionId });

    const forbidden = async (method: 'POST' | 'PATCH' | 'DELETE', url: string, payload: Record<string, unknown> | undefined, permission: string) => {
      const res = await app!.inject({ method, url, headers: { cookie: superCookie }, ...(payload ? { payload } : {}) });
      expect(res.statusCode, `${method} ${url} → ${res.body}`).toBe(403);
      expect(JSON.parse(res.body)).toMatchObject({ error: { code: 'impersonation_forbidden', details: [{ message: permission }] } });
    };
    await forbidden('PATCH', `/api/v1/members/${colleagueMembership}`, { status: 'revoked' }, 'member:revoke');
    expect((await admin.query<{ status: string }>(`SELECT status FROM memberships WHERE id = $1`, [colleagueMembership])).rows[0]!.status).toBe('active');
    await forbidden('POST', '/api/v1/invitations', { organization_id: orgA, email: `nobody-${run}@dealpilot.test`, roles: ['salesperson'] }, 'member:invite');
    await forbidden('POST', '/api/v1/intake-keys', { organization_id: orgA, label: 'Site web' }, 'intake_key:manage');
    await forbidden('DELETE', `/api/v1/organizations/${orgA}`, undefined, 'organization:delete');
    await forbidden('POST', '/api/v1/organizations', { name: 'Smuggled', slug: `smuggled-${run}` }, 'POST /api/v1/organizations');
    await forbidden('POST', '/api/v1/invitations/accept', { token: 'x'.repeat(40) }, 'POST /api/v1/invitations/accept');
    expect(await count(`SELECT count(*) AS n FROM organizations WHERE slug = $1`, [`smuggled-${run}`])).toBe(0);

    // The scope belt reads the BODY too (a preHandler — in onRequest a body
    // does not exist yet, review): naming the rival is a spoken 403, never a
    // silent 404, and nothing is written.
    const crossTenant = await createLead(superCookie, orgB, storeB);
    expect(crossTenant.statusCode, crossTenant.body).toBe(403);
    expect(JSON.parse(crossTenant.body)).toMatchObject({ error: { code: 'impersonation_scope', details: [{ message: orgA }] } });
    expect(await count(`SELECT count(*) AS n FROM leads WHERE organization_id = $1`, [orgB])).toBe(1);
  });

  it('a read_only tenant still answers 402 to full-mode writes; support may not end a super admin’s session', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await forceStatus(orgA, 'read_only');
    try {
      const write = await createLead(superCookie, orgA, storeA);
      expect(write.statusCode, write.body).toBe(402);
      expect((await get(`/api/v1/leads?organization_id=${orgA}`, superCookie)).statusCode).toBe(200);
    } finally {
      await forceStatus(orgA, 'active');
    }
    const notYours = await end(supportCookie, sessionId);
    expect(notYours.statusCode, notYours.body).toBe(403);
    expect((await end(superCookie, sessionId)).statusCode).toBe(200);
    expect((await row(sessionId)).end_reason).toBe('manual');
  });

  it('a super admin may end a support session; the register says who', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const s = await startedSession(supportCookie, colleagueId);
    const res = await end(superCookie, s.id);
    expect(res.statusCode, res.body).toBe(200);
    expect(ImpersonationSession.parse(JSON.parse(res.body))).toMatchObject({ end_reason: 'manual', ended_by: superId, active: false });
    // Closed by impersonation_end, not by the gate: the support staffer's
    // next request is already the plain staffer — 200, no banner, nothing to
    // be told (the one-time 403 exists only for rows the gate itself closes).
    const told = await get('/api/v1/me', supportCookie);
    expect(told.statusCode, told.body).toBe(200);
    expect(MeResponse.parse(JSON.parse(told.body)).impersonation).toBeNull();
  });
});

describe('every way a session ends', () => {
  it('TTL: an expired row is closed on the next request, once, at its own expiry', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const s = await startedSession(supportCookie, colleagueId);
    // The register refuses rewrites; the clock is moved as the owner with the guard lifted, then restored.
    await admin.query('ALTER TABLE impersonation_sessions DISABLE TRIGGER impersonation_sessions_no_rewrite');
    try {
      await admin.query(`UPDATE impersonation_sessions SET started_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' WHERE id = $1`, [s.id]);
    } finally {
      await admin.query('ALTER TABLE impersonation_sessions ENABLE TRIGGER impersonation_sessions_no_rewrite');
    }
    const told = await get('/api/v1/me', supportCookie);
    expect(told.statusCode, told.body).toBe(403);
    expect(JSON.parse(told.body)).toMatchObject({ error: { code: 'impersonation_ended', details: [{ code: 'ttl', message: s.id }] } });
    const r = await row(s.id);
    expect(r.end_reason).toBe('ttl');
    expect(r.ended_by).toBeNull();
    expect(r.ended_at?.getTime()).toBe(r.expires_at.getTime());
    expect((await get('/api/v1/me', supportCookie)).statusCode).toBe(200);
    expect((await get(`/api/v1/leads?organization_id=${orgA}`, supportCookie)).statusCode).toBe(404);
    expect(ImpersonationSession.parse(JSON.parse((await get(`/api/v1/admin/impersonation-sessions/${s.id}`, supportCookie)).body)).active).toBe(false);
  });

  it('sign-out closes it (the "session" trigger), unsigned', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const s = await startedSession(supportCookie, colleagueId);
    const out = await app!.inject({ method: 'POST', url: '/api/auth/sign-out', headers: { cookie: supportCookie } });
    expect(out.statusCode, out.body).toBe(200);
    expect(await row(s.id)).toMatchObject({ end_reason: 'revoked', ended_by: null });
    supportCookie = await signInWithTotp(app!, supportEmail, PASSWORD, supportSecret);
    expect(MeResponse.parse(JSON.parse((await get('/api/v1/me', supportCookie)).body)).impersonation).toBeNull();
  });

  it('revoking the staffer closes it, signed by the revoker', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const email = `f71-support2-${run}@dealpilot.test`;
    const { cookie } = await staffer(email, 'Soutien 2', 'platform_support', superId);
    const s = await startedSession(cookie, colleagueId);
    const revoke = await app!.inject({ method: 'DELETE', url: `/api/v1/admin/staff/${await userId(email)}`, headers: { cookie: superCookie } });
    expect(revoke.statusCode, revoke.body).toBe(204);
    expect(await row(s.id)).toMatchObject({ end_reason: 'revoked', ended_by: superId });
    expect((await get('/api/v1/me', cookie)).statusCode).toBe(401);
  });

  it('revoking the target’s membership or deleting the tenant closes it on the next request', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const s = await startedSession(supportCookie, colleagueId);
    const revoked = await app!.inject({ method: 'PATCH', url: `/api/v1/members/${colleagueMembership}`, headers: { cookie: ownerA }, payload: { status: 'revoked' } });
    expect(revoked.statusCode, revoked.body).toBe(200);
    try {
      const told = await get('/api/v1/me', supportCookie);
      expect(told.statusCode, told.body).toBe(403);
      expect(JSON.parse(told.body)).toMatchObject({ error: { code: 'impersonation_ended', details: [{ code: 'revoked' }] } });
      expect(await row(s.id)).toMatchObject({ end_reason: 'revoked', ended_by: null });
    } finally {
      expect((await app!.inject({ method: 'PATCH', url: `/api/v1/members/${colleagueMembership}`, headers: { cookie: ownerA }, payload: { status: 'active' } })).statusCode).toBe(200);
    }
    const ownerE = await signUp(`f71-owner-e-${run}@dealpilot.test`, 'Patron E');
    const { orgId: orgE } = await org(ownerE, 'Groupe Epsilon', `groupe-epsilon-${run}`);
    const e = await start(supportCookie, { tenant_id: orgE, target_user_id: await userId(`f71-owner-e-${run}@dealpilot.test`), reason: REASON });
    expect(e.statusCode, e.body).toBe(201);
    expect([200, 204]).toContain((await app!.inject({ method: 'DELETE', url: `/api/v1/organizations/${orgE}`, headers: { cookie: ownerE } })).statusCode);
    expect((await get('/api/v1/me', supportCookie)).statusCode).toBe(403);
    expect((await row((JSON.parse(e.body) as { id: string }).id)).end_reason).toBe('revoked');
  });

  it('suspending the tenant closes it, signed by the actor — and the members’ own sessions with it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const s = await startedSession(supportCookie, colleagueId);
    expect(await count(`SELECT count(*) AS n FROM "session" WHERE "userId" = $1`, [ownerAId])).toBeGreaterThan(0);
    const suspend = await app!.inject({
      method: 'POST', url: `/api/v1/admin/tenants/${orgA}/status`, headers: { cookie: superCookie },
      payload: { status: 'suspended', expected_from: 'active', reason: 'investigation opened', confirm_slug: slugA },
    });
    expect(suspend.statusCode, suspend.body).toBe(200);
    expect(await row(s.id)).toMatchObject({ end_reason: 'revoked', ended_by: superId });
    // …and the members' own sessions with it (the name's second clause).
    expect(await count(`SELECT count(*) AS n FROM "session" WHERE "userId" = $1`, [ownerAId])).toBe(0);
    // Closed explicitly by the transition (not by the gate): the staffer's very
    // next request is already the plain staffer — no tenant, no banner.
    const next = MeResponse.parse(JSON.parse((await get('/api/v1/me', supportCookie)).body));
    expect(next.user.id).toBe(supportId);
    expect(next.impersonation).toBeNull();
    expect((await get(`/api/v1/leads?organization_id=${orgA}`, supportCookie)).statusCode).toBe(404);
    // Back to active for the rest of the suite; the members sign in again (their sessions were revoked by the transition).
    expect((await app!.inject({
      method: 'POST', url: `/api/v1/admin/tenants/${orgA}/status`, headers: { cookie: superCookie },
      payload: { status: 'active', expected_from: 'suspended', reason: 'investigation closed' },
    })).statusCode).toBe(200);
    ownerA = await signIn(ownerAEmail);
  });

  it('re-roling the staffer ends the session — signed by the grant; a raw role edit is caught on the next request', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // (a) The audited path: a second super admin demotes the session's owner.
    const super2Email = `f71-super2-${run}@dealpilot.test`;
    const { cookie: super2 } = await staffer(super2Email, 'Super 2', 'platform_super_admin', superId);
    const super2Id = await userId(super2Email);
    const s = await startedSession(superCookie, ownerAId, { mode: 'full' });
    const demote = await app!.inject({ method: 'POST', url: '/api/v1/admin/staff', headers: { cookie: super2 }, payload: { email: superEmail, role: 'platform_support' } });
    expect(demote.statusCode, demote.body).toBe(201);
    expect(await row(s.id)).toMatchObject({ end_reason: 'revoked', ended_by: super2Id });
    // Closed explicitly by the grant: the demoted staffer's next request is plain.
    expect(MeResponse.parse(JSON.parse((await get('/api/v1/me', superCookie)).body)).impersonation).toBeNull();
    expect((await app!.inject({ method: 'POST', url: '/api/v1/admin/staff', headers: { cookie: super2 }, payload: { email: superEmail, role: 'platform_super_admin' } })).statusCode).toBe(201);
    // (b) The per-request re-proof: a role edited underneath (no grant, no
    // session delete) still loses the session on the very next request —
    // billing may hold none at all.
    const s2 = await startedSession(supportCookie, colleagueId);
    await admin.query(`UPDATE platform_staff SET role = 'platform_billing' WHERE user_id = $1`, [supportId]);
    try {
      const told = await get('/api/v1/me', supportCookie);
      expect(told.statusCode, told.body).toBe(403);
      expect(JSON.parse(told.body)).toMatchObject({ error: { code: 'impersonation_ended', details: [{ code: 'revoked' }] } });
      expect((await row(s2.id)).end_reason).toBe('revoked');
    } finally {
      await admin.query(`UPDATE platform_staff SET role = 'platform_support' WHERE user_id = $1`, [supportId]);
    }
  });
});

describe('transparency and the register’s integrity', () => {
  it('the tenant reads every session on /security: owner yes, a role without activity:read no, another tenant never', async (ctx) => {
    if (!dbUp) return ctx.skip();
    ownerA = await signIn(ownerAEmail);
    const mine = await get(`/api/v1/support-access?organization_id=${orgA}`, ownerA);
    expect(mine.statusCode, mine.body).toBe(200);
    const list = SupportAccessList.parse(JSON.parse(mine.body));
    expect(list.items.length).toBeGreaterThanOrEqual(5);
    expect(list.items.every((s) => s.tenant.id === orgA)).toBe(true);
    expect(list.items.some((s) => s.platform_user.email === supportEmail && s.target_user.email === colleagueEmail)).toBe(true);
    expect(list.items.some((s) => s.platform_user.email === superEmail && s.mode === 'full')).toBe(true);
    expect(list.items.every((s) => !s.active)).toBe(true);
    expect((await get(`/api/v1/support-access?organization_id=${orgA}`, ownerB)).statusCode).toBe(404);
    const noRead = ROLES.find((r) => !(DEFAULT_ROLE_PERMISSIONS[r] ?? []).includes('activity:read'));
    if (noRead) {
      const email = `f71-${noRead}-${run}@dealpilot.test`;
      const cookie = await signUp(email, 'Sans lecture');
      await addMember(ownerA, orgA, email, 'Sans lecture', [noRead]);
      expect((await get(`/api/v1/support-access?organization_id=${orgA}`, cookie)).statusCode).toBe(403);
    }
    // The member picker names the tenant's people and marks platform staff.
    const members = AdminTenantMembers.parse(JSON.parse((await get(`/api/v1/admin/tenants/${orgA}/members`, supportCookie)).body));
    expect(members.items.find((m) => m.user_id === colleagueId)).toMatchObject({ email: colleagueEmail, roles: ['salesperson'], is_platform_staff: false });
    expect(members.items.find((m) => m.email === billingEmail)?.is_platform_staff).toBe(true);
  });

  it('the register and the trail are append-only, even for the owner; the app role holds SELECT and nothing', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const any = (await admin.query<{ id: string }>(`SELECT id FROM impersonation_sessions WHERE ended_at IS NOT NULL LIMIT 1`)).rows[0]!.id;
    await expect(admin.query(`UPDATE impersonation_sessions SET reason = 'rewritten reason of twenty chars' WHERE id = $1`, [any])).rejects.toMatchObject({ code: 'PA000' });
    await expect(admin.query(`UPDATE impersonation_sessions SET ended_at = now() WHERE id = $1`, [any])).rejects.toMatchObject({ code: 'PA000' });
    await expect(admin.query(`DELETE FROM impersonation_sessions WHERE id = $1`, [any])).rejects.toMatchObject({ code: 'PA000' });
    await expect(admin.query(`UPDATE impersonation_requests SET status_code = 200`)).rejects.toMatchObject({ code: 'PA000' });
    await expect(admin.query(`DELETE FROM impersonation_requests`)).rejects.toMatchObject({ code: 'PA000' });
    const grants = await admin.query<{ table_name: string; privilege_type: string }>(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
       WHERE grantee = 'dealpilot_app' AND table_name IN ('impersonation_sessions','impersonation_requests')`,
    );
    expect(grants.rows).toEqual([{ table_name: 'impersonation_sessions', privilege_type: 'SELECT' }]);
  });

  it('the definers re-check their actor; a random session id impersonates nobody', async (ctx) => {
    if (!dbUp) return ctx.skip();
    expect((await appPool.query('SELECT * FROM impersonation_identity($1::text)', [randomUUID()])).rows).toHaveLength(0);
    const call = 'SELECT * FROM impersonation_start($1::uuid, $2::text, $3::text, $4::uuid, $5::uuid, $6::text, $7::text, $8::text, $9::text, $10::int)';
    await expect(appPool.query(call, [ownerAId, ownerAEmail, 'x', orgA, colleagueId, 'read_only', REASON, null, null, 60])).rejects.toMatchObject({ code: 'PA001' });
    await expect(appPool.query(call, [supportId, supportEmail, 'x', orgA, colleagueId, 'full', REASON, null, null, 60])).rejects.toMatchObject({ code: 'PA009' });
    await expect(appPool.query('SELECT impersonation_close($1::uuid, $2, NULL, now())', [randomUUID(), 'manual'])).rejects.toMatchObject({ code: '42501' });
  });
});

describe('lockstep', () => {
  it('core and schemas spell the same modes and end reasons; the blocked list is real permissions; the bell keys render', () => {
    expect([...ImpersonationMode.options]).toEqual([...IMPERSONATION_MODES]);
    expect([...ImpersonationEndReason.options]).toEqual([...IMPERSONATION_END_REASONS]);
    for (const p of IMPERSONATION_BLOCKED_PERMISSIONS) expect(PERMISSIONS as readonly string[]).toContain(p);
    expect(IMPERSONATION_BLOCKED_PERMISSIONS).toContain('member:revoke');
    const sql = readFileSync(join(migrationsDir, '20260827000067_impersonation.sql'), 'utf8');
    const keys = [...sql.matchAll(/'(notif_[a-z_]+)'/g)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(NOTIFICATION_TITLE_KEYS as readonly string[]).toContain(k);
  });
});
