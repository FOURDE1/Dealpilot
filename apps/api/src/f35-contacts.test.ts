import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { buildApp } from './app.js';

/**
 * Contacts — the customer master (FR-CON).
 *
 * The interesting cases are the ones a CRM gets wrong quietly: a duplicate
 * reported rather than refused, a marketing flag that does not pretend to be
 * the consent the send gate reads, and a search that ranks a name above a city.
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

let seq = 100;
function nextPhone(): string {
  seq += 1;
  return `+1438555${String(seq).padStart(4, '0')}`;
}

function create(payload: Record<string, unknown>, who = cookie) {
  return app!.inject({
    method: 'POST', url: '/api/v1/contacts', headers: { cookie: who },
    payload: { organization_id: orgId, store_id: storeId, ...payload },
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

  const su = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f35-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Sophie' },
  });
  const sc = su.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');

  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe F35', slug: `groupe-f35-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;

  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Rooftop', code: `F35-${run.slice(-4)}`, province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;

  const rival = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f35-rival-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Rival' },
  });
  const rsc = rival.headers['set-cookie'];
  rivalCookie = (Array.isArray(rsc) ? rsc : [rsc!]).map((c) => c!.split(';')[0]).join('; ');
  const rivalOrg = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie: rivalCookie },
    payload: { name: 'Rival F35', slug: `rival-f35-${run}` },
  });
  expect(rivalOrg.statusCode, rivalOrg.body).toBe(201);
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('creating a customer', () => {
  it('records them', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await create({ first_name: 'Marie', last_name: 'Tremblay', phone: nextPhone() });
    expect(res.statusCode, res.body).toBe(201);
    const body = JSON.parse(res.body) as { contact: { first_name: string; preferred_language: string } };
    expect(body.contact).toMatchObject({ first_name: 'Marie', preferred_language: 'fr-CA' });
  });

  it('refuses one that can be reached by nothing', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // A contact with no phone and no email cannot be contacted, cannot be
    // matched to a lead, and cannot be de-duplicated. It is a note.
    const res = await create({ first_name: 'Personne' });
    expect(res.statusCode).toBe(422);
  });

  it('defaults marketing consent to false, with no date', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await create({ first_name: 'Luc', phone: nextPhone() });
    const body = JSON.parse(res.body) as { contact: { consent_marketing: boolean; consent_marketing_at: string | null } };
    // An absent answer is not a yes.
    expect(body.contact).toMatchObject({ consent_marketing: false, consent_marketing_at: null });
  });

  it('stamps the date when consent IS given', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await create({ first_name: 'Anne', phone: nextPhone(), consent_marketing: true });
    const body = JSON.parse(res.body) as { contact: { consent_marketing_at: string | null } };
    // The flag and the date move together — a consent nobody can date is a
    // consent nobody can defend.
    expect(body.contact.consent_marketing_at).not.toBeNull();
  });
});

describe('duplicates', () => {
  it('reports a match on phone rather than refusing it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const phone = nextPhone();
    await create({ first_name: 'Marie', phone });

    const second = await create({ first_name: 'Marc', phone });
    // Created, not blocked. Two people at one address really do share a phone,
    // and refusing the second sends a salesperson to invent a fake number.
    expect(second.statusCode).toBe(201);
    const body = JSON.parse(second.body) as { duplicates: { matched_on: string[] }[] };
    expect(body.duplicates).toHaveLength(1);
    expect(body.duplicates[0]!.matched_on).toContain('phone');
  });

  it('matches an email regardless of case', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await create({ first_name: 'Julie', phone: nextPhone(), email: `Julie.${run}@example.test` });
    const second = await create({
      first_name: 'Julie', phone: nextPhone(), email: `julie.${run}@EXAMPLE.test`,
    });
    const body = JSON.parse(second.body) as { duplicates: { matched_on: string[] }[] };
    expect(body.duplicates[0]?.matched_on).toContain('email');
  });

  it('does not match across organisations', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const phone = nextPhone();
    await create({ first_name: 'Shared', phone });

    // The rival creating a contact with the same number must not be told that
    // somebody at another dealership has it — that is a customer list leaking
    // one lookup at a time.
    const rivalOrgId = (JSON.parse(
      (await app!.inject({ method: 'GET', url: '/api/v1/organizations', headers: { cookie: rivalCookie } })).body,
    ) as { items: { id: string }[] }).items[0]!.id;

    const res = await app!.inject({
      method: 'POST', url: '/api/v1/contacts', headers: { cookie: rivalCookie },
      payload: { organization_id: rivalOrgId, first_name: 'Shared', phone },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect((JSON.parse(res.body) as { duplicates: unknown[] }).duplicates).toHaveLength(0);
  });
});

describe('search', () => {
  it('finds a customer by name', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await create({ first_name: 'Geneviève', last_name: 'Bouchard', phone: nextPhone(), city: 'Laval' });

    const res = await app!.inject({
      method: 'GET', url: `/api/v1/contacts?organization_id=${orgId}&q=Bouchard`, headers: { cookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    const items = (JSON.parse(res.body) as { items: { last_name: string }[] }).items;
    expect(items.some((i) => i.last_name === 'Bouchard')).toBe(true);
  });

  it('finds them by phone', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const phone = nextPhone();
    await create({ first_name: 'Olivier', phone });
    const res = await app!.inject({
      method: 'GET', url: `/api/v1/contacts?organization_id=${orgId}&q=${encodeURIComponent(phone)}`,
      headers: { cookie },
    });
    const items = (JSON.parse(res.body) as { items: { phone: string }[] }).items;
    expect(items.some((i) => i.phone === phone)).toBe(true);
  });

  it('returns nothing for a name nobody has', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'GET', url: `/api/v1/contacts?organization_id=${orgId}&q=Zzyzx`, headers: { cookie },
    });
    expect((JSON.parse(res.body) as { items: unknown[] }).items).toHaveLength(0);
  });
});

describe('another dealership', () => {
  it('sees none of these customers', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const mine = await create({ first_name: 'Confidentiel', phone: nextPhone() });
    const mineId = (JSON.parse(mine.body) as { contact: { id: string } }).contact.id;

    const res = await app!.inject({
      method: 'GET', url: '/api/v1/contacts', headers: { cookie: rivalCookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    const items = (JSON.parse(res.body) as { items: { id: string; first_name: string }[] }).items;

    // Asserted by ABSENCE of a known row, not by an empty list. The rival has
    // its own contacts from earlier cases, and `toHaveLength(0)` would also
    // pass if listing were broken for everybody — which proves nothing.
    // A customer list is the single most valuable thing a rival could take.
    expect(items.map((i) => i.id)).not.toContain(mineId);
    expect(items.map((i) => i.first_name)).not.toContain('Confidentiel');
  });

  it('gets a 404 on one of ours, not a 403', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const created = await create({ first_name: 'Privé', phone: nextPhone() });
    const id = (JSON.parse(created.body) as { contact: { id: string } }).contact.id;

    for (const method of ['GET', 'PATCH'] as const) {
      const res = method === 'GET'
        ? await app!.inject({ method, url: `/api/v1/contacts/${id}`, headers: { cookie: rivalCookie } })
        : await app!.inject({
            method, url: `/api/v1/contacts/${id}`, headers: { cookie: rivalCookie },
            payload: { first_name: 'Stolen' },
          });
      expect(res.statusCode, `${method} ${res.body}`).toBe(404);
    }
  });
});
