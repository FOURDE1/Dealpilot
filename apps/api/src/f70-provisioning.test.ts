import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, withTenant, type Pool } from '@dealpilot/db';
import {
  AdminTenantDetail,
  AdminTenantEventsResponse,
  AdminTenantPage,
  AdminTenantProvisioned,
  DEFAULT_ROLE_PERMISSIONS,
  OwnerInvitationReissued,
  PlanList,
  TenantStatusChangeResult,
} from '@dealpilot/schemas';
import { LOST_REASON_DEFAULTS, TRIAL_DAYS } from '@dealpilot/core';
import { buildApp } from './app.js';
import type { EmailMessage } from './email.js';
import { provisioningSeeds } from './org-seeds.js';
import { enrol, signInWithTotp } from './testing/totp.js';

/**
 * F-70 — tenant provisioning (admin-console.md §4.3, D-071). What is worth
 * proving:
 *  - the birth is ONE transaction and equals the self-serve birth row for
 *    row (seeds lockstep), with nothing extra (no users, no business rows);
 *  - the platform never holds tenant context, and the definers re-check
 *    the actor;
 *  - idempotent on slug, atomic on every refusal, safe under a race;
 *  - the owner seat is a real F-12 invitation that a real person accepts
 *    into a WORKING tenant, and the console can re-issue it until then;
 *  - the tenant sees who created it (§12).
 * Every blocked-behaviour case provisions its OWN slug (shared fixtures hide
 * no-op features).
 */

const here = dirname(fileURLToPath(import.meta.url));
const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(here, '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';
const sent: EmailMessage[] = [];

let admin: Pool;
let appPool: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;

let superCookie = ''; let superEmail = ''; let superId = '';
let supportCookie = ''; let supportId = '';
let billingCookie = '';
// A self-serve tenant (F-01) — the reference birth and the non-staff caller.
let refCookie = ''; let refOrg = ''; let refStore = ''; let refSlug = '';
let corePlan = '';

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

async function userId(email: string): Promise<string> {
  return (await admin.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [email])).rows[0]!.id;
}

async function staffer(email: string, name: string, role: string, actor: string | null): Promise<string> {
  const first = await signUp(email, name);
  await admin.query('SELECT * FROM platform_staff_grant($1, $2, $3, $4)', [actor, email, role, 'test fixture']);
  const { secret } = await enrol(app!, first, PASSWORD);
  return signInWithTotp(app!, email, PASSWORD, secret);
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
/** The real seeds, for the definer-direct cases (the checklist vocabulary is CHECKed). */
const SEEDS = JSON.stringify(provisioningSeeds());
const PROVISION_CALL = 'SELECT * FROM admin_provision_tenant($1::uuid, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::text, $7::int, $8::int)';

/** The token from the last invitation email to `to` — the ONLY place it exists outside the hash. */
function tokenFor(to: string): string {
  const mail = [...sent].reverse().find((m) => m.to === to);
  expect(mail, `no invitation email to ${to}`).toBeDefined();
  const m = /\/invitations\/([A-Za-z0-9_-]+)/.exec(mail!.text);
  expect(m).not.toBeNull();
  return m![1]!;
}

function tenantBody(slug: string, over: Record<string, unknown> = {}) {
  return {
    legal_name: `Groupe ${slug} inc.`,
    display_name: `Groupe ${slug}`,
    slug,
    province: 'QC',
    plan_id: corePlan,
    owner_email: `Owner.${slug}@Dealpilot.test`,
    owner_name: 'Alice Propriétaire',
    stores: [
      { name: 'Kia Laval', code: 'kia-lav', province: 'QC', city: 'Laval' },
      { name: 'Kia Ottawa', code: 'KIA-OTT', province: 'ON', timezone: 'America/Toronto' },
    ],
    ...over,
  };
}

async function provision(body: Record<string, unknown>, cookie = superCookie) {
  return app!.inject({ method: 'POST', url: '/api/v1/admin/tenants', headers: { cookie }, payload: body });
}

async function adminGet(url: string, cookie = superCookie) {
  return app!.inject({ method: 'GET', url, headers: { cookie } });
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  return Number((await admin.query<{ n: string }>(sql, params)).rows[0]!.n);
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

  superEmail = `f70-super-${run}@dealpilot.test`;
  superCookie = await staffer(superEmail, 'Super Admin', 'platform_super_admin', null);
  superId = await userId(superEmail);
  supportCookie = await staffer(`f70-support-${run}@dealpilot.test`, 'Soutien', 'platform_support', superId);
  supportId = await userId(`f70-support-${run}@dealpilot.test`);
  billingCookie = await staffer(`f70-billing-${run}@dealpilot.test`, 'Facturation', 'platform_billing', superId);

  refCookie = await signUp(`f70-ref-${run}@dealpilot.test`, 'Patronne Référence');
  refSlug = `groupe-ref-${run}`;
  const o = await app!.inject({ method: 'POST', url: '/api/v1/organizations', headers: { cookie: refCookie }, payload: { name: 'Groupe Référence', slug: refSlug } });
  expect(o.statusCode, o.body).toBe(201);
  refOrg = (JSON.parse(o.body) as { id: string }).id;
  const s = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie: refCookie },
    payload: { organization_id: refOrg, name: 'Référence Laval', code: 'REF-LAV', province: 'QC' },
  });
  expect(s.statusCode, s.body).toBe(201);
  refStore = (JSON.parse(s.body) as { id: string }).id;

  const plans = PlanList.parse(JSON.parse((await adminGet('/api/v1/admin/plans')).body));
  corePlan = plans.items.find((p) => p.code === 'core')!.id;
});

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await admin?.end();
});

