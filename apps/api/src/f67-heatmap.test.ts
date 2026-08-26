import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { HeatmapReport } from '@dealpilot/schemas';
import { buildApp } from './app.js';

/**
 * F-67 — the activity heatmap. The thing worth proving is the TIMEZONE:
 * a message at 02:15 UTC on a Saturday is Friday 22:15 in Montréal, and the
 * grid must say Friday. Expectations are computed with Intl in the store's
 * zone, so the test is honest across DST.
 *
 * Two stores in two zones (Laval, Vancouver): the review's mutation — a
 * scope guard deleted, a store's timezone ignored — must turn this red.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';
const TZ = 'America/Toronto';
const TZ_WEST = 'America/Vancouver';

let admin: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookie = '';
let salesCookie = '';
let managerCookie = '';
let orgId = '';
let storeId = '';
let storeWestId = '';
let conversationId = '';
let conversationWestId = '';
let consentId = '';

function cookiesOf(res: { headers: Record<string, unknown> }): string {
  const sc = res.headers['set-cookie'];
  return (Array.isArray(sc) ? sc : [sc!]).map((c) => String(c).split(';')[0]).join('; ');
}

/** Local weekday/hour of an instant in a zone — the oracle. */
function localSlot(iso: string, tz = TZ): { dow: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, weekday: 'short', hour: 'numeric', hour12: false,
  }).formatToParts(new Date(iso));
  const wd = parts.find((p) => p.type === 'weekday')!.value;
  const hour = Number(parts.find((p) => p.type === 'hour')!.value) % 24;
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd.slice(0, 3));
  return { dow, hour };
}

/** Instants inside the last week: `split` is where UTC and local days differ. */
function recentInstants(): { split: string; plain: string; west: string } {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 3, 2, 15));
  const p = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 2, 18, 30));
  // 03:30Z: 20:30 the previous evening in Vancouver, 23:30 in Toronto —
  // a different HOUR in each zone, so the wrong zone is visible.
  const w = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 4, 3, 30));
  return { split: d.toISOString(), plain: p.toISOString(), west: w.toISOString() };
}

