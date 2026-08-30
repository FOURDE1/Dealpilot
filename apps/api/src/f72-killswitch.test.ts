import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, withTenant, type Pool,
} from '@dealpilot/db';
import { KILL_SWITCH_TTL_MS, PLATFORM_SETTING_KEYS, PlatformSetting, PlatformSettingList } from '@dealpilot/schemas';
import { buildApp } from './app.js';
import type { Carrier, CarrierResult, OutboundSms } from './carrier.js';
import { loadEnv } from './env.js';
import { sendMessage, type OutboundRequest } from './f19-send.js';
import { handOff } from './f20-handoff.js';
import { deliverMessage } from './f30-deliver.js';
import { killSwitches, resetKillSwitchCache, type Queryable } from './platform-settings.js';
import { enrol, signInWithTotp } from './testing/totp.js';

/**
 * F-72 — the platform kill switches (admin-console.md §5.3, D-073). What is
 * worth proving:
 *  - the door: only a super admin flips one, the definer says so too, and
 *    resuming costs typing the switch name back;
 *  - the switch actually stops sending — through the agent's own route and
 *    through every `sendMessage` shape the four workers use — and stops
 *    exactly what its label claims: the SMS switch spares a voice call, the AI
 *    switch spares a person's reply and the handoff notice;
 *  - the reader's three properties: bounded by the TTL, one query per burst,
 *    and never falling back to OFF — a failed read propagates, a missing row
 *    reads as ON, and the app role cannot flip one at all;
 *  - the belt at `deliverMessage`, which is what holds when a path reaches the
 *    carrier without passing `evaluateSend`;
 *  - the register: one immutable `settings.flipped` row naming the staffer,
 *    written even while a support session is open.
 *
 * Every blocked-behaviour case builds its OWN number, consent and conversation
 * inside the `it` — a shared fixture would let one case pass on an earlier
 * case's consent row, which is exactly how a gate that does nothing looks
 * green.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';
const WHY = 'carrier incident: stop everything while we investigate';

let admin: Pool;
let appPool: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;

let ownerCookie = ''; let orgId = ''; let storeId = '';
let colleagueId = '';
let superCookie = ''; let superId = '';
let supportCookie = ''; let supportId = '';
let billingCookie = '';

const env = loadEnv({ DATABASE_URL: APP_URL, NODE_ENV: 'test' });

/**
 * 13:00 in Montreal, on the next day that has not happened yet: comfortably
 * inside every default quiet-hours window, and strictly AFTER everything a
 * fixture writes at `now()`. The gate judges a send against `nowUtc`, so a
 * fixed past instant would evaluate a consent that was revoked a fortnight
 * later as still live — the revocation case is the one that noticed.
 */
const MIDDAY = (() => {
  const t = new Date();
  t.setUTCHours(17, 0, 0, 0);
  if (t.getTime() <= Date.now()) t.setUTCDate(t.getUTCDate() + 1);
  return t;
})();

let phoneSeq = 200;
function nextPhone(): string {
  phoneSeq += 1;
  return `+1450555${String(phoneSeq).padStart(4, '0')}`;
}

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

/** Grant + enrol + sign in through TOTP: a console-ready staffer (the F-69 helper). */
async function staffer(email: string, name: string, role: string, actor: string | null): Promise<string> {
  const first = await signUp(email, name);
  await admin.query('SELECT * FROM platform_staff_grant($1, $2, $3, $4)', [actor, email, role, 'test fixture']);
  const { secret } = await enrol(app!, first, PASSWORD);
  return signInWithTotp(app!, email, PASSWORD, secret);
}

async function flip(key: string, body: Record<string, unknown>, cookie = superCookie) {
  return app!.inject({ method: 'POST', url: `/api/v1/admin/platform-settings/${key}`, headers: { cookie }, payload: body });
}

async function settings(cookie = superCookie) {
  return app!.inject({ method: 'GET', url: '/api/v1/admin/platform-settings', headers: { cookie } });
}

/**
 * Flip a switch the way ANOTHER process would: through the definer, without
 * the route's in-process `resetKillSwitchCache()`. Every case about the cache
 * needs this, because the flip route deliberately makes its own process obey
 * at once — which is the thing the TTL is not.
 */
async function flipOutOfProcess(key: string, enabled: boolean): Promise<void> {
  await admin.query('SELECT admin_set_platform_setting($1::uuid, $2::text, $3::boolean, $4::text)', [superId, key, enabled, WHY]);
}

async function allSwitchesOff(): Promise<void> {
  for (const key of PLATFORM_SETTING_KEYS) await flipOutOfProcess(key, false);
  resetKillSwitchCache();
}