describe('the gate (F-70 on the F-69 door)', () => {
  it('a tenant owner gets 404 on both endpoints; support and billing get 403 naming tenants:create', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const body = tenantBody(`gate-${run}`);
    expect((await provision(body, refCookie)).statusCode).toBe(404);
    const reissueAsOwner = await app!.inject({ method: 'POST', url: `/api/v1/admin/tenants/${refOrg}/owner-invitation`, headers: { cookie: refCookie }, payload: { email: 'x@y.test' } });
    expect(reissueAsOwner.statusCode).toBe(404);
    for (const cookie of [supportCookie, billingCookie]) {
      const res = await provision(body, cookie);
      expect(res.statusCode, res.body).toBe(403);
      expect(JSON.parse(res.body)).toMatchObject({ error: { code: 'forbidden', details: [{ message: 'tenants:create' }] } });
      const re = await app!.inject({ method: 'POST', url: `/api/v1/admin/tenants/${refOrg}/owner-invitation`, headers: { cookie }, payload: { email: 'x@y.test' } });
      expect(re.statusCode, re.body).toBe(403);
    }
    // Refused before anything was written.
    expect(await count(`SELECT count(*) AS n FROM organizations WHERE slug = $1`, [body.slug])).toBe(0);
  });
});

describe('the birth (§4.3)', () => {
  let slug = '';
  let orgId = '';
  let invitationId = '';
  let ownerEmail = '';
  let storeIds: string[] = [];
  let registerBefore = 0;

  it('provisions an organization, its stores, the catalogues and the owner seat in one 201', async (ctx) => {
    if (!dbUp) return ctx.skip();
    slug = `groupe-alpha-${run}`;
    const body = tenantBody(slug);
    ownerEmail = body.owner_email.toLowerCase();
    registerBefore = await count(`SELECT count(*) AS n FROM platform_audit_events`);
    const mailsBefore = sent.length;

    const res = await provision(body);
    expect(res.statusCode, res.body).toBe(201);
    const parsed = AdminTenantProvisioned.parse(JSON.parse(res.body));
    const { tenant, invitation } = parsed;
    orgId = tenant.id;
    invitationId = invitation.id;

    expect(tenant).toMatchObject({
      name: body.display_name, slug, legal_name: body.legal_name, province: 'QC', default_locale: 'fr-CA',
      status: 'trial', activated_at: null, suspended_at: null, deleted_at: null,
      plan_id: corePlan, plan_code: 'core', store_count: 2, member_count: 0, owner_emails: [],
      allowed_transitions: ['active', 'suspended'],
    });
    expect(tenant.trial_ends_at).not.toBeNull();
    const trialMs = new Date(tenant.trial_ends_at!).getTime() - Date.now();
    expect(Math.abs(trialMs - TRIAL_DAYS * 86_400_000)).toBeLessThan(60_000);
    expect(tenant.stores.map((s) => s.code)).toEqual(['KIA-LAV', 'KIA-OTT']);
    expect(tenant.owner_invitation).toMatchObject({ id: invitation.id, email: ownerEmail, name: 'Alice Propriétaire', expired: false });

    expect(invitation).toMatchObject({ email: ownerEmail, name: 'Alice Propriétaire', expired: false });
    // The mailer reaches the inbox, so the link is NOT in the response.
    expect(invitation.accept_url).toBeUndefined();
    const ttlMs = new Date(invitation.expires_at).getTime() - Date.now();
    expect(Math.abs(ttlMs - 7 * 86_400_000)).toBeLessThan(60_000);

    // Exactly one email, to the owner, carrying the link whose token hashes to the stored row.
    const mails = sent.slice(mailsBefore);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.to).toBe(ownerEmail);
    const token = tokenFor(ownerEmail);
    const inv = await admin.query<{ id: string; organization_id: string; store_id: string | null; roles: string[]; name: string; invited_by: string; token_hash: string; accepted_at: Date | null; revoked_at: Date | null }>(
      `SELECT * FROM invitations WHERE organization_id = $1`, [orgId],
    );
    expect(inv.rows).toHaveLength(1);
    expect(inv.rows[0]).toMatchObject({ id: invitationId, store_id: null, roles: ['owner'], name: 'Alice Propriétaire', invited_by: superId, accepted_at: null, revoked_at: null });
    expect(inv.rows[0]!.token_hash).toBe(sha256(token));

    // Database facts: stores keep their DEFAULTs, inherit the tenant's locale, and carry what was given.
    const stores = await admin.query<{ id: string; code: string; timezone: string; city: string | null; province: string; default_locale: string; status: string }>(
      `SELECT id, code, timezone, city, province, default_locale, status FROM stores WHERE organization_id = $1 ORDER BY code`, [orgId],
    );
    storeIds = stores.rows.map((s) => s.id);
    expect(stores.rows.map(({ id, ...rest }) => { void id; return rest; })).toEqual([
      { code: 'KIA-LAV', timezone: 'America/Montreal', city: 'Laval', province: 'QC', default_locale: 'fr-CA', status: 'active' },
      { code: 'KIA-OTT', timezone: 'America/Toronto', city: null, province: 'ON', default_locale: 'fr-CA', status: 'active' },
    ]);
    for (const storeId of storeIds) {
      expect(await count(`SELECT count(*) AS n FROM checklist_templates WHERE organization_id = $1 AND store_id = $2 AND required`, [orgId, storeId])).toBe(10);
    }
    const expectedPerms = Object.values(DEFAULT_ROLE_PERMISSIONS).reduce((n, perms) => n + perms.length, 0);
    expect(await count(`SELECT count(*) AS n FROM role_permissions WHERE organization_id = $1`, [orgId])).toBe(expectedPerms);
    const reasons = await admin.query<{ name: string; display_order: number }>(`SELECT name, display_order FROM lost_reasons WHERE organization_id = $1 ORDER BY display_order`, [orgId]);
    expect(reasons.rows).toEqual(LOST_REASON_DEFAULTS.map((r, i) => ({ name: r.name, display_order: i + 1 })));

    // Nothing else: no identity, no membership, no business row, no config row.
    expect(await count(`SELECT count(*) AS n FROM users WHERE email = $1`, [ownerEmail])).toBe(0);
    for (const table of ['memberships', 'leads', 'contacts', 'deals', 'vehicles', 'intake_keys', 'tenant_branding', 'tenant_comms_config', 'drip_sequences', 'lead_scoring_rules', 'lead_assignment_rules']) {
      expect(await count(`SELECT count(*) AS n FROM ${table} WHERE organization_id = $1`, [orgId]), table).toBe(0);
    }
    expect(await count(`SELECT count(*) AS n FROM platform_audit_events`)).toBe(registerBefore);
  });

  it('the seeds equal the self-serve birth row for row (F-01 org + F-01 store)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const perms = (org: string) => admin.query<{ role: string; permission: string }>(`SELECT role, permission FROM role_permissions WHERE organization_id = $1 ORDER BY role, permission`, [org]);
    expect((await perms(orgId)).rows).toEqual((await perms(refOrg)).rows);
    const reasons = (org: string) => admin.query(`SELECT name, name_fr, icon, display_order FROM lost_reasons WHERE organization_id = $1 ORDER BY display_order`, [org]);
    expect((await reasons(orgId)).rows).toEqual((await reasons(refOrg)).rows);
    const checklist = (store: string) => admin.query(`SELECT code, label_fr, label_en, required, overridable, sort_order, active FROM checklist_templates WHERE store_id = $1 ORDER BY sort_order`, [store]);
    const reference = (await checklist(refStore)).rows;
    expect(reference).toHaveLength(10);
    for (const storeId of storeIds) expect((await checklist(storeId)).rows, storeId).toEqual(reference);
  });

  it('the platform wrote through a definer: the app role sees nothing without tenant context, and the definer re-checks its actor', async (ctx) => {
    if (!dbUp) return ctx.skip();
    for (const table of ['role_permissions', 'lost_reasons', 'checklist_templates', 'invitations', 'stores']) {
      const bare = await appPool.query(`SELECT 1 FROM ${table} WHERE organization_id = $1`, [orgId]);
      expect(bare.rows, `${table} visible on a bare connection`).toHaveLength(0);
      const scoped = await withTenant(appPool, orgId, (c) => c.query(`SELECT 1 FROM ${table} WHERE organization_id = $1`, [orgId]));
      expect(scoped.rows.length, `${table} under tenant context`).toBeGreaterThan(0);
    }
    const refOwnerId = await userId(`f70-ref-${run}@dealpilot.test`);
    const args = [JSON.stringify({ slug: `x-${run}`, display_name: 'X', legal_name: 'X', province: 'QC', default_locale: 'fr-CA', plan_id: corePlan }), '[{"name":"S","code":"S-1","province":"QC","timezone":"America/Montreal"}]', '{"email":"x@y.test","name":"X"}', SEEDS, 'a'.repeat(64), 14, 7];
    const call = 'SELECT * FROM admin_provision_tenant($1::uuid, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::text, $7::int, $8::int)';
    await expect(appPool.query(call, [refOwnerId, ...args])).rejects.toMatchObject({ code: 'PA001' });
    await expect(appPool.query(call, [supportId, ...args])).rejects.toMatchObject({ code: 'PA009' });
    expect(await count(`SELECT count(*) AS n FROM organizations WHERE slug = $1`, [`x-${run}`])).toBe(0);
  });

  it('the tenant sees who created it (§12): organization, stores and the seat in its journal, none restricted', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const feed = await adminGet(`/api/v1/admin/tenants/${orgId}/events`);
    expect(feed.statusCode, feed.body).toBe(200);
    const events = AdminTenantEventsResponse.parse(JSON.parse(feed.body)).items;
    expect(events.every((e) => e.actor_type === 'platform' && e.actor_email === superEmail && !e.restricted)).toBe(true);
    const org = events.find((e) => e.entity_type === 'organization' && e.action === 'created');
    expect(org?.changes).toMatchObject({ status: { from: null, to: 'trial' }, slug: { from: null, to: slug }, plan_id: { to: corePlan } });
    const stores = events.filter((e) => e.entity_type === 'store' && e.action === 'created');
    expect(stores.map((e) => e.store_id).sort()).toEqual([...storeIds].sort());
    expect(stores.every((e) => e.parent_entity_type === 'organization' && e.parent_entity_id === orgId)).toBe(true);
    const seat = events.find((e) => e.entity_type === 'invitation' && e.action === 'created');
    expect(seat?.entity_id).toBe(invitationId);
    expect(seat?.changes).toMatchObject({ email: ownerEmail, roles: { to: ['owner'] } });
    expect(events).toHaveLength(4);
  });

  it('a second call with the same slug is a 409 pointing at the tenant, and writes nothing', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const before = {
      orgs: await count(`SELECT count(*) AS n FROM organizations`),
      stores: await count(`SELECT count(*) AS n FROM stores WHERE organization_id = $1`, [orgId]),
      invitations: await count(`SELECT count(*) AS n FROM invitations WHERE organization_id = $1`, [orgId]),
      events: await count(`SELECT count(*) AS n FROM activity_events WHERE organization_id = $1`, [orgId]),
      mails: sent.length,
    };
    const again = await provision(tenantBody(slug, { owner_email: `someone-else-${run}@dealpilot.test` }));
    expect(again.statusCode, again.body).toBe(409);
    expect(JSON.parse(again.body)).toMatchObject({ error: { code: 'slug_taken', details: [{ path: 'slug', code: 'slug_taken', message: orgId }] } });
    expect(await count(`SELECT count(*) AS n FROM organizations`)).toBe(before.orgs);
    expect(await count(`SELECT count(*) AS n FROM stores WHERE organization_id = $1`, [orgId])).toBe(before.stores);
    expect(await count(`SELECT count(*) AS n FROM invitations WHERE organization_id = $1`, [orgId])).toBe(before.invitations);
    expect(await count(`SELECT count(*) AS n FROM activity_events WHERE organization_id = $1`, [orgId])).toBe(before.events);
    expect(sent.length).toBe(before.mails);

    // A self-serve slug answers the same way …
    const selfServe = await provision(tenantBody(refSlug));
    expect(selfServe.statusCode, selfServe.body).toBe(409);
    expect(JSON.parse(selfServe.body)).toMatchObject({ error: { details: [{ message: refOrg }] } });
    // … and so does a soft-deleted one (the slug is UNIQUE regardless, O-13).
    const gone = await signUp(`f70-gone-${run}@dealpilot.test`, 'Parti');
    const goneSlug = `groupe-parti-${run}`;
    const created = await app!.inject({ method: 'POST', url: '/api/v1/organizations', headers: { cookie: gone }, payload: { name: 'Groupe Parti', slug: goneSlug } });
    const goneId = (JSON.parse(created.body) as { id: string }).id;
    const del = await app!.inject({ method: 'DELETE', url: `/api/v1/organizations/${goneId}`, headers: { cookie: gone } });
    expect([200, 204]).toContain(del.statusCode);
    const reuse = await provision(tenantBody(goneSlug));
    expect(reuse.statusCode, reuse.body).toBe(409);
    expect(JSON.parse(reuse.body)).toMatchObject({ error: { details: [{ message: goneId }] } });
    // The console link lands on a tenant that shows the deleted chip.
    const detail = AdminTenantDetail.parse(JSON.parse((await adminGet(`/api/v1/admin/tenants/${goneId}`)).body));
    expect(detail.deleted_at).not.toBeNull();
  });

  it('two concurrent births of one slug: exactly one 201, and the 409 names the winner', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const raceSlug = `groupe-course-${run}`;
    const [a, b] = await Promise.all([provision(tenantBody(raceSlug)), provision(tenantBody(raceSlug))]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes, `${a.body}\n${b.body}`).toEqual([201, 409]);
    const won = a.statusCode === 201 ? a : b;
    const lost = a.statusCode === 201 ? b : a;
    const winner = AdminTenantProvisioned.parse(JSON.parse(won.body)).tenant.id;
    expect(JSON.parse(lost.body)).toMatchObject({ error: { code: 'slug_taken', details: [{ message: winner }] } });
    expect(await count(`SELECT count(*) AS n FROM organizations WHERE slug = $1`, [raceSlug])).toBe(1);
    expect(await count(`SELECT count(*) AS n FROM invitations WHERE organization_id = $1`, [winner])).toBe(1);
  });

  it('a birth that loses on organizations_slug_key itself (past the pre-check) answers the same PA011, naming the winner', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Deterministic: the winner's row is UNCOMMITTED when the loser pre-checks
    // (invisible), so the loser reaches the INSERT and blocks on the unique
    // index; the commit wakes it into the EXCEPTION branch (review).
    const slug = `groupe-verrou-${run}`;
    const holder = await admin.connect();
    try {
      await holder.query('BEGIN');
      const winner = (await holder.query<{ id: string }>(`INSERT INTO organizations (name, slug) VALUES ('Vainqueur', $1) RETURNING id`, [slug])).rows[0]!.id;
      const loser = appPool
        .query(PROVISION_CALL, [
          superId, JSON.stringify({ slug, display_name: 'Perdant', legal_name: 'Perdant inc.', province: 'QC', default_locale: 'fr-CA', plan_id: corePlan }),
          '[{"name":"A","code":"V-1","province":"QC","timezone":"America/Montreal"}]', '{"email":"v@dealpilot.test","name":"V"}', SEEDS, 'f'.repeat(64), 14, 7,
        ])
        .then(() => null, (e: unknown) => e as { code?: string; detail?: string });
      // Give the loser time to pre-check and block on the index before the commit.
      await new Promise((r) => setTimeout(r, 400));
      await holder.query('COMMIT');
      const outcome = await loser;
      expect(outcome, 'the loser must not have provisioned').not.toBeNull();
      expect(outcome).toMatchObject({ code: 'PA011', detail: winner });
      expect(await count(`SELECT count(*) AS n FROM organizations WHERE slug = $1`, [slug])).toBe(1);
      expect(await count(`SELECT count(*) AS n FROM invitations WHERE organization_id = $1`, [winner])).toBe(0);
    } finally {
      holder.release();
    }
  });

  it('the owner accepts the seat into a WORKING trial tenant, and only as the invited address', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Still on trial: what the owner lands in is the tenant provisioning births.
    expect((await admin.query<{ status: string }>(`SELECT status FROM organizations WHERE id = $1`, [orgId])).rows[0]!.status).toBe('trial');
    const token = tokenFor(ownerEmail);
    const stranger = await signUp(`f70-stranger-${run}@dealpilot.test`, 'Inconnu');
    const wrong = await app!.inject({ method: 'POST', url: '/api/v1/invitations/accept', headers: { cookie: stranger }, payload: { token } });
    expect(wrong.statusCode, wrong.body).toBe(403);
    expect(JSON.parse(wrong.body)).toMatchObject({ error: { code: 'wrong_account' } });

    const owner = await signUp(ownerEmail, 'Alice Propriétaire');
    const preview = await app!.inject({ method: 'POST', url: '/api/v1/invitations/preview', payload: { token } });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(JSON.parse(preview.body)).toMatchObject({ organization_name: `Groupe ${slug}`, email: ownerEmail, roles: ['owner'] });
    const accepted = await app!.inject({ method: 'POST', url: '/api/v1/invitations/accept', headers: { cookie: owner }, payload: { token } });
    expect(accepted.statusCode, accepted.body).toBe(201);
    expect(JSON.parse(accepted.body)).toMatchObject({ organization_id: orgId });

    const orgs = await app!.inject({ method: 'GET', url: '/api/v1/organizations', headers: { cookie: owner } });
    expect((JSON.parse(orgs.body) as { items: { id: string }[] }).items.map((o) => o.id)).toContain(orgId);
    const stores = await app!.inject({ method: 'GET', url: `/api/v1/stores?organization_id=${orgId}`, headers: { cookie: owner } });
    expect(stores.statusCode, stores.body).toBe(200);
    expect((JSON.parse(stores.body) as { items: { code: string }[] }).items.map((s) => s.code).sort()).toEqual(['KIA-LAV', 'KIA-OTT']);
    const lead = await app!.inject({
      method: 'POST', url: '/api/v1/leads', headers: { cookie: owner },
      payload: { organization_id: orgId, store_id: storeIds[0], first_name: 'Premier', phone: '(819) 555-0100', source: 'manual' },
    });
    expect(lead.statusCode, lead.body).toBe(201);

    // The console now sees an owner and no open seat.
    const detail = AdminTenantDetail.parse(JSON.parse((await adminGet(`/api/v1/admin/tenants/${orgId}`)).body));
    expect(detail).toMatchObject({ owner_emails: [ownerEmail], member_count: 1, owner_invitation: null });
    // §12: the tenant reads the same birth rows the console does.
    const trail = await app!.inject({ method: 'GET', url: `/api/v1/activity?organization_id=${orgId}&limit=50`, headers: { cookie: owner } });
    expect(trail.statusCode, trail.body).toBe(200);
    const items = (JSON.parse(trail.body) as { items: { entity_type: string; action: string; actor_type: string }[] }).items;
    expect(items.filter((e) => e.actor_type === 'platform' && e.action === 'created').map((e) => e.entity_type).sort()).toEqual(['invitation', 'organization', 'store', 'store']);

    // Once an owner is active, the console can no longer re-issue the seat: F-12 is the door.
    const late = await app!.inject({ method: 'POST', url: `/api/v1/admin/tenants/${orgId}/owner-invitation`, headers: { cookie: superCookie }, payload: { email: 'another@dealpilot.test' } });
    expect(late.statusCode, late.body).toBe(409);
    expect(JSON.parse(late.body)).toMatchObject({ error: { code: 'owner_exists' } });
  });

  it('lists in the directory with its clock; trial → active stamps activated_at and keeps the clock', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const page = AdminTenantPage.parse(JSON.parse((await adminGet('/api/v1/admin/tenants?status=trial')).body));
    const row = page.items.find((t) => t.id === orgId);
    expect(row?.trial_ends_at).not.toBeNull();
    const activated = await app!.inject({
      method: 'POST', url: `/api/v1/admin/tenants/${orgId}/status`, headers: { cookie: superCookie },
      payload: { status: 'active', expected_from: 'trial', reason: 'contract signed' },
    });
    expect(activated.statusCode, activated.body).toBe(200);
    const after = TenantStatusChangeResult.parse(JSON.parse(activated.body));
    expect(after.status).toBe('active');
    expect(after.activated_at).not.toBeNull();
    expect(after.trial_ends_at).toBe(row?.trial_ends_at);
  });
});

