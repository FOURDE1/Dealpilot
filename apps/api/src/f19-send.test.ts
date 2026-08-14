import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, withTenant, type Pool,
} from '@dealpilot/db';
import { buildApp } from './app.js';
import { handleInboundSms } from './f18-inbound-sms.js';
import { sendMessage, recordInbound, type OutboundRequest } from './f19-send.js';

/**
 * The send layer (compliance-and-quality.md §1, conversation-engine.md §10).
 *
 * Everything above this file could already answer "may we contact them?" — the
 * gate has been correct and unit-tested since F-15. What it could not do was
 * stop anybody. These cases are about the difference: a send that the gate
 * refuses must leave no message, and a message that exists must be able to name
 * the consent it relied on.
 *
 * Every case builds its own number and its own conversation. A shared fixture
 * here would let a later test pass on an earlier test's consent row, which is
 * how a gate that does nothing looks green.
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

/** 14:00 in Montreal — comfortably inside every default quiet-hours window. */
const MIDDAY = new Date('2026-08-13T18:00:00Z');
/** 03:00 in Montreal — outside it. */
const NIGHT = new Date('2026-08-13T07:00:00Z');

let phoneSeq = 100;
function nextPhone(): string {
  phoneSeq += 1;
  return `+1514555${String(phoneSeq).padStart(4, '0')}`;
}

/** A number with express conversational consent, and a live conversation on it. */
async function fixture(opts: { consent?: boolean } = {}): Promise<{ phone: string; conversationId: string }> {
  const phone = nextPhone();
  if (opts.consent !== false) {
    const res = await app!.inject({
      method: 'POST', url: '/api/v1/consent', headers: { cookie },
      payload: {
        organization_id: orgId, phone_e164: phone,
        channels: ['sms'], scopes: ['conversational'],
        consent_type: 'express', source: 'staff_manual',
        evidence: { note: 'seeded for the send test' },
      },
    });
    expect(res.statusCode, res.body).toBe(201);
  }
  const conversationId = await withTenant(appPool, orgId, async (c) => {
    const r = await c.query<{ id: string }>(
      `INSERT INTO conversations (organization_id, store_id, phone_e164) VALUES ($1,$2,$3) RETURNING id`,
      [orgId, storeId, phone],
    );
    return r.rows[0]!.id;
  });
  return { phone, conversationId };
}

function request(
  f: { phone: string; conversationId: string },
  over: Partial<OutboundRequest> = {},
): OutboundRequest {
  return {
    organizationId: orgId,
    storeId,
    conversationId: f.conversationId,
    leadId: null,
    phoneE164: f.phone,
    body: 'Bonjour! Je peux vous montrer le véhicule cette semaine.',
    senderType: 'bot',
    messageClass: 'inbound_reply',
    scope: 'conversational',
    isSolicitation: false,
    nowUtc: MIDDAY,
    ...over,
  };
}

async function messageCount(conversationId: string): Promise<number> {
  const r = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM messages WHERE conversation_id = $1`, [conversationId],
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

  const email = `f19-${run}@dealpilot.test`;
  const su = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email, password: 'correct-horse-battery-staple', name: 'Alice' },
  });
  const sc = su.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');

  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe F19', slug: `groupe-f19-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;

  const s = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Rooftop', code: `F19-${run.slice(-4)}`, province: 'QC' },
  });
  storeId = (JSON.parse(s.body) as { id: string }).id;

  const u = await admin.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
  userId = u.rows[0]!.id;
});

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await admin?.end();
});

