import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, withTenant, type Pool } from '@dealpilot/db';
import { AdminTenantDetail, AdminTenantUsage, PlanList, type AdminTenantUsageT } from '@dealpilot/schemas';
import { countSegments } from '@dealpilot/core';
import { safeFirstTouchMessage } from '@dealpilot/ai';
import { buildApp } from './app.js';
import type { Carrier, OutboundSms } from './carrier.js';
import type { EmailMessage } from './email.js';
import { loadEnv } from './env.js';
import { deliverMessage } from './f30-deliver.js';
import { findOrCreateConversation } from './f23-inbound-router.js';
import { sendMessage } from './f19-send.js';
import type { StorageDriver, StoredObject } from './storage.js';
import { enrol, signInWithTotp } from './testing/totp.js';

/**
 * F-73 §6 — the per-tenant usage card, as the console reads it.
 *
 * What is worth proving is not that the numbers are non-zero. It is that every
 * number on the card is an answer about ROWS THAT EXIST, produced by the same
 * routes a dealership uses, and that the card never hands a reader two numbers
 * with which to draw a false conclusion:
 *
 *  - a seat and a membership are different facts, and both ship, named apart;
 *  - a lead deleted in September was still ingested in August;
 *  - what a tenant BOUGHT is only shown against the month it was bought for;
 *  - nothing on this card enforces anything, and the send path proves it.
 *
 * Every counting case provisions its OWN tenant. A shared fixture would let an
 * earlier case's rows make a later assertion pass for the wrong reason, which
 * is how this repo has shipped a no-op feature before.
 */

const here = dirname(fileURLToPath(import.meta.url));
const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(here, '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';
const REASON = 'Ticket SUP-7301: the usage card shows nothing for this dealership';

let admin: Pool;
let appPool: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;

let superCookie = '';
let superId = '';
let supportCookie = '';
let billingCookie = '';
let corePlan = '';
let phoneSeq = 0;

const sent: EmailMessage[] = [];

/** In-memory driver: the document routes are the subject, not the filesystem. */
const storage: StorageDriver = {
  kind: 'local',
  async put(key: string, body: Buffer): Promise<StoredObject> {
    return { key, sha256: randomUUID().replace(/-/g, '').repeat(2).slice(0, 64), bytes: body.byteLength };
  },
  async get(): Promise<Buffer> {
    throw new Error('not read in this suite');
  },
};

/**
 * A carrier that accepts, except for bodies named in `refuse`.
 *
 * A refused send still leaves a `messages` row — `deliverMessage` writes
 * `carrier_error` and never `segments` — which is exactly how a real message
 * ends up with no segment count, and the only honest way to produce one.
 */
const refuse = new Set<string>();
const carrier: Carrier = {
  kind: 'log',
  deliversToRecipient: false,
  async send(m: OutboundSms) {
    if (refuse.has(m.body)) {
      return { kind: 'rejected' as const, code: '21610', message: 'the carrier refused', retryable: false };
    }
    return { kind: 'accepted' as const, providerRef: `SM-${randomUUID()}`, segments: countSegments(m.body).segments };
  },
  verifyInbound: () => true,
};

const env = loadEnv({ DATABASE_URL: APP_URL, NODE_ENV: 'test' });

function cookiesOf(res: { headers: Record<string, unknown> }): string {
  const sc = res.headers['set-cookie'];
  const list = Array.isArray(sc) ? sc : sc ? [String(sc)] : [];
  return list.map((c) => String(c).split(';')[0] ?? '').filter((c) => c !== '' && !c.endsWith('=')).join('; ');
}

async function signUp(email: string, name: string): Promise<string> {
  const res = await app!.inject({ method: 'POST', url: '/api/auth/sign-up/email', payload: { email, password: PASSWORD, name } });
  expect(res.statusCode, res.body).toBe(200);
  return cookiesOf(res);
}

async function userId(email: string): Promise<string> {
  return (await admin.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [email])).rows[0]!.id;
}

async function staffer(email: string, name: string, role: string, actor: string | null): Promise<string> {
  const first = await signUp(email, name);
  await admin.query('SELECT * FROM platform_staff_grant($1, $2, $3, $4)', [actor, email, role, 'test fixture']);
  const { secret } = await enrol(app!, first, PASSWORD);
  return signInWithTotp(app!, email, PASSWORD, secret);
}

interface Tenant { orgId: string; storeId: string; cookie: string; ownerId: string; ownerEmail: string }

/** A self-serve dealership with one rooftop — the F-01 birth, through the real routes. */
async function tenant(tag: string): Promise<Tenant> {
  const email = `f73-${tag}-${run}@dealpilot.test`;
  const cookie = await signUp(email, `Patronne ${tag}`);
  const o = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: `Groupe ${tag}`, slug: `groupe-${tag}-${run}` },
  });
  expect(o.statusCode, o.body).toBe(201);
  const orgId = (JSON.parse(o.body) as { id: string }).id;
  const storeId = await store(cookie, orgId, `${tag}-1`);
  return { orgId, storeId, cookie, ownerId: await userId(email), ownerEmail: email };
}

async function store(cookie: string, orgId: string, code: string): Promise<string> {
  const s = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: `Point de vente ${code}`, code: code.toUpperCase().slice(0, 20), province: 'QC' },
  });
  expect(s.statusCode, s.body).toBe(201);
  return (JSON.parse(s.body) as { id: string }).id;
}

async function usageRes(orgId: string, period?: string, cookie = superCookie) {
  return app!.inject({
    method: 'GET',
    url: `/api/v1/admin/tenants/${orgId}/usage${period ? `?period=${period}` : ''}`,
    headers: { cookie },
  });
}

async function usage(orgId: string, period?: string, cookie = superCookie): Promise<AdminTenantUsageT> {
  const res = await usageRes(orgId, period, cookie);
  expect(res.statusCode, res.body).toBe(200);
  return AdminTenantUsage.parse(JSON.parse(res.body));
}