describe('refusals are atomic (§4.3 validation)', () => {
  it('a fixed-offset timezone is refused by ROW before anything is written', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const slug = `groupe-est-${run}`;
    const res = await provision(tenantBody(slug, { stores: [{ name: 'S', code: 'S-1', province: 'QC', timezone: 'EST' }] }));
    expect(res.statusCode, res.body).toBe(422);
    expect(JSON.parse(res.body)).toMatchObject({ error: { details: [{ path: 'stores.0.timezone', code: 'unknown_timezone' }] } });
    expect(await count(`SELECT count(*) AS n FROM organizations WHERE slug = $1`, [slug])).toBe(0);
  });

  it('an inactive plan is refused with nothing written', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const slug = `groupe-plan-${run}`;
    const scale = (await admin.query<{ id: string }>(`SELECT id FROM plans WHERE code = 'scale'`)).rows[0]!.id;
    await admin.query(`UPDATE plans SET active = false WHERE id = $1`, [scale]);
    try {
      const res = await provision(tenantBody(slug, { plan_id: scale }));
      expect(res.statusCode, res.body).toBe(422);
      expect(JSON.parse(res.body)).toMatchObject({ error: { details: [{ path: 'plan_id', code: 'unknown_plan' }] } });
      const unknown = await provision(tenantBody(slug, { plan_id: randomUUID() }));
      expect(unknown.statusCode, unknown.body).toBe(422);
    } finally {
      await admin.query(`UPDATE plans SET active = true WHERE id = $1`, [scale]);
    }
    expect(await count(`SELECT count(*) AS n FROM organizations WHERE slug = $1`, [slug])).toBe(0);
  });

  it('a duplicate store code names the row; the definer refuses it too and rolls the birth back', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const slug = `groupe-dup-${run}`;
    const res = await provision(tenantBody(slug, { stores: [{ name: 'A', code: 'KIA-ML', province: 'QC' }, { name: 'B', code: 'kia-ml', province: 'QC' }] }));
    expect(res.statusCode, res.body).toBe(422);
    expect(JSON.parse(res.body)).toMatchObject({ error: { details: [{ path: 'stores.1.code', code: 'duplicate_store_code' }] } });
    // Past Zod (a caller that is not this schema): the definer's own guard.
    const call = 'SELECT * FROM admin_provision_tenant($1::uuid, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::text, $7::int, $8::int)';
    const tenant = JSON.stringify({ slug, display_name: 'Dup', legal_name: 'Dup inc.', province: 'QC', default_locale: 'fr-CA', plan_id: corePlan });
    await expect(
      appPool.query(call, [superId, tenant, '[{"name":"A","code":"KIA-ML","province":"QC","timezone":"America/Montreal"},{"name":"B","code":"KIA-ML","province":"QC","timezone":"America/Montreal"}]', '{"email":"d@dealpilot.test","name":"D"}', SEEDS, 'b'.repeat(64), 14, 7]),
    ).rejects.toMatchObject({ code: 'PA012', detail: 'KIA-ML' });
    expect(await count(`SELECT count(*) AS n FROM organizations WHERE slug = $1`, [slug])).toBe(0);
    // An empty payload is a caller bug the definer refuses on its own.
    await expect(
      appPool.query(call, [superId, tenant, '[]', '{"email":"d@dealpilot.test","name":"D"}', SEEDS, 'c'.repeat(64), 14, 7]),
    ).rejects.toMatchObject({ code: 'PA014' });
    await expect(
      appPool.query(call, [superId, tenant, '[{"name":"A","code":"KIA-ML","province":"QC","timezone":"America/Montreal"}]', '{"email":"d@dealpilot.test","name":"D"}', '{"role_permissions":[],"lost_reasons":[],"checklist":[]}', 'd'.repeat(64), 14, 7]),
    ).rejects.toMatchObject({ code: 'PA014' });
    expect(await count(`SELECT count(*) AS n FROM organizations WHERE slug = $1`, [slug])).toBe(0);
  });

  it('a reserved slug and a body with unknown keys are refused by the schema', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const reserved = await provision(tenantBody('admin'));
    expect(reserved.statusCode, reserved.body).toBe(422);
    expect(JSON.parse(reserved.body)).toMatchObject({ error: { details: [{ path: 'slug', code: 'org_slug_reserved' }] } });
    const smuggled = await provision(tenantBody(`groupe-smuggle-${run}`, { status: 'active' }));
    expect(smuggled.statusCode, smuggled.body).toBe(422);
    expect(await count(`SELECT count(*) AS n FROM organizations WHERE slug = $1`, [`groupe-smuggle-${run}`])).toBe(0);
  });

  it('mutation test of the id boundary: an id smuggled into the tenant payload is ignored', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const slug = `groupe-id-${run}`;
    const smuggled = randomUUID();
    const r = await appPool.query<{ organization_id: string; store_ids: string[] }>(
      'SELECT * FROM admin_provision_tenant($1::uuid, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::text, $7::int, $8::int)',
      [superId, JSON.stringify({ id: smuggled, organization_id: smuggled, slug, display_name: 'Id', legal_name: 'Id inc.', province: 'QC', default_locale: 'fr-CA', plan_id: corePlan }),
        JSON.stringify([{ id: smuggled, organization_id: refOrg, name: 'A', code: 'ID-1', province: 'QC', timezone: 'America/Montreal' }]),
        '{"email":"id@dealpilot.test","name":"Id"}', SEEDS, 'e'.repeat(64), 14, 7],
    );
    const born = r.rows[0]!;
    expect(born.organization_id).not.toBe(smuggled);
    expect(born.store_ids[0]).not.toBe(smuggled);
    expect(await count(`SELECT count(*) AS n FROM stores WHERE organization_id = $1 AND code = 'ID-1'`, [born.organization_id])).toBe(1);
    expect(await count(`SELECT count(*) AS n FROM stores WHERE organization_id = $1 AND code = 'ID-1'`, [refOrg])).toBe(0);
  });
});

