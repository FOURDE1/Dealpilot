import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool,
} from '@dealpilot/db';
import { buildApp } from '@dealpilot/api/app';
import { createCarrier } from '@dealpilot/api/carrier';
import { loadEnv } from '@dealpilot/api/env';
// F-72/A17: the DIST instance, which is the one `drip-tick.ts` itself reads
// through `@dealpilot/api/send`. Importing the source module here would reset a
// cache nothing in this suite consults.
import { resetKillSwitchCache } from '@dealpilot/api/platform-settings';
import { runDripTick } from './drip-tick.js';

/**
 * F-61 — the hourly drip tick. The carrier is the log driver (nothing leaves
 * the machine); under test is the ENGINE: due steps go through the full
 * compliance gate into the lead's one conversation, off-schedule enrollments
 * wait, expiry wins, and a gate refusal ends the ride with the honest status.
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
let reasonId = '';

const env = loadEnv({ DATABASE_URL: APP_URL, NODE_ENV: 'test' });

/** Noon-ish Eastern, always in the future — inside every quiet-hours window. */
function safeTickTime(): Date {
  const t = new Date();
  t.setUTCHours(17, 0, 0, 0);
  if (t.getTime() <= Date.now()) t.setUTCDate(t.getUTCDate() + 1);
  return t;
}

const deps = (now: Date) => ({
  pool: appPool,
  carrier: createCarrier(env, { info: () => {}, warn: () => {} }),
  env,
  now: () => now,
});

async function makeLostLead(n: number): Promise<{ leadId: string; enrollmentId: string }> {
  const res = await app!.inject({
    method: 'POST', url: '/api/v1/leads', headers: { cookie },
    payload: {
      organization_id: orgId, store_id: storeId, source: 'walk_in',
      first_name: `Relance${n}`, phone: `+1514555${String(9400 + n)}`,
      vehicle_interest: 'Kia Sportage',
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  const leadId = (JSON.parse(res.body) as { id: string }).id;
  const lost = await app!.inject({
    method: 'PATCH', url: `/api/v1/leads/${leadId}`, headers: { cookie },
    payload: { status: 'lost', lost_reason_id: reasonId },
  });
  expect(lost.statusCode, lost.body).toBe(200);
  const er = await admin.query<{ id: string }>(
    `SELECT id FROM drip_enrollments WHERE lead_id = $1 AND status = 'active'`,
    [leadId],
  );
  expect(er.rows.length).toBeGreaterThan(0);
  return { leadId, enrollmentId: er.rows[0]!.id };
}

/**
 * A platform super admin, and the one act F-72 gives them over this worker.
 *
 * The flip goes through `admin_set_platform_setting` — the definer the console
 * route calls, actor assertion, reason rule and audit row included — rather
 * than through `POST /api/v1/admin/platform-settings/:setting_key`, because
 * that route sits behind mandatory MFA and the TOTP oracle it needs
 * (apps/api/src/testing/totp.ts) is excluded from the api build. The route's
 * own coverage is the F-72 api suite; what is under test HERE is what the ride
 * does while the switch is on.
 */
async function superAdmin(email: string): Promise<string> {
  const su = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email, password: 'correct-horse-battery-staple', name: 'Exploitante Plateforme' },
  });
  expect(su.statusCode, su.body).toBe(200);
  await admin.query('SELECT * FROM platform_staff_grant($1, $2, $3, $4)', [
    null, email, 'platform_super_admin', 'F-72 drip-pause fixture',
  ]);
  return (await admin.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]))
    .rows[0]!.id;
}

async function setSwitch(actor: string, key: string, enabled: boolean, reason: string): Promise<void> {
  await admin.query('SELECT admin_set_platform_setting($1::uuid, $2::text, $3::boolean, $4::text)', [
    actor, key, enabled, reason,
  ]);
  // Every process waits out KILL_SWITCH_TTL_MS; this one does not have to.
  resetKillSwitchCache();
}

