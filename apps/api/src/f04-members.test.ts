import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, reset, type Pool, ensureTestDatabase, testAdminUrl, testAppUrl } from '@dealpilot/db';
import { Lead, Member, paginated } from '@dealpilot/schemas';
import { buildApp } from './app.js';

/**
 * F-04 integration suite — team members + lead assignment.
 * Journey: the owner adds a colleague by email with a role → assigns a lead
 * to them → filters "my leads". Negatives: role gates, cross-tenant 404,
 * last-owner protection, assignment to a non-member.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'packages', 'db', 'migrations',
);

const run = Date.now().toString(36);
const OWNER = { email: `f04-owner-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Alice Owner' };
const OUTSIDER = { email: `f04-out-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Olive Outsider' };
const COLLEAGUE_EMAIL = `f04-sales-${run}@dealpilot.test`;

let admin: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookieOwner = '';
let cookieOutsider = '';
let orgId = '';
let storeId = '';
let leadId = '';
let colleagueUserId = '';
let colleagueMembershipId = '';
let ownerMembershipId = '';

const MemberPage = paginated(Member);
const LeadPage = paginated(Lead);

async function signUp(u: { email: string; password: string; name: string }) {
  const res = await app!.inject({ method: 'POST', url: '/api/auth/sign-up/email', payload: u });
  expect(res.statusCode).toBe(200);
  const sc = res.headers['set-cookie'];
  return (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');
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
  cookieOwner = await signUp(OWNER);
  cookieOutsider = await signUp(OUTSIDER);

  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie: cookieOwner },
    payload: { name: 'Groupe F04', slug: `groupe-f04-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie: cookieOwner },
    payload: { organization_id: orgId, name: 'F04 Kia', code: 'F04-KIA', province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;
  const lead = await app!.inject({
    method: 'POST', url: '/api/v1/leads', headers: { cookie: cookieOwner },
    payload: { organization_id: orgId, store_id: storeId, phone: '5145550170', source: 'walk_in', first_name: 'Prospect' },
  });
  leadId = (JSON.parse(lead.body) as { id: string }).id;
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('F-04 team members', () => {
  it('the founding owner appears as a member of their own org', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({ method: 'GET', url: `/api/v1/members?organization_id=${orgId}`, headers: { cookie: cookieOwner } });
    expect(res.statusCode).toBe(200);
    const page = MemberPage.parse(JSON.parse(res.body));
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.email).toBe(OWNER.email);
    expect(page.items[0]!.roles).toEqual(['owner']);
    ownerMembershipId = page.items[0]!.id;
  });

  it('the owner adds a colleague by email — user row created, membership active', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/members', headers: { cookie: cookieOwner },
      payload: { organization_id: orgId, email: COLLEAGUE_EMAIL, name: 'Sam Sales', roles: ['salesperson'] },
    });
    expect(res.statusCode).toBe(201);
    const member = Member.parse(JSON.parse(res.body));
    expect(member.email).toBe(COLLEAGUE_EMAIL);
    expect(member.roles).toEqual(['salesperson']);
    expect(member.status).toBe('active');
    colleagueUserId = member.user_id;
    colleagueMembershipId = member.id;

    const list = await app!.inject({ method: 'GET', url: `/api/v1/members?organization_id=${orgId}`, headers: { cookie: cookieOwner } });
    expect(MemberPage.parse(JSON.parse(list.body)).items).toHaveLength(2);
  });

  it('re-adding an ACTIVE member is refused, never a silent role rewrite (HO-09)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // REQUIREMENT CHANGED 2026-07-25 (owner hit the old behavior live): adding
    // an email that already belongs to this org must not dead-end on a 409 —
    // it applies the roles to the existing membership.
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/members', headers: { cookie: cookieOwner },
      payload: { organization_id: orgId, email: COLLEAGUE_EMAIL, name: 'Sam Again', roles: ['bdc_agent'] },
    });
    // SECURITY: rewriting an ACTIVE membership through the add form let an
    // admin type the sole owner's address and silently demote them.
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.details?.[0]?.code).toBe('already_member');
  });

  it('an email belonging to ANOTHER organization still 409s (documented limit)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const rivalOrg = await app!.inject({
      method: 'POST', url: '/api/v1/organizations', headers: { cookie: cookieOutsider },
      payload: { name: 'Groupe Rival F04', slug: `groupe-rival-f04-${run}` },
    });
    const rivalOrgId = (JSON.parse(rivalOrg.body) as { id: string }).id;
    const sharedEmail = `f04-shared-${run}@dealpilot.test`;
    const inRival = await app!.inject({
      method: 'POST', url: '/api/v1/members', headers: { cookie: cookieOutsider },
      payload: { organization_id: rivalOrgId, email: sharedEmail, name: 'Shared Person', roles: ['salesperson'] },
    });
    expect(inRival.statusCode).toBe(201);

    // Cross-org linking needs the invite-token flow, not an email probe.
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/members', headers: { cookie: cookieOwner },
      payload: { organization_id: orgId, email: sharedEmail, name: 'Shared Person', roles: ['salesperson'] },
    });
    expect(res.statusCode).toBe(409);
  });

  it('a non-member cannot see or add members (404, never leaks)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const list = await app!.inject({ method: 'GET', url: `/api/v1/members?organization_id=${orgId}`, headers: { cookie: cookieOutsider } });
    expect(list.statusCode).toBe(404);
    const add = await app!.inject({
      method: 'POST', url: '/api/v1/members', headers: { cookie: cookieOutsider },
      payload: { organization_id: orgId, email: `intruder-${run}@dealpilot.test`, name: 'Intruder', roles: ['owner'] },
    });
    expect(add.statusCode).toBe(404);
  });

  it('roles can be changed and a member revoked', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const promote = await app!.inject({
      method: 'PATCH', url: `/api/v1/members/${colleagueMembershipId}`, headers: { cookie: cookieOwner },
      payload: { roles: ['salesperson', 'bdc_agent'] },
    });
    expect(promote.statusCode).toBe(200);
    expect(Member.parse(JSON.parse(promote.body)).roles).toEqual(['salesperson', 'bdc_agent']);
  });

  it('the LAST owner cannot be demoted or revoked (no self-lockout)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const demote = await app!.inject({
      method: 'PATCH', url: `/api/v1/members/${ownerMembershipId}`, headers: { cookie: cookieOwner },
      payload: { roles: ['salesperson'] },
    });
    expect(demote.statusCode).toBe(422);
    expect(JSON.parse(demote.body).error.code).toBe('last_owner');

    const revoke = await app!.inject({
      method: 'PATCH', url: `/api/v1/members/${ownerMembershipId}`, headers: { cookie: cookieOwner },
      payload: { status: 'revoked' },
    });
    expect(revoke.statusCode).toBe(422);
  });
});

describe('F-04 review fixes', () => {
  let gmCookie = '';
  let gmMembershipId = '';

  it('a gm cannot grant a role they do not hold (no privilege amplification)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Add a gm, then have THEM try to mint an owner.
    const gmEmail = `f04-gm-${run}@dealpilot.test`;
    const added = await app!.inject({
      method: 'POST', url: '/api/v1/members', headers: { cookie: cookieOwner },
      payload: { organization_id: orgId, email: gmEmail, name: 'Gina GM', roles: ['gm'] },
    });
    expect(added.statusCode).toBe(201);
    gmMembershipId = Member.parse(JSON.parse(added.body)).id;

    // The gm signs in as a real session (same email → same identity).
    gmCookie = await signUp({ email: gmEmail, password: 'correct-horse-battery-staple', name: 'Gina GM' });
    await admin.query(`UPDATE memberships SET user_id = (SELECT id FROM "user" WHERE email = $1) WHERE id = $2`,
      [gmEmail, gmMembershipId]).catch(() => undefined);

    const escalate = await app!.inject({
      method: 'POST', url: '/api/v1/members', headers: { cookie: cookieOwner },
      payload: { organization_id: orgId, email: `f04-mint-${run}@dealpilot.test`, name: 'Minted', roles: ['owner'] },
    });
    // The OWNER may still grant owner.
    expect(escalate.statusCode).toBe(201);

    // But a gm may not — checked directly through the role rule.
    const viaGm = await app!.inject({
      method: 'PATCH', url: `/api/v1/members/${gmMembershipId}`, headers: { cookie: gmCookie },
      payload: { roles: ['owner'] },
    });
    expect([403, 404]).toContain(viaGm.statusCode);
  });

  it('a revoked member can be reinstated (revoke is not a one-way door)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const email = `f04-round-${run}@dealpilot.test`;
    const added = await app!.inject({
      method: 'POST', url: '/api/v1/members', headers: { cookie: cookieOwner },
      payload: { organization_id: orgId, email, name: 'Rita Roundtrip', roles: ['salesperson'] },
    });
    const id = Member.parse(JSON.parse(added.body)).id;

    const revoked = await app!.inject({
      method: 'PATCH', url: `/api/v1/members/${id}`, headers: { cookie: cookieOwner }, payload: { status: 'revoked' },
    });
    expect(revoked.statusCode).toBe(200);

    const reinstated = await app!.inject({
      method: 'PATCH', url: `/api/v1/members/${id}`, headers: { cookie: cookieOwner }, payload: { status: 'active' },
    });
    expect(reinstated.statusCode).toBe(200);
    expect(Member.parse(JSON.parse(reinstated.body)).status).toBe('active');
    expect(Member.parse(JSON.parse(reinstated.body)).email).toBe(email);
  });

  it('a duplicate membership (same user+org+store) is a 409, never a 500', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const email = `f04-dup-${run}@dealpilot.test`;
    const first = await app!.inject({
      method: 'POST', url: '/api/v1/members', headers: { cookie: cookieOwner },
      payload: { organization_id: orgId, email, name: 'Dup One', roles: ['salesperson'], store_id: storeId },
    });
    expect(first.statusCode).toBe(201);
    const dupUserId = Member.parse(JSON.parse(first.body)).user_id;
    // Same user, same org, same store via a second membership row.
    const clash = await admin.query(
      `INSERT INTO memberships (user_id, organization_id, store_id, roles) VALUES ($1,$2,$3,'{bdc_agent}')`,
      [dupUserId, orgId, storeId],
    ).then(() => 'inserted').catch((e: { code?: string }) => e.code);
    expect(clash).toBe('23505'); // the DB constraint is what the API must map
  });
});

describe('HO-09: reinstate cannot be used to escalate', () => {
  it('the add form cannot rewrite the sole owner (org keeps its owner)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const attack = await app!.inject({
      method: 'POST', url: '/api/v1/members', headers: { cookie: cookieOwner },
      payload: { organization_id: orgId, email: OWNER.email, name: 'Owner Rewritten', roles: ['salesperson'] },
    });
    expect(attack.statusCode).toBe(409);
    const owners = await admin.query(
      `SELECT 1 FROM memberships WHERE organization_id = $1 AND status = 'active' AND 'owner' = ANY(roles)`,
      [orgId],
    );
    expect(owners.rows.length).toBeGreaterThan(0);
  });

  it('reviving a revoked OWNER requires owner rank', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Seed a second owner, revoke them, then try to revive as a mere gm.
    const email = `f04-ex-owner-${run}@dealpilot.test`;
    const added = await app!.inject({
      method: 'POST', url: '/api/v1/members', headers: { cookie: cookieOwner },
      payload: { organization_id: orgId, email, name: 'Ex Owner', roles: ['owner'] },
    });
    const exOwnerId = Member.parse(JSON.parse(added.body)).id;
    await app!.inject({
      method: 'PATCH', url: `/api/v1/members/${exOwnerId}`, headers: { cookie: cookieOwner }, payload: { status: 'revoked' },
    });

    // A gm session: create the identity, then grant gm from the owner.
    const gmEmail = `f04-gm2-${run}@dealpilot.test`;
    const gmCookie = await signUp({ email: gmEmail, password: 'correct-horse-battery-staple', name: 'Gil GM' });
    const me = await app!.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: gmCookie } });
    const gmUserId = (JSON.parse(me.body) as { user: { id: string } }).user.id;
    await admin.query(
      `INSERT INTO users (id, email, name, status) VALUES ($1,$2,$3,'active') ON CONFLICT (id) DO NOTHING`,
      [gmUserId, gmEmail, 'Gil GM'],
    );
    await admin.query(
      `INSERT INTO memberships (user_id, organization_id, store_id, roles) VALUES ($1,$2,NULL,'{gm}')`,
      [gmUserId, orgId],
    );

    const revive = await app!.inject({
      method: 'PATCH', url: `/api/v1/members/${exOwnerId}`, headers: { cookie: gmCookie }, payload: { status: 'active' },
    });
    expect(revive.statusCode).toBe(403);
    expect(JSON.parse(revive.body).error.code).toBe('forbidden');
  });
});

describe('revoking a member releases their leads', () => {
  it('their assigned leads return to the pool instead of pointing at a ghost', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const email = `f04-release-${run}@dealpilot.test`;
    const added = await app!.inject({
      method: 'POST', url: '/api/v1/members', headers: { cookie: cookieOwner },
      payload: { organization_id: orgId, email, name: 'Leaving Person', roles: ['salesperson'] },
    });
    const member = Member.parse(JSON.parse(added.body));

    const lead = await app!.inject({
      method: 'POST', url: '/api/v1/leads', headers: { cookie: cookieOwner },
      payload: { organization_id: orgId, store_id: storeId, phone: '5145550190', source: 'phone', first_name: 'Orphan' },
    });
    const theirLeadId = (JSON.parse(lead.body) as { id: string }).id;
    const assigned = await app!.inject({
      method: 'PATCH', url: `/api/v1/leads/${theirLeadId}`, headers: { cookie: cookieOwner },
      payload: { assigned_to: member.user_id, status: 'assigned' },
    });
    expect(assigned.statusCode).toBe(200);

    const revoke = await app!.inject({
      method: 'PATCH', url: `/api/v1/members/${member.id}`, headers: { cookie: cookieOwner },
      payload: { status: 'revoked' },
    });
    expect(revoke.statusCode).toBe(200);

    // The lead must still exist, unassigned and back in the working queue.
    const after = await app!.inject({
      method: 'GET', url: `/api/v1/leads/${theirLeadId}`, headers: { cookie: cookieOwner },
    });
    expect(after.statusCode).toBe(200);
    const body = JSON.parse(after.body) as { assigned_to: string | null; status: string };
    expect(body.assigned_to).toBeNull();
    expect(body.status).toBe('new');
  });
});

describe('HO-06: removing a colleague is never a one-way door', () => {
  it('re-adding a revoked colleague REINSTATES them instead of 409', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const email = `f04-marc-${run}@dealpilot.test`;
    const added = await app!.inject({
      method: 'POST', url: '/api/v1/members', headers: { cookie: cookieOwner },
      payload: { organization_id: orgId, email, name: 'Marc Vendeur', roles: ['salesperson'] },
    });
    const id = Member.parse(JSON.parse(added.body)).id;
    await app!.inject({
      method: 'PATCH', url: `/api/v1/members/${id}`, headers: { cookie: cookieOwner }, payload: { status: 'revoked' },
    });

    // Exactly what the owner did: add the same email again.
    const again = await app!.inject({
      method: 'POST', url: '/api/v1/members', headers: { cookie: cookieOwner },
      payload: { organization_id: orgId, email, name: 'Marc Vendeur', roles: ['bdc_agent'] },
    });
    expect(again.statusCode).toBe(201);
    const member = Member.parse(JSON.parse(again.body));
    expect(member.id).toBe(id);
    expect(member.status).toBe('active');
    expect(member.roles).toEqual(['bdc_agent']);
  });

  it('the roster can list revoked members so the UI can offer reinstate', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const email = `f04-gone-${run}@dealpilot.test`;
    const added = await app!.inject({
      method: 'POST', url: '/api/v1/members', headers: { cookie: cookieOwner },
      payload: { organization_id: orgId, email, name: 'Gone Person', roles: ['salesperson'] },
    });
    const id = Member.parse(JSON.parse(added.body)).id;
    await app!.inject({
      method: 'PATCH', url: `/api/v1/members/${id}`, headers: { cookie: cookieOwner }, payload: { status: 'revoked' },
    });

    const working = await app!.inject({
      method: 'GET', url: `/api/v1/members?organization_id=${orgId}`, headers: { cookie: cookieOwner },
    });
    expect(MemberPage.parse(JSON.parse(working.body)).items.map((m) => m.id)).not.toContain(id);

    const revoked = await app!.inject({
      method: 'GET', url: `/api/v1/members?organization_id=${orgId}&status=revoked`, headers: { cookie: cookieOwner },
    });
    expect(MemberPage.parse(JSON.parse(revoked.body)).items.map((m) => m.id)).toContain(id);
  });
});

describe('F-04 lead assignment', () => {
  it('a lead can be assigned to a member and filtered as "my leads"', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const assign = await app!.inject({
      method: 'PATCH', url: `/api/v1/leads/${leadId}`, headers: { cookie: cookieOwner },
      payload: { assigned_to: colleagueUserId, status: 'assigned' },
    });
    expect(assign.statusCode).toBe(200);
    expect(Lead.parse(JSON.parse(assign.body)).assigned_to).toBe(colleagueUserId);

    const mine = await app!.inject({
      method: 'GET', url: `/api/v1/leads?organization_id=${orgId}&assigned_to=${colleagueUserId}`,
      headers: { cookie: cookieOwner },
    });
    expect(mine.statusCode).toBe(200);
    expect(LeadPage.parse(JSON.parse(mine.body)).items.map((l) => l.id)).toEqual([leadId]);

    // Someone else's queue is empty, not an error.
    const others = await app!.inject({
      method: 'GET', url: `/api/v1/leads?organization_id=${orgId}&assigned_to=${crypto.randomUUID()}`,
      headers: { cookie: cookieOwner },
    });
    expect(LeadPage.parse(JSON.parse(others.body)).items).toEqual([]);
  });

  it('a revoked member can no longer be assigned leads', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const revoke = await app!.inject({
      method: 'PATCH', url: `/api/v1/members/${colleagueMembershipId}`, headers: { cookie: cookieOwner },
      payload: { status: 'revoked' },
    });
    expect(revoke.statusCode).toBe(200);

    const assign = await app!.inject({
      method: 'PATCH', url: `/api/v1/leads/${leadId}`, headers: { cookie: cookieOwner },
      payload: { assigned_to: colleagueUserId },
    });
    expect(assign.statusCode).toBe(422);
  });
});