describe('the owner seat is recoverable until it is taken', () => {
  it('re-issuing revokes every open owner seat, sends a new link to the corrected address, and journals both', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const slug = `groupe-reissue-${run}`;
    const born = AdminTenantProvisioned.parse(JSON.parse((await provision(tenantBody(slug))).body));
    const orgId = born.tenant.id;
    const corrected = `owner-corrected-${run}@dealpilot.test`;
    const mailsBefore = sent.length;
    const res = await app!.inject({
      method: 'POST', url: `/api/v1/admin/tenants/${orgId}/owner-invitation`, headers: { cookie: superCookie },
      payload: { email: corrected.toUpperCase(), name: 'Alice Corrigée' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const reissued = OwnerInvitationReissued.parse(JSON.parse(res.body));
    expect(reissued).toMatchObject({ email: corrected, name: 'Alice Corrigée', expired: false, revoked_invitation_ids: [born.invitation.id] });
    expect(reissued.accept_url).toBeUndefined();
    expect(sent.length).toBe(mailsBefore + 1);
    expect(sent[sent.length - 1]!.to).toBe(corrected);

    const rows = await admin.query<{ id: string; email: string; revoked_at: Date | null; token_hash: string }>(`SELECT id, email, revoked_at, token_hash FROM invitations WHERE organization_id = $1 ORDER BY created_at`, [orgId]);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]).toMatchObject({ id: born.invitation.id });
    expect(rows.rows[0]!.revoked_at).not.toBeNull();
    expect(rows.rows[1]).toMatchObject({ id: reissued.id, email: corrected, revoked_at: null });
    expect(rows.rows[1]!.token_hash).toBe(sha256(tokenFor(corrected)));
    const detail = AdminTenantDetail.parse(JSON.parse((await adminGet(`/api/v1/admin/tenants/${orgId}`)).body));
    expect(detail.owner_invitation).toMatchObject({ id: reissued.id, email: corrected, expired: false });

    const events = AdminTenantEventsResponse.parse(JSON.parse((await adminGet(`/api/v1/admin/tenants/${orgId}/events`)).body)).items;
    const revokedRow = events.find((e) => e.entity_type === 'invitation' && e.action === 'revoked');
    expect(revokedRow?.entity_id).toBe(born.invitation.id);
    expect(revokedRow?.changes).toEqual({ email: born.invitation.email });
    const fresh = events.find((e) => e.entity_type === 'invitation' && e.action === 'created' && e.entity_id === reissued.id);
    expect(fresh?.changes).toMatchObject({ reissued: true, email: corrected });

    // The old link is dead; the new one previews.
    const dead = await app!.inject({ method: 'POST', url: '/api/v1/invitations/preview', payload: { token: tokenFor(born.invitation.email) } });
    expect(dead.statusCode).toBe(404);
    const alive = await app!.inject({ method: 'POST', url: '/api/v1/invitations/preview', payload: { token: tokenFor(corrected) } });
    expect(alive.statusCode, alive.body).toBe(200);

    const missing = await app!.inject({ method: 'POST', url: `/api/v1/admin/tenants/${randomUUID()}/owner-invitation`, headers: { cookie: superCookie }, payload: { email: corrected } });
    expect(missing.statusCode).toBe(404);
  });

  it('when the mailer cannot reach the invitee, the link comes back in the response (CR-05)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const logOnly = await buildApp(
      { DATABASE_URL: APP_URL, NODE_ENV: 'test' },
      {
        rateLimiter: { take: async () => ({ allowed: true, retryAfterS: 0 }), close: async () => {} },
        mailer: { deliversToRecipient: false, async send() { return true; } },
      },
    );
    try {
      const slug = `groupe-log-${run}`;
      const res = await logOnly.app.inject({ method: 'POST', url: '/api/v1/admin/tenants', headers: { cookie: superCookie }, payload: tenantBody(slug) });
      expect(res.statusCode, res.body).toBe(201);
      const { tenant, invitation } = AdminTenantProvisioned.parse(JSON.parse(res.body));
      expect(invitation.accept_url).toMatch(/^http:\/\/localhost:5173\/invitations\/[A-Za-z0-9_-]{20,}$/);
      const token = invitation.accept_url!.split('/invitations/')[1]!;
      const hash = (await admin.query<{ token_hash: string }>(`SELECT token_hash FROM invitations WHERE id = $1`, [invitation.id])).rows[0]!.token_hash;
      expect(hash).toBe(sha256(token));
      const again = await logOnly.app.inject({ method: 'POST', url: `/api/v1/admin/tenants/${tenant.id}/owner-invitation`, headers: { cookie: superCookie }, payload: { email: `other-${run}@dealpilot.test` } });
      expect(again.statusCode, again.body).toBe(201);
      expect(OwnerInvitationReissued.parse(JSON.parse(again.body)).accept_url).toContain('/invitations/');
    } finally {
      await logOnly.app.close();
    }
  });
});

describe('lockstep', () => {
  it('both invitation issuers hash the token through ONE module', () => {
    for (const file of ['f12-invitation-routes.ts', 'f70-provisioning-routes.ts']) {
      const source = readFileSync(join(here, file), 'utf8');
      expect(source, file).toMatch(/import \{[^}]*\bhashToken\b[^}]*\} from '\.\/invitation-token\.js'/);
      expect(source, `${file} defines its own hash`).not.toMatch(/createHash\(/);
    }
  });
});
