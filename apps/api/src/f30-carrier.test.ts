import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool,
} from '@dealpilot/db';
import { buildApp } from './app.js';
import { createCarrier, expectedSignature, type CarrierLogger } from './carrier.js';
import { loadEnv } from './env.js';

/**
 * The carrier webhooks (F-30) end to end.
 *
 * This is the only unauthenticated write path into the conversation engine. A
 * forged request here injects a fake customer message into a compliance-
 * critical CRM: it would be routed, recorded in the thread a person reads, and
 * could trip a STOP that revokes every consent this dealership holds for that
 * number. The signature cases below are the whole security boundary.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);

const TOKEN = 'carrier-test-auth-token';
const ORIGIN = 'https://api.dealpilot.test';

let admin: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookie = '';
let orgId = '';
let storeId = '';
let storeNumber = '';

/** Every job the webhook enqueues, recorded — the seam the roundtrip suite
 * cannot see from the workers side. */
const enqueued = {
  turns: [] as { conversation_id: string }[],
  extractions: [] as { conversation_id: string }[],
  analyses: [] as { conversation_id: string }[],
};
const recordingQueue = {
  enqueue: () => Promise.resolve(),
  enqueueAssistantTurn: (job: { conversation_id: string }) => {
    enqueued.turns.push(job);
    return Promise.resolve();
  },
  enqueueExtraction: (job: { conversation_id: string }) => {
    enqueued.extractions.push(job);
    return Promise.resolve();
  },
  enqueueLiveAnalysis: (job: { conversation_id: string }) => {
    enqueued.analyses.push(job);
    return Promise.resolve();
  },
  enqueueAnnouncementFanout: () => Promise.resolve(),
  enqueueFirstTouch: () => Promise.resolve(),
  close: () => Promise.resolve(),
};

const silentLogger: CarrierLogger = { info: () => {}, warn: () => {} };

/** POST a form-encoded webhook, signed exactly as the carrier would sign it. */
function webhook(path: string, params: Record<string, string>, opts: { sign?: boolean | string } = {}) {
  const url = `${ORIGIN}${path}`;
  const signature =
    opts.sign === false ? undefined
      : typeof opts.sign === 'string' ? opts.sign
        : expectedSignature(TOKEN, url, params);
  return app!.inject({
    method: 'POST',
    url: path,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(signature ? { 'x-twilio-signature': signature } : {}),
    },
    payload: new URLSearchParams(params).toString(),
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

  const env = loadEnv({
    DATABASE_URL: APP_URL,
    NODE_ENV: 'test',
    TWILIO_AUTH_TOKEN: TOKEN,
    PUBLIC_WEBHOOK_ORIGIN: ORIGIN,
  });
  ({ app } = await buildApp(
    { DATABASE_URL: APP_URL, NODE_ENV: 'test', TWILIO_AUTH_TOKEN: TOKEN, PUBLIC_WEBHOOK_ORIGIN: ORIGIN },
    { carrier: createCarrier(env, silentLogger), deferredQueue: recordingQueue },
  ));

  const su = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f30-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Sophie' },
  });
  const sc = su.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');

  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe F30', slug: `groupe-f30-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;

  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Rooftop', code: `F30-${run.slice(-4)}`, province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;

  // The carrier number, set through the ordinary store PATCH — no bespoke
  // route, which is the point of putting it on `stores`.
  storeNumber = `+1514555${String(9000 + (Date.now() % 900)).slice(0, 4)}`;
  const patch = await app!.inject({
    method: 'PATCH', url: `/api/v1/stores/${storeId}`, headers: { cookie },
    payload: { sms_number: storeNumber },
  });
  expect(patch.statusCode, patch.body).toBe(200);
  expect((JSON.parse(patch.body) as { sms_number: string }).sms_number).toBe(storeNumber);
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

async function messagesFor(phone: string): Promise<{ body: string; direction: string }[]> {
  const r = await admin.query<{ body: string; direction: string }>(
    `SELECT m.body, m.direction FROM messages m
     JOIN conversations cv ON cv.id = m.conversation_id
     WHERE cv.phone_e164 = $1 ORDER BY m.created_at`,
    [phone],
  );
  return r.rows;
}

