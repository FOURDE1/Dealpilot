import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, withTenant, type Pool,
} from '@dealpilot/db';
import { buildApp } from './app.js';
import { handleInboundSms } from './f18-inbound-sms.js';
import { sendMessage } from './f19-send.js';
import { handOff, type HandoffAnalysis, type HandoffRequest } from './f20-handoff.js';

/**
 * The handoff (conversation-engine.md §9).
 *
 * The failures worth catching here are the quiet ones. A conversation marked
 * handed off with nobody told looks fine on the board; a customer told that
 * "Marie is taking over" when Marie works for another dealership looks fine
 * too, right up until she reads it.
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
let agentId = '';
let outsiderId = '';

const MIDDAY = new Date('2026-08-13T18:00:00Z');
const NIGHT = new Date('2026-08-13T07:00:00Z');

const ANALYSIS: HandoffAnalysis = {
  sentiment: 'positive',
  buyingSignals: ['asked about financing', 'wants to come in Saturday'],
  concerns: ['worried about the trade value'],
  summary: 'Marie veut un Sorento 2024, budget 35 000 $, échange à évaluer.',
  score: 'hot',
  scoreReason: 'budget and timeline both stated',
  suggestedResponse: 'Proposez un essai routier samedi matin.',
};

let phoneSeq = 200;
function nextPhone(): string {
  phoneSeq += 1;
  return `+1514555${String(phoneSeq).padStart(4, '0')}`;
}

/** A lead, a consented number and a live bot conversation on it. */
async function fixture(): Promise<{ phone: string; conversationId: string; leadId: string }> {
  const phone = nextPhone();
  const consent = await app!.inject({
    method: 'POST', url: '/api/v1/consent', headers: { cookie },
    payload: {
      organization_id: orgId, phone_e164: phone,
      channels: ['sms'], scopes: ['conversational'],
      consent_type: 'express', source: 'staff_manual',
      evidence: { note: 'seeded for the handoff test' },
    },
  });
  expect(consent.statusCode, consent.body).toBe(201);

  const lead = await app!.inject({
    method: 'POST', url: '/api/v1/leads', headers: { cookie },
    payload: {
      organization_id: orgId, store_id: storeId, phone,
      first_name: 'Marie', source: 'website', preferred_language: 'fr-CA',
    },
  });
  expect(lead.statusCode, lead.body).toBe(201);
  const leadId = (JSON.parse(lead.body) as { id: string }).id;

  const conversationId = await withTenant(appPool, orgId, async (c) => {
    const r = await c.query<{ id: string }>(
      `INSERT INTO conversations (organization_id, store_id, lead_id, phone_e164)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [orgId, storeId, leadId, phone],
    );
    return r.rows[0]!.id;
  });
  return { phone, conversationId, leadId };
}

function request(
  f: { phone: string; conversationId: string; leadId: string },
  over: Partial<HandoffRequest> = {},
): HandoffRequest {
  return {
    organizationId: orgId,
    storeId,
    conversationId: f.conversationId,
    leadId: f.leadId,
    phoneE164: f.phone,
    assignedAgentId: agentId,
    trigger: 'high_intent',
    analysis: ANALYSIS,
    followsClientMessage: true,
    nowUtc: MIDDAY,
    ...over,
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
  appPool = createPool({ connectionString: APP_URL, max: 4 });
  ({ app } = await buildApp({ DATABASE_URL: APP_URL, NODE_ENV: 'test' }));

  const email = `f20-${run}@dealpilot.test`;
  const su = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email, password: 'correct-horse-battery-staple', name: 'Sophie Tremblay' },
  });
  const sc = su.headers['set-cookie'];
  cookie = (Array.isArray(sc) ? sc : [sc!]).map((c) => c!.split(';')[0]).join('; ');

  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie },
    payload: { name: 'Groupe F20', slug: `groupe-f20-${run}` },
  });
  orgId = (JSON.parse(org.body) as { id: string }).id;

  const s = await app!.inject({
    method: 'POST', url: '/api/v1/stores', headers: { cookie },
    payload: { organization_id: orgId, name: 'Rooftop', code: `F20-${run.slice(-4)}`, province: 'QC' },
  });
  storeId = (JSON.parse(s.body) as { id: string }).id;

  const me = await admin.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email]);
  agentId = me.rows[0]!.id;

  // A real person at a DIFFERENT dealership — the "assign to a stranger" case,
  // which has to be refused rather than merely be unlikely. They need their own
  // organisation to exist as a domain user at all (D-025), which is also what
  // makes them a plausible id for a caller to pass by mistake.
  const outEmail = `f20-out-${run}@dealpilot.test`;
  const other = await app!.inject({
    method: 'POST', url: '/api/auth/sign-up/email',
    payload: { email: outEmail, password: 'correct-horse-battery-staple', name: 'Rival Rachel' },
  });
  const osc = other.headers['set-cookie'];
  const outCookie = (Array.isArray(osc) ? osc : [osc!]).map((c) => c!.split(';')[0]).join('; ');
  const outOrg = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie: outCookie },
    payload: { name: 'Rival Group', slug: `rival-group-${run}` },
  });
  expect(outOrg.statusCode, outOrg.body).toBe(201);
  const o = await admin.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [outEmail]);
  outsiderId = o.rows[0]!.id;
});

afterAll(async () => {
  await app?.close();
  await appPool?.end();
  await admin?.end();
});

describe('a conversation handed to a person', () => {
  it('moves everything at once: status, agent, summary, analysis and the lead', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();

    const result = await withTenant(appPool, orgId, (c) => handOff(c, request(f)));
    expect(result).toMatchObject({ kind: 'handed_off', agentFirstName: 'Sophie' });
    if (result.kind !== 'handed_off') return;
    expect(result.notice.kind).toBe('sent');

    const conv = await admin.query<{
      status: string; assigned_agent_id: string; handed_off_at: Date | null;
      bot_summary: string; bot_score: string;
    }>(
      `SELECT status, assigned_agent_id, handed_off_at, bot_summary, bot_score
       FROM conversations WHERE id = $1`,
      [f.conversationId],
    );
    expect(conv.rows[0]).toMatchObject({
      status: 'handed_off',
      assigned_agent_id: agentId,
      bot_summary: ANALYSIS.summary,
      bot_score: 'hot',
    });
    expect(conv.rows[0]!.handed_off_at).toBeInstanceOf(Date);

    const an = await admin.query<{
      analysis_type: string; sentiment: string; buying_signals: string[];
      concerns: string[]; score: string; suggested_response: string;
    }>(
      `SELECT analysis_type, sentiment, buying_signals, concerns, score, suggested_response
       FROM conversation_analysis WHERE conversation_id = $1`,
      [f.conversationId],
    );
    expect(an.rows).toHaveLength(1);
    expect(an.rows[0]).toMatchObject({
      analysis_type: 'handoff_summary', sentiment: 'positive', score: 'hot',
    });
    expect(an.rows[0]!.buying_signals).toEqual(ANALYSIS.buyingSignals);
    expect(an.rows[0]!.concerns).toEqual(ANALYSIS.concerns);

    const lead = await admin.query<{ chatbot_handoff_at: Date | null; assigned_to: string | null }>(
      `SELECT chatbot_handoff_at, assigned_to FROM leads WHERE id = $1`, [f.leadId],
    );
    expect(lead.rows[0]!.chatbot_handoff_at).toBeInstanceOf(Date);
    expect(lead.rows[0]!.assigned_to).toBe(agentId);
  });

  it('tells the customer who is taking over, in their language', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    await withTenant(appPool, orgId, (c) => handOff(c, request(f)));

    const msg = await admin.query<{ body: string; sender_type: string; direction: string }>(
      `SELECT body, sender_type, direction FROM messages
       WHERE conversation_id = $1 AND direction = 'outbound'`,
      [f.conversationId],
    );
    expect(msg.rows).toHaveLength(1);
    expect(msg.rows[0]!.sender_type).toBe('system');
    // French, because conversations default to 'fr' (ADR-019) and this is a
    // Quebec-first product — the legacy 'en' default was a bug that shipped.
    expect(msg.rows[0]!.body).toContain('Sophie');
    expect(msg.rows[0]!.body).toMatch(/Je vous mets en contact/);
  });

  it('still tells the customer when the assistant has spent its daily budget', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    // Spend the assistant's whole day, the way trigger 5 implies: a handoff at
    // the turn cap arrives precisely when the assistant has been talking.
    for (let i = 0; i < 3; i++) {
      const out = await withTenant(appPool, orgId, (c) =>
        sendMessage(c, {
          organizationId: orgId, storeId, conversationId: f.conversationId, leadId: f.leadId,
          phoneE164: f.phone, body: `Bonjour, un suivi (${i}).`, senderType: 'bot',
          messageClass: 'follow_up', scope: 'conversational', isSolicitation: false, nowUtc: MIDDAY,
        }),
      );
      expect(out.kind).toBe('sent');
    }
    const capped = await withTenant(appPool, orgId, (c) =>
      sendMessage(c, {
        organizationId: orgId, storeId, conversationId: f.conversationId, leadId: f.leadId,
        phoneE164: f.phone, body: 'Encore un suivi.', senderType: 'bot',
        messageClass: 'follow_up', scope: 'conversational', isSolicitation: false, nowUtc: MIDDAY,
      }),
    );
    expect(capped).toMatchObject({ kind: 'blocked', reason: 'frequency_cap' });

    // The one message that matters most is the one the cap must not eat.
    const result = await withTenant(appPool, orgId, (c) =>
      handOff(c, request(f, { trigger: 'turn_cap', followsClientMessage: false })),
    );
    expect(result).toMatchObject({ kind: 'handed_off' });
    if (result.kind !== 'handed_off') return;
    expect(result.notice.kind).toBe('sent');
  });

  it('hands off anyway when the customer cannot be reached', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    await withTenant(appPool, orgId, (c) =>
      handleInboundSms(c, {
        organizationId: orgId, storeId, phoneE164: f.phone, body: 'STOP', messageRef: 'SM-f20',
      }),
    );

    const result = await withTenant(appPool, orgId, (c) => handOff(c, request(f)));
    expect(result).toMatchObject({ kind: 'handed_off' });
    if (result.kind !== 'handed_off') return;
    // Refused, and correctly: they asked us to stop. The handoff is about who is
    // responsible, which is a fact even when nobody can be told.
    expect(result.notice).toMatchObject({ kind: 'blocked', reason: 'suppressed' });

    const conv = await admin.query<{ status: string }>(
      `SELECT status FROM conversations WHERE id = $1`, [f.conversationId],
    );
    expect(conv.rows[0]!.status).toBe('handed_off');
    const msgs = await admin.query(
      `SELECT id FROM messages WHERE conversation_id = $1 AND direction = 'outbound'`,
      [f.conversationId],
    );
    expect(msgs.rows).toHaveLength(0);
  });

  it('defers a night-time notice without deferring the handoff', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    const result = await withTenant(appPool, orgId, (c) =>
      handOff(c, request(f, { trigger: 'turn_cap', followsClientMessage: false, nowUtc: NIGHT })),
    );
    expect(result).toMatchObject({ kind: 'handed_off' });
    if (result.kind !== 'handed_off') return;
    // `followsClientMessage: false` is the honest claim here, and it costs the
    // quiet-hours exemption. Claiming otherwise would text somebody at 3am.
    expect(result.notice.kind).toBe('deferred');
  });
});

describe('a handoff that must not happen', () => {
  it('refuses an agent who does not work here', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    const result = await withTenant(appPool, orgId, (c) =>
      handOff(c, request(f, { assignedAgentId: outsiderId })),
    );
    expect(result).toMatchObject({ kind: 'agent_not_assignable' });

    const conv = await admin.query<{ status: string; assigned_agent_id: string | null }>(
      `SELECT status, assigned_agent_id FROM conversations WHERE id = $1`, [f.conversationId],
    );
    expect(conv.rows[0]).toMatchObject({ status: 'bot_active', assigned_agent_id: null });
    const msgs = await admin.query(
      `SELECT id FROM messages WHERE conversation_id = $1`, [f.conversationId],
    );
    expect(msgs.rows).toHaveLength(0);
  });

  it('does not reassign a conversation somebody already has', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    await withTenant(appPool, orgId, (c) => handOff(c, request(f)));

    // Two triggers can fire on one message. The second must not take the
    // conversation away from the agent the first gave it to.
    const again = await withTenant(appPool, orgId, (c) =>
      handOff(c, request(f, { trigger: 'client_asked' })),
    );
    expect(again).toMatchObject({ kind: 'not_bot_active', status: 'handed_off' });

    const an = await admin.query(
      `SELECT id FROM conversation_analysis WHERE conversation_id = $1`, [f.conversationId],
    );
    expect(an.rows).toHaveLength(1);
  });

  it('leaves nothing behind when the notice cannot even be composed', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    // An analysis with an empty summary violates the CHECK, which aborts the
    // whole transaction — the conversation must not be left half handed off.
    await expect(
      withTenant(appPool, orgId, (c) =>
        handOff(c, request(f, { analysis: { ...ANALYSIS, summary: '   ' } })),
      ),
    ).rejects.toThrow();

    const conv = await admin.query<{ status: string; assigned_agent_id: string | null }>(
      `SELECT status, assigned_agent_id FROM conversations WHERE id = $1`, [f.conversationId],
    );
    expect(conv.rows[0]).toMatchObject({ status: 'bot_active', assigned_agent_id: null });
    const msgs = await admin.query(
      `SELECT id FROM messages WHERE conversation_id = $1`, [f.conversationId],
    );
    expect(msgs.rows).toHaveLength(0);
    const lead = await admin.query<{ chatbot_handoff_at: Date | null }>(
      `SELECT chatbot_handoff_at FROM leads WHERE id = $1`, [f.leadId],
    );
    expect(lead.rows[0]!.chatbot_handoff_at).toBeNull();
  });
});

describe('what the assistant thought', () => {
  it('cannot be rewritten or erased by the application', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    await withTenant(appPool, orgId, (c) => handOff(c, request(f)));

    // No UPDATE, no DELETE grant: what the assistant believed is a fact about a
    // moment, and the silent monitor adds rows rather than editing them.
    await expect(
      withTenant(appPool, orgId, (c) =>
        c.query(`UPDATE conversation_analysis SET score = 'cold' WHERE conversation_id = $1`, [f.conversationId]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      withTenant(appPool, orgId, (c) =>
        c.query(`DELETE FROM conversation_analysis WHERE conversation_id = $1`, [f.conversationId]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('is invisible to another organisation', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const f = await fixture();
    await withTenant(appPool, orgId, (c) => handOff(c, request(f)));

    const other = await app!.inject({
      method: 'POST', url: '/api/v1/organizations', headers: { cookie },
      payload: { name: 'Rival F20', slug: `rival-f20-${run}` },
    });
    const otherOrg = (JSON.parse(other.body) as { id: string }).id;
    const seen = await withTenant(appPool, otherOrg, async (c) => {
      const r = await c.query(
        `SELECT id FROM conversation_analysis WHERE conversation_id = $1`, [f.conversationId],
      );
      return r.rows.length;
    });
    expect(seen).toBe(0);
  });
});
