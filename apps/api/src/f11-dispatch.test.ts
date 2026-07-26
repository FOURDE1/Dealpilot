import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { DispatchAssignment } from '@dealpilot/schemas';
import { buildApp } from './app.js';
import type { EmailMessage } from './email.js';

/**
 * F-11 dispatch. The rules are golden-tested in packages/core; this suite is
 * about what the database and the transactions do — resources being taken and
 * given back, conflicts flagging without blocking, and the run's lifecycle.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);

let admin: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookie = '';
let orgId = '';
let storeId = '';
let firstPlateId = '';
let companyId = '';
const sent: EmailMessage[] = [];

async function makeDeal(opts: { tradeIn: boolean; bookedAt: string; wetInk?: boolean }) {
  const res = await app!.inject({
    method: 'POST', url: '/api/v1/deals', headers: { cookie },
    payload: {
      organization_id: orgId, store_id: storeId, province: 'QC',
      sale_price_cents: 3_000_000, vehicle_cost_cents: 2_700_000,
      interest_rate_bps: 599, term_months: 60,
      ...(opts.tradeIn ? { trade_allowance_cents: 1_000_000, trade_acv_cents: 900_000 } : {}),
    },
  });
  const id = (JSON.parse(res.body) as { id: string }).id;
  await admin.query(`UPDATE deals SET booked_delivery_at = $2 WHERE id = $1`, [id, opts.bookedAt]);
  // Dispatch will not send a driver until the wet-ink file is PRINTED (§6/§9).
  // That is now checked against the documents themselves rather than a tick, so
  // these tests do the real thing: open the file and print it. Scheduling is
  // what they are about; the gate has its own tests.
  if (opts.wetInk !== false) {
    await prepareDocuments(id);
  }
  return id;
}

/** Print every document on the deal — the F&I/office step before a run. */
async function prepareDocuments(dealId: string) {
  const res = await app!.inject({
    method: 'GET', url: `/api/v1/deals/${dealId}/documents`, headers: { cookie },
  });
  const { items } = JSON.parse(res.body) as { items: { id: string; requires_signature: boolean }[] };
  for (const doc of items) {
    for (const status of doc.requires_signature ? ['generated', 'printed'] : ['generated', 'in_file']) {
      await app!.inject({
        method: 'PATCH', url: `/api/v1/documents/${doc.id}`, headers: { cookie }, payload: { status },
      });
    }
  }
}

async function book(dealId: string) {
  return app!.inject({
    method: 'POST', url: '/api/v1/dispatch', headers: { cookie }, payload: { deal_id: dealId },
  });
}

