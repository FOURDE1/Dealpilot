import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, withTenant, type Pool,
} from '@dealpilot/db';
import { buildApp } from './app.js';
import { handleInboundSms } from './f18-inbound-sms.js';
import { recordInbound } from './f19-send.js';

/**
 * F-21 the agent console.
 *
 * The question this suite exists to answer is the one a console invites people
 * to get wrong: does a human typing the message change what the platform is
 * allowed to send? It does not, and the cases below are the ones where somebody
 * would expect it to — a person replying to somebody who texted STOP, a person
 * quoting a price, a person in another organisation opening the thread.
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
let rivalCookie = '';
let orgId = '';
let storeId = '';
let userId = '';

let phoneSeq = 300;
function nextPhone(): string {
  phoneSeq += 1;
  return `+1514555${String(phoneSeq).padStart(4, '0')}`;
}

async function fixture(): Promise<{ phone: string; conversationId: string }> {
  const phone = nextPhone();
  const consent = await app!.inject({
    method: 'POST', url: '/api/v1/consent', headers: { cookie },
    payload: {
      organization_id: orgId, phone_e164: phone,
      channels: ['sms'], scopes: ['conversational'],
      consent_type: 'express', source: 'staff_manual',
      evidence: { note: 'seeded for the console test' },
    },
  });
  expect(consent.statusCode, consent.body).toBe(201);
  const conversationId = await withTenant(appPool, orgId, async (c) => {
    const r = await c.query<{ id: string }>(
      `INSERT INTO conversations (organization_id, store_id, phone_e164) VALUES ($1,$2,$3) RETURNING id`,
      [orgId, storeId, phone],
    );
    return r.rows[0]!.id;
  });
  return { phone, conversationId };
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

  const email = `f21-${run}@dealpilot.test`;
  const su = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email, password: 'correct-horse-battery-staple', name: 'Sophie Tremblay' },
  });
  cookie = (Array.isArray(su.headers['set-cookie']) ? su.headers['set-cookie'] : [su.headers['set-cookie']!])
    .map((c) => c!.split(';')[0]).join('; ');

  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe F21', slug: `groupe-f21-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;

  const s = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Rooftop', code: `F21-${run.slice(-4)}`, province: 'QC' },
  });
  storeId = (JSON.parse(s.body) as { id: string }).id;
  userId = (await admin.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email])).rows[0]!.id;

  // A whole other dealership, with its own owner.
  const rival = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: `f21-rival-${run}@dealpilot.test`, password: 'correct-horse-battery-staple', name: 'Rival Rachel' },
  });
  rivalCookie = (Array.isArray(rival.headers['set-cookie']) ? rival.headers['set-cookie'] : [rival.headers['set-cookie']!])
    .map((c) => c!.split(';')[0]).join('; ');
  const rivalOrg = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie: rivalCookie },
    payload: { name: 'Rival F21', slug: `rival-f21-${run}` },
  });
  expect(rivalOrg.statusCode, rivalOrg.body).toBe(201);
});

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await admin?.end();
});

describe('the inbox', () => {
  it('lists this organisation’s conversations and filters them', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const a = await fixture();
    const b = await fixture();
    await app!.inject({
      method: 'POST', url: `/api/v1/conversations/${b.conversationId}/close`,
      headers: { cookie }, payload: {},
    });

    const all = await app!.inject({
      method: 'GET', url: `/api/v1/conversations?organization_id=${orgId}`, headers: { cookie },
    });
    expect(all.statusCode, all.body).toBe(200);
    const ids = (JSON.parse(all.body) as { items: { id: string }[] }).items.map((i) => i.id);
    expect(ids).toContain(a.conversationId);
    expect(ids).toContain(b.conversationId);

    const open = await app!.inject({
      method: 'GET', url: `/api/v1/conversations?organization_id=${orgId}&status=bot_active`,
      headers: { cookie },
    });
    const openIds = (JSON.parse(open.body) as { items: { id: string }[] }).items.map((i) => i.id);
    expect(openIds).toContain(a.conversationId);
    expect(openIds).not.toContain(b.conversationId);
  });

  it('opens one conversation with what the assistant thought, newest first', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    await withTenant(appPool, orgId, async (c) => {
      for (const [type, score, summary] of [
        ['handoff_summary', 'warm', 'Premier contact, budget inconnu.'],
        ['live_update', 'hot', 'Vient de demander un essai routier.'],
      ] as const) {
        await c.query(
          `INSERT INTO conversation_analysis
             (organization_id, store_id, conversation_id, analysis_type, sentiment,
              buying_signals, concerns, summary, score, score_reason)
           VALUES ($1,$2,$3,$4,'positive',$5,'{}',$6,$7,'test')`,
          [orgId, storeId, f.conversationId, type, ['essai routier'], summary, score],
        );
      }
    });

    const res = await app!.inject({
      method: 'GET', url: `/api/v1/conversations/${f.conversationId}`, headers: { cookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = JSON.parse(res.body) as {
      conversation: { id: string; status: string; phone_e164: string };
      analysis: { analysis_type: string; score: string; buying_signals: string[] }[];
    };
    expect(body.conversation).toMatchObject({ id: f.conversationId, status: 'bot_active', phone_e164: f.phone });
    // Newest first: the panel shows what the assistant thinks NOW at the top,
    // and the handoff summary underneath it rather than the other way round.
    expect(body.analysis.map((a) => a.analysis_type)).toEqual(['live_update', 'handoff_summary']);
    expect(body.analysis[0]!.buying_signals).toEqual(['essai routier']);
  });

  it('shows the thread with the consent each message relied on', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    await withTenant(appPool, orgId, (c) =>
      recordInbound(c, {
        organizationId: orgId, conversationId: f.conversationId,
        body: 'Est-ce que le Sorento est encore disponible?', providerRef: `SM-${crypto.randomUUID()}`,
      }),
    );
    const sent = await app!.inject({
      method: 'POST', url: `/api/v1/conversations/${f.conversationId}/messages`,
      headers: { cookie }, payload: { body: 'Oui! Quand voulez-vous le voir?' },
    });
    expect(sent.statusCode, sent.body).toBe(200);
    expect(JSON.parse(sent.body)).toMatchObject({ kind: 'sent' });

    const thread = await app!.inject({
      method: 'GET', url: `/api/v1/conversations/${f.conversationId}/messages`, headers: { cookie },
    });
    const items = (JSON.parse(thread.body) as {
      items: { direction: string; sender_type: string; consent_ledger_id: string | null }[];
    }).items;
    expect(items).toHaveLength(2);
    const outbound = items.find((m) => m.direction === 'outbound')!;
    const inbound = items.find((m) => m.direction === 'inbound')!;
    expect(outbound.sender_type).toBe('agent');
    // The console can show an auditor the basis for the reply without a
    // database session — and the inbound message has none, because they wrote
    // to us.
    expect(outbound.consent_ledger_id).not.toBeNull();
    expect(inbound.consent_ledger_id).toBeNull();
  });
});

describe('a person is not an exemption', () => {
  it('will not let an agent message somebody who texted STOP', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    await withTenant(appPool, orgId, (c) =>
      handleInboundSms(c, {
        organizationId: orgId, storeId, phoneE164: f.phone, body: 'STOP', messageRef: 'SM-stop',
      }),
    );

    const res = await app!.inject({
      method: 'POST', url: `/api/v1/conversations/${f.conversationId}/messages`,
      headers: { cookie }, payload: { body: 'Juste un dernier message, promis!' },
    });
    // 200, not an error: well-formed request, and the answer is "no, and here
    // is why". A red toast would teach the agent nothing.
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { kind: string; reason: string; remedy: string };
    expect(body).toMatchObject({ kind: 'blocked', reason: 'suppressed' });
    expect(body.remedy).toMatch(/START/);

    const msgs = await admin.query(
      `SELECT id FROM messages WHERE conversation_id = $1`, [f.conversationId],
    );
    expect(msgs.rows).toHaveLength(0);
  });

  it('will not let an agent quote a price or promise approval', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    const res = await app!.inject({
      method: 'POST', url: `/api/v1/conversations/${f.conversationId}/messages`,
      headers: { cookie }, payload: { body: 'Vous êtes approuvé! 24 995 $ à 4,9 %.' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { kind: string; violations: { kind: string }[] };
    expect(body.kind).toBe('unsafe');
    expect(body.violations.map((v) => v.kind)).toContain('approval_promise');

    const msgs = await admin.query(
      `SELECT id FROM messages WHERE conversation_id = $1`, [f.conversationId],
    );
    expect(msgs.rows).toHaveLength(0);
  });

  it('records a decision for the agent’s refused send, same as the assistant’s', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    await withTenant(appPool, orgId, (c) =>
      handleInboundSms(c, {
        organizationId: orgId, storeId, phoneE164: f.phone, body: 'STOP', messageRef: 'SM-stop-2',
      }),
    );
    await app!.inject({
      method: 'POST', url: `/api/v1/conversations/${f.conversationId}/messages`,
      headers: { cookie }, payload: { body: 'Bonjour?' },
    });
    const d = await admin.query<{ status: string; reason: string; originator: string }>(
      `SELECT status, reason, originator FROM send_decisions
       WHERE organization_id = $1 AND phone_e164 = $2`,
      [orgId, f.phone],
    );
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0]).toMatchObject({ status: 'blocked', reason: 'suppressed', originator: 'human' });
  });
});

describe('taking and closing', () => {
  it('a reply takes the conversation, so the assistant stops', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    await app!.inject({
      method: 'POST', url: `/api/v1/conversations/${f.conversationId}/messages`,
      headers: { cookie }, payload: { body: 'Bonjour, je prends le relais.' },
    });
    const conv = await admin.query<{ status: string; assigned_agent_id: string }>(
      `SELECT status, assigned_agent_id FROM conversations WHERE id = $1`, [f.conversationId],
    );
    // A thread with a human reply in it that still said bot_active would put
    // the assistant straight back on top of the customer.
    expect(conv.rows[0]).toMatchObject({ status: 'agent_active', assigned_agent_id: userId });
  });

  it('takeover assigns it and leaves a trail', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    const res = await app!.inject({
      method: 'POST', url: `/api/v1/conversations/${f.conversationId}/takeover`,
      headers: { cookie }, payload: {},
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ status: 'agent_active', assigned_agent_id: userId });

    const ev = await admin.query<{ action: string }>(
      `SELECT action FROM activity_events WHERE entity_type = 'conversation' AND entity_id = $1`,
      [f.conversationId],
    );
    expect(ev.rows.map((r) => r.action)).toContain('assigned');
  });

  it('closes a conversation without suppressing the customer', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    const res = await app!.inject({
      method: 'POST', url: `/api/v1/conversations/${f.conversationId}/close`,
      headers: { cookie }, payload: { reason: 'vendu' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const closed = JSON.parse(res.body) as { status: string; closed_at: string | null };
    expect(closed.status).toBe('closed');
    expect(closed.closed_at).not.toBeNull();

    // Closing is OUR view of the conversation. It is not the customer
    // withdrawing consent, and must never be recorded as though it were.
    const sup = await admin.query(
      `SELECT id FROM suppression_list WHERE organization_id = $1 AND phone_e164 = $2`,
      [orgId, f.phone],
    );
    expect(sup.rows).toHaveLength(0);
    const live = await admin.query(
      `SELECT id FROM consent_ledger
       WHERE organization_id = $1 AND phone_e164 = $2 AND revoked_at IS NULL`,
      [orgId, f.phone],
    );
    expect(live.rows.length).toBeGreaterThan(0);
  });

  it('refuses to reply on a closed conversation', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    await app!.inject({
      method: 'POST', url: `/api/v1/conversations/${f.conversationId}/close`,
      headers: { cookie }, payload: {},
    });
    const res = await app!.inject({
      method: 'POST', url: `/api/v1/conversations/${f.conversationId}/messages`,
      headers: { cookie }, payload: { body: 'Encore une chose…' },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('another dealership', () => {
  it('cannot read, reply to, take or close this conversation', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    const gets = [
      `/api/v1/conversations/${f.conversationId}`,
      `/api/v1/conversations/${f.conversationId}/messages`,
    ];
    const posts: [string, Record<string, unknown>][] = [
      [`/api/v1/conversations/${f.conversationId}/messages`, { body: 'Bonjour' }],
      [`/api/v1/conversations/${f.conversationId}/takeover`, {}],
      [`/api/v1/conversations/${f.conversationId}/close`, {}],
    ];
    const attempts = [
      ...gets.map((url) => ({ label: `GET ${url}`, res: app!.inject({ method: 'GET' as const, url, headers: { cookie: rivalCookie } }) })),
      ...posts.map(([url, payload]) => ({ label: `POST ${url}`, res: app!.inject({ method: 'POST' as const, url, headers: { cookie: rivalCookie }, payload }) })),
    ];
    for (const attempt of attempts) {
      const res = await attempt.res;
      // 404, never 403: an id that answers differently for an outsider tells
      // them the id is real.
      expect(res.statusCode, `${attempt.label} → ${res.body}`).toBe(404);
    }

    const msgs = await admin.query(
      `SELECT id FROM messages WHERE conversation_id = $1`, [f.conversationId],
    );
    expect(msgs.rows).toHaveLength(0);
  });

  it('sees none of them in its own inbox', async (ctx) => {
    if (!dbUp) return ctx.skip();
    await fixture();
    const res = await app!.inject({
      method: 'GET', url: '/api/v1/conversations', headers: { cookie: rivalCookie },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((JSON.parse(res.body) as { items: unknown[] }).items).toHaveLength(0);
  });
});
