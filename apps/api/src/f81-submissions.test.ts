import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, withTenant, type Pool } from '@dealpilot/db';
import { DealSubmission, Member, SelectSubmissionResult, type DeskingInputsT } from '@dealpilot/schemas';
import { buildApp } from './app.js';
import { computeOutputs, OUTPUT_COLUMNS } from './deal-outputs.js';

/**
 * F-81 — the lender submissions ledger, and « Choisir cette approbation »
 * (lenders-billofsale.md §2.1–§2.3, D-082).
 *
 * Every persona call goes through the HTTP app as the APP role. Fixtures are
 * built through the API; the admin pool is used only as (a) a read ORACLE
 * (the store-clock date, a commissions count, a notifications count for a
 * recipient who does not exist) and (b) the two ruled fixture mutations the
 * product has no door for (a soft-deleted deal, T-S3c; the partial-unique
 * probe in T-S6). Every blocked-behaviour test builds its OWN fixture — a
 * shared row lets a gate pass on data an earlier test created.
 *
 * T-S3 is the tenant-isolation proof rls-coverage cites, driven as the APP
 * role; the schema-level CHECK/FK probes live in
 * packages/db/src/migration-0074-submissions.test.ts.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';

let admin: Pool;
let appPool: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;

let ownerCookie = '';
let ownerId = '';
let fiCookie = '';
let fiId = '';
let spCookie = '';
let spId = '';
let aoCookie = '';
let bdcCookie = '';
let lgCookie = '';
let wmCookie = '';
let orgId = '';
let storeId = '';
let rivalOwnerCookie = '';
let rivalFiCookie = '';
let rivalOrgId = '';
let rivalStoreId = '';
let tdId = '';
let rbcId = '';
let scotiaId = '';
let rivalTdId = '';

type Sub = Record<string, unknown> & { id: string; deal_id: string; status: string; selected: boolean; expired: boolean };
type DealRow = Record<string, unknown> & { id: string; lender_id: string | null; interest_rate_bps: number; term_months: number };
interface ErrorBody { error: { code: string; details?: { path?: string; code: string; message: string }[] } }
interface EventRow { id: string; entity_type: string; entity_id: string; action: string; changes: Record<string, unknown>; created_at: string }
interface NotifRow { id: string; title_key: string; params: Record<string, unknown>; link: string | null; entity_type: string | null; entity_id: string | null; urgency: string }

function cookiesOf(res: { headers: Record<string, unknown> }): string {
  const sc = res.headers['set-cookie'];
  return (Array.isArray(sc) ? sc : [sc!]).map((c) => String(c).split(';')[0]).join('; ');
}

async function signUp(email: string, name: string): Promise<{ cookie: string; userId: string }> {
  const res = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email, password: PASSWORD, name },
  });
  expect(res.statusCode).toBe(200);
  const cookie = cookiesOf(res);
  const me = await app!.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
  return { cookie, userId: (JSON.parse(me.body) as { user: { id: string } }).user.id };
}

async function addMember(
  adderCookie: string, org: string, email: string, name: string, roles: string[],
): Promise<{ cookie: string; userId: string }> {
  const { cookie } = await signUp(email, name);
  const res = await app!.inject({
    method: 'POST', url: '/api/v1/members', headers: { cookie: adderCookie },
    payload: { organization_id: org, email, name, roles },
  });
  expect(res.statusCode, res.body).toBe(201);
  return { cookie, userId: Member.parse(JSON.parse(res.body)).user_id };
}

async function lenderIdOf(name: string, org = orgId, cookie = ownerCookie): Promise<string> {
  const res = await app!.inject({
    method: 'GET', url: `/api/v1/lenders?organization_id=${org}&limit=100&include_inactive=true`, headers: { cookie },
  });
  expect(res.statusCode, res.body).toBe(200);
  const found = (JSON.parse(res.body) as { items: { id: string; name: string }[] }).items.find((l) => l.name === name);
  expect(found, name).toBeDefined();
  return found!.id;
}

async function makeLead(cookie = ownerCookie, org = orgId, store = storeId): Promise<string> {
  const res = await app!.inject({
    method: 'POST', url: '/api/v1/leads', headers: { cookie },
    payload: { organization_id: org, store_id: store, phone: `+1514555${String(Math.floor(Math.random() * 10_000)).padStart(4, '0')}`, source: 'walk_in' },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (JSON.parse(res.body) as { id: string }).id;
}

/** finance / QC / 30 000 $ / 4,99 % / 48 — the desk the panel promotes into. */
async function makeDeal(extra: Record<string, unknown> = {}, cookie = ownerCookie, org = orgId, store = storeId): Promise<DealRow> {
  const res = await app!.inject({
    method: 'POST', url: '/api/v1/deals', headers: { cookie },
    payload: {
      organization_id: org, store_id: store, province: 'QC', deal_type: 'finance',
      sale_price_cents: 3_000_000, vehicle_cost_cents: 2_000_000,
      interest_rate_bps: 499, term_months: 48, ...extra,
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body) as DealRow;
}

async function getDeal(id: string, cookie = ownerCookie): Promise<DealRow> {
  const res = await app!.inject({ method: 'GET', url: `/api/v1/deals/${id}`, headers: { cookie } });
  expect(res.statusCode, res.body).toBe(200);
  return JSON.parse(res.body) as DealRow;
}

async function postSub(dealId: string, body: Record<string, unknown>, cookie = fiCookie) {
  return app!.inject({ method: 'POST', url: `/api/v1/deals/${dealId}/submissions`, headers: { cookie }, payload: body });
}
async function createSub(dealId: string, body: Record<string, unknown>, cookie = fiCookie): Promise<Sub> {
  const res = await postSub(dealId, body, cookie);
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body) as Sub;
}
async function patchSub(id: string, body: Record<string, unknown>, cookie = fiCookie) {
  return app!.inject({ method: 'PATCH', url: `/api/v1/submissions/${id}`, headers: { cookie }, payload: body });
}
async function patchOk(id: string, body: Record<string, unknown>, cookie = fiCookie): Promise<Sub> {
  const res = await patchSub(id, body, cookie);
  expect(res.statusCode, res.body).toBe(200);
  return JSON.parse(res.body) as Sub;
}
async function select(id: string, cookie = fiCookie) {
  return app!.inject({ method: 'POST', url: `/api/v1/submissions/${id}/select`, headers: { cookie } });
}
async function selectOk(id: string, cookie = fiCookie): Promise<{ submission: Sub; deal: DealRow }> {
  const res = await select(id, cookie);
  expect(res.statusCode, res.body).toBe(200);
  return JSON.parse(res.body) as { submission: Sub; deal: DealRow };
}
async function listSubs(dealId: string, cookie = ownerCookie): Promise<Sub[]> {
  const res = await app!.inject({ method: 'GET', url: `/api/v1/deals/${dealId}/submissions`, headers: { cookie } });
  expect(res.statusCode, res.body).toBe(200);
  return JSON.parse(res.body) as Sub[];
}
/** An approved, complete TD row on a fresh deal — the select fixture. */
async function approvedRow(dealId: string, extra: Record<string, unknown> = {}, lender = tdId): Promise<Sub> {
  const created = await createSub(dealId, { lender_id: lender, platform: 'dealertrack', sell_rate_bps: 699, term_months: 72, ...extra });
  return patchOk(created.id, { status: 'approved' });
}

async function eventsOf(entityId: string): Promise<EventRow[]> {
  const res = await app!.inject({
    method: 'GET', url: `/api/v1/activity?organization_id=${orgId}&entity_id=${entityId}&limit=100`,
    headers: { cookie: ownerCookie },
  });
  expect(res.statusCode, res.body).toBe(200);
  return (JSON.parse(res.body) as { items: EventRow[] }).items;
}

async function bell(cookie: string): Promise<NotifRow[]> {
  const res = await app!.inject({ method: 'GET', url: '/api/v1/notifications', headers: { cookie } });
  expect(res.statusCode, res.body).toBe(200);
  return (JSON.parse(res.body) as { items: NotifRow[] }).items;
}
const approvalBells = (items: NotifRow[], subId: string) =>
  items.filter((n) => n.title_key === 'notif_lender_submission_approved' && n.entity_id === subId);

const errorOf = (body: string) => JSON.parse(body) as ErrorBody;

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
  ({ app } = await buildApp({ DATABASE_URL: APP_URL, NODE_ENV: 'test' }));

  ({ cookie: ownerCookie, userId: ownerId } = await signUp(`f81-owner-${run}@dealpilot.test`, 'Olivia Owner'));
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie: ownerCookie },
    payload: { name: 'Groupe Soumissions', slug: `groupe-soumissions-${run}` },
  });
  expect(org.statusCode, org.body).toBe(201);
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie: ownerCookie },
    payload: { organization_id: orgId, name: 'Soumissions Kia', code: 'F81-KIA', province: 'QC' },
  });
  expect(store.statusCode, store.body).toBe(201);
  storeId = (JSON.parse(store.body) as { id: string }).id;

  ({ cookie: fiCookie, userId: fiId } = await addMember(ownerCookie, orgId, `f81-fi-${run}@dealpilot.test`, 'Fadi Finance', ['fi_manager']));
  ({ cookie: spCookie, userId: spId } = await addMember(ownerCookie, orgId, `f81-sp-${run}@dealpilot.test`, 'Vicky Vendeuse', ['salesperson']));
  ({ cookie: aoCookie } = await addMember(ownerCookie, orgId, `f81-ao-${run}@dealpilot.test`, 'Annie Admin', ['admin_office']));
  ({ cookie: bdcCookie } = await addMember(ownerCookie, orgId, `f81-bdc-${run}@dealpilot.test`, 'Benoît BDC', ['bdc_agent']));
  ({ cookie: lgCookie } = await addMember(ownerCookie, orgId, `f81-lg-${run}@dealpilot.test`, 'Luc Logistique', ['logistics']));
  ({ cookie: wmCookie } = await addMember(ownerCookie, orgId, `f81-wm-${run}@dealpilot.test`, 'Walid Wholesale', ['wholesale_manager']));

  ({ cookie: rivalOwnerCookie } = await signUp(`f81-rival-${run}@dealpilot.test`, 'Rita Rivale'));
  const rivalOrg = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie: rivalOwnerCookie },
    payload: { name: 'Groupe Rival', slug: `groupe-rival-f81-${run}` },
  });
  expect(rivalOrg.statusCode, rivalOrg.body).toBe(201);
  rivalOrgId = (JSON.parse(rivalOrg.body) as { id: string }).id;
  const rivalStore = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie: rivalOwnerCookie },
    payload: { organization_id: rivalOrgId, name: 'Rival Kia', code: 'F81-RIV', province: 'QC' },
  });
  expect(rivalStore.statusCode, rivalStore.body).toBe(201);
  rivalStoreId = (JSON.parse(rivalStore.body) as { id: string }).id;
  ({ cookie: rivalFiCookie } = await addMember(rivalOwnerCookie, rivalOrgId, `f81-rival-fi-${run}@dealpilot.test`, 'Fatima Finance', ['fi_manager']));

  tdId = await lenderIdOf('TD Auto Finance');
  rbcId = await lenderIdOf('RBC Royal Bank');
  scotiaId = await lenderIdOf('Scotia Dealer Advantage');
  rivalTdId = await lenderIdOf('TD Auto Finance', rivalOrgId, rivalOwnerCookie);
});

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await admin?.end();
});

