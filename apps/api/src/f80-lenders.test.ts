import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { LENDER_CATEGORIES, LENDER_DEFAULTS, Member } from '@dealpilot/schemas';
import { buildApp } from './app.js';

/**
 * F-80 — the lender registry and the deal that names its lender
 * (lenders-billofsale.md §1.1–§1.2, D-081).
 *
 * Every persona call goes through the HTTP app as the APP role — never admin
 * SQL (the one admin query below is a pure unnest SELECT used as a collation
 * oracle for the ordering assertion; it reads no tenant table). Fixtures are
 * built through the API. T-L6 is the tenant-isolation proof rls-coverage
 * cites; the schema-level composite-FK probe lives in
 * packages/db/src/migration-0073-backfill.test.ts — a direct probe is not
 * added here AS THE TENANT-ISOLATION PROOF, because the route 422 is the
 * product surface.
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
let fiCookie = '';
let smCookie = '';
let spCookie = '';
let orgId = '';
let storeId = '';
let rivalOwnerCookie = '';
let rivalFiCookie = '';
let rivalOrgId = '';
let rivalStoreId = '';

interface LenderRow {
  id: string; organization_id: string; name: string; short_name: string | null;
  category: string; contact_name: string | null; contact_email: string | null;
  contact_phone: string | null; notes: string | null; active: boolean;
}
interface ErrorBody { error: { code: string; details?: { path?: string; code: string; message: string }[] } }

function cookiesOf(res: { headers: Record<string, unknown> }): string {
  const sc = res.headers['set-cookie'];
  return (Array.isArray(sc) ? sc : [sc!]).map((c) => String(c).split(';')[0]).join('; ');
}

async function signUp(email: string, name: string): Promise<string> {
  const res = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email, password: PASSWORD, name },
  });
  expect(res.statusCode).toBe(200);
  return cookiesOf(res);
}

/** Sign the person up (they need an account first — CR-14), then add them. */
async function addMember(
  adderCookie: string, org: string, email: string, name: string, roles: string[],
): Promise<{ cookie: string; userId: string }> {
  const cookie = await signUp(email, name);
  const res = await app!.inject({
    method: 'POST', url: '/api/v1/members', headers: { cookie: adderCookie },
    payload: { organization_id: org, email, name, roles },
  });
  expect(res.statusCode, res.body).toBe(201);
  return { cookie, userId: Member.parse(JSON.parse(res.body)).user_id };
}

async function listLenders(cookie: string, org: string, qs = ''): Promise<LenderRow[]> {
  const res = await app!.inject({
    method: 'GET', url: `/api/v1/lenders?organization_id=${org}&limit=100${qs}`, headers: { cookie },
  });
  expect(res.statusCode, res.body).toBe(200);
  return (JSON.parse(res.body) as { items: LenderRow[] }).items;
}

async function lenderIdOf(name: string, org = orgId, cookie = ownerCookie): Promise<string> {
  const items = await listLenders(cookie, org, '&include_inactive=true');
  const found = items.find((l) => l.name === name);
  expect(found, name).toBeDefined();
  return found!.id;
}