async function fleetStatus(table: 'dealer_plates' | 'chaser_vehicles') {
  const r = await admin.query<{ status: string }>(`SELECT status FROM ${table} ORDER BY created_at`);
  return r.rows.map((x) => x.status);
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
  ({ app } = await buildApp(
    { DATABASE_URL: APP_URL, NODE_ENV: 'test' },
    { mailer: { deliversToRecipient: true, async send(m) { sent.push(m); return true; } } },
  ));

  const signUp = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f11-owner-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Alice Owner' },
  });
  const sc = signUp.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');

  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe F11', slug: `groupe-f11-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'F11 Kia', code: 'F11-KIA', province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;

  for (const plate of ['QC-DLR-01', 'QC-DLR-02']) {
    await app!.inject({
      method: 'POST', url: '/api/v1/plates', headers: { cookie },
      payload: { organization_id: orgId, store_id: storeId, plate_number: plate },
    });
  }
  await app!.inject({
    method: 'POST', url: '/api/v1/chasers', headers: { cookie },
    payload: { organization_id: orgId, store_id: storeId, name: 'White Kia Soul' },
  });
  const company = await app!.inject({
    method: 'POST', url: '/api/v1/driver-companies', headers: { cookie },
    payload: {
      organization_id: orgId, store_id: storeId,
      name: 'Transport Supreme', email: 'dispatch@supreme.test', contact_name: 'Luc',
    },
  });
  companyId = (JSON.parse(company.body) as { id: string }).id;
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('F-11 dispatch', () => {
  it('no trade-in books two drivers AND a chaser', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal({ tradeIn: false, bookedAt: '2026-09-01T14:00:00Z' });
    const res = await book(dealId);
    expect(res.statusCode).toBe(201);

    const a = DispatchAssignment.parse(JSON.parse(res.body));
    // Driver 1 delivers the car; driver 2 follows and brings them home.
    expect(a.num_drivers_needed).toBe(2);
    expect(a.chaser_vehicle_id).not.toBeNull();
    expect(a.dealer_plate_id).not.toBeNull();
    expect(a.has_trade_in).toBe(false);
    expect(a.conflict_flag).toBe(false);

    // Booking reserves a TIME; it does not take the plate off the board. The
    // status flips when the run departs and the plate physically leaves.
    expect(await fleetStatus('dealer_plates')).toEqual(['available', 'available']);
    expect(await fleetStatus('chaser_vehicles')).toEqual(['available']);
    firstPlateId = a.dealer_plate_id!;
  });

  it('a trade-in books one driver and NO chaser', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Far from the first booking, so this is about the rule, not conflicts.
    const dealId = await makeDeal({ tradeIn: true, bookedAt: '2026-09-05T14:00:00Z' });
    const res = await book(dealId);
    expect(res.statusCode).toBe(201);

    const a = DispatchAssignment.parse(JSON.parse(res.body));
    expect(a.num_drivers_needed).toBe(1);
    // The driver brings the trade-in back, so nobody has to follow them.
    expect(a.chaser_vehicle_id).toBeNull();
    expect(a.has_trade_in).toBe(true);
  });

  it('a second plate is used before anything is flagged', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Same afternoon as the 14:00 run, so plate 1 collides — but the store has
    // a second plate, and a free resource always beats a flagged one.
    const dealId = await makeDeal({ tradeIn: true, bookedAt: '2026-09-05T16:00:00Z' });
    const res = await book(dealId);
    expect(res.statusCode).toBe(201);
    const a = DispatchAssignment.parse(JSON.parse(res.body));
    expect(a.conflict_flag).toBe(false);
    expect(a.dealer_plate_id).not.toBe(firstPlateId);
  });

  it('when every plate collides the run is FLAGGED, never refused', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Both plates are now booked for that afternoon. This is the case the
    // feature exists for, and it is reached through the API alone — the first
    // cut could only produce it with hand-written SQL, because a booked plate
    // was marked in-use and therefore never offered again. A real
    // double-booking came back as "no plate available": the exact opposite of
    // the rule.
    const dealId = await makeDeal({ tradeIn: true, bookedAt: '2026-09-05T15:00:00Z' });
    const res = await book(dealId);
    expect(res.statusCode).toBe(201);
    const a = DispatchAssignment.parse(JSON.parse(res.body));
    expect(a.conflict_flag).toBe(true);
    expect(a.conflict_reason).toMatch(/Dealer plate .* is already booked for deal/);
    expect(a.dealer_plate_id).not.toBeNull();
  });

  it('a plate booked for FRIDAY is free on TUESDAY', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // The first cut took a plate off the board the moment a run was booked, so
    // one Friday delivery made the plate unavailable all week.
    const dealId = await makeDeal({ tradeIn: true, bookedAt: '2026-09-15T10:00:00Z' });
    const res = await book(dealId);
    expect(res.statusCode).toBe(201);
    expect(DispatchAssignment.parse(JSON.parse(res.body)).conflict_flag).toBe(false);
  });

  it('a cancelled run stops colliding with anything', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal({ tradeIn: true, bookedAt: '2026-12-01T10:00:00Z' });
    const first = await book(dealId);
    const a = DispatchAssignment.parse(JSON.parse(first.body));
    expect(a.conflict_flag).toBe(false);

    await app!.inject({
      method: 'PATCH', url: `/api/v1/dispatch/${a.id}`, headers: { cookie }, payload: { status: 'cancelled' },
    });

    // Same slot again: the cancelled run must not haunt the calendar.
    const otherId = await makeDeal({ tradeIn: true, bookedAt: '2026-12-01T11:00:00Z' });
    const second = await book(otherId);
    expect(DispatchAssignment.parse(JSON.parse(second.body)).conflict_flag).toBe(false);
  });

  it('re-booking a deal that already has a live run is a 409, not a 500', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal({ tradeIn: true, bookedAt: '2027-01-05T10:00:00Z' });
    expect((await book(dealId)).statusCode).toBe(201);
    const again = await book(dealId);
    expect(again.statusCode).toBe(409);
  });

  it('a lien-only trade is still a trade — one driver, no chaser', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // The money engine counts a lien as a trade. Dispatch counting it as "no
    // trade" books a chaser and a second driver for a run that needs neither,
    // and burns a chaser another delivery is waiting on.
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/deals', headers: { cookie },
      payload: {
        organization_id: orgId, store_id: storeId, province: 'QC',
        sale_price_cents: 3_000_000, vehicle_cost_cents: 2_700_000,
        interest_rate_bps: 599, term_months: 60, trade_lien_cents: 500_000,
      },
    });
    const dealId = (JSON.parse(res.body) as { id: string }).id;
    await admin.query(`UPDATE deals SET booked_delivery_at = $2 WHERE id = $1`, [dealId, '2027-02-01T10:00:00Z']);
    await prepareDocuments(dealId);

    const booked = await book(dealId);
    expect(booked.statusCode).toBe(201);
    const a = DispatchAssignment.parse(JSON.parse(booked.body));
    expect(a.has_trade_in).toBe(true);
    expect(a.num_drivers_needed).toBe(1);
    expect(a.chaser_vehicle_id).toBeNull();
  });

  it('conflicts_only=false does not hide every clean run', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // z.coerce.boolean turns the STRING "false" into true, which would have
    // made this filter show only conflicts when asked for the opposite.
    const res = await app!.inject({
      method: 'GET', url: `/api/v1/dispatch?organization_id=${orgId}&conflicts_only=false`, headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const items = (JSON.parse(res.body) as { items: unknown[] }).items.map((i) => DispatchAssignment.parse(i));
    expect(items.some((i) => !i.conflict_flag)).toBe(true);
  });

  it('a salesperson cannot read the board — it carries driver phone numbers', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const sellerEmail = `f11-seller-${run}@dealpilot.test`;
    const signUp = await app!.inject({
      method: 'POST', url: '/api/auth/sign-up/email',
      payload: { email: sellerEmail, password: 'correct-horse-battery-staple', name: 'Sam Seller' },
    });
    const sc = signUp.headers['set-cookie'];
    const sellerCookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');
    const me = await app!.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: sellerCookie } });
    const sellerId = (JSON.parse(me.body) as { user: { id: string } }).user.id;
    await admin.query(
      `INSERT INTO users (id, email, name, status) VALUES ($1,$2,'Sam Seller','active') ON CONFLICT (id) DO NOTHING`,
      [sellerId, sellerEmail],
    );
    await admin.query(
      `INSERT INTO memberships (user_id, organization_id, store_id, roles) VALUES ($1,$2,NULL,'{salesperson}')`,
      [sellerId, orgId],
    );

    const res = await app!.inject({
      method: 'GET', url: `/api/v1/dispatch?organization_id=${orgId}`, headers: { cookie: sellerCookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it('an ended run cannot be edited afterwards', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal({ tradeIn: true, bookedAt: '2027-03-01T10:00:00Z' });
    const created = await book(dealId);
    const a = DispatchAssignment.parse(JSON.parse(created.body));
    await app!.inject({
      method: 'PATCH', url: `/api/v1/dispatch/${a.id}`, headers: { cookie }, payload: { status: 'cancelled' },
    });

    // Rewriting the driver or the ETA after the fact would quietly change what
    // the customer was told.
    const late = await app!.inject({
      method: 'PATCH', url: `/api/v1/dispatch/${a.id}`, headers: { cookie }, payload: { driver_name: 'Someone Else' },
    });
    expect(late.statusCode).toBe(409);
    expect(JSON.parse(late.body).error.code).toBe('run_ended');
  });

  it('the conflicts view is what the dashboard asks for', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'GET', url: `/api/v1/dispatch?organization_id=${orgId}&conflicts_only=true`, headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const items = (JSON.parse(res.body) as { items: unknown[] }).items.map((i) => DispatchAssignment.parse(i));
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.conflict_flag)).toBe(true);
  });

  it('a run cannot skip a step', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const list = await app!.inject({
      method: 'GET', url: `/api/v1/dispatch?organization_id=${orgId}&status=assigned`, headers: { cookie },
    });
    const id = (JSON.parse(list.body) as { items: { id: string }[] }).items[0]!.id;

    // "Arrived" without "departed" means the ETA the customer was given was
    // never true.
    const skip = await app!.inject({
      method: 'PATCH', url: `/api/v1/dispatch/${id}`, headers: { cookie }, payload: { status: 'arrived' },
    });
    expect(skip.statusCode).toBe(422);
    expect(JSON.parse(skip.body).error.code).toBe('invalid_transition');
  });

  it('departing and arriving stamp the real times', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const list = await app!.inject({
      method: 'GET', url: `/api/v1/dispatch?organization_id=${orgId}&status=assigned`, headers: { cookie },
    });
    const id = (JSON.parse(list.body) as { items: { id: string }[] }).items[0]!.id;

    const departed = await app!.inject({
      method: 'PATCH', url: `/api/v1/dispatch/${id}`, headers: { cookie },
      payload: { status: 'departed', driver_name: 'Marc', driver_phone: '+15145550100' },
    });
    expect(departed.statusCode).toBe(200);
    const d = DispatchAssignment.parse(JSON.parse(departed.body));
    expect(d.actual_departure).not.toBeNull();
    expect(d.driver_name).toBe('Marc');

    const arrived = await app!.inject({
      method: 'PATCH', url: `/api/v1/dispatch/${id}`, headers: { cookie }, payload: { status: 'arrived' },
    });
    expect(DispatchAssignment.parse(JSON.parse(arrived.body)).actual_arrival).not.toBeNull();
  });

  it('completing a run puts its plate and chaser back, in one transaction', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const list = await app!.inject({
      method: 'GET', url: `/api/v1/dispatch?organization_id=${orgId}&status=arrived`, headers: { cookie },
    });
    const a = (JSON.parse(list.body) as { items: { id: string; dealer_plate_id: string; chaser_vehicle_id: string | null }[] }).items[0]!;

    const done = await app!.inject({
      method: 'PATCH', url: `/api/v1/dispatch/${a.id}`, headers: { cookie }, payload: { status: 'completed' },
    });
    expect(done.statusCode).toBe(200);
    expect(DispatchAssignment.parse(JSON.parse(done.body)).completed_at).not.toBeNull();

    const plate = await admin.query<{ status: string; assigned_chaser_id: string | null }>(
      `SELECT status, assigned_chaser_id FROM dealer_plates WHERE id = $1`, [a.dealer_plate_id],
    );
    expect(plate.rows[0]!.status).toBe('available');
    expect(plate.rows[0]!.assigned_chaser_id).toBeNull();
    if (a.chaser_vehicle_id) {
      const chaser = await admin.query<{ status: string }>(
        `SELECT status FROM chaser_vehicles WHERE id = $1`, [a.chaser_vehicle_id],
      );
      expect(chaser.rows[0]!.status).toBe('available');
    }
  });

  it('cancelling releases resources too — a called-off run is not a lost plate', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal({ tradeIn: true, bookedAt: '2026-10-01T09:00:00Z' });
    const created = await book(dealId);
    expect(created.statusCode).toBe(201);
    const a = DispatchAssignment.parse(JSON.parse(created.body));
    expect(a.conflict_flag).toBe(false);

    const cancelled = await app!.inject({
      method: 'PATCH', url: `/api/v1/dispatch/${a.id}`, headers: { cookie }, payload: { status: 'cancelled' },
    });
    expect(cancelled.statusCode).toBe(200);
    const plate = await admin.query<{ status: string }>(
      `SELECT status FROM dealer_plates WHERE id = $1`, [a.dealer_plate_id],
    );
    expect(plate.rows[0]!.status).toBe('available');
  });

  it('a deal with no booked delivery time is refused, not booked blind', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/deals', headers: { cookie },
      payload: {
        organization_id: orgId, store_id: storeId, province: 'QC',
        sale_price_cents: 1_000_000, vehicle_cost_cents: 900_000, interest_rate_bps: 599, term_months: 60,
      },
    });
    const dealId = (JSON.parse(res.body) as { id: string }).id;
    const booked = await book(dealId);
    // Without a time there is nothing to schedule against and no conflict can
    // be computed.
    expect(booked.statusCode).toBe(422);
  });

  it('a store with no plates at all is a clear refusal', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Not "every plate is busy" — a plate is never busy for a future date. This
    // is the setup problem: the store owns no plates.
    await admin.query(`UPDATE dealer_plates SET deleted_at = now()`);
    const dealId = await makeDeal({ tradeIn: true, bookedAt: '2026-11-01T09:00:00Z' });
    const res = await book(dealId);
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('no_plate_available');
    await admin.query(`UPDATE dealer_plates SET deleted_at = NULL`);
  });


  it('a flag clears when the run it collided with is cancelled', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Both plates busy that afternoon, so this one is flagged.
    const aId = await makeDeal({ tradeIn: true, bookedAt: '2028-04-01T10:00:00Z' });
    const bId = await makeDeal({ tradeIn: true, bookedAt: '2028-04-01T11:00:00Z' });
    const cId = await makeDeal({ tradeIn: true, bookedAt: '2028-04-01T12:00:00Z' });
    const a = DispatchAssignment.parse(JSON.parse((await book(aId)).body));
    await book(bId);
    const c = DispatchAssignment.parse(JSON.parse((await book(cId)).body));
    expect(c.conflict_flag).toBe(true);

    // Cancel the run it cites. The citation is now stale: left alone, the
    // flagged run sits on the dispatcher's board forever pointing at a delivery
    // that is not happening.
    await app!.inject({
      method: 'PATCH', url: `/api/v1/dispatch/${a.id}`, headers: { cookie }, payload: { status: 'cancelled' },
    });

    const after = await app!.inject({
      method: 'GET', url: `/api/v1/dispatch?organization_id=${orgId}&conflicts_only=true`, headers: { cookie },
    });
    const stillFlagged = (JSON.parse(after.body) as { items: { id: string }[] }).items.map((i) => i.id);
    expect(stillFlagged).not.toContain(c.id);
  });

  it('a plate a booked run needs cannot be retired', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal({ tradeIn: true, bookedAt: '2028-06-01T10:00:00Z' });
    const a = DispatchAssignment.parse(JSON.parse((await book(dealId)).body));

    const res = await app!.inject({
      method: 'DELETE', url: `/api/v1/plates/${a.dealer_plate_id}`, headers: { cookie },
    });
    // Otherwise a dispatcher finds out on the morning of the delivery.
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('in_use');

    // Free it properly: earlier tests in this file leave other live runs on the
    // same plate, and each of them is a real reason to refuse.
    const live = await app!.inject({
      method: 'GET', url: `/api/v1/dispatch?organization_id=${orgId}&limit=100`, headers: { cookie },
    });
    const holders = (JSON.parse(live.body) as { items: { id: string; dealer_plate_id: string | null; status: string }[] })
      .items.filter((i) => i.dealer_plate_id === a.dealer_plate_id && !['completed', 'cancelled'].includes(i.status));
    for (const h of holders) {
      await app!.inject({
        method: 'PATCH', url: `/api/v1/dispatch/${h.id}`, headers: { cookie }, payload: { status: 'cancelled' },
      });
    }
    const now = await app!.inject({
      method: 'DELETE', url: `/api/v1/plates/${a.dealer_plate_id}`, headers: { cookie },
    });
    expect(now.statusCode).toBe(204);
  });

  it('a retired plate is never offered again', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const remaining = await app!.inject({
      method: 'GET', url: `/api/v1/plates?organization_id=${orgId}`, headers: { cookie },
    });
    const ids = (JSON.parse(remaining.body) as { items: { id: string }[] }).items.map((i) => i.id);
    const dealId = await makeDeal({ tradeIn: true, bookedAt: '2028-07-01T10:00:00Z' });
    const a = DispatchAssignment.parse(JSON.parse((await book(dealId)).body));
    expect(ids).toContain(a.dealer_plate_id);
  });


  it('booking emails the driver company everything they need', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal({ tradeIn: false, bookedAt: '2029-03-01T09:00:00Z' });
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/dispatch', headers: { cookie },
      payload: {
        deal_id: dealId,
        driver_company_id: companyId,
        pickup_address: '123 rue Principale, Mont-Laurier',
        delivery_address: '456 avenue des Pins, Laval',
        cash_to_collect_cents: 150_000,
        special_instructions: 'Client works nights — call before 10h',
      },
    });
    expect(res.statusCode).toBe(201);

    const mail = sent[sent.length - 1]!;
    expect(mail.to).toBe('dispatch@supreme.test');
    // FR first (Bill 96), and both languages always — the driver companies a
    // Quebec group uses are not reliably bilingual in either direction.
    expect(mail.text.indexOf('Demande de chauffeur')).toBeLessThan(mail.text.indexOf('Driver request'));
    expect(mail.text).toContain('123 rue Principale');
    expect(mail.text).toContain('456 avenue des Pins');
    // Money a driver physically carries, formatted for a human in both locales.
    // Intl uses a narrow no-break space in fr-CA, so normalize before matching
    // rather than pinning the test to one Unicode space.
    const normalized = mail.text.replace(/[\s\u00a0\u202f]+/g, ' ');
    expect(normalized).toContain('1 500,00 $');
    expect(normalized).toContain('$1,500.00');
    expect(mail.text).toContain('Client works nights');
    // WHY a second driver exists, spelled out rather than left as a number.
    expect(mail.text).toContain('un deuxième chauffeur suit');
    expect(mail.text).toContain('a second driver follows');

    expect(DispatchAssignment.parse(JSON.parse(res.body)).email_sent_at).not.toBeNull();
  });

  it('a trade-in email explains the driver comes back in the trade', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal({ tradeIn: true, bookedAt: '2029-04-01T09:00:00Z' });
    await app!.inject({
      method: 'POST', url: '/api/v1/dispatch', headers: { cookie },
      payload: { deal_id: dealId, driver_company_id: companyId },
    });
    const mail = sent[sent.length - 1]!;
    expect(mail.text).toContain("échange à ramener");
    expect(mail.text).toContain('trade-in to bring back');
  });

  it('the signed file must be ready before a driver is sent (§9 gate)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dealId = await makeDeal({ tradeIn: true, bookedAt: '2029-05-01T09:00:00Z', wetInk: false });
    // Reaching Signed is what builds the document file (documents.md §3).
    await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}`, headers: { cookie },
      payload: { pipeline_stage: 'submitted' },
    });
    await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}`, headers: { cookie },
      payload: { pipeline_stage: 'approved' },
    });
    await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}`, headers: { cookie },
      payload: { pipeline_stage: 'signed' },
    });
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/dispatch', headers: { cookie },
      payload: { deal_id: dealId, driver_company_id: companyId },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('wet_ink_not_ready');
    // And it names the paperwork, rather than just refusing.
    expect(JSON.parse(res.body).error.details.length).toBeGreaterThan(0);

    // Waiving the CHECKLIST no longer gets a driver out the door: the gate reads
    // the documents. This was the bypass — four roles hold checklist:waive.
    const waived = await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}/checklist/wet_ink_file`, headers: { cookie },
      payload: { overridden: true, override_reason: 'Client is waiting, send it' },
    });
    expect(waived.statusCode).toBe(422);
    const stillRefused = await app!.inject({
      method: 'POST', url: '/api/v1/dispatch', headers: { cookie },
      payload: { deal_id: dealId, driver_company_id: companyId },
    });
    expect(stillRefused.statusCode).toBe(422);

    // Printing the file is what unblocks it — the actual workflow.
    await prepareDocuments(dealId);
    const after = await app!.inject({
      method: 'POST', url: '/api/v1/dispatch', headers: { cookie },
      payload: { deal_id: dealId, driver_company_id: companyId },
    });
    expect(after.statusCode).toBe(201);
  });

  it('a run with no driver company books fine and sends nothing', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const before = sent.length;
    const dealId = await makeDeal({ tradeIn: true, bookedAt: '2029-06-01T09:00:00Z' });
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/dispatch', headers: { cookie }, payload: { deal_id: dealId },
    });
    // A store may drive its own deliveries; that is not an error.
    expect(res.statusCode).toBe(201);
    expect(DispatchAssignment.parse(JSON.parse(res.body)).email_sent_at).toBeNull();
    expect(sent.length).toBe(before);
  });

  it('resend goes out again and refuses when there is nobody to email', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const withCompany = await app!.inject({
      method: 'GET', url: `/api/v1/dispatch?organization_id=${orgId}&limit=100`, headers: { cookie },
    });
    const items = (JSON.parse(withCompany.body) as { items: { id: string; driver_company_id: string | null }[] }).items;
    const withOne = items.find((i) => i.driver_company_id !== null)!;
    const without = items.find((i) => i.driver_company_id === null)!;

    const before = sent.length;
    const again = await app!.inject({
      method: 'POST', url: `/api/v1/dispatch/${withOne.id}/resend`, headers: { cookie },
    });
    expect(again.statusCode).toBe(200);
    expect(sent.length).toBe(before + 1);

    const nobody = await app!.inject({
      method: 'POST', url: `/api/v1/dispatch/${without.id}/resend`, headers: { cookie },
    });
    expect(nobody.statusCode).toBe(422);
    expect(JSON.parse(nobody.body).error.code).toBe('no_driver_company');
  });

  it('a group-wide driver company is offered to every store', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const groupWide = await app!.inject({
      method: 'POST', url: '/api/v1/driver-companies', headers: { cookie },
      payload: { organization_id: orgId, name: 'Denise Guys', email: 'ops@deniseguys.test' },
    });
    expect(groupWide.statusCode).toBe(201);
    const list = await app!.inject({
      method: 'GET', url: `/api/v1/driver-companies?organization_id=${orgId}&store_id=${storeId}`, headers: { cookie },
    });
    const names = (JSON.parse(list.body) as { items: { name: string }[] }).items.map((i) => i.name);
    // NULL store means the whole group may use them (§9).
    expect(names).toContain('Denise Guys');
    expect(names).toContain('Transport Supreme');
  });

  it('another organization sees none of this fleet', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const rival = await app!.inject({
      method: 'POST', url: '/api/auth/sign-up/email',
      payload: { email: `f11-rival-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Rival' },
    });
    const rc = rival.headers['set-cookie'];
    const rivalCookie = (Array.isArray(rc) ? rc : [rc!]).map((c) => c!.split(';')[0]).join('; ');
    await app!.inject({
      method: 'POST', url: '/api/v1/organizations', headers: { cookie: rivalCookie },
      payload: { name: 'Rival Motors', slug: `rival-f11-${run}` },
    });

    // A cross-tenant organization_id must not confirm it exists.
    const res = await app!.inject({
      method: 'GET', url: `/api/v1/plates?organization_id=${orgId}`, headers: { cookie: rivalCookie },
    });
    expect(res.statusCode).toBe(404);

    // Driver companies carry a partner's contact details — same rule.
    const companies = await app!.inject({
      method: 'GET', url: `/api/v1/driver-companies?organization_id=${orgId}`, headers: { cookie: rivalCookie },
    });
    expect(companies.statusCode).toBe(404);
  });
});
