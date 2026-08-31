import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, withTenant, type Pool,
} from '@dealpilot/db';
import type { ModelClient, ModelReply, ModelRequest } from '@dealpilot/ai';
import { buildApp } from '@dealpilot/api/app';
import { createCarrier } from '@dealpilot/api/carrier';
import { loadEnv } from '@dealpilot/api/env';
import { recordInbound } from '@dealpilot/api/send';
import { runAssistantTurn, type AssistantTurnDeps } from './assistant-turn.js';

/**
 * The assistant actually answering somebody (F-34).
 *
 * `runTurn` was written in F-27 and called by nothing until this file's
 * subject existed. A customer could text a dealership, and the system would
 * match keywords, route correctly, file the message perfectly — and never
 * reply. Everything was built except the part where it happens.
 *
 * The model is a scripted fake, deliberately. What is under test is the
 * DISPATCHER: that it reads the real thread, that the reply goes through the
 * compliance gate like anybody else's, and that a suppressed customer gets
 * nothing however cheerful the model was.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations',
);
const run = Date.now().toString(36);
const NOW = new Date('2026-08-13T18:00:00Z');

let admin: Pool;
let appPool: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookie = '';
let orgId = '';
let storeId = '';
let userId = '';

let seq = 900;
function nextPhone(): string {
  seq += 1;
  return `+1514555${String(seq).padStart(4, '0')}`;
}

/** A model that says what the test tells it to, and records what it was asked. */
function fakeModel(replies: string[]): ModelClient & { seen: ModelRequest[] } {
  const seen: ModelRequest[] = [];
  let i = 0;
  return {
    seen,
    async complete(request: ModelRequest): Promise<ModelReply> {
      seen.push(request);
      return {
        text: replies[Math.min(i++, replies.length - 1)] ?? '',
        toolCalls: [],
        inputTokens: 10,
        outputTokens: 5,
      };
    },
  };
}

/** `now` defaults to NOW (a Thursday 14:00 in Montreal); the F-76 clock cases pin their own. */
function deps(model: ModelClient, opts: { now?: Date } = {}): AssistantTurnDeps {
  const now = opts.now ?? NOW;
  return {
    pool: appPool,
    model,
    carrier: createCarrier(loadEnv({}), { info: () => {}, warn: () => {} }),
    env: loadEnv({}),
    now: () => now,
  };
}

async function fixture(opts: { consent?: boolean; storeId?: string } = {}) {
  const phone = nextPhone();
  if (opts.consent !== false) {
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/consent', headers: { cookie },
      payload: {
        organization_id: orgId, phone_e164: phone,
        channels: ['sms'], scopes: ['conversational'],
        consent_type: 'express', source: 'staff_manual',
        evidence: { note: 'seeded for the assistant test' },
      },
    });
    expect(res.statusCode, res.body).toBe(201);
  }
  const conversationId = await withTenant(appPool, orgId, async (c) => {
    const r = await c.query<{ id: string }>(
      `INSERT INTO conversations (organization_id, store_id, phone_e164) VALUES ($1,$2,$3) RETURNING id`,
      [orgId, opts.storeId ?? storeId, phone],
    );
    return r.rows[0]!.id;
  });
  const messageId = await withTenant(appPool, orgId, (c) =>
    recordInbound(c, {
      organizationId: orgId, conversationId,
      body: 'Bonjour, est-ce que le Sorento est encore disponible?',
      providerRef: `SM-${run}-${seq}`,
    }),
  );
  return { phone, conversationId, messageId };
}

async function outbound(conversationId: string) {
  const r = await admin.query<{ body: string; sender_type: string; consent_ledger_id: string | null }>(
    `SELECT body, sender_type, consent_ledger_id FROM messages
     WHERE conversation_id = $1 AND direction = 'outbound'`,
    [conversationId],
  );
  return r.rows;
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

  const email = `f34-${run}@dealpilot.test`;
  const su = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email, password: 'correct-horse-battery-staple', name: 'Sophie' },
  });
  const sc = su.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');

  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe F34', slug: `groupe-f34-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;

  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Rooftop', code: `F34-${run.slice(-4)}`, province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;
  userId = (await admin.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email])).rows[0]!.id;
});

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await admin?.end();
});

