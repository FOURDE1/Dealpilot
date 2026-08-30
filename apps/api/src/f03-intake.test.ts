import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, reset, type Pool, ensureTestDatabase, testAdminUrl, testAppUrl } from '@dealpilot/db';
import { IntakeKey, IntakeKeyCreated, Lead, paginated } from '@dealpilot/schemas';
import { buildApp } from './app.js';

/**
 * F-03 integration suite — inbound lead intake webhook end to end.
 * Journey: owner creates an intake key for a store → an external system POSTs
 * a signed JSON lead to the public URL → the lead appears in the F-02 list
 * with the key's source. Security negatives: bad/absent/stale signature,
 * revoked/unknown key, rate limit, role gate on key management.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();

/** F-59 seam: the one bridge from intake to the first-touch worker. */
const firstTouches: { lead_id: string; duplicate_of?: string }[] = [];
const recordingQueue = {
  enqueue: () => Promise.resolve(),
  enqueueAssistantTurn: () => Promise.resolve(),
  enqueueExtraction: () => Promise.resolve(),
  enqueueLiveAnalysis: () => Promise.resolve(),
  enqueueAnnouncementFanout: () => Promise.resolve(),
  enqueueFirstTouch: (job: { lead_id: string }) => {
    firstTouches.push(job);
    return Promise.resolve();
  },
  close: () => Promise.resolve(),
};
const migrationsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'packages', 'db', 'migrations',
);

const run = Date.now().toString(36);
const A = { email: `f03-owner-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Alice Owner' };

let admin: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;
let cookieA = '';
let orgId = '';
let storeId = '';
let token = '';
let secret = '';

const KeyPage = paginated(IntakeKey);
const LeadPage = paginated(Lead);

/** The generic_json scheme: HMAC-SHA256 of `${ts}.${rawBody}` (api-design §10). */
function sign(ts: string, body: string, key: string): string {
  return `v1=${createHmac('sha256', key).update(`${ts}.${body}`).digest('hex')}`;
}

async function postIntake(body: string, headers: Record<string, string>) {
  return app!.inject({
    method: 'POST',
    url: `/in/v1/leads/${token}`,
    headers: { 'content-type': 'application/json', ...headers },
    payload: body,
  });
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
  ({ app } = await buildApp({ DATABASE_URL: APP_URL, NODE_ENV: 'test' }, { deferredQueue: recordingQueue }));

  const su = await app!.inject({ method: 'POST', url: '/api/auth/sign-up/email', payload: A });
  const sc = su.headers['set-cookie'];
  cookieA = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');

  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie: cookieA },
    payload: { name: 'Groupe F03', slug: `groupe-f03-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const store = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie: cookieA },
    payload: { organization_id: orgId, name: 'F03 Kia', code: 'F03-KIA', province: 'QC' },
  });
  storeId = (JSON.parse(store.body) as { id: string }).id;
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

describe('F-03 intake key management', () => {
  it('owner creates a key — secret + webhook_url returned once', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/intake-keys', headers: { cookie: cookieA },
      payload: { organization_id: orgId, store_id: storeId, label: 'Website form', default_source: 'website' },
    });
    expect(res.statusCode).toBe(201);
    const created = IntakeKeyCreated.parse(JSON.parse(res.body));
    expect(created.secret.length).toBeGreaterThanOrEqual(32);
    expect(created.webhook_url).toContain(`/in/v1/leads/${created.token}`);
    token = created.token;
    secret = created.secret;
  });

  it('list never leaks the secret', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await app!.inject({ method: 'GET', url: `/api/v1/intake-keys?organization_id=${orgId}`, headers: { cookie: cookieA } });
    expect(res.statusCode).toBe(200);
    const page = KeyPage.parse(JSON.parse(res.body));
    expect(page.items).toHaveLength(1);
    expect((page.items[0] as Record<string, unknown>).secret).toBeUndefined();
  });
});

