import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { buildApp } from './app.js';
import type { EmailMessage, Mailer } from './email.js';

/**
 * F-11c — the customer hears that their car left.
 *
 * `customer_notified_at` had been a column since F-11's first migration and
 * nothing ever wrote to it: the board could say a customer was told when
 * nobody had told them. Same dead-vocabulary shape as `sold_as_is` (CR-12) and
 * the three unreachable document types (F-13b).
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);

const sent: EmailMessage[] = [];
let failSend = false;
const mailer: Mailer = {
  deliversToRecipient: true,
  async send(message) {
    if (failSend) return false;
    sent.push(message);
    return true;
  },
};

let admin: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookie = '';
let orgId = '';
let storeId = '';

/** A whole delivery, from lead to a booked run ready to depart. */
async function bookRun(leadPayload: Record<string, unknown> | null) {
  let leadId: string | null = null;
  if (leadPayload) {
    const lead = await app!.inject({
      method: 'POST', url: '/api/v1/leads', headers: { cookie },
      payload: { organization_id: orgId, store_id: storeId, source: 'walk_in', ...leadPayload },
    });
    expect(lead.statusCode, lead.body).toBe(201);
    leadId = (JSON.parse(lead.body) as { id: string }).id;
  }
  const vehicle = await app!.inject({
    method: 'POST', url: '/api/v1/vehicles', headers: { cookie },
    payload: {
      organization_id: orgId, store_id: storeId, stock_number: `F11C-${run}-${Math.random().toString(36).slice(2, 8)}`,
      year: 2024, make: 'Kia', model: 'Sportage', acquisition_type: 'dealer_trade',
    },
  });
  // Asserted, not assumed: an unchecked fixture step that 422s leaves the test
  // passing against a deal with no vehicle, proving less than it claims to.
  expect(vehicle.statusCode, vehicle.body).toBe(201);
  const vehicleId = (JSON.parse(vehicle.body) as { id: string }).id;

  const deal = await app!.inject({
    method: 'POST', url: '/api/v1/deals', headers: { cookie },
    payload: {
      organization_id: orgId, store_id: storeId, province: 'QC',
      sale_price_cents: 3_000_000, vehicle_cost_cents: 2_700_000,
      interest_rate_bps: 599, term_months: 60,
      vehicle_id: vehicleId, ...(leadId ? { lead_id: leadId } : {}),
    },
  });
  expect(deal.statusCode, deal.body).toBe(201);
  const dealId = (JSON.parse(deal.body) as { id: string }).id;

  // The wet-ink gate refuses to send a driver with an unprepared file (F-13),
  // so the file is genuinely prepared here — through the batch endpoint, the
  // way a filing clerk would, rather than with raw SQL that would prove
  // nothing about the product.
  const file = JSON.parse((await app!.inject({
    method: 'GET', url: `/api/v1/deals/${dealId}/documents`, headers: { cookie },
  })).body) as { items: { id: string; requires_signature: boolean }[] };
  const batch = async (ids: string[], status: string) => {
    if (ids.length === 0) return;
    const r = await app!.inject({
      method: 'POST', url: `/api/v1/deals/${dealId}/documents/batch`, headers: { cookie },
      payload: { document_ids: ids, status },
    });
    expect(r.statusCode, r.body).toBe(200);
  };
  await batch(file.items.map((d) => d.id), 'generated');
  await batch(file.items.filter((d) => d.requires_signature).map((d) => d.id), 'printed');
  await batch(file.items.filter((d) => !d.requires_signature).map((d) => d.id), 'in_file');

  const dispatch = await app!.inject({
    method: 'POST', url: '/api/v1/dispatch', headers: { cookie },
    payload: { deal_id: dealId, booked_delivery_at: '2026-08-15T14:00:00.000Z' },
  });
  expect(dispatch.statusCode, dispatch.body).toBe(201);
  return JSON.parse(dispatch.body) as { id: string };
}