describe('a customer who texted', () => {
  it('gets an answer', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();

    const result = await runAssistantTurn(
      deps(fakeModel(['Bonjour! Oui, il est encore disponible. Quand voulez-vous le voir?'])),
      { organization_id: orgId, conversation_id: f.conversationId, message_id: f.messageId, attempt: 0 },
    );
    expect(result.kind).toBe('replied');

    const sent = await outbound(f.conversationId);
    // Before this slice: zero, forever, for every customer who ever texted.
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ sender_type: 'bot' });
  });

  it('has the reply pass the compliance gate like anybody else’s', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    await runAssistantTurn(deps(fakeModel(['Bonjour!'])), {
      organization_id: orgId, conversation_id: f.conversationId, message_id: f.messageId, attempt: 0,
    });

    const sent = await outbound(f.conversationId);
    // The consent id is the proof: it comes from `sendMessage`, which is the
    // one send path. An assistant reply that carried none would mean the
    // dispatcher had found a way around the gate.
    expect(sent[0]!.consent_ledger_id).not.toBeNull();

    const decisions = await admin.query<{ originator: string; status: string }>(
      `SELECT originator, status FROM send_decisions WHERE organization_id = $1 AND phone_e164 = $2`,
      [orgId, f.phone],
    );
    expect(decisions.rows[0]).toMatchObject({ originator: 'ai', status: 'allowed' });
  });

  it('shows the model the thread as the database holds it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    const model = fakeModel(['Bonjour!']);
    await runAssistantTurn(deps(model), {
      organization_id: orgId, conversation_id: f.conversationId, message_id: f.messageId, attempt: 0,
    });

    const request = model.seen[0]!;
    // The customer's words arrive wrapped by `spotlight`, exactly once. A bare
    // copy alongside the wrapped one is the copy a prompt injection would use.
    const userTurns = request.messages.filter((m) => m.role === 'user');
    expect(userTurns).toHaveLength(1);
    expect(userTurns[0]!.content).toContain('Sorento');
    expect(request.tools.length).toBeGreaterThan(0);
  });
});

describe('a customer the gate says not to message', () => {
  it('gets nothing, however cheerful the model was', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    const stop = await app!.inject({
      method: 'POST', url: '/api/v1/suppressions', headers: { cookie },
      payload: {
        organization_id: orgId, phone_e164: f.phone, channel: 'sms',
        source: 'staff_manual', note: 'asked us to stop',
      },
    });
    expect(stop.statusCode, stop.body).toBe(201);

    const result = await runAssistantTurn(deps(fakeModel(['Bonjour!'])), {
      organization_id: orgId, conversation_id: f.conversationId, message_id: f.messageId, attempt: 0,
    });
    expect(result).toMatchObject({ kind: 'not_sent', reason: 'suppressed' });
    expect(await outbound(f.conversationId)).toHaveLength(0);
  });

  it('gets nothing when consent was never given', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture({ consent: false });
    const result = await runAssistantTurn(deps(fakeModel(['Bonjour!'])), {
      organization_id: orgId, conversation_id: f.conversationId, message_id: f.messageId, attempt: 0,
    });
    expect(result).toMatchObject({ kind: 'not_sent' });
    expect(await outbound(f.conversationId)).toHaveLength(0);
  });
});

describe('a draft that breaks the rules', () => {
  it('is replaced by the fallback rather than sent', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    // Twice, because §10 allows one correction. A model that breaks the same
    // rule twice is not going to get it right on the third attempt.
    const result = await runAssistantTurn(
      deps(fakeModel(['Vous êtes approuvé! 24 995 $ à 4,9 %.', 'Toujours approuvé, 24 995 $.'])),
      { organization_id: orgId, conversation_id: f.conversationId, message_id: f.messageId, attempt: 0 },
    );
    expect(result.kind).toBe('fallback');

    const sent = await outbound(f.conversationId);
    expect(sent).toHaveLength(1);
    // The customer gets the safe template, not the price.
    expect(sent[0]!.body).not.toContain('24 995');
    expect(sent[0]!.body).not.toContain('4,9');
  });
});

