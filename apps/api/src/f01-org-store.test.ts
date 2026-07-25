import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, reset, type Pool, ensureTestDatabase, testAdminUrl, testAppUrl } from '@dealpilot/db';
import { Organization, Store, paginated } from '@dealpilot/schemas';
import { buildApp } from './app.js';

/**
 * F-01 integration suite — organization & store administration end to end
 * against the real database THROUGH the app role (FORCE RLS applies), real
 * Better Auth sessions, real HTTP semantics via inject.
 *
 * Journey under test = what the owner will click: sign up → create an
 * organization (creator becomes owner) → add/edit stores → soft-delete.
 * Every negative is tested from a SECOND real account: cross-tenant reads are
 * 404 (existence never leaked), writes need owner/gm, revocation kills access.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'packages', 'db', 'migrations',
);

const run = Date.now().toString(36);
const A = { email: `owner-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Alice Owner' };
const B = { email: `second-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Bob Second' };

let admin: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookieA = '';
let cookieB = '';
let userAId = '';
let userBId = '';
let orgId = '';
let storeId = '';

const OrgPage = paginated(Organization);
const StorePage = paginated(Store);

async function signUp(user: { email: string; password: string; name: string }): Promise<{ cookie: string; id: string }> {
  const res = await app!.inject({ method: 'POST', url: '/api/auth/sign-up/email', payload: user });
  expect(res.statusCode).toBe(200);
  const setCookie = res.headers['set-cookie'];
  const cookie = (Array.isArray(setCookie) ? setCookie : [setCookie!])
    .map((c) => c!.split(';')[0])
    .join('; ');
  const id = (JSON.parse(res.body) as { user: { id: string } }).user.id;
  return { cookie, id };
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
  ({ cookie: cookieA, id: userAId } = await signUp(A));
  ({ cookie: cookieB, id: userBId } = await signUp(B));
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('F-01 organizations', () => {
  it('an authenticated user creates an organization and becomes its owner', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: { cookie: cookieA },
      payload: { name: 'Groupe Alice', slug: `groupe-alice-${run}` },
    });
    expect(res.statusCode).toBe(201);
    const org = Organization.parse(JSON.parse(res.body));
    expect(org.name).toBe('Groupe Alice');
    expect(org.status).toBe('active');
    orgId = org.id;

    const membership = await admin.query(
      `SELECT roles, status FROM memberships WHERE user_id = $1 AND organization_id = $2`,
      [userAId, orgId],
    );
    expect(membership.rows).toHaveLength(1);
    expect(membership.rows[0].roles).toEqual(['owner']);
    expect(membership.rows[0].status).toBe('active');
  });

  it('rejects reserved slugs with a validation error', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: { cookie: cookieA },
      payload: { name: 'Reserved', slug: 'admin' },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('validation_failed');
  });

  it('duplicate slug is a 409 conflict', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: { cookie: cookieB },
      payload: { name: 'Copycat', slug: `groupe-alice-${run}` },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('conflict');
  });

  it('list returns only the caller’s organizations', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const forA = await app!.inject({ method: 'GET', url: '/api/v1/organizations', headers: { cookie: cookieA } });
    expect(forA.statusCode).toBe(200);
    const pageA = OrgPage.parse(JSON.parse(forA.body));
    expect(pageA.items.map((o) => o.id)).toEqual([orgId]);

    const forB = await app!.inject({ method: 'GET', url: '/api/v1/organizations', headers: { cookie: cookieB } });
    expect(forB.statusCode).toBe(200);
    expect(OrgPage.parse(JSON.parse(forB.body)).items).toEqual([]);
  });

  it('a non-member gets 404 for the org — existence is never leaked', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({ method: 'GET', url: `/api/v1/organizations/${orgId}`, headers: { cookie: cookieB } });
    expect(res.statusCode).toBe(404);
  });

  it('the owner updates the organization; slug is immutable', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const ok = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/organizations/${orgId}`,
      headers: { cookie: cookieA },
      payload: { name: 'Groupe Alice Automobile' },
    });
    expect(ok.statusCode).toBe(200);
    expect(Organization.parse(JSON.parse(ok.body)).name).toBe('Groupe Alice Automobile');

    const slugChange = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/organizations/${orgId}`,
      headers: { cookie: cookieA },
      payload: { slug: 'new-slug-attempt' },
    });
    expect(slugChange.statusCode).toBe(422);
  });
});

describe('F-01 stores', () => {
  it('the owner creates a store in their organization', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'POST',
      url: '/api/v1/stores',
      headers: { cookie: cookieA },
      payload: { organization_id: orgId, name: 'Alice Kia Laval', code: 'AKL-1', province: 'QC' },
    });
    expect(res.statusCode).toBe(201);
    const store = Store.parse(JSON.parse(res.body));
    expect(store.organization_id).toBe(orgId);
    expect(store.code).toBe('AKL-1');
    storeId = store.id;
  });

  it('a non-member creating a store in that org gets 404 (never leaks)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'POST',
      url: '/api/v1/stores',
      headers: { cookie: cookieB },
      payload: { organization_id: orgId, name: 'Sneaky', code: 'SNEAK-1', province: 'QC' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('store list defaults to the caller’s only organization', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({ method: 'GET', url: '/api/v1/stores', headers: { cookie: cookieA } });
    expect(res.statusCode).toBe(200);
    const page = StorePage.parse(JSON.parse(res.body));
    expect(page.items.map((s) => s.id)).toEqual([storeId]);

    const forB = await app!.inject({ method: 'GET', url: '/api/v1/stores', headers: { cookie: cookieB } });
    expect(forB.statusCode).toBe(200);
    expect(StorePage.parse(JSON.parse(forB.body)).items).toEqual([]);
  });

  it('get + update work for members with owner/gm; cross-tenant get is 404', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const got = await app!.inject({ method: 'GET', url: `/api/v1/stores/${storeId}`, headers: { cookie: cookieA } });
    expect(got.statusCode).toBe(200);

    const updated = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/stores/${storeId}`,
      headers: { cookie: cookieA },
      payload: { name: 'Alice Kia Laval Centre', phone: '514 555 0199' },
    });
    expect(updated.statusCode).toBe(200);
    const store = Store.parse(JSON.parse(updated.body));
    expect(store.name).toBe('Alice Kia Laval Centre');
    expect(store.phone).toBe('+15145550199');

    const crossTenant = await app!.inject({ method: 'GET', url: `/api/v1/stores/${storeId}`, headers: { cookie: cookieB } });
    expect(crossTenant.statusCode).toBe(404);
  });

  it('a salesperson member can read but not write (403, not 404)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await admin.query(
      `INSERT INTO users (id, email, name, status) VALUES ($1, $2, $3, 'active')
       ON CONFLICT (id) DO NOTHING`,
      [userBId, B.email, B.name],
    );
    await admin.query(
      `INSERT INTO memberships (user_id, organization_id, store_id, roles) VALUES ($1, $2, NULL, '{salesperson}')`,
      [userBId, orgId],
    );

    const read = await app!.inject({ method: 'GET', url: `/api/v1/organizations/${orgId}`, headers: { cookie: cookieB } });
    expect(read.statusCode).toBe(200);

    const orgWrite = await app!.inject({
      method: 'PATCH',
      url: `/api/v1/organizations/${orgId}`,
      headers: { cookie: cookieB },
      payload: { name: 'Hostile Rename' },
    });
    expect(orgWrite.statusCode).toBe(403);
    expect(JSON.parse(orgWrite.body).error.code).toBe('forbidden');

    const storeWrite = await app!.inject({
      method: 'POST',
      url: '/api/v1/stores',
      headers: { cookie: cookieB },
      payload: { organization_id: orgId, name: 'Not Allowed', code: 'NOPE-1', province: 'QC' },
    });
    expect(storeWrite.statusCode).toBe(403);
  });

  it('soft delete: store disappears from list and get, row keeps deleted_at', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const del = await app!.inject({ method: 'DELETE', url: `/api/v1/stores/${storeId}`, headers: { cookie: cookieA } });
    expect(del.statusCode).toBe(204);

    const got = await app!.inject({ method: 'GET', url: `/api/v1/stores/${storeId}`, headers: { cookie: cookieA } });
    expect(got.statusCode).toBe(404);

    const list = await app!.inject({ method: 'GET', url: '/api/v1/stores', headers: { cookie: cookieA } });
    expect(StorePage.parse(JSON.parse(list.body)).items).toEqual([]);

    const row = await admin.query(`SELECT deleted_at FROM stores WHERE id = $1`, [storeId]);
    expect(row.rows[0].deleted_at).not.toBeNull();
  });

  it('invalid cursor is a 400 with a stable code', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'GET',
      url: '/api/v1/organizations?cursor=not-a-cursor',
      headers: { cookie: cookieA },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('invalid_cursor');
  });

  it('unauthenticated requests to F-01 routes stay 401', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({ method: 'GET', url: '/api/v1/organizations' });
    expect(res.statusCode).toBe(401);
  });
});

describe('F-01 multi-org', () => {
  it('the same user can create a second organization (domain user row already exists)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: { cookie: cookieA },
      payload: { name: 'Groupe Alice Deux', slug: `groupe-alice-deux-${run}` },
    });
    expect(res.statusCode).toBe(201);

    const list = await app!.inject({ method: 'GET', url: '/api/v1/organizations', headers: { cookie: cookieA } });
    const page = OrgPage.parse(JSON.parse(list.body));
    expect(page.items).toHaveLength(2);
    expect(page.items[0]!.name).toBe('Groupe Alice Deux'); // newest first
  });

  it('store list without a selector requires organization_id when the caller has several orgs', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({ method: 'GET', url: '/api/v1/stores', headers: { cookie: cookieA } });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('organization_required');

    const scoped = await app!.inject({
      method: 'GET',
      url: `/api/v1/stores?organization_id=${orgId}`,
      headers: { cookie: cookieA },
    });
    expect(scoped.statusCode).toBe(200);
  });
});

describe('F-01 pagination', () => {
  let orgC = '';
  const codes = ['PG-1', 'PG-2', 'PG-3', 'PG-4', 'PG-5'];

  it('keyset pagination returns every row exactly once, even with identical created_at', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const created = await app!.inject({
      method: 'POST',
      url: '/api/v1/organizations',
      headers: { cookie: cookieA },
      payload: { name: 'Groupe Pagination', slug: `groupe-pagination-${run}` },
    });
    expect(created.statusCode).toBe(201);
    orgC = Organization.parse(JSON.parse(created.body)).id;
    // One INSERT = one now() → identical timestamps, the boundary case that
    // millisecond-truncated cursors silently skipped (review 2026-07-24).
    await admin.query(
      `INSERT INTO stores (organization_id, name, code, province)
       SELECT $1, 'Page ' || c, c, 'QC' FROM unnest($2::text[]) AS c`,
      [orgC, codes],
    );

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 5; i++) {
      const url: string = `/api/v1/stores?organization_id=${orgC}&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const page = await app!.inject({ method: 'GET', url, headers: { cookie: cookieA } });
      expect(page.statusCode).toBe(200);
      const parsed = StorePage.parse(JSON.parse(page.body));
      seen.push(...parsed.items.map((s) => s.code));
      cursor = parsed.next_cursor;
      if (!cursor) break;
    }
    expect(seen.toSorted()).toEqual(codes);
  });

  it('a forged cursor that JS can parse but Postgres cannot is still 400', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const forged = Buffer.from(
      JSON.stringify({ c: '0', id: '00000000-0000-0000-0000-000000000000' }),
      'utf8',
    ).toString('base64url');
    const res = await app!.inject({
      method: 'GET',
      url: `/api/v1/stores?organization_id=${orgC}&cursor=${encodeURIComponent(forged)}`,
      headers: { cookie: cookieA },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('invalid_cursor');
  });

  it('a soft-deleted organization is fully locked down (stores unreachable, writes 404)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const aStore = await admin.query<{ id: string }>(`SELECT id FROM stores WHERE organization_id = $1 LIMIT 1`, [orgC]);
    const del = await app!.inject({ method: 'DELETE', url: `/api/v1/organizations/${orgC}`, headers: { cookie: cookieA } });
    expect(del.statusCode).toBe(204);

    const again = await app!.inject({ method: 'DELETE', url: `/api/v1/organizations/${orgC}`, headers: { cookie: cookieA } });
    expect(again.statusCode).toBe(404); // consistent 404-on-repeat semantics

    const list = await app!.inject({ method: 'GET', url: `/api/v1/stores?organization_id=${orgC}`, headers: { cookie: cookieA } });
    expect(list.statusCode).toBe(404);

    const create = await app!.inject({
      method: 'POST',
      url: '/api/v1/stores',
      headers: { cookie: cookieA },
      payload: { organization_id: orgC, name: 'Zombie', code: 'ZOMBIE-1', province: 'QC' },
    });
    expect(create.statusCode).toBe(404);

    const getStore = await app!.inject({ method: 'GET', url: `/api/v1/stores/${aStore.rows[0]!.id}`, headers: { cookie: cookieA } });
    expect(getStore.statusCode).toBe(404);
  });
});

describe('F-01 org delete + revocation', () => {
  it('org delete is owner-only: salesperson 403, then owner 204, gone from list', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const asSalesperson = await app!.inject({ method: 'DELETE', url: `/api/v1/organizations/${orgId}`, headers: { cookie: cookieB } });
    expect(asSalesperson.statusCode).toBe(403);

    const asOwner = await app!.inject({ method: 'DELETE', url: `/api/v1/organizations/${orgId}`, headers: { cookie: cookieA } });
    expect(asOwner.statusCode).toBe(204);

    const list = await app!.inject({ method: 'GET', url: '/api/v1/organizations', headers: { cookie: cookieA } });
    expect(OrgPage.parse(JSON.parse(list.body)).items.map((o) => o.id)).not.toContain(orgId);
  });

  it('a revoked membership kills API access with a live session', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Give B a membership in Alice's LIVE second org, prove access, revoke it,
    // prove the same session cookie now gets 404 — revocation, not deletion.
    const org2 = await admin.query<{ id: string }>(
      `SELECT id FROM organizations WHERE slug = $1`, [`groupe-alice-deux-${run}`],
    );
    const org2Id = org2.rows[0]!.id;
    await admin.query(
      `INSERT INTO memberships (user_id, organization_id, store_id, roles) VALUES ($1, $2, NULL, '{salesperson}')`,
      [userBId, org2Id],
    );
    const before = await app!.inject({ method: 'GET', url: `/api/v1/organizations/${org2Id}`, headers: { cookie: cookieB } });
    expect(before.statusCode).toBe(200);

    await admin.query(
      `UPDATE memberships SET status = 'revoked' WHERE user_id = $1 AND organization_id = $2`,
      [userBId, org2Id],
    );
    const after = await app!.inject({ method: 'GET', url: `/api/v1/organizations/${org2Id}`, headers: { cookie: cookieB } });
    expect(after.statusCode).toBe(404);
  });
});
