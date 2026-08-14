import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, withTenant, type Pool,
} from '@dealpilot/db';
import { MAX_DEFERRALS, type DeferredSendJobT } from '@dealpilot/contracts';
import { buildApp } from '@dealpilot/api/app';
import { createCarrier } from '@dealpilot/api/carrier';
import { loadEnv } from '@dealpilot/api/env';
import { runDeferredSend, type DeferredSendDeps } from './deferred-send.js';

/**
 * The message the gate said to send later (F-32).
 *
 * Until this job existed, "later" meant never. `send_decisions.deferred_until`
 * was written by the send layer and read by nothing, so a follow-up composed at
 * 22:40 for a customer whose quiet hours start at 21:00 was recorded as
 * deferred and silently dropped. These cases are the difference between a
 * promise recorded and a promise kept.
 *
 * The second describe block is the one that matters most: waking up and sending
 * the stored text would be a send path with no compliance gate in it.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations',
);
const run = Date.now().toString(36);

/** 14:00 in Montreal — inside every default window. */
const MIDDAY = new Date('2026-08-13T18:00:00Z');
/** 03:00 in Montreal — outside it. */
const NIGHT = new Date('2026-08-13T07:00:00Z');

let admin: Pool;
let appPool: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookie = '';
let orgId = '';
let storeId = '';

let phoneSeq = 700;
function nextPhone(): string {
  phoneSeq += 1;
  return `+1514555${String(phoneSeq).padStart(4, '0')}`;
}

/** Deps with a recording rescheduler, so a re-deferral is observable. */
function deps(now: Date): DeferredSendDeps & { rescheduled: { job: DeferredSendJobT; runAt: Date }[] } {
  const rescheduled: { job: DeferredSendJobT; runAt: Date }[] = [];
  return {
    rescheduled,
    pool: appPool,
    carrier: createCarrier(loadEnv({}), { info: () => {}, warn: () => {} }),
    env: loadEnv({}),
    now: () => now,
    reschedule: async (job, runAt) => {
      rescheduled.push({ job, runAt });
    },
  };
}

async function fixture(opts: { consent?: boolean } = {}) {
  const phone = nextPhone();
  if (opts.consent !== false) {
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/consent', headers: { cookie },
      payload: {
        organization_id: orgId, phone_e164: phone,
        channels: ['sms'], scopes: ['conversational'],
        consent_type: 'express', source: 'staff_manual',
        evidence: { note: 'seeded for the deferred-send test' },
      },
    });
    expect(res.statusCode, res.body).toBe(201);
  }
  const conversationId = await withTenant(appPool, orgId, async (c) => {
    const r = await c.query<{ id: string }>(
      `INSERT INTO conversations (organization_id, store_id, phone_e164) VALUES ($1,$2,$3) RETURNING id`,
      [orgId, storeId, phone],
    );
    return r.rows[0]!.id;
  });
  return { phone, conversationId };
}

function job(conversationId: string, over: Partial<DeferredSendJobT> = {}): DeferredSendJobT {
  return {
    organization_id: orgId,
    conversation_id: conversationId,
    send_decision_id: '00000000-0000-4000-8000-000000000001',
    body: 'Bonjour, je fais un suivi sur votre demande.',
    sender_type: 'bot',
    message_class: 'follow_up',
    attempt: 0,
    ...over,
  };
}

async function messageCount(conversationId: string): Promise<number> {
  const r = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM messages WHERE conversation_id = $1`, [conversationId],
  );
  return Number(r.rows[0]!.n);
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
  appPool = createPool({ connectionString: APP_URL, max: 4 });
  ({ app } = await buildApp({ DATABASE_URL: APP_URL, NODE_ENV: 'test' }));

  const su = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f32-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Sophie' },
  });
  const sc = su.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');

  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe F32', slug: `groupe-f32-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;

  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Rooftop', code: `F32-${run.slice(-4)}`, province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;
});

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await admin?.end();
});