/** A number with express conversational consent, and a live conversation on it. */
async function fixture(opts: { consent?: boolean } = {}): Promise<{ phone: string; conversationId: string; consentId: string | null }> {
  const phone = nextPhone();
  let consentId: string | null = null;
  if (opts.consent !== false) {
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/consent', headers: { cookie: ownerCookie },
      payload: {
        organization_id: orgId, phone_e164: phone,
        channels: ['sms'], scopes: ['conversational'],
        consent_type: 'express', source: 'staff_manual',
        evidence: { note: 'seeded for the kill-switch test' },
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    // POST /consent fans one act out to a row per (channel, scope) and returns
    // the array; one channel and one scope means exactly one row.
    const written = JSON.parse(res.body) as { id: string }[];
    expect(written).toHaveLength(1);
    consentId = written[0]!.id;
  }
  const conversationId = await withTenant(appPool, orgId, async (c) => {
    const r = await c.query<{ id: string }>(
      `INSERT INTO conversations (organization_id, store_id, phone_e164) VALUES ($1,$2,$3) RETURNING id`,
      [orgId, storeId, phone],
    );
    return r.rows[0]!.id;
  });
  return { phone, conversationId, consentId };
}

function request(f: { phone: string; conversationId: string }, over: Partial<OutboundRequest> = {}): OutboundRequest {
  return {
    organizationId: orgId,
    storeId,
    conversationId: f.conversationId,
    leadId: null,
    phoneE164: f.phone,
    body: 'Bonjour! Je peux vous montrer le véhicule cette semaine.',
    senderType: 'bot',
    messageClass: 'inbound_reply',
    scope: 'conversational',
    isSolicitation: false,
    nowUtc: MIDDAY,
    ...over,
  };
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  return Number((await admin.query<{ n: string }>(sql, params)).rows[0]!.n);
}

async function messageCount(conversationId: string): Promise<number> {
  return count(`SELECT count(*) AS n FROM messages WHERE conversation_id = $1`, [conversationId]);
}

async function decisionsFor(phone: string): Promise<{ status: string; reason: string | null }[]> {
  return (await admin.query<{ status: string; reason: string | null }>(
    `SELECT status, reason FROM send_decisions WHERE phone_e164 = $1 ORDER BY decided_at`, [phone],
  )).rows;
}

/** A lead with express consent, for the two console-preview cases. */
async function leadFixture(): Promise<{ leadId: string; phone: string }> {
  const phone = nextPhone();
  const res = await app!.inject({
    method: 'POST', url: '/api/v1/leads', headers: { cookie: ownerCookie },
    payload: { organization_id: orgId, store_id: storeId, first_name: 'Prospect', phone, source: 'manual' },
  });
  expect(res.statusCode, res.body).toBe(201);
  const leadId = (JSON.parse(res.body) as { id: string }).id;
  const consent = await app!.inject({
    method: 'POST', url: '/api/v1/consent', headers: { cookie: ownerCookie },
    payload: {
      organization_id: orgId, lead_id: leadId, phone_e164: phone,
      channels: ['sms'], scopes: ['conversational'],
      consent_type: 'express', source: 'staff_manual', evidence: { note: 'seeded' },
    },
  });
  expect(consent.statusCode, consent.body).toBe(201);
  return { leadId, phone };
}

/** A carrier that counts what it was actually asked to send, and nothing else. */
function countingCarrier(): Carrier & { sends: OutboundSms[] } {
  const sends: OutboundSms[] = [];
  return {
    kind: 'log',
    deliversToRecipient: false,
    sends,
    async send(message: OutboundSms): Promise<CarrierResult> {
      sends.push(message);
      return { kind: 'accepted', providerRef: `SM-f72-${sends.length}`, segments: 1 };
    },
    verifyInbound: () => false,
  };
}

/** A Queryable that counts how many times the reader reached the database. */
function countingQueryable(pool: Pool): Queryable & { calls: number } {
  const q = {
    calls: 0,
    async query<R extends Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }> {
      q.calls += 1;
      return pool.query(text, values) as unknown as Promise<{ rows: R[] }>;
    },
  };
  return q;
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
  // A dozen TOTP sign-ins in a few seconds is far past the F-44 per-IP budget;
  // the limiter is its own suite's concern and is injected open here.
  ({ app } = await buildApp(
    { DATABASE_URL: APP_URL, NODE_ENV: 'test' },
    { rateLimiter: { take: async () => ({ allowed: true, retryAfterS: 0 }), close: async () => {} } },
  ));

  const ownerEmail = `f72k-owner-${run}@dealpilot.test`;
  ownerCookie = await signUp(ownerEmail, 'Patronne');
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie: ownerCookie },
    payload: { name: 'Groupe Interrupteur', slug: `groupe-interrupteur-${run}` },
  });
  expect(org.statusCode, org.body).toBe(201);
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie: ownerCookie },
    payload: { organization_id: orgId, name: 'Rooftop Laval', code: `K72-${run.slice(-4)}`, province: 'QC' },
  });
  expect(store.statusCode, store.body).toBe(201);
  storeId = (JSON.parse(store.body) as { id: string }).id;

  const colleagueEmail = `f72k-vendeur-${run}@dealpilot.test`;
  await signUp(colleagueEmail, 'Vendeur');
  colleagueId = await userId(colleagueEmail);
  const added = await app!.inject({
    method: 'POST', url: '/api/v1/members', headers: { cookie: ownerCookie },
    payload: { organization_id: orgId, email: colleagueEmail, name: 'Vendeur', roles: ['salesperson'] },
  });
  expect(added.statusCode, added.body).toBe(201);

  const superEmail = `f72k-super-${run}@dealpilot.test`;
  superCookie = await staffer(superEmail, 'Super Admin', 'platform_super_admin', null);
  superId = await userId(superEmail);
  const supportEmail = `f72k-support-${run}@dealpilot.test`;
  supportCookie = await staffer(supportEmail, 'Soutien', 'platform_support', superId);
  supportId = await userId(supportEmail);
  billingCookie = await staffer(`f72k-billing-${run}@dealpilot.test`, 'Facturation', 'platform_billing', superId);
});

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await admin?.end();
});