describe('T-S1 — create persists every column', () => {
  it('fi_manager POSTs every CreateSubmissionInput key → 201, every field echoes, born submitted/unselected/unexpired', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const deal = await makeDeal();
    const res = await postSub(deal.id, {
      lender_id: tdId, platform: 'dealertrack', buy_rate_bps: 599, sell_rate_bps: 699, term_months: 72,
      approval_amount_cents: 2_800_000, monthly_payment_cents: 65_000, expiry_date: '2030-10-15',
      conditions: 'Preuve de revenu', notes: 'Approbation verbale',
    });
    expect(res.statusCode, res.body).toBe(201);
    const row = DealSubmission.parse(JSON.parse(res.body));
    expect(row).toMatchObject({
      organization_id: orgId, store_id: storeId, deal_id: deal.id, lender_id: tdId,
      platform: 'dealertrack', status: 'submitted', buy_rate_bps: 599, sell_rate_bps: 699, term_months: 72,
      approval_amount_cents: 2_800_000, monthly_payment_cents: 65_000, expiry_date: '2030-10-15',
      conditions: 'Preuve de revenu', conditions_met: false, decline_reason: null, notes: 'Approbation verbale',
      selected: false, expired: false, responded_at: null,
    });
    expect(row.submitted_at).toBeTruthy();
    // The trail: created, parented to the deal, naming the lender and platform.
    const created = (await eventsOf(row.id)).find((e) => e.action === 'created');
    expect(created).toMatchObject({ entity_type: 'deal_submission', changes: { lender_id: tdId, platform: 'dealertrack' } });
  });

  it('a minimal POST (lender + platform) echoes nulls, never invented numbers', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const deal = await makeDeal();
    const row = await createSub(deal.id, { lender_id: scotiaId, platform: 'manual' });
    expect(row).toMatchObject({
      buy_rate_bps: null, sell_rate_bps: null, term_months: null, approval_amount_cents: null,
      monthly_payment_cents: null, expiry_date: null, conditions: null, notes: null, expired: false,
    });
  });
});