describe('a send that is allowed', () => {
  it('names the consent it relied on, and the decision that let it through', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();

    const out = await withTenant(appPool, orgId, (c) => sendMessage(c, request(f)));
    expect(out.kind).toBe('sent');
    if (out.kind !== 'sent') return;

    const msg = await admin.query<{
      consent_ledger_id: string; send_decision_id: string; direction: string; sender_type: string;
    }>(
      `SELECT consent_ledger_id, send_decision_id, direction, sender_type FROM messages WHERE id = $1`,
      [out.messageId],
    );
    expect(msg.rows[0]).toMatchObject({ direction: 'outbound', sender_type: 'bot' });
    // Not "we had consent" — THIS consent, the row the gate actually resolved.
    expect(msg.rows[0]!.consent_ledger_id).toBe(out.consentLedgerId);
    expect(msg.rows[0]!.send_decision_id).toBe(out.decisionId);

    const live = await admin.query<{ id: string }>(
      `SELECT id FROM consent_ledger
       WHERE organization_id = $1 AND phone_e164 = $2 AND revoked_at IS NULL`,
      [orgId, f.phone],
    );
    expect(live.rows.map((r) => r.id)).toContain(out.consentLedgerId);
  });

  it('fills every column the compliance file is made of', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    const out = await withTenant(appPool, orgId, (c) => sendMessage(c, request(f)));
    expect(out.kind).toBe('sent');
    if (out.kind !== 'sent') return;

    const d = await admin.query<Record<string, unknown>>(
      `SELECT status, reason, message_class, originator, scope, consent_ledger_id,
              timezone, timezone_source, recipient_local_at, window_applied,
              deferred_until, gate_version
       FROM send_decisions WHERE id = $1`,
      [out.decisionId],
    );
    // Every one of these was registered as deliberately-unwritten debt in the
    // dead-column guard until this slice. A NULL here is that debt coming back.
    expect(d.rows[0]).toMatchObject({
      status: 'allowed',
      reason: null,
      message_class: 'inbound_reply',
      originator: 'ai',
      scope: 'conversational',
      consent_ledger_id: out.consentLedgerId,
      // Resolved from the area code, not the store: 514 is Montreal, and this
      // is the value 0028's CHECK refused until 0032 corrected it.
      timezone: 'America/Toronto',
      timezone_source: 'area_code',
      deferred_until: null,
    });
    expect(d.rows[0]!['window_applied']).toBeTruthy();
    expect(d.rows[0]!['gate_version']).toBeTruthy();
    expect(d.rows[0]!['recipient_local_at']).toBeInstanceOf(Date);
  });
});

describe('a send the gate refuses', () => {
  it('leaves a decision and no message when they have asked us to stop', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    await withTenant(appPool, orgId, (c) =>
      handleInboundSms(c, {
        organizationId: orgId, storeId, phoneE164: f.phone,
        body: 'STOP', messageRef: 'SM-f19-stop',
      }),
    );

    const out = await withTenant(appPool, orgId, (c) => sendMessage(c, request(f)));
    expect(out).toMatchObject({ kind: 'blocked', reason: 'suppressed' });
    if (out.kind !== 'blocked') return;

    const d = await admin.query<{ status: string; reason: string; consent_ledger_id: string | null }>(
      `SELECT status, reason, consent_ledger_id FROM send_decisions WHERE id = $1`, [out.decisionId],
    );
    expect(d.rows[0]).toMatchObject({ status: 'blocked', reason: 'suppressed', consent_ledger_id: null });
    // The whole point: the refusal is not advice the caller may ignore.
    expect(await messageCount(f.conversationId)).toBe(0);
  });

  it('refuses a number nobody ever opted in', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture({ consent: false });
    const out = await withTenant(appPool, orgId, (c) => sendMessage(c, request(f)));
    expect(out).toMatchObject({ kind: 'blocked', reason: 'consent_absent' });
    expect(await messageCount(f.conversationId)).toBe(0);
  });

  it('defers a night-time follow-up instead of sending it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    const out = await withTenant(appPool, orgId, (c) =>
      sendMessage(c, request(f, { messageClass: 'follow_up', nowUtc: NIGHT })),
    );
    expect(out).toMatchObject({ kind: 'deferred', reason: 'quiet_hours' });
    if (out.kind !== 'deferred') return;
    expect(out.runAt.getTime()).toBeGreaterThan(NIGHT.getTime());

    const d = await admin.query<{ status: string; deferred_until: Date | null }>(
      `SELECT status, deferred_until FROM send_decisions WHERE id = $1`, [out.decisionId],
    );
    expect(d.rows[0]!.status).toBe('deferred');
    expect(d.rows[0]!.deferred_until).toBeInstanceOf(Date);
    expect(await messageCount(f.conversationId)).toBe(0);
  });

  it('stops the assistant at the daily cap, and lets a person through', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    // The cap counts assistant-INITIATED contacts; a reply the customer asked
    // for is not one, so these have to be follow-ups to count at all.
    const outs = [];
    for (let i = 0; i < 4; i++) {
      outs.push(await withTenant(appPool, orgId, (c) =>
        sendMessage(c, request(f, { messageClass: 'follow_up', body: `Bonjour, un suivi (${i}).` })),
      ));
    }
    expect(outs.slice(0, 3).map((o) => o.kind)).toEqual(['sent', 'sent', 'sent']);
    expect(outs[3]).toMatchObject({ kind: 'blocked', reason: 'frequency_cap' });

    // A human being is not rate-limited by the assistant's budget.
    const human = await withTenant(appPool, orgId, (c) =>
      sendMessage(c, request(f, { senderType: 'agent', messageClass: 'follow_up' })),
    );
    expect(human.kind).toBe('sent');
  });

  it('suspends the assistant on a conversation a person took over, not the person', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    await admin.query(
      `UPDATE conversations SET status = 'handed_off', assigned_agent_id = $2, handed_off_at = now()
       WHERE id = $1`,
      [f.conversationId, userId],
    );

    const bot = await withTenant(appPool, orgId, (c) => sendMessage(c, request(f)));
    expect(bot).toMatchObject({ kind: 'blocked', reason: 'ai_suspended' });

    const agent = await withTenant(appPool, orgId, (c) =>
      sendMessage(c, request(f, { senderType: 'agent' })),
    );
    expect(agent.kind).toBe('sent');
  });
});