async function createDeal(cookie: string, org: string, store: string, extra: Record<string, unknown> = {}) {
  return app!.inject({
    method: 'POST', url: '/api/v1/deals', headers: { cookie },
    payload: {
      organization_id: org, store_id: store, province: 'QC',
      sale_price_cents: 2_500_000, ...extra,
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

  ownerCookie = await signUp(`f80-owner-${run}@dealpilot.test`, 'Olivia Owner');
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie: ownerCookie },
    payload: { name: 'Groupe Prêteurs', slug: `groupe-preteurs-${run}` },
  });
  expect(org.statusCode, org.body).toBe(201);
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie: ownerCookie },
    payload: { organization_id: orgId, name: 'Prêteurs Kia', code: 'F80-KIA', province: 'QC' },
  });
  expect(store.statusCode, store.body).toBe(201);
  storeId = (JSON.parse(store.body) as { id: string }).id;

  ({ cookie: fiCookie } = await addMember(
    ownerCookie, orgId, `f80-fi-${run}@dealpilot.test`, 'Fadi Finance', ['fi_manager'],
  ));
  ({ cookie: smCookie } = await addMember(
    ownerCookie, orgId, `f80-sm-${run}@dealpilot.test`, 'Sam Ventes', ['sales_manager'],
  ));
  ({ cookie: spCookie } = await addMember(
    ownerCookie, orgId, `f80-sp-${run}@dealpilot.test`, 'Vicky Vendeuse', ['salesperson'],
  ));

  rivalOwnerCookie = await signUp(`f80-rival-${run}@dealpilot.test`, 'Rita Rivale');
  const rivalOrg = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie: rivalOwnerCookie },
    payload: { name: 'Groupe Rival', slug: `groupe-rival-f80-${run}` },
  });
  expect(rivalOrg.statusCode, rivalOrg.body).toBe(201);
  rivalOrgId = (JSON.parse(rivalOrg.body) as { id: string }).id;
  const rivalStore = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie: rivalOwnerCookie },
    payload: { organization_id: rivalOrgId, name: 'Rival Kia', code: 'F80-RIV', province: 'QC' },
  });
  expect(rivalStore.statusCode, rivalStore.body).toBe(201);
  rivalStoreId = (JSON.parse(rivalStore.body) as { id: string }).id;
  ({ cookie: rivalFiCookie } = await addMember(
    rivalOwnerCookie, rivalOrgId, `f80-rival-fi-${run}@dealpilot.test`, 'Fatima Finance', ['fi_manager'],
  ));
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('T-L1 — the registry is born full (f01 birth)', () => {
  it('a new organization lists the 18 defaults, 7/5/5/1 per category, category order then name', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const items = await listLenders(ownerCookie, orgId);
    expect(items).toHaveLength(18);

    const counts: Record<string, number> = {};
    for (const l of items) counts[l.category] = (counts[l.category] ?? 0) + 1;
    expect(counts).toEqual({ PRIME: 7, NEAR_PRIME: 5, SUBPRIME: 5, CAPTIVE: 1 });

    // The ordering claim — category in spec display order, then name — checked
    // against the database's OWN collation (a pure unnest SELECT, no tenant
    // table): 'iA Financial…' sorts differently under C and ICU collations,
    // and pinning either would fail on the other environment.
    const oracle = await admin.query<{ name: string }>(
      `SELECT d.name FROM unnest($1::text[], $2::text[]) AS d(name, category)
       ORDER BY array_position(ARRAY['PRIME','NEAR_PRIME','SUBPRIME','CAPTIVE']::text[], d.category), d.name`,
      [LENDER_DEFAULTS.map((l) => l.name), LENDER_DEFAULTS.map((l) => l.category)],
    );
    expect(items.map((l) => l.name)).toEqual(oracle.rows.map((r) => r.name));

    // The two real notes and a shortName ride through the serializer.
    const tdnp = items.find((l) => l.name === 'TD Non-Prime (TD Auto Finance Special)')!;
    expect(tdnp.notes).toBe('TD subprime program');
    const kia = items.find((l) => l.name === 'Kia Finance (KFCC)')!;
    expect(kia).toMatchObject({ short_name: 'KIA', category: 'CAPTIVE', notes: 'Kia Finance Company of Canada' });
    const sda = items.find((l) => l.name === 'Scotia Dealer Advantage')!;
    expect(sda.short_name).toBe('SDA');
    expect(items.every((l) => l.active)).toBe(true);
    expect(LENDER_CATEGORIES).toHaveLength(4);
  });
});

