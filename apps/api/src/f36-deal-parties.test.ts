import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, withTenant, type Pool } from '@dealpilot/db';
import { buildApp } from './app.js';

/**
 * F-36 — the deal's parties (FR-CON-005) and the merge (FR-CON-003).
 *
 * The cases that matter are the ones a CRM gets wrong expensively: a repeat
 * buyer silently becoming a second customer record, a merge that loses the
 * older relationship date, and a merge that reaches across tenants.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);

const WORKSHEET = {
  province: 'QC' as const,
  deal_type: 'finance' as const,
  sale_price_cents: 3_500_000,
  vehicle_cost_cents: 3_100_000,
};

let admin: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookie = '';
let rivalCookie = '';
let orgId = '';
let storeId = '';
let rivalOrgId = '';
let rivalStoreId = '';

let seq = 200;
function nextPhone(): string {
  seq += 1;
  return `514555${String(seq).padStart(4, '0')}`;
}

async function makeLead(phone: string, first = 'Marie', last = 'Tremblay', who = cookie, org = orgId, store = storeId) {
  const r = await app!.inject({
    method: 'POST', url: '/api/v1/leads', headers: { cookie: who },
    payload: { organization_id: org, store_id: store, phone, source: 'walk_in', first_name: first, last_name: last },
  });
  expect(r.statusCode, r.body).toBe(201);
  return (JSON.parse(r.body) as { id: string }).id;
}

async function makeDeal(extra: Record<string, unknown> = {}, who = cookie, org = orgId, store = storeId) {
  const r = await app!.inject({
    method: 'POST', url: '/api/v1/deals', headers: { cookie: who },
    payload: { ...WORKSHEET, organization_id: org, store_id: store, ...extra },
  });
  return r;
}

async function contactById(id: string) {
  const r = await app!.inject({
    method: 'GET', url: `/api/v1/contacts/${id}`, headers: { cookie },
  });
  return { status: r.statusCode, body: JSON.parse(r.body) as Record<string, unknown> };
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
    payload: { email: `f36-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Sophie' },
  });
  const sc = su.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');

  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe F36', slug: `groupe-f36-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;

  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Rooftop', code: `F36-${run.slice(-4)}`, province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;

  const rival = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f36-rival-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Rival' },
  });
  const rsc = rival.headers['set-cookie'];
  rivalCookie = (Array.isArray(rsc) ? rsc : [rsc!]).map((c) => c!.split(';')[0]).join('; ');
  const rivalOrg = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie: rivalCookie },
    payload: { name: 'Rival F36', slug: `rival-f36-${run}` },
  });
  expect(rivalOrg.statusCode, rivalOrg.body).toBe(201);
  rivalOrgId = (JSON.parse(rivalOrg.body) as { id: string }).id;
  const rivalStore = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie: rivalCookie },
    payload: { organization_id: rivalOrgId, name: 'Rival Roof', code: `R36-${run.slice(-4)}`, province: 'QC' },
  });
  rivalStoreId = (JSON.parse(rivalStore.body) as { id: string }).id;
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('a deal gets a person', () => {
  it('creates the customer from the lead and records them as buyer', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const phone = nextPhone();
    const leadId = await makeLead(phone, 'Geneviève', 'Bouchard');

    const res = await makeDeal({ lead_id: leadId });
    expect(res.statusCode, res.body).toBe(201);
    const deal = JSON.parse(res.body) as { id: string; contact_id: string | null };

    expect(
      deal.contact_id,
      'the deal came back with no buyer — deals.contact_id is trigger-maintained, so this means no party row was written',
    ).not.toBeNull();

    const { body } = await contactById(deal.contact_id!);
    expect(body).toMatchObject({ first_name: 'Geneviève', last_name: 'Bouchard', source: 'deal' });
    // E.164 normalisation happens on the lead; the contact inherits it.
    expect(String(body['phone'])).toMatch(/^\+1\d{10}$/);
  });

  it('reuses the existing customer when the phone already exists', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const phone = nextPhone();
    const first = await makeDeal({ lead_id: await makeLead(phone, 'Repeat', 'Buyer') });
    const second = await makeDeal({ lead_id: await makeLead(phone, 'Repeat', 'Buyer') });

    const a = (JSON.parse(first.body) as { contact_id: string }).contact_id;
    const b = (JSON.parse(second.body) as { contact_id: string }).contact_id;
    // The whole point of the customer master: buying twice is one customer.
    expect(b).toBe(a);
  });

  it('does not reset customer_since on the second purchase', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const phone = nextPhone();
    const first = await makeDeal({ lead_id: await makeLead(phone) });
    const contactId = (JSON.parse(first.body) as { contact_id: string }).contact_id;
    const since = (await contactById(contactId)).body['customer_since'];
    expect(since).not.toBeNull();

    await makeDeal({ lead_id: await makeLead(phone) });
    const after = (await contactById(contactId)).body['customer_since'];
    // A ten-year relationship must not become "since today" on every sale.
    expect(after).toBe(since);
  });

  it('links the enquiry to the person too', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const leadId = await makeLead(nextPhone());
    const res = await makeDeal({ lead_id: leadId });
    const contactId = (JSON.parse(res.body) as { contact_id: string }).contact_id;

    const lead = await app!.inject({
      method: 'GET', url: `/api/v1/leads/${leadId}`, headers: { cookie },
    });
    expect((JSON.parse(lead.body) as { contact_id: string | null }).contact_id).toBe(contactId);
  });

  it('takes an explicit customer over the lead phone match', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const chosen = await app!.inject({
      method: 'POST', url: '/api/v1/contacts', headers: { cookie },
      payload: { organization_id: orgId, store_id: storeId, first_name: 'Chosen', phone: `+1${nextPhone()}` },
    });
    const chosenId = (JSON.parse(chosen.body) as { contact: { id: string } }).contact.id;

    const res = await makeDeal({ lead_id: await makeLead(nextPhone()), contact_id: chosenId });
    expect(res.statusCode, res.body).toBe(201);
    // An explicit choice beats an inferred one; a salesperson who picked the
    // customer means it.
    expect((JSON.parse(res.body) as { contact_id: string }).contact_id).toBe(chosenId);
  });

  it('leaves a walk-in cash deal with nobody rather than inventing somebody', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await makeDeal({});
    expect(res.statusCode, res.body).toBe(201);
    // A blank contact would be a record in the customer master representing no
    // real person, and it would surface in search forever.
    expect((JSON.parse(res.body) as { contact_id: string | null }).contact_id).toBeNull();
  });

  it('refuses a customer from another dealership', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const theirs = await app!.inject({
      method: 'POST', url: '/api/v1/contacts', headers: { cookie: rivalCookie },
      payload: { organization_id: rivalOrgId, store_id: rivalStoreId, first_name: 'Theirs', phone: `+1${nextPhone()}` },
    });
    const theirId = (JSON.parse(theirs.body) as { contact: { id: string } }).contact.id;

    const res = await makeDeal({ contact_id: theirId });
    expect(res.statusCode, res.body).toBe(422);
    expect(JSON.parse(res.body)).toMatchObject({ error: { code: 'unknown_contact' } });
  });
});

describe('deal_parties is tenant-isolated', () => {
  it('another dealership can neither read nor add a party on our deal', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await makeDeal({ lead_id: await makeLead(nextPhone(), 'Isolated', 'Buyer') });
    const dealId = (JSON.parse(res.body) as { id: string }).id;
    const contactId = (JSON.parse(res.body) as { contact_id: string }).contact_id;

    // Driven through the APP role under the rival's tenant context, not the
    // admin pool — the admin owns the tables and bypasses RLS, so a test run
    // through it would pass no matter what the policies said.
    const appPool = createPool({ connectionString: APP_URL, max: 2 });
    try {
      await withTenant(appPool, rivalOrgId, async (c) => {
        const seen = await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM deal_parties WHERE deal_id = $1`, [dealId],
        );
        expect(seen.rows[0]!.n, 'the rival can read the parties to our deal').toBe(0);

        // And WITH CHECK: they cannot attach themselves to our contract either.
        await expect(
          c.query(
            `INSERT INTO deal_parties (organization_id, deal_id, contact_id, role)
             VALUES ($1, $2, $3, 'cosigner')`,
            [rivalOrgId, dealId, contactId],
          ),
        ).rejects.toThrow();
      });
    } finally {
      await appPool.end();
    }

    // Ours is still intact and still has exactly one buyer.
    const mine = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM deal_parties WHERE deal_id = $1`, [dealId],
    );
    expect(mine.rows[0]!.n).toBe(1);
  });
});

describe('merging two records for one person', () => {
  async function twoRecords() {
    const keepPhone = nextPhone();
    const dupPhone = nextPhone();
    const keepDeal = await makeDeal({ lead_id: await makeLead(keepPhone, 'Luc', 'Gagnon') });
    const dupDeal = await makeDeal({ lead_id: await makeLead(dupPhone, 'Luc', 'Gagnon') });
    return {
      keepId: (JSON.parse(keepDeal.body) as { contact_id: string }).contact_id,
      dupId: (JSON.parse(dupDeal.body) as { contact_id: string }).contact_id,
      dupDealId: (JSON.parse(dupDeal.body) as { id: string }).id,
    };
  }

  function merge(keep_id: string, merge_id: string, who = cookie) {
    return app!.inject({
      method: 'POST', url: '/api/v1/contacts/merge', headers: { cookie: who },
      payload: { keep_id, merge_id },
    });
  }

  it('moves the deal and retires the duplicate', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const { keepId, dupId, dupDealId } = await twoRecords();

    const res = await merge(keepId, dupId);
    expect(res.statusCode, res.body).toBe(200);
    const result = JSON.parse(res.body) as { moved: { parties: number }; keep_id: string };
    expect(result.keep_id).toBe(keepId);
    expect(result.moved.parties).toBeGreaterThan(0);

    // The duplicate's deal now belongs to the survivor.
    const deal = await app!.inject({
      method: 'GET', url: `/api/v1/deals/${dupDealId}`, headers: { cookie },
    });
    expect((JSON.parse(deal.body) as { contact_id: string }).contact_id).toBe(keepId);

    // Soft-deleted, not removed: a merge cannot be undone, so the evidence of
    // what was folded in has to survive.
    expect((await contactById(dupId)).status).toBe(404);
    expect((await contactById(keepId)).status).toBe(200);
  });

  it('keeps the older customer_since', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const { keepId, dupId } = await twoRecords();

    // Age the duplicate deliberately: it represents the relationship that
    // started first, which is exactly the fact a careless merge destroys.
    const older = '2019-03-01T12:00:00.000Z';
    await admin.query(`UPDATE contacts SET customer_since = $1 WHERE id = $2`, [older, dupId]);

    const res = await merge(keepId, dupId);
    expect(res.statusCode, res.body).toBe(200);
    expect(new Date((JSON.parse(res.body) as { customer_since: string }).customer_since).toISOString())
      .toBe(new Date(older).toISOString());
  });

  it('survives both records being parties to the same deal', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const { keepId, dupId, dupDealId } = await twoRecords();

    // The duplicate becomes a cosigner on a deal the keeper already buys.
    await admin.query(
      `INSERT INTO deal_parties (organization_id, deal_id, contact_id, role)
       VALUES ($1, $2, $3, 'cosigner')`,
      [orgId, dupDealId, keepId],
    );

    // Without the collision sweep this violates UNIQUE (deal_id, contact_id)
    // and the whole merge rolls back — one person cannot be two parties to one
    // contract, which is precisely what merging them would produce.
    const res = await merge(keepId, dupId);
    expect(res.statusCode, res.body).toBe(200);
  });

  it('refuses merging a record into itself', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const { keepId } = await twoRecords();
    const res = await merge(keepId, keepId);
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body)).toMatchObject({ error: { code: 'same_contact' } });
  });

  it('refuses to reach into another dealership', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const { keepId } = await twoRecords();
    const theirs = await app!.inject({
      method: 'POST', url: '/api/v1/contacts', headers: { cookie: rivalCookie },
      payload: { organization_id: rivalOrgId, store_id: rivalStoreId, first_name: 'Theirs', phone: `+1${nextPhone()}` },
    });
    const theirId = (JSON.parse(theirs.body) as { contact: { id: string } }).contact.id;

    // Naming somebody else's customer as the loser would walk their deals into
    // this tenant. 404 rather than 422: the rival's record is not merely
    // unmergeable, it is not visible.
    const res = await merge(keepId, theirId);
    expect([403, 404, 422]).toContain(res.statusCode);

    // And their record is untouched.
    const still = await app!.inject({
      method: 'GET', url: `/api/v1/contacts/${theirId}`, headers: { cookie: rivalCookie },
    });
    expect(still.statusCode).toBe(200);
    expect((JSON.parse(still.body) as { deleted_at: string | null }).deleted_at ?? null).toBeNull();
  });

  it('records the merge in the activity trail', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const { keepId, dupId } = await twoRecords();
    await merge(keepId, dupId);

    const events = await admin.query<{ action: string }>(
      `SELECT action FROM activity_events
        WHERE entity_type = 'contact' AND entity_id = $1 AND action = 'merged'`,
      [keepId],
    );
    // 'merged' was not in the action vocabulary until 0040; without that the
    // CHECK refuses the row and takes the entire merge down with it.
    expect(events.rows.length).toBeGreaterThan(0);
  });

  it('leaves the retired record’s history where it happened, and forwards to the survivor', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const { keepId, dupId } = await twoRecords();

    const before = await admin.query(
      `SELECT id FROM activity_events WHERE entity_type = 'contact' AND entity_id = $1`,
      [dupId],
    );
    await merge(keepId, dupId);

    const after = await admin.query(
      `SELECT id FROM activity_events WHERE entity_type = 'contact' AND entity_id = $1`,
      [dupId],
    );
    // NOT re-pointed. activity_events is INSERT/SELECT only for the app role on
    // purpose: if a merge could rewrite entity_id, anybody able to merge could
    // re-attribute history to a different person.
    expect(after.rowCount).toBe(before.rowCount);

    const lineage = await admin.query<{ merged_into_contact_id: string | null; deleted_at: string | null }>(
      `SELECT merged_into_contact_id, deleted_at FROM contacts WHERE id = $1`,
      [dupId],
    );
    // The survivor's timeline finds that history by following this pointer.
    expect(lineage.rows[0]!.merged_into_contact_id).toBe(keepId);
    expect(lineage.rows[0]!.deleted_at).not.toBeNull();
  });

  it('refuses a forwarding address on a record that is still live', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const { keepId, dupId } = await twoRecords();
    // A merge that set the pointer but forgot the retirement would leave a
    // customer who is both active and folded into somebody else.
    await expect(
      admin.query(
        `UPDATE contacts SET merged_into_contact_id = $2 WHERE id = $1`,
        [dupId, keepId],
      ),
    ).rejects.toThrow(/contacts_merged_into_implies_deleted/);
  });
});
