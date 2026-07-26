import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { PERMISSIONS } from '@dealpilot/schemas';
import { buildApp } from './app.js';

/**
 * A-13 RBAC (owner decision D-033).
 *
 * The owner asked for "RBAC controlling roles, and for each role what it can do
 * of actions". These tests are about the thing he actually wanted: that the
 * matrix is the truth — change it, and what people can do changes with it.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';

let admin: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let ownerCookie = '';
let sellerCookie = '';
let sellerId = '';
let orgId = '';
let storeId = '';

async function signUp(email: string, name: string) {
  const res = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email', payload: { email, password: PASSWORD, name },
  });
  const sc = res.headers['set-cookie'];
  return (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');
}

/** The salesperson tries to stock a car — a manager's job by default. */
async function sellerCreatesVehicle() {
  return app!.inject({
    method: 'POST', url: '/api/v1/vehicles', headers: { cookie: sellerCookie },
    payload: {
      organization_id: orgId, store_id: storeId, stock_number: `RB-${Math.random().toString(36).slice(2, 8)}`,
      year: 2022, make: 'Kia', model: 'Forte', acquisition_type: 'trade_in',
    },
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

  ownerCookie = await signUp(`a13-owner-${run}@dealpilot.test`, 'Alice Owner');
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie: ownerCookie },
    payload: { name: 'Groupe A13', slug: `groupe-a13-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie: ownerCookie },
    payload: { organization_id: orgId, name: 'A13 Kia', code: 'A13-KIA', province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;

  const sellerEmail = `a13-seller-${run}@dealpilot.test`;
  sellerCookie = await signUp(sellerEmail, 'Sam Seller');
  const me = await app!.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: sellerCookie } });
  sellerId = (JSON.parse(me.body) as { user: { id: string } }).user.id;
  await admin.query(
    `INSERT INTO users (id, email, name, status) VALUES ($1,$2,'Sam Seller','active') ON CONFLICT (id) DO NOTHING`,
    [sellerId, sellerEmail],
  );
  await admin.query(
    `INSERT INTO memberships (user_id, organization_id, store_id, roles) VALUES ($1,$2,NULL,'{salesperson}')`,
    [sellerId, orgId],
  );
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('A-13 RBAC', () => {
  it('a new organization is seeded, and the matrix answers "what can a role do?"', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'GET', url: `/api/v1/permissions?organization_id=${orgId}`, headers: { cookie: ownerCookie },
    });
    expect(res.statusCode).toBe(200);
    const { matrix, permissions } = JSON.parse(res.body) as {
      matrix: Record<string, string[]>; permissions: string[];
    };
    // This is the question the owner could not get an answer to before.
    expect(permissions).toHaveLength(PERMISSIONS.length);
    expect(matrix['owner']).toHaveLength(PERMISSIONS.length);
    expect(matrix['bdc_agent']).toContain('lead:assign');
    expect(matrix['bdc_agent']).not.toContain('pay_plan:write');
    expect(matrix['salesperson']).not.toContain('commission:read_all');
  });

  it('a salesperson is refused a manager action', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await sellerCreatesVehicle();
    expect(res.statusCode).toBe(403);
    // 403, not 404: they are a real colleague, and the message should send them
    // to their manager rather than make them think the page is broken.
    expect(JSON.parse(res.body).error.code).toBe('forbidden');
  });

  it('GRANTING it on the matrix changes what they can do — no deploy', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const current = await app!.inject({
      method: 'GET', url: `/api/v1/permissions?organization_id=${orgId}`, headers: { cookie: ownerCookie },
    });
    const salesperson = (JSON.parse(current.body) as { matrix: Record<string, string[]> }).matrix['salesperson']!;

    const put = await app!.inject({
      method: 'PUT', url: '/api/v1/permissions/role', headers: { cookie: ownerCookie },
      payload: { organization_id: orgId, role: 'salesperson', permissions: [...salesperson, 'vehicle:create'] },
    });
    expect(put.statusCode).toBe(200);

    // The whole point of the feature: the matrix IS the rule.
    expect((await sellerCreatesVehicle()).statusCode).toBe(201);

    // And revoking it takes the power straight back.
    await app!.inject({
      method: 'PUT', url: '/api/v1/permissions/role', headers: { cookie: ownerCookie },
      payload: { organization_id: orgId, role: 'salesperson', permissions: salesperson },
    });
    expect((await sellerCreatesVehicle()).statusCode).toBe(403);
  });

  it('a per-user override grants one person an exception', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'PUT', url: '/api/v1/permissions/user', headers: { cookie: ownerCookie },
      payload: {
        organization_id: orgId, user_id: sellerId, permission: 'vehicle:create',
        allowed: true, reason: 'Sam also runs the lot on weekends',
      },
    });
    expect(res.statusCode).toBe(204);
    expect((await sellerCreatesVehicle()).statusCode).toBe(201);
  });

  it('an override can also DENY, which a role change cannot do for one person', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await app!.inject({
      method: 'PUT', url: '/api/v1/permissions/user', headers: { cookie: ownerCookie },
      payload: {
        organization_id: orgId, user_id: sellerId, permission: 'deal:create',
        allowed: false, reason: 'Under review after a pricing incident',
      },
    });
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/deals', headers: { cookie: sellerCookie },
      payload: {
        organization_id: orgId, store_id: storeId, province: 'QC',
        sale_price_cents: 1_000_000, vehicle_cost_cents: 900_000, interest_rate_bps: 599, term_months: 60,
      },
    });
    // Their whole role still allows it; this one person does not.
    expect(res.statusCode).toBe(403);

    // Clearing the override puts them back to their role's default.
    await app!.inject({
      method: 'PUT', url: '/api/v1/permissions/user', headers: { cookie: ownerCookie },
      payload: { organization_id: orgId, user_id: sellerId, permission: 'deal:create', allowed: null },
    });
    const after = await app!.inject({
      method: 'POST', url: '/api/v1/deals', headers: { cookie: sellerCookie },
      payload: {
        organization_id: orgId, store_id: storeId, province: 'QC',
        sale_price_cents: 1_000_000, vehicle_cost_cents: 900_000, interest_rate_bps: 599, term_months: 60,
      },
    });
    expect(after.statusCode).toBe(201);
  });

  it('the owner cannot lock themselves out of the permissions screen', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'PUT', url: '/api/v1/permissions/role', headers: { cookie: ownerCookie },
      payload: { organization_id: orgId, role: 'owner', permissions: ['deal:create'] },
    });
    // There would be no way back without a database console.
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('would_lock_out');
  });

  it('a salesperson cannot rewrite the matrix', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'PUT', url: '/api/v1/permissions/role', headers: { cookie: sellerCookie },
      payload: { organization_id: orgId, role: 'salesperson', permissions: [...PERMISSIONS] },
    });
    // Otherwise the whole thing is decoration.
    expect(res.statusCode).toBe(403);
  });

  it('/permissions/mine tells the UI what to show', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'GET', url: `/api/v1/permissions/mine?organization_id=${orgId}`, headers: { cookie: sellerCookie },
    });
    expect(res.statusCode).toBe(200);
    const { permissions } = JSON.parse(res.body) as { permissions: string[] };
    expect(permissions).toContain('deal:create');
    expect(permissions).not.toContain('pay_plan:write');
  });

  it('another organization cannot read or change this matrix', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const rivalCookie = await signUp(`a13-rival-${run}@dealpilot.test`, 'Rival Owner');
    await app!.inject({
      method: 'POST', url: '/api/v1/organizations', headers: { cookie: rivalCookie },
      payload: { name: 'Rival Motors', slug: `rival-a13-${run}` },
    });

    // 404, never 403: a cross-tenant id must not confirm it exists.
    const read = await app!.inject({
      method: 'GET', url: `/api/v1/permissions?organization_id=${orgId}`, headers: { cookie: rivalCookie },
    });
    expect(read.statusCode).toBe(404);

    const write = await app!.inject({
      method: 'PUT', url: '/api/v1/permissions/role', headers: { cookie: rivalCookie },
      payload: { organization_id: orgId, role: 'salesperson', permissions: [...PERMISSIONS] },
    });
    expect([403, 404]).toContain(write.statusCode);

    // And nothing of ours moved.
    const still = await admin.query<{ n: string }>(
      `SELECT count(*) AS n FROM role_permissions WHERE organization_id = $1 AND role = 'salesperson'`,
      [orgId],
    );
    expect(Number(still.rows[0]!.n)).toBeLessThan(PERMISSIONS.length);
  });

  it('deny by default: an organization with no matrix grants nothing', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // The safe direction to fail. A seeding bug must lock people out, not open
    // the doors. Clear the per-user override too — it is deliberately the most
    // specific statement about a person and would (correctly) still grant.
    await admin.query(`DELETE FROM role_permissions WHERE organization_id = $1`, [orgId]);
    await admin.query(`DELETE FROM user_permissions WHERE organization_id = $1`, [orgId]);
    const res = await sellerCreatesVehicle();
    expect(res.statusCode).toBe(403);
  });
});