async function lead(t: Tenant, over: Record<string, unknown> = {}): Promise<string> {
  phoneSeq += 1;
  const res = await app!.inject({
    method: 'POST', url: '/api/v1/leads', headers: { cookie: t.cookie },
    payload: {
      organization_id: t.orgId, store_id: t.storeId,
      first_name: 'Prospect', phone: `+1514555${String(1000 + phoneSeq).slice(-4)}`,
      source: 'manual', ...over,
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (JSON.parse(res.body) as { id: string }).id;
}

async function deal(t: Tenant, over: Record<string, unknown> = {}): Promise<string> {
  const res = await app!.inject({
    method: 'POST', url: '/api/v1/deals', headers: { cookie: t.cookie },
    payload: {
      organization_id: t.orgId, store_id: t.storeId, province: 'QC', deal_type: 'finance',
      sale_price_cents: 3_000_000, vehicle_cost_cents: 2_700_000,
      interest_rate_bps: 599, term_months: 60, ...over,
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (JSON.parse(res.body) as { id: string }).id;
}

/** Delivery is EARNED (F-08): the file has to be complete before the car moves. */
async function deliver(t: Tenant, dealId: string): Promise<void> {
  const checklist = await app!.inject({
    method: 'GET', url: `/api/v1/deals/${dealId}/checklist`, headers: { cookie: t.cookie },
  });
  expect(checklist.statusCode, checklist.body).toBe(200);
  for (const code of (JSON.parse(checklist.body) as { readiness: { outstanding: string[] } }).readiness.outstanding) {
    const tick = await app!.inject({
      method: 'PATCH', url: `/api/v1/deals/${dealId}/checklist/${code}`, headers: { cookie: t.cookie },
      payload: { completed: true },
    });
    expect(tick.statusCode, tick.body).toBe(200);
  }
  const moved = await app!.inject({
    method: 'PATCH', url: `/api/v1/deals/${dealId}`, headers: { cookie: t.cookie },
    payload: { pipeline_stage: 'delivered' },
  });
  expect(moved.statusCode, moved.body).toBe(200);
}

/** A number this dealership may text, and a live thread on it. */
async function thread(t: Tenant): Promise<{ phone: string; conversationId: string }> {
  phoneSeq += 1;
  const phone = `+1514555${String(2000 + phoneSeq).slice(-4)}`;
  const consent = await app!.inject({
    method: 'POST', url: '/api/v1/consent', headers: { cookie: t.cookie },
    payload: {
      organization_id: t.orgId, phone_e164: phone,
      channels: ['sms'], scopes: ['conversational'],
      consent_type: 'express', source: 'staff_manual',
      evidence: { note: 'seeded for the usage suite' },
    },
  });
  expect(consent.statusCode, consent.body).toBe(201);
  const conversationId = await withTenant(appPool, t.orgId, async (c) => {
    const r = await c.query<{ id: string }>(
      `INSERT INTO conversations (organization_id, store_id, phone_e164) VALUES ($1,$2,$3) RETURNING id`,
      [t.orgId, t.storeId, phone],
    );
    return r.rows[0]!.id;
  });
  return { phone, conversationId };
}

/**
 * One outbound message from the assistant, through the product's own send
 * chokepoint and its own delivery step — the path `assistant-turn.ts` takes.
 */
async function botSays(t: Tenant, th: { phone: string; conversationId: string }, body: string): Promise<void> {
  const outcome = await withTenant(appPool, t.orgId, async (c) =>
    sendMessage(c, {
      organizationId: t.orgId, storeId: t.storeId, conversationId: th.conversationId, leadId: null,
      phoneE164: th.phone, body, senderType: 'bot', messageClass: 'inbound_reply',
      scope: 'conversational', isSolicitation: false, nowUtc: new Date(),
    }),
  );
  expect(outcome.kind, JSON.stringify(outcome)).toBe('sent');
  if (outcome.kind !== 'sent') return;
  await deliverMessage(appPool, carrier, env, {
    organizationId: t.orgId, messageId: outcome.messageId,
    to: th.phone, from: '+15145550000', body,
  });
}

/* -- the first touch, as its producer writes it ------------------------- */

/**
 * `ai_first_touch_p95_seconds` is the one §6 number whose SQL is not a count,
 * and the only way to prove it is to make a real greeting happen. This suite
 * cannot call `runFirstTouch`: `apps/workers` already depends on
 * `@dealpilot/api` (apps/workers/package.json), so the reverse edge would make
 * turbo's `build → ^build` graph cyclic, and a relative import into
 * `apps/workers/src` fails `tsc -p apps/api/tsconfig.json` with TS6059
 * (`rootDir` is `src`). So `greet()` walks first-touch.ts's own three steps
 * through the same functions it calls — `findOrCreateConversation`,
 * `sendMessage`, `deliverMessage` — in the same ORDER, and the two UPDATEs
 * below are copied from the producer verbatim.
 *
 * The ORDER is the whole point:
 *
 *   1. `now` is captured in JS BEFORE anything is staged   (first-touch.ts:246)
 *   2. the message row takes `DEFAULT now()` at INSERT — LATER      (0031:89)
 *   3. only after the carrier accepts is `chatbot_engaged_at` stamped with
 *      that EARLIER value                                (first-touch.ts:420-429)
 *
 * So `messages.created_at` is strictly NEWER than `chatbot_engaged_at` on
 * every normal greeting. That is why 0069's EXISTS must never carry an
 * `AND m.created_at <= l.chatbot_engaged_at` conjunct — it would empty the
 * sample for exactly the tenants whose first touch works — and why a fixture
 * that stamped AFTER the send would confirm that bug instead of catching it.
 *
 * `the greeting fixture is still the producer's` (below) is what keeps the two
 * statements from drifting out from under this file.
 */
const FIRST_TOUCH_STAMP_SQL = `UPDATE leads
       SET chatbot_engaged_at = COALESCE(chatbot_engaged_at, $2),
           status = CASE WHEN status = 'new' THEN 'chatbot_engaged' ELSE status END
       WHERE id = $1`;

/**
 * The stamp on the two DEVIANT paths, both inside `stageDuplicateConfirm`:
 * the 24-hour person-level dedupe (first-touch.ts:165-171), which sends
 * nothing at all, and the duplicate-as-signal path (:238-243), which texts the
 * KEEPER's thread and stamps THIS record. Neither is a first touch for the
 * lead it stamps, and `c.lead_id = l.id` is what keeps both out of the sample.
 */
const DEDUPE_STAMP_SQL = `UPDATE leads SET chatbot_engaged_at = COALESCE(chatbot_engaged_at, $2) WHERE id = $1`;

/** The rooftop's own carrier number — the greeting has no `from` without one. */
async function smsNumber(t: Tenant): Promise<string> {
  phoneSeq += 1;
  const number = `+1819555${String(1000 + phoneSeq).slice(-4)}`;
  const patched = await app!.inject({
    method: 'PATCH', url: `/api/v1/stores/${t.storeId}`, headers: { cookie: t.cookie },
    payload: { sms_number: number },
  });
  expect(patched.statusCode, patched.body).toBe(200);
  return number;
}

/**
 * A lead through the real route, whose phone the caller needs as well.
 *
 * `walk_in`, not `manual`: the greeting has to pass the same compliance gate as
 * every other send, and D-042 #1 grants the conversational basis only for a
 * source the customer initiated themselves (`SELF_INITIATED_SOURCES`). A
 * fixture that reached around the gate would be proving the p95 over messages
 * the product would have refused to send.
 */
async function leadOn(t: Tenant, over: Record<string, unknown> = {}): Promise<{ id: string; phone: string }> {
  phoneSeq += 1;
  const phone = `+1514555${String(7000 + phoneSeq).slice(-4)}`;
  return { id: await lead(t, { source: 'walk_in', phone, ...over }), phone };
}

/**
 * How long the staging step is made to take.
 *
 * `messages.created_at` defaults to `now()`, which in Postgres is TRANSACTION
 * start — so the gap this fixture must reproduce is the time between the
 * producer reading its JS clock and the staging transaction opening. In
 * production that gap holds a `tenantOperational` round trip, a conversation
 * lookup, the template, the whole compliance gate and the INSERT itself. Here
 * it would otherwise be a fraction of a millisecond, and this machine's
 * Postgres clock measured 2–3 ms BEHIND the test process's — enough to invert
 * the ordering and let a re-added `m.created_at <= l.chatbot_engaged_at`
 * conjunct pass unnoticed on a fast connection. A quarter-second of real
 * elapsed staging is both a truer model of the producer and larger than any
 * skew a developer machine is likely to carry.
 */
const STAGING_MS = 250;

async function greet(t: Tenant, leadId: string, phone: string, from: string): Promise<string> {
  // 1. STAGE — and `now` is read before it, exactly as the producer does.
  const now = new Date();
  await new Promise<void>((resolve) => { setTimeout(resolve, STAGING_MS); });
  const staged = await withTenant(appPool, t.orgId, async (c) => {
    const conversation = await findOrCreateConversation(
      c,
      { organizationId: t.orgId, storeId: t.storeId, phoneE164: phone, body: '', providerRef: `first-touch:${leadId}` },
      { language: 'fr' },
    );
    const body = safeFirstTouchMessage({
      firstName: 'Prospect', personaName: 'Alex', dealership: 'Point de vente',
      vehicleInterest: null, language: 'fr', isDuplicate: false,
    });
    const send = await sendMessage(c, {
      organizationId: t.orgId, storeId: t.storeId, conversationId: conversation.id, leadId,
      phoneE164: phone, body, senderType: 'bot', messageClass: 'first_touch',
      scope: 'conversational', isSolicitation: false, nowUtc: now,
    });
    return { body, send };
  });
  expect(staged.send.kind, JSON.stringify(staged.send)).toBe('sent');
  if (staged.send.kind !== 'sent') throw new Error('the greeting was not sent');
  // 2. DELIVER, then 3. STAMP with the timestamp captured in step 1.
  await deliverMessage(appPool, carrier, env, {
    organizationId: t.orgId, messageId: staged.send.messageId, to: phone, from, body: staged.body,
  });
  await withTenant(appPool, t.orgId, (c) => c.query(FIRST_TOUCH_STAMP_SQL, [leadId, now]));
  return staged.send.messageId;
}

/** The two timestamps whose ORDER the sample depends on, as the rows hold them. */
async function stampOrdering(t: Tenant, messageId: string, leadId: string): Promise<{ sent: number; stamped: number }> {
  return withTenant(appPool, t.orgId, async (c) => {
    const r = await c.query<{ created_at: Date; engaged: Date | null }>(
      `SELECT m.created_at, l.chatbot_engaged_at AS engaged
       FROM messages m, leads l WHERE m.id = $1 AND l.id = $2`,
      [messageId, leadId],
    );
    const row = r.rows[0]!;
    expect(row.engaged, 'the greeted lead is stamped').not.toBeNull();
    return { sent: new Date(row.created_at).getTime(), stamped: new Date(row.engaged!).getTime() };
  });
}

/**
 * Noon-ish Eastern, always in the future: 're_engagement' rides quiet hours
 * (correctly), so a 3 a.m. CI run must not turn this send into a deferral.
 * The F-59 suite carries the same guard for the same reason.
 */
function safeNow(): Date {
  const t = new Date();
  t.setUTCHours(17, 0, 0, 0);
  if (t.getTime() <= Date.now()) t.setUTCDate(t.getUTCDate() + 1);
  return t;
}

/** The duplicate-as-signal confirmation: sent to the KEEPER's live thread. */
async function confirmOnKeepersThread(t: Tenant, keeperId: string, phone: string, from: string): Promise<void> {
  const staged = await withTenant(appPool, t.orgId, async (c) => {
    // The thread the keeper already owns — `stageDuplicateConfirm` adopts this
    // one rather than minting a thread for the resubmitted record.
    const conv = await c.query<{ id: string; lead_id: string | null }>(
      `SELECT id, lead_id FROM conversations
       WHERE organization_id = $1 AND phone_e164 = $2 AND channel = 'sms'
         AND status <> 'closed' AND deleted_at IS NULL`,
      [t.orgId, phone],
    );
    expect(conv.rows[0]?.lead_id, 'the thread belongs to the keeper').toBe(keeperId);
    const body = safeFirstTouchMessage({
      firstName: 'Prospect', personaName: 'Alex', dealership: 'Point de vente',
      vehicleInterest: null, language: 'fr', isDuplicate: true,
    });
    const send = await sendMessage(c, {
      organizationId: t.orgId, storeId: t.storeId, conversationId: conv.rows[0]!.id, leadId: keeperId,
      phoneE164: phone, body, senderType: 'bot', messageClass: 're_engagement',
      scope: 'conversational', isSolicitation: false, nowUtc: safeNow(),
    });
    return { body, send };
  });
  expect(staged.send.kind, JSON.stringify(staged.send)).toBe('sent');
  if (staged.send.kind !== 'sent') return;
  await deliverMessage(appPool, carrier, env, {
    organizationId: t.orgId, messageId: staged.send.messageId, to: phone, from, body: staged.body,
  });
}

/** What the console says this lead's stamp is — through the tenant's own route. */
async function engagedAt(t: Tenant, leadId: string): Promise<string | null> {
  const res = await app!.inject({ method: 'GET', url: `/api/v1/leads/${leadId}`, headers: { cookie: t.cookie } });
  expect(res.statusCode, res.body).toBe(200);
  return (JSON.parse(res.body) as { chatbot_engaged_at: string | null }).chatbot_engaged_at;
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
  ({ app } = await buildApp(
    { DATABASE_URL: APP_URL, NODE_ENV: 'test' },
    {
      rateLimiter: { take: async () => ({ allowed: true, retryAfterS: 0 }), close: async () => {} },
      mailer: { deliversToRecipient: true, async send(m) { sent.push(m); return true; } },
      storage,
      carrier,
    },
  ));

  const superEmail = `f73-super-${run}@dealpilot.test`;
  superCookie = await staffer(superEmail, 'Super Admin', 'platform_super_admin', null);
  superId = await userId(superEmail);
  supportCookie = await staffer(`f73-support-${run}@dealpilot.test`, 'Soutien', 'platform_support', superId);
  billingCookie = await staffer(`f73-billing-${run}@dealpilot.test`, 'Facturation', 'platform_billing', superId);

  const plans = PlanList.parse(JSON.parse((await app!.inject({
    method: 'GET', url: '/api/v1/admin/plans', headers: { cookie: superCookie },
  })).body));
  corePlan = plans.items.find((p) => p.code === 'core')!.id;
});

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await admin?.end();
});

describe('the window a number belongs to (§6)', () => {
  it('mtd starts at the Montreal month boundary and ends now; 30d and 90d are that many days back', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('window');

    const mtd = await usage(t.orgId, 'mtd');
    // Read back in the platform's operating timezone rather than recomputed
    // with the definer's own expression: repeating the SQL would prove nothing.
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Montreal', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).formatToParts(new Date(mtd.window_start)).map((p) => [p.type, p.value]),
    );
    expect(parts['day'], 'mtd must start on the first of the Montreal month').toBe('01');
    expect(`${parts['hour']}:${parts['minute']}:${parts['second']}`).toBe('00:00:00');
    const nowMontreal = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Montreal', year: 'numeric', month: '2-digit',
    }).formatToParts(new Date()).reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
    expect(`${parts['year']}-${parts['month']}`).toBe(`${nowMontreal['year']}-${nowMontreal['month']}`);
    expect(Math.abs(Date.now() - new Date(mtd.window_end).getTime()), 'window_end is now').toBeLessThan(10_000);

    for (const [period, days] of [['30d', 30], ['90d', 90]] as const) {
      const u = await usage(t.orgId, period);
      expect(u.period).toBe(period);
      const span = new Date(u.window_end).getTime() - new Date(u.window_start).getTime();
      expect(Math.abs(span - days * 86_400_000)).toBeLessThan(2_000);
    }
  });

  it('an unknown period is refused before the database is asked', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('badperiod');
    const res = await usageRes(t.orgId, 'yesterday');
    expect(res.statusCode, res.body).toBe(422);
    expect(JSON.parse(res.body)).toMatchObject({ error: { code: 'validation_failed', details: [{ path: 'period' }] } });
    // The proof that the definer was not reached: its own belt for an unknown
    // period is PA014, which platformErrorFrom deliberately does not map, so a
    // call that got that far would have surfaced as a 500 and not as this.
    await expect(
      admin.query('SELECT * FROM admin_tenant_usage($1::uuid, $2::uuid, $3::text)', [superId, t.orgId, 'yesterday']),
    ).rejects.toMatchObject({ code: 'PA014' });
  });
});

