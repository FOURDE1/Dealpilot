import { z } from 'zod';
import { CursorQuery, IsoDateTime, Uuid } from './common.js';

/**
 * Conversations and their messages (conversation-engine.md §12).
 *
 * The agent console reads these. Two things are deliberately absent from every
 * write shape here:
 *
 *  - a DESTINATION. An agent replies to a conversation, and the number lives on
 *    the conversation row. §4: "no tool sends free-form messages to arbitrary
 *    numbers" — and the same restraint applies to the human API, because a
 *    phone number in a request body is a phone number an attacker can supply.
 *  - a way to send WITHOUT the gate. There is one send path (F-19) and this
 *    contract cannot express a bypass.
 */

export const ConversationChannel = z.enum(['sms', 'voice', 'web_chat', 'whatsapp']);
export const ConversationStatusEnum = z.enum([
  'bot_active', 'handed_off', 'agent_active', 'drip_active', 'closed',
]);
export const ConversationLanguage = z.enum(['fr', 'en']);
export const BotScore = z.enum(['hot', 'warm', 'cold']);

export const Conversation = z.object({
  id: Uuid,
  organization_id: Uuid,
  store_id: Uuid,
  lead_id: Uuid.nullable(),
  deal_id: Uuid.nullable(),
  channel: ConversationChannel,
  phone_e164: z.string(),
  status: ConversationStatusEnum,
  language: ConversationLanguage,
  assigned_agent_id: Uuid.nullable(),
  handed_off_at: IsoDateTime.nullable(),
  closed_at: IsoDateTime.nullable(),
  bot_summary: z.string().nullable(),
  bot_score: BotScore.nullable(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});

export const MessageDirection = z.enum(['inbound', 'outbound']);
export const MessageSenderType = z.enum(['client', 'bot', 'agent', 'system', 'drip']);

export const Message = z.object({
  id: Uuid,
  organization_id: Uuid,
  conversation_id: Uuid,
  direction: MessageDirection,
  sender_type: MessageSenderType,
  channel: z.string(),
  body: z.string(),
  /**
   * Which consent authorised this send. Null on inbound — they contacted us.
   * Exposed because "we had consent" is not a defence and "we relied on this
   * row" is: the console can show an auditor the basis for any message on the
   * screen without a database session.
   */
  consent_ledger_id: Uuid.nullable(),
  send_decision_id: Uuid.nullable(),
  segments: z.number().int().nullable(),
  delivered: z.boolean(),
  delivered_at: IsoDateTime.nullable(),
  created_at: IsoDateTime,
});

export const ConversationAnalysisRecord = z.object({
  id: Uuid,
  conversation_id: Uuid,
  lead_id: Uuid.nullable(),
  analysis_type: z.enum(['handoff_summary', 'live_update', 'scoring']),
  sentiment: z.enum(['positive', 'neutral', 'frustrated', 'losing_interest']),
  buying_signals: z.array(z.string()),
  concerns: z.array(z.string()),
  suggested_response: z.string().nullable(),
  summary: z.string(),
  score: BotScore,
  score_reason: z.string(),
  created_at: IsoDateTime,
});

export const ConversationListQuery = CursorQuery.extend({
  organization_id: Uuid.optional(),
  store_id: Uuid.optional(),
  status: ConversationStatusEnum.optional(),
  assigned_agent_id: Uuid.optional(),
});

export const MessageListQuery = CursorQuery;

/**
 * An agent's reply. Body only — see the note at the top of this file.
 *
 * `max(1600)` is ten SMS segments: past that the customer receives a wall of
 * text charged ten times, which is a mistake worth refusing rather than
 * silently truncating.
 */
export const SendAgentMessageInput = z.strictObject({
  body: z.string().trim().min(1).max(1600),
});

/** Taking a conversation. Omit the agent to take it yourself. */
export const TakeoverInput = z.strictObject({
  assigned_agent_id: Uuid.optional(),
});

export const CloseConversationInput = z.strictObject({
  reason: z.string().trim().min(1).max(500).optional(),
});

/**
 * What the console gets back when a reply is refused.
 *
 * A refusal is a 200, not an error: the request was well-formed and the answer
 * is "no, and here is why". Rendering it as a 4xx would leave the agent staring
 * at a red toast with no idea what to do next, and the remedy is the part that
 * matters — "they asked us to stop; only they can undo it" is actionable in a
 * way "422 Unprocessable Entity" is not.
 */
export const SendResult = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sent'), message: Message }),
  z.object({ kind: z.literal('blocked'), reason: z.string(), remedy: z.string() }),
  z.object({ kind: z.literal('deferred'), reason: z.string(), run_at: IsoDateTime }),
  z.object({
    kind: z.literal('unsafe'),
    violations: z.array(z.object({
      kind: z.string(),
      /** The agent's own words that tripped it, quoted back so they can fix it. */
      matched: z.string(),
      reason: z.string(),
    })),
  }),
]);
