import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool,
} from '@dealpilot/db';
import { buildApp } from '@dealpilot/api/app';
import { createCarrier } from '@dealpilot/api/carrier';
import { loadEnv } from '@dealpilot/api/env';
import { runFirstTouch } from './first-touch.js';

/**
 * F-59 — the first touch. The carrier is the log driver (nothing leaves the
 * machine); what is under test is the WORKER: the template with its
 * mandatory parts, the same compliance gate as everybody, the SLA stamps,
 * and that a second job for the same lead is a recorded no-op.
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

const env = loadEnv({ DATABASE_URL: APP_URL, NODE_ENV: 'test' });
const deferrals: { runAt: Date; body: string }[] = [];

/** Noon-ish Eastern, always in the future — the confirmation's re_engagement
 * class rides quiet hours (correctly), so a 3 a.m. CI run must not turn a
 * send assertion into a deferral. */
function safeNow(): Date {
  const t = new Date();
  t.setUTCHours(17, 0, 0, 0);
  if (t.getTime() <= Date.now()) t.setUTCDate(t.getUTCDate() + 1);
  return t;
}

const deps = (carrier = createCarrier(env, { info: () => {}, warn: () => {} })) => ({
  pool: appPool,
  carrier,
  env,
  defer: (job: { body: string }, runAt: Date) => {
    deferrals.push({ runAt, body: job.body });
    return Promise.resolve();
  },
});