describe('T-L5 — personas (run against the pristine 18-row registry)', () => {
  it('sales_manager and salesperson: list 200 with 18 items, create 403; unauthenticated 401', async (ctx) => {
    if (!dbUp) return ctx.skip();
    for (const cookie of [smCookie, spCookie]) {
      const items = await listLenders(cookie, orgId);
      expect(items).toHaveLength(18);
      const create = await app!.inject({
        method: 'POST', url: '/api/v1/lenders', headers: { cookie },
        payload: { organization_id: orgId, name: 'Banque Refusée', category: 'PRIME' },
      });
      expect(create.statusCode, create.body).toBe(403);
      expect((JSON.parse(create.body) as ErrorBody).error.code).toBe('forbidden');
    }
    const anon = await app!.inject({ method: 'GET', url: `/api/v1/lenders?organization_id=${orgId}` });
    expect(anon.statusCode).toBe(401);
  });

  it('the list without organization_id is a 400 organization_required (f53 shape)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({ method: 'GET', url: '/api/v1/lenders', headers: { cookie: ownerCookie } });
    expect(res.statusCode, res.body).toBe(400);
    expect((JSON.parse(res.body) as ErrorBody).error.code).toBe('organization_required');
  });
});

describe('T-L4 — CRUD as the fi_manager (the F&I office owns the registry)', () => {
  let caisseId = '';

  it('creates a lender, fields echoed', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/lenders', headers: { cookie: fiCookie },
      payload: { organization_id: orgId, name: 'Caisse Rivière-Rouge', short_name: 'CRR', category: 'NEAR_PRIME' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const row = JSON.parse(res.body) as LenderRow;
    expect(row).toMatchObject({
      organization_id: orgId, name: 'Caisse Rivière-Rouge', short_name: 'CRR',
      category: 'NEAR_PRIME', contact_name: null, notes: null, active: true,
    });
    caisseId = row.id;
  });

  it('the EXACT same name again is a 409 duplicate_name under the name field', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dup = await app!.inject({
      method: 'POST', url: '/api/v1/lenders', headers: { cookie: fiCookie },
      payload: { organization_id: orgId, name: 'Caisse Rivière-Rouge', category: 'SUBPRIME' },
    });
    expect(dup.statusCode, dup.body).toBe(409);
    const body = JSON.parse(dup.body) as ErrorBody;
    expect(body.error.code).toBe('duplicate_name');
    expect(body.error.details).toEqual([
      { path: 'name', code: 'duplicate_name', message: 'Caisse Rivière-Rouge' },
    ]);
  });

  it('renaming onto an existing exact name is the same 409', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const renamed = await app!.inject({
      method: 'PATCH', url: `/api/v1/lenders/${caisseId}`, headers: { cookie: fiCookie },
      payload: { name: 'Eden Park' },
    });
    expect(renamed.statusCode, renamed.body).toBe(409);
    expect((JSON.parse(renamed.body) as ErrorBody).error.code).toBe('duplicate_name');
  });

  it('edits contacts, notes and short_name', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'PATCH', url: `/api/v1/lenders/${caisseId}`, headers: { cookie: fiCookie },
      payload: {
        short_name: 'Caisse RR', contact_name: 'Rémi Représentant',
        contact_email: 'remi@caisse-rr.test', contact_phone: '514-555-0180',
        notes: 'Deuxième chance locale',
      },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      id: caisseId, short_name: 'Caisse RR', contact_name: 'Rémi Représentant',
      contact_email: 'remi@caisse-rr.test', contact_phone: '514-555-0180',
      notes: 'Deuxième chance locale',
    });
  });

  it('deactivate hides it from the pick-list, include_inactive shows it, reactivate restores it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const off = await app!.inject({
      method: 'PATCH', url: `/api/v1/lenders/${caisseId}`, headers: { cookie: fiCookie },
      payload: { active: false },
    });
    expect(off.statusCode, off.body).toBe(200);
    expect((JSON.parse(off.body) as LenderRow).active).toBe(false);

    const active = await listLenders(fiCookie, orgId);
    expect(active.some((l) => l.id === caisseId)).toBe(false);
    // '?include_inactive=false' must mean false (the z.coerce.boolean foot-gun).
    const explicitFalse = await listLenders(fiCookie, orgId, '&include_inactive=false');
    expect(explicitFalse.some((l) => l.id === caisseId)).toBe(false);
    const all = await listLenders(fiCookie, orgId, '&include_inactive=true');
    expect(all.some((l) => l.id === caisseId)).toBe(true);

    const on = await app!.inject({
      method: 'PATCH', url: `/api/v1/lenders/${caisseId}`, headers: { cookie: fiCookie },
      payload: { active: true },
    });
    expect(on.statusCode, on.body).toBe(200);
    expect((JSON.parse(on.body) as LenderRow).active).toBe(true);
  });

  it('an unpatchable key is refused at the schema fence (the in-route PATCHABLE sink guard backs it)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const smuggled = await app!.inject({
      method: 'PATCH', url: `/api/v1/lenders/${caisseId}`, headers: { cookie: fiCookie },
      payload: { organization_id: rivalOrgId, name: 'Caisse Volée' },
    });
    expect(smuggled.statusCode, smuggled.body).toBe(422);
  });
});

