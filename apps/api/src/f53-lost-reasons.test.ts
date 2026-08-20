import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { LOST_REASON_DEFAULTS } from '@dealpilot/core';
import { buildApp } from './app.js';

/**
 * F-53 — lost reasons (leads.md §11): the vocabulary, its provisioning, and
 * the rule it serves — no lead goes lost without a WHY.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';

let admin: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookie = '';
let orgId = '';
let storeId = '';
let leadId = '';
let rivalCookie = '';
let rivalOrgId = '';
let rivalReasonId = '';

function cookiesOf(res: { headers: Record<string, unknown> }): string {
  const sc = res.headers['set-cookie'];
  return (Array.isArray(sc) ? sc : [sc!]).map((c) => String(c).split(';')[0]).join('; ');
}

interface Reason { id: string; name: string; name_fr: string; display_order: number; is_active: boolean }

async function listReasons(c = cookie, org = orgId, qs = ''): Promise<Reason[]> {
  const res = await app!.inject({
    method: 'GET', url: `/api/v1/lost-reasons?organization_id=${org}&limit=50${qs}`, headers: { cookie: c },
  });
  expect(res.statusCode, res.body).toBe(200);
  return (JSON.parse(res.body) as { items: Reason[] }).items;
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
    payload: { email: `f53-${run}@dealpilot.test`, password: PASSWORD, name: 'Patron Raisons' },
  });
  cookie = cookiesOf(owner);
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe Raisons', slug: `groupe-raisons-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Raisons Laval', code: 'RSLV', province: 'QC', timezone: 'America/Toronto', business_hours: {}, holiday_dates: [] },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;
  const lead = await app!.inject({
    method: 'POST', url: '/api/v1/leads', headers: { cookie },
    payload: { organization_id: orgId, store_id: storeId, source: 'walk_in', first_name: 'Gilles', last_name: 'Ouellet', phone: '+15145550301' },
  });
  leadId = (JSON.parse(lead.body) as { id: string }).id;

  // A rival tenant: its vocabulary must be invisible AND unusable over here.
  const rival = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f53-r-${run}@dealpilot.test`, password: PASSWORD, name: 'Rival Raisons' },
  });
  rivalCookie = cookiesOf(rival);
  const rivalOrg = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie: rivalCookie },
    payload: { name: 'Groupe Rival', slug: `groupe-rival-${run}` },
  });
  rivalOrgId = (JSON.parse(rivalOrg.body) as { id: string }).id;
  rivalReasonId = (await listReasons(rivalCookie, rivalOrgId))[0]!.id;
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('lost reasons (F-53, leads.md §11)', () => {
  it('a new organization is provisioned with the nine bilingual defaults, in order', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const reasons = await listReasons();
    expect(reasons.map((r) => r.name)).toEqual(LOST_REASON_DEFAULTS.map((d) => d.name));
    expect(reasons.every((r) => r.name_fr.trim().length > 0)).toBe(true);
  });

  it('marking a lead lost WITHOUT a reason is refused; with one it lands, reason and note persisted', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const bare = await app!.inject({
      method: 'PATCH', url: `/api/v1/leads/${leadId}`, headers: { cookie },
      payload: { status: 'lost' },
    });
    expect(bare.statusCode, bare.body).toBe(422);
    expect(bare.body).toContain('lost_reason_required');

    const reasons = await listReasons();
    const priceTooHigh = reasons.find((r) => r.name === 'Price too high')!;
    const withReason = await app!.inject({
      method: 'PATCH', url: `/api/v1/leads/${leadId}`, headers: { cookie },
      payload: { status: 'lost', lost_reason_id: priceTooHigh.id, lost_reason_note: 'Voulait 300 $/mois' },
    });
    expect(withReason.statusCode, withReason.body).toBe(200);
    const lead = JSON.parse(withReason.body) as { status: string; lost_reason_id: string; lost_reason_note: string };
    expect(lead.status).toBe('lost');
    expect(lead.lost_reason_id).toBe(priceTooHigh.id);
    expect(lead.lost_reason_note).toBe('Voulait 300 $/mois');
  });

  it("ANOTHER tenant's reason id is unknown here — vocabulary does not cross the fence", async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'PATCH', url: `/api/v1/leads/${leadId}`, headers: { cookie },
      payload: { lost_reason_id: rivalReasonId },
    });
    expect(res.statusCode, res.body).toBe(422);
    expect(res.body).toContain('unknown_lost_reason');
  });

  it('the be-back queue card says WHY (localized labels ride along)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'GET', url: `/api/v1/leads/be-back?organization_id=${orgId}`, headers: { cookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    const q = JSON.parse(res.body) as { items: { id: string; lost_reason: { name: string; name_fr: string; icon: string } | null }[] };
    const card = q.items.find((i) => i.id === leadId)!;
    expect(card.lost_reason).toEqual({ name: 'Price too high', name_fr: 'Prix trop élevé', icon: '💰' });
  });

  it('a referenced reason cannot be deleted (409) — deactivation retires it from the pick-list instead', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const reasons = await listReasons();
    const used = reasons.find((r) => r.name === 'Price too high')!;
    const del = await app!.inject({
      method: 'DELETE', url: `/api/v1/lost-reasons/${used.id}`, headers: { cookie },
    });
    expect(del.statusCode, del.body).toBe(409);
    expect(del.body).toContain('reason_in_use');

    const off = await app!.inject({
      method: 'PATCH', url: `/api/v1/lost-reasons/${used.id}`, headers: { cookie },
      payload: { is_active: false },
    });
    expect(off.statusCode, off.body).toBe(200);
    const active = await listReasons();
    expect(active.some((r) => r.id === used.id)).toBe(false);
    const all = await listReasons(cookie, orgId, '&include_inactive=true');
    expect(all.some((r) => r.id === used.id)).toBe(true);

    // An inactive reason is off the menu for NEW losses too.
    const lead2 = await app!.inject({
      method: 'POST', url: '/api/v1/leads', headers: { cookie },
      payload: { organization_id: orgId, store_id: storeId, source: 'walk_in', first_name: 'Lise', last_name: 'Caron', phone: '+15145550302' },
    });
    const lead2Id = (JSON.parse(lead2.body) as { id: string }).id;
    const stale = await app!.inject({
      method: 'PATCH', url: `/api/v1/leads/${lead2Id}`, headers: { cookie },
      payload: { status: 'lost', lost_reason_id: used.id },
    });
    expect(stale.statusCode, stale.body).toBe(422);
  });

  it('the WHY cannot be unpicked: clearing the reason on a lost lead — or riding null into the loss — is refused', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // leadId is lost with a reason at this point.
    const cleared = await app!.inject({
      method: 'PATCH', url: `/api/v1/leads/${leadId}`, headers: { cookie },
      payload: { lost_reason_id: null },
    });
    expect(cleared.statusCode, cleared.body).toBe(422);
    expect(cleared.body).toContain('lost_reason_required');

    // Reactivate (reason stays as history, D-055), then try to re-lose while
    // nulling the reason in the SAME patch — the final state judges it.
    const back = await app!.inject({
      method: 'PATCH', url: `/api/v1/leads/${leadId}`, headers: { cookie },
      payload: { status: 'contacted' },
    });
    expect(back.statusCode, back.body).toBe(200);
    const nulled = await app!.inject({
      method: 'PATCH', url: `/api/v1/leads/${leadId}`, headers: { cookie },
      payload: { status: 'lost', lost_reason_id: null },
    });
    expect(nulled.statusCode, nulled.body).toBe(422);

    // A re-loss WITHOUT touching the reason rides on the retained one.
    const relost = await app!.inject({
      method: 'PATCH', url: `/api/v1/leads/${leadId}`, headers: { cookie },
      payload: { status: 'lost' },
    });
    expect(relost.statusCode, relost.body).toBe(200);
  });

  it('renaming onto an existing name is a 409, and ?include_inactive=false means false', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const all = await listReasons(cookie, orgId, '&include_inactive=true');
    const badTiming = all.find((r) => r.name === 'Bad timing')!;
    const renamed = await app!.inject({
      method: 'PATCH', url: `/api/v1/lost-reasons/${badTiming.id}`, headers: { cookie },
      payload: { name: 'No response' },
    });
    expect(renamed.statusCode, renamed.body).toBe(409);
    expect(renamed.body).toContain('duplicate_name');

    // 'Price too high' was deactivated earlier: the string "false" must NOT
    // read as true (the z.coerce.boolean foot-gun).
    const activeOnly = await listReasons(cookie, orgId, '&include_inactive=false');
    expect(activeOnly.some((r) => r.name === 'Price too high')).toBe(false);
  });

  it("store-scoped reasons narrow the pick-list and refuse the wrong store's lead; store ids are validated", async (ctx) => {
    if (!dbUp) return ctx.skip();
    const store2 = await app!.inject({
      method: 'POST', url: '/api/v1/stores', headers: { cookie },
      payload: { organization_id: orgId, name: 'Raisons Gatineau', code: 'RSGA', province: 'QC', timezone: 'America/Toronto', business_hours: {}, holiday_dates: [] },
    });
    const store2Id = (JSON.parse(store2.body) as { id: string }).id;
    const scoped = await app!.inject({
      method: 'POST', url: '/api/v1/lost-reasons', headers: { cookie },
      payload: { organization_id: orgId, store_id: store2Id, name: 'Gatineau only', name_fr: 'Gatineau seulement' },
    });
    expect(scoped.statusCode, scoped.body).toBe(201);
    const scopedId = (JSON.parse(scoped.body) as { id: string }).id;

    // Store 1's pick-list excludes it; the org-wide (management) view keeps it.
    const store1List = await listReasons(cookie, orgId, `&store_id=${storeId}`);
    expect(store1List.some((r) => r.id === scopedId)).toBe(false);
    const orgWide = await listReasons(cookie, orgId);
    expect(orgWide.some((r) => r.id === scopedId)).toBe(true);

    // A store-1 lead cannot be lost for a store-2 reason.
    const lead3 = await app!.inject({
      method: 'POST', url: '/api/v1/leads', headers: { cookie },
      payload: { organization_id: orgId, store_id: storeId, source: 'walk_in', first_name: 'Paul', last_name: 'Dion', phone: '+15145550303' },
    });
    const lead3Id = (JSON.parse(lead3.body) as { id: string }).id;
    const wrongStore = await app!.inject({
      method: 'PATCH', url: `/api/v1/leads/${lead3Id}`, headers: { cookie },
      payload: { status: 'lost', lost_reason_id: scopedId },
    });
    expect(wrongStore.statusCode, wrongStore.body).toBe(422);

    // Bogus and cross-tenant store ids are 422s, never 500s.
    const bogus = await app!.inject({
      method: 'POST', url: '/api/v1/lost-reasons', headers: { cookie },
      payload: { organization_id: orgId, store_id: '00000000-0000-4000-8000-000000000000', name: 'Ghost store', name_fr: 'Magasin fantôme' },
    });
    expect(bogus.statusCode, bogus.body).toBe(422);
    expect(bogus.body).toContain('unknown_store');
  });

  it('tenant-added reasons are bilingual BY SCHEMA and unique per org; an unused one deletes cleanly', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const missingFr = await app!.inject({
      method: 'POST', url: '/api/v1/lost-reasons', headers: { cookie },
      payload: { organization_id: orgId, name: 'Moved away' },
    });
    expect(missingFr.statusCode, missingFr.body).toBe(422);

    const created = await app!.inject({
      method: 'POST', url: '/api/v1/lost-reasons', headers: { cookie },
      payload: { organization_id: orgId, name: 'Moved away', name_fr: 'A déménagé', icon: '🚚', display_order: 10 },
    });
    expect(created.statusCode, created.body).toBe(201);
    const reason = JSON.parse(created.body) as { id: string };

    const dup = await app!.inject({
      method: 'POST', url: '/api/v1/lost-reasons', headers: { cookie },
      payload: { organization_id: orgId, name: 'Moved away', name_fr: 'A déménagé' },
    });
    expect(dup.statusCode, dup.body).toBe(409);

    const del = await app!.inject({
      method: 'DELETE', url: `/api/v1/lost-reasons/${reason.id}`, headers: { cookie },
    });
    expect(del.statusCode, del.body).toBe(204);
  });
});
