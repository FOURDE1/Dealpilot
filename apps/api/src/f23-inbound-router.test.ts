import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, withTenant, type Pool,
} from '@dealpilot/db';
import { buildApp } from './app.js';
import { routeInbound } from './f23-inbound-router.js';

/**
 * F-23 the inbound router (conversation-engine.md §12).
 *
 * Every case here is a fork in the same road: the same text arrives, and where
 * it goes depends on what the platform already knows about the person who sent
 * it. The one that matters most is the quiet one — a number on the stop list
 * texting something ordinary must be FILED, not answered, because handing it to
 * the assistant would spend a model call on a message the gate will refuse and
 * would read, afterwards, like an attempt to re-engage somebody who opted out.
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
let userId = '';

let phoneSeq = 400;
function nextPhone(): string {
  phoneSeq += 1;
  return `+1514555${String(phoneSeq).padStart(4, '0')}`;
}

async function seedConsent(phone: string) {
  const res = await app!.inject({
    method: 'POST', url: '/api/v1/consent', headers: { cookie },
    payload: {
      organization_id: orgId, phone_e164: phone,
      channels: ['sms'], scopes: ['conversational'],
      consent_type: 'express', source: 'staff_manual',
      evidence: { note: 'seeded for the router test' },
    },
  });
  expect(res.statusCode, res.body).toBe(201);
}

function inbound(phone: string, body: string, providerRef = 'SM-r') {
  return { organizationId: orgId, storeId, phoneE164: phone, body, providerRef };
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

  const email = `f23-${run}@dealpilot.test`;
  const su = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email, password: 'correct-horse-battery-staple', name: 'Sophie Tremblay' },
  });
  cookie = (Array.isArray(su.headers['set-cookie']) ? su.headers['set-cookie'] : [su.headers['set-cookie']!])
    .map((c) => c!.split(';')[0]).join('; ');

  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe F23', slug: `groupe-f23-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const s = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Rooftop', code: `F23-${run.slice(-4)}`, province: 'QC' },
  });
  storeId = (JSON.parse(s.body) as { id: string }).id;
  userId = (await admin.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email])).rows[0]!.id;
});

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await admin?.end();
});

describe('a text from somebody new', () => {
  it('opens one conversation and files the message in it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const phone = nextPhone();
    const r = await withTenant(appPool, orgId, (c) =>
      routeInbound(c, inbound(phone, 'Bonjour, le Sorento est-il disponible?')),
    );
    expect(r.kind).toBe('to_assistant');

    const conv = await admin.query<{ id: string; status: string; store_id: string }>(
      `SELECT id, status, store_id FROM conversations WHERE organization_id = $1 AND phone_e164 = $2`,
      [orgId, phone],
    );
    expect(conv.rows).toHaveLength(1);
    expect(conv.rows[0]).toMatchObject({ status: 'bot_active', store_id: storeId });

    const msg = await admin.query<{ direction: string; body: string }>(
      `SELECT direction, body FROM messages WHERE conversation_id = $1`, [r.conversationId],
    );
    expect(msg.rows).toHaveLength(1);
    expect(msg.rows[0]).toMatchObject({ direction: 'inbound' });
  });

  it('keeps one live conversation per number, however many times they write', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const phone = nextPhone();
    const first = await withTenant(appPool, orgId, (c) => routeInbound(c, inbound(phone, 'Allo?')));
    const second = await withTenant(appPool, orgId, (c) => routeInbound(c, inbound(phone, 'Toujours là?')));
    expect(second.conversationId).toBe(first.conversationId);

    const conv = await admin.query(
      `SELECT id FROM conversations WHERE organization_id = $1 AND phone_e164 = $2`, [orgId, phone],
    );
    expect(conv.rows).toHaveLength(1);
    const msgs = await admin.query(
      `SELECT id FROM messages WHERE conversation_id = $1`, [first.conversationId],
    );
    expect(msgs.rows).toHaveLength(2);
  });

  it('joins the lead already on file for that number', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const phone = nextPhone();
    const lead = await app!.inject({
      method: 'POST', url: '/api/v1/leads', headers: { cookie },
      payload: {
        organization_id: orgId, store_id: storeId, phone,
        first_name: 'Marie', source: 'website', preferred_language: 'fr-CA',
      },
    });
    const leadId = (JSON.parse(lead.body) as { id: string }).id;

    const r = await withTenant(appPool, orgId, (c) => routeInbound(c, inbound(phone, 'Bonjour!')));
    // Without this the console shows a phone number instead of a name, and the
    // daily assistant cap counts the thread rather than the person.
    expect(r).toMatchObject({ kind: 'to_assistant', leadId });
  });
});

describe('a text that says STOP', () => {
  it('opts them out, files the words that did it, and closes the thread', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const phone = nextPhone();
    await seedConsent(phone);
    const r = await withTenant(appPool, orgId, (c) =>
      routeInbound(c, inbound(phone, 'merci mais STOP svp')),
    );
    expect(r).toMatchObject({ kind: 'opted_out', keyword: 'STOP' });
    if (r.kind !== 'opted_out') return;
    expect(r.consentsRevoked).toBeGreaterThan(0);

    // The text that withdrew consent is the evidence that it was withdrawn.
    const msg = await admin.query<{ body: string }>(
      `SELECT body FROM messages WHERE id = $1`, [r.messageId],
    );
    expect(msg.rows[0]!.body).toBe('merci mais STOP svp');

    const conv = await admin.query<{ status: string; closed_at: Date | null }>(
      `SELECT status, closed_at FROM conversations WHERE id = $1`, [r.conversationId],
    );
    // Closed, so nobody can type into it in the console by accident.
    expect(conv.rows[0]!.status).toBe('closed');
    expect(conv.rows[0]!.closed_at).toBeInstanceOf(Date);

    const sup = await admin.query(
      `SELECT id FROM suppression_list
       WHERE organization_id = $1 AND phone_e164 = $2 AND cleared_at IS NULL`,
      [orgId, phone],
    );
    expect(sup.rows).toHaveLength(1);
  });

  it('files a later ordinary message without answering it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const phone = nextPhone();
    await seedConsent(phone);
    await withTenant(appPool, orgId, (c) => routeInbound(c, inbound(phone, 'STOP')));

    const r = await withTenant(appPool, orgId, (c) =>
      routeInbound(c, inbound(phone, 'En fait, quel est le prix?')),
    );
    // NOT to_assistant. The gate would refuse the reply anyway; engaging would
    // spend a model call and look like re-engagement after an opt-out.
    expect(r.kind).toBe('filed_suppressed');
    const msg = await admin.query(
      `SELECT id FROM messages WHERE id = $1`, [r.messageId],
    );
    expect(msg.rows).toHaveLength(1);
  });

  it('lets START bring them back, and routes them normally again', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const phone = nextPhone();
    await seedConsent(phone);
    await withTenant(appPool, orgId, (c) => routeInbound(c, inbound(phone, 'STOP')));

    const back = await withTenant(appPool, orgId, (c) => routeInbound(c, inbound(phone, 'START')));
    expect(back).toMatchObject({ kind: 'resubscribed', keyword: 'START' });

    const next = await withTenant(appPool, orgId, (c) =>
      routeInbound(c, inbound(phone, 'Le Sorento est-il encore là?')),
    );
    expect(next.kind).toBe('to_assistant');
  });
});

describe('a text into a conversation somebody already has', () => {
  it('goes to the person, not the assistant', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const phone = nextPhone();
    const first = await withTenant(appPool, orgId, (c) => routeInbound(c, inbound(phone, 'Allo')));
    await admin.query(
      `UPDATE conversations SET status = 'handed_off', assigned_agent_id = $2, handed_off_at = now()
       WHERE id = $1`,
      [first.conversationId, userId],
    );

    const r = await withTenant(appPool, orgId, (c) => routeInbound(c, inbound(phone, 'Une question…')));
    // §9: after a handoff the assistant never messages the client again.
    expect(r).toMatchObject({ kind: 'to_agent', assignedAgentId: userId });

    const conv = await admin.query<{ status: string }>(
      `SELECT status FROM conversations WHERE id = $1`, [first.conversationId],
    );
    expect(conv.rows[0]!.status).toBe('handed_off');
  });

  it('reactivates a lead who answers a follow-up campaign', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const phone = nextPhone();
    const lead = await app!.inject({
      method: 'POST', url: '/api/v1/leads', headers: { cookie },
      payload: {
        organization_id: orgId, store_id: storeId, phone,
        first_name: 'Luc', source: 'website', preferred_language: 'fr-CA',
      },
    });
    const leadId = (JSON.parse(lead.body) as { id: string }).id;
    const first = await withTenant(appPool, orgId, (c) => routeInbound(c, inbound(phone, 'Allo')));
    await admin.query(`UPDATE conversations SET status = 'drip_active' WHERE id = $1`, [first.conversationId]);
    await admin.query(`UPDATE leads SET status = 'nurture' WHERE id = $1`, [leadId]);

    const r = await withTenant(appPool, orgId, (c) =>
      routeInbound(c, inbound(phone, 'Oui, ça m’intéresse encore')),
    );
    expect(r).toMatchObject({ kind: 'reactivated', leadId });

    const conv = await admin.query<{ status: string }>(
      `SELECT status FROM conversations WHERE id = $1`, [first.conversationId],
    );
    expect(conv.rows[0]!.status).toBe('bot_active');
    const after = await admin.query<{ status: string }>(
      `SELECT status FROM leads WHERE id = $1`, [leadId],
    );
    // Somebody answering a campaign is a live lead again, whatever the campaign
    // had concluded about them.
    expect(after.rows[0]!.status).toBe('chatbot_engaged');
  });

  it('does not reopen a closed conversation — it starts a new one', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const phone = nextPhone();
    const first = await withTenant(appPool, orgId, (c) => routeInbound(c, inbound(phone, 'Allo')));
    await admin.query(
      `UPDATE conversations SET status = 'closed', closed_at = now() WHERE id = $1`,
      [first.conversationId],
    );

    const r = await withTenant(appPool, orgId, (c) => routeInbound(c, inbound(phone, 'Re-bonjour')));
    expect(r.conversationId).not.toBe(first.conversationId);
    // The old thread stays closed and readable; the new one is where the new
    // exchange lives. Reopening would rewrite a finished record.
    const conv = await admin.query<{ id: string; status: string }>(
      `SELECT id, status FROM conversations WHERE organization_id = $1 AND phone_e164 = $2
       ORDER BY created_at`,
      [orgId, phone],
    );
    expect(conv.rows).toHaveLength(2);
    expect(conv.rows.map((x) => x.status).sort()).toEqual(['bot_active', 'closed']);
  });
});