describe('T-S2 — personas: deal:update writes, members read (no new verb)', () => {
  it('salesperson: POST 201 / PATCH 200 / select 200; admin_office POST 201', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const deal = await makeDeal();
    const row = await createSub(deal.id, { lender_id: tdId, platform: 'manual', sell_rate_bps: 699, term_months: 72 }, spCookie);
    await patchOk(row.id, { status: 'approved' }, spCookie);
    const out = await selectOk(row.id, spCookie);
    expect(out.submission.selected).toBe(true);
    const ao = await postSub(deal.id, { lender_id: rbcId, platform: 'manual' }, aoCookie);
    expect(ao.statusCode, ao.body).toBe(201);
  });

  it('bdc_agent (roles exactly [bdc_agent]): POST/PATCH/select 403, GET 200; logistics POST 403; wholesale_manager GET 200', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const deal = await makeDeal();
    const row = await approvedRow(deal.id);
    const post = await postSub(deal.id, { lender_id: rbcId, platform: 'manual' }, bdcCookie);
    expect(post.statusCode, post.body).toBe(403);
    expect(errorOf(post.body).error.code).toBe('forbidden');
    const patch = await patchSub(row.id, { notes: 'x' }, bdcCookie);
    expect(patch.statusCode, patch.body).toBe(403);
    const sel = await select(row.id, bdcCookie);
    expect(sel.statusCode, sel.body).toBe(403);
    expect((await listSubs(deal.id, bdcCookie)).map((s) => s.id)).toEqual([row.id]);
    const lg = await postSub(deal.id, { lender_id: rbcId, platform: 'manual' }, lgCookie);
    expect(lg.statusCode, lg.body).toBe(403);
    expect((await listSubs(deal.id, wmCookie)).map((s) => s.id)).toEqual([row.id]);
    // And the row is untouched by any of it.
    expect((await listSubs(deal.id))[0]).toMatchObject({ selected: false, notes: null });
  });

  it('T-S15b: fi_manager with deal:update DENIED through the a13 override → 403 on all three; allowed again once cleared', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const deal = await makeDeal();
    const row = await approvedRow(deal.id);
    const deny = await app!.inject({
      method: 'PUT', url: '/api/v1/permissions/user', headers: { cookie: ownerCookie },
      payload: { organization_id: orgId, user_id: fiId, permission: 'deal:update', allowed: false, reason: 'F-81 override probe' },
    });
    expect(deny.statusCode, deny.body).toBe(204);
    try {
      expect((await postSub(deal.id, { lender_id: rbcId, platform: 'manual' })).statusCode).toBe(403);
      expect((await patchSub(row.id, { notes: 'x' })).statusCode).toBe(403);
      expect((await select(row.id)).statusCode).toBe(403);
    } finally {
      const clear = await app!.inject({
        method: 'PUT', url: '/api/v1/permissions/user', headers: { cookie: ownerCookie },
        payload: { organization_id: orgId, user_id: fiId, permission: 'deal:update', allowed: null },
      });
      expect(clear.statusCode, clear.body).toBe(204);
    }
    expect((await postSub(deal.id, { lender_id: rbcId, platform: 'manual' })).statusCode).toBe(201);
  });
});

describe('T-S3 — cross-tenant, as the APP role (the rls-coverage behavioural citation)', () => {
  it("a rival's GET of our deal's list, PATCH and select of our submission are 404s", async (ctx) => {
    if (!dbUp) return ctx.skip();
    const deal = await makeDeal();
    const row = await approvedRow(deal.id);
    const list = await app!.inject({ method: 'GET', url: `/api/v1/deals/${deal.id}/submissions`, headers: { cookie: rivalFiCookie } });
    expect(list.statusCode, list.body).toBe(404);
    expect((await patchSub(row.id, { notes: 'volé' }, rivalFiCookie)).statusCode).toBe(404);
    expect((await select(row.id, rivalFiCookie)).statusCode).toBe(404);
    expect((await listSubs(deal.id))[0]).toMatchObject({ notes: null, selected: false });
  });

  it("our POST naming the rival's lender is a 422 invalid_reference; so is a PATCH lender_id to it", async (ctx) => {
    if (!dbUp) return ctx.skip();
    const deal = await makeDeal();
    const res = await postSub(deal.id, { lender_id: rivalTdId, platform: 'manual' });
    expect(res.statusCode, res.body).toBe(422);
    expect(errorOf(res.body).error.details?.[0]).toMatchObject({ path: 'lender_id', code: 'invalid_reference' });
    const row = await createSub(deal.id, { lender_id: tdId, platform: 'manual' });
    const moved = await patchSub(row.id, { lender_id: rivalTdId });
    expect(moved.statusCode, moved.body).toBe(422);
    expect(errorOf(moved.body).error.details?.[0]).toMatchObject({ path: 'lender_id', code: 'invalid_reference' });
  });

  it('as the app role, a mismatched (organization_id, lender_id | deal_id | store_id) is refused by the composite FK with 23503', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const deal = await makeDeal();
    const rivalDeal = await makeDeal({}, rivalOwnerCookie, rivalOrgId, rivalStoreId);
    const insert = (lender: string, dealId: string, store = storeId) =>
      withTenant(appPool, orgId, (c) => c.query(
        `INSERT INTO deal_submissions (organization_id, store_id, deal_id, lender_id, platform)
         VALUES ($1, $2, $3, $4, 'manual')`,
        [orgId, store, dealId, lender],
      ));
    await expect(insert(rivalTdId, deal.id)).rejects.toMatchObject({ code: '23503' });
    await expect(insert(tdId, rivalDeal.id)).rejects.toMatchObject({ code: '23503' });
    // The third composite pair — the one rls-coverage's exemption cites for
    // this suite: our org/deal/lender with the rival's store.
    await expect(insert(tdId, deal.id, rivalStoreId)).rejects.toMatchObject({ code: '23503' });
    // Positive control: the same-org triple is accepted by the same statement.
    await insert(tdId, deal.id);
    expect(await listSubs(deal.id)).toHaveLength(1);
  });

  it('T-S3c: a soft-deleted deal is unreachable on GET, POST, PATCH and select (the deal-first lock carries deleted_at IS NULL)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const deal = await makeDeal();
    const row = await approvedRow(deal.id);
    await admin.query(`UPDATE deals SET deleted_at = now() WHERE id = $1`, [deal.id]);
    const list = await app!.inject({ method: 'GET', url: `/api/v1/deals/${deal.id}/submissions`, headers: { cookie: ownerCookie } });
    expect(list.statusCode).toBe(404);
    expect((await postSub(deal.id, { lender_id: rbcId, platform: 'manual' })).statusCode).toBe(404);
    expect((await patchSub(row.id, { notes: 'x' })).statusCode).toBe(404);
    expect((await select(row.id)).statusCode).toBe(404);
  });
});

