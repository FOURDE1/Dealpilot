import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import {
  createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, withTenant, type Pool,
} from '@dealpilot/db';
import {
  REALTIME_EVENT, REALTIME_SUBSCRIBE, relayEmitter,
  type RealtimeEventT, type SubscribeResultT,
} from '@dealpilot/contracts';
import { buildApp } from './app.js';
import { attachRealtime } from './realtime.js';

/**
 * F-28 realtime (api-design.md §13, ADR-004).
 *
 * ADR-004: "realtime authorization is enforced at join/emit time by application
 * code — RLS no longer implicitly filters the stream." Every other read path in
 * this product has the database as a second opinion about who may see a row.
 * This one does not, so these cases carry the whole weight.
 *
 * They run against a REAL listening server and a REAL socket.io-client. A
 * websocket asserted through a mock proves that the mock agrees with itself.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);

let admin: Pool;
let appPool: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let realtime: Awaited<ReturnType<typeof attachRealtime>> | undefined;
let dbUp = false;
let url = '';

let cookie = '';
let rivalCookie = '';
let orgId = '';
let storeId = '';
let rivalOrgId = '';
let conversationId = '';
let rivalConversationId = '';

const sockets: ClientSocket[] = [];

/** A connected client, or the error that stopped it connecting. */
function open(cookieHeader: string | undefined): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = connect(url, {
      path: '/realtime',
      transports: ['websocket'],
      extraHeaders: cookieHeader ? { cookie: cookieHeader } : {},
      reconnection: false,
    });
    sockets.push(socket);
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (err) => reject(err));
  });
}

function subscribe(socket: ClientSocket, req: unknown): Promise<SubscribeResultT> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no ack')), 5000);
    socket.emit(REALTIME_SUBSCRIBE, req, (r: SubscribeResultT) => {
      clearTimeout(timer);
      resolve(r);
    });
  });
}

/**
 * Wait for a matching event, resolving the moment it arrives.
 *
 * NOT a fixed window. A window started before the HTTP call has to be longer
 * than the call takes, which is a guess about the slowest machine that will
 * ever run this — and guessing low gives a test that passes here and flakes in
 * CI at 3am.
 */
function waitForEvent(
  socket: ClientSocket,
  match: (e: RealtimeEventT) => boolean,
  ms = 8000,
): Promise<RealtimeEventT> {
  return new Promise((resolve, reject) => {
    const onEvent = (e: RealtimeEventT) => {
      if (!match(e)) return;
      clearTimeout(timer);
      socket.off(REALTIME_EVENT, onEvent);
      resolve(e);
    };
    const timer = setTimeout(() => {
      socket.off(REALTIME_EVENT, onEvent);
      reject(new Error('no matching realtime event arrived'));
    }, ms);
    socket.on(REALTIME_EVENT, onEvent);
  });
}

/**
 * Listen for a fixed moment and report everything that arrived.
 *
 * Only for proving a NEGATIVE, where there is no event to wait for and the
 * window has to start after the action rather than before it.
 */
function collectAfter(socket: ClientSocket, ms = 500): Promise<RealtimeEventT[]> {
  const seen: RealtimeEventT[] = [];
  socket.on(REALTIME_EVENT, (e: RealtimeEventT) => seen.push(e));
  return new Promise((resolve) => setTimeout(() => resolve(seen), ms));
}