describe('T-L6 — cross-tenant, as the APP role (the rls-coverage behavioural citation)', () => {
  it("a rival fi_manager's PATCH of our lender id is a 404 via the lenderOrg walk", async (ctx) => {
    if (!dbUp) return ctx.skip();
    const tdId = await lenderIdOf('TD Auto Finance');
    const res = await app!.inject({
      method: 'PATCH', url: `/api/v1/lenders/${tdId}`, headers: { cookie: rivalFiCookie },
      payload: { name: 'Banque Pillée' },
    });
    expect(res.statusCode, res.body).toBe(404);
  });

  it("the rival's own list never contains our rows, and OUR list is a 404 to them", async (ctx) => {
    if (!dbUp) return ctx.skip();
    const ourIds = new Set((await listLenders(ownerCookie, orgId, '&include_inactive=true')).map((l) => l.id));
    const rivalItems = await listLenders(rivalFiCookie, rivalOrgId, '&include_inactive=true');
    expect(rivalItems.some((l) => ourIds.has(l.id))).toBe(false);
    expect(rivalItems.some((l) => l.name === 'Caisse Rivière-Rouge')).toBe(false);

    const asRival = await app!.inject({
      method: 'GET', url: `/api/v1/lenders?organization_id=${orgId}`, headers: { cookie: rivalFiCookie },
    });
    expect(asRival.statusCode).toBe(404);
  });

  it("a rival deal naming OUR lender id is a 422 invalid_reference (route-level; the schema probe lives in packages/db)", async (ctx) => {
    if (!dbUp) return ctx.skip();
    const created = await createDeal(rivalOwnerCookie, rivalOrgId, rivalStoreId);
    expect(created.statusCode, created.body).toBe(201);
    const rivalDealId = (JSON.parse(created.body) as { id: string }).id;
    const tdId = await lenderIdOf('TD Auto Finance');
    const res = await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${rivalDealId}`, headers: { cookie: rivalOwnerCookie },
      payload: { lender_id: tdId },
    });
    expect(res.statusCode, res.body).toBe(422);
    const body = JSON.parse(res.body) as ErrorBody;
    expect(body.error.details?.[0]).toMatchObject({ path: 'lender_id', code: 'invalid_reference' });
  });
});

describe('T-L8 — the deal names its lender (FK behaviours)', () => {
  let dealId = '';
  let grandfatherDealId = '';
  let tdId = '';
  let rbcId = '';
  let edenId = '';

  it('create-deal with lender_id stores and echoes it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    tdId = await lenderIdOf('TD Auto Finance');
    rbcId = await lenderIdOf('RBC Royal Bank');
    edenId = await lenderIdOf('Eden Park');
    const created = await createDeal(ownerCookie, orgId, storeId, { lender_id: tdId });
    expect(created.statusCode, created.body).toBe(201);
    const row = JSON.parse(created.body) as { id: string; lender_id: string };
    expect(row.lender_id).toBe(tdId);
    dealId = row.id;
  });

  it('PATCH to another active lender echoes it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}`, headers: { cookie: ownerCookie },
      payload: { lender_id: rbcId },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((JSON.parse(res.body) as { lender_id: string }).lender_id).toBe(rbcId);
  });

  it('an unknown lender id is a 422 invalid_reference', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}`, headers: { cookie: ownerCookie },
      payload: { lender_id: randomUUID() },
    });
    expect(res.statusCode, res.body).toBe(422);
    expect((JSON.parse(res.body) as ErrorBody).error.details?.[0]).toMatchObject({
      path: 'lender_id', code: 'invalid_reference',
    });
  });

  it("a RIVAL's lender id is the same 422 — RLS makes it invisible here", async (ctx) => {
    if (!dbUp) return ctx.skip();
    const rivalTd = await lenderIdOf('TD Auto Finance', rivalOrgId, rivalOwnerCookie);
    const res = await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}`, headers: { cookie: ownerCookie },
      payload: { lender_id: rivalTd },
    });
    expect(res.statusCode, res.body).toBe(422);
    expect((JSON.parse(res.body) as ErrorBody).error.details?.[0]).toMatchObject({
      path: 'lender_id', code: 'invalid_reference',
    });
  });

  it('deactivation is honest history: NEW picks refuse, the grandfathered deal re-saves', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // A deal names Eden Park while it is still active…
    const created = await createDeal(ownerCookie, orgId, storeId, { lender_id: edenId });
    expect(created.statusCode, created.body).toBe(201);
    grandfatherDealId = (JSON.parse(created.body) as { id: string }).id;

    // …then the registry deactivates it.
    const off = await app!.inject({
      method: 'PATCH', url: `/api/v1/lenders/${edenId}`, headers: { cookie: fiCookie },
      payload: { active: false },
    });
    expect(off.statusCode, off.body).toBe(200);

    // A NEW pick of the deactivated lender is refused with its OWN code…
    const newPick = await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}`, headers: { cookie: ownerCookie },
      payload: { lender_id: edenId },
    });
    expect(newPick.statusCode, newPick.body).toBe(422);
    const refused = JSON.parse(newPick.body) as ErrorBody;
    expect(refused.error.code).toBe('lender_inactive');
    expect(refused.error.details?.[0]).toMatchObject({ path: 'lender_id', code: 'lender_inactive' });

    // …a NEW deal never grandfathers…
    const newDeal = await createDeal(ownerCookie, orgId, storeId, { lender_id: edenId });
    expect(newDeal.statusCode, newDeal.body).toBe(422);
    expect((JSON.parse(newDeal.body) as ErrorBody).error.code).toBe('lender_inactive');

    // …but re-saving the deal that ALREADY names it is not punished (the
    // grandfather clause: same id in the body → 200).
    const resave = await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${grandfatherDealId}`, headers: { cookie: ownerCookie },
      payload: { lender_id: edenId, sale_price_cents: 2_600_000 },
    });
    expect(resave.statusCode, resave.body).toBe(200);
    expect((JSON.parse(resave.body) as { lender_id: string }).lender_id).toBe(edenId);
  });

  it('T-L9: the lender change is journalled — changes.lender_id {from, to} via the diff allowlist', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}`, headers: { cookie: ownerCookie },
      payload: { lender_id: tdId },
    });
    expect(res.statusCode, res.body).toBe(200);
    const trail = await app!.inject({
      method: 'GET', url: `/api/v1/activity?organization_id=${orgId}&entity_id=${dealId}&limit=50`,
      headers: { cookie: ownerCookie },
    });
    expect(trail.statusCode, trail.body).toBe(200);
    const items = (JSON.parse(trail.body) as {
      items: { action: string; changes: Record<string, { from: unknown; to: unknown }> }[];
    }).items;
    const change = items.find((e) => e.action === 'updated' && e.changes['lender_id']?.to === tdId);
    expect(change, 'no updated event carrying changes.lender_id').toBeDefined();
    expect(change!.changes['lender_id']).toEqual({ from: rbcId, to: tdId });
  });
});
