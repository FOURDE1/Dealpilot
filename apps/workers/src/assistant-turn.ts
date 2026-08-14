import { withTenant, type Pool, type PoolClient } from '@dealpilot/db';
import { AssistantTurnJob } from '@dealpilot/contracts';
import { runTurn, type ModelClient, type ModelMessage } from '@dealpilot/ai';
import { sendMessage } from '@dealpilot/api/send';
import { deliverMessage } from '@dealpilot/api/deliver';
import { createToolRunner } from '@dealpilot/api/tools';
import type { Carrier } from '@dealpilot/api/carrier';
import type { Env } from '@dealpilot/api/env';

/**
 * The assistant answering a customer (F-34).
 *
 * `runTurn` has existed since F-27 and been called by nothing. The prompt, the
 * seven tools, both guards, the correction pass and the tool budget were all
 * built, tested and unreachable — a customer could text a dealership and the
 * system would file the message perfectly and never reply.
 *
 * This is the caller. It does four things and delegates every judgement:
 *
 *  1. Reads the conversation and the thread FROM THE DATABASE, under a tenant
 *     context. The job payload carries ids, not text, so what the model sees is
 *     what is actually on file.
 *  2. Runs the turn, with a tool runner bound to this conversation.
 *  3. Puts the reply through `sendMessage` — the same compliance gate, the same
 *     outbound guard, the same `send_decisions` row as a human's reply. There
 *     is no assistant exemption, and this is the code that makes that true.
 *  4. Hands it to the carrier after the transaction commits.
 *
 * Note what is NOT here: any decision about what to say, whether to hand off,
 * or whether a draft is safe. Those live in `runTurn` and the gate, and a
 * dispatcher that started making them would be a second opinion.
 */

export interface AssistantTurnDeps {
  readonly pool: Pool;
  readonly model: ModelClient;
  readonly carrier: Carrier;
  readonly env: Env;
  readonly now?: () => Date;
}

export type AssistantTurnResult =
  | { kind: 'replied'; messageId: string; toolsUsed: readonly string[]; regenerated: boolean }
  | { kind: 'fallback'; messageId: string | null; reason: string }
  | { kind: 'not_sent'; reason: string }
  | { kind: 'skipped'; reason: string };

/** The thread as the model should see it: oldest first, ours and theirs. */
async function history(c: PoolClient, conversationId: string): Promise<ModelMessage[]> {
  const r = await c.query<{ direction: string; body: string }>(
    `SELECT direction, body FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT 20`,
    [conversationId],
  );
  // Newest-first from the index, reversed here — a conversation reads forwards.
  // The last inbound message is dropped: `runTurn` adds it itself, spotlighted,
  // and including it twice would show the model the customer's words once
  // wrapped and once bare. The bare copy is the one an injection would use.
  return r.rows
    .reverse()
    .slice(0, -1)
    .map((m) => ({ role: m.direction === 'inbound' ? ('user' as const) : ('assistant' as const), content: m.body }));
}

