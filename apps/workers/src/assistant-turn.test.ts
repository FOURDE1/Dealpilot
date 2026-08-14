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

function deps(model: ModelClient): AssistantTurnDeps {
  return {
    pool: appPool,
    model,
    carrier: createCarrier(loadEnv({}), { info: () => {}, warn: () => {} }),
    env: loadEnv({}),
    now: () => NOW,
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
        evidence: { note: 'seeded for the assistant test' },
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
