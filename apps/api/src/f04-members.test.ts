import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, reset, type Pool } from '@dealpilot/db';
import { Lead, Member, paginated } from '@dealpilot/schemas';
import { buildApp } from './app.js';

/**
 * F-04 integration suite — team members + lead assignment.
 * Journey: the owner adds a colleague by email with a role → assigns a lead
 * to them → filters "my leads". Negatives: role gates, cross-tenant 404,
 * last-owner protection, assignment to a non-member.
 */

const ADMIN_URL = 'postgresql://dealpilot:dealpilot@localhost:5434/dealpilot';
const APP_URL = 'postgresql://dealpilot_app:dealpilot_app_dev@localhost:5434/dealpilot';
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

  it('adding the same email twice is a 409 conflict', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/members', headers: { cookie: cookieOwner },
      payload: { organization_id: orgId, email: COLLEAGUE_EMAIL, name: 'Sam Again', roles: ['bdc_agent'] },
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
