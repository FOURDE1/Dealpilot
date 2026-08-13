import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, withTenant, type Pool,
} from '@dealpilot/db';
import { buildApp } from './app.js';
import { handleInboundSms, onPlatformSuppression } from './f18-inbound-sms.js';

/**
 * The opt-out pipeline (compliance-and-quality.md §5).
 *
 * §5 requires every effect "synchronously in one transaction before the 200".
 * A PARTIAL opt-out is the worst outcome available here, because both halves
 * look like the system working: the suppression row exists so the screen says
 * "opted out", and the consent rows are still live so the sender keeps sending.
 * The transactionality case at the bottom is the one that matters most.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);

let admin: Pool;
let appPool: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookie = '';
let orgId = '';
let storeA = '';
let storeB = '';

const PHONE = '+15145550133';

async function seedConsent(phone = PHONE) {
  const res = await app!.inject({
    method: 'POST', url: '/api/v1/consent', headers: { cookie },
    payload: {
      organization_id: orgId, phone_e164: phone,
      channels: ['sms', 'voice'], scopes: ['conversational'],
      consent_type: 'express', source: 'staff_manual',
      evidence: { note: 'seeded for the stop test' },
    },
  });
  expect(res.statusCode, res.body).toBe(201);
}

async function liveConsents(phone = PHONE) {
  const r = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM consent_ledger
     WHERE organization_id = $1 AND phone_e164 = $2 AND revoked_at IS NULL`,
    [orgId, phone],
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
    payload: { email: `f18-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Alice' },
  });
  const sc = su.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');

  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe F18', slug: `groupe-f18-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;

  for (const [code, name] of [['F18-A', 'Rooftop A'], ['F18-B', 'Rooftop B']] as const) {
    const s = await app!.inject({
      method: 'POST', url: '/api/v1/stores', headers: { cookie },
      payload: { organization_id: orgId, name, code: `${code}-${run.slice(-4)}`, province: 'QC' },
    });
    const id = (JSON.parse(s.body) as { id: string }).id;
    if (code === 'F18-A') storeA = id;
    else storeB = id;
  }
});

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await admin?.end();
});

describe('somebody texts STOP', () => {
  it('does every effect, in one transaction', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await seedConsent();
    expect(await liveConsents()).toBeGreaterThan(0);

    const outcome = await withTenant(appPool, orgId, (c) =>
      handleInboundSms(c, {
        organizationId: orgId, storeId: storeA, phoneE164: PHONE,
        body: 'actually STOP please', messageRef: 'SM-stop-1',
      }),
    );
    expect(outcome).toMatchObject({ kind: 'opted_out', keyword: 'STOP' });

    // 1. suppression, organisation-wide
    const sup = await admin.query(
      `SELECT matched_keyword, source_message_ref FROM suppression_list
       WHERE organization_id = $1 AND phone_e164 = $2 AND cleared_at IS NULL`,
      [orgId, PHONE],
    );
    expect(sup.rows).toHaveLength(1);
    expect(sup.rows[0]).toMatchObject({ matched_keyword: 'STOP', source_message_ref: 'SM-stop-1' });

    // 2. every consent withdrawn — not deleted, the ledger is evidence
    expect(await liveConsents()).toBe(0);
    const revoked = await admin.query<{ revoked_reason: string }>(
      `SELECT revoked_reason FROM consent_ledger WHERE organization_id = $1 AND phone_e164 = $2`,
      [orgId, PHONE],
    );
    expect(revoked.rows.every((r) => r.revoked_reason === 'stop_keyword')).toBe(true);

    // 3. internal do-not-call, which §4 says has no exemptions
    const dnc = await admin.query(
      `SELECT 1 FROM internal_dnc WHERE organization_id = $1 AND phone_e164 = $2`, [orgId, PHONE],
    );
    expect(dnc.rows).toHaveLength(1);

    // 4. the cross-organisation list, hashed
    const hash = createHash('sha256').update(PHONE).digest();
    const platform = await admin.query(
      `SELECT 1 FROM platform_suppression WHERE phone_sha256 = $1 AND channel = 'sms'`, [hash],
    );
    expect(platform.rows).toHaveLength(1);
  });

  it('stops the OTHER rooftop of the same group too', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // §5: "Scope is organization-wide: STOP to one rooftop suppresses all
    // stores of the tenant." Somebody who says stop has not said "stop, except
    // from your other lot".
    const lead = await app!.inject({
      method: 'POST', url: '/api/v1/leads', headers: { cookie },
      payload: { organization_id: orgId, store_id: storeB, phone: PHONE, source: 'walk_in' },
    });
    const leadId = (JSON.parse(lead.body) as { id: string }).id;
    const gate = await app!.inject({
      method: 'GET',
      url: `/api/v1/leads/${leadId}/compliance?channel=sms&scope=conversational&originator=human`,
      headers: { cookie },
    });
    expect(JSON.parse(gate.body)).toMatchObject({ status: 'blocked', reason: 'suppressed' });
  });

  it('keeps the number off a SISTER organisation’s reach', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // A group with four rooftops under three legal entities must not re-market
    // to this number through a sister company tomorrow.
    const found = await withTenant(appPool, orgId, (c) => onPlatformSuppression(c, PHONE, 'sms'));
    expect(found).toBe(true);
    const other = await withTenant(appPool, orgId, (c) => onPlatformSuppression(c, '+15145559999', 'sms'));
    expect(other).toBe(false);
  });

  it('stores no organisation, lead or number on the cross-org list', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Raw numbers here would build a cross-tenant directory of everyone who ever
    // opted out. A hash answers the only question anyone may ask of it.
    const cols = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'platform_suppression'`,
    );
    const names = cols.rows.map((c) => c.column_name);
    expect(names).not.toContain('organization_id');
    expect(names).not.toContain('phone_e164');
    expect(names).not.toContain('lead_id');
  });

  it('recognises the French keywords the same way', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const phone = '+15145550122';
    await seedConsent(phone);
    const outcome = await withTenant(appPool, orgId, (c) =>
      handleInboundSms(c, {
        organizationId: orgId, storeId: storeA, phoneE164: phone,
        body: 'ARRÊT svp', messageRef: 'SM-fr-1',
      }),
    );
    expect(outcome).toMatchObject({ kind: 'opted_out', language: 'fr' });
    expect(await liveConsents(phone)).toBe(0);
  });

  it('leaves an ordinary message alone', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const phone = '+15145550111';
    await seedConsent(phone);
    const outcome = await withTenant(appPool, orgId, (c) =>
      handleInboundSms(c, {
        organizationId: orgId, storeId: storeA, phoneE164: phone,
        body: 'Can I stop by tomorrow to see it?', messageRef: 'SM-ok-1',
      }),
    );
    // Suppressing a live customer who said nothing of the kind costs a sale and
    // is invisible to everyone.
    expect(outcome).toMatchObject({ kind: 'ordinary_message' });
    expect(await liveConsents(phone)).toBeGreaterThan(0);
  });
});

describe('coming back with START', () => {
  it('clears the suppression and records a fresh consent with their own words', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const outcome = await withTenant(appPool, orgId, (c) =>
      handleInboundSms(c, {
        organizationId: orgId, storeId: storeA, phoneE164: PHONE,
        body: 'START', messageRef: 'SM-start-1',
      }),
    );
    expect(outcome).toMatchObject({ kind: 'resubscribed', keyword: 'START' });

    const sup = await admin.query(
      `SELECT 1 FROM suppression_list
       WHERE organization_id = $1 AND phone_e164 = $2 AND cleared_at IS NULL`,
      [orgId, PHONE],
    );
    expect(sup.rows).toHaveLength(0);

    // Keyed on the re_opt_in SOURCE, not "the only live row": creating a lead
    // for this number in the previous test also wrote an inquiry basis, which is
    // harmless (suppression is checked before consent) but means counting live
    // rows would assert the wrong thing.
    const fresh = await admin.query<{ evidence: Record<string, unknown>; consent_type: string }>(
      `SELECT evidence, consent_type FROM consent_ledger
       WHERE organization_id = $1 AND phone_e164 = $2 AND source = 're_opt_in' AND revoked_at IS NULL`,
      [orgId, PHONE],
    );
    expect(fresh.rows).toHaveLength(1);
    expect(fresh.rows[0]!.consent_type).toBe('express');
    // Their verbatim reply IS the evidence — not a summary of it.
    expect(fresh.rows[0]!.evidence['reply_verbatim']).toBe('START');
  });

  it('does NOT clear the do-not-call list — texts are not calls', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // §5 is explicit: re-opt-in "never [clears] the internal DNC for voice —
    // that requires explicit call consent again". Somebody who texted START
    // asked for texts, not to be phoned by a machine.
    const dnc = await admin.query(
      `SELECT 1 FROM internal_dnc WHERE organization_id = $1 AND phone_e164 = $2`, [orgId, PHONE],
    );
    expect(dnc.rows).toHaveLength(1);
  });

  it('leaves the revoked rows revoked — history is not rewritten', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const revoked = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM consent_ledger
       WHERE organization_id = $1 AND phone_e164 = $2 AND revoked_reason = 'stop_keyword'`,
      [orgId, PHONE],
    );
    expect(Number(revoked.rows[0]!.n)).toBeGreaterThan(0);
  });

  it('ignores a bare YES unless we just asked', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const phone = '+15145550144';
    const asOrdinary = await withTenant(appPool, orgId, (c) =>
      handleInboundSms(c, {
        organizationId: orgId, storeId: storeA, phoneE164: phone,
        body: 'yes that works for me', messageRef: 'SM-yes-1',
      }),
    );
    // Consent by accident is the thing the law exists to prevent.
    expect(asOrdinary).toMatchObject({ kind: 'ordinary_message' });

    const asAnswer = await withTenant(appPool, orgId, (c) =>
      handleInboundSms(c, {
        organizationId: orgId, storeId: storeA, phoneE164: phone,
        body: 'yes', messageRef: 'SM-yes-2', awaitingReOptInPrompt: true,
      }),
    );
    expect(asAnswer).toMatchObject({ kind: 'resubscribed' });
  });
});

describe('a half-applied opt-out must be impossible', () => {
  it('rolls EVERYTHING back when any effect fails', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // The case §5's transactionality requirement exists for. Both halves of a
    // partial opt-out look like the system working: the suppression row makes
    // the screen say "opted out" while the live consent rows keep the sender
    // sending.
    const phone = '+15145550155';
    await seedConsent(phone);
    const before = await liveConsents(phone);
    expect(before).toBeGreaterThan(0);

    await expect(
      withTenant(appPool, orgId, async (c) => {
        await handleInboundSms(c, {
          organizationId: orgId, storeId: storeA, phoneE164: phone,
          body: 'STOP', messageRef: 'SM-fail-1',
        });
        // Something later in the same request fails — a conversation update, a
        // queue write, anything.
        throw new Error('downstream failure after the opt-out effects');
      }),
    ).rejects.toThrow('downstream failure');

    // Nothing survived. Not the suppression, not the do-not-call row, and the
    // consents are still live — which is correct, because the opt-out did not
    // actually complete and the customer must be told so by a retry.
    const sup = await admin.query(
      `SELECT 1 FROM suppression_list WHERE organization_id = $1 AND phone_e164 = $2`,
      [orgId, phone],
    );
    expect(sup.rows, 'a suppression row survived a rolled-back transaction').toHaveLength(0);
    const dnc = await admin.query(
      `SELECT 1 FROM internal_dnc WHERE organization_id = $1 AND phone_e164 = $2`, [orgId, phone],
    );
    expect(dnc.rows).toHaveLength(0);
    expect(await liveConsents(phone)).toBe(before);

    const hash = createHash('sha256').update(phone).digest();
    const platform = await admin.query(
      `SELECT 1 FROM platform_suppression WHERE phone_sha256 = $1`, [hash],
    );
    expect(platform.rows, 'the cross-org row survived a rolled-back transaction').toHaveLength(0);
  });

  it('is idempotent — a provider retrying STOP does not corrupt anything', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Every SMS provider retries. Twice is the same as once.
    const phone = '+15145550166';
    await seedConsent(phone);
    for (const ref of ['SM-dup-1', 'SM-dup-1']) {
      await withTenant(appPool, orgId, (c) =>
        handleInboundSms(c, {
          organizationId: orgId, storeId: storeA, phoneE164: phone, body: 'STOP', messageRef: ref,
        }),
      );
    }
    const sup = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM suppression_list
       WHERE organization_id = $1 AND phone_e164 = $2 AND cleared_at IS NULL`,
      [orgId, phone],
    );
    expect(sup.rows[0]!.n).toBe('1');
  });
});