describe('the window has opened', () => {
  it('sends the message the gate said to wait on', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();

    const result = await runDeferredSend(deps(MIDDAY), job(f.conversationId));
    expect(result.kind).toBe('sent');
    // The whole point of the slice: before it, this was 0 forever.
    expect(await messageCount(f.conversationId)).toBe(1);
  });

  it('records the send like any other, with a consent id', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    await runDeferredSend(deps(MIDDAY), job(f.conversationId));

    const m = await admin.query<{ consent_ledger_id: string | null; sender_type: string }>(
      `SELECT consent_ledger_id, sender_type FROM messages WHERE conversation_id = $1`,
      [f.conversationId],
    );
    // A deferred send is not a special case. It goes through `sendMessage`, so
    // it carries the basis it relied on exactly like a live one.
    expect(m.rows[0]!.consent_ledger_id).not.toBeNull();
    expect(m.rows[0]!.sender_type).toBe('bot');
  });
});

describe('what changed while it slept', () => {
  it('does NOT send to somebody who texted STOP in the meantime', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    // The message is composed and deferred. Then, at 23:10, they opt out.
    const stop = await app!.inject({
      method: 'POST', url: '/api/v1/suppressions', headers: { cookie },
      payload: {
        organization_id: orgId, phone_e164: f.phone, channel: 'sms',
        source: 'staff_manual', note: 'texted STOP overnight',
      },
    });
    // Asserted, because a setup step that silently 422s turns this into a test
    // that proves the gate works on a customer who never opted out.
    expect(stop.statusCode, stop.body).toBe(201);

    const result = await runDeferredSend(deps(MIDDAY), job(f.conversationId));
    // This is why the gate's remedy says "re-run the whole gate on wake" and
    // not "send it later". A worker that replayed the stored text would text
    // somebody who opted out, at 09:00, from a queue nobody was watching.
    expect(result).toMatchObject({ kind: 'blocked', reason: 'suppressed' });
    expect(await messageCount(f.conversationId)).toBe(0);
  });

  it('does NOT send when consent was never there', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture({ consent: false });
    const result = await runDeferredSend(deps(MIDDAY), job(f.conversationId));
    expect(result).toMatchObject({ kind: 'blocked', reason: 'consent_absent' });
    expect(await messageCount(f.conversationId)).toBe(0);
  });

  it('abandons a conversation somebody closed', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    await admin.query(
      `UPDATE conversations SET status = 'closed', closed_at = now() WHERE id = $1`,
      [f.conversationId],
    );

    const result = await runDeferredSend(deps(MIDDAY), job(f.conversationId));
    // A closed thread is one a person decided was finished. Waking up to add
    // to it would be the system arguing with them.
    expect(result).toMatchObject({ kind: 'abandoned' });
    expect(await messageCount(f.conversationId)).toBe(0);
  });

  it('abandons a conversation that no longer exists', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const result = await runDeferredSend(
      deps(MIDDAY),
      job('11111111-1111-4111-8111-111111111111'),
    );
    expect(result).toMatchObject({ kind: 'abandoned' });
  });
});

describe('still outside the window', () => {
  it('puts itself back to sleep rather than sending at 3am', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    const d = deps(NIGHT);

    const result = await runDeferredSend(d, job(f.conversationId));
    expect(result).toMatchObject({ kind: 'deferred_again', attempt: 1 });
    expect(await messageCount(f.conversationId)).toBe(0);

    // Rescheduled for the moment the window actually opens, with the attempt
    // carried forward so it cannot loop forever.
    expect(d.rescheduled).toHaveLength(1);
    expect(d.rescheduled[0]!.job.attempt).toBe(1);
    expect(d.rescheduled[0]!.runAt.getTime()).toBeGreaterThan(NIGHT.getTime());
  });

  it('gives up after too many deferrals instead of looping', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    const d = deps(NIGHT);

    const result = await runDeferredSend(d, job(f.conversationId, { attempt: MAX_DEFERRALS - 1 }));
    // Deferring forever is how a message goes out at a random hour on the
    // tenth attempt. Stopping is the honest outcome; the decision rows are on
    // file for whoever asks why.
    expect(result).toMatchObject({ kind: 'abandoned' });
    expect(d.rescheduled).toHaveLength(0);
    expect(await messageCount(f.conversationId)).toBe(0);
  });
});

describe('the payload itself', () => {
  it('refuses a job it cannot parse', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // A deploy can land between enqueue and consume, so the worker is always
    // reading something an older version of the code wrote.
    await expect(runDeferredSend(deps(MIDDAY), { organization_id: 'not-a-uuid' }))
      .rejects.toThrow();
    await expect(runDeferredSend(deps(MIDDAY), null)).rejects.toThrow();
  });
});