describe('the six §9 handoff triggers', () => {
  async function qualifiedFixture(opts: { assign?: boolean; budget?: boolean } = {}) {
    const phone = nextPhone();
    const consent = await app!.inject({
      method: 'POST', url: '/api/v1/consent', headers: { cookie },
      payload: {
        organization_id: orgId, phone_e164: phone,
        channels: ['sms'], scopes: ['conversational'],
        consent_type: 'express', source: 'staff_manual',
        evidence: { note: 'handoff test' },
      },
    });
    expect(consent.statusCode, consent.body).toBe(201);
    const lead = await app!.inject({
      method: 'POST', url: '/api/v1/leads', headers: { cookie },
      payload: {
        organization_id: orgId, store_id: storeId, source: 'walk_in',
        first_name: 'Chantal', last_name: 'Handoff', phone,
        vehicle_interest: 'Kia Sorento',
        ...(opts.budget === false ? {} : { monthly_budget_cents: 45000 }),
      },
    });
    expect(lead.statusCode, lead.body).toBe(201);
    const leadId = (JSON.parse(lead.body) as { id: string }).id;
    const patch = await app!.inject({
      method: 'PATCH', url: `/api/v1/leads/${leadId}`, headers: { cookie },
      payload: { trade_in_status: 'none', ...(opts.assign === false ? {} : { assigned_to: userId }) },
    });
    expect(patch.statusCode, patch.body).toBe(200);
    const conversationId = await withTenant(appPool, orgId, async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO conversations (organization_id, store_id, lead_id, phone_e164)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [orgId, storeId, leadId, phone],
      );
      return r.rows[0]!.id;
    });
    const messageId = await withTenant(appPool, orgId, (c) =>
      recordInbound(c, {
        organizationId: orgId, conversationId,
        body: 'Parfait, mon budget est 450$/mois et pas d’échange',
        providerRef: `SM-${run}-h${seq}`,
      }),
    );
    return { leadId, conversationId, messageId, phone };
  }

  it('a fully qualified lead hands off: status, agent, stamps, analysis row and the promise message', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await qualifiedFixture();
    const result = await runAssistantTurn(
      deps(fakeModel(['Merci! Je vous reviens tout de suite.'])),
      { organization_id: orgId, conversation_id: f.conversationId, message_id: f.messageId, attempt: 0 },
    );
    expect(result.kind).toBe('replied');
    if (result.kind !== 'replied') throw new Error('unreachable');
    expect(result.handoff).toEqual({ trigger: 'fields_complete' });

    const conv = await admin.query<{ status: string; assigned_agent_id: string | null; bot_score: string | null; bot_summary: string | null }>(
      `SELECT status, assigned_agent_id, bot_score, bot_summary FROM conversations WHERE id = $1`,
      [f.conversationId],
    );
    expect(conv.rows[0]).toMatchObject({ status: 'handed_off', assigned_agent_id: userId, bot_score: 'hot' });
    // §9: the summary is FOR the agent — it quotes what the customer said,
    // not a trigger token.
    expect(conv.rows[0]!.bot_summary).toContain('mon budget est');

    const lead = await admin.query<{ chatbot_handoff_at: string | null }>(
      `SELECT chatbot_handoff_at FROM leads WHERE id = $1`, [f.leadId],
    );
    expect(lead.rows[0]!.chatbot_handoff_at).not.toBeNull();

    const analysis = await admin.query<{ analysis_type: string; score: string }>(
      `SELECT analysis_type, score FROM conversation_analysis WHERE conversation_id = $1`,
      [f.conversationId],
    );
    expect(analysis.rows).toHaveLength(1);
    expect(analysis.rows[0]).toMatchObject({ analysis_type: 'handoff_summary', score: 'hot' });

    // The reply AND the promise both went out; the promise names the human.
    const sent = await outbound(f.conversationId);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.body).toContain('Sophie');
  });

  it('request_human(safety) from the model hands off IMMEDIATELY — under-qualified or not', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await qualifiedFixture({ budget: false });
    // A model that calls the tool, then answers with care.
    let call = 0;
    const toolModel: ModelClient = {
      complete: () => {
        call += 1;
        return Promise.resolve(
          call === 1
            ? {
                text: '',
                toolCalls: [{ id: 't1', name: 'request_human', input: { reason: 'safety' } }],
                inputTokens: 0, outputTokens: 0,
              }
            : {
                text: 'Je suis vraiment désolé — je vous mets en contact avec une personne immédiatement.',
                toolCalls: [], inputTokens: 0, outputTokens: 0,
              },
        );
      },
    };
    const result = await runAssistantTurn(
      deps(toolModel),
      { organization_id: orgId, conversation_id: f.conversationId, message_id: f.messageId, attempt: 0 },
    );
    if (result.kind !== 'replied') throw new Error(`expected replied, got ${result.kind}`);
    expect(result.handoff).toEqual({ trigger: 'safety' });
    const conv = await admin.query<{ status: string; bot_score: string | null }>(
      `SELECT status, bot_score FROM conversations WHERE id = $1`, [f.conversationId],
    );
    expect(conv.rows[0]).toMatchObject({ status: 'handed_off', bot_score: 'cold' });
  });

  it('an under-qualified lead does NOT hand off', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await qualifiedFixture({ budget: false });
    const result = await runAssistantTurn(
      deps(fakeModel(['Et quel serait votre budget mensuel?'])),
      { organization_id: orgId, conversation_id: f.conversationId, message_id: f.messageId, attempt: 0 },
    );
    if (result.kind !== 'replied') throw new Error(`expected replied, got ${result.kind}`);
    expect(result.handoff).toBeUndefined();
    const conv = await admin.query<{ status: string }>(
      `SELECT status FROM conversations WHERE id = $1`, [f.conversationId],
    );
    expect(conv.rows[0]!.status).toBe('bot_active');
  });

  it('a qualified lead with NOBODY to take it stays with the bot, reason recorded', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await qualifiedFixture({ assign: false });
    const result = await runAssistantTurn(
      deps(fakeModel(['Un instant!'])),
      { organization_id: orgId, conversation_id: f.conversationId, message_id: f.messageId, attempt: 0 },
    );
    if (result.kind !== 'replied') throw new Error(`expected replied, got ${result.kind}`);
    expect(result.handoff).toMatchObject({ skipped: expect.stringContaining('no agent available') });
    const conv = await admin.query<{ status: string }>(
      `SELECT status FROM conversations WHERE id = $1`, [f.conversationId],
    );
    expect(conv.rows[0]!.status).toBe('bot_active');
  });

  it('the turn cap fires at 15 bot messages (backdated so the daily cap is not the thing tested)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await qualifiedFixture({ budget: false });
    // Outbound rows must carry their consent basis (0031 CHECK) — reuse the
    // fixture's express grant for this phone.
    await admin.query(
      `INSERT INTO messages (organization_id, conversation_id, direction, sender_type, body, consent_ledger_id, created_at)
       SELECT $1, $2, 'outbound', 'bot', 'ancien message ' || g,
              (SELECT id FROM consent_ledger WHERE phone_e164 = $3 AND organization_id = $1 LIMIT 1),
              now() - interval '3 days' + (g || ' minutes')::interval
       FROM generate_series(1, 14) g`,
      [orgId, f.conversationId, f.phone],
    );
    const result = await runAssistantTurn(
      deps(fakeModel(['Je vous mets en contact avec un conseiller.'])),
      { organization_id: orgId, conversation_id: f.conversationId, message_id: f.messageId, attempt: 0 },
    );
    if (result.kind !== 'replied') throw new Error(`expected replied, got ${result.kind}`);
    expect(result.handoff).toEqual({ trigger: 'turn_cap' });
  });
});