describe('every number is an answer about rows that exist (§6)', () => {
  it('a fresh tenant is all zeros, and each row created through a real route moves exactly its own metric', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('counts');

    const before = await usage(t.orgId);
    expect(before.window_metrics).toMatchObject({
      leads_created: 0, deals_created: 0, deals_delivered: 0,
      ai_conversations_engaged: 0, sms_segments: 0, sms_messages_unsegmented: 0,
      ai_first_touch_sample_count: 0, ai_first_touch_p95_seconds: null,
    });
    expect(before.gauges).toMatchObject({ seats_provisioned: 1, member_count: 1, store_count: 1, document_bytes: 0 });
    expect(before.plan_code).toBe('core');

    await lead(t);
    await lead(t);
    const soldCar = await deal(t);
    await deal(t);
    await deliver(t, soldCar);

    const after = await usage(t.orgId);
    expect(after.window_metrics).toMatchObject({ leads_created: 2, deals_created: 2, deals_delivered: 1 });
  });

  it('a lead deleted later was still created', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('softdel');
    const doomed = await lead(t);
    expect((await usage(t.orgId)).window_metrics.leads_created).toBe(1);

    const del = await app!.inject({ method: 'DELETE', url: `/api/v1/leads/${doomed}`, headers: { cookie: t.cookie } });
    expect(del.statusCode, del.body).toBe(204);
    // Deleting a lead does not un-ingest it. A usage figure that moves
    // backwards after the fact is not a usage figure.
    expect((await usage(t.orgId)).window_metrics.leads_created).toBe(1);
  });

  it('document_bytes counts the documents that still exist, and stops counting one the file no longer needs', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('bytes');
    const dealId = await deal(t);

    const product = await app!.inject({
      method: 'POST', url: `/api/v1/deals/${dealId}/fi-products`, headers: { cookie: t.cookie },
      payload: { kind: 'warranty', name: 'Garantie prolongée', price_cents: 200_000, cost_cents: 120_000 },
    });
    expect(product.statusCode, product.body).toBe(201);
    const productId = (JSON.parse(product.body) as { id: string }).id;

    const listed = await app!.inject({ method: 'GET', url: `/api/v1/deals/${dealId}/documents`, headers: { cookie: t.cookie } });
    expect(listed.statusCode, listed.body).toBe(200);
    const agreement = (JSON.parse(listed.body) as { items: { id: string; document_type: string }[] }).items
      .find((d) => d.document_type === 'warranty_agreement');
    expect(agreement, 'selling a warranty puts its agreement in the file').toBeDefined();

    const page = Buffer.from('%PDF-1.7\nla garantie prolongée\n%%EOF\n');
    const up = await app!.inject({
      method: 'POST', url: `/api/v1/documents/${agreement!.id}/file`,
      headers: { cookie: t.cookie, 'content-type': 'application/pdf' }, payload: page,
    });
    expect(up.statusCode, up.body).toBe(201);
    expect((await usage(t.orgId)).gauges.document_bytes).toBe(page.byteLength);

    // Unsell the product: the agreement is no longer part of the file, and the
    // storage it occupied is no longer occupied.
    const removed = await app!.inject({ method: 'DELETE', url: `/api/v1/fi-products/${productId}`, headers: { cookie: t.cookie } });
    expect(removed.statusCode, removed.body).toBe(204);
    const reread = await app!.inject({ method: 'GET', url: `/api/v1/deals/${dealId}/documents`, headers: { cookie: t.cookie } });
    expect(reread.statusCode, reread.body).toBe(200);
    expect((JSON.parse(reread.body) as { items: { id: string }[] }).items.map((d) => d.id)).not.toContain(agreement!.id);

    expect((await usage(t.orgId)).gauges.document_bytes).toBe(0);
  });

  it('sms_segments counts what the carrier segmented, and says how many messages it could not', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('segments');
    const th = await thread(t);

    const counted = 'Bonjour! Je peux vous montrer le véhicule cette semaine.';
    await botSays(t, th, counted);

    // A message the carrier refused: the row exists, and `segments` was never
    // written — which is the only state `sms_messages_unsegmented` names.
    const refused = 'Un deuxième suivi que le transporteur refuse.';
    refuse.add(refused);
    await botSays(t, th, refused);
    refuse.delete(refused);

    const u = await usage(t.orgId);
    expect(u.window_metrics.sms_segments).toBe(countSegments(counted).segments);
    expect(u.window_metrics.sms_messages_unsegmented).toBe(1);
    // The two are separate claims: the sum is what the carrier counted, and the
    // companion says how much of the traffic that sum could not speak for.
    expect(u.window_metrics.sms_segments).toBeGreaterThan(0);
  });

  it('a conversation the assistant spoke in six times is one engaged conversation', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('engaged');
    const th = await thread(t);
    for (let i = 0; i < 6; i += 1) await botSays(t, th, `Suivi numéro ${i + 1} au sujet du véhicule.`);

    const u = await usage(t.orgId);
    expect(u.window_metrics.ai_conversations_engaged, 'counted once, however many turns it took').toBe(1);

    const second = await thread(t);
    await botSays(t, second, 'Bonjour, je réponds à votre demande.');
    expect((await usage(t.orgId)).window_metrics.ai_conversations_engaged).toBe(2);
  });

  it('a tenant the assistant never greeted has no p95 and says so, with its sample size beside it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('nop95');
    await lead(t);
    const u = await usage(t.orgId);
    // A p95 over an empty sample is not zero seconds, and reporting zero would
    // read as instant service. It is "not measured", and the sample size is
    // what lets a reader see that for themselves.
    expect(u.window_metrics.ai_first_touch_p95_seconds).toBeNull();
    expect(u.window_metrics.ai_first_touch_sample_count).toBe(0);
  });

  it('a lead the assistant really greeted is IN the sample, with a delay that lead experienced', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('p95');
    const from = await smsNumber(t);
    const greeted = await leadOn(t);
    const messageId = await greet(t, greeted.id, greeted.phone, from);

    // The premise the whole sample rests on, asserted rather than assumed: the
    // greeting's row is NEWER than the stamp, because the stamp carries a
    // timestamp read before staging. 0069's comment says so and forbids an
    // `m.created_at <= l.chatbot_engaged_at` conjunct on the strength of it —
    // so if this ever inverts, it fails HERE, loudly, instead of the sample
    // quietly emptying for every working tenant.
    const order = await stampOrdering(t, messageId, greeted.id);
    expect(order.sent, 'the message is written after the timestamp that stamps it').toBeGreaterThan(order.stamped);

    const u = await usage(t.orgId);
    // The half the suite was missing: "Not measured / 0 in the sample" is the
    // right answer for a tenant nobody greeted and the WRONG answer for one
    // that is working, and only a real greeting can tell the two apart.
    expect(u.window_metrics.ai_first_touch_sample_count, 'the greeted lead is the sample').toBe(1);
    const p95 = u.window_metrics.ai_first_touch_p95_seconds;
    expect(p95, 'a tenant whose first touch works must not read "Not measured"').not.toBeNull();
    expect(Number.isInteger(p95), 'seconds, whole — the schema carries an integer').toBe(true);
    expect(p95!).toBeGreaterThanOrEqual(0);
    expect(p95!, 'a lead created seconds ago cannot have waited minutes').toBeLessThan(120);
    // The greeting is a real outbound bot message, so the neighbouring number
    // moved with it — the two are answers about the same event.
    expect(u.window_metrics.ai_conversations_engaged).toBe(1);
    expect(await engagedAt(t, greeted.id)).not.toBeNull();
  });

  it('a stamp with no message of this lead’s own is not a first touch — both deviant paths stay out', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('deviant');
    const from = await smsNumber(t);

    // The keeper: greeted for real, and the only lead that belongs in the sample.
    const keeper = await leadOn(t);
    await greet(t, keeper.id, keeper.phone, from);

    // (1) duplicate-as-signal (first-touch.ts:238-243): the same person submits
    // again. The confirming text goes to the KEEPER's thread — the conversation
    // carrying the KEEPER's lead_id — and this record is stamped, having been
    // sent nothing on any thread of its own.
    const resubmitted = await lead(t, { source: 'walk_in', phone: keeper.phone });
    await confirmOnKeepersThread(t, keeper.id, keeper.phone, from);
    await withTenant(appPool, t.orgId, (c) => c.query(DEDUPE_STAMP_SQL, [resubmitted, new Date()]));

    // (2) the 24-hour dedupe (first-touch.ts:165-171): this person already has
    // today's confirmation on their phone, so the submission is marked handled
    // and NOTHING is sent — one confirming text a day is the ceiling.
    const sameDay = await lead(t, { source: 'walk_in', phone: keeper.phone });
    await withTenant(appPool, t.orgId, (c) => c.query(DEDUPE_STAMP_SQL, [sameDay, new Date()]));

    // All three really are stamped, read back through the dealership's own
    // route: the exclusion below is the definer's work and not a fixture that
    // quietly did nothing.
    for (const id of [keeper.id, resubmitted, sameDay]) {
      expect(await engagedAt(t, id), `lead ${id} carries a stamp`).not.toBeNull();
    }

    const u = await usage(t.orgId);
    expect(u.window_metrics.leads_created, 'three leads, three stamps').toBe(3);
    // Without `c.lead_id = l.id` this reads 3, and the card would report a
    // first-touch latency for two people the assistant never answered.
    expect(u.window_metrics.ai_first_touch_sample_count, 'only the lead that was answered').toBe(1);
    expect(u.window_metrics.ai_first_touch_p95_seconds).not.toBeNull();
  });

  it('the greeting fixture is still the producer’s: both stamps are first-touch.ts’s own SQL', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // apps/api cannot import apps/workers (see the note on greet()), so the two
    // UPDATE statements above are copies. A copy that drifts is a fixture that
    // proves something the product no longer does, so it is pinned here: if
    // first-touch.ts changes how it stamps, this fails and the p95 cases above
    // are rewritten rather than quietly becoming fiction.
    const producer = (
      await readFile(join(here, '..', '..', 'workers', 'src', 'first-touch.ts'), 'utf8')
    ).replace(/\r\n/g, '\n');
    expect(producer, 'the SLA stamp moved — re-copy it into FIRST_TOUCH_STAMP_SQL')
      .toContain(FIRST_TOUCH_STAMP_SQL);
    expect(producer, 'the dedupe stamp moved — re-copy it into DEDUPE_STAMP_SQL')
      .toContain(DEDUPE_STAMP_SQL);
    // And the ordering the whole sample depends on: `now` is read BEFORE the
    // staging block, not after the carrier answers.
    const capture = producer.indexOf('const now = deps.now?.() ?? new Date();');
    const stamp = producer.indexOf(FIRST_TOUCH_STAMP_SQL);
    expect(capture, 'runFirstTouch still captures `now` itself').toBeGreaterThan(-1);
    expect(capture, '`now` is captured before the stamp, so the message row is newer').toBeLessThan(stamp);
  });
});

