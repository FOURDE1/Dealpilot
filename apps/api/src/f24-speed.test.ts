import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, withTenant, type Pool,
} from '@dealpilot/db';
import { buildApp } from './app.js';
import { sendMessage } from './f19-send.js';
import { routeInbound } from './f23-inbound-router.js';

/**
 * F-24 speed to lead (leads.md §5, ADR-025).
 *
 * The legacy system made this a button: "Log First Contact", pressed by a
 * salesperson who had just finished a phone call. That is a fair part of why
 * 43.2% of automotive leads are mishandled — the metric measured remembering,
 * not answering.
 *
 * So the case that matters here is the one nobody writes: a message goes out
 * and the lead is stamped, with nothing in the send path asking for it.
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
let storeId = '';

const MIDDAY = new Date('2026-08-13T18:00:00Z');

let phoneSeq = 500;
function nextPhone(): string {
  phoneSeq += 1;
  return `+1514555${String(phoneSeq).padStart(4, '0')}`;
}

/** A consented lead with a live conversation, created N seconds ago. */
async function lead(agedSeconds = 0): Promise<{ phone: string; leadId: string; conversationId: string }> {
  const phone = nextPhone();
  const consent = await app!.inject({
    method: 'POST', url: '/api/v1/consent', headers: { cookie },
    payload: {
      organization_id: orgId, phone_e164: phone,
      channels: ['sms'], scopes: ['conversational'],
      consent_type: 'express', source: 'staff_manual',
      evidence: { note: 'seeded for the speed test' },
    },
  });
  expect(consent.statusCode, consent.body).toBe(201);

  const res = await app!.inject({
    method: 'POST', url: '/api/v1/leads', headers: { cookie },
    payload: {
      organization_id: orgId, store_id: storeId, phone,
      first_name: 'Marie', source: 'website', preferred_language: 'fr-CA',
    },
  });
  const leadId = (JSON.parse(res.body) as { id: string }).id;
  if (agedSeconds > 0) {
    await admin.query(
      `UPDATE leads SET created_at = now() - make_interval(secs => $2) WHERE id = $1`,
      [leadId, agedSeconds],
    );
  }
  const r = await withTenant(appPool, orgId, (c) =>
    routeInbound(c, {
      organizationId: orgId, storeId, phoneE164: phone,
      body: 'Bonjour, je suis intéressée.', providerRef: `SM-speed-${crypto.randomUUID()}`,
    }),
  );
  return { phone, leadId, conversationId: r.conversationId };
}

async function reply(f: { phone: string; leadId: string; conversationId: string }, who: 'bot' | 'agent') {
  const out = await withTenant(appPool, orgId, (c) =>
    sendMessage(c, {
      organizationId: orgId, storeId, conversationId: f.conversationId, leadId: f.leadId,
      phoneE164: f.phone, body: 'Bonjour! Quand souhaitez-vous passer?',
      senderType: who, messageClass: 'inbound_reply', scope: 'conversational',
      isSolicitation: false, nowUtc: MIDDAY,
    }),
  );
  expect(out.kind).toBe('sent');
  return out;
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
    payload: { email: `f24-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Sophie' },
  });
  cookie = (Array.isArray(su.headers['set-cookie']) ? su.headers['set-cookie'] : [su.headers['set-cookie']!])
    .map((c) => c!.split(';')[0]).join('; ');
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe F24', slug: `groupe-f24-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const s = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Rooftop', code: `F24-${run.slice(-4)}`, province: 'QC' },
  });
  storeId = (JSON.parse(s.body) as { id: string }).id;
});

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await admin?.end();
});