/** Shift an enrollment's clock so a step is due without waiting real days. */
async function backdate(enrollmentId: string, days: number): Promise<void> {
  await admin.query(
    `UPDATE drip_enrollments
     SET enrolled_at = enrolled_at - $2::interval, expires_at = expires_at - $2::interval
     WHERE id = $1`,
    [enrollmentId, `${days} days`],
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
    payload: { email: `f61w-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Relance Motrice' },
  });
  const sc = su.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe F61W', slug: `groupe-f61w-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Kia Mont-Laurier', code: `F61W`, province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;
  await app!.inject({
    method: 'PATCH', url: `/api/v1/stores/${storeId}`, headers: { cookie },
    payload: { sms_number: '+18195550001' },
  });

  const reasons = await app!.inject({
    method: 'GET', url: `/api/v1/lost-reasons?organization_id=${orgId}&limit=50`, headers: { cookie },
  });
  reasonId = (JSON.parse(reasons.body) as { items: { id: string; name: string }[] }).items
    .find((r) => r.name === 'No response')!.id;

  const seq = await app!.inject({
    method: 'POST', url: '/api/v1/drip-sequences', headers: { cookie },
    payload: {
      organization_id: orgId, name: 'Relance sans réponse', trigger_event: 'lead.lost',
      trigger_condition: { lost_reason: 'No response' },
      steps: [
        {
          day: 0,
          body_fr: 'Bonjour {{first_name}}, toujours à la recherche de {{vehicle}}?',
          body_en: 'Hi {{first_name}}, still shopping for {{vehicle}}?',
        },
        {
          day: 7,
          body_fr: 'Des nouvelles de {{store_name}} — de nouvelles arrivées cette semaine.',
          body_en: 'News from {{store_name}} — fresh arrivals this week.',
        },
      ],
      duration_days: 90,
    },
  });
  expect(seq.statusCode, seq.body).toBe(201);
});

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await admin?.end();
});

// The kill-switch snapshot is process memory with a five-second TTL, so a test
// that flipped one must not leave the next test reading its answer.
beforeEach(() => {
  resetKillSwitchCache();
});

