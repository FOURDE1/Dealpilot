import { afterAll, beforeAll, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { Redis } from 'ioredis';
import {
  createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, withTenant, type Pool,
} from '@dealpilot/db';
import {
  REALTIME_EVENT, REALTIME_SUBSCRIBE, type RealtimeEventT, type SubscribeResultT,
} from '@dealpilot/contracts';
import { buildApp } from './app.js';
import { attachRealtime } from './realtime.js';

/**
 * The Redis adapter, doing the one thing it is for (ADR-004, ADR-012).
 *
 * Production runs "min 2 API tasks / 2 AZs" behind an ALB. A browser holds its
 * websocket to whichever task the load balancer picked; the message it is
 * waiting for is written by whichever task took the HTTP request. Those are
 * usually different tasks, and without the adapter the event is emitted into an
 * empty process and the customer's reply never appears.
 *
 * So: two servers, one Redis, a client on the first, an emit from the second.
 * Anything less tests that Socket.IO can talk to itself.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6381';
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);

let admin: Pool;
let alpha: Awaited<ReturnType<typeof buildApp>> | undefined;
let bravo: Awaited<ReturnType<typeof buildApp>> | undefined;
let alphaRt: Awaited<ReturnType<typeof attachRealtime>> | undefined;
let bravoRt: Awaited<ReturnType<typeof attachRealtime>> | undefined;
let client: ClientSocket | undefined;

let ready = false;
let cookie = '';
let orgId = '';
let conversationId = '';
let alphaUrl = '';

/** Is there a Redis to talk to? Without one this suite has nothing to prove. */
async function redisReachable(): Promise<boolean> {
  const probe = new Redis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    connectTimeout: 1500,
  });
  try {
    await probe.connect();
    await probe.ping();
    return true;
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}

beforeAll(async () => {
  await ensureTestDatabase();
  admin = createPool({ connectionString: ADMIN_URL, max: 2 });
  try {
    await admin.query('SELECT 1');
  } catch {
    if (process.env['RLS_REQUIRED']) throw new Error('RLS_REQUIRED set but database unreachable');
    return;
  }
  if (!(await redisReachable())) {
    // CI provides Redis (ci.yml services.redis) and so does docker-compose. A
    // developer without either gets a skip rather than a red build they cannot
    // act on — but RLS_REQUIRED, the "this run must be real" flag, refuses.
    if (process.env['RLS_REQUIRED']) throw new Error('RLS_REQUIRED set but Redis unreachable');
    return;
  }
  await reset(admin, migrationsDir, ADMIN_URL);

  alpha = await buildApp({ DATABASE_URL: APP_URL, NODE_ENV: 'test' });
  bravo = await buildApp({ DATABASE_URL: APP_URL, NODE_ENV: 'test' });
  alphaRt = await attachRealtime(alpha.app, {
    auth: alpha.auth, pool: alpha.pool, presence: alpha.presence, webOrigin: '*', redisUrl: REDIS_URL,
  });
  bravoRt = await attachRealtime(bravo.app, {
    auth: bravo.auth, pool: bravo.pool, presence: bravo.presence, webOrigin: '*', redisUrl: REDIS_URL,
  });

  await alpha.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = alpha.app.server.address();
  alphaUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  const su = await alpha.app.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f28b-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Sophie' },
  });
  const sc = su.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');

  const org = await alpha.app.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe F28b', slug: `groupe-f28b-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await alpha.app.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Rooftop', code: `F8B-${run.slice(-4)}`, province: 'QC' },
  });
  const storeId = (JSON.parse(store.body) as { id: string }).id;

  conversationId = await withTenant(alpha.pool, orgId, async (c) => {
    const r = await c.query<{ id: string }>(
      `INSERT INTO conversations (organization_id, store_id, phone_e164)
       VALUES ($1,$2,'+15145558811') RETURNING id`,
      [orgId, storeId],
    );
    return r.rows[0]!.id;
  });
  ready = true;
}, 90_000);

afterAll(async () => {
  client?.close();
  await alphaRt?.close();
  await bravoRt?.close();
  await alpha?.app.close();
  await bravo?.app.close();
  await admin?.end();
});

it('carries an event from the task that wrote it to the task holding the socket', async (ctx) => {
  if (!ready) return ctx.skip();

  client = connect(alphaUrl, {
    path: '/realtime',
    transports: ['websocket'],
    extraHeaders: { cookie },
    reconnection: false,
  });
  await new Promise<void>((resolve, reject) => {
    client!.on('connect', () => resolve());
    client!.on('connect_error', reject);
  });

  const sub = await new Promise<SubscribeResultT>((resolve) => {
    client!.emit(
      REALTIME_SUBSCRIBE,
      { kind: 'conversation', organization_id: orgId, conversation_id: conversationId },
      resolve,
    );
  });
  expect(sub.ok, JSON.stringify(sub)).toBe(true);

  const arrived = new Promise<RealtimeEventT>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('nothing crossed the adapter')), 8000);
    client!.on(REALTIME_EVENT, (e: RealtimeEventT) => {
      clearTimeout(timer);
      resolve(e);
    });
  });

  // BRAVO emits. The client is connected to ALPHA and has never spoken to
  // bravo — the only path between them is Redis.
  bravoRt!.emitter.emit(
    { kind: 'conversation', organizationId: orgId, conversationId },
    {
      type: 'conversation.changed',
      organization_id: orgId,
      conversation_id: conversationId,
      status: 'agent_active',
      assigned_agent_id: null,
    },
  );

  expect(await arrived).toMatchObject({
    type: 'conversation.changed',
    organization_id: orgId,
    conversation_id: conversationId,
  });
}, 30_000);

it('does not carry it to a room nobody joined', async (ctx) => {
  if (!ready) return ctx.skip();

  const stray: RealtimeEventT[] = [];
  client!.on(REALTIME_EVENT, (e: RealtimeEventT) => stray.push(e));

  // A different conversation in the SAME organisation. The adapter fans out by
  // room, and a client subscribed to one conversation must not receive another
  // — the tenant prefix alone is not isolation.
  const other = await withTenant(alpha!.pool, orgId, async (c) => {
    const r = await c.query<{ id: string }>(
      `SELECT id FROM conversations WHERE id <> $1 LIMIT 1`, [conversationId],
    );
    return r.rows[0]?.id ?? '99999999-9999-4999-8999-999999999999';
  });

  bravoRt!.emitter.emit(
    { kind: 'conversation', organizationId: orgId, conversationId: other },
    {
      type: 'conversation.changed',
      organization_id: orgId,
      conversation_id: other,
      status: 'closed',
      assigned_agent_id: null,
    },
  );

  await new Promise((r) => setTimeout(r, 600));
  expect(stray).toEqual([]);
}, 30_000);
