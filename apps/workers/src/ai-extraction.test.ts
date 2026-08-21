import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, withTenant, type Pool,
} from '@dealpilot/db';
import type { ExtractionClient, LeadExtractionT } from '@dealpilot/ai';
import { buildApp } from '@dealpilot/api/app';
import { recordInbound } from '@dealpilot/api/send';
import { runAiExtraction } from './ai-extraction.js';

/**
 * F-57 — the data pass. The extractor is a canned object; what is under test
 * is the WORKER: that it reads the real thread, snapshots verbatim, patches
 * the lead through the allow-list, and never blanks a known value.
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

const EMPTY: LeadExtractionT = {
  budget: { monthly_budget_cents: null, down_payment_cents: null, budget_type: null },
  vehicle: { type: null, make: null, model: null, year_min: null, new_or_used: null },
  trade_in: { has_trade_in: null, year: null, make: null, model: null, mileage_km: null, has_lien: null, condition: null },
  timeline: 'unknown',
  credit_band: 'unknown',
  language: null,
  contact: { first_name: null, last_name: null, email: null },
  consent_signals: { requested_call: false, said_stop: false, gave_express_consent: false },
  conversation_flags: { wants_human: false, high_intent: false, cannot_answer: false, sentiment: 'neutral' },
};

function canned(raw: unknown): ExtractionClient {
  return { extract: () => Promise.resolve({ raw, inputTokens: 12, outputTokens: 7 }) };
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
    payload: { email: `f57-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Extra Trice' },
  });
  const sc = su.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe F57', slug: `groupe-f57-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Extraction', code: `F57-${run.slice(-4)}`, province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;
  const lead = await app!.inject({
    method: 'POST', url: '/api/v1/leads', headers: { cookie },
    payload: {
      organization_id: orgId, store_id: storeId, source: 'website',
      first_name: 'Chantal', last_name: 'Girard', phone: '+15145559101',
      vehicle_interest: 'Kia Sorento',
    },
  });
  leadId = (JSON.parse(lead.body) as { id: string }).id;

  conversationId = await withTenant(appPool, orgId, async (c) => {
    const r = await c.query<{ id: string }>(
      `INSERT INTO conversations (organization_id, store_id, lead_id, phone_e164)
       VALUES ($1,$2,$3,'+15145559101') RETURNING id`,
      [orgId, storeId, leadId],
    );
    return r.rows[0]!.id;
  });
  messageId = await withTenant(appPool, orgId, (c) =>
    recordInbound(c, {
      organizationId: orgId, conversationId,
      body: 'Je cherche un Sorento 2023, environ 450$/mois, j’ai un Civic 2019 à échanger',
      providerRef: `SM-${run}-x1`,
    }),
  );
});

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await admin?.end();
});

const job = () => ({ organization_id: orgId, conversation_id: conversationId, message_id: messageId });

describe('ai-extraction worker (F-57, §5)', () => {
  it('with no extractor configured, the job is a recorded skip — never a silent drain', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const out = await runAiExtraction({ pool: appPool, extractor: null, model: 'off' }, job());
    expect(out.kind).toBe('skipped');
  });

  it('a valid extraction is snapshotted verbatim and patched onto the lead through the allow-list', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const extraction: LeadExtractionT = {
      ...EMPTY,
      budget: { monthly_budget_cents: 45000, down_payment_cents: null, budget_type: 'monthly' },
      vehicle: { type: 'SUV', make: 'Kia', model: 'Sorento', year_min: 2023, new_or_used: 'used' },
      trade_in: { has_trade_in: true, year: 2019, make: 'Honda', model: 'Civic', mileage_km: null, has_lien: null, condition: null },
      timeline: 'this_month',
      credit_band: 'near_prime',
    };
    const out = await runAiExtraction(
      { pool: appPool, extractor: canned(extraction), model: 'test-model' }, job(),
    );
    if (out.kind !== 'written') throw new Error(`expected written, got ${out.kind}`);
    expect(out.patched).toContain('purchase_timeline');

    const lead = await admin.query<Record<string, unknown>>(
      `SELECT monthly_budget_cents, vehicle_interest, trade_in_status, trade_in_year,
              trade_in_make, purchase_timeline, credit_band
       FROM leads WHERE id = $1`, [leadId],
    );
    expect(lead.rows[0]).toMatchObject({
      monthly_budget_cents: 45000,
      vehicle_interest: '2023 Kia Sorento',
      trade_in_status: 'has_trade',
      trade_in_year: 2019,
      trade_in_make: 'Honda',
      purchase_timeline: 'this_month',
      credit_band: 'near_prime',
    });
    const snap = await admin.query<{ model: string; payload: LeadExtractionT }>(
      `SELECT model, payload FROM lead_extractions WHERE lead_id = $1`, [leadId],
    );
    expect(snap.rows).toHaveLength(1);
    expect(snap.rows[0]!.model).toBe('test-model');
    expect(snap.rows[0]!.payload.timeline).toBe('this_month');
  });

  it('a later all-null run blanks NOTHING, and the same message never snapshots twice (retry idempotency)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const out = await runAiExtraction({ pool: appPool, extractor: canned(EMPTY), model: 'test-model' }, job());
    if (out.kind !== 'written') throw new Error(`expected written, got ${out.kind}`);
    expect(out.patched).toEqual([]);
    const lead = await admin.query<{ purchase_timeline: string }>(
      `SELECT purchase_timeline FROM leads WHERE id = $1`, [leadId],
    );
    expect(lead.rows[0]!.purchase_timeline).toBe('this_month');
    const snaps = await admin.query(
      `SELECT count(*)::int AS n FROM lead_extractions WHERE message_id = $1`, [messageId],
    );
    expect(snaps.rows[0]).toEqual({ n: 1 });
  });

  it('off-schema output is snapshotted VERBATIM (the regression corpus) and writes nothing', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const msg2 = await withTenant(appPool, orgId, (c) =>
      recordInbound(c, {
        organizationId: orgId, conversationId,
        body: 'des chiffres bizarres', providerRef: `SM-${run}-x2`,
      }),
    );
    const out = await runAiExtraction(
      { pool: appPool, extractor: canned({ garbage: 1 }), model: 'test-model' },
      { organization_id: orgId, conversation_id: conversationId, message_id: msg2 },
    );
    expect(out.kind).toBe('invalid_snapshotted');
    const snap = await admin.query<{ payload: unknown; input_tokens: number }>(
      `SELECT payload, input_tokens FROM lead_extractions WHERE message_id = $1`, [msg2],
    );
    expect(snap.rows).toHaveLength(1);
    expect(snap.rows[0]!.payload).toEqual({ garbage: 1 });
    expect(snap.rows[0]!.input_tokens).toBe(12);
  });

  it('a THROWING extractor propagates so BullMQ retries fire — never a silent completion', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await expect(
      runAiExtraction(
        { pool: appPool, extractor: { extract: () => Promise.reject(new Error('529 overloaded')) }, model: 'test-model' },
        job(),
      ),
    ).rejects.toThrow('529 overloaded');
  });
});