describe('the hourly drip tick (F-61, §11.1)', () => {
  it('sends a due step through the full gate into a drip_active conversation, then waits', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const { leadId, enrollmentId } = await makeLostLead(1);
    const now = safeTickTime();
    const summary = await runDripTick(deps(now));
    expect(summary.sent, JSON.stringify(summary)).toBe(1);

    const msg = await admin.query<{
      body: string; sender_type: string; message_class: string; originator: string;
      consent_ledger_id: string | null; provider_ref: string | null; conversation_id: string;
    }>(
      `SELECT m.body, m.sender_type, d.message_class, d.originator, m.consent_ledger_id, m.provider_ref, m.conversation_id
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       JOIN send_decisions d ON d.id = m.send_decision_id
       WHERE c.lead_id = $1 AND m.direction = 'outbound'`,
      [leadId],
    );
    expect(msg.rows).toHaveLength(1);
    const sent = msg.rows[0]!;
    expect(sent.sender_type).toBe('drip');
    expect(sent.message_class).toBe('drip');
    // Machine-initiated: drips spend the SAME daily budget as the assistant
    // (compliance-and-quality.md §1/§3) — 'system' here was the F-61 review's
    // cap-bypass finding.
    expect(sent.originator).toBe('ai');
    expect(sent.body).toContain('Relance1');
    expect(sent.body).toContain('Kia Sportage');
    expect(sent.body).toContain('ARRÊT');
    expect(sent.consent_ledger_id).not.toBeNull();
    // The log carrier accepted it post-commit — delivery is stamped.
    expect(sent.provider_ref).not.toBeNull();

    const conv = await admin.query<{ status: string; language: string }>(
      `SELECT status, language FROM conversations WHERE id = $1`, [sent.conversation_id],
    );
    expect(conv.rows[0]).toEqual({ status: 'drip_active', language: 'fr' });

    const enr = await admin.query<{ current_step: number; last_message_sent_at: Date | null }>(
      `SELECT current_step, last_message_sent_at FROM drip_enrollments WHERE id = $1`,
      [enrollmentId],
    );
    expect(enr.rows[0]!.current_step).toBe(1);
    expect(enr.rows[0]!.last_message_sent_at).not.toBeNull();

    // Same hour, next tick: step 2 is six days away — nothing to do, and the
    // scan does not even surface the enrollment.
    const again = await runDripTick(deps(now));
    expect(again.scanned).toBe(0);
  });

  it('sends the day-7 step when its day arrives, and completes after the last one', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const { leadId, enrollmentId } = await makeLostLead(2);
    const now = safeTickTime();
    expect((await runDripTick(deps(now))).sent).toBe(1);

    await backdate(enrollmentId, 8);
    const second = await runDripTick(deps(now));
    expect(second.sent, JSON.stringify(second)).toBe(1);
    const msgs = await admin.query(
      `SELECT 1 FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE c.lead_id = $1 AND m.direction = 'outbound'`,
      [leadId],
    );
    expect(msgs.rows).toHaveLength(2);

    // Both steps out: the next scan closes the ride as completed.
    await backdate(enrollmentId, 1);
    const third = await runDripTick(deps(now));
    expect(third.completed, JSON.stringify(third)).toBe(1);
    const enr = await admin.query<{ status: string }>(
      `SELECT status FROM drip_enrollments WHERE id = $1`, [enrollmentId],
    );
    expect(enr.rows[0]!.status).toBe('completed');
  });

  it('expiry beats an overdue step — day 91 sends nothing, ever', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const { leadId, enrollmentId } = await makeLostLead(3);
    await backdate(enrollmentId, 91);
    const summary = await runDripTick(deps(safeTickTime()));
    expect(summary.expired, JSON.stringify(summary)).toBe(1);
    const enr = await admin.query<{ status: string }>(
      `SELECT status FROM drip_enrollments WHERE id = $1`, [enrollmentId],
    );
    expect(enr.rows[0]!.status).toBe('expired');
    const msgs = await admin.query(
      `SELECT 1 FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.lead_id = $1`,
      [leadId],
    );
    expect(msgs.rows).toHaveLength(0);
  });

  it('quiet hours defer the step WITHOUT advancing it — the next tick retries', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const { enrollmentId } = await makeLostLead(4);
    const nightEt = safeTickTime();
    nightEt.setUTCHours(6, 30, 0, 0); // 01:30/02:30 Eastern
    nightEt.setUTCDate(nightEt.getUTCDate() + 1);
    const summary = await runDripTick(deps(nightEt));
    expect(summary.waiting, JSON.stringify(summary)).toBe(1);
    const enr = await admin.query<{ current_step: number; status: string }>(
      `SELECT current_step, status FROM drip_enrollments WHERE id = $1`, [enrollmentId],
    );
    expect(enr.rows[0]).toEqual({ current_step: 0, status: 'active' });
  });

  it('a suppressed number ends the ride as opted_out — the tick never argues with STOP', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const { leadId, enrollmentId } = await makeLostLead(5);
    const phone = (
      await admin.query<{ phone: string }>(`SELECT phone FROM leads WHERE id = $1`, [leadId])
    ).rows[0]!.phone;
    await admin.query(
      `INSERT INTO suppression_list (organization_id, phone_e164, channel, source)
       VALUES ($1, $2, 'sms', 'stop_keyword')`,
      [orgId, phone],
    );
    const summary = await runDripTick(deps(safeTickTime()));
    expect(summary.ended, JSON.stringify(summary)).toBe(1);
    const enr = await admin.query<{ status: string; opted_out_at: Date | null }>(
      `SELECT status, opted_out_at FROM drip_enrollments WHERE id = $1`, [enrollmentId],
    );
    expect(enr.rows[0]!.status).toBe('opted_out');
    expect(enr.rows[0]!.opted_out_at).not.toBeNull();
  });

  it('a thread a human holds is not interrupted — the drip waits', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const { leadId, enrollmentId } = await makeLostLead(6);
    await runDripTick(deps(safeTickTime()));
    await backdate(enrollmentId, 8);
    // agent_active must name its holder (0031's CHECK) — the owner will do.
    await admin.query(
      `UPDATE conversations
       SET status = 'agent_active',
           assigned_agent_id = (SELECT user_id FROM memberships WHERE organization_id = $2 LIMIT 1)
       WHERE lead_id = $1`,
      [leadId, orgId],
    );
    const summary = await runDripTick(deps(safeTickTime()));
    expect(summary.waiting, JSON.stringify(summary)).toBe(1);
    const enr = await admin.query<{ current_step: number }>(
      `SELECT current_step FROM drip_enrollments WHERE id = $1`, [enrollmentId],
    );
    expect(enr.rows[0]!.current_step).toBe(1);
  });

  it('a lead who bought is no longer a nurture target — the ride ends', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const { leadId, enrollmentId } = await makeLostLead(7);
    await admin.query(`UPDATE leads SET status = 'converted' WHERE id = $1`, [leadId]);
    const summary = await runDripTick(deps(safeTickTime()));
    expect(summary.ended, JSON.stringify(summary)).toBe(1);
    const enr = await admin.query<{ status: string }>(
      `SELECT status FROM drip_enrollments WHERE id = $1`, [enrollmentId],
    );
    expect(enr.rows[0]!.status).toBe('reactivated');
  });

  it('an anglophone lead gets the ENGLISH template — en-CA is English (F-61 review)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const { leadId } = await makeLostLead(9);
    await admin.query(`UPDATE leads SET preferred_language = 'en-CA' WHERE id = $1`, [leadId]);
    const summary = await runDripTick(deps(safeTickTime()));
    expect(summary.sent, JSON.stringify(summary)).toBeGreaterThan(0);
    const msg = await admin.query<{ body: string; language: string }>(
      `SELECT m.body, c.language FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE c.lead_id = $1 AND m.direction = 'outbound'`,
      [leadId],
    );
    expect(msg.rows).toHaveLength(1);
    expect(msg.rows[0]!.language).toBe('en');
    expect(msg.rows[0]!.body).toContain('still shopping for');
    expect(msg.rows[0]!.body).toContain('STOP');
  });

  it('a step whose carrier call never concluded is REDELIVERED, never re-sent (F-61 review)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const { leadId, enrollmentId } = await makeLostLead(10);
    expect((await runDripTick(deps(safeTickTime()))).sent).toBeGreaterThan(0);
    // Simulate the crash window: the message row committed, the carrier call
    // never concluded (or was rejected retryably) — provider_ref stays NULL.
    await admin.query(
      `UPDATE messages m SET provider_ref = NULL
       FROM conversations c WHERE c.id = m.conversation_id AND c.lead_id = $1`,
      [leadId],
    );
    await backdate(enrollmentId, 8); // step 2 is ALSO due — recovery must win
    const again = await runDripTick(deps(safeTickTime()));
    expect(again.sent, JSON.stringify(again)).toBeGreaterThan(0);
    const msgs = await admin.query<{ provider_ref: string | null }>(
      `SELECT m.provider_ref FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE c.lead_id = $1 AND m.direction = 'outbound'`,
      [leadId],
    );
    // ONE row, redelivered — not a second message on top of a lost first.
    expect(msgs.rows).toHaveLength(1);
    expect(msgs.rows[0]!.provider_ref).not.toBeNull();
    const enr = await admin.query<{ current_step: number }>(
      `SELECT current_step FROM drip_enrollments WHERE id = $1`, [enrollmentId],
    );
    expect(enr.rows[0]!.current_step).toBe(1);
  });

  it('a platform pause makes the ride WAIT — the enrollment survives the outage and sends when the switch lifts (F-72 §5.3)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const { leadId, enrollmentId } = await makeLostLead(11);
    const staff = await superAdmin(`f72w-drip-super-${run}@dealpilot.test`);
    await setSwitch(staff, 'ai_outbound_killswitch', true, 'F-72: the assistant is misbehaving, stop outbound');

    const paused = await runDripTick(deps(safeTickTime()));
    expect(paused.sent, JSON.stringify(paused)).toBe(0);
    expect(paused.waiting, JSON.stringify(paused)).toBeGreaterThanOrEqual(1);
    // Not opted_out and not expired: a platform pause is reversible by
    // definition, and ending the ride would punish a dealer for our outage.
    const held = await admin.query<{ status: string; current_step: number }>(
      `SELECT status, current_step FROM drip_enrollments WHERE id = $1`, [enrollmentId],
    );
    expect(held.rows[0]).toEqual({ status: 'active', current_step: 0 });
    expect(
      (await admin.query(
        `SELECT 1 FROM send_decisions WHERE lead_id = $1 AND status = 'blocked' AND reason = 'platform_ai_paused'`,
        [leadId],
      )).rows.length,
    ).toBeGreaterThan(0);
    expect(
      (await admin.query(
        `SELECT 1 FROM messages m JOIN conversations c ON c.id = m.conversation_id
          WHERE c.lead_id = $1 AND m.direction = 'outbound'`,
        [leadId],
      )).rows,
    ).toHaveLength(0);

    await setSwitch(staff, 'ai_outbound_killswitch', false, 'F-72: the incident is over, resume sending');
    const resumed = await runDripTick(deps(safeTickTime()));
    expect(resumed.sent, JSON.stringify(resumed)).toBeGreaterThanOrEqual(1);
    const advanced = await admin.query<{ status: string; current_step: number }>(
      `SELECT status, current_step FROM drip_enrollments WHERE id = $1`, [enrollmentId],
    );
    expect(advanced.rows[0]).toEqual({ status: 'active', current_step: 1 });
  });

  it('a refusal nobody classified is LOUD — the ride still waits, and production hears about it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await makeLostLead(12);
    const warnings: unknown[][] = [];
    // The four reason sets partition BLOCKED_REASONS today, so the only way to
    // reach the fall-through is to invent a reason the gate cannot produce yet
    // — which is exactly the future this branch exists for.
    vi.doMock('@dealpilot/api/send', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@dealpilot/api/send')>()),
      sendMessage: async () => ({
        kind: 'blocked' as const,
        decisionId: '00000000-0000-4000-8000-0000000000f7',
        reason: 'a_reason_from_a_later_slice',
        remedy: 'decide what a drip should do about it',
      }),
    }));
    vi.resetModules();
    try {
      const { runDripTick: withUnknownReason } = await import('./drip-tick.js');
      const summary = await withUnknownReason({
        ...deps(safeTickTime()),
        warn: (...args: unknown[]) => warnings.push(args),
      });
      expect(summary.sent, JSON.stringify(summary)).toBe(0);
      expect(summary.waiting, JSON.stringify(summary)).toBeGreaterThanOrEqual(1);
      expect(summary.ended, JSON.stringify(summary)).toBe(0);
      expect(warnings.length).toBeGreaterThan(0);
      // Two arguments: the message a human reads and the decision they need.
      expect(warnings[0]).toHaveLength(2);
      expect(String(warnings[0]![0])).toContain('a_reason_from_a_later_slice');
    } finally {
      vi.doUnmock('@dealpilot/api/send');
      vi.resetModules();
    }
  });

  // LAST on purpose: it multiplies the sequence config, and a mid-test
  // failure must not leave three extra sequences enrolling later fixtures.
  it('drips spend the assistant daily budget — the fourth machine text is refused (F-61 review)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Three MORE sequences answering the same loss: four day-0 steps due in
    // the same tick. The gate's per-lead daily cap (default 3, 'ai'
    // originated) must stop the fourth — 'drip' mapping to 'system' let all
    // of them through uncounted.
    for (const name of ['Relance bis', 'Relance ter', 'Relance quater']) {
      const res = await app!.inject({
        method: 'POST', url: '/api/v1/drip-sequences', headers: { cookie },
        payload: {
          organization_id: orgId, name, trigger_event: 'lead.lost',
          trigger_condition: { lost_reason: 'No response' },
          steps: [
            {
              day: 0,
              body_fr: `${name}: toujours à la recherche?`,
              body_en: `${name}: still shopping around?`,
            },
          ],
          duration_days: 90,
        },
      });
      expect(res.statusCode, res.body).toBe(201);
    }
    const { leadId } = await makeLostLead(8);
    expect(
      (await admin.query(`SELECT 1 FROM drip_enrollments WHERE lead_id = $1 AND status = 'active'`, [leadId])).rows,
    ).toHaveLength(4);

    await runDripTick(deps(safeTickTime()));

    const sent = await admin.query(
      `SELECT 1 FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE c.lead_id = $1 AND m.direction = 'outbound'`,
      [leadId],
    );
    expect(sent.rows).toHaveLength(3);
    const refused = await admin.query(
      `SELECT 1 FROM send_decisions WHERE lead_id = $1 AND status = 'blocked' AND reason = 'frequency_cap'`,
      [leadId],
    );
    expect(refused.rows.length).toBeGreaterThan(0);
    const held = await admin.query(
      `SELECT 1 FROM drip_enrollments WHERE lead_id = $1 AND status = 'active' AND current_step = 0`,
      [leadId],
    );
    expect(held.rows).toHaveLength(1);
  });
});

/**
 * The fall-through above is a `deps.warn?.()` — optional, so a suite can pass
 * while production is deaf. This is the source-scan that keeps the production
 * registration honest (the realtime-vocabulary idiom).
 */
describe('the drip tick as it is registered (F-72)', () => {
  it('the production runDripTick call passes a warn seam', () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.ts'), 'utf8');
    // Assert on the OFFSET, before slicing. `slice(-1)` on a miss is the file's
    // last character and never '', so a "did we find it" check written against
    // the slice cannot fail — and losing the registration altogether would then
    // be reported as a missing warn seam, pointing the reader at the smaller of
    // the two breakages. There is deliberately no matching assertion on the
    // '}),' terminator: index.ts carries several more of them below this call,
    // so that search cannot come back empty in any file that parses, and an
    // assertion with no way to fire is the very thing this comment is about.
    const at = source.indexOf('runDripTick({');
    expect(at, 'runDripTick({ is not called in apps/workers/src/index.ts').toBeGreaterThan(-1);
    const call = source.slice(at, source.indexOf('}),', at));
    expect(call, 'the production runDripTick({ … }) call passes no warn: seam').toMatch(/\bwarn:/);
  });
});
