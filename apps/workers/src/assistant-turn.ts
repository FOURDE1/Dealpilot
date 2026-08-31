import { withTenant, type Pool, type PoolClient } from '@dealpilot/db';
import { tenantOperational } from './tenant-status.js';
import { AssistantTurnJob, type Emitter } from '@dealpilot/contracts';
import { LeadExtraction, runTurn, type ModelClient, type ModelMessage } from '@dealpilot/ai';
import {
  evaluateHandoff, localDateTimeText, storeOpenState, type BusinessHoursLike, type ConversationFlags,
} from '@dealpilot/core';
import { autoAssignLead } from '@dealpilot/api/assignment';
import { handOff, handoffNotice } from '@dealpilot/api/handoff';
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
 *
 * F-76: the prompt's hours, open/closed state, follow-up phrase and local
 * clock come from the store's own `business_hours`, `holiday_dates` and
 * `timezone` (via `storeOpenState`), and the turn cap in the prompt is the
 * tenant's `bot_turn_cap` — the same number the handoff evaluator enforces.
 * Before this they were constants: every customer was told the dealership
 * was open, at 03:00 on Christmas. A store with NO grid keeps that behaviour
 * (open, no `Hours:` line): "not configured" is not "closed".
 */

export interface AssistantTurnDeps {
  readonly pool: Pool;
  readonly model: ModelClient;
  readonly carrier: Carrier;
  readonly env: Env;
  /** D-046 #2: arms the ten-minute ladder when a HANDOFF made the assignment. */
  readonly armReassign?: (job: {
    organization_id: string; lead_id: string; assigned_to: string; attempt: number;
  }) => Promise<void>;
  /**
   * F-62: the handoff moment itself must reach every open console — status
   * flip AND the fresh handoff_summary — or the panel opens dark at the
   * exact moment §10's silent monitoring begins, and the inbox keeps saying
   * "Assistant" about a thread a person now owns.
   */
  readonly emitter?: Emitter;
  readonly now?: () => Date;
}