describe('the queue seam (F-57): who gets a job for which branch', () => {
  it('a bot-active message enqueues BOTH passes; a handed-off one still gets the DATA pass', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const phone = '+15145557777';
    enqueued.turns.length = 0;
    enqueued.extractions.length = 0;

    enqueued.analyses.length = 0;

    const first = await webhook('/carrier/v1/sms/inbound', {
      To: storeNumber, From: phone, Body: 'Bonjour, je cherche un VUS', MessageSid: `SM-seam-1-${run}`,
    });
    expect(first.statusCode, first.body).toBe(204);
    expect(enqueued.turns).toHaveLength(1);
    expect(enqueued.extractions).toHaveLength(1);
    // The assistant holds this thread — no silent analyst duplicating it.
    expect(enqueued.analyses).toHaveLength(0);

    // Hand the thread to a person (the CHECK demands an assigned agent);
    // §5 extraction must keep riding messages.
    await admin.query(
      `UPDATE conversations
       SET status = 'agent_active',
           assigned_agent_id = (SELECT user_id FROM memberships WHERE organization_id = $2 LIMIT 1)
       WHERE phone_e164 = $1`,
      [phone, orgId],
    );
    const second = await webhook('/carrier/v1/sms/inbound', {
      To: storeNumber, From: phone, Body: 'Je peux faire 600$ par mois', MessageSid: `SM-seam-2-${run}`,
    });
    expect(second.statusCode, second.body).toBe(204);
    expect(enqueued.turns).toHaveLength(1);
    expect(enqueued.extractions).toHaveLength(2);
    // F-62: a human holds it now — the message rides the silent-monitoring
    // pass so the panel keeps judging both sides.
    expect(enqueued.analyses).toHaveLength(1);
  });

  it('a reply to a DRIP gets an answer — reactivation enqueues the assistant (F-61)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const phone = '+15145557778';
    enqueued.turns.length = 0;

    const first = await webhook('/carrier/v1/sms/inbound', {
      To: storeNumber, From: phone, Body: 'Bonjour', MessageSid: `SM-drip-1-${run}`,
    });
    expect(first.statusCode, first.body).toBe(204);
    expect(enqueued.turns).toHaveLength(1);

    // The campaign thread: a drip went out, the customer answers it. A
    // re-engaged customer who hears nothing back was re-engaged for nothing.
    await admin.query(
      `UPDATE conversations SET status = 'drip_active' WHERE phone_e164 = $1`,
      [phone],
    );
    const reply = await webhook('/carrier/v1/sms/inbound', {
      To: storeNumber, From: phone, Body: 'Oui, toujours intéressé!', MessageSid: `SM-drip-2-${run}`,
    });
    expect(reply.statusCode, reply.body).toBe(204);
    expect(enqueued.turns).toHaveLength(2);
  });
});

describe('an unsigned or forged webhook', () => {
  it('is refused with no signature at all', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const from = '+15145551001';
    const res = await webhook(
      '/carrier/v1/sms/inbound',
      { To: storeNumber, From: from, Body: 'Bonjour', MessageSid: `SM-${run}-unsigned` },
      { sign: false },
    );
    expect(res.statusCode).toBe(403);
    // Nothing happened. Not a conversation, not a message, not a lead.
    expect(await messagesFor(from)).toHaveLength(0);
  });

  it('is refused with a forged signature', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const from = '+15145551002';
    const res = await webhook(
      '/carrier/v1/sms/inbound',
      { To: storeNumber, From: from, Body: 'Bonjour', MessageSid: `SM-${run}-forged` },
      { sign: 'bm90LWEtcmVhbC1zaWduYXR1cmU=' },
    );
    expect(res.statusCode).toBe(403);
    expect(await messagesFor(from)).toHaveLength(0);
  });

  it('is refused when a real signature is replayed with the body swapped', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // The attack that matters: lift a genuine signature from a genuine webhook
    // and change the message to STOP, revoking every consent for that number.
    const from = '+15145551003';
    const honest = { To: storeNumber, From: from, Body: 'Bonjour', MessageSid: `SM-${run}-swap` };
    const stolen = expectedSignature(TOKEN, `${ORIGIN}/carrier/v1/sms/inbound`, honest);

    const res = await webhook(
      '/carrier/v1/sms/inbound',
      { ...honest, Body: 'STOP' },
      { sign: stolen },
    );
    expect(res.statusCode).toBe(403);
    expect(await messagesFor(from)).toHaveLength(0);
    const sup = await admin.query(
      `SELECT 1 FROM suppression_list WHERE organization_id = $1 AND phone_e164 = $2`,
      [orgId, from],
    );
    expect(sup.rows).toHaveLength(0);
  });

  it('refuses an unknown number the same way it refuses a bad signature', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Correctly signed, but for a number no store owns. The response must not
    // tell a scanner which numbers are real.
    const res = await webhook('/carrier/v1/sms/inbound', {
      To: '+15145559999', From: '+15145551004', Body: 'Bonjour', MessageSid: `SM-${run}-unknown`,
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toMatchObject({ error: { code: 'forbidden' } });
  });
});

describe('a genuine inbound message', () => {
  it('creates the conversation and records what they said', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const from = '+15145551010';
    const res = await webhook('/carrier/v1/sms/inbound', {
      To: storeNumber, From: from,
      Body: 'Bonjour, est-ce que le Sorento est encore disponible?',
      MessageSid: `SM-${run}-real`,
    });
    expect(res.statusCode).toBe(204);

    const msgs = await messagesFor(from);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ direction: 'inbound' });

    const conv = await admin.query<{ organization_id: string; store_id: string; status: string }>(
      `SELECT organization_id, store_id, status FROM conversations WHERE phone_e164 = $1`, [from],
    );
    // Routed to the right dealership AND the right rooftop, from the number
    // alone — that is what carrier_resolve_number is for.
    expect(conv.rows[0]).toMatchObject({ organization_id: orgId, store_id: storeId });
  });

  it('applies a STOP in the same transaction, before answering', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const from = '+15145551011';
    await app!.inject({
      method: 'POST', url: '/api/v1/consent', headers: { cookie },
      payload: {
        organization_id: orgId, phone_e164: from,
        channels: ['sms'], scopes: ['conversational'],
        consent_type: 'express', source: 'staff_manual',
        evidence: { note: 'seeded for the carrier test' },
      },
    });

    const res = await webhook('/carrier/v1/sms/inbound', {
      To: storeNumber, From: from, Body: 'STOP', MessageSid: `SM-${run}-stop`,
    });
    expect(res.statusCode).toBe(204);

    // By the time the carrier had its answer, all five effects were committed.
    const sup = await admin.query(
      `SELECT 1 FROM suppression_list WHERE organization_id = $1 AND phone_e164 = $2 AND cleared_at IS NULL`,
      [orgId, from],
    );
    expect(sup.rows).toHaveLength(1);
    const live = await admin.query(
      `SELECT 1 FROM consent_ledger WHERE organization_id = $1 AND phone_e164 = $2 AND revoked_at IS NULL`,
      [orgId, from],
    );
    expect(live.rows).toHaveLength(0);
    // And the STOP itself is in the thread — the text that withdrew consent is
    // the evidence it was withdrawn.
    expect(await messagesFor(from)).toHaveLength(1);
  });

  it('does not become two messages when the carrier retries', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const from = '+15145551012';
    const params = {
      To: storeNumber, From: from, Body: 'Rebonjour', MessageSid: `SM-${run}-retry`,
    };
    // Carriers retry on any non-2xx and on a timeout. Delivered twice is the
    // normal case, not the exception.
    expect((await webhook('/carrier/v1/sms/inbound', params)).statusCode).toBe(204);
    expect((await webhook('/carrier/v1/sms/inbound', params)).statusCode).toBe(204);
    expect((await webhook('/carrier/v1/sms/inbound', params)).statusCode).toBe(204);

    expect(await messagesFor(from)).toHaveLength(1);
  });

  it('rejects a request missing the fields it needs', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await webhook('/carrier/v1/sms/inbound', { To: storeNumber, Body: 'no from, no sid' });
    expect(res.statusCode).toBe(400);
  });
});

describe('a delivery receipt', () => {
  it('marks a message delivered and records its segments', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const from = '+15145551020';
    const sid = `SM-${run}-receipt`;
    await webhook('/carrier/v1/sms/inbound', {
      To: storeNumber, From: from, Body: 'Bonjour', MessageSid: sid,
    });

    const res = await webhook('/carrier/v1/sms/status', {
      MessageSid: sid, MessageStatus: 'delivered', To: from, From: storeNumber, NumSegments: '2',
    });
    expect(res.statusCode).toBe(204);

    const m = await admin.query<{ delivered: boolean; delivered_at: Date | null; segments: number }>(
      `SELECT delivered, delivered_at, segments FROM messages WHERE provider_ref = $1`, [sid],
    );
    expect(m.rows[0]).toMatchObject({ delivered: true, segments: 2 });
    expect(m.rows[0]!.delivered_at).toBeInstanceOf(Date);
  });

  it('does not call a message delivered merely because it was sent', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const from = '+15145551021';
    const sid = `SM-${run}-sent-only`;
    await webhook('/carrier/v1/sms/inbound', {
      To: storeNumber, From: from, Body: 'Bonjour', MessageSid: sid,
    });

    // `sent` means the carrier accepted it, not that a handset received it.
    // Treating them the same lets the console claim a customer got something
    // that later bounced.
    await webhook('/carrier/v1/sms/status', {
      MessageSid: sid, MessageStatus: 'sent', To: from, From: storeNumber,
    });
    const m = await admin.query<{ delivered: boolean }>(
      `SELECT delivered FROM messages WHERE provider_ref = $1`, [sid],
    );
    expect(m.rows[0]!.delivered).toBe(false);
  });

  it('refuses an unsigned receipt', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await webhook(
      '/carrier/v1/sms/status',
      { MessageSid: 'SM-nope', MessageStatus: 'delivered', To: '+15145551022', From: storeNumber },
      { sign: false },
    );
    expect(res.statusCode).toBe(403);
  });
});