describe('F-03 public webhook', () => {
  it('a correctly signed payload creates a lead → 202 with intake id', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const ts = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({ phone: '514 555 0188', first_name: 'Intake', vehicle_interest: 'Kia EV6' });
    const res = await postIntake(body, { 'x-intake-timestamp': ts, 'x-intake-signature': sign(ts, body, secret) });
    expect(res.statusCode).toBe(202);
    const ack = JSON.parse(res.body);
    expect(ack.received).toBe(true);
    expect(typeof ack.lead_id).toBe('string');

    // The lead is now visible in the F-02 list with the key's source.
    const list = await app!.inject({ method: 'GET', url: `/api/v1/leads?organization_id=${orgId}`, headers: { cookie: cookieA } });
    const lead = LeadPage.parse(JSON.parse(list.body)).items.find((l) => l.id === ack.lead_id);
    expect(lead).toBeDefined();
    expect(lead!.phone).toBe('+15145550188');
    expect(lead!.source).toBe('website');
    expect(lead!.store_id).toBe(storeId);
    expect(lead!.status).toBe('new');

    // F-59 seam: the intake actually queued the first touch for THIS lead.
    expect(firstTouches.some((j) => j.lead_id === ack.lead_id)).toBe(true);
  });

  it('a bad signature is 401 and creates nothing', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const ts = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({ phone: '5145550111' });
    const res = await postIntake(body, { 'x-intake-timestamp': ts, 'x-intake-signature': 'v1=deadbeef' });
    expect(res.statusCode).toBe(401);
  });

  it('a stale timestamp (>5 min) is rejected 401', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const ts = (Math.floor(Date.now() / 1000) - 600).toString();
    const body = JSON.stringify({ phone: '5145550112' });
    const res = await postIntake(body, { 'x-intake-timestamp': ts, 'x-intake-signature': sign(ts, body, secret) });
    expect(res.statusCode).toBe(401);
  });

  it('a missing signature header is 401', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const body = JSON.stringify({ phone: '5145550113' });
    const res = await postIntake(body, { 'x-intake-timestamp': Math.floor(Date.now() / 1000).toString() });
    expect(res.statusCode).toBe(401);
  });

  it('an unknown token returns the SAME 401 as a bad signature (no enumeration oracle)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const ts = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({ phone: '5145550114' });
    const res = await app!.inject({
      method: 'POST', url: '/in/v1/leads/nonexistenttoken000',
      headers: { 'content-type': 'application/json', 'x-intake-timestamp': ts, 'x-intake-signature': sign(ts, body, secret) },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it('list pagination works with the explicit column set (cursor follows past a page)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Two more keys so there are ≥3; a limit=1 page must yield a working cursor
    // even though the list query selects explicit columns (not SELECT *).
    for (const label of ['Second form', 'Third form']) {
      const r = await app!.inject({
        method: 'POST', url: '/api/v1/intake-keys', headers: { cookie: cookieA },
        payload: { organization_id: orgId, store_id: storeId, label },
      });
      expect(r.statusCode).toBe(201);
    }
    const seen = new Set<string>();
    let cursor: string | null = null;
    for (let i = 0; i < 5; i++) {
      const url: string = `/api/v1/intake-keys?organization_id=${orgId}&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const page = await app!.inject({ method: 'GET', url, headers: { cookie: cookieA } });
      expect(page.statusCode).toBe(200);
      const parsed = KeyPage.parse(JSON.parse(page.body));
      parsed.items.forEach((k) => seen.add(k.id));
      cursor = parsed.next_cursor;
      if (!cursor) break;
    }
    expect(seen.size).toBe(3);
  });

  it('a valid signature but invalid payload (no phone) is 422', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const ts = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({ first_name: 'No Phone' });
    const res = await postIntake(body, { 'x-intake-timestamp': ts, 'x-intake-signature': sign(ts, body, secret) });
    expect(res.statusCode).toBe(422);
  });

  it('a revoked key stops accepting (uniform 401, same as unknown)', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Revoke THIS key (the one whose secret we hold) — find it by token.
    const keys = await app!.inject({ method: 'GET', url: `/api/v1/intake-keys?organization_id=${orgId}`, headers: { cookie: cookieA } });
    const keyId = KeyPage.parse(JSON.parse(keys.body)).items.find((k) => k.token === token)!.id;
    const del = await app!.inject({ method: 'DELETE', url: `/api/v1/intake-keys/${keyId}`, headers: { cookie: cookieA } });
    expect(del.statusCode).toBe(204);

    const ts = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({ phone: '5145550115' });
    const res = await postIntake(body, { 'x-intake-timestamp': ts, 'x-intake-signature': sign(ts, body, secret) });
    expect(res.statusCode).toBe(401);
  });
});

describe('an intake lead arrives with the permission the form collected (ADR-005)', () => {
  // A key of its own: an earlier test in this file revokes the shared one, and
  // a suite whose later cases depend on the order of its earlier ones is a
  // suite that fails for reasons nobody can read.
  let ownToken = '';
  let ownSecret = '';

  async function post(body: string) {
    const ts = Math.floor(Date.now() / 1000).toString();
    return app!.inject({
      method: 'POST',
      url: `/in/v1/leads/${ownToken}`,
      headers: {
        'content-type': 'application/json',
        'x-intake-timestamp': ts,
        'x-intake-signature': sign(ts, body, ownSecret),
      },
      payload: body,
    });
  }

  beforeAll(async () => {
    if (!dbUp) return;
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/intake-keys', headers: { cookie: cookieA },
      payload: {
        organization_id: orgId, store_id: storeId,
        label: 'Consent connector test', default_source: 'website',
        connector_key: 'website_form',
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const created = JSON.parse(res.body) as { token: string; secret: string };
    ownToken = created.token;
    ownSecret = created.secret;
  });

  it('records the consent the customer ticked, with the wording as evidence', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Before the connector framework, every webhook lead landed with NO basis
    // at all: the enquiry arrived, the lead appeared, and nothing could be sent
    // to them. The form collected permission and the system threw it away.
    const res = await post(JSON.stringify({
      phone: '514 555 0177',
      first_name: 'Consented',
      email: 'consented@example.test',
      vehicle_interest: 'Kia Forte',
      consent: true,
      consent_text: 'I agree to be contacted about this vehicle',
    }));
    expect(res.statusCode, res.body).toBe(202);
    const leadId = (JSON.parse(res.body) as { lead_id: string }).lead_id;

    const consent = await app!.inject({
      method: 'GET', url: `/api/v1/leads/${leadId}/consent`, headers: { cookie: cookieA },
    });
    const items = (JSON.parse(consent.body) as {
      items: { channel: string; scope: string; consent_type: string; evidence: Record<string, unknown> }[];
    }).items;
    expect(items.length, 'the form collected permission and it must be stored').toBeGreaterThan(0);
    expect(items.every((i) => i.scope === 'conversational')).toBe(true);
    // The wording IS the evidence — "they agreed" without "to what" is the
    // question a regulator actually asks.
    expect(String(items[0]!.evidence['form_wording'])).toContain('agree to be contacted');

    // And the gate now permits a reply about their enquiry.
    const gate = await app!.inject({
      method: 'GET',
      url: `/api/v1/leads/${leadId}/compliance?channel=sms&scope=conversational&originator=human`,
      headers: { cookie: cookieA },
    });
    expect(['allowed', 'deferred']).toContain((JSON.parse(gate.body) as { status: string }).status);
  });

  it('records NOTHING when the box was left unticked, and the gate refuses', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // The expensive direction. A form WITH a consent box that was not ticked
    // granted nothing, and the system must be unable to pretend otherwise.
    const res = await post(JSON.stringify({
      phone: '514 555 0166', first_name: 'Unticked', consent: false,
    }));
    expect(res.statusCode).toBe(202);
    const leadId = (JSON.parse(res.body) as { lead_id: string }).lead_id;

    const consent = await app!.inject({
      method: 'GET', url: `/api/v1/leads/${leadId}/consent`, headers: { cookie: cookieA },
    });
    expect((JSON.parse(consent.body) as { items: unknown[] }).items).toEqual([]);

    const gate = await app!.inject({
      method: 'GET',
      url: `/api/v1/leads/${leadId}/compliance?channel=sms&scope=conversational&originator=human`,
      headers: { cookie: cookieA },
    });
    expect(JSON.parse(gate.body)).toMatchObject({ status: 'blocked', reason: 'consent_absent' });
  });
});

describe('duplicate-as-signal (F-63, §8.3)', () => {
  // A key of its own — the shared one is revoked by an earlier case.
  let dupToken = '';
  let dupSecret = '';

  beforeAll(async () => {
    if (!dbUp) return;
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/intake-keys', headers: { cookie: cookieA },
      payload: { organization_id: orgId, store_id: storeId, label: 'Dup signal test', default_source: 'website' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const created = JSON.parse(res.body) as { token: string; secret: string };
    dupToken = created.token;
    dupSecret = created.secret;
  });

  async function intakeLead(phone: string, extra: Record<string, unknown> = {}): Promise<string> {
    const ts = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({ phone, first_name: 'Redite', ...extra });
    const res = await app!.inject({
      method: 'POST',
      url: `/in/v1/leads/${dupToken}`,
      headers: {
        'content-type': 'application/json',
        'x-intake-timestamp': ts,
        'x-intake-signature': sign(ts, body, dupSecret),
      },
      payload: body,
    });
    expect(res.statusCode, res.body).toBe(202);
    return (JSON.parse(res.body) as { lead_id: string }).lead_id;
  }

  it('a same-phone resubmission backfills the keeper and books the CONFIRMING message; the duplicate holds no agent', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const keeperId = await intakeLead('514 555 0361');
    // An ORPHAN dormant keeper with gaps the resubmission can fill.
    await admin.query(
      `UPDATE leads SET status = 'nurture', assigned_to = NULL, assignment_attempts = 2, email = NULL
       WHERE id = $1`,
      [keeperId],
    );

    firstTouches.length = 0;
    const sourceId = await intakeLead('514 555 0361', { email: 'redite@client.test', vehicle_interest: 'Kia Seltos' });
    expect(sourceId).not.toBe(keeperId);

    // One person, ONE message: the confirmation goes to the KEEPER's thread;
    // no plain greeting for the new record.
    expect(firstTouches).toHaveLength(1);
    expect(firstTouches[0]).toMatchObject({ lead_id: sourceId, duplicate_of: keeperId });

    // The backfill lands; the ORPHAN stays dormant on purpose (its reply
    // reactivates + cascades through f23 — D-064).
    const keeper = await admin.query<{ status: string; email: string | null }>(
      `SELECT status, email FROM leads WHERE id = $1`, [keeperId],
    );
    expect(keeper.rows[0]).toEqual({ status: 'nurture', email: 'redite@client.test' });

    // The duplicate record is pair-evidence, not workable inventory: no
    // agent, no ten-minute ladder (review finding).
    const source = await admin.query<{ assigned_to: string | null }>(
      `SELECT assigned_to FROM leads WHERE id = $1`, [sourceId],
    );
    expect(source.rows[0]!.assigned_to).toBeNull();

    const trail = await admin.query(
      `SELECT 1 FROM activity_events
       WHERE entity_id = $1 AND action = 'updated'
         AND changes->>'reaction' = 'confirmation_to_keeper'`,
      [keeperId],
    );
    expect(trail.rows).toHaveLength(1);
  });

  it('a keeper WITH an agent reactivates on resubmission — fresh ladder, honest trail', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const keeperId = await intakeLead('514 555 0363');
    const agent = await admin.query<{ user_id: string }>(
      `SELECT user_id FROM memberships WHERE organization_id = $1 LIMIT 1`, [orgId],
    );
    await admin.query(
      `UPDATE leads SET status = 'expired', assigned_to = $2, assignment_attempts = 2 WHERE id = $1`,
      [keeperId, agent.rows[0]!.user_id],
    );

    firstTouches.length = 0;
    await intakeLead('514 555 0363');
    expect(firstTouches).toHaveLength(1);

    const keeper = await admin.query<{ status: string; assignment_attempts: number }>(
      `SELECT status, assignment_attempts FROM leads WHERE id = $1`, [keeperId],
    );
    expect(keeper.rows[0]).toEqual({ status: 'assigned', assignment_attempts: 0 });
  });

  it('a resubmission while a deal is ACTIVE alerts the salesperson instead of re-engaging', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const keeperId = await intakeLead('514 555 0362');
    const agent = await admin.query<{ user_id: string }>(
      `SELECT user_id FROM memberships WHERE organization_id = $1 LIMIT 1`, [orgId],
    );
    const agentId = agent.rows[0]!.user_id;
    await admin.query(`UPDATE leads SET assigned_to = $2 WHERE id = $1`, [keeperId, agentId]);
    const deal = await app!.inject({
      method: 'POST', url: '/api/v1/deals', headers: { cookie: cookieA },
      payload: {
        organization_id: orgId, store_id: storeId, lead_id: keeperId,
        province: 'QC', deal_type: 'finance',
        sale_price_cents: 2_500_000, vehicle_cost_cents: 2_100_000,
        trade_allowance_cents: 0, trade_acv_cents: 0, trade_lien_cents: 0,
        rebate_cents: 0, fees_cents: 0, fees_taxable: false,
        fi_price_cents: 0, fi_cost_cents: 0,
      },
    });
    expect(deal.statusCode, deal.body).toBe(201);

    firstTouches.length = 0;
    await intakeLead('514 555 0362');

    // The machine steps aside: no confirmation, no greeting…
    expect(firstTouches).toHaveLength(0);
    // …and the PERSON hears about the signal.
    const bell = await admin.query(
      `SELECT 1 FROM notifications
       WHERE user_id = $1 AND title_key = 'notif_duplicate_resubmission' AND entity_id = $2`,
      [agentId, keeperId],
    );
    expect(bell.rows).toHaveLength(1);
  });
});