async function makeLead(n: number, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await app!.inject({
    method: 'POST', url: '/api/v1/leads', headers: { cookie },
    payload: {
      organization_id: orgId, store_id: storeId, source: 'walk_in',
      first_name: `Premier${n}`, last_name: `Contact${n}`, phone: `+1514555${String(9200 + n)}`,
      vehicle_interest: 'Kia Sorento',
      ...extra,
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  return (JSON.parse(res.body) as { id: string }).id;
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
    payload: { email: `f59-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Première Ligne' },
  });
  const sc = su.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe F59', slug: `groupe-f59-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Kia Mont-Laurier', code: `F59-${run.slice(-4)}`, province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;
  const patch = await app!.inject({
    method: 'PATCH', url: `/api/v1/stores/${storeId}`, headers: { cookie },
    payload: { sms_number: '+18195550000' },
  });
  expect(patch.statusCode, patch.body).toBe(200);
});

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await admin?.end();
});

describe('first touch (F-59, §5/§6)', () => {
  it('sends the templated FR greeting through the full gate and stamps the SLA', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const leadId = await makeLead(1);
    const out = await runFirstTouch(deps(), { organization_id: orgId, lead_id: leadId });
    expect(out.kind, JSON.stringify(out)).toBe('sent');

    const msg = await admin.query<{ body: string; sender_type: string }>(
      `SELECT body, sender_type FROM messages WHERE id = $1`,
      [(out as { messageId: string }).messageId],
    );
    expect(msg.rows[0]!.sender_type).toBe('bot');
    expect(msg.rows[0]!.body).toContain('Premier1');
    expect(msg.rows[0]!.body).toContain('assistant virtuel de Kia Mont-Laurier');
    expect(msg.rows[0]!.body).toContain('ARRÊT');

    const lead = await admin.query<{
      status: string; chatbot_engaged_at: string | null; response_time_seconds: number | null;
    }>(
      `SELECT status, chatbot_engaged_at, response_time_seconds FROM leads WHERE id = $1`,
      [leadId],
    );
    expect(lead.rows[0]!.status).toBe('chatbot_engaged');
    expect(lead.rows[0]!.chatbot_engaged_at).not.toBeNull();
    // The 0036 trigger stamps the speed-to-lead numbers off the message row.
    expect(lead.rows[0]!.response_time_seconds).not.toBeNull();
  });

  it('a second job for the same lead is a recorded no-op — one greeting, ever', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const leadId = await makeLead(2);
    expect((await runFirstTouch(deps(), { organization_id: orgId, lead_id: leadId })).kind).toBe('sent');
    const again = await runFirstTouch(deps(), { organization_id: orgId, lead_id: leadId });
    expect(again.kind).toBe('skipped');
    expect((again as { reason: string }).reason).toBe('already touched');
  });

  it('an English lead gets the EN template with STOP', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const leadId = await makeLead(3, { preferred_language: 'en-CA' });
    const out = await runFirstTouch(deps(), { organization_id: orgId, lead_id: leadId });
    expect(out.kind, JSON.stringify(out)).toBe('sent');
    const msg = await admin.query<{ body: string }>(
      `SELECT body FROM messages WHERE id = $1`, [(out as { messageId: string }).messageId],
    );
    expect(msg.rows[0]!.body).toContain('virtual assistant at Kia Mont-Laurier');
    expect(msg.rows[0]!.body).toContain('(Reply STOP to opt out)');
  });

  it('a duplicate-pair lead gets the confirming variant, not a fresh start', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const original = await makeLead(4);
    void original;
    const twin = await makeLead(5, { phone: '+15145559204' });
    // Same phone as lead 4 → detection paired them at create time.
    const out = await runFirstTouch(deps(), { organization_id: orgId, lead_id: twin });
    expect(out.kind, JSON.stringify(out)).toBe('sent');
    const msg = await admin.query<{ body: string }>(
      `SELECT body FROM messages WHERE id = $1`, [(out as { messageId: string }).messageId],
    );
    expect(msg.rows[0]!.body).toContain('déjà soumis une demande');
  });

  it('the EN greeting LOCKS the conversation language — later turns must not drift to French', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const lang = await admin.query<{ language: string }>(
      `SELECT cv.language FROM conversations cv
       JOIN leads l ON l.phone = cv.phone_e164 AND l.organization_id = cv.organization_id
       WHERE l.first_name = 'Premier3'`,
    );
    expect(lang.rows[0]!.language).toBe('en');
  });

  it('a tenant that turned the quiet-hours exemption OFF gets a DEFERRED greeting, not a dropped one', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // The config row is created lazily — upsert it with the exemption OFF.
    await admin.query(
      `INSERT INTO tenant_comms_config (organization_id, first_touch_quiet_exempt)
       VALUES ($1, false)
       ON CONFLICT (organization_id) WHERE store_id IS NULL AND deleted_at IS NULL
       DO UPDATE SET first_touch_quiet_exempt = false`,
      [orgId],
    );
    try {
      const leadId = await makeLead(7);
      // 06:30 UTC = 01:30 Toronto — deep inside quiet hours.
      const out = await runFirstTouch(
        { ...deps(), now: () => new Date('2026-08-21T06:30:00Z') },
        { organization_id: orgId, lead_id: leadId },
      );
      expect(out.kind, JSON.stringify(out)).toBe('deferred');
      expect(deferrals).toHaveLength(1);
      expect(deferrals[0]!.body).toContain('ARRÊT');
      // Not stamped: the greeting has not gone out.
      const lead = await admin.query<{ chatbot_engaged_at: string | null }>(
        `SELECT chatbot_engaged_at FROM leads WHERE id = $1`, [leadId],
      );
      expect(lead.rows[0]!.chatbot_engaged_at).toBeNull();
    } finally {
      await admin.query(
        `UPDATE tenant_comms_config SET first_touch_quiet_exempt = true
         WHERE organization_id = $1 AND store_id IS NULL`,
        [orgId],
      );
    }
  });

  it('a retryable carrier rejection THROWS, and the retry REDELIVERS the same staged row — one greeting row, stamped only on acceptance', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const leadId = await makeLead(8);
    const failing = {
      kind: 'log' as const,
      deliversToRecipient: false,
      send: () => Promise.resolve({ kind: 'rejected' as const, code: 'network_error', message: 'down', retryable: true }),
      verifyInbound: () => false,
    };
    await expect(
      runFirstTouch(deps(failing), { organization_id: orgId, lead_id: leadId }),
    ).rejects.toThrow('network_error');
    // Staged but unstamped: the row exists, the SLA stamp does not.
    const mid = await admin.query<{ n: number; engaged: string | null }>(
      `SELECT count(m.id)::int AS n, min(l.chatbot_engaged_at::text) AS engaged
       FROM leads l LEFT JOIN conversations cv ON cv.phone_e164 = l.phone AND cv.organization_id = l.organization_id
       LEFT JOIN messages m ON m.conversation_id = cv.id AND m.direction = 'outbound'
       WHERE l.id = $1 GROUP BY l.id`, [leadId],
    );
    expect(mid.rows[0]!.n).toBe(1);
    expect(mid.rows[0]!.engaged).toBeNull();

    // The retry (working carrier) redelivers the SAME row and stamps.
    const out = await runFirstTouch(deps(), { organization_id: orgId, lead_id: leadId });
    expect(out.kind, JSON.stringify(out)).toBe('sent');
    const after = await admin.query<{ n: number; engaged: string | null }>(
      `SELECT count(m.id)::int AS n, min(l.chatbot_engaged_at::text) AS engaged
       FROM leads l LEFT JOIN conversations cv ON cv.phone_e164 = l.phone AND cv.organization_id = l.organization_id
       LEFT JOIN messages m ON m.conversation_id = cv.id AND m.direction = 'outbound'
       WHERE l.id = $1 GROUP BY l.id`, [leadId],
    );
    expect(after.rows[0]!.n).toBe(1);
    expect(after.rows[0]!.engaged).not.toBeNull();
  });

  it("a phone whose live conversation belongs to ANOTHER lead is skipped — no barging into somebody's thread", async (ctx) => {
    if (!dbUp) return ctx.skip();
    const older = await makeLead(9);
    expect((await runFirstTouch(deps(), { organization_id: orgId, lead_id: older })).kind).toBe('sent');
    // A second lead arrives on the SAME phone; the conversation stays the
    // older lead's.
    const newer = await makeLead(10, { phone: `+1514555${String(9200 + 9)}` });
    const out = await runFirstTouch(deps(), { organization_id: orgId, lead_id: newer });
    expect(out.kind).toBe('skipped');
    expect((out as { reason: string }).reason).toContain('another lead');
  });

  it('a suppressed number is not greeted — the gate is the same for the bot', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const leadId = await makeLead(6);
    const phone = `+1514555${String(9200 + 6)}`;
    await admin.query(
      `INSERT INTO suppression_list (organization_id, phone_e164, channel, source)
       VALUES ($1, $2, 'sms', 'stop_keyword')`,
      [orgId, phone],
    );
    const out = await runFirstTouch(deps(), { organization_id: orgId, lead_id: leadId });
    expect(out.kind).toBe('not_sent');
  });

  it('a duplicate-confirmation job messages the KEEPER, as re_engagement, in a thread the KEEPER owns (F-63)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // SAME phone — the only state the §8.3 phone-match gate can produce.
    // The review's blocker hid behind different-phone fixtures: the created
    // conversation attached to the newest lead (the duplicate) and the
    // confirmation refused its own thread.
    const keeperId = await makeLead(40);
    const sourceId = await makeLead(41, { phone: '+15145559240' });
    const out = await runFirstTouch({ ...deps(), now: safeNow }, {
      organization_id: orgId, lead_id: sourceId, duplicate_of: keeperId,
    });
    expect(out.kind, JSON.stringify(out)).toBe('sent');
    if (out.kind !== 'sent') return;

    const msg = await admin.query<{
      lead_id: string | null; message_class: string; body: string; provider_ref: string | null;
    }>(
      `SELECT c.lead_id, d.message_class, m.body, m.provider_ref
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       JOIN send_decisions d ON d.id = m.send_decision_id
       WHERE m.id = $1`,
      [out.messageId],
    );
    expect(msg.rows[0]!.lead_id).toBe(keeperId);
    expect(msg.rows[0]!.message_class).toBe('re_engagement');
    expect(msg.rows[0]!.body).toContain('déjà soumis une demande');
    expect(msg.rows[0]!.provider_ref).not.toBeNull();

    // The submission record is stamped handled — the replay anchor.
    const src = await admin.query<{ chatbot_engaged_at: Date | null }>(
      `SELECT chatbot_engaged_at FROM leads WHERE id = $1`, [sourceId],
    );
    expect(src.rows[0]!.chatbot_engaged_at).not.toBeNull();

    // An at-least-once REPLAY is a recorded no-op: one message, ever.
    const again = await runFirstTouch({ ...deps(), now: safeNow }, {
      organization_id: orgId, lead_id: sourceId, duplicate_of: keeperId,
    });
    expect(again.kind).toBe('skipped');
    const count = await admin.query(
      `SELECT 1 FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE c.phone_e164 = '+15145559240' AND m.direction = 'outbound'`,
    );
    expect(count.rows).toHaveLength(1);
  });

  it('a thread bound to the DUPLICATE record is adopted by the keeper, not refused (F-63)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const keeperId = await makeLead(44);
    const sourceId = await makeLead(45, { phone: '+15145559244' });
    // The pathological state the blocker produced: the phone's one live
    // thread already belongs to the duplicate record.
    await admin.query(
      `INSERT INTO conversations (organization_id, store_id, lead_id, phone_e164)
       VALUES ($1,$2,$3,'+15145559244')`,
      [orgId, storeId, sourceId],
    );
    const out = await runFirstTouch({ ...deps(), now: safeNow }, {
      organization_id: orgId, lead_id: sourceId, duplicate_of: keeperId,
    });
    expect(out.kind, JSON.stringify(out)).toBe('sent');
    const conv = await admin.query<{ lead_id: string | null }>(
      `SELECT lead_id FROM conversations WHERE phone_e164 = '+15145559244' AND status <> 'closed'`,
    );
    expect(conv.rows[0]!.lead_id).toBe(keeperId);
  });

  it('the confirmation stays out of a thread a person holds (F-63)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const keeperId = await makeLead(42);
    const sourceId = await makeLead(43, { phone: '+15145559242' });
    const agent = await admin.query<{ user_id: string }>(
      `SELECT user_id FROM memberships WHERE organization_id = $1 LIMIT 1`, [orgId],
    );
    const phone = (
      await admin.query<{ phone: string }>(`SELECT phone FROM leads WHERE id = $1`, [keeperId])
    ).rows[0]!.phone;
    await admin.query(
      `INSERT INTO conversations (organization_id, store_id, lead_id, phone_e164, status, assigned_agent_id)
       VALUES ($1,$2,$3,$4,'agent_active',$5)`,
      [orgId, storeId, keeperId, phone, agent.rows[0]!.user_id],
    );
    const out = await runFirstTouch(deps(), {
      organization_id: orgId, lead_id: sourceId, duplicate_of: keeperId,
    });
    expect(out).toEqual({ kind: 'skipped', reason: 'a person has the thread' });
  });
});