export type AssistantTurnResult =
  | {
      kind: 'replied'; messageId: string; toolsUsed: readonly string[]; regenerated: boolean;
      /** §9: what ended the bot's ownership of this thread, when something did. */
      handoff?: { trigger: string } | { skipped: string };
    }
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

  // F-69: an inbound SMS still reaches a suspended tenant's number through
  // the carrier; the assistant must not answer for a tenant that is not
  // operational (suspended, read-only, closing).
  if (!(await withTenant(deps.pool, job.organization_id, tenantOperational))) {
    return { kind: 'skipped', reason: 'tenant_not_operational' };
  }

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

    // One query for what the prompt needs from the store AND the tenant's
    // turn cap. `holiday_dates::text[]` so pg never hands back a Date the
    // serialiser would have to correct; `store_id IS NULL` is the row the
    // comms-config PUT writes (per-store rows have no writer yet).
    const store = await c.query<{
      name: string; phone: string | null; address_line1: string | null; timezone: string;
      business_hours: BusinessHoursLike; holiday_dates: string[]; bot_turn_cap: number | null;
    }>(
      `SELECT s.name, s.phone, s.address_line1, s.timezone,
              s.business_hours, s.holiday_dates::text[] AS holiday_dates,
              c.bot_turn_cap
       FROM stores s
       LEFT JOIN tenant_comms_config c
         ON c.organization_id = s.organization_id AND c.store_id IS NULL AND c.deleted_at IS NULL
       WHERE s.id = $1`,
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
  const storeConfig = loaded.store;
  const clientMessage = loaded.clientMessage;
  // The store's clock, judged in the store's zone at this turn's instant.
  const clock = storeOpenState({
    hours: storeConfig.business_hours,
    holidays: storeConfig.holiday_dates,
    timezone: storeConfig.timezone,
    nowUtc: now,
  });
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
        dealershipLegalName: storeConfig.name,
        personaName: 'Alex',
        storeAddress: storeConfig.address_line1,
        storePhone: storeConfig.phone,
        // One English line ('Mon–Fri 09:00–18:00, Sat closed, Sun closed') in
        // the cached tenant block; null — no `Hours:` line — for an empty grid.
        hoursText: clock.known ? clock.hoursText : null,
        // Quebec-first: the language question is asked because Bill 96 expects
        // it, not because the customer's locale was guessed.
        askLanguagePreference: true,
        currentOffersText: null,
        brands: [],
        complianceFooter: null,
        // §9 #5 is a TENANT setting (0033, default 15): the prompt now states
        // the same cap the handoff evaluator below enforces.
        maxMessagesBeforeHandoff: storeConfig.bot_turn_cap ?? 15,
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
        // Store-local, in the conversation's language — not a UTC timestamp
        // the model has to convert.
        localDateTimeText: localDateTimeText(now, storeConfig.timezone, language),
        // A grid that says nothing keeps the doors open (today's behaviour);
        // a grid that says "closed" closes them, and so does a listed holiday
        // even without a grid — the holidays hint promises it unconditionally.
        withinBusinessHours: clock.known ? clock.open : !clock.todayIsHoliday,
        // Coarse by design: block 2 forbids promising a reply time.
        nextOpenPhrase: clock.nextOpenPhrase[language],
        language,
      },
      history: loaded.history,
      clientMessage,
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
    return { turn, sent, humanRequests: tools.humanRequests() };
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

  // §9 — after the reply is on its way, decide whether the assistant's part
  // is done. The RULES live in @dealpilot/core (evaluateHandoff); the
  // EXECUTION lives in F-20's handOff() (FOR UPDATE, status recheck, agent
  // membership validation, system-sender notice). This block only gathers
  // facts and wires the two together — and it may NEVER fail the job: the
  // reply is already delivered, and a BullMQ retry here would text the
  // customer a duplicate. A handoff error is a logged skip; the next turn
  // re-evaluates from scratch.
  let handoffOutcome: { trigger: string } | { skipped: string } | undefined;
  const conversationId = loaded.conversation.id;
  const leadId = loaded.conversation.lead_id;
  if (leadId !== null) {
    try {
      handoffOutcome = await runHandoffPhase(deps, {
        organizationId: job.organization_id,
        conversationId,
        leadId,
        storeId: loaded.conversation.store_id,
        phoneE164: loaded.conversation.phone_e164,
        messageId: job.message_id,
        humanRequests: outcome.humanRequests,
        smsNumber: store?.sms_number ?? null,
        now,
      });
    } catch (err) {
      handoffOutcome = { skipped: `handoff error: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  return outcome.turn.kind === 'reply'
    ? {
        kind: 'replied',
        messageId: outcome.sent.messageId,
        toolsUsed: outcome.turn.toolsUsed,
        regenerated: outcome.turn.regenerated,
        ...(handoffOutcome !== undefined ? { handoff: handoffOutcome } : {}),
      }
    : { kind: 'fallback', messageId: outcome.sent.messageId, reason: 'two drafts broke the rules' };
}

interface HandoffPhaseInput {
  readonly organizationId: string;
  readonly conversationId: string;
  readonly leadId: string;
  readonly storeId: string;
  readonly phoneE164: string;
  /** The inbound message this turn answered — extraction rows align on it. */
  readonly messageId: string;
  readonly humanRequests: readonly string[];
  readonly smsNumber: string | null;
  readonly now: Date;
}

/** Deterministic hot/warm/cold: bands are rule-based so routing and the
 * be-back sort never depend on prose (model-judged WORDING can come later). */
function scoreFor(
  trigger: string,
  flags: ConversationFlags,
  sentiment: 'positive' | 'neutral' | 'frustrated' | 'losing_interest',
  fieldsComplete: boolean,
): { score: 'hot' | 'warm' | 'cold'; reason: string } {
  if (trigger === 'safety') return { score: 'cold', reason: 'safety handoff — a person must take this over' };
  if (flags.highIntent || trigger === 'high_intent') {
    return { score: 'hot', reason: 'explicit buying intent in the conversation' };
  }
  if (sentiment === 'frustrated' || sentiment === 'losing_interest') {
    return { score: 'cold', reason: `sentiment turned ${sentiment}` };
  }
  if (fieldsComplete) return { score: 'hot', reason: 'fully qualified: name, vehicle, budget and trade-in captured' };
  return { score: 'warm', reason: 'engaged but not yet fully qualified' };
}

async function runHandoffPhase(
  deps: AssistantTurnDeps,
  input: HandoffPhaseInput,
): Promise<{ trigger: string } | { skipped: string } | undefined> {
  const staged = await withTenant(deps.pool, input.organizationId, async (c) => {
    const leadRow = await c.query<{
      first_name: string | null; vehicle_interest: string | null;
      monthly_budget_cents: number | null; total_budget_cents: number | null;
      trade_in_status: 'none' | 'has_trade' | 'unknown'; assigned_to: string | null;
    }>(
      `SELECT first_name, vehicle_interest, monthly_budget_cents, total_budget_cents,
              trade_in_status, assigned_to
       FROM leads WHERE id = $1 AND deleted_at IS NULL`,
      [input.leadId],
    );
    const lead = leadRow.rows[0];
    if (lead === undefined) return { kind: 'skipped' as const, reason: 'lead gone' };

    // Extraction flags, aligned to MESSAGES and parsed defensively: the
    // snapshot table stores INVALID payloads verbatim by design (F-57), so
    // every row is re-validated and the invalid ones contribute nothing.
    // The extraction for THIS message races this turn on another queue —
    // when it has not landed yet, this turn's flags come from the tools and
    // the streak counts what exists. Honest lag, never a crash.
    const extractionRows = await c.query<{ message_id: string | null; payload: unknown }>(
      `SELECT message_id, payload FROM lead_extractions
       WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 3`,
      [input.conversationId],
    );
    const parsed = extractionRows.rows
      .map((r) => ({ message_id: r.message_id, flags: LeadExtraction.safeParse(r.payload) }))
      .filter((r) => r.flags.success)
      .map((r) => ({ message_id: r.message_id, f: r.flags.success ? r.flags.data.conversation_flags : null! }));
    const thisTurn = parsed.find((r) => r.message_id === input.messageId)?.f;
    const priorTurn = parsed.find((r) => r.message_id !== input.messageId)?.f;

    // §4: EVERY request_human reason starts a handoff — the tool told the
    // model (and so the customer) that a person is coming. complaint maps to
    // wants-a-human; the model's own intent/cannot-answer claims join the
    // extraction's (D-060).
    const flags: ConversationFlags = {
      safety: input.humanRequests.includes('safety'),
      wantsHuman:
        input.humanRequests.includes('client_asked') ||
        input.humanRequests.includes('complaint') ||
        thisTurn?.wants_human === true,
      highIntent: input.humanRequests.includes('high_intent') || thisTurn?.high_intent === true,
      cannotAnswer: input.humanRequests.includes('cannot_answer') || thisTurn?.cannot_answer === true,
    };
    const consecutiveCannotAnswer =
      (flags.cannotAnswer ? 1 : 0) + (priorTurn?.cannot_answer === true ? 1 : 0);

    const botCount = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM messages
       WHERE conversation_id = $1 AND direction = 'outbound' AND sender_type = 'bot'`,
      [input.conversationId],
    );
    // §9 #5 is a TENANT setting (0033), not a constant.
    const cap = await c.query<{ bot_turn_cap: number }>(
      `SELECT bot_turn_cap FROM tenant_comms_config
       WHERE organization_id = $1 AND store_id IS NULL AND deleted_at IS NULL`,
      [input.organizationId],
    );

    const decision = evaluateHandoff({
      status: 'bot_active',
      flags,
      lead: {
        firstName: lead.first_name,
        vehicleInterest: lead.vehicle_interest,
        budgetCents: lead.monthly_budget_cents ?? lead.total_budget_cents,
        tradeInStatus: lead.trade_in_status,
      },
      consecutiveCannotAnswer,
      botMessagesSent: botCount.rows[0]?.n ?? 0,
      botTurnCap: cap.rows[0]?.bot_turn_cap ?? 15,
    });
    if (!decision.handOff) return { kind: 'none' as const };

    // WHO takes it: the owner, or the routing engine's pick right now.
    // Nobody = no handoff; the bot keeps the thread and the ladder hunts.
    let agentId = lead.assigned_to;
    let weAssigned = false;
    if (agentId === null) {
      const assigned = await autoAssignLead(c, input.organizationId, input.leadId, null);
      if (assigned.outcome === 'assigned') {
        agentId = assigned.assigned_to;
        weAssigned = true;
      }
    }
    if (agentId === null) {
      return { kind: 'skipped' as const, reason: `${decision.trigger}: no agent available` };
    }

    const sentiment = thisTurn?.sentiment ?? priorTurn?.sentiment ?? 'neutral';
    const fieldsComplete =
      lead.first_name !== null && lead.vehicle_interest !== null &&
      (lead.monthly_budget_cents !== null || lead.total_budget_cents !== null) &&
      lead.trade_in_status !== 'unknown';
    const { score, reason } = scoreFor(decision.trigger, flags, sentiment, fieldsComplete);

    // §9: a summary FOR the agent — what the customer actually said, not a
    // restatement of the lead form they can already see.
    const lastClient = await c.query<{ body: string }>(
      `SELECT body FROM messages
       WHERE conversation_id = $1 AND direction = 'inbound'
       ORDER BY created_at DESC LIMIT 3`,
      [input.conversationId],
    );
    const quotes = lastClient.rows.map((m) => `«${m.body.slice(0, 140)}»`).reverse().join(' ');
    const summary =
      `${decision.reason}. Customer's last messages: ${quotes || '(none on file)'}` +
      (lead.vehicle_interest ? ` Interest: ${lead.vehicle_interest}.` : '');

    const result = await handOff(c, {
      organizationId: input.organizationId,
      storeId: input.storeId,
      conversationId: input.conversationId,
      leadId: input.leadId,
      phoneE164: input.phoneE164,
      assignedAgentId: agentId,
      trigger: decision.trigger,
      analysis: {
        sentiment,
        buyingSignals: flags.highIntent ? ['high intent this turn'] : [],
        concerns: sentiment === 'frustrated' || sentiment === 'losing_interest' ? [`sentiment: ${sentiment}`] : [],
        summary,
        score,
        scoreReason: reason,
        suggestedResponse: null,
      },
      followsClientMessage: true,
      nowUtc: input.now,
    });
    if (result.kind !== 'handed_off') {
      return { kind: 'skipped' as const, reason: `${decision.trigger}: ${result.kind}` };
    }
    return {
      kind: 'handed_off' as const,
      trigger: decision.trigger,
      agentFirstName: result.agentFirstName,
      weAssigned,
      agentId,
      noticeMessageId: result.notice.kind === 'sent' ? result.notice.messageId : null,
      language: null as 'fr' | 'en' | null,
    };
  });

  if (staged.kind === 'none') return undefined;
  if (staged.kind === 'skipped') return { skipped: staged.reason };

  // F-62: tell every open console, post-commit — the status changed hands
  // and the handoff_summary row is the panel's first content. Hint-grade:
  // a failed emit costs freshness, never the handoff.
  try {
    deps.emitter?.emit(
      { kind: 'conversation', organizationId: input.organizationId, conversationId: input.conversationId },
      {
        type: 'conversation.changed',
        organization_id: input.organizationId,
        conversation_id: input.conversationId,
        status: 'handed_off',
        assigned_agent_id: staged.agentId,
      },
    );
    deps.emitter?.emit(
      { kind: 'conversation', organizationId: input.organizationId, conversationId: input.conversationId },
      {
        type: 'analysis.created',
        organization_id: input.organizationId,
        conversation_id: input.conversationId,
      },
    );
  } catch {
    // The rows are committed; consoles refetch on their next event or open.
  }

  // D-046 #2: an assignment WE made arms the ten-minute ladder, like every
  // other machine-assignment site.
  if (staged.weAssigned) {
    await deps.armReassign?.({
      organization_id: input.organizationId,
      lead_id: input.leadId,
      assigned_to: staged.agentId,
      attempt: 0,
    });
  }

  // The notice rides the carrier post-commit like every send.
  if (staged.noticeMessageId && input.smsNumber) {
    const language = await withTenant(deps.pool, input.organizationId, async (c) => {
      const r = await c.query<{ language: 'fr' | 'en' }>(
        `SELECT language FROM conversations WHERE id = $1`, [input.conversationId],
      );
      return r.rows[0]?.language ?? 'fr';
    });
    await deliverMessage(deps.pool, deps.carrier, deps.env, {
      organizationId: input.organizationId,
      messageId: staged.noticeMessageId,
      to: input.phoneE164,
      from: input.smsNumber,
      body: handoffNotice(staged.agentFirstName, language),
    });
  }
  return { trigger: staged.trigger };
}