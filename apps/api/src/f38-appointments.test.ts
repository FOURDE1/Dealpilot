import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { buildApp } from './app.js';

/**
 * F-38 — the appointments console.
 *
 * The cases that matter are the ones a scheduling screen gets wrong quietly:
 * a board that renders empty for everybody (the D-046 class 0044 exists to
 * prevent), a cancellation whose reason gets lost, and a cancelled slot that
 * quietly comes back to life.
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
let userId = '';

function future(hoursFromNow: number, lengthMinutes = 45) {
  const starts = new Date(Date.now() + hoursFromNow * 3_600_000);
  const ends = new Date(starts.getTime() + lengthMinutes * 60_000);
  return { starts_at: starts.toISOString(), ends_at: ends.toISOString() };
}

function book(extra: Record<string, unknown> = {}, who = cookie) {
  return app!.inject({
    method: 'POST', url: '/api/v1/appointments', headers: { cookie: who },
    payload: {
      organization_id: orgId, store_id: storeId, kind: 'test_drive',
      ...future(24), ...extra,
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

  const su = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f38-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Rachelle' },
  });
  const sc = su.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');

  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe F38', slug: `groupe-f38-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Rendez-vous', code: `F38-${run.slice(-4)}`, province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;
  const me = await app!.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie } });
  userId = (JSON.parse(me.body) as { user: { id: string } }).user.id;

  const rival = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f38-rival-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Rival' },
  });
  const rsc = rival.headers['set-cookie'];
  rivalCookie = (Array.isArray(rsc) ? rsc : [rsc!]).map((c) => c!.split(';')[0]).join('; ');
  const rivalOrg = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie: rivalCookie },
    payload: { name: 'Rival F38', slug: `rival-f38-${run}` },
  });
  expect(rivalOrg.statusCode, rivalOrg.body).toBe(201);
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('booking from the console', () => {
  it('books and the board shows it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await book({ vehicle_stock_number: 'K1234', notes: 'Essai du Sportage' });
    expect(res.statusCode, res.body).toBe(201);
    const a = JSON.parse(res.body) as { id: string; booked_by: string; status: string };
    expect(a.booked_by).toBe('agent');
    expect(a.status).toBe('booked');

    // The list runs under withUser: before 0044 this returned an empty board
    // for EVERYBODY, which is the exact failure contacts shipped with (D-046).
    const board = await app!.inject({
      method: 'GET', url: `/api/v1/appointments?organization_id=${orgId}`, headers: { cookie },
    });
    expect(board.statusCode, board.body).toBe(200);
    const body = JSON.parse(board.body) as { items: { id: string }[]; truncated: boolean };
    expect(body.items.map((x) => x.id)).toContain(a.id);
    expect(body.truncated).toBe(false);
  });

  it('refuses an appointment that ends before it starts', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = future(24);
    const res = await book({ starts_at: t.ends_at, ends_at: t.starts_at });
    expect(res.statusCode).toBe(422);
  });

  it('keeps the past off the default board, reachable on request', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // The 0037 CHECK only orders ends after starts; history is legal to write.
    const past = await admin.query<{ id: string }>(
      `INSERT INTO appointments (organization_id, store_id, kind, starts_at, ends_at, booked_by, status)
       VALUES ($1, $2, 'showroom_visit', now() - interval '2 days', now() - interval '47 hours', 'agent', 'completed')
       RETURNING id`,
      [orgId, storeId],
    );
    const board = await app!.inject({
      method: 'GET', url: `/api/v1/appointments?organization_id=${orgId}`, headers: { cookie },
    });
    const ids = (JSON.parse(board.body) as { items: { id: string }[] }).items.map((x) => x.id);
    expect(ids).not.toContain(past.rows[0]!.id);

    const history = await app!.inject({
      method: 'GET', url: `/api/v1/appointments?organization_id=${orgId}&upcoming=false`, headers: { cookie },
    });
    const all = (JSON.parse(history.body) as { items: { id: string }[] }).items.map((x) => x.id);
    expect(all).toContain(past.rows[0]!.id);
  });
});

describe('taking an appointment', () => {
  it('assigns an active member and records it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const a = JSON.parse((await book()).body) as { id: string };
    const res = await app!.inject({
      method: 'PATCH', url: `/api/v1/appointments/${a.id}`, headers: { cookie },
      payload: { assigned_agent_id: userId },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((JSON.parse(res.body) as { assigned_agent_id: string }).assigned_agent_id).toBe(userId);

    const events = await admin.query(
      `SELECT 1 FROM activity_events WHERE entity_type = 'appointment' AND entity_id = $1 AND action = 'assigned'`,
      [a.id],
    );
    expect(events.rows.length).toBeGreaterThan(0);
  });

  it('refuses a stranger as the agent, by name', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const a = JSON.parse((await book()).body) as { id: string };
    const res = await app!.inject({
      method: 'PATCH', url: `/api/v1/appointments/${a.id}`, headers: { cookie },
      // A real user — the rival's — who is NOT a member here. Membership is the
      // check, not existence.
      payload: { assigned_agent_id: '00000000-0000-4000-8000-00000000f38a' },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body)).toMatchObject({ error: { code: 'unknown_agent' } });
  });

  it('confirms without losing the agent', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const a = JSON.parse((await book()).body) as { id: string };
    await app!.inject({
      method: 'PATCH', url: `/api/v1/appointments/${a.id}`, headers: { cookie },
      payload: { assigned_agent_id: userId },
    });
    const res = await app!.inject({
      method: 'PATCH', url: `/api/v1/appointments/${a.id}`, headers: { cookie },
      payload: { status: 'confirmed' },
    });
    const body = JSON.parse(res.body) as { status: string; assigned_agent_id: string | null };
    expect(body.status).toBe('confirmed');
    // A one-field PATCH must not reset the others — the defaults-leak shape.
    expect(body.assigned_agent_id).toBe(userId);
  });
});

describe('the status state machine (2026-08-19 audit)', () => {
  async function setStatus(id: string, status: string) {
    return app!.inject({
      method: 'PATCH', url: `/api/v1/appointments/${id}`, headers: { cookie },
      payload: { status },
    });
  }

  it('an appointment that happened never becomes scheduled again', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const a = JSON.parse((await book()).body) as { id: string };
    expect((await setStatus(a.id, 'completed')).statusCode).toBe(200);
    const back = await setStatus(a.id, 'booked');
    expect(back.statusCode, back.body).toBe(422);
    expect(back.body).toContain('invalid_status_transition');
  });

  it('no_show and completed may correct each other — late walk-ins are real', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const a = JSON.parse((await book()).body) as { id: string };
    expect((await setStatus(a.id, 'no_show')).statusCode).toBe(200);
    const corrected = await setStatus(a.id, 'completed');
    expect(corrected.statusCode, corrected.body).toBe(200);
  });

  it("PATCH can never set 'cancelled' — the schema keeps that value for the cancel endpoint", async (ctx) => {
    if (!dbUp) return ctx.skip();
    const a = JSON.parse((await book()).body) as { id: string };
    const res = await setStatus(a.id, 'cancelled');
    // Refused at the SCHEMA (the enum for PATCH omits it), never reaching SQL
    // where it would trip the 0037 cancelled_at CHECK as a 500.
    expect(res.statusCode, res.body).toBe(422);
    expect(res.body).toContain('"path":"status"');
  });
});

describe('cancelling', () => {
  it('requires a real reason and keeps it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const a = JSON.parse((await book()).body) as { id: string };

    const bare = await app!.inject({
      method: 'POST', url: `/api/v1/appointments/${a.id}/cancel`, headers: { cookie },
      payload: { reason: 'x' },
    });
    // Too short to explain anything: the board shows WHY a slot went empty.
    expect(bare.statusCode).toBe(422);

    const res = await app!.inject({
      method: 'POST', url: `/api/v1/appointments/${a.id}/cancel`, headers: { cookie },
      payload: { reason: 'Client a rappelé — reporté à la semaine prochaine' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = JSON.parse(res.body) as { status: string; cancelled_at: string | null; cancelled_reason: string | null };
    expect(body.status).toBe('cancelled');
    expect(body.cancelled_at).not.toBeNull();
    expect(body.cancelled_reason).toContain('reporté');
  });

  it('a second cancel does not overwrite the first reason', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const a = JSON.parse((await book()).body) as { id: string };
    await app!.inject({
      method: 'POST', url: `/api/v1/appointments/${a.id}/cancel`, headers: { cookie },
      payload: { reason: 'La première raison, la vraie' },
    });
    const again = await app!.inject({
      method: 'POST', url: `/api/v1/appointments/${a.id}/cancel`, headers: { cookie },
      payload: { reason: 'Une réécriture tardive' },
    });
    expect(again.statusCode).toBe(422);
    expect(JSON.parse(again.body)).toMatchObject({ error: { code: 'already_cancelled' } });

    const row = await admin.query<{ cancelled_reason: string }>(
      `SELECT cancelled_reason FROM appointments WHERE id = $1`, [a.id],
    );
    expect(row.rows[0]!.cancelled_reason).toBe('La première raison, la vraie');
  });

  it('a cancelled appointment cannot be edited back to life', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const a = JSON.parse((await book()).body) as { id: string };
    await app!.inject({
      method: 'POST', url: `/api/v1/appointments/${a.id}/cancel`, headers: { cookie },
      payload: { reason: 'Annulé pour de bon' },
    });
    const revive = await app!.inject({
      method: 'PATCH', url: `/api/v1/appointments/${a.id}`, headers: { cookie },
      payload: { status: 'confirmed' },
    });
    expect(revive.statusCode).toBe(422);
    expect(JSON.parse(revive.body)).toMatchObject({ error: { code: 'appointment_cancelled' } });
  });

  it('the default board hides cancelled slots', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const a = JSON.parse((await book()).body) as { id: string };
    await app!.inject({
      method: 'POST', url: `/api/v1/appointments/${a.id}/cancel`, headers: { cookie },
      payload: { reason: 'Client ne se présentera pas' },
    });
    const board = await app!.inject({
      method: 'GET', url: `/api/v1/appointments?organization_id=${orgId}`, headers: { cookie },
    });
    const ids = (JSON.parse(board.body) as { items: { id: string }[] }).items.map((x) => x.id);
    expect(ids).not.toContain(a.id);
  });
});

describe('another dealership', () => {
  it('sees an empty board here and gets 404 on our slots', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const a = JSON.parse((await book()).body) as { id: string };

    const list = await app!.inject({
      method: 'GET', url: `/api/v1/appointments?organization_id=${orgId}`, headers: { cookie: rivalCookie },
    });
    // Asking for OUR org by id is a 404 — membership is the gate.
    expect(list.statusCode).toBe(404);

    const patch = await app!.inject({
      method: 'PATCH', url: `/api/v1/appointments/${a.id}`, headers: { cookie: rivalCookie },
      payload: { status: 'confirmed' },
    });
    expect(patch.statusCode).toBe(404);

    const cancel = await app!.inject({
      method: 'POST', url: `/api/v1/appointments/${a.id}/cancel`, headers: { cookie: rivalCookie },
      payload: { reason: 'Sabotage du concurrent' },
    });
    expect(cancel.statusCode).toBe(404);
  });
});
