import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, withTenant, type Pool,
} from '@dealpilot/db';
import type { AnalysisClient, LiveAnalysisT } from '@dealpilot/ai';
import type { Emitter, RealtimeEventT, RoomDescriptor } from '@dealpilot/contracts';
import { buildApp } from '@dealpilot/api/app';
import { recordInbound } from '@dealpilot/api/send';
import { runLiveAnalysisJob } from './live-analysis.js';

/**
 * F-62 — silent monitoring. The analyst is a canned object; under test is
 * the WORKER: it runs only on human-held threads, writes ONE 'live_update'
 * row shaped exactly like the table, and nudges the panel only AFTER the
 * row exists — never on invalid output.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations',
);
const run = Date.now().toString(36);

let admin: Pool;
let appPool: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookie = '';
let orgId = '';
let storeId = '';
let leadId = '';
let conversationId = '';
let messageId = '';
let agentUserId = '';

const ANALYSIS: LiveAnalysisT = {
  sentiment: 'positive',
  buying_signals: ['demande les couleurs', 'veut un essai routier'],
  concerns: ['paiement mensuel'],
  suggested_response: 'Je vous propose un essai jeudi ou samedi — lequel vous convient?',
  summary: 'Client engagé après la prise en charge; négocie le paiement.',
  score: 'hot',
  score_reason: 'Demande active de disponibilités.',
};

const emitted: { room: RoomDescriptor; event: RealtimeEventT }[] = [];
const recordingEmitter: Emitter = {
  emit(room, event) {
    emitted.push({ room, event });
  },
};

function canned(raw: unknown): AnalysisClient & { calls: () => number } {
  let n = 0;
  return {
    analyze: () => {
      n += 1;
      return Promise.resolve({ raw, inputTokens: 15, outputTokens: 9 });
    },
    calls: () => n,
  };
}

const job = (messageIdOverride?: string) => ({
  organization_id: orgId,
  conversation_id: conversationId,
  message_id: messageIdOverride ?? messageId,
});

let seq = 0;
async function newInbound(body: string): Promise<string> {
  seq += 1;
  return withTenant(appPool, orgId, (c) =>
    recordInbound(c, { organizationId: orgId, conversationId, body, providerRef: `SM-${run}-x${seq}` }),
  );
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
    payload: { email: `f62-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Ana Lyste' },
  });
  const sc = su.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe F62', slug: `groupe-f62-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Monitoring', code: `F62-${run.slice(-4)}`, province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;
  const lead = await app!.inject({
    method: 'POST', url: '/api/v1/leads', headers: { cookie },
    payload: {
      organization_id: orgId, store_id: storeId, source: 'website',
      first_name: 'Chantal', phone: '+15145559301', vehicle_interest: 'Kia Sportage',
    },
  });
  leadId = (JSON.parse(lead.body) as { id: string }).id;
  agentUserId = (
    await admin.query<{ user_id: string }>(
      `SELECT user_id FROM memberships WHERE organization_id = $1 LIMIT 1`, [orgId],
    )
  ).rows[0]!.user_id;

  // A thread a person took over — the CHECK demands the holder be named.
  conversationId = await withTenant(appPool, orgId, async (c) => {
    const r = await c.query<{ id: string }>(
      `INSERT INTO conversations (organization_id, store_id, lead_id, phone_e164, status, assigned_agent_id)
       VALUES ($1,$2,$3,'+15145559301','agent_active',$4) RETURNING id`,
      [orgId, storeId, leadId, agentUserId],
    );
    return r.rows[0]!.id;
  });
  messageId = await withTenant(appPool, orgId, (c) =>
    recordInbound(c, {
      organizationId: orgId, conversationId,
      body: 'Le Sportage est-il encore disponible? Je peux passer jeudi.',
      providerRef: `SM-${run}-a1`,
    }),
  );
});

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await admin?.end();
});

describe('live-analysis worker (F-62, §10 post-handoff)', () => {
  it('with no analyst configured, the job is a recorded skip — never a silent drain', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const out = await runLiveAnalysisJob({ pool: appPool, analyst: null, emitter: recordingEmitter, model: 'canned-1' }, job());
    expect(out.kind).toBe('skipped');
    expect(emitted).toHaveLength(0);
  });

  it('writes ONE live_update row for a human-held thread, then nudges the panel', async (ctx) => {
    if (!dbUp) return ctx.skip();
    emitted.length = 0;
    const out = await runLiveAnalysisJob(
      { pool: appPool, analyst: canned(ANALYSIS), emitter: recordingEmitter, model: 'canned-1' },
      job(),
    );
    expect(out.kind, JSON.stringify(out)).toBe('written');

    const rows = await admin.query<{
      analysis_type: string; sentiment: string; buying_signals: string[];
      suggested_response: string | null; score: string; lead_id: string | null; store_id: string;
    }>(
      `SELECT analysis_type, sentiment, buying_signals, suggested_response, score, lead_id, store_id
       FROM conversation_analysis WHERE conversation_id = $1`,
      [conversationId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      analysis_type: 'live_update',
      sentiment: 'positive',
      score: 'hot',
      lead_id: leadId,
      store_id: storeId,
    });
    expect(rows.rows[0]!.buying_signals).toEqual(ANALYSIS.buying_signals);

    // §13 metering + idempotency anchor ride the row (0061).
    const meter = await admin.query<{ message_id: string; model: string; input_tokens: number; output_tokens: number }>(
      `SELECT message_id, model, input_tokens, output_tokens
       FROM conversation_analysis WHERE conversation_id = $1`,
      [conversationId],
    );
    expect(meter.rows[0]).toEqual({
      message_id: messageId, model: 'canned-1', input_tokens: 15, output_tokens: 9,
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.room).toEqual({ kind: 'conversation', organizationId: orgId, conversationId });
    expect(emitted[0]!.event).toMatchObject({ type: 'analysis.created', conversation_id: conversationId });
  });

  it('an at-least-once REPLAY spends no second model call and writes no second row', async (ctx) => {
    if (!dbUp) return ctx.skip();
    emitted.length = 0;
    const analyst = canned(ANALYSIS);
    const out = await runLiveAnalysisJob(
      { pool: appPool, analyst, emitter: recordingEmitter, model: 'canned-1' },
      job(),
    );
    expect(out.kind).toBe('skipped');
    expect(analyst.calls()).toBe(0);
    const rows = await admin.query(
      `SELECT 1 FROM conversation_analysis WHERE conversation_id = $1`, [conversationId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(emitted).toHaveLength(0);
  });

  it('off-schema output writes nothing and nudges nobody — the panel keeps the last GOOD row', async (ctx) => {
    if (!dbUp) return ctx.skip();
    emitted.length = 0;
    const mid = await newInbound('Et en rouge?');
    const out = await runLiveAnalysisJob(
      { pool: appPool, analyst: canned({ score: 'volcanic' }), emitter: recordingEmitter, model: 'canned-1' },
      job(mid),
    );
    expect(out.kind).toBe('invalid');
    // The snapshot and its cost ride the job result — the regression
    // material and §13 meter for the invalid case (D-063).
    expect(out).toMatchObject({ raw: { score: 'volcanic' }, inputTokens: 15, outputTokens: 9 });
    const rows = await admin.query(
      `SELECT 1 FROM conversation_analysis WHERE conversation_id = $1`, [conversationId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(emitted).toHaveLength(0);
  });

  it('a STALE job that lost the race to a fresher message declines to overwrite the panel', async (ctx) => {
    if (!dbUp) return ctx.skip();
    emitted.length = 0;
    const older = await newInbound('Je réfléchis encore.');
    const newer = await newInbound('OK pour jeudi 14h!');
    // The fresher judgement lands first (its model call was faster)…
    const fresh = await runLiveAnalysisJob(
      { pool: appPool, analyst: canned(ANALYSIS), emitter: recordingEmitter, model: 'canned-1' },
      job(newer),
    );
    expect(fresh.kind).toBe('written');
    // …then the stalled older job finally returns: it must NOT land on top.
    const stale = await runLiveAnalysisJob(
      { pool: appPool, analyst: canned({ ...ANALYSIS, score: 'cold' }), emitter: recordingEmitter, model: 'canned-1' },
      job(older),
    );
    expect(stale.kind).toBe('skipped');
    const top = await admin.query<{ score: string }>(
      `SELECT score FROM conversation_analysis WHERE conversation_id = $1 ORDER BY seq DESC LIMIT 1`,
      [conversationId],
    );
    expect(top.rows[0]!.score).toBe('hot');
  });

  it('a thread the BOT still holds is skipped — the silent analyst is post-handoff only', async (ctx) => {
    if (!dbUp) return ctx.skip();
    emitted.length = 0;
    await admin.query(
      `UPDATE conversations SET status = 'bot_active', assigned_agent_id = NULL WHERE id = $1`,
      [conversationId],
    );
    const out = await runLiveAnalysisJob(
      { pool: appPool, analyst: canned(ANALYSIS), emitter: recordingEmitter, model: 'canned-1' },
      job(),
    );
    expect(out.kind).toBe('skipped');
    expect(emitted).toHaveLength(0);
    // Back for any later case.
    await admin.query(
      `UPDATE conversations SET status = 'agent_active', assigned_agent_id = $2 WHERE id = $1`,
      [conversationId, agentUserId],
    );
  });
});