describe('the clock nobody has to remember to start', () => {
  it('stamps the lead when a message goes out, with nothing asking it to', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await lead(90);

    const before = await admin.query<{ first_contacted_at: Date | null; contact_attempts: number }>(
      `SELECT first_contacted_at, contact_attempts FROM leads WHERE id = $1`, [f.leadId],
    );
    // The inbound message is THEIRS. Being written to is not being answered.
    expect(before.rows[0]).toMatchObject({ first_contacted_at: null, contact_attempts: 0 });

    await reply(f, 'bot');

    const after = await admin.query<{
      first_contacted_at: Date | null; last_contacted_at: Date | null;
      response_time_seconds: number | null; contact_attempts: number;
    }>(
      `SELECT first_contacted_at, last_contacted_at, response_time_seconds, contact_attempts
       FROM leads WHERE id = $1`,
      [f.leadId],
    );
    expect(after.rows[0]!.first_contacted_at).toBeInstanceOf(Date);
    expect(after.rows[0]!.contact_attempts).toBe(1);
    // Created 90 seconds ago, answered now.
    expect(after.rows[0]!.response_time_seconds).toBeGreaterThanOrEqual(89);
    expect(after.rows[0]!.response_time_seconds).toBeLessThan(120);
  });

  it('keeps the FIRST contact first, and counts the rest', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await lead(30);
    await reply(f, 'bot');
    const first = await admin.query<{ first_contacted_at: Date; response_time_seconds: number }>(
      `SELECT first_contacted_at, response_time_seconds FROM leads WHERE id = $1`, [f.leadId],
    );

    await reply(f, 'agent');
    const second = await admin.query<{
      first_contacted_at: Date; last_contacted_at: Date;
      response_time_seconds: number; contact_attempts: number;
    }>(
      `SELECT first_contacted_at, last_contacted_at, response_time_seconds, contact_attempts
       FROM leads WHERE id = $1`,
      [f.leadId],
    );
    // A second message must not restate the response time as though the lead
    // had just been answered — that would turn every slow lead into a fast one
    // on the next follow-up.
    expect(second.rows[0]!.response_time_seconds).toBe(first.rows[0]!.response_time_seconds);
    expect(second.rows[0]!.first_contacted_at.getTime()).toBe(first.rows[0]!.first_contacted_at.getTime());
    expect(second.rows[0]!.contact_attempts).toBe(2);
    expect(second.rows[0]!.last_contacted_at.getTime())
      .toBeGreaterThanOrEqual(first.rows[0]!.first_contacted_at.getTime());
  });

  it('does not stamp a lead for a message the gate refused', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await lead(10);
    await withTenant(appPool, orgId, (c) =>
      routeInbound(c, {
        organizationId: orgId, storeId, phoneE164: f.phone, body: 'STOP', providerRef: `SM-x-${crypto.randomUUID()}`,
      }),
    );
    const out = await withTenant(appPool, orgId, (c) =>
      sendMessage(c, {
        organizationId: orgId, storeId, conversationId: f.conversationId, leadId: f.leadId,
        phoneE164: f.phone, body: 'Bonjour?', senderType: 'bot', messageClass: 'inbound_reply',
        scope: 'conversational', isSolicitation: false, nowUtc: MIDDAY,
      }),
    );
    expect(out.kind).toBe('blocked');
    const after = await admin.query<{ first_contacted_at: Date | null; contact_attempts: number }>(
      `SELECT first_contacted_at, contact_attempts FROM leads WHERE id = $1`, [f.leadId],
    );
    // A message that was never sent is not a contact. The stamp hangs off the
    // messages row, so a refused send leaves no trace here by construction.
    expect(after.rows[0]).toMatchObject({ first_contacted_at: null, contact_attempts: 0 });
  });
});

