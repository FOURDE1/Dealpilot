import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, withTenant, type Pool,
} from '@dealpilot/db';
import type { QaJudgeClient, QaVerdictT } from '@dealpilot/ai';
import { buildApp } from '@dealpilot/api/app';
import { recordInbound } from '@dealpilot/api/send';
import { runQaReview } from './qa-review.js';

/**
 * F-64 — the nightly judge. The model is canned; under test is the RUN:
 * only closed conversations are judged, exactly once, with §9's cap and
 * flags applied in code, the HIGH bell on a compliance fail, and the
 * weekly floor's MEDIUM at most once a day.
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
let ownerId = '';

const CLEAN: QaVerdictT = {
  scores: { compliance: 5, grounding: 4, data_capture: 4, craft: 4, language: 5, handoff: 4 },
  flags: [],
  notes: 'Solide du début à la fin; transfert au bon moment.',
};
const VIOLATION: QaVerdictT = {
  scores: { compliance: 1, grounding: 4, data_capture: 4, craft: 4, language: 5, handoff: 4 },
  flags: ['pricing quoted in second message'],
  notes: 'Un taux mensuel a été cité — interdit.',
};

function canned(verdict: QaVerdictT): QaJudgeClient & { calls: () => number } {
  let n = 0;
  return {
    judge: () => {
      n += 1;
      return Promise.resolve({ raw: verdict, inputTokens: 20, outputTokens: 12 });
    },
    calls: () => n,
  };
}

let phoneSeq = 9500;
async function closedConversation(): Promise<string> {
  phoneSeq += 1;
  const phone = `+1514555${phoneSeq}`;
  return withTenant(appPool, orgId, async (c) => {
    const conv = await c.query<{ id: string }>(
      `INSERT INTO conversations (organization_id, store_id, phone_e164, status, closed_at)
       VALUES ($1,$2,$3,'closed', now() - interval '2 hours') RETURNING id`,
      [orgId, storeId, phone],
    );
    await recordInbound(c, {
      organizationId: orgId, conversationId: conv.rows[0]!.id,
      body: 'Bonjour, le Sportage est-il disponible?', providerRef: `SM-${run}-${phoneSeq}`,
    });
    return conv.rows[0]!.id;
  });
}

const deps = (judge: QaJudgeClient) => ({ pool: appPool, judge, model: 'canned-judge' });

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
    payload: { email: `f64-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Juge Nocturne' },
  });
  const sc = su.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe F64', slug: `groupe-f64-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Jugement', code: `F64`, province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;
  ownerId = (
    await admin.query<{ user_id: string }>(
      `SELECT user_id FROM memberships WHERE organization_id = $1 LIMIT 1`, [orgId],
    )
  ).rows[0]!.user_id;
});

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await admin?.end();
});

describe('nightly QA judge (F-64, §9)', () => {
  it('judges a closed conversation ONCE — the replay costs no second model call', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const convId = await closedConversation();
    const judge = canned(CLEAN);
    const first = await runQaReview(deps(judge));
    expect(first.reviewed, JSON.stringify(first)).toBeGreaterThan(0);

    const row = await admin.query<{ overall: string; flags: string[]; model: string; input_tokens: number }>(
      `SELECT overall::text AS overall, flags, model, input_tokens
       FROM conversation_qa_reviews WHERE conversation_id = $1`,
      [convId],
    );
    expect(row.rows).toHaveLength(1);
    // 5*.25+4*.2+4*.2+4*.15+5*.1+4*.1 = 4.35
    expect(row.rows[0]).toMatchObject({ overall: '4.35', flags: [], model: 'canned-judge', input_tokens: 20 });

    const callsBefore = judge.calls();
    const second = await runQaReview(deps(judge));
    expect(judge.calls()).toBe(callsBefore);
    expect(second.scanned).toBe(0);
  });

  it('a compliance fail caps the overall at 1.00, flags it, and rings the HIGH bell', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const convId = await closedConversation();
    const summary = await runQaReview(deps(canned(VIOLATION)));
    expect(summary.complianceFlags, JSON.stringify(summary)).toBe(1);

    const row = await admin.query<{ overall: string; flags: string[] }>(
      `SELECT overall::text AS overall, flags FROM conversation_qa_reviews WHERE conversation_id = $1`,
      [convId],
    );
    expect(row.rows[0]!.overall).toBe('1.00');
    expect(row.rows[0]!.flags).toContain('compliance');
    expect(row.rows[0]!.flags).toContain('pricing quoted in second message');

    const bell = await admin.query(
      `SELECT 1 FROM notifications
       WHERE user_id = $1 AND title_key = 'notif_qa_compliance_flag' AND entity_id = $2`,
      [ownerId, convId],
    );
    expect(bell.rows).toHaveLength(1);
  });

  it('an OPEN conversation is not judged — closed means closed', async (ctx) => {
    if (!dbUp) return ctx.skip();
    phoneSeq += 1;
    await withTenant(appPool, orgId, async (c) => {
      const conv = await c.query<{ id: string }>(
        `INSERT INTO conversations (organization_id, store_id, phone_e164)
         VALUES ($1,$2,$3) RETURNING id`,
        [orgId, storeId, `+1514555${phoneSeq}`],
      );
      await recordInbound(c, {
        organizationId: orgId, conversationId: conv.rows[0]!.id,
        body: 'Allo?', providerRef: `SM-${run}-open`,
      });
    });
    const summary = await runQaReview(deps(canned(CLEAN)));
    expect(summary.scanned).toBe(0);
  });

  it('a 7-day average under the floor raises ONE MEDIUM a day, not one per run', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Enough weak reviews to make the floor statistically real (n >= 5):
    // three exist (4.35, 1.00 from above); add cold ones via fresh closed
    // conversations judged with a weak verdict.
    const weak: QaVerdictT = {
      scores: { compliance: 5, grounding: 2, data_capture: 2, craft: 2, language: 3, handoff: 2 },
      flags: [], notes: 'Faible sur toute la ligne.',
    };
    for (let i = 0; i < 4; i++) await closedConversation();
    const first = await runQaReview(deps(canned(weak)));
    expect(first.lowAverageAlerts, JSON.stringify(first)).toBe(1);

    // Another run the same night: a new conversation, but no second bell.
    await closedConversation();
    const second = await runQaReview(deps(canned(weak)));
    expect(second.lowAverageAlerts).toBe(0);
    const bells = await admin.query(
      `SELECT 1 FROM notifications WHERE user_id = $1 AND title_key = 'notif_qa_weekly_low'`,
      [ownerId],
    );
    expect(bells.rows).toHaveLength(1);
  });
});