// A17: an apps/api suite resets through `./platform-settings.js`, never through
// the built `@dealpilot/api/platform-settings` — they are two module instances.
beforeEach(() => {
  resetKillSwitchCache();
});

// Nothing may leak a flipped switch into the next case.
afterEach(async () => {
  if (!dbUp) return;
  await allSwitchesOff();
});

describe('who may flip a switch (§5.3)', () => {
  it('a super admin turns the SMS switch on with a reason, and the read echoes it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await flip('sms_send_killswitch', { enabled: true, reason: WHY });
    expect(res.statusCode, res.body).toBe(200);
    const setting = PlatformSetting.parse(JSON.parse(res.body));
    expect(setting).toMatchObject({ setting_key: 'sms_send_killswitch', enabled: true, reason: WHY });
    expect(setting.changed_by_email).toBe(`f72k-super-${run}@dealpilot.test`);

    const list = PlatformSettingList.parse(JSON.parse((await settings()).body));
    expect(list.items.map((s) => s.setting_key).sort()).toEqual([...PLATFORM_SETTING_KEYS].sort());
    expect(list.items.find((s) => s.setting_key === 'sms_send_killswitch')).toMatchObject({ enabled: true, reason: WHY });
    expect(list.items.find((s) => s.setting_key === 'ai_outbound_killswitch')).toMatchObject({ enabled: false, reason: null });
  });

  it('platform_support is refused by the route AND by the definer', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await flip('sms_send_killswitch', { enabled: true, reason: WHY }, supportCookie);
    expect(res.statusCode, res.body).toBe(403);
    expect(JSON.parse(res.body)).toMatchObject({ error: { code: 'forbidden', details: [{ message: 'settings:write' }] } });
    // MUTATION: delete the `platform_assert_actor` line from
    // admin_set_platform_setting and this half goes green with the route's
    // capability check untouched — which is why both are asserted.
    await expect(
      admin.query('SELECT admin_set_platform_setting($1::uuid, $2::text, true, $3::text)', [supportId, 'sms_send_killswitch', WHY]),
    ).rejects.toMatchObject({ code: 'PA009' });
    expect(await count(`SELECT count(*) AS n FROM platform_settings WHERE enabled`)).toBe(0);
    // …but support may still SEE the switches: §3 gives it the incident duty.
    expect((await settings(supportCookie)).statusCode).toBe(200);
  });

  it('platform_billing is refused on settings:write and on settings:read — §3 gives billing no incident duty', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const write = await flip('sms_send_killswitch', { enabled: true, reason: WHY }, billingCookie);
    expect(write.statusCode, write.body).toBe(403);
    expect(JSON.parse(write.body)).toMatchObject({ error: { details: [{ message: 'settings:write' }] } });
    const read = await settings(billingCookie);
    expect(read.statusCode, read.body).toBe(403);
    expect(JSON.parse(read.body)).toMatchObject({ error: { details: [{ message: 'settings:read' }] } });
  });

  it('resuming without confirm_setting_key is 422 key_mismatch; with it, 200', async (ctx) => {
    if (!dbUp) return ctx.skip();
    expect((await flip('sms_send_killswitch', { enabled: true, reason: WHY })).statusCode).toBe(200);
    // Killing costs one click. Resuming releases a backlog onto real
    // customers, so it costs typing the name back.
    const bare = await flip('sms_send_killswitch', { enabled: false, reason: 'the carrier is healthy again' });
    expect(bare.statusCode, bare.body).toBe(422);
    expect(JSON.parse(bare.body)).toMatchObject({ error: { code: 'validation_failed', details: [{ path: 'confirm_setting_key', code: 'confirm_required' }] } });
    const wrong = await flip('sms_send_killswitch', { enabled: false, reason: 'the carrier is healthy again', confirm_setting_key: 'ai_outbound_killswitch' });
    expect(wrong.statusCode, wrong.body).toBe(422);
    expect(JSON.parse(wrong.body)).toMatchObject({ error: { details: [{ path: 'confirm_setting_key', code: 'key_mismatch' }] } });
    expect(await count(`SELECT count(*) AS n FROM platform_settings WHERE setting_key = 'sms_send_killswitch' AND enabled`)).toBe(1);

    const right = await flip('sms_send_killswitch', { enabled: false, reason: 'the carrier is healthy again', confirm_setting_key: 'sms_send_killswitch' });
    expect(right.statusCode, right.body).toBe(200);
    // Resuming NULLs the reason on purpose: the history lives in the register.
    expect(PlatformSetting.parse(JSON.parse(right.body))).toMatchObject({ enabled: false, reason: null });
  });

  it('a reason under ten characters is 422, and the definer refuses an empty one with 23514 — one number, three places', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const short = await flip('sms_send_killswitch', { enabled: true, reason: 'oups' });
    expect(short.statusCode, short.body).toBe(422);
    expect(JSON.parse(short.body)).toMatchObject({ error: { code: 'validation_failed', details: [{ path: 'reason' }] } });
    await expect(
      admin.query('SELECT admin_set_platform_setting($1::uuid, $2::text, true, $3::text)', [superId, 'sms_send_killswitch', '']),
    ).rejects.toMatchObject({ code: '23514' });
    expect(await count(`SELECT count(*) AS n FROM platform_settings WHERE enabled`)).toBe(0);
  });

  it('webhook_delivery_pause stays cut — the route 404s and the CHECK refuses the row', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await flip('webhook_delivery_pause', { enabled: true, reason: WHY });
    expect(res.statusCode, res.body).toBe(404);
    // MUTATION: adding the key to PlatformSettingKey alone gets past the route
    // and straight into this CHECK — the deliberate cut is enforced twice.
    await expect(
      admin.query(`INSERT INTO platform_settings (setting_key) VALUES ('webhook_delivery_pause')`),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('the switch stops sending', () => {
  it('SMS ON refuses every caller of the send layer, each from its own fresh fixture', async (ctx) => {
    if (!dbUp) return ctx.skip();
    expect((await flip('sms_send_killswitch', { enabled: true, reason: WHY })).statusCode).toBe(200);

    // 1. The agent's own route. A refusal is a 200 with a reason (F-21): the
    //    request was well-formed and the answer is "no, and here is why".
    const agent = await fixture();
    const replied = await app!.inject({
      method: 'POST', url: `/api/v1/conversations/${agent.conversationId}/messages`,
      headers: { cookie: ownerCookie }, payload: { body: 'Bonjour, je vous rappelle demain.' },
    });
    expect(replied.statusCode, replied.body).toBe(200);
    expect(JSON.parse(replied.body)).toMatchObject({ kind: 'blocked', reason: 'platform_sms_paused' });
    expect(await messageCount(agent.conversationId)).toBe(0);
    expect(await decisionsFor(agent.phone)).toEqual([{ status: 'blocked', reason: 'platform_sms_paused' }]);

    // 2-5. The four worker entry points reach the customer through exactly one
    //      function — `sendMessage` — so each is exercised here in the shape
    //      its worker builds. The workers' own outcome mapping (the drip
    //      WAITING, the rest not_sent) is asserted in apps/workers, which this
    //      package cannot import.
    const shapes: { name: string; over: Partial<OutboundRequest> }[] = [
      { name: 'the assistant turn', over: { senderType: 'bot', messageClass: 'inbound_reply' } },
      { name: 'the drip tick', over: { senderType: 'drip', messageClass: 'drip', scope: 'conversational' } },
      { name: 'the first touch', over: { senderType: 'bot', messageClass: 'first_touch' } },
      { name: 'the deferred send', over: { senderType: 'agent', messageClass: 'follow_up' } },
    ];
    for (const shape of shapes) {
      const f = await fixture();
      const out = await withTenant(appPool, orgId, (c) => sendMessage(c, request(f, shape.over)));
      expect(out, shape.name).toMatchObject({ kind: 'blocked', reason: 'platform_sms_paused' });
      expect(await messageCount(f.conversationId), shape.name).toBe(0);
      // Every attempt still leaves exactly one row: a refusal is a decision.
      expect(await decisionsFor(f.phone), shape.name).toEqual([{ status: 'blocked', reason: 'platform_sms_paused' }]);
    }
  });

  it('AI ON refuses a drip and leaves no message', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    expect((await flip('ai_outbound_killswitch', { enabled: true, reason: WHY })).statusCode).toBe(200);
    // MUTATION: map 'drip' to 'system' in `originatorOf` and this goes green —
    // which is how three same-tick drips escaped the cap in F-61.
    const out = await withTenant(appPool, orgId, (c) =>
      sendMessage(c, request(f, { senderType: 'drip', messageClass: 'drip' })),
    );
    expect(out).toMatchObject({ kind: 'blocked', reason: 'platform_ai_paused' });
    expect(await messageCount(f.conversationId)).toBe(0);
  });

  it('AI ON does not stop a human: the agent still replies, and the handoff notice still goes', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    expect((await flip('ai_outbound_killswitch', { enabled: true, reason: WHY })).statusCode).toBe(200);
    // MUTATION: drop `req.originator === 'ai'` from the AI gate and both halves
    // go red — the console copy says the assistant stops, not the dealership.
    const replied = await app!.inject({
      method: 'POST', url: `/api/v1/conversations/${f.conversationId}/messages`,
      headers: { cookie: ownerCookie }, payload: { body: 'Bonjour, je m’en occupe personnellement.' },
    });
    expect(replied.statusCode, replied.body).toBe(200);
    expect(JSON.parse(replied.body)).toMatchObject({ kind: 'sent' });
    expect(await messageCount(f.conversationId)).toBe(1);

    // The handoff notice is `system`, not `bot`: saying "a person is taking
    // over" is the opposite of the assistant pestering somebody.
    const h = await fixture();
    const handed = await withTenant(appPool, orgId, (c) =>
      handOff(c, {
        organizationId: orgId, storeId, conversationId: h.conversationId, leadId: null,
        phoneE164: h.phone, assignedAgentId: colleagueId, trigger: 'high_intent',
        analysis: {
          sentiment: 'positive', buyingSignals: ['prix'], concerns: [],
          summary: 'prête à acheter cette semaine', score: 'hot',
          scoreReason: 'demande un rendez-vous', suggestedResponse: null,
        },
        followsClientMessage: true, nowUtc: MIDDAY,
      }),
    );
    expect(handed.kind).toBe('handed_off');
    if (handed.kind !== 'handed_off') return;
    expect(handed.notice.kind).toBe('sent');
  });

  it('SMS ON does not refuse a VOICE preview, while the same lead on sms IS refused', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const lead = await leadFixture();
    expect((await flip('sms_send_killswitch', { enabled: true, reason: WHY })).statusCode).toBe(200);
    const preview = async (qs: string) =>
      JSON.parse((await app!.inject({ method: 'GET', url: `/api/v1/leads/${lead.leadId}/compliance?${qs}`, headers: { cookie: ownerCookie } })).body) as { status: string; reason: string | null };

    // MUTATION: drop `req.channel === 'sms'` from the SMS gate and the voice
    // half goes red — without it the console copy « Arrêt des SMS sortants »
    // is false, because ADAD calls would stop too.
    const voice = await preview('channel=voice&message_class=outbound_voice&scope=ai_outbound_call');
    expect(voice.reason).not.toBe('platform_sms_paused');
    const sms = await preview('channel=sms&message_class=follow_up');
    expect(sms).toMatchObject({ status: 'blocked', reason: 'platform_sms_paused' });
  });

  it('the operator’s own lever is reported FIRST, above a revoked consent in the same fixture', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    const revoked = await app!.inject({
      method: 'POST', url: `/api/v1/consent/${f.consentId}/revoke`, headers: { cookie: ownerCookie },
      payload: { reason: 'staff_manual', note: 'la cliente a demandé' },
    });
    expect(revoked.statusCode, revoked.body).toBe(200);
    // The fixture is real: with no switch on, this is what the gate says.
    const before = await withTenant(appPool, orgId, (c) => sendMessage(c, request(f)));
    expect(before).toMatchObject({ kind: 'blocked', reason: 'consent_revoked' });

    expect((await flip('sms_send_killswitch', { enabled: true, reason: WHY })).statusCode).toBe(200);
    // MUTATION: move the two new checks below the consent chain and this goes
    // red — an operator who stopped everything must be told THAT, not sent to
    // fix a consent record they cannot fix.
    const after = await withTenant(appPool, orgId, (c) => sendMessage(c, request(f)));
    expect(after).toMatchObject({ kind: 'blocked', reason: 'platform_sms_paused' });
  });

  it('the console preview does not lie: the screen and the send give the same reason', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const lead = await leadFixture();
    expect((await flip('ai_outbound_killswitch', { enabled: true, reason: WHY })).statusCode).toBe(200);
    // MUTATION: restore `platformAiPaused: false` in the preview's facts
    // literal and this goes red — that hardcoding is exactly what
    // `aiSendsSuspended: false` still does one line above it.
    const preview = await app!.inject({
      method: 'GET', url: `/api/v1/leads/${lead.leadId}/compliance?originator=ai&message_class=follow_up`,
      headers: { cookie: ownerCookie },
    });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(JSON.parse(preview.body)).toMatchObject({ status: 'blocked', reason: 'platform_ai_paused' });

    const conversationId = await withTenant(appPool, orgId, async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO conversations (organization_id, store_id, phone_e164, lead_id) VALUES ($1,$2,$3,$4) RETURNING id`,
        [orgId, storeId, lead.phone, lead.leadId],
      );
      return r.rows[0]!.id;
    });
    const out = await withTenant(appPool, orgId, (c) =>
      sendMessage(c, request({ phone: lead.phone, conversationId }, { leadId: lead.leadId, messageClass: 'follow_up' })),
    );
    expect(out).toMatchObject({ kind: 'blocked', reason: 'platform_ai_paused' });
  });
});

describe('reading the switch (the three properties of platform-settings.ts)', () => {
  it('the TTL is the contract and it is bounded', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const t0 = 1_000_000;
    expect((await killSwitches(appPool, () => t0)).sms_send_killswitch).toBe(false);
    // Flipped by ANOTHER process: the route resets its own snapshot, which is
    // the one thing the TTL does not promise for everybody else.
    await flipOutOfProcess('sms_send_killswitch', true);
    // MUTATION: return `snapshot.value` unconditionally and the last line goes
    // red — the propagation bound would then be "never".
    expect((await killSwitches(appPool, () => t0 + 1)).sms_send_killswitch).toBe(false);
    expect((await killSwitches(appPool, () => t0 + KILL_SWITCH_TTL_MS + 1)).sms_send_killswitch).toBe(true);
  });

  it('a burst after expiry issues ONE query', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const q = countingQueryable(appPool);
    // MUTATION: delete the `inFlight` coalescing and this is 20 — a burst of
    // sends the moment the TTL lapses would each open their own read.
    const all = await Promise.all(Array.from({ length: 20 }, () => killSwitches(q)));
    expect(q.calls).toBe(1);
    expect(all.every((s) => s.sms_send_killswitch === false)).toBe(true);
  });

  it('a read already in flight when the switch is flipped cannot install its stale answer', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // READ COMMITTED, modelled honestly: the SELECT sees the switches as they
    // were when the statement began, and lands after the flip has committed.
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let live = false;
    const rowsOf = (enabled: boolean) => PLATFORM_SETTING_KEYS.map((k) => ({ setting_key: k, enabled }));
    const preFlip: Queryable = {
      async query<R extends Record<string, unknown>>(): Promise<{ rows: R[] }> {
        const seen = live;
        await gate;
        return { rows: rowsOf(seen) as unknown as R[] };
      },
    };
    const postFlip = {
      calls: 0,
      async query<R extends Record<string, unknown>>(): Promise<{ rows: R[] }> {
        postFlip.calls += 1;
        return { rows: rowsOf(true) as unknown as R[] };
      },
    };

    const started = killSwitches(preFlip); // a send takes a cache miss…
    live = true;                           // …the operator's stop commits…
    resetKillSwitchCache();                // …and the flip route drops the snapshot.
    release();
    // The reader that asked keeps the answer its own query returned.
    expect((await started).sms_send_killswitch).toBe(false);

    // MUTATION: delete the generation guard from platform-settings.ts and both
    // lines go red — the pre-flip read reinstalls itself with a POST-reset
    // timestamp, so the next caller never reaches the database and the
    // flipping process keeps authorizing sends for a whole KILL_SWITCH_TTL_MS
    // after the super admin's stop was accepted.
    const after = await killSwitches(postFlip);
    expect(postFlip.calls).toBe(1);
    expect(after.sms_send_killswitch).toBe(true);
  });

  it('a failed read propagates and does not wedge the process', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const broken: Queryable = { query: async () => { throw new Error('the database is gone'); } };
    // No catch, no default-false: a switch we cannot read is a switch we must
    // not guess at, so the send that asked cannot commit.
    await expect(killSwitches(broken)).rejects.toThrow('the database is gone');
    // MUTATION: clear `inFlight` after the `await` instead of in a `finally`
    // and this goes red — every later call would reject forever, which under
    // fail-closed means nothing can be sent again until a restart.
    await expect(killSwitches(appPool)).resolves.toMatchObject({ sms_send_killswitch: false, ai_outbound_killswitch: false });
  });

  it('a missing settings row reads as ON', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await admin.query(`DELETE FROM platform_settings WHERE setting_key = 'sms_send_killswitch'`);
    try {
      resetKillSwitchCache();
      const f = await fixture();
      // MUTATION: `?? false` instead of `?? true` and this goes red. Absence
      // can only mean tampering — the rows are seeded and the app role holds
      // no DELETE — and the safe answer to tampering is "stop".
      const out = await withTenant(appPool, orgId, (c) => sendMessage(c, request(f)));
      expect(out).toMatchObject({ kind: 'blocked', reason: 'platform_sms_paused' });
      expect(await messageCount(f.conversationId)).toBe(0);
    } finally {
      await admin.query(`INSERT INTO platform_settings (setting_key) VALUES ('sms_send_killswitch')`);
      resetKillSwitchCache();
    }
  });

  it('the app role can read the switches and cannot flip one', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // MUTATION: add `GRANT UPDATE ON platform_settings TO dealpilot_app` to
    // 0068 and this goes red — the send path reads this table on every miss,
    // so the grant is the whole boundary.
    await expect(
      withTenant(appPool, orgId, (c) => c.query(`UPDATE platform_settings SET enabled = true`)),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      withTenant(appPool, orgId, (c) => c.query(`DELETE FROM platform_settings`)),
    ).rejects.toMatchObject({ code: '42501' });
    const readable = await withTenant(appPool, orgId, (c) => c.query(`SELECT setting_key FROM platform_settings`));
    expect(readable.rows).toHaveLength(PLATFORM_SETTING_KEYS.length);
  });

  it('the console never reads the cache', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Warm the reader, then flip the way another process would.
    expect((await killSwitches(appPool)).sms_send_killswitch).toBe(false);
    await flipOutOfProcess('sms_send_killswitch', true);
    // MUTATION: point the admin GET at `killSwitches()` and this goes red —
    // a staffer who just flipped a switch would be shown the old picture.
    const list = PlatformSettingList.parse(JSON.parse((await settings()).body));
    expect(list.items.find((s) => s.setting_key === 'sms_send_killswitch')).toMatchObject({ enabled: true, reason: WHY });
    // …and the send path is still inside its TTL, which is the honest contract.
    expect((await killSwitches(appPool)).sms_send_killswitch).toBe(false);
  });
});

describe('the belt at deliverMessage (§5.3)', () => {
  /** Stage a real committed message, with the switches off. */
  async function staged(senderType: OutboundRequest['senderType']): Promise<{ messageId: string; phone: string }> {
    const f = await fixture();
    const out = await withTenant(appPool, orgId, (c) =>
      sendMessage(c, request(f, { senderType, messageClass: senderType === 'drip' ? 'drip' : 'follow_up' })),
    );
    expect(out.kind, JSON.stringify(out)).toBe('sent');
    if (out.kind !== 'sent') throw new Error('unreachable');
    return { messageId: out.messageId, phone: f.phone };
  }

  async function carrierErrorOf(messageId: string): Promise<string | null> {
    return (await admin.query<{ carrier_error: string | null }>(
      `SELECT carrier_error FROM messages WHERE id = $1`, [messageId],
    )).rows[0]!.carrier_error;
  }

  it('refuses under EITHER switch, and lets a person’s message through under the AI one', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const bot = await staged('bot');
    const agent = await staged('agent');
    const drip = await staged('drip');

    // The SMS switch stops everything on the wire, whoever wrote it.
    await flipOutOfProcess('sms_send_killswitch', true);
    resetKillSwitchCache();
    const c1 = countingCarrier();
    // MUTATION: delete the belt and this goes red — this is the ONLY thing
    // between the carrier and a path that never passed `evaluateSend`.
    const smsPaused = await deliverMessage(appPool, c1, env, {
      organizationId: orgId, messageId: bot.messageId, to: bot.phone, from: '+15145550000', body: 'Bonjour',
    });
    expect(smsPaused).toMatchObject({ kind: 'rejected', code: 'platform_paused', retryable: true });
    expect(c1.sends).toHaveLength(0);
    expect(await carrierErrorOf(bot.messageId)).toBe('platform_paused: sms_send_killswitch');

    // The AI switch stops the machine's messages and only those.
    await flipOutOfProcess('sms_send_killswitch', false);
    await flipOutOfProcess('ai_outbound_killswitch', true);
    resetKillSwitchCache();
    const c2 = countingCarrier();
    const aiPaused = await deliverMessage(appPool, c2, env, {
      organizationId: orgId, messageId: drip.messageId, to: drip.phone, from: '+15145550000', body: 'Bonjour',
    });
    expect(aiPaused).toMatchObject({ kind: 'rejected', code: 'platform_paused' });
    expect(c2.sends).toHaveLength(0);
    expect(await carrierErrorOf(drip.messageId)).toBe('platform_paused: ai_outbound_killswitch');

    // MUTATION: drop the `sender_type` predicate and this half goes red — the
    // AI switch would silently stop the dealership's own advisors.
    const c3 = countingCarrier();
    const human = await deliverMessage(appPool, c3, env, {
      organizationId: orgId, messageId: agent.messageId, to: agent.phone, from: '+15145550000', body: 'Bonjour',
    });
    expect(human.kind).toBe('accepted');
    expect(c3.sends).toHaveLength(1);
    expect(await carrierErrorOf(agent.messageId)).toBeNull();
  });

  it('covers the redelivery path: a staged drip whose carrier call never concluded is not resent while the AI switch is on', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const drip = await staged('drip');
    // What a crashed delivery leaves behind: a committed row, no provider_ref,
    // no carrier_error (f30-deliver.ts's documented in-flight state). The
    // worker's recovery pass calls `deliverMessage` directly, with no fresh
    // `evaluateSend` behind it — which is the whole reason the belt exists.
    await admin.query(`UPDATE messages SET provider_ref = NULL, carrier_error = NULL WHERE id = $1`, [drip.messageId]);
    await flipOutOfProcess('ai_outbound_killswitch', true);
    resetKillSwitchCache();
    const carrier = countingCarrier();
    // MUTATION: remove the AI half of the belt and this goes red.
    const out = await deliverMessage(appPool, carrier, env, {
      organizationId: orgId, messageId: drip.messageId, to: drip.phone, from: '+15145550000', body: 'Bonjour',
    });
    expect(out).toMatchObject({ kind: 'rejected', code: 'platform_paused', retryable: true });
    expect(carrier.sends).toHaveLength(0);
    expect(await carrierErrorOf(drip.messageId)).toBe('platform_paused: ai_outbound_killswitch');
  });
});

describe('the register (§12) and the incident it is flipped during', () => {
  it('one settings.flipped row, naming the staffer and the change, and it cannot be rewritten', async (ctx) => {
    if (!dbUp) return ctx.skip();
    expect((await flip('ai_outbound_killswitch', { enabled: true, reason: WHY })).statusCode).toBe(200);
    const rows = await admin.query<{ id: string; actor_user_id: string; actor_type: string; target_user_id: string | null; changes: Record<string, unknown>; reason: string | null }>(
      `SELECT id, actor_user_id, actor_type, target_user_id, changes, reason
       FROM platform_audit_events WHERE event = 'settings.flipped' ORDER BY seq DESC LIMIT 1`,
    );
    expect(rows.rows).toHaveLength(1);
    const row = rows.rows[0]!;
    expect(row).toMatchObject({ actor_user_id: superId, actor_type: 'platform', target_user_id: null, reason: WHY });
    expect(row.changes).toMatchObject({ setting_key: 'ai_outbound_killswitch', enabled: { from: false, to: true } });

    await expect(
      admin.query(`UPDATE platform_audit_events SET reason = 'rewritten' WHERE id = $1`, [row.id]),
    ).rejects.toMatchObject({ code: 'PA000' });
    await expect(
      admin.query(`DELETE FROM platform_audit_events WHERE id = $1`, [row.id]),
    ).rejects.toMatchObject({ code: 'PA000' });
  });

  it('a live support session does not block the switch, and the audit row names the STAFFER', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const opened = await app!.inject({
      method: 'POST', url: '/api/v1/admin/impersonation-sessions', headers: { cookie: superCookie },
      payload: { tenant_id: orgId, target_user_id: colleagueId, mode: 'read_only', reason: 'Ticket SUP-9001: the assistant is answering nonsense' },
    });
    expect(opened.statusCode, opened.body).toBe(201);
    const sessionId = (JSON.parse(opened.body) as { id: string }).id;
    try {
      // MUTATION: remove the two ADMIN_ALLOWED_DURING entries — or write the
      // second as `:key` instead of `:setting_key` — and both of these go red.
      // A kill switch with a prerequisite is not a kill switch.
      expect((await settings()).statusCode).toBe(200);
      const flipped = await flip('sms_send_killswitch', { enabled: true, reason: WHY });
      expect(flipped.statusCode, flipped.body).toBe(200);
      const row = (await admin.query<{ actor_user_id: string }>(
        `SELECT actor_user_id FROM platform_audit_events WHERE event = 'settings.flipped' ORDER BY seq DESC LIMIT 1`,
      )).rows[0]!;
      expect(row.actor_user_id).toBe(superId);
      expect(row.actor_user_id).not.toBe(colleagueId);

      // Publishing to customers has no comparable urgency: the exemption is
      // exactly two routes wide.
      const published = await app!.inject({
        method: 'POST', url: '/api/v1/admin/announcements', headers: { cookie: superCookie },
        payload: {
          severity: 'info', title_en: 'Hello', title_fr: 'Bonjour',
          body_en: 'Something', body_fr: 'Quelque chose', audience: { type: 'all' },
        },
      });
      expect(published.statusCode, published.body).toBe(409);
      expect(JSON.parse(published.body)).toMatchObject({ error: { code: 'impersonation_active' } });
    } finally {
      await app!.inject({ method: 'DELETE', url: `/api/v1/admin/impersonation-sessions/${sessionId}`, headers: { cookie: superCookie } });
    }
  });
});