describe('a seat and a membership are different facts (§6)', () => {
  it('one person at three rooftops is one seat and three memberships', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('seats');
    const second = await store(t.cookie, t.orgId, `seats2-${run.slice(-4)}`);
    const third = await store(t.cookie, t.orgId, `seats3-${run.slice(-4)}`);

    const before = await usage(t.orgId);
    const colleagueEmail = `f73-seats-colleague-${run}@dealpilot.test`;
    await signUp(colleagueEmail, 'Directeur des ventes');
    for (const storeId of [t.storeId, second, third]) {
      const res = await app!.inject({
        method: 'POST', url: '/api/v1/members', headers: { cookie: t.cookie },
        payload: { organization_id: t.orgId, store_id: storeId, email: colleagueEmail, name: 'Directeur des ventes', roles: ['sales_manager'] },
      });
      expect(res.statusCode, res.body).toBe(201);
    }

    const after = await usage(t.orgId);
    // Three rows, one person. Two numbers that disagree on adjacent screens is
    // how support tickets start, so both ship and they are named apart.
    expect(after.gauges.member_count - before.gauges.member_count).toBe(3);
    expect(after.gauges.seats_provisioned - before.gauges.seats_provisioned).toBe(1);
    expect(after.gauges.store_count).toBe(3);
  });

  it('the card and the tenant page cannot print two different numbers for one fact', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('agree');
    await store(t.cookie, t.orgId, `agree2-${run.slice(-4)}`);

    const u = await usage(t.orgId);
    const detail = AdminTenantDetail.parse(JSON.parse((await app!.inject({
      method: 'GET', url: `/api/v1/admin/tenants/${t.orgId}`, headers: { cookie: superCookie },
    })).body));
    expect(u.gauges.member_count).toBe(detail.member_count);
    expect(u.gauges.store_count).toBe(detail.store_count);
  });

  it('members_who_acted counts only people who hold access today, and never exceeds the seats', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('acted');
    const colleagueEmail = `f73-acted-colleague-${run}@dealpilot.test`;
    const colleagueCookie = await signUp(colleagueEmail, 'Vendeuse');
    const added = await app!.inject({
      method: 'POST', url: '/api/v1/members', headers: { cookie: t.cookie },
      payload: { organization_id: t.orgId, store_id: t.storeId, email: colleagueEmail, name: 'Vendeuse', roles: ['sales_manager'] },
    });
    expect(added.statusCode, added.body).toBe(201);
    const membershipId = (JSON.parse(added.body) as { id: string }).id;

    await lead(t);
    phoneSeq += 1;
    const theirs = await app!.inject({
      method: 'POST', url: '/api/v1/leads', headers: { cookie: colleagueCookie },
      payload: {
        organization_id: t.orgId, store_id: t.storeId, first_name: 'Prospect',
        phone: `+1514555${String(3000 + phoneSeq).slice(-4)}`, source: 'manual',
      },
    });
    expect(theirs.statusCode, theirs.body).toBe(201);

    const both = await usage(t.orgId);
    expect(both.window_metrics.members_who_acted).toBe(2);
    expect(both.window_metrics.members_who_acted).toBeLessThanOrEqual(both.gauges.seats_provisioned);

    const revoked = await app!.inject({
      method: 'PATCH', url: `/api/v1/members/${membershipId}`, headers: { cookie: t.cookie },
      payload: { status: 'revoked' },
    });
    expect(revoked.statusCode, revoked.body).toBe(200);

    const after = await usage(t.orgId);
    // Their events are still in the log — this is a mutation log, not a
    // membership log — but the card counts people with access, so that the
    // number beside it is drawn from the same population.
    expect(after.window_metrics.members_who_acted).toBe(1);
    expect(after.gauges.seats_provisioned).toBe(1);
    expect(after.window_metrics.members_who_acted).toBeLessThanOrEqual(after.gauges.seats_provisioned);
  });

  it('members_who_acted is a FLOOR: a colleague who only reads is not counted, and the caption is why', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('floor');
    const readerEmail = `f73-floor-reader-${run}@dealpilot.test`;
    const readerCookie = await signUp(readerEmail, 'Réceptionniste');
    const added = await app!.inject({
      method: 'POST', url: '/api/v1/members', headers: { cookie: t.cookie },
      payload: { organization_id: t.orgId, store_id: t.storeId, email: readerEmail, name: 'Réceptionniste', roles: ['sales_manager'] },
    });
    expect(added.statusCode, added.body).toBe(201);

    // The owner writes something; the colleague spends the window READING —
    // the list, then the record itself. Both used the product today.
    const seen = await lead(t);
    for (const url of [`/api/v1/leads?organization_id=${t.orgId}`, `/api/v1/leads/${seen}`]) {
      const res = await app!.inject({ method: 'GET', url, headers: { cookie: readerCookie } });
      expect(res.statusCode, res.body).toBe(200);
    }

    const u = await usage(t.orgId);
    // activity_events is a MUTATION log, so a reader writes no row and cannot
    // be counted. Two people were in the product and the card says one: the
    // number is a floor under activity, never a daily-active-user count, and
    // that is exactly what the caption has to say for a support rep not to
    // quote it to a dealer as one.
    expect(u.gauges.seats_provisioned, 'two people hold access').toBe(2);
    expect(u.window_metrics.members_who_acted, 'only the one who WROTE').toBe(1);
    expect(u.window_metrics.members_who_acted).toBeLessThan(u.gauges.seats_provisioned);
  });
});

describe('what the tenant bought, and what it does not mean (§6, §5.1)', () => {
  it('allowances ride only the month to date', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('allow');
    const mtd = await usage(t.orgId, 'mtd');
    expect(mtd.allowances).not.toBeNull();
    expect(mtd.allowances).toMatchObject({ included_sms_segments: expect.any(Number), included_ai_conversations: expect.any(Number) });
    // A monthly allowance beside a ninety-day count is a lie no caption
    // repairs, so the API refuses to hand over the two numbers to make it with.
    expect((await usage(t.orgId, '30d')).allowances).toBeNull();
    expect((await usage(t.orgId, '90d')).allowances).toBeNull();
  });

  it('an unlimited seat allowance is null on the wire, never zero and never a full bar', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('unlimited');
    // A real plan row, repriced the way an owner would: plans.included_seats is
    // nullable and NULL means unlimited (0065:49), which is a commercial fact
    // the wire has to be able to carry.
    await admin.query(
      `INSERT INTO plans (code, name, monthly_price_cents_per_store, included_seats, included_sms_segments, included_ai_conversations)
       VALUES ('enterprise', 'Entreprise (illimité)', 90000, NULL, 20000, 2000)
       ON CONFLICT (code) DO UPDATE SET included_seats = NULL`,
    );
    const planId = (await admin.query<{ id: string }>(`SELECT id FROM plans WHERE code = 'enterprise'`)).rows[0]!.id;
    const repriced = await app!.inject({
      method: 'PATCH', url: `/api/v1/admin/tenants/${t.orgId}`, headers: { cookie: superCookie },
      payload: { plan_id: planId, reason: 'usage suite: an unlimited-seat plan' },
    });
    expect(repriced.statusCode, repriced.body).toBe(200);

    const u = await usage(t.orgId, 'mtd');
    expect(u.plan_code).toBe('enterprise');
    expect(u.allowances!.included_seats, 'null is unlimited — never 0, which would read as a full bar').toBeNull();
  });

  it('an allowance of zero is carried as zero, so nothing computes a ratio against it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('zeroallow');
    // plans_included_sms_segments_check permits 0 (0065:52) and the table's own
    // comment says pricing is data, not code — so an owner editing a plan row
    // to 0 is inside this slice's lifetime, and 0 must reach the client AS zero
    // rather than as a denominator.
    await admin.query(
      `INSERT INTO plans (code, name, monthly_price_cents_per_store, included_seats, included_sms_segments, included_ai_conversations)
       VALUES ('scale', 'Échelle (sans forfait SMS)', 50000, 25, 0, 0)
       ON CONFLICT (code) DO UPDATE SET included_sms_segments = 0, included_ai_conversations = 0`,
    );
    const planId = (await admin.query<{ id: string }>(`SELECT id FROM plans WHERE code = 'scale'`)).rows[0]!.id;
    const repriced = await app!.inject({
      method: 'PATCH', url: `/api/v1/admin/tenants/${t.orgId}`, headers: { cookie: superCookie },
      payload: { plan_id: planId, reason: 'usage suite: a plan that includes no segments' },
    });
    expect(repriced.statusCode, repriced.body).toBe(200);

    const u = await usage(t.orgId, 'mtd');
    expect(u.allowances).toMatchObject({ included_sms_segments: 0, included_ai_conversations: 0 });
    const ratio = u.window_metrics.sms_segments / u.allowances!.included_sms_segments;
    expect(Number.isFinite(ratio), 'a ratio against zero is not a number and must never be rendered').toBe(false);
  });

  it('a tenant past its included segments still sends — nothing on this card enforces anything', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('overage');
    await admin.query(
      `INSERT INTO plans (code, name, monthly_price_cents_per_store, included_seats, included_sms_segments, included_ai_conversations)
       VALUES ('growth', 'Croissance (un seul segment)', 30000, 10, 1, 1)
       ON CONFLICT (code) DO UPDATE SET included_sms_segments = 1, included_ai_conversations = 1`,
    );
    const planId = (await admin.query<{ id: string }>(`SELECT id FROM plans WHERE code = 'growth'`)).rows[0]!.id;
    await app!.inject({
      method: 'PATCH', url: `/api/v1/admin/tenants/${t.orgId}`, headers: { cookie: superCookie },
      payload: { plan_id: planId, reason: 'usage suite: a one-segment plan' },
    });

    const th = await thread(t);
    await botSays(t, th, 'Un premier message qui consomme le seul segment compris.');
    await botSays(t, th, 'Un deuxième message, déjà au-delà du forfait.');
    const spent = await usage(t.orgId, 'mtd');
    expect(spent.window_metrics.sms_segments).toBeGreaterThan(spent.allowances!.included_sms_segments);

    // The bar is over its number and the send path does not care, which is
    // exactly why the copy may never say "limit" or "remaining".
    const after = await withTenant(appPool, t.orgId, async (c) =>
      sendMessage(c, {
        organizationId: t.orgId, storeId: t.storeId, conversationId: th.conversationId, leadId: null,
        phoneE164: th.phone, body: 'Un troisième message, bien au-delà du forfait.', senderType: 'bot',
        messageClass: 'inbound_reply', scope: 'conversational', isSolicitation: false, nowUtc: new Date(),
      }),
    );
    expect(after.kind, 'plans.overage is seeded hard_stop and nothing stops').toBe('sent');
  });
});

