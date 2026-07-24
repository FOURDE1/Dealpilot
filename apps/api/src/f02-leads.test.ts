import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, reset, type Pool } from '@dealpilot/db';
import { Lead, paginated } from '@dealpilot/schemas';
import { buildApp } from './app.js';

/**
 * F-02 integration suite — lead pipeline end to end through the app role
 * (FORCE RLS) with real sessions. Journey = what the owner will click:
 * create a lead in a store → it appears in the list → change its status.
 * Negatives from a second real account: cross-tenant 404, role gates on
 * delete, engine-owned fields rejected.
 */

const ADMIN_URL = 'postgresql://dealpilot:dealpilot@localhost:5434/dealpilot';
const APP_URL = 'postgresql://dealpilot_app:dealpilot_app_dev@localhost:5434/dealpilot';
const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'packages', 'db', 'migrations',
);

const run = Date.now().toString(36);
const A = { email: `f02-owner-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Alice Owner' };
const B = { email: `f02-second-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Bob Second' };

let admin: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookieA = '';
let cookieB = '';
let userBId = '';
let orgId = '';
let storeId = '';
let leadId = '';

const LeadPage = paginated(Lead);

async function signUp(user: { email: string; password: string; name: string }) {
  const res = await app!.inject({ method: 'POST', url: '/api/auth/sign-up/email', payload: user });
  expect(res.statusCode).toBe(200);
  const setCookie = res.headers['set-cookie'];
  const cookie = (Array.isArray(setCookie) ? setCookie : [setCookie!])
    .map((c) => c!.split(';')[0])
    .join('; ');
  return { cookie, id: (JSON.parse(res.body) as { user: { id: string } }).user.id };
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
  ({ cookie: cookieA } = await signUp(A));
  ({ cookie: cookieB, id: userBId } = await signUp(B));

  const org = await app!.inject({
    method: 'POST',
    url: '/api/v1/organizations',
    headers: { cookie: cookieA },
    payload: { name: 'Groupe F02', slug: `groupe-f02-${run}` },
  });
  expect(org.statusCode).toBe(201);
  orgId = (JSON.parse(org.body) as { id: string }).id;

  const store = await app!.inject({
    method: 'POST',
    url: '/api/v1/stores',
    headers: { cookie: cookieA },
    payload: { organization_id: orgId, name: 'F02 Kia', code: 'F02-KIA', province: 'QC' },
  });
  expect(store.statusCode).toBe(201);
  storeId = (JSON.parse(store.body) as { id: string }).id;
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('F-02 leads', () => {
  it('a member creates a lead — born new, phone normalized, FR default', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'POST',
      url: '/api/v1/leads',
      headers: { cookie: cookieA },
      payload: {
        organization_id: orgId,
        store_id: storeId,
        phone: '514 555 0134',
        source: 'walk_in',
        first_name: 'Marc',
        vehicle_interest: 'Kia Sportage 2026',
      },
    });
    expect(res.statusCode).toBe(201);
    const lead = Lead.parse(JSON.parse(res.body));
    expect(lead.status).toBe('new');
    expect(lead.phone).toBe('+15145550134');
    expect(lead.preferred_language).toBe('fr-CA');
    expect(lead.score).toBeNull();
    leadId = lead.id;
  });

  it('status and score are not accepted on create (strict schema)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    for (const extra of [{ status: 'qualified' }, { score: 90 }]) {
      const res = await app!.inject({
        method: 'POST',
        url: '/api/v1/leads',
        headers: { cookie: cookieA },
        payload: { organization_id: orgId, store_id: storeId, phone: '5145550135', source: 'manual', ...extra },
      });
      expect(res.statusCode).toBe(422);
    }
  });

  it('a store from ANOTHER org is rejected (same-org composite FK path → 422)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const otherOrg = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: { cookie: cookieB },
      payload: { name: 'Groupe B', slug: `groupe-b-${run}` },
    });
    const otherOrgId = (JSON.parse(otherOrg.body) as { id: string }).id;
    const res = await app!.inject({
      method: 'POST',
      url: '/api/v1/leads',
      headers: { cookie: cookieB },
      payload: { organization_id: otherOrgId, store_id: storeId, phone: '5145550136', source: 'manual' },
    });
    expect([404, 422]).toContain(res.statusCode);
  });

  it('list is org-scoped with optional store and status filters', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const list = await app!.inject({
      method: 'GET',
      url: `/api/v1/leads?organization_id=${orgId}`,
      headers: { cookie: cookieA },
    });
    expect(list.statusCode).toBe(200);
    const page = LeadPage.parse(JSON.parse(list.body));
    expect(page.items.map((l) => l.id)).toContain(leadId);

    const filtered = await app!.inject({
      method: 'GET',
      url: `/api/v1/leads?organization_id=${orgId}&store_id=${storeId}&status=new`,
      headers: { cookie: cookieA },
    });
    expect(LeadPage.parse(JSON.parse(filtered.body)).items).toHaveLength(1);

    const none = await app!.inject({
      method: 'GET',
      url: `/api/v1/leads?organization_id=${orgId}&status=lost`,
      headers: { cookie: cookieA },
    });
    expect(LeadPage.parse(JSON.parse(none.body)).items).toHaveLength(0);
  });

  it('a non-member sees nothing: get is 404, list of that org is 404', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const get = await app!.inject({ method: 'GET', url: `/api/v1/leads/${leadId}`, headers: { cookie: cookieB } });
    expect(get.statusCode).toBe(404);
    const list = await app!.inject({
      method: 'GET',
      url: `/api/v1/leads?organization_id=${orgId}`,
      headers: { cookie: cookieB },
    });
    expect(list.statusCode).toBe(404);
  });

  it('status changes via PATCH; assigned_to must be an org member', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const ok = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/leads/${leadId}`,
      headers: { cookie: cookieA },
      payload: { status: 'contacted' },
    });
    expect(ok.statusCode).toBe(200);
    expect(Lead.parse(JSON.parse(ok.body)).status).toBe('contacted');

    const badAssign = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/leads/${leadId}`,
      headers: { cookie: cookieA },
      payload: { assigned_to: userBId }, // B is not a member of this org
    });
    expect(badAssign.statusCode).toBe(422);
  });

  it('cross-org PATCH/DELETE of a foreign lead is 404; PATCH score is 422', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const patch = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/leads/${leadId}`,
      headers: { cookie: cookieB }, // B is not a member yet
      payload: { status: 'lost' },
    });
    expect(patch.statusCode).toBe(404);
    const del = await app!.inject({ method: 'DELETE', url: `/api/v1/leads/${leadId}`, headers: { cookie: cookieB } });
    expect(del.statusCode).toBe(404);
    const score = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/leads/${leadId}`,
      headers: { cookie: cookieA },
      payload: { score: 99 },
    });
    expect(score.statusCode).toBe(422);
  });

  it('a salesperson member can create and update but NOT delete (403)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await admin.query(
      `INSERT INTO users (id, email, name, status) VALUES ($1, $2, $3, 'active') ON CONFLICT (id) DO NOTHING`,
      [userBId, B.email, B.name],
    );
    await admin.query(
      `INSERT INTO memberships (user_id, organization_id, store_id, roles) VALUES ($1, $2, NULL, '{salesperson}')`,
      [userBId, orgId],
    );
    const create = await app!.inject({
      method: 'POST',
      url: '/api/v1/leads',
      headers: { cookie: cookieB },
      payload: { organization_id: orgId, store_id: storeId, phone: '5145550137', source: 'phone' },
    });
    expect(create.statusCode).toBe(201);

    const del = await app!.inject({ method: 'DELETE', url: `/api/v1/leads/${leadId}`, headers: { cookie: cookieB } });
    expect(del.statusCode).toBe(403);
  });

  it('owner soft-deletes: gone from list/get, deleted_at set, repeat 404', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const del = await app!.inject({ method: 'DELETE', url: `/api/v1/leads/${leadId}`, headers: { cookie: cookieA } });
    expect(del.statusCode).toBe(204);
    const get = await app!.inject({ method: 'GET', url: `/api/v1/leads/${leadId}`, headers: { cookie: cookieA } });
    expect(get.statusCode).toBe(404);
    const again = await app!.inject({ method: 'DELETE', url: `/api/v1/leads/${leadId}`, headers: { cookie: cookieA } });
    expect(again.statusCode).toBe(404);
    const row = await admin.query(`SELECT deleted_at FROM leads WHERE id = $1`, [leadId]);
    expect(row.rows[0].deleted_at).not.toBeNull();
  });
});