async function message(
  direction: 'inbound' | 'outbound',
  at: string,
  opts: { conversation?: string; carrierError?: string } = {},
): Promise<void> {
  await admin.query(
    `INSERT INTO messages (organization_id, conversation_id, direction, sender_type, body, consent_ledger_id, created_at, carrier_error)
     VALUES ($1, $2, $3, $4, 'ping', $5, $6, $7)`,
    [orgId, opts.conversation ?? conversationId, direction, direction === 'inbound' ? 'client' : 'bot',
     direction === 'outbound' ? consentId : null, at, opts.carrierError ?? null],
  );
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
    payload: { email: `f67-${run}@dealpilot.test`, password: PASSWORD, name: 'Patron Chaleur' },
  });
  cookie = cookiesOf(owner);
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe Chaleur', slug: `groupe-chaleur-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Chaleur Laval', code: 'CHLV', province: 'QC', timezone: TZ },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;
  const west = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Chaleur Vancouver', code: 'CHVA', province: 'BC', timezone: TZ_WEST },
  });
  expect(west.statusCode, west.body).toBe(201);
  storeWestId = (JSON.parse(west.body) as { id: string }).id;

  const sales = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f67-s-${run}@dealpilot.test`, password: PASSWORD, name: 'Vendeur Chaleur' },
  });
  salesCookie = cookiesOf(sales);
  const added = await app!.inject({
    method: 'POST', url: '/api/v1/members', headers: { cookie },
    payload: { organization_id: orgId, email: `f67-s-${run}@dealpilot.test`, name: 'Vendeur Chaleur', roles: ['salesperson'] },
  });
  expect(added.statusCode, added.body).toBe(201);

  // A sales manager BOUND to the Vancouver store (F-55 scope).
  const mgrEmail = `f67-m-${run}@dealpilot.test`;
  const mgr = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: mgrEmail, password: PASSWORD, name: 'Gérante Ouest' },
  });
  managerCookie = cookiesOf(mgr);
  const mgrAdded = await app!.inject({
    method: 'POST', url: '/api/v1/members', headers: { cookie },
    payload: { organization_id: orgId, email: mgrEmail, name: 'Gérante Ouest', roles: ['sales_manager'] },
  });
  expect(mgrAdded.statusCode, mgrAdded.body).toBe(201);
  await admin.query(
    `UPDATE memberships SET store_id = $3
     WHERE organization_id = $1 AND user_id = (SELECT id FROM users WHERE email = $2)`,
    [orgId, mgrEmail, storeWestId],
  );

  const consent = await app!.inject({
    method: 'POST', url: '/api/v1/consent', headers: { cookie },
    payload: {
      organization_id: orgId, phone_e164: '+15145559801',
      channels: ['sms'], scopes: ['conversational'], consent_type: 'express', source: 'staff_manual',
      evidence: { note: 'heatmap fixture' },
    },
  });
  expect(consent.statusCode, consent.body).toBe(201);
  // The ledger row is the id outbound messages must carry (0031 CHECK).
  consentId = (
    await admin.query<{ id: string }>(
      `SELECT id FROM consent_ledger WHERE organization_id = $1 AND phone_e164 = '+15145559801'
       ORDER BY created_at LIMIT 1`,
      [orgId],
    )
  ).rows[0]!.id;

  conversationId = (
    await admin.query<{ id: string }>(
      `INSERT INTO conversations (organization_id, store_id, phone_e164) VALUES ($1, $2, '+15145559801') RETURNING id`,
      [orgId, storeId],
    )
  ).rows[0]!.id;
  conversationWestId = (
    await admin.query<{ id: string }>(
      `INSERT INTO conversations (organization_id, store_id, phone_e164) VALUES ($1, $2, '+16045559802') RETURNING id`,
      [orgId, storeWestId],
    )
  ).rows[0]!.id;

  const { split, plain, west: westAt } = recentInstants();
  await message('inbound', split);
  await message('inbound', split);
  await message('outbound', split);
  await message('inbound', plain);
  // A send the carrier refused: a row exists, nobody received anything.
  await message('outbound', plain, { carrierError: '30007 carrier violation' });
  // One reply at the Vancouver store.
  await message('inbound', westAt, { conversation: conversationWestId });
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

async function report(qs = 'period=30d', who = cookie): Promise<ReturnType<typeof HeatmapReport.parse>> {
  const res = await app!.inject({
    method: 'GET', url: `/api/v1/analytics/activity-heatmap?organization_id=${orgId}&${qs}`, headers: { cookie: who },
  });
  expect(res.statusCode, res.body).toBe(200);
  return HeatmapReport.parse(JSON.parse(res.body));
}

describe('activity heatmap (F-67, §11 Target)', () => {
  it('buckets by the STORE’s local weekday and hour — not UTC’s', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const { split, plain } = recentInstants();
    const r = await report();
    expect(r.timezone).toBe(TZ);

    const s = localSlot(split);
    const cellSplit = r.cells.find((c) => c.dow === s.dow && c.hour === s.hour)!;
    expect(cellSplit, JSON.stringify({ s, cells: r.cells })).toMatchObject({ inbound: 2, outbound: 1 });
    // The UTC slot for that instant must NOT exist as a cell: 02:15Z is not
    // 02:00 local anywhere in Québec.
    const utc = new Date(split);
    expect(r.cells.find((c) => c.dow === utc.getUTCDay() && c.hour === utc.getUTCHours() && c !== cellSplit)).toBeUndefined();

    const p = localSlot(plain);
    // The refused send at `plain` is not activity — the cell shows no outbound.
    expect(r.cells.find((c) => c.dow === p.dow && c.hour === p.hour)).toMatchObject({ inbound: 1, outbound: 0 });

    // Org-wide: both stores' replies, in the first store's zone; the refused
    // send counted nowhere.
    expect(r.totals).toEqual({ inbound: 4, outbound: 1 });
    expect(r.max_count).toBe(3);
    // Best contact time = the slot customers replied in most.
    expect(r.best_times[0]).toMatchObject({ dow: s.dow, hour: s.hour, inbound: 2 });
  });

  it('the direction filter narrows the grid', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const out = await report('period=30d&direction=outbound');
    expect(out.totals).toEqual({ inbound: 0, outbound: 1 });
    expect(out.cells.every((c) => c.inbound === 0)).toBe(true);
    expect(out.best_times).toEqual([]);
  });

  it('a store-bound manager sees THEIR store, in ITS zone; a foreign store_id is a 404 (F-55 scope)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const { west } = recentInstants();
    const mine = await report('period=30d', managerCookie);
    expect(mine.timezone).toBe(TZ_WEST);
    expect(mine.totals).toEqual({ inbound: 1, outbound: 0 });
    const w = localSlot(west, TZ_WEST);
    expect(mine.cells).toEqual([{ dow: w.dow, hour: w.hour, inbound: 1, outbound: 0 }]);
    // Bucketed in the wrong zone (Toronto), the same instant lands three
    // hours later — a different cell.
    const wrong = localSlot(west, TZ);
    expect(mine.cells.find((c) => c.dow === wrong.dow && c.hour === wrong.hour)).toBeUndefined();

    const foreign = await app!.inject({
      method: 'GET',
      url: `/api/v1/analytics/activity-heatmap?organization_id=${orgId}&store_id=${storeId}`,
      headers: { cookie: managerCookie },
    });
    expect(foreign.statusCode, foreign.body).toBe(404);

    // The owner asking for the Vancouver store explicitly, over all time,
    // gets the same cut in the same zone.
    const explicit = await report(`period=all&store_id=${storeWestId}`);
    expect(explicit.timezone).toBe(TZ_WEST);
    expect(explicit.cells).toEqual(mine.cells);
  });

  it('a fixed-offset zone name is refused at the store door — it has no daylight rule', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // 'EST' is in pg_timezone_names, and would bucket every summer message
    // an hour early while reading as a real zone in the report.
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/stores', headers: { cookie },
      payload: { organization_id: orgId, name: 'Chaleur Est', code: 'CHES', province: 'QC', timezone: 'EST' },
    });
    expect(res.statusCode, res.body).toBe(422);
    expect(res.body).toContain('unknown_timezone');
  });

  it('the grid is manager material — a salesperson is refused (report:view)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'GET', url: `/api/v1/analytics/activity-heatmap?organization_id=${orgId}`, headers: { cookie: salesCookie },
    });
    expect(res.statusCode, res.body).toBe(403);
  });
});