describe('T-S4 — the free status machine and its three invariants', () => {
  const STATUSES = ['submitted', 'approved', 'conditional', 'declined'] as const;

  it('every ordered pair of the four is a 200 on a fresh, condition-free, reason-free row (16 pairs)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const deal = await makeDeal();
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        const row = await createSub(deal.id, { lender_id: tdId, platform: 'manual', sell_rate_bps: 699, term_months: 72 });
        const at = await patchOk(row.id, { status: from });
        expect(at.status, `${from}`).toBe(from);
        const moved = await patchSub(row.id, { status: to });
        expect(moved.statusCode, `${from} → ${to}: ${moved.body}`).toBe(200);
        expect((JSON.parse(moved.body) as Sub).status).toBe(to);
      }
    }
  });

  it('a same-status PATCH is a no-op for status: 200, no change, and NO event when the diff is empty', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const deal = await makeDeal();
    const row = await approvedRow(deal.id);
    const before = (await eventsOf(row.id)).length;
    const again = await patchOk(row.id, { status: 'approved' });
    expect(again.status).toBe('approved');
    expect(again.responded_at).toBe(row.responded_at);
    expect((await eventsOf(row.id)).length).toBe(before);
    // Other fields still apply beside the unchanged status.
    const withNote = await patchOk(row.id, { status: 'approved', notes: 'Confirmée par courriel' });
    expect(withNote.notes).toBe('Confirmée par courriel');
    expect((await eventsOf(row.id)).length).toBe(before + 1);
  });

  it('approving with conditions on file and unmet is a 422 conditions_unmet; met in the same PATCH is a 200; routing through submitted dodges nothing', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const deal = await makeDeal();
    const row = await createSub(deal.id, { lender_id: tdId, platform: 'creditapp', sell_rate_bps: 999, term_months: 60, conditions: 'Preuve de revenu' });
    await patchOk(row.id, { status: 'conditional' });
    const refused = await patchSub(row.id, { status: 'approved' });
    expect(refused.statusCode, refused.body).toBe(422);
    expect(errorOf(refused.body).error.code).toBe('conditions_unmet');
    expect(errorOf(refused.body).error.details?.[0]).toMatchObject({ path: 'conditions_met', code: 'conditions_unmet' });
    // conditional → submitted → approved: the invariant reads the merged row, not the path.
    await patchOk(row.id, { status: 'submitted' });
    expect((await patchSub(row.id, { status: 'approved' })).statusCode).toBe(422);
    // Adding conditions to an approved row without meeting them is the same refusal.
    const other = await approvedRow(deal.id, {}, rbcId);
    expect((await patchSub(other.id, { conditions: 'Cosignataire' })).statusCode).toBe(422);
    // Met in the same PATCH is legal.
    const ok = await patchOk(row.id, { status: 'approved', conditions_met: true });
    expect(ok).toMatchObject({ status: 'approved', conditions_met: true });
  });

  it('a decline reason with a non-declined final status is a 422 not_declined; leaving declined clears it, on the trail', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const deal = await makeDeal();
    const row = await createSub(deal.id, { lender_id: tdId, platform: 'manual' });
    const onApproved = await patchSub(row.id, { status: 'approved', decline_reason: 'Ratio dette/revenu' });
    expect(onApproved.statusCode, onApproved.body).toBe(422);
    expect(errorOf(onApproved.body).error.details?.[0]).toMatchObject({ path: 'decline_reason', code: 'not_declined' });
    const declined = await patchOk(row.id, { status: 'declined', decline_reason: 'Ratio dette/revenu' });
    expect(declined.decline_reason).toBe('Ratio dette/revenu');
    // A reason alone on a declined row is fine; a reason alone on a submitted row is not.
    await patchOk(row.id, { decline_reason: 'Ratio dette/revenu trop élevé' });
    const reopened = await patchOk(row.id, { status: 'submitted' });
    expect(reopened).toMatchObject({ status: 'submitted', decline_reason: null });
    const evt = (await eventsOf(row.id)).find((e) => e.action === 'updated' && (e.changes['status'] as { to?: string } | undefined)?.to === 'submitted');
    expect(evt?.changes['decline_reason']).toEqual({ from: 'Ratio dette/revenu trop élevé', to: null });
    expect((await patchSub(row.id, { decline_reason: 'x' })).statusCode).toBe(422);
  });

  it('responded_at is stamped on the FIRST entry into approved/conditional/declined and never again', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const deal = await makeDeal();
    const row = await createSub(deal.id, { lender_id: tdId, platform: 'manual', sell_rate_bps: 699, term_months: 72 });
    expect(row.responded_at).toBeNull();
    const first = await patchOk(row.id, { status: 'approved' });
    expect(first.responded_at).toBeTruthy();
    const stamp = first.responded_at;
    const t2 = await patchOk(row.id, { status: 'declined' });
    expect(t2.responded_at).toBe(stamp);
    const t3 = await patchOk(row.id, { status: 'submitted' });
    expect(t3.responded_at).toBe(stamp);
    const t4 = await patchOk(row.id, { status: 'approved' });
    expect(t4.responded_at).toBe(stamp);
    // A row that first responds as conditional stamps there.
    const cond = await createSub(deal.id, { lender_id: rbcId, platform: 'manual' });
    expect((await patchOk(cond.id, { status: 'conditional' })).responded_at).toBeTruthy();
  });

  it('expiry_date on the trail is the calendar day on BOTH sides — {from: YYYY-MM-DD, to: YYYY-MM-DD}, never the prior pg Date as a UTC instant', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const deal = await makeDeal();
    const row = await createSub(deal.id, { lender_id: tdId, platform: 'manual', expiry_date: '2030-01-15' });
    expect(row.expiry_date).toBe('2030-01-15');
    // The same day again is no change — and NO event (same() compares by day).
    await patchOk(row.id, { expiry_date: '2030-01-15' });
    expect((await eventsOf(row.id)).filter((e) => e.action === 'updated')).toHaveLength(0);
    // A moved day: the `from` is the day the row held, on any host's clock —
    // a raw pg Date would serialize as an instant of the WRONG day east of UTC.
    expect((await patchOk(row.id, { expiry_date: '2030-02-01' })).expiry_date).toBe('2030-02-01');
    const moved = (await eventsOf(row.id)).find((e) => e.action === 'updated');
    expect(moved?.changes['expiry_date']).toEqual({ from: '2030-01-15', to: '2030-02-01' });
    // Clearing it records the day it held, in the same shape.
    expect((await patchOk(row.id, { expiry_date: null })).expiry_date).toBeNull();
    const cleared = (await eventsOf(row.id)).find(
      (e) => e.action === 'updated' && (e.changes['expiry_date'] as { to?: unknown } | undefined)?.to === null,
    );
    expect(cleared?.changes['expiry_date']).toEqual({ from: '2030-02-01', to: null });
  });
});