describe('a conversation a person has taken', () => {
  it('is left alone', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    // The agent id is required by 0031's CHECK: a conversation somebody has
    // taken must say who has it, or "handed off" means nobody in particular.
    await admin.query(
      `UPDATE conversations SET status = 'agent_active', assigned_agent_id = $2 WHERE id = $1`,
      [f.conversationId, userId],
    );

    const model = fakeModel(['Bonjour!']);
    const result = await runAssistantTurn(deps(model), {
      organization_id: orgId, conversation_id: f.conversationId, message_id: f.messageId, attempt: 0,
    });
    // §9's silent monitoring. The gate would refuse anyway; skipping before the
    // model call saves the money and keeps the logs honest about what happened.
    expect(result).toMatchObject({ kind: 'skipped' });
    expect(model.seen).toHaveLength(0);
    expect(await outbound(f.conversationId)).toHaveLength(0);
  });
});

describe('the store clock and the tenant cap in the prompt (F-76)', () => {
  // Tuesday 2026-09-01 in America/Montreal (the store default; EDT, UTC-4):
  // 03:00 local is 07:00Z, 14:00 local is 18:00Z.
  const TUE_0300 = new Date('2026-09-01T07:00:00Z');
  const TUE_1400 = new Date('2026-09-01T18:00:00Z');
  const WEEKDAYS = {
    mon: { open: '09:00', close: '18:00' }, tue: { open: '09:00', close: '18:00' },
    wed: { open: '09:00', close: '18:00' }, thu: { open: '09:00', close: '18:00' },
    fri: { open: '09:00', close: '18:00' },
  };
  let hoursStoreId = '';

  /** PATCH the clock store the way the owner's form does. */
  async function patchStore(payload: Record<string, unknown>): Promise<void> {
    const res = await app!.inject({
      method: 'PATCH', url: `/api/v1/stores/${hoursStoreId}`, headers: { cookie }, payload,
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  /** Run one turn at `now` on the clock store and return what the model was told. */
  async function systemText(now: Date): Promise<string> {
    const f = await fixture({ storeId: hoursStoreId });
    const model = fakeModel(['Bonjour!']);
    const result = await runAssistantTurn(deps(model, { now }), {
      organization_id: orgId, conversation_id: f.conversationId, message_id: f.messageId, attempt: 0,
    });
    expect(result.kind).toBe('replied');
    const request = model.seen[0];
    if (!request) throw new Error('the model was never called');
    return request.system.map((b) => b.text).join('\n');
  }

  beforeAll(async () => {
    if (!dbUp) return;
    // Its own store: the other suites' conversations must keep seeing the
    // grid-less default, which is the "open, no Hours line" case below.
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/stores', headers: { cookie },
      payload: { organization_id: orgId, name: 'Rooftop Heures', code: `F76-${run.slice(-4)}`, province: 'QC' },
    });
    expect(res.statusCode, res.body).toBe(201);
    hoursStoreId = (JSON.parse(res.body) as { id: string }).id;
    await patchStore({ business_hours: WEEKDAYS });
  });

  it('at 03:00 the dealership is closed, the follow-up is coarse, the hours line is printed and "Right now" is store-local', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const text = await systemText(TUE_0300);
    expect(text).toContain('The dealership is closed');
    // French conversation (the table default) → the French phrase, no clock
    // time — and at 03:00 on a day with a 09:00 window it is "later today",
    // not "tomorrow morning".
    expect(text).toContain('somebody will follow up plus tard aujourd’hui');
    expect(text).toContain('Hours: Mon–Fri 09:00–18:00, Sat closed, Sun closed');
    expect(text).toMatch(/Right now: .*mardi/);
    expect(text).not.toContain('T07:00:00.000Z');

    // After closing (20:00 local = 00:00Z Wednesday) the promise is tomorrow morning.
    const evening = await systemText(new Date('2026-09-02T00:00:00Z'));
    expect(evening).toContain('The dealership is closed');
    expect(evening).toContain('somebody will follow up demain matin');
    expect(evening).toMatch(/Right now: .*mardi/);
  });

  it('at 14:00 the same day it is open', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const text = await systemText(TUE_1400);
    expect(text).toContain('The dealership is open.');
    expect(text).not.toContain('The dealership is closed');
  });

  it('a holiday today closes it all day', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await patchStore({ holiday_dates: ['2026-09-01'] });
    const text = await systemText(TUE_1400);
    expect(text).toContain('The dealership is closed');
    expect(text).toContain('demain matin');
    await patchStore({ holiday_dates: [] });
  });

  it('an empty grid keeps today’s behaviour: open, and NO Hours line at all', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await patchStore({ business_hours: {} });
    const text = await systemText(TUE_0300);
    // Both halves: the positive claim and the absence. "Not configured" is
    // not "closed", and nothing is printed that the owner never set.
    expect(text).toContain('The dealership is open.');
    expect(text).not.toContain('Hours:');
    await patchStore({ business_hours: WEEKDAYS });
  });

  it('a listed holiday closes a store with NO grid too — what the holidays hint promises', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await patchStore({ business_hours: {}, holiday_dates: ['2026-09-01'] });
    const text = await systemText(TUE_1400);
    expect(text).toContain('The dealership is closed');
    expect(text).not.toContain('The dealership is open.');
    // No grid means no reopening instant: the only honest phrase is the non-committal one.
    expect(text).toContain('somebody will follow up dès la réouverture');
    expect(text).not.toContain('Hours:');

    // The day after the holiday, the same grid-less store is open again, still with no Hours line.
    const after = await systemText(new Date('2026-09-02T18:00:00Z'));
    expect(after).toContain('The dealership is open.');
    expect(after).not.toContain('Hours:');
    await patchStore({ business_hours: WEEKDAYS, holiday_dates: [] });
  });

  it('the turn cap in the prompt is the tenant’s setting: 15 with no row, 8 after the Automations save', async (ctx) => {
    if (!dbUp) return ctx.skip();
    expect(await systemText(TUE_1400)).toContain('Hand over to a person after at most 15 messages');

    const cap = await app!.inject({
      method: 'PUT', url: `/api/v1/organizations/${orgId}/comms-config`, headers: { cookie },
      payload: { bot_turn_cap: 8 },
    });
    expect(cap.statusCode, cap.body).toBe(200);
    expect(await systemText(TUE_1400)).toContain('Hand over to a person after at most 8 messages');

    // Back to the default so the row does not shadow the suites above on a re-run.
    const restore = await app!.inject({
      method: 'PUT', url: `/api/v1/organizations/${orgId}/comms-config`, headers: { cookie },
      payload: { bot_turn_cap: 15 },
    });
    expect(restore.statusCode, restore.body).toBe(200);
  });
});