describe('who may read the card (§3, §7, §11)', () => {
  it('a tenant that does not exist is 404, not an empty card', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await usageRes(randomUUID());
    expect(res.statusCode, res.body).toBe(404);
  });

  it('platform_billing may read usage; the dealership’s own owner cannot see the console at all', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // A provisioned tenant of its own: a case about who is refused must not be
    // able to pass because an earlier case left the right rows lying around.
    const slug = `groupe-gate-${run}`;
    const provisioned = await app!.inject({
      method: 'POST', url: '/api/v1/admin/tenants', headers: { cookie: superCookie },
      payload: {
        legal_name: `Groupe Gate ${run} inc.`, display_name: 'Groupe Gate', slug,
        province: 'QC', plan_id: corePlan,
        owner_email: `f73-gate-owner-${run}@dealpilot.test`, owner_name: 'Propriétaire Gate',
        stores: [{ name: 'Gate Laval', code: `GATE-${run.slice(-4)}`, province: 'QC' }],
      },
    });
    expect(provisioned.statusCode, provisioned.body).toBe(201);
    const gateOrg = (JSON.parse(provisioned.body) as { tenant: { id: string } }).tenant.id;

    for (const cookie of [superCookie, supportCookie, billingCookie]) {
      expect((await usageRes(gateOrg, 'mtd', cookie)).statusCode).toBe(200);
    }
    // A dealer is not staff, so the console does not exist for them — 404, not
    // 403: the platform surface must not confirm its own shape to a tenant.
    const dealer = await tenant('dealer');
    expect((await usageRes(gateOrg, 'mtd', dealer.cookie)).statusCode).toBe(404);
    expect((await usageRes(dealer.orgId, 'mtd', dealer.cookie)).statusCode).toBe(404);

    // And the definer refuses on its own, so a route mistake could not widen
    // it: PA001 is "not platform staff", which 0065's own header maps to the
    // same 404 the route just gave — the refusal is the database's, not the
    // route's alone.
    await expect(
      admin.query('SELECT * FROM admin_tenant_usage($1::uuid, $2::uuid, $3::text)', [dealer.ownerId, gateOrg, 'mtd']),
    ).rejects.toMatchObject({ code: 'PA001' });
  });

  it('the card is closed during a live support session', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t = await tenant('imp');
    const started = await app!.inject({
      method: 'POST', url: '/api/v1/admin/impersonation-sessions', headers: { cookie: supportCookie },
      payload: { tenant_id: t.orgId, target_user_id: t.ownerId, reason: REASON },
    });
    expect(started.statusCode, started.body).toBe(201);
    const sessionId = (JSON.parse(started.body) as { id: string }).id;
    try {
      // Reading a usage card is state, not an emergency stop: F-72 set that bar
      // for the kill switches and this does not clear it.
      const during = await usageRes(t.orgId, 'mtd', supportCookie);
      expect(during.statusCode, during.body).toBe(409);
      expect(JSON.parse(during.body)).toMatchObject({ error: { code: 'impersonation_active' } });
    } finally {
      const ended = await app!.inject({
        method: 'DELETE', url: `/api/v1/admin/impersonation-sessions/${sessionId}`, headers: { cookie: supportCookie },
      });
      expect(ended.statusCode, ended.body).toBe(200);
    }
    expect((await usageRes(t.orgId, 'mtd', supportCookie)).statusCode).toBe(200);
  });
});