describe('T-S12/T-S13 — the selected row: locked promoted fields, deselect-on-leaving-approved, the correction doors', () => {
  it('sell_rate_bps / term_months / lender_id on the SELECTED row → 422 selected_terms_locked, one detail per key; everything else edits', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const deal = await makeDeal();
    const row = await approvedRow(deal.id);
    await selectOk(row.id);
    const one = await patchSub(row.id, { sell_rate_bps: 649 });
    expect(one.statusCode, one.body).toBe(422);
    expect(errorOf(one.body).error.code).toBe('selected_terms_locked');
    expect(errorOf(one.body).error.details).toEqual([expect.objectContaining({ path: 'sell_rate_bps', code: 'selected_terms_locked' })]);
    const three = await patchSub(row.id, { sell_rate_bps: 649, term_months: 60, lender_id: rbcId, notes: 'x' });
    expect(three.statusCode).toBe(422);
    expect(errorOf(three.body).error.details?.map((d) => d.path).sort()).toEqual(['lender_id', 'sell_rate_bps', 'term_months']);
    const edited = await patchOk(row.id, {
      buy_rate_bps: 549, approval_amount_cents: 2_900_000, monthly_payment_cents: 66_000,
      conditions: 'Assurance vie', conditions_met: true, expiry_date: '2030-12-31', notes: 'Prolongée',
    });
    expect(edited).toMatchObject({
      selected: true, buy_rate_bps: 549, approval_amount_cents: 2_900_000, monthly_payment_cents: 66_000,
      conditions: 'Assurance vie', conditions_met: true, expiry_date: '2030-12-31', notes: 'Prolongée', sell_rate_bps: 699, term_months: 72,
    });
    // The deal still matches the chosen row (nothing above re-promoted).
    expect(await getDeal(deal.id)).toMatchObject({ lender_id: tdId, interest_rate_bps: 699, term_months: 72 });
  });

  it('moving the SELECTED row off approved deselects it in the same UPDATE, on the trail; the deal KEEPS its lender/rate/term', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const deal = await makeDeal();
    const row = await approvedRow(deal.id);
    await selectOk(row.id);
    const moved = await patchOk(row.id, { status: 'submitted' });
    expect(moved).toMatchObject({ status: 'submitted', selected: false });
    const evt = (await eventsOf(row.id)).find((e) => e.action === 'updated' && (e.changes['status'] as { to?: string } | undefined)?.to === 'submitted');
    expect(evt?.changes['selected']).toEqual({ from: true, to: false });
    // Never NULLed from a status PATCH (D-081: history keeps its name).
    expect(await getDeal(deal.id)).toMatchObject({ lender_id: tdId, interest_rate_bps: 699, term_months: 72 });
    expect((await listSubs(deal.id)).filter((s) => s.selected)).toHaveLength(0);
    // Declining the chosen row is the same door.
    const other = await approvedRow(deal.id, {}, rbcId);
    await selectOk(other.id);
    const declined = await patchOk(other.id, { status: 'declined', decline_reason: 'Retirée par le prêteur' });
    expect(declined).toMatchObject({ status: 'declined', selected: false });
    expect(await getDeal(deal.id)).toMatchObject({ lender_id: rbcId, interest_rate_bps: 699, term_months: 72 });
  });

  it('lender_id and platform are PATCHable on an UNSELECTED row (active → 200; deactivated → 422 lender_inactive with no grandfather; unknown → 422 invalid_reference)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const deal = await makeDeal();
    const row = await createSub(deal.id, { lender_id: tdId, platform: 'dealertrack' });
    const moved = await patchOk(row.id, { lender_id: rbcId, platform: 'routeone' });
    expect(moved).toMatchObject({ lender_id: rbcId, platform: 'routeone' });
    const evt = (await eventsOf(row.id)).find((e) => e.action === 'updated' && (e.changes['lender_id'] as { to?: string } | undefined)?.to === rbcId);
    expect(evt?.changes).toMatchObject({ lender_id: { from: tdId, to: rbcId }, platform: { from: 'dealertrack', to: 'routeone' } });

    const asleep = await app!.inject({
      method: 'POST', url: '/api/v1/lenders', headers: { cookie: ownerCookie },
      payload: { organization_id: orgId, name: `Banque Endormie ${run}`, category: 'SUBPRIME' },
    });
    expect(asleep.statusCode, asleep.body).toBe(201);
    const asleepId = (JSON.parse(asleep.body) as { id: string }).id;
    // Even a deal that names this lender grandfathers nothing on a submission's lender change.
    const named = await makeDeal({ lender_id: asleepId });
    const namedRow = await createSub(named.id, { lender_id: tdId, platform: 'manual' });
    expect((await app!.inject({ method: 'PATCH', url: `/api/v1/lenders/${asleepId}`, headers: { cookie: ownerCookie }, payload: { active: false } })).statusCode).toBe(200);
    const inactive = await patchSub(namedRow.id, { lender_id: asleepId });
    expect(inactive.statusCode, inactive.body).toBe(422);
    expect(errorOf(inactive.body).error.code).toBe('lender_inactive');
    const unknown = await patchSub(row.id, { lender_id: randomUUID() });
    expect(unknown.statusCode).toBe(422);
    expect(errorOf(unknown.body).error.details?.[0]).toMatchObject({ path: 'lender_id', code: 'invalid_reference' });
    // A NEW submission never takes a deactivated lender either.
    const fresh = await postSub(deal.id, { lender_id: asleepId, platform: 'manual' });
    expect(fresh.statusCode).toBe(422);
    expect(errorOf(fresh.body).error.code).toBe('lender_inactive');
  });
});

describe('T-S6 — the selection transaction', () => {
  let deal: DealRow;
  let a: Sub;
  let b: Sub;

  it('select #1 promotes lender / rate / term, the engine recomputes: every OUTPUT column equals computeOutputs of the stored inputs', async (ctx) => {
    if (!dbUp) return ctx.skip();
    deal = await makeDeal();
    a = await approvedRow(deal.id, { sell_rate_bps: 699, term_months: 72 }, tdId);
    b = await approvedRow(deal.id, { sell_rate_bps: 849, term_months: 60 }, rbcId);
    const res = await select(a.id);
    expect(res.statusCode, res.body).toBe(200);
    const out = SelectSubmissionResult.parse(JSON.parse(res.body));
    expect(out.submission).toMatchObject({ id: a.id, selected: true });
    expect(out.deal).toMatchObject({ id: deal.id, lender_id: tdId, interest_rate_bps: 699, term_months: 72 });
    const stored = await getDeal(deal.id);
    expect(stored).toMatchObject({ lender_id: tdId, interest_rate_bps: 699, term_months: 72 });
    const golden = computeOutputs(stored as unknown as DeskingInputsT) as unknown as Record<string, number>;
    for (const k of OUTPUT_COLUMNS) expect(stored[k], k).toBe(golden[k]);
    // The pre-select desk (499/48) produced a different payment: the promotion moved money.
    expect(stored['monthly_payment_cents']).not.toBe(deal['monthly_payment_cents']);
    expect(out.deal['monthly_payment_cents']).toBe(stored['monthly_payment_cents']);
  });

  it('select #2 flips: #1 off, #2 on, exactly one by SQL, deal 849/60/RBC; three events incl. the sibling’s own', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const out = await selectOk(b.id);
    expect(out.deal).toMatchObject({ lender_id: rbcId, interest_rate_bps: 849, term_months: 60 });
    const rows = await listSubs(deal.id);
    expect(rows.find((s) => s.id === a.id)!.selected).toBe(false);
    expect(rows.find((s) => s.id === b.id)!.selected).toBe(true);
    const count = await admin.query<{ n: string }>(`SELECT count(*) AS n FROM deal_submissions WHERE deal_id = $1 AND selected`, [deal.id]);
    expect(Number(count.rows[0]!.n)).toBe(1);

    // jsonb hands keys back in its own order — match structurally, never by string.
    const flip = (events: EventRow[], from: boolean, to: boolean) =>
      events.find((e) => e.action === 'updated' && (e.changes['selected'] as { from?: boolean; to?: boolean } | undefined)?.from === from
        && (e.changes['selected'] as { to?: boolean }).to === to);
    const bFlip = flip(await eventsOf(b.id), false, true);
    expect(bFlip).toMatchObject({ entity_type: 'deal_submission', entity_id: b.id, changes: { selected: { from: false, to: true } } });
    const aFlip = flip(await eventsOf(a.id), true, false);
    expect(aFlip).toMatchObject({ entity_type: 'deal_submission', entity_id: a.id, changes: { selected: { from: true, to: false } } });
    const dealEvents = await eventsOf(deal.id);
    const promo = dealEvents.find((e) => e.entity_type === 'deal' && e.action === 'updated' && e.changes['via'] === 'submission_selected' && (e.changes['lender_id'] as { to?: string })?.to === rbcId);
    expect(promo?.changes).toMatchObject({
      lender_id: { from: tdId, to: rbcId }, interest_rate_bps: { from: 699, to: 849 }, term_months: { from: 72, to: 60 }, via: 'submission_selected',
    });
  });

  it('the partial unique is the arbiter of last resort: a direct second flag is a 23505', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await expect(
      admin.query(`UPDATE deal_submissions SET selected = true WHERE id = $1`, [a.id]),
    ).rejects.toMatchObject({ code: '23505', constraint: 'deal_submissions_one_selected' });
  });

  it('T-S10: re-selecting the chosen row is a 200 with no new events; after a hand-edit it re-promotes and the deal event says so', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const subBefore = (await eventsOf(b.id)).length;
    const dealBefore = (await eventsOf(deal.id)).length;
    const again = await selectOk(b.id);
    expect(again.submission.selected).toBe(true);
    expect(again.deal).toMatchObject({ lender_id: rbcId, interest_rate_bps: 849, term_months: 60 });
    expect((await eventsOf(b.id)).length).toBe(subBefore);
    expect((await eventsOf(deal.id)).length).toBe(dealBefore);

    const hand = await app!.inject({ method: 'PATCH', url: `/api/v1/deals/${deal.id}`, headers: { cookie: ownerCookie }, payload: { interest_rate_bps: 599 } });
    expect(hand.statusCode, hand.body).toBe(200);
    const back = await selectOk(b.id);
    expect(back.deal).toMatchObject({ interest_rate_bps: 849, term_months: 60, lender_id: rbcId });
    const ev = (await eventsOf(deal.id)).find((e) => e.changes['via'] === 'submission_selected' && (e.changes['interest_rate_bps'] as { from?: number })?.from === 599);
    expect(ev?.changes).toMatchObject({ interest_rate_bps: { from: 599, to: 849 } });
    expect(ev?.changes['term_months']).toBeUndefined();
  });
});