describe('a draft the content guard refuses', () => {
  it('never becomes a message, though the attempt stays on file', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    const before = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM send_decisions WHERE organization_id = $1`, [orgId],
    );

    const out = await withTenant(appPool, orgId, (c) =>
      sendMessage(c, request(f, { body: 'Vous êtes approuvé! Le prix est 24 995 $ à 4,9 %.' })),
    );
    expect(out.kind).toBe('unsafe');
    if (out.kind !== 'unsafe') return;
    expect(out.violations.map((v) => v.kind)).toContain('approval_promise');

    expect(await messageCount(f.conversationId)).toBe(0);
    const after = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM send_decisions WHERE organization_id = $1`, [orgId],
    );
    // The compliance question was answered before the wording was, and the
    // answer is recorded either way: the file shows a send was attempted.
    expect(Number(after.rows[0]!.n)).toBe(Number(before.rows[0]!.n) + 1);
  });
});

describe('the database, independently of any sender', () => {
  it('refuses an outbound message that names no consent', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    await expect(
      withTenant(appPool, orgId, (c) =>
        c.query(
          `INSERT INTO messages (organization_id, conversation_id, direction, sender_type, channel, body)
           VALUES ($1,$2,'outbound','bot','sms','sent behind the gate')`,
          [orgId, f.conversationId],
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
    expect(await messageCount(f.conversationId)).toBe(0);
  });

  it('accepts an inbound message with no consent — they contacted us', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture({ consent: false });
    const id = await withTenant(appPool, orgId, (c) =>
      recordInbound(c, {
        organizationId: orgId, conversationId: f.conversationId,
        body: 'Est-ce que le Sorento est encore disponible?', providerRef: `SM-in-${crypto.randomUUID()}`,
      }),
    );
    const r = await admin.query<{ direction: string; sender_type: string }>(
      `SELECT direction, sender_type FROM messages WHERE id = $1`, [id],
    );
    expect(r.rows[0]).toMatchObject({ direction: 'inbound', sender_type: 'client' });
  });

  it('will not let a message be rewritten after the fact', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    const out = await withTenant(appPool, orgId, (c) => sendMessage(c, request(f)));
    expect(out.kind).toBe('sent');
    if (out.kind !== 'sent') return;

    await expect(
      admin.query(`UPDATE messages SET body = 'something else' WHERE id = $1`, [out.messageId]),
    ).rejects.toThrow(/append-only/);
    await expect(
      admin.query(`DELETE FROM messages WHERE id = $1`, [out.messageId]),
    ).rejects.toThrow(/append-only/);

    // A delivery receipt is the one legitimate update.
    await admin.query(
      `UPDATE messages SET delivered = true, delivered_at = now(), segments = 1 WHERE id = $1`,
      [out.messageId],
    );
    const r = await admin.query<{ delivered: boolean }>(
      `SELECT delivered FROM messages WHERE id = $1`, [out.messageId],
    );
    expect(r.rows[0]!.delivered).toBe(true);
  });

  it('keeps another organisation out of these conversations', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    await withTenant(appPool, orgId, (c) => sendMessage(c, request(f)));

    const other = await app!.inject({
      method: 'POST', url: '/api/v1/organizations', headers: { cookie },
      payload: { name: 'Rival F19', slug: `rival-f19-${run}` },
    });
    const otherOrg = (JSON.parse(other.body) as { id: string }).id;

    const seen = await withTenant(appPool, otherOrg, async (c) => {
      const conv = await c.query(`SELECT id FROM conversations WHERE id = $1`, [f.conversationId]);
      const msgs = await c.query(`SELECT id FROM messages WHERE conversation_id = $1`, [f.conversationId]);
      return conv.rows.length + msgs.rows.length;
    });
    expect(seen).toBe(0);
  });
});
