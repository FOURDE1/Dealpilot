import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { buildApp } from './app.js';

/**
 * FR-AUTH-008, pinned — the half a13-rbac does not already prove.
 *
 * "Per-tenant session revocation" in this architecture is a property, not a
 * procedure: authority is re-derived from memberships and the matrix on
 * EVERY request, so revoking a membership ends that tenant's access on the
 * very next request — while the SESSION (a fact about the person, not the
 * tenant) survives, and so does every other organization they belong to.
 * The other half — permission edits effective immediately — is proven in
 * a13-rbac.test.ts ("the matrix IS the rule").
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
let colleagueCookie = '';
let orgA = '';
let orgB = '';
let membershipId = '';

function cookiesOf(res: { headers: Record<string, unknown> }): string {
  const sc = res.headers['set-cookie'];
  return (Array.isArray(sc) ? sc : [sc!]).map((c) => String(c).split(';')[0]).join('; ');
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

  const owner = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f50-${run}@dealpilot.test`, password: PASSWORD, name: 'Patron Revoc' },
  });
  ownerCookie = cookiesOf(owner);
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie: ownerCookie },
    payload: { name: 'Groupe Révocation', slug: `groupe-revocation-${run}` },
  });
  orgA = (JSON.parse(org.body) as { id: string }).id;

  // The colleague signs up, founds their OWN organization (orgB), then joins
  // orgA — one person, two tenancies, one session.
  const colleague = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f50-b-${run}@dealpilot.test`, password: PASSWORD, name: 'Bi Tenant' },
  });
  colleagueCookie = cookiesOf(colleague);
  const own = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie: colleagueCookie },
    payload: { name: 'Groupe Bi', slug: `groupe-bi-${run}` },
  });
  orgB = (JSON.parse(own.body) as { id: string }).id;

  const added = await app!.inject({
    method: 'POST', url: '/api/v1/members', headers: { cookie: ownerCookie },
    payload: { organization_id: orgA, email: `f50-b-${run}@dealpilot.test`, name: 'Bi Tenant', roles: ['salesperson'] },
  });
  expect(added.statusCode, added.body).toBe(201);
  membershipId = (JSON.parse(added.body) as { id: string }).id;
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('per-tenant session revocation (FR-AUTH-008)', () => {
  it('before: the colleague reads orgA like any member', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'GET', url: `/api/v1/leads?organization_id=${orgA}`, headers: { cookie: colleagueCookie },
    });
    expect(res.statusCode, res.body).toBe(200);
  });

  it('revocation ends THAT tenancy on the very next request — the session and the other org survive', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const revoke = await app!.inject({
      method: 'PATCH', url: `/api/v1/members/${membershipId}`, headers: { cookie: ownerCookie },
      payload: { status: 'revoked' },
    });
    expect(revoke.statusCode, revoke.body).toBe(200);

    // The very next request, same cookie, no sign-out in between:
    const orgAAccess = await app!.inject({
      method: 'GET', url: `/api/v1/leads?organization_id=${orgA}`, headers: { cookie: colleagueCookie },
    });
    // A revoked colleague learns nothing about whether orgA's data exists.
    expect(orgAAccess.statusCode).toBe(404);

    // The SESSION is a fact about the person: /me still answers.
    const me = await app!.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: colleagueCookie } });
    expect(me.statusCode, me.body).toBe(200);

    // And their own organization is untouched — revocation was per-tenant.
    const orgBAccess = await app!.inject({
      method: 'GET', url: `/api/v1/leads?organization_id=${orgB}`, headers: { cookie: colleagueCookie },
    });
    expect(orgBAccess.statusCode, orgBAccess.body).toBe(200);
  });
});