describe('T-S7 — select refusals, one FRESH fixture each', () => {
  it('a submitted row and a conditional row → 422 submission_not_approved', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const deal = await makeDeal();
    const sub = await createSub(deal.id, { lender_id: tdId, platform: 'manual', sell_rate_bps: 699, term_months: 72 });
    const r1 = await select(sub.id);
    expect(r1.statusCode).toBe(422);
    expect(errorOf(r1.body).error.code).toBe('submission_not_approved');
    const cond = await createSub(deal.id, { lender_id: rbcId, platform: 'manual', sell_rate_bps: 699, term_months: 72, conditions: 'Preuve' });
    await patchOk(cond.id, { status: 'conditional' });
    const r2 = await select(cond.id);
    expect(r2.statusCode).toBe(422);
    expect(errorOf(r2.body).error.code).toBe('submission_not_approved');
    expect(await getDeal(deal.id)).toMatchObject({ lender_id: null, interest_rate_bps: 499, term_months: 48 });
  });

  it('approved with sell NULL / term NULL / both → 422 submission_incomplete, one detail per path', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const deal = await makeDeal();
    const noSell = await createSub(deal.id, { lender_id: tdId, platform: 'manual', term_months: 72 });
    await patchOk(noSell.id, { status: 'approved' });
    const r1 = await select(noSell.id);
    expect(r1.statusCode).toBe(422);
    expect(errorOf(r1.body).error.code).toBe('submission_incomplete');
    expect(errorOf(r1.body).error.details?.map((d) => d.path)).toEqual(['sell_rate_bps']);
    const noTerm = await createSub(deal.id, { lender_id: rbcId, platform: 'manual', sell_rate_bps: 699 });
    await patchOk(noTerm.id, { status: 'approved' });
    const r2 = await select(noTerm.id);
    expect(errorOf(r2.body).error.details?.map((d) => d.path)).toEqual(['term_months']);
    const neither = await createSub(deal.id, { lender_id: scotiaId, platform: 'manual' });
    await patchOk(neither.id, { status: 'approved' });
    const r3 = await select(neither.id);
    expect(errorOf(r3.body).error.details?.map((d) => d.path).sort()).toEqual(['sell_rate_bps', 'term_months']);
  });

  it('expiry on the STORE clock: yesterday → 422 submission_expired (list says expired:true); today → 200; the same day is already lapsed one clock ahead', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Two stores 25 hours apart: at ANY instant Kiritimati's calendar day is
    // at least one ahead of Pago Pago's, so "today in Pago Pago" is a
    // selectable date there and a lapsed one on the Kiritimati deal — the
    // clock law pinned independently of the hour the suite runs.
    const mk = async (code: string, timezone: string) => {
      const res = await app!.inject({
        method: 'POST', url: '/api/v1/stores', headers: { cookie: ownerCookie },
        payload: { organization_id: orgId, name: `Kia ${code}`, code, province: 'QC', timezone },
      });
      expect(res.statusCode, res.body).toBe(201);
      return (JSON.parse(res.body) as { id: string }).id;
    };
    const west = await mk('F81-PP', 'Pacific/Pago_Pago');
    const east = await mk('F81-KI', 'Pacific/Kiritimati');
    // The oracle is the database's own clock — the same one EXPIRED_SQL reads.
    const clock = await admin.query<{ today: string; yesterday: string }>(
      `SELECT (now() AT TIME ZONE 'Pacific/Pago_Pago')::date::text AS today,
              ((now() AT TIME ZONE 'Pacific/Pago_Pago')::date - 1)::text AS yesterday`,
    );
    const { today, yesterday } = clock.rows[0]!;

    const westDeal = await makeDeal({}, ownerCookie, orgId, west);
    const lapsed = await approvedRow(westDeal.id, { expiry_date: yesterday }, tdId);
    expect(lapsed.expired).toBe(true);
    const r1 = await select(lapsed.id);
    expect(r1.statusCode, r1.body).toBe(422);
    expect(errorOf(r1.body).error.code).toBe('submission_expired');
    expect((await listSubs(westDeal.id)).find((s) => s.id === lapsed.id)).toMatchObject({ expired: true, expiry_date: yesterday });

    const live = await approvedRow(westDeal.id, { expiry_date: today }, rbcId);
    expect(live).toMatchObject({ expired: false, expiry_date: today });
    const r2 = await select(live.id);
    expect(r2.statusCode, r2.body).toBe(200);

    const eastDeal = await makeDeal({}, ownerCookie, orgId, east);
    const ahead = await approvedRow(eastDeal.id, { expiry_date: today }, tdId);
    expect(ahead.expired).toBe(true);
    const r3 = await select(ahead.id);
    expect(r3.statusCode, r3.body).toBe(422);
    expect(errorOf(r3.body).error.code).toBe('submission_expired');
    // Extending the expiry is the one-PATCH fix the message promises.
    await patchOk(ahead.id, { expiry_date: '2030-01-01' });
    expect((await select(ahead.id)).statusCode).toBe(200);
  });

  it('a lender deactivated after logging: 422 lender_inactive when the deal names no lender; 200 when the deal already names it (the grandfather)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const created = await app!.inject({
      method: 'POST', url: '/api/v1/lenders', headers: { cookie: ownerCookie },
      payload: { organization_id: orgId, name: `Caisse Fermée ${run}`, category: 'NEAR_PRIME' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const closingId = (JSON.parse(created.body) as { id: string }).id;
    const orphan = await makeDeal();
    const named = await makeDeal({ lender_id: closingId });
    const orphanRow = await approvedRow(orphan.id, {}, closingId);
    const namedRow = await approvedRow(named.id, {}, closingId);
    expect((await app!.inject({ method: 'PATCH', url: `/api/v1/lenders/${closingId}`, headers: { cookie: ownerCookie }, payload: { active: false } })).statusCode).toBe(200);

    const refused = await select(orphanRow.id);
    expect(refused.statusCode, refused.body).toBe(422);
    expect(errorOf(refused.body).error.code).toBe('lender_inactive');
    expect(errorOf(refused.body).error.details?.[0]).toMatchObject({ path: 'lender_id', code: 'lender_inactive' });
    expect(await getDeal(orphan.id)).toMatchObject({ lender_id: null, interest_rate_bps: 499 });

    const grandfathered = await selectOk(namedRow.id);
    expect(grandfathered.deal).toMatchObject({ lender_id: closingId, interest_rate_bps: 699, term_months: 72 });
  });

  it('T-S7c: two CONCURRENT selects of different approved rows, both awaited → both 200, exactly one selected, deal = the winner’s terms, no 500', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const deal = await makeDeal();
    const a = await approvedRow(deal.id, { sell_rate_bps: 699, term_months: 72 }, tdId);
    const b = await approvedRow(deal.id, { sell_rate_bps: 849, term_months: 60 }, rbcId);
    const [ra, rb] = await Promise.all([select(a.id), select(b.id)]);
    expect(ra.statusCode, ra.body).toBe(200);
    expect(rb.statusCode, rb.body).toBe(200);
    const rows = await listSubs(deal.id);
    const chosen = rows.filter((s) => s.selected);
    expect(chosen).toHaveLength(1);
    const stored = await getDeal(deal.id);
    expect(stored).toMatchObject({ lender_id: chosen[0]!['lender_id'], interest_rate_bps: chosen[0]!['sell_rate_bps'], term_months: chosen[0]!['term_months'] });
    const count = await admin.query<{ n: string }>(`SELECT count(*) AS n FROM deal_submissions WHERE deal_id = $1 AND selected`, [deal.id]);
    expect(Number(count.rows[0]!.n)).toBe(1);
  });
});