async function depart(dispatchId: string, extra: Record<string, unknown> = {}) {
  return app!.inject({
    method: 'PATCH', url: `/api/v1/dispatch/${dispatchId}`, headers: { cookie },
    payload: { status: 'departed', ...extra },
  });
}

async function assignmentRow(dispatchId: string) {
  const r = await admin.query<{ customer_notified_at: Date | null }>(
    `SELECT customer_notified_at FROM dispatch_assignments WHERE id = $1`,
    [dispatchId],
  );
  return r.rows[0]!;
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
  ({ app } = await buildApp({ DATABASE_URL: APP_URL, NODE_ENV: 'test' }, { mailer }));

  const signUp = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f11c-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Alice Owner' },
  });
  const sc = signUp.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');

  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe F11c', slug: `groupe-f11c-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: {
      organization_id: orgId, name: 'F11c Kia', code: 'F11C-KIA', province: 'QC',
      phone: '+15145550199',
    },
  });
  expect(store.statusCode, store.body).toBe(201);
  storeId = (JSON.parse(store.body) as { id: string }).id;

  // A run needs a plate and a chaser to leave the lot at all (F-11).
  for (const [url, payload] of [
    ['/api/v1/plates', { organization_id: orgId, store_id: storeId, plate_number: `X${run.slice(-5)}` }],
    ['/api/v1/chasers', { organization_id: orgId, store_id: storeId, name: 'Chaser 1' }],
  ] as const) {
    const r = await app!.inject({ method: 'POST', url, headers: { cookie }, payload });
    expect(r.statusCode, r.body).toBe(201);
  }
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('when the driver leaves, the customer is told', () => {
  it('emails the customer in French by default, and stamps the run', async (ctx) => {
    if (!dbUp) return ctx.skip();
    sent.length = 0;
    const dispatch = await bookRun({
      first_name: 'Marie', email: `marie-${run}@example.test`, phone: '+15145550101',
    });
    expect((await assignmentRow(dispatch.id)).customer_notified_at).toBeNull();

    const res = await depart(dispatch.id, { eta_arrival: '2026-08-15T18:30:00.000Z' });
    expect(res.statusCode, res.body).toBe(200);

    const message = sent.find((m) => m.to === `marie-${run}@example.test`);
    expect(message, 'the customer was not emailed').toBeDefined();
    // Quebec French unless the customer said otherwise (Bill 96) — and ONE
    // language, not the bilingual wall the dispatch company gets.
    expect(message!.subject).toContain('en route');
    expect(message!.text).toContain('Bonjour Marie');
    expect(message!.text).not.toContain('Hello');
    expect(message!.text).toContain('2024 Kia Sportage');
    // The store's own number, so a worried customer can reach a human.
    expect(message!.text).toContain('+15145550199');

    expect((await assignmentRow(dispatch.id)).customer_notified_at).not.toBeNull();
  });

  it("uses the customer's language when they asked for English", async (ctx) => {
    if (!dbUp) return ctx.skip();
    sent.length = 0;
    const dispatch = await bookRun({
      first_name: 'John', email: `john-${run}@example.test`,
      phone: '+15145550102', preferred_language: 'en-CA',
    });
    await depart(dispatch.id);
    const message = sent.find((m) => m.to === `john-${run}@example.test`)!;
    expect(message.text).toContain('Hello John');
    expect(message.text).not.toContain('Bonjour');
  });

  it('states the arrival time in the STORE\'s timezone, not the server\'s', async (ctx) => {
    if (!dbUp) return ctx.skip();
    sent.length = 0;
    const dispatch = await bookRun({
      first_name: 'Luc', email: `luc-${run}@example.test`,
      phone: '+15145550103', preferred_language: 'en-CA',
    });
    // 18:30 UTC is 14:30 in Montreal. CI runs in UTC, so formatting without
    // the store's zone would tell the customer 6:30 PM and the driver would
    // knock at 2:30.
    await depart(dispatch.id, { eta_arrival: '2026-08-15T18:30:00.000Z' });
    const message = sent.find((m) => m.to === `luc-${run}@example.test`)!;
    expect(message.text).toContain('2:30');
    expect(message.text).not.toContain('6:30');
  });

  it('does not claim a customer was notified when there was nobody to notify', async (ctx) => {
    if (!dbUp) return ctx.skip();
    sent.length = 0;
    // A deal with no lead attached, and a lead with no email — both are real
    // (a walk-in who left a phone number only). Neither may leave a timestamp
    // saying the customer was told.
    const noLead = await bookRun(null);
    await depart(noLead.id);
    expect((await assignmentRow(noLead.id)).customer_notified_at).toBeNull();

    const noEmail = await bookRun({ first_name: 'Sans', phone: '+15145550104' });
    await depart(noEmail.id);
    expect((await assignmentRow(noEmail.id)).customer_notified_at).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('does not stamp the run when the send fails', async (ctx) => {
    if (!dbUp) return ctx.skip();
    sent.length = 0;
    const dispatch = await bookRun({
      first_name: 'Ana', email: `ana-${run}@example.test`, phone: '+15145550105',
    });
    failSend = true;
    try {
      const res = await depart(dispatch.id);
      // The delivery still departs — a mail outage must not strand a car.
      expect(res.statusCode).toBe(200);
    } finally {
      failSend = false;
    }
    // But the record must not say the customer was told.
    expect((await assignmentRow(dispatch.id)).customer_notified_at).toBeNull();
  });

  it('tells the customer again when the ETA moves, but not on every edit', async (ctx) => {
    if (!dbUp) return ctx.skip();
    sent.length = 0;
    const dispatch = await bookRun({
      first_name: 'Paul', email: `paul-${run}@example.test`, phone: '+15145550106',
    });
    await depart(dispatch.id, { eta_arrival: '2026-08-15T18:30:00.000Z' });
    expect(sent).toHaveLength(1);

    // A new arrival time is the one thing worth a second message.
    await app!.inject({
      method: 'PATCH', url: `/api/v1/dispatch/${dispatch.id}`, headers: { cookie },
      payload: { eta_arrival: '2026-08-15T20:00:00.000Z' },
    });
    expect(sent).toHaveLength(2);

    // Correcting the driver's phone number is not.
    await app!.inject({
      method: 'PATCH', url: `/api/v1/dispatch/${dispatch.id}`, headers: { cookie },
      payload: { driver_phone: '+15145550999' },
    });
    expect(sent).toHaveLength(2);
  });
});

describe("the run's status feed", () => {
  it('is the activity trail for that run, newest first', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dispatch = await bookRun({
      first_name: 'Feed', email: `feed-${run}@example.test`, phone: '+15145550107',
    });
    await depart(dispatch.id);
    await app!.inject({
      method: 'PATCH', url: `/api/v1/dispatch/${dispatch.id}`, headers: { cookie },
      payload: { status: 'arrived' },
    });

    const res = await app!.inject({
      method: 'GET', url: `/api/v1/dispatch/${dispatch.id}/status-updates`, headers: { cookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    const items = (JSON.parse(res.body) as { items: { changes: Record<string, unknown> }[] }).items;
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items[0]!.changes['status']).toMatchObject({ from: 'departed', to: 'arrived' });
    expect(items[1]!.changes['status']).toMatchObject({ from: 'assigned', to: 'departed' });
  });

  it("is a 404 for another organisation's run", async (ctx) => {
    if (!dbUp) return ctx.skip();
    const dispatch = await bookRun({
      first_name: 'Priv', email: `priv-${run}@example.test`, phone: '+15145550108',
    });
    const outsider = await app!.inject({
      method: 'POST', url: '/api/auth/sign-up/email',
      payload: { email: `f11c-out-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Bob' },
    });
    const osc = outsider.headers['set-cookie'];
    const outCookie = (Array.isArray(osc) ? osc : [osc!]).map((c) => c!.split(';')[0]).join('; ');
    const res = await app!.inject({
      method: 'GET', url: `/api/v1/dispatch/${dispatch.id}/status-updates`, headers: { cookie: outCookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