describe('the number itself', () => {
  type Detail = { path?: string; code: string; message: string };
  const details = (body: string): Detail[] =>
    (JSON.parse(body) as { error: { details?: Detail[] } }).error.details ?? [];

  it('cannot be claimed by two stores — a 409 ON THE FIELD, naming no store', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const second = await app!.inject({
      method: 'POST', url: '/api/v1/stores', headers: { cookie },
      payload: { organization_id: orgId, name: 'Second lot', code: `F30B-${run.slice(-4)}`, province: 'QC' },
    });
    const secondId = (JSON.parse(second.body) as { id: string }).id;

    // One number, one store, platform-wide. Two stores sharing it would make
    // an inbound message unroutable — and the wrong resolution would deliver a
    // customer's reply to a rival.
    const res = await app!.inject({
      method: 'PATCH', url: `/api/v1/stores/${secondId}`, headers: { cookie },
      payload: { sms_number: storeNumber },
    });
    // Before F-76 this asserted `>= 400` and the 409 carried no path — the
    // store form could not put the error under the number field.
    expect(res.statusCode, res.body).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('conflict');
    expect(details(res.body)[0]).toMatchObject({ path: 'sms_number', code: 'unique_violation' });
    // conflictFrom sees only the constraint name: the body never says WHO
    // holds the number, because the holder may be another tenant's rooftop.
    expect(res.body).not.toContain('Rooftop');
  });

  it('nor by a store in ANOTHER organization — the index is platform-wide, and the body still names nobody', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const su = await app!.inject({
      method: 'POST', url: '/api/auth/sign-up/email',
      payload: { email: `f30-rival-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Rémi' },
    });
    const sc = su.headers['set-cookie'];
    const rival = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');
    const org = await app!.inject({
      method: 'POST', url: '/api/v1/organizations', headers: { cookie: rival },
      payload: { name: 'Groupe Rival', slug: `groupe-f30-rival-${run}` },
    });
    expect(org.statusCode, org.body).toBe(201);
    const rivalOrgId = (JSON.parse(org.body) as { id: string }).id;
    const store = await app!.inject({
      method: 'POST', url: '/api/v1/stores', headers: { cookie: rival },
      payload: { organization_id: rivalOrgId, name: 'Rival lot', code: `F30R-${run.slice(-4)}`, province: 'QC' },
    });
    expect(store.statusCode, store.body).toBe(201);
    const rivalStoreId = (JSON.parse(store.body) as { id: string }).id;

    const taken = await app!.inject({
      method: 'PATCH', url: `/api/v1/stores/${rivalStoreId}`, headers: { cookie: rival },
      payload: { sms_number: storeNumber },
    });
    expect(taken.statusCode, taken.body).toBe(409);
    expect(details(taken.body)[0]).toMatchObject({ path: 'sms_number', code: 'unique_violation' });
    expect(taken.body).not.toContain('Rooftop');
    expect(taken.body).not.toContain('Groupe F30');

    // The remedy is the holder's: once the first store lets the number go,
    // the other store may take it. (Last case in the file: the shared
    // fixture's number is gone after this.)
    const cleared = await app!.inject({
      method: 'PATCH', url: `/api/v1/stores/${storeId}`, headers: { cookie },
      payload: { sms_number: null },
    });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect((JSON.parse(cleared.body) as { sms_number: string | null }).sms_number).toBeNull();

    const claimed = await app!.inject({
      method: 'PATCH', url: `/api/v1/stores/${rivalStoreId}`, headers: { cookie: rival },
      payload: { sms_number: storeNumber },
    });
    expect(claimed.statusCode, claimed.body).toBe(200);
    expect((JSON.parse(claimed.body) as { sms_number: string }).sms_number).toBe(storeNumber);
  });
});