describe('T-S8 — the behavioural money fence', () => {
  const commissionsOf = async (dealId: string) => {
    const r = await admin.query<{ n: string; total: string | null }>(
      `SELECT count(*) AS n, sum(amount_cents) AS total FROM commissions WHERE deal_id = $1`, [dealId],
    );
    return { n: Number(r.rows[0]!.n), total: r.rows[0]!.total === null ? null : Number(r.rows[0]!.total) };
  };
  const money = (d: DealRow) => ({
    fi_reserve_cents: d['fi_reserve_cents'], funding_status: d['funding_status'], funded_at: d['funded_at'],
    fi_price_cents: d['fi_price_cents'], fi_cost_cents: d['fi_cost_cents'],
  });

  it('T-S8a FUNDED: a pay-planned salesperson, a reserve and a funded deal with a commissions row — select changes none of it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const plan = await app!.inject({
      method: 'POST', url: '/api/v1/pay-plans', headers: { cookie: ownerCookie },
      payload: { organization_id: orgId, user_id: spId, commission_rate: 0.25 },
    });
    expect(plan.statusCode, plan.body).toBe(201);
    const deal = await makeDeal({ salesperson_id: spId, fi_reserve_cents: 25_000, fi_price_cents: 100_000, fi_cost_cents: 40_000 });
    const funded = await app!.inject({ method: 'PATCH', url: `/api/v1/deals/${deal.id}`, headers: { cookie: ownerCookie }, payload: { funding_status: 'funded' } });
    expect(funded.statusCode, funded.body).toBe(200);
    const before = await getDeal(deal.id);
    expect(before['funding_status']).toBe('funded');
    expect(before['funded_at']).toBeTruthy();
    const payBefore = await commissionsOf(deal.id);
    expect(payBefore.n).toBeGreaterThanOrEqual(1);
    expect(payBefore.total).toBeGreaterThan(0);

    const row = await approvedRow(deal.id);
    const out = await selectOk(row.id);
    expect(out.deal).toMatchObject({ interest_rate_bps: 699, term_months: 72, lender_id: tdId });
    const after = await getDeal(deal.id);
    expect(money(after)).toEqual(money(before));
    expect(after['fi_reserve_cents']).toBe(25_000);
    expect(await commissionsOf(deal.id)).toEqual(payBefore);
  });

  it('T-S8b UNFUNDED: funding_status stays not_submitted, funded_at NULL, zero commissions after select', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const deal = await makeDeal({ salesperson_id: spId, fi_reserve_cents: 25_000 });
    expect(deal['funding_status']).toBe('not_submitted');
    const row = await approvedRow(deal.id);
    await selectOk(row.id);
    const after = await getDeal(deal.id);
    expect(after).toMatchObject({ funding_status: 'not_submitted', funded_at: null, fi_reserve_cents: 25_000 });
    expect(await commissionsOf(deal.id)).toEqual({ n: 0, total: null });
  });
});

describe('T-S9 — the re-save ruling (D-082): the server accepts a re-save, pinned both ways', () => {
  it('(i) re-sending the promoted values holds them; (ii) re-sending the OLD values lands them and the deal event carries the from→to; (b) selection persists', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const deal = await makeDeal();
    const row = await approvedRow(deal.id);
    await selectOk(row.id);
    const hold = await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${deal.id}`, headers: { cookie: ownerCookie },
      payload: { interest_rate_bps: 699, term_months: 72, lender_id: tdId, sale_price_cents: 3_000_000 },
    });
    expect(hold.statusCode, hold.body).toBe(200);
    expect(JSON.parse(hold.body)).toMatchObject({ interest_rate_bps: 699, term_months: 72, lender_id: tdId });
    expect((await listSubs(deal.id)).find((s) => s.id === row.id)!.selected).toBe(true);

    // D-082: a re-save carrying pre-select terms is accepted as user intent
    // (F&I re-desking after selecting is real); it is on the trail here and
    // visible on screen through the desk-differs chip — a future refusal is a
    // decision, not drift.
    const clobber = await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${deal.id}`, headers: { cookie: ownerCookie },
      payload: { interest_rate_bps: 499, term_months: 48 },
    });
    expect(clobber.statusCode, clobber.body).toBe(200);
    expect(await getDeal(deal.id)).toMatchObject({ interest_rate_bps: 499, term_months: 48, lender_id: tdId });
    const ev = (await eventsOf(deal.id)).find((e) => e.entity_type === 'deal' && e.action === 'updated' && (e.changes['interest_rate_bps'] as { from?: number })?.from === 699 && !('via' in e.changes));
    expect(ev?.changes).toMatchObject({ interest_rate_bps: { from: 699, to: 499 }, term_months: { from: 72, to: 48 } });
    // The chosen row stays chosen — the worksheet diverging is the accepted, visible residual.
    expect((await listSubs(deal.id)).find((s) => s.id === row.id)!.selected).toBe(true);
  });
});