export async function runAssistantTurn(
  deps: AssistantTurnDeps,
  raw: unknown,
): Promise<AssistantTurnResult> {
  const job = AssistantTurnJob.parse(raw);
  const now = deps.now?.() ?? new Date();

  const loaded = await withTenant(deps.pool, job.organization_id, async (c) => {
    const conv = await c.query<{
      id: string; store_id: string; lead_id: string | null; phone_e164: string;
      status: string; language: 'fr' | 'en';
    }>(
      `SELECT id, store_id, lead_id, phone_e164, status, language
       FROM conversations WHERE id = $1 AND deleted_at IS NULL`,
      [job.conversation_id],
    );
    const conversation = conv.rows[0];
    if (!conversation) return null;

    const store = await c.query<{
      name: string; phone: string | null; address_line1: string | null; timezone: string;
    }>(
      `SELECT name, phone, address_line1, timezone FROM stores WHERE id = $1`,
      [conversation.store_id],
    );
    const lead = conversation.lead_id
      ? await c.query<{ first_name: string | null; source: string; vehicle_interest: string | null }>(
          `SELECT first_name, source, vehicle_interest FROM leads WHERE id = $1`,
          [conversation.lead_id],
        )
      : null;
    const inventory = await c.query<Record<string, unknown>>(
      `SELECT stock_number, year, make, model, trim, mileage_km, exterior_color
       FROM vehicles
       WHERE organization_id = $1 AND store_id = $2 AND deleted_at IS NULL
         AND deal_status = 'available' AND location_status = 'on_lot'
       ORDER BY created_at DESC LIMIT 20`,
      [job.organization_id, conversation.store_id],
    );
    const last = await c.query<{ body: string }>(
      `SELECT body FROM messages WHERE id = $1 AND direction = 'inbound'`,
      [job.message_id],
    );
    return {
      conversation,
      store: store.rows[0] ?? null,
      lead: lead?.rows[0] ?? null,
      inventory: inventory.rows,
      clientMessage: last.rows[0]?.body ?? null,
      history: await history(c, job.conversation_id),
    };
  });

  if (!loaded || !loaded.store) return { kind: 'skipped', reason: 'conversation is gone' };
  if (!loaded.clientMessage) return { kind: 'skipped', reason: 'the triggering message is gone' };

  // §9's silent monitoring: after a handoff the assistant never messages the
  // client again. The gate would refuse anyway, but spending a model call to
  // produce a message that cannot be sent is money and a misleading log line.
  if (loaded.conversation.status !== 'bot_active') {
    return { kind: 'skipped', reason: `conversation is ${loaded.conversation.status}` };
  }

  const language = loaded.conversation.language;
  const outcome = await withTenant(deps.pool, job.organization_id, async (c) => {
    const tools = createToolRunner(c, {
      organizationId: job.organization_id,
      storeId: loaded.conversation.store_id,
      conversationId: loaded.conversation.id,
      leadId: loaded.conversation.lead_id,
      phoneE164: loaded.conversation.phone_e164,
      language,
      nowUtc: now,
    });

    const turn = await runTurn(deps.model, tools.run, {
      tenant: {
        dealershipLegalName: loaded.store!.name,
        personaName: 'Alex',
        storeAddress: loaded.store!.address_line1,
        storePhone: loaded.store!.phone,
        hoursText: null,
        // Quebec-first: the language question is asked because Bill 96 expects
        // it, not because the customer's locale was guessed.
        askLanguagePreference: true,
        currentOffersText: null,
        brands: [],
        complianceFooter: null,
        maxMessagesBeforeHandoff: 15,
        photoLimit: 3,
      },
      live: {
        inventory: loaded.inventory,
        lead: {
          firstName: loaded.lead?.first_name ?? null,
          source: loaded.lead?.source ?? null,
          vehicleInterest: loaded.lead?.vehicle_interest ?? null,
          isDuplicate: false,
          prefilled: [],
          consentState: 'express',
        },
        localDateTimeText: now.toISOString(),
        withinBusinessHours: true,
        nextOpenPhrase: language === 'fr' ? 'demain matin' : 'tomorrow morning',
        language,
      },
      history: loaded.history,
      clientMessage: loaded.clientMessage!,
      // Only what the tools actually returned this turn. The guard refuses a
      // stock number the conversation was never shown.
      allowedStockNumbers: tools.allowedStockNumbers(),
      language,
    });

    // The same gate as a human's reply. No assistant exemption exists, and
    // this call is what makes that a fact rather than a claim.
    const sent = await sendMessage(c, {
      organizationId: job.organization_id,
      storeId: loaded.conversation.store_id,
      conversationId: loaded.conversation.id,
      leadId: loaded.conversation.lead_id,
      phoneE164: loaded.conversation.phone_e164,
      body: turn.text,
      senderType: 'bot',
      // A reply the customer asked for. Not outreach, so it is exempt from the
      // daily contact cap and from quiet hours — they are awake, they just
      // texted.
      messageClass: 'inbound_reply',
      scope: 'conversational',
      isSolicitation: false,
      allowedStockNumbers: tools.allowedStockNumbers(),
      nowUtc: now,
    });
    return { turn, sent };
  });

  if (outcome.sent.kind !== 'sent') {
    // The gate refused the assistant's own reply — suppressed, consent gone,
    // cap spent. A `send_decisions` row already says why.
    return {
      kind: 'not_sent',
      reason: outcome.sent.kind === 'blocked' ? outcome.sent.reason : outcome.sent.kind,
    };
  }

  const store = await withTenant(deps.pool, job.organization_id, async (c) => {
    const r = await c.query<{ sms_number: string | null }>(
      `SELECT sms_number FROM stores WHERE id = $1`, [loaded.conversation.store_id],
    );
    return r.rows[0] ?? null;
  });
  if (store?.sms_number) {
    await deliverMessage(deps.pool, deps.carrier, deps.env, {
      organizationId: job.organization_id,
      messageId: outcome.sent.messageId,
      to: loaded.conversation.phone_e164,
      from: store.sms_number,
      body: outcome.turn.text,
    });
  }

  return outcome.turn.kind === 'reply'
    ? {
        kind: 'replied',
        messageId: outcome.sent.messageId,
        toolsUsed: outcome.turn.toolsUsed,
        regenerated: outcome.turn.regenerated,
      }
    : { kind: 'fallback', messageId: outcome.sent.messageId, reason: 'two drafts broke the rules' };
}