describe('the clock the reassignment ladder counts from', () => {
  it('starts when somebody becomes responsible, and stops when nobody is', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await lead(5);
    const me = (await admin.query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1`, [`f24-${run}@dealpilot.test`],
    )).rows[0]!.id;

    const before = await admin.query<{ assigned_at: Date | null }>(
      `SELECT assigned_at FROM leads WHERE id = $1`, [f.leadId],
    );
    expect(before.rows[0]!.assigned_at).toBeNull();

    const assigned = await app!.inject({
      method: 'PATCH', url: `/api/v1/leads/${f.leadId}`,
      headers: { cookie }, payload: { assigned_to: me },
    });
    expect(assigned.statusCode, assigned.body).toBe(200);
    const owned = await admin.query<{ assigned_at: Date | null }>(
      `SELECT assigned_at FROM leads WHERE id = $1`, [f.leadId],
    );
    // §5.2 counts ten minutes from HERE, not from when the lead arrived.
    expect(owned.rows[0]!.assigned_at).toBeInstanceOf(Date);

    const dropped = await app!.inject({
      method: 'PATCH', url: `/api/v1/leads/${f.leadId}`,
      headers: { cookie }, payload: { assigned_to: null },
    });
    expect(dropped.statusCode, dropped.body).toBe(200);
    const free = await admin.query<{ assigned_at: Date | null }>(
      `SELECT assigned_at FROM leads WHERE id = $1`, [f.leadId],
    );
    // A lead nobody owns has no clock; leaving the old stamp would age it
    // against a person who no longer has it.
    expect(free.rows[0]!.assigned_at).toBeNull();
  });

  it('does not restart when an unrelated field changes', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await lead(5);
    const me = (await admin.query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1`, [`f24-${run}@dealpilot.test`],
    )).rows[0]!.id;
    await app!.inject({
      method: 'PATCH', url: `/api/v1/leads/${f.leadId}`,
      headers: { cookie }, payload: { assigned_to: me },
    });
    const first = await admin.query<{ assigned_at: Date }>(
      `SELECT assigned_at FROM leads WHERE id = $1`, [f.leadId],
    );

    await app!.inject({
      method: 'PATCH', url: `/api/v1/leads/${f.leadId}`,
      headers: { cookie }, payload: { vehicle_interest: 'Sorento EX 2024' },
    });
    const after = await admin.query<{ assigned_at: Date }>(
      `SELECT assigned_at FROM leads WHERE id = $1`, [f.leadId],
    );
    // Editing a note is not a reassignment. Restarting the clock here would
    // hand an agent an extra ten minutes for typing.
    expect(after.rows[0]!.assigned_at.getTime()).toBe(first.rows[0]!.assigned_at.getTime());
  });
});

describe('the store’s day', () => {
  it('reports the bands, the median, and the assistant’s SLO separately', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const fast = await lead(20);
    await reply(fast, 'bot');
    const slow = await lead(2000);
    await reply(slow, 'agent');
    await lead(60); // written to us, never answered

    const res = await app!.inject({
      method: 'GET', url: `/api/v1/leads/speed-to-lead?organization_id=${orgId}&store_id=${storeId}`,
      headers: { cookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = JSON.parse(res.body) as {
      contacted: number; uncontacted: number;
      by_rating: Record<string, number>;
      median_seconds: number | null; ai_within_slo: number; ai_touches: number;
    };
    expect(body.contacted).toBeGreaterThanOrEqual(2);
    expect(body.uncontacted).toBeGreaterThanOrEqual(1);
    expect(body.by_rating['excellent']).toBeGreaterThanOrEqual(1);
    expect(body.by_rating['slow']).toBeGreaterThanOrEqual(1);
    // A person answering fast says nothing about whether the ASSISTANT is
    // meeting its 60-second service level, so the two are counted apart.
    expect(body.ai_touches).toBeGreaterThanOrEqual(1);
    expect(body.ai_within_slo).toBeGreaterThanOrEqual(1);
    expect(body.median_seconds).not.toBeNull();
  });

  it('is another organisation’s business, not ours', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const rival = await app!.inject({
      method: 'POST', url: '/api/auth/sign-up/email',
      payload: { email: `f24-rival-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Rival' },
    });
    const rivalCookie = (Array.isArray(rival.headers['set-cookie']) ? rival.headers['set-cookie'] : [rival.headers['set-cookie']!])
      .map((c) => c!.split(';')[0]).join('; ');
    await app!.inject({
      method: 'POST', url: '/api/v1/organizations', headers: { cookie: rivalCookie },
      payload: { name: 'Rival F24', slug: `rival-f24-${run}` },
    });

    const res = await app!.inject({
      method: 'GET', url: `/api/v1/leads/speed-to-lead?organization_id=${orgId}`,
      headers: { cookie: rivalCookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