describe('T-S11 — the approval bell (FR-FIN-008): the deal’s salesperson, never the actor', () => {
  it('PATCH to approved by the F&I office → exactly one row with the key, {lender}, the desk link, the entity and medium urgency', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const leadId = await makeLead();
    const deal = await makeDeal({ salesperson_id: spId, lead_id: leadId });
    const row = await createSub(deal.id, { lender_id: tdId, platform: 'manual', sell_rate_bps: 699, term_months: 72 });
    await patchOk(row.id, { status: 'approved' });
    const rows = approvalBells(await bell(spCookie), row.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title_key: 'notif_lender_submission_approved', params: { lender: 'TD Auto Finance' },
      link: `/leads/${leadId}/desk/${deal.id}`, entity_type: 'deal_submission', entity_id: row.id, urgency: 'medium',
    });
    // The actor's own bell stays silent; so does the owner's.
    expect(approvalBells(await bell(fiCookie), row.id)).toHaveLength(0);
    expect(approvalBells(await bell(ownerCookie), row.id)).toHaveLength(0);

    // approved → approved re-PATCH: no second row. approved → submitted →
    // approved: a second row (each ENTRY fires — the machine is free).
    await patchOk(row.id, { status: 'approved', notes: 'reconfirmée' });
    expect(approvalBells(await bell(spCookie), row.id)).toHaveLength(1);
    await patchOk(row.id, { status: 'submitted' });
    await patchOk(row.id, { status: 'approved' });
    expect(approvalBells(await bell(spCookie), row.id)).toHaveLength(2);
    // Select rings nobody.
    await selectOk(row.id);
    expect(approvalBells(await bell(spCookie), row.id)).toHaveLength(2);
    const all = await admin.query<{ n: string }>(`SELECT count(*) AS n FROM notifications WHERE entity_id = $1`, [row.id]);
    expect(Number(all.rows[0]!.n)).toBe(2);
  });

  it('a deal with no lead links nowhere (link NULL, never an invented path)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const deal = await makeDeal({ salesperson_id: spId });
    const row = await approvedRow(deal.id);
    const rows = approvalBells(await bell(spCookie), row.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.link).toBeNull();
  });

  it('actor IS the salesperson → zero rows; no salesperson → zero rows; conditional → zero rows', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const self = await makeDeal({ salesperson_id: spId });
    const selfRow = await createSub(self.id, { lender_id: tdId, platform: 'manual', sell_rate_bps: 699, term_months: 72 }, spCookie);
    await patchOk(selfRow.id, { status: 'approved' }, spCookie);
    expect(approvalBells(await bell(spCookie), selfRow.id)).toHaveLength(0);

    const nobody = await makeDeal();
    const nobodyRow = await approvedRow(nobody.id);
    const n = await admin.query<{ n: string }>(`SELECT count(*) AS n FROM notifications WHERE entity_id = $1`, [nobodyRow.id]);
    expect(Number(n.rows[0]!.n)).toBe(0);

    const cond = await makeDeal({ salesperson_id: spId });
    const condRow = await createSub(cond.id, { lender_id: tdId, platform: 'manual', conditions: 'Preuve' });
    await patchOk(condRow.id, { status: 'conditional' });
    expect(approvalBells(await bell(spCookie), condRow.id)).toHaveLength(0);
    // Ownership check on the recipient: the owner who is NOT the salesperson hears nothing either.
    void ownerId;
  });
});

describe('T-S14 — the list', () => {
  it('a bare array ordered submitted_at, id; every row carries `expired` and a YYYY-MM-DD or null expiry_date; unknown and rival deals are 404', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const deal = await makeDeal();
    const first = await createSub(deal.id, { lender_id: tdId, platform: 'manual', expiry_date: '2030-01-31' });
    const second = await createSub(deal.id, { lender_id: rbcId, platform: 'creditapp' });
    const third = await createSub(deal.id, { lender_id: scotiaId, platform: 'routeone', expiry_date: '2020-01-31' });
    const rows = await listSubs(deal.id);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.map((s) => s.id)).toEqual([first.id, second.id, third.id]);
    for (const s of rows) {
      expect(typeof s.expired).toBe('boolean');
      expect(s['expiry_date'] === null || /^\d{4}-\d{2}-\d{2}$/.test(String(s['expiry_date']))).toBe(true);
      DealSubmission.parse(s);
    }
    expect(rows.map((s) => s.expired)).toEqual([false, false, true]);
    expect(rows.map((s) => s['expiry_date'])).toEqual(['2030-01-31', null, '2020-01-31']);

    const unknown = await app!.inject({ method: 'GET', url: `/api/v1/deals/${randomUUID()}/submissions`, headers: { cookie: ownerCookie } });
    expect(unknown.statusCode).toBe(404);
    const rivalDeal = await makeDeal({}, rivalOwnerCookie, rivalOrgId, rivalStoreId);
    const rival = await app!.inject({ method: 'GET', url: `/api/v1/deals/${rivalDeal.id}/submissions`, headers: { cookie: ownerCookie } });
    expect(rival.statusCode).toBe(404);
    const anon = await app!.inject({ method: 'GET', url: `/api/v1/deals/${deal.id}/submissions` });
    expect(anon.statusCode).toBe(401);
  });
});

describe('schema fences (the house boundary answers 422 validation_failed)', () => {
  it('UpdateSubmissionInput refuses {}, selected, the stamps, unknown keys and an unknown status', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const deal = await makeDeal();
    const row = await createSub(deal.id, { lender_id: tdId, platform: 'manual' });
    for (const body of [
      {}, { selected: true }, { submitted_at: '2026-01-01T00:00:00Z' }, { responded_at: '2026-01-01T00:00:00Z' },
      { organization_id: rivalOrgId }, { rate_spread: 100 }, { status: 'funded' }, { status: 'expired' }, { status: 'pending' },
      { platform: 'fax' }, { sell_rate_bps: 10_001 }, { term_months: 0 }, { expiry_date: '15/10/2026' },
    ]) {
      const res = await patchSub(row.id, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(422);
      expect(errorOf(res.body).error.code, JSON.stringify(body)).toBe('validation_failed');
    }
    expect((await listSubs(deal.id))[0]).toMatchObject({ selected: false, status: 'submitted' });
  });

  it('CreateSubmissionInput refuses status, organization_id, selected and rate_spread (P5); select refuses a non-empty body', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const deal = await makeDeal();
    for (const extra of [{ status: 'approved' }, { organization_id: orgId }, { selected: true }, { rate_spread: 100 }, { term: 72 }]) {
      const res = await postSub(deal.id, { lender_id: tdId, platform: 'manual', ...extra });
      expect(res.statusCode, JSON.stringify(extra)).toBe(422);
      expect(errorOf(res.body).error.code).toBe('validation_failed');
    }
    expect(await listSubs(deal.id)).toHaveLength(0);
    const row = await approvedRow(deal.id);
    const withBody = await app!.inject({
      method: 'POST', url: `/api/v1/submissions/${row.id}/select`, headers: { cookie: fiCookie }, payload: { selected: true },
    });
    expect(withBody.statusCode, withBody.body).toBe(422);
    expect(errorOf(withBody.body).error.details?.[0]).toMatchObject({ code: 'unexpected_body' });
    expect((await listSubs(deal.id))[0]!.selected).toBe(false);
    // An empty JSON object is "nothing" — the act still happens.
    const empty = await app!.inject({
      method: 'POST', url: `/api/v1/submissions/${row.id}/select`, headers: { cookie: fiCookie }, payload: {},
    });
    expect(empty.statusCode, empty.body).toBe(200);
  });
});