async function signUp(email: string, name: string): Promise<string> {
  const res = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email, password: 'correct-horse-battery-staple', name },
  });
  const sc = res.headers['set-cookie'];
  return (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');
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
  appPool = createPool({ connectionString: APP_URL, max: 6 });

  const emitter = relayEmitter();
  const built = await buildApp({ DATABASE_URL: APP_URL, NODE_ENV: 'test' }, { emitter });
  app = built.app;
  // No REDIS_URL: one process fans out in-process, which is what a test wants.
  // The adapter is a transport detail; the authorization under test is not.
  //
  // The SAME auth instance the HTTP side uses — verifying the handshake against
  // a second instance would test that two Better Auth objects agree, not that
  // the socket accepts the cookie this server issued.
  realtime = await attachRealtime(app, {
    auth: built.auth,
    pool: built.pool,
    webOrigin: '*',
  });
  emitter.pointTo(realtime.emitter);

  await app!.listen({ port: 0, host: '127.0.0.1' });
  const address = app!.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  url = `http://127.0.0.1:${port}`;

  cookie = await signUp(`f28-${run}@dealpilot.test`, 'Sophie Tremblay');
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe F28', slug: `groupe-f28-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Rooftop', code: `F28-${run.slice(-4)}`, province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;

  rivalCookie = await signUp(`f28-rival-${run}@dealpilot.test`, 'Rival Rachel');
  const rivalOrg = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie: rivalCookie },
    payload: { name: 'Rival F28', slug: `rival-f28-${run}` },
  });
  rivalOrgId = (JSON.parse(rivalOrg.body) as { id: string }).id;
  const rivalStore = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie: rivalCookie },
    payload: { organization_id: rivalOrgId, name: 'Rival lot', code: `R28-${run.slice(-4)}`, province: 'QC' },
  });
  const rivalStoreId = (JSON.parse(rivalStore.body) as { id: string }).id;

  conversationId = await withTenant(appPool, orgId, async (c) => {
    const r = await c.query<{ id: string }>(
      `INSERT INTO conversations (organization_id, store_id, phone_e164) VALUES ($1,$2,'+15145558801') RETURNING id`,
      [orgId, storeId],
    );
    return r.rows[0]!.id;
  });
  rivalConversationId = await withTenant(appPool, rivalOrgId, async (c) => {
    const r = await c.query<{ id: string }>(
      `INSERT INTO conversations (organization_id, store_id, phone_e164) VALUES ($1,$2,'+15145558802') RETURNING id`,
      [rivalOrgId, rivalStoreId],
    );
    return r.rows[0]!.id;
  });
}, 60_000);

afterAll(async () => {
  for (const s of sockets) s.close();
  await realtime?.close();
  await app?.close();
  await appPool?.end();
  await admin?.end();
});

describe('the handshake', () => {
  it('refuses a connection with no session', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await expect(open(undefined)).rejects.toThrow(/unauthenticated/);
  });

  it('refuses a forged cookie', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await expect(open('better-auth.session_token=not-a-real-token')).rejects.toThrow(/unauthenticated/);
  });

  it('accepts a real session', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const socket = await open(cookie);
    expect(socket.connected).toBe(true);
  });
});

