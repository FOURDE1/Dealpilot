import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { buildApp } from './app.js';

/**
 * F-15 compliance, through the API.
 *
 * The rules are golden-tested in packages/core. This suite is about the three
 * things only the server can promise: that the ledger cannot be edited into a
 * different consent, that one dealership can never see another's, and that the
 * answer on the screen is the same answer the send layer will act on.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);

let admin: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookie = '';
let orgId = '';
let storeId = '';
let leadId = '';

async function signUp(email: string, name: string) {
  const res = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email, password: 'correct-horse-battery-staple', name },
  });
  const sc = res.headers['set-cookie'];
  return (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');
}

async function recordConsent(payload: Record<string, unknown>, as = cookie) {
  return app!.inject({ method: 'POST', url: '/api/v1/consent', headers: { cookie: as }, payload });
}

async function check(query = '') {
  const res = await app!.inject({
    method: 'GET', url: `/api/v1/leads/${leadId}/compliance${query}`, headers: { cookie },
  });
  expect(res.statusCode, res.body).toBe(200);
  return JSON.parse(res.body) as {
    status: string; reason: string | null; remedy: string | null;
    consent_record_id: string | null; timezone: string; timezone_source: string;
    deferred_until: string | null; gate_version: string;
  };
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
  ({ app } = await buildApp({ DATABASE_URL: APP_URL, NODE_ENV: 'test' }));

  cookie = await signUp(`f15-${run}@dealpilot.test`, 'Alice Owner');
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe F15', slug: `groupe-f15-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'F15 Kia', code: 'F15-KIA', province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;
  const lead = await app!.inject({
    method: 'POST', url: '/api/v1/leads', headers: { cookie },
    payload: { organization_id: orgId, store_id: storeId, phone: '+15145550188', source: 'walk_in' },
  });
  expect(lead.statusCode, lead.body).toBe(201);
  leadId = (JSON.parse(lead.body) as { id: string }).id;
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('the ledger is evidence, not state', () => {
  it('records one act as the rows it authorises, sharing a grant', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await recordConsent({
      organization_id: orgId, store_id: storeId, lead_id: leadId,
      phone_e164: '+15145550188', email: `f15-lead-${run}@example.test`,
      channels: ['sms', 'email'], scopes: ['conversational'],
      consent_type: 'implied_inquiry', source: 'webhook_inquiry',
      evidence: { form: 'website contact', wording: 'I agree to be contacted', ip: '203.0.113.9' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const rows = JSON.parse(res.body) as { grant_id: string; expires_at: string; channel: string }[];
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.grant_id)).size, 'one act, one grant').toBe(1);
    // The expiry is DERIVED. Six months from an inquiry, and nobody can ask for
    // longer — the input schema has no field for it.
    expect(rows.every((r) => r.expires_at !== null)).toBe(true);
  });

  it('refuses a consent with no evidence behind it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await recordConsent({
      organization_id: orgId, lead_id: leadId,
      channels: ['sms'], scopes: ['conversational'],
      consent_type: 'express', source: 'staff_manual', evidence: {},
    });
    // A consent record with nothing behind it is an assertion, and an assertion
    // is exactly what a regulator asks you to substantiate.
    expect(res.statusCode).toBe(422);
  });

  it('refuses a consent that belongs to nobody', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await recordConsent({
      organization_id: orgId,
      channels: ['sms'], scopes: ['conversational'],
      consent_type: 'express', source: 'staff_manual', evidence: { note: 'orphan' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('cannot be edited into a different consent — the database refuses', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // The trigger, not a convention. "We do not edit consent records" is exactly
    // the sort of rule that quietly stops being true.
    const row = await admin.query<{ id: string }>(
      `SELECT id FROM consent_ledger WHERE organization_id = $1 LIMIT 1`, [orgId],
    );
    await expect(
      admin.query(`UPDATE consent_ledger SET scope = 'marketing' WHERE id = $1`, [row.rows[0]!.id]),
    ).rejects.toThrow(/append-only/);
    await expect(
      admin.query(`UPDATE consent_ledger SET granted_at = now() WHERE id = $1`, [row.rows[0]!.id]),
    ).rejects.toThrow(/append-only/);
  });

  it('withdrawal is a one-way door', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const created = JSON.parse((await recordConsent({
      organization_id: orgId, lead_id: leadId, phone_e164: '+15145550188',
      channels: ['sms'], scopes: ['marketing'],
      consent_type: 'express', source: 'form_checkbox',
      evidence: { wording: 'Send me offers' },
    })).body) as { id: string }[];

    const revoked = await app!.inject({
      method: 'POST', url: `/api/v1/consent/${created[0]!.id}/revoke`,
      headers: { cookie }, payload: { reason: 'staff_manual' },
    });
    expect(revoked.statusCode, revoked.body).toBe(200);

    // Un-revoking would quietly restore somebody who said stop.
    await expect(
      admin.query(`UPDATE consent_ledger SET revoked_at = NULL, revoked_reason = NULL WHERE id = $1`,
        [created[0]!.id]),
    ).rejects.toThrow(/un-revoked/);

    const again = await app!.inject({
      method: 'POST', url: `/api/v1/consent/${created[0]!.id}/revoke`,
      headers: { cookie }, payload: { reason: 'staff_manual' },
    });
    expect(again.statusCode).toBe(409);
  });

  it('a send decision cannot be rewritten after the fact', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await admin.query(
      `INSERT INTO send_decisions (organization_id, channel, scope, message_class, originator,
                                   status, reason, timezone, timezone_source, recipient_local_at, gate_version)
       VALUES ($1,'sms','conversational','follow_up','ai','blocked','consent_absent',
               'America/Toronto','store', now(), 'f15.1')`,
      [orgId],
    );
    await expect(
      admin.query(`UPDATE send_decisions SET status = 'allowed' WHERE organization_id = $1`, [orgId]),
    ).rejects.toThrow(/append-only/);
  });
});

describe('the screen shows what the send layer will actually do', () => {
  it('refuses when there is no basis, and says what would fix it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await check('?channel=voice&scope=ai_outbound_call&originator=ai');
    expect(res.status).toBe('blocked');
    // A reason tells somebody nothing. A remedy tells them what to do, and that
    // difference decides whether the rule gets followed or worked around.
    expect(res.remedy).toBeTruthy();
    expect(res.gate_version).toBeTruthy();
  });

  it('allows a conversational text once an inquiry basis exists, and names the row', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await check('?channel=sms&scope=conversational&originator=human');
    expect(['allowed', 'deferred']).toContain(res.status);
    if (res.status === 'allowed') expect(res.consent_record_id).toBeTruthy();
  });

  it('reads the timezone from the lead’s own number, not the store’s', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // +1514 is Montreal. The source is reported so an audit can see whether the
    // answer rested on the recipient or on a fallback.
    const res = await check('?channel=sms&scope=conversational');
    expect(res.timezone).toBe('America/Toronto');
    expect(res.timezone_source).toBe('area_code');
  });

  it('blocks a solicitation call because no national list has ever been loaded', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // The fail-closed default. A fresh install must not be able to cold-call,
    // and "we never loaded the list" is the worst kind of stale, not an excuse.
    const res = await check('?channel=voice&scope=ai_outbound_call&is_solicitation=true&originator=human');
    expect(res.status).toBe('blocked');
  });

  it('honours a manual stop over everything else', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const sup = await app!.inject({
      method: 'POST', url: '/api/v1/suppressions', headers: { cookie },
      payload: { organization_id: orgId, phone_e164: '+15145550188', channel: 'sms', source: 'staff_manual' },
    });
    expect(sup.statusCode, sup.body).toBe(201);

    const res = await check('?channel=sms&scope=conversational&originator=human');
    expect(res).toMatchObject({ status: 'blocked', reason: 'suppressed' });
  });
});

describe('one dealership never sees another’s consent (RT-11)', () => {
  it('refuses every compliance route to an outsider', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const outsider = await signUp(`f15-out-${run}@dealpilot.test`, 'Olive Outsider');

    const consentRes = await recordConsent({
      organization_id: orgId, lead_id: leadId,
      channels: ['sms'], scopes: ['conversational'],
      consent_type: 'express', source: 'staff_manual', evidence: { note: 'x' },
    }, outsider);
    expect(consentRes.statusCode).toBe(404);

    for (const url of [`/api/v1/leads/${leadId}/consent`, `/api/v1/leads/${leadId}/compliance`]) {
      const res = await app!.inject({ method: 'GET', url, headers: { cookie: outsider } });
      expect(res.statusCode, url).toBe(404);
    }

    const sup = await app!.inject({
      method: 'POST', url: '/api/v1/suppressions', headers: { cookie: outsider },
      payload: { organization_id: orgId, phone_e164: '+15145550199', channel: 'sms', source: 'staff_manual' },
    });
    expect(sup.statusCode).toBe(404);
  });

  it('shows the tenant predicate really is what hides the rows', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Connect as the application role, set a different organisation, and look.
    // Not the admin role — the admin bypasses RLS and would prove nothing.
    const appPool = createPool({ connectionString: APP_URL, max: 2 });
    try {
      const client = await appPool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.org_id', $1, true)`, [
          '00000000-0000-4000-8000-000000000000',
        ]);
        for (const table of ['consent_ledger', 'suppression_list', 'internal_dnc',
          'tenant_comms_config', 'send_decisions']) {
          const r = await client.query(`SELECT count(*)::text AS n FROM ${table}`);
          expect((r.rows[0] as { n: string }).n, `${table} leaked across tenants`).toBe('0');
        }
        // And a write claiming another organisation is refused by WITH CHECK.
        await expect(
          client.query(
            `INSERT INTO suppression_list (organization_id, phone_e164, channel, source)
             VALUES ($1, '+15145550111', 'sms', 'staff_manual')`,
            [orgId],
          ),
        ).rejects.toThrow(/row-level security/);
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    } finally {
      await appPool.end();
    }
  });
});

describe('the windows a tenant may set, and the ones they may not', () => {
  it('starts on the platform defaults when nothing has been configured', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'GET', url: `/api/v1/organizations/${orgId}/comms-config`, headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    // Null means "the platform defaults", which are the strictest thing a
    // tenant is allowed to have — not an error and not an empty window.
    expect(JSON.parse(res.body)).toBeNull();
  });

  it('lets a tenant NARROW the messaging window', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'PUT', url: `/api/v1/organizations/${orgId}/comms-config`,
      headers: { cookie }, payload: { sms_quiet_start: '10:00', sms_quiet_end: '20:00' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ sms_quiet_start: '10:00:00', sms_quiet_end: '20:00:00' });
  });

  it('refuses to WIDEN it past what the platform allows', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // A tenant who could set 06:00–23:00 would be configuring their way out of
    // the rule rather than into it.
    for (const payload of [{ sms_quiet_start: '06:00' }, { sms_quiet_end: '23:00' }]) {
      const res = await app!.inject({
        method: 'PUT', url: `/api/v1/organizations/${orgId}/comms-config`,
        headers: { cookie }, payload,
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(422);
      expect(JSON.parse(res.body).error.code).toBe('window_too_wide');
    }
  });

  it('offers no way at all to widen the VOICE window', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // §3's voice row reads "Exemptions: None." The protection is that no such
    // column exists — asserted against the catalogue, so adding one fails here.
    const cols = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'tenant_comms_config'`,
    );
    const names = cols.rows.map((c) => c.column_name);
    expect(names.filter((n) => /voice/.test(n)), 'a voice window column must not exist').toEqual([]);
  });

  it('the narrowed window is what the gate then enforces', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Configuration the engine ignores is worse than none: it tells a tenant
    // they are stricter than they are.
    //
    // A FRESH lead, because the suppression written earlier in this file would
    // otherwise block first — which is itself correct, and is asserted there.
    const fresh = await app!.inject({
      method: 'POST', url: '/api/v1/leads', headers: { cookie },
      payload: { organization_id: orgId, store_id: storeId, phone: '+15145550177', source: 'walk_in' },
    });
    const freshId = (JSON.parse(fresh.body) as { id: string }).id;
    await recordConsent({
      organization_id: orgId, lead_id: freshId, phone_e164: '+15145550177',
      channels: ['sms'], scopes: ['conversational'],
      consent_type: 'express', source: 'form_checkbox', evidence: { wording: 'text me' },
    });

    const res = await app!.inject({
      method: 'GET',
      url: `/api/v1/leads/${freshId}/compliance?channel=sms&scope=conversational&originator=human&message_class=drip`,
      headers: { cookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = JSON.parse(res.body) as { status: string; window_applied: string | null };
    // Whatever the hour the suite runs at, the window the gate reports is the
    // one the tenant configured — not the platform default it started from.
    expect(body.window_applied).toBe('sms:10:00:00-20:00:00');
    expect(['allowed', 'deferred']).toContain(body.status);
  });
});

describe('never call this person again', () => {
  it('records it, with who did it, and blocks the call', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/internal-dnc', headers: { cookie },
      payload: {
        organization_id: orgId, phone_e164: '+15145550188',
        reason: 'verbal_do_not_call', note: 'said so on the phone',
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(JSON.parse(res.body).added_by, 'a person did this; the record should say who').toBeTruthy();

    // §4: "No exemptions to internal DNC." Not even an express consent.
    await recordConsent({
      organization_id: orgId, lead_id: leadId, phone_e164: '+15145550188',
      channels: ['voice'], scopes: ['ai_outbound_call'],
      consent_type: 'express', source: 'sms_reply',
      evidence: { reply: 'YES', message_id: 'SM123' },
    });
    const gate = await check('?channel=voice&scope=ai_outbound_call&originator=human');
    expect(gate).toMatchObject({ status: 'blocked', reason: 'internal_dnc' });
  });

  it('has no undo — asking twice is idempotent, not reversible', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const again = await app!.inject({
      method: 'POST', url: '/api/v1/internal-dnc', headers: { cookie },
      payload: { organization_id: orgId, phone_e164: '+15145550188', reason: 'staff_manual' },
    });
    expect(again.statusCode).toBe(201);
    const rows = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM internal_dnc WHERE organization_id = $1 AND phone_e164 = $2`,
      [orgId, '+15145550188'],
    );
    expect(rows.rows[0]!.n).toBe('1');
  });
});

describe('D-042 #1 · a walk-in can actually be replied to', () => {
  it('creating a walk-in lead records the basis in the same breath', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // The point of the owner's answer: before this, every walk-in and phone
    // lead was permanently unmessageable — the customer stands at the desk,
    // gives you their number, and the system refuses to text them.
    const lead = await app!.inject({
      method: 'POST', url: '/api/v1/leads', headers: { cookie },
      payload: {
        organization_id: orgId, store_id: storeId,
        phone: '+15145550166', source: 'walk_in', first_name: 'Walk In',
      },
    });
    expect(lead.statusCode, lead.body).toBe(201);
    const id = (JSON.parse(lead.body) as { id: string }).id;

    const consent = await app!.inject({
      method: 'GET', url: `/api/v1/leads/${id}/consent`, headers: { cookie },
    });
    const items = (JSON.parse(consent.body) as { items: { scope: string; consent_type: string; channel: string }[] }).items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.scope === 'conversational')).toBe(true);
    expect(items.every((i) => i.consent_type === 'implied_inquiry')).toBe(true);

    // And the gate now says yes to a text about their enquiry.
    const res = await app!.inject({
      method: 'GET',
      url: `/api/v1/leads/${id}/compliance?channel=sms&scope=conversational&originator=human`,
      headers: { cookie },
    });
    expect(['allowed', 'deferred']).toContain((JSON.parse(res.body) as { status: string }).status);
  });

  it('a REFERRAL gets nothing — it is somebody else’s number', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const lead = await app!.inject({
      method: 'POST', url: '/api/v1/leads', headers: { cookie },
      payload: {
        organization_id: orgId, store_id: storeId,
        phone: '+15145550155', source: 'referral', first_name: 'Referred',
      },
    });
    const id = (JSON.parse(lead.body) as { id: string }).id;
    const consent = await app!.inject({
      method: 'GET', url: `/api/v1/leads/${id}/consent`, headers: { cookie },
    });
    expect((JSON.parse(consent.body) as { items: unknown[] }).items).toEqual([]);

    const res = await app!.inject({
      method: 'GET',
      url: `/api/v1/leads/${id}/compliance?channel=sms&scope=conversational&originator=human`,
      headers: { cookie },
    });
    expect(JSON.parse(res.body)).toMatchObject({ status: 'blocked', reason: 'consent_absent' });
  });

  it('still refuses an automated CALL to that walk-in', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // An enquiry is not permission for a robot to phone them. That needs
    // express consent, which nobody can imply.
    const lead = await app!.inject({
      method: 'POST', url: '/api/v1/leads', headers: { cookie },
      payload: {
        organization_id: orgId, store_id: storeId,
        phone: '+15145550144', source: 'phone', first_name: 'Called Us',
      },
    });
    const id = (JSON.parse(lead.body) as { id: string }).id;
    const res = await app!.inject({
      method: 'GET',
      url: `/api/v1/leads/${id}/compliance?channel=voice&scope=ai_outbound_call&originator=ai`,
      headers: { cookie },
    });
    expect(JSON.parse(res.body)).toMatchObject({ status: 'blocked' });
  });
});

describe('the window is compared in ONE shape (F-76): partial saves once a row exists', () => {
  // Its own organization: the rows above hold 10:00–20:00 and later cases
  // depend on that. A fresh org starts with no row, like every new tenant.
  let freshOrgId = '';
  type Detail = { path?: string; code: string; message: string };
  const put = (payload: Record<string, unknown>) =>
    app!.inject({ method: 'PUT', url: `/api/v1/organizations/${freshOrgId}/comms-config`, headers: { cookie }, payload });
  const details = (body: string): Detail[] =>
    (JSON.parse(body) as { error: { details?: Detail[] } }).error.details ?? [];

  it('a start-only PUT after a cap-only PUT keeps the default end and is NOT "too wide"', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const org = await app!.inject({
      method: 'POST', url: '/api/v1/organizations', headers: { cookie },
      payload: { name: 'Groupe F15 Fenêtre', slug: `groupe-f15-fenetre-${run}` },
    });
    expect(org.statusCode, org.body).toBe(201);
    freshOrgId = (JSON.parse(org.body) as { id: string }).id;

    // The Automations page's first save on a fresh org: one field, the row is
    // INSERTed with the DB defaults — end stored as the `time` 21:00:00.
    const cap = await put({ bot_turn_cap: 8 });
    expect(cap.statusCode, cap.body).toBe(200);
    expect(JSON.parse(cap.body)).toMatchObject({ bot_turn_cap: 8, sms_quiet_end: '21:00:00' });

    // Then only the start. Before F-76: 422 window_too_wide, because the
    // stored '21:00:00' compared greater than the ceiling string '21:00'.
    const start = await put({ sms_quiet_start: '10:00' });
    expect(start.statusCode, start.body).toBe(200);
    expect(JSON.parse(start.body)).toMatchObject({ sms_quiet_start: '10:00:00', sms_quiet_end: '21:00:00' });
  });

  it('a one-field save on a narrowed row succeeds — the shape commsDiff sends', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const narrowed = await put({ sms_quiet_start: '10:00', sms_quiet_end: '20:00' });
    expect(narrowed.statusCode, narrowed.body).toBe(200);
    const toggle = await put({ first_touch_quiet_exempt: false });
    expect(toggle.statusCode, toggle.body).toBe(200);
    expect(JSON.parse(toggle.body)).toMatchObject({
      sms_quiet_start: '10:00:00', sms_quiet_end: '20:00:00', first_touch_quiet_exempt: false,
    });
  });

  it('a start equal to the stored end is refused on sms_quiet_end with invalid_window — not a 500', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Row is 10:00–20:00. Raw strings: '20:00' >= '20:00:00' is FALSE, so an
    // unnormalised pre-check would pass this to the CHECK and answer 500.
    const res = await put({ sms_quiet_start: '20:00' });
    expect(res.statusCode, res.body).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('validation_failed');
    expect(details(res.body)[0]).toMatchObject({ path: 'sms_quiet_end', code: 'invalid_window' });

    const after = await app!.inject({
      method: 'GET', url: `/api/v1/organizations/${freshOrgId}/comms-config`, headers: { cookie },
    });
    expect(JSON.parse(after.body)).toMatchObject({ sms_quiet_start: '10:00:00', sms_quiet_end: '20:00:00' });
  });

  it('an inverted or empty explicit window is refused the same way', async (ctx) => {
    if (!dbUp) return ctx.skip();
    for (const payload of [
      { sms_quiet_start: '12:00', sms_quiet_end: '11:00' },
      { sms_quiet_start: '10:00', sms_quiet_end: '10:00' },
    ]) {
      const res = await put(payload);
      expect(res.statusCode, JSON.stringify(payload) + ' ' + res.body).toBe(422);
      expect(details(res.body)[0]).toMatchObject({ path: 'sms_quiet_end', code: 'invalid_window' });
    }
  });

  it('the exact platform ceiling 09:00–21:00 is accepted — the copy’s numbers are the API’s', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await put({ sms_quiet_start: '09:00', sms_quiet_end: '21:00' });
    expect(res.statusCode, res.body).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ sms_quiet_start: '09:00:00', sms_quiet_end: '21:00:00' });
  });
});