describe('subscribing', () => {
  it('opens a conversation room for a member who may read it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const socket = await open(cookie);
    const res = await subscribe(socket, {
      kind: 'conversation', organization_id: orgId, conversation_id: conversationId,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // The name is the server's, built from ids it checked.
    expect(res.room).toBe(`tenant:${orgId}:conversation:${conversationId}`);
  });

  it('refuses another organisation’s conversation', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const socket = await open(rivalCookie);
    const res = await subscribe(socket, {
      kind: 'conversation', organization_id: orgId, conversation_id: conversationId,
    });
    expect(res).toMatchObject({ ok: false, reason: 'not_a_member' });
  });

  it('refuses a conversation id from another organisation even under your own org', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // The dangerous shape: a real membership, a real conversation id, and no
    // relationship between them. RLS makes the row invisible; without the
    // lookup the room name would still have been built and joined.
    const socket = await open(cookie);
    const res = await subscribe(socket, {
      kind: 'conversation', organization_id: orgId, conversation_id: rivalConversationId,
    });
    expect(res).toMatchObject({ ok: false, reason: 'not_a_member' });
  });

  it('refuses a member who lacks conversation:read', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // A real colleague in the right organisation, with the permission revoked.
    // The realtime bar must equal the REST bar, so this must fail exactly as
    // GET /api/v1/conversations would.
    await admin.query(
      `INSERT INTO role_permissions (organization_id, role, permission, allowed)
       VALUES ($1,'owner','conversation:read',false)
       ON CONFLICT (organization_id, role, permission) DO UPDATE SET allowed = false`,
      [orgId],
    );
    try {
      const socket = await open(cookie);
      const res = await subscribe(socket, {
        kind: 'conversation', organization_id: orgId, conversation_id: conversationId,
      });
      expect(res).toMatchObject({ ok: false, reason: 'forbidden' });
    } finally {
      await admin.query(
        `UPDATE role_permissions SET allowed = true
         WHERE organization_id = $1 AND role = 'owner' AND permission = 'conversation:read'`,
        [orgId],
      );
    }
  });

  it('refuses a malformed request instead of guessing', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const socket = await open(cookie);
    for (const bad of [
      { kind: 'conversation', organization_id: orgId },
      { kind: 'nonsense', organization_id: orgId },
      { kind: 'conversation', organization_id: 'tenant:*', conversation_id: conversationId },
      'tenant:' + orgId + ':conversation:' + conversationId,
      null,
    ]) {
      const res = await subscribe(socket, bad);
      expect(res, JSON.stringify(bad)).toMatchObject({ ok: false });
    }
  });

  it('gives you your own notification room and nobody else’s', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const socket = await open(cookie);
    const me = await admin.query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1`, [`f28-${run}@dealpilot.test`],
    );
    const res = await subscribe(socket, { kind: 'notifications', organization_id: orgId });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // The user id in the room name came from the verified session; the request
    // has no field that could have named somebody else.
    expect(res.room).toBe(`tenant:${orgId}:user:${me.rows[0]!.id}:notifications`);
  });
});

describe('what actually arrives', () => {
  it('delivers an agent’s reply to the conversation room', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await app!.inject({
      method: 'POST', url: '/api/v1/consent', headers: { cookie },
      payload: {
        organization_id: orgId, phone_e164: '+15145558801',
        channels: ['sms'], scopes: ['conversational'],
        consent_type: 'express', source: 'staff_manual',
        evidence: { note: 'seeded for the realtime test' },
      },
    });

    const socket = await open(cookie);
    const res = await subscribe(socket, {
      kind: 'conversation', organization_id: orgId, conversation_id: conversationId,
    });
    expect(res.ok).toBe(true);

    const arrived = waitForEvent(socket, (e) => e.type === 'message.created');
    const sent = await app!.inject({
      method: 'POST', url: `/api/v1/conversations/${conversationId}/messages`,
      headers: { cookie }, payload: { body: 'Bonjour! Quand voulez-vous le voir?' },
    });
    expect(JSON.parse(sent.body)).toMatchObject({ kind: 'sent' });

    expect(await arrived).toMatchObject({
      organization_id: orgId,
      conversation_id: conversationId,
      direction: 'outbound',
      sender_type: 'agent',
    });
  });

  it('sends nothing to a rival who never joined the room', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const rival = await open(rivalCookie);
    // The rival is connected and authenticated — just not in this room. This is
    // the case ADR-004 removes the database backstop from.
    //
    // The window starts AFTER the write, so it measures silence rather than
    // racing the request: if the event were going to leak, it has already been
    // emitted by the time we start listening.
    await app!.inject({
      method: 'POST', url: `/api/v1/conversations/${conversationId}/close`,
      headers: { cookie }, payload: {},
    });
    expect(await collectAfter(rival, 500)).toEqual([]);
  });

  it('announces a status change to the room that owns it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const fresh = await withTenant(appPool, orgId, async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO conversations (organization_id, store_id, phone_e164)
         VALUES ($1,$2,'+15145558803') RETURNING id`,
        [orgId, storeId],
      );
      return r.rows[0]!.id;
    });
    const socket = await open(cookie);
    await subscribe(socket, { kind: 'conversation', organization_id: orgId, conversation_id: fresh });

    const arrived = waitForEvent(socket, (e) => e.type === 'conversation.changed');
    const res = await app!.inject({
      method: 'POST', url: `/api/v1/conversations/${fresh}/takeover`,
      headers: { cookie }, payload: {},
    });
    expect(res.statusCode, res.body).toBe(200);

    expect(await arrived).toMatchObject({
      conversation_id: fresh,
      status: 'agent_active',
    });
  });
});
