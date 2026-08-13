import type { PoolClient } from '@dealpilot/db';
import type { HandoffTrigger } from '@dealpilot/core';
import { recordEvent } from './activity.js';
import { sendMessage, type SendOutcome } from './f19-send.js';

/**
 * Handing a conversation to a person (conversation-engine.md §9).
 *
 * One transaction: the notice, the reassignment, the analysis and the lead
 * stamp either all happen or none do. A conversation marked handed off with
 * nobody told, or a customer told with nobody assigned, are both worse than
 * neither.
 *
 * The notice is sent as a SYSTEM message, and that is the load-bearing choice
 * here. The assistant's daily cap and the post-handoff suspension both key off
 * `originator === 'ai'`, so a notice composed as the assistant's own could be
 * swallowed by the very budget the handoff is escaping — trigger 5 fires
 * precisely when the assistant has been talking a lot. "A person is taking
 * over" is a fact about the conversation, not another sales message. It still
 * passes suppression, consent and quiet hours like everything else.
 *
 * If the send is refused — they are suppressed, or it is 2am — the handoff
 * still happens. A person taking over is a fact about who is responsible, and
 * making it conditional on the customer being reachable would leave the
 * assistant holding a conversation it has already decided it should not have.
 */

/** The model's read on the conversation, addressed to the person taking it. */
export interface HandoffAnalysis {
  readonly sentiment: 'positive' | 'neutral' | 'frustrated' | 'losing_interest';
  readonly buyingSignals: readonly string[];
  readonly concerns: readonly string[];
  readonly summary: string;
  readonly score: 'hot' | 'warm' | 'cold';
  readonly scoreReason: string;
  /** A draft for the agent. Sending it runs the full gate, like anything else. */
  readonly suggestedResponse: string | null;
}

export interface HandoffRequest {
  readonly organizationId: string;
  readonly storeId: string;
  readonly conversationId: string;
  readonly leadId: string | null;
  readonly phoneE164: string;
  readonly assignedAgentId: string;
  readonly trigger: HandoffTrigger;
  readonly analysis: HandoffAnalysis;
  /**
   * True when this handoff answers something the customer just sent.
   *
   * It decides whether the notice may go out during quiet hours, so it is a
   * claim the caller makes explicitly rather than one this module assumes. A
   * turn-cap handoff at 02:00 is not a reply to anybody.
   */
  readonly followsClientMessage: boolean;
  readonly nowUtc: Date;
}

export type HandoffResult =
  | { kind: 'handed_off'; agentFirstName: string; notice: SendOutcome }
  | { kind: 'not_bot_active'; status: string }
  | { kind: 'agent_not_assignable' };

/** "Perfect! I'm connecting you with {name}, one of our specialists…" (§9). */
export function handoffNotice(agentFirstName: string, language: 'fr' | 'en'): string {
  return language === 'fr'
    ? `Parfait! Je vous mets en contact avec ${agentFirstName}, un de nos spécialistes. Il ou elle vous répondra sous peu.`
    : `Perfect! I'm connecting you with ${agentFirstName}, one of our specialists. They'll be with you shortly.`;
}

export async function handOff(c: PoolClient, req: HandoffRequest): Promise<HandoffResult> {
  const conv = await c.query<{ status: string; language: 'fr' | 'en' }>(
    `SELECT status, language FROM conversations WHERE id = $1 FOR UPDATE`,
    [req.conversationId],
  );
  const current = conv.rows[0];
  if (!current) return { kind: 'not_bot_active', status: 'missing' };
  // Not an error worth failing the turn over: two triggers can fire on one
  // message, and the second must not reassign the conversation the first just
  // gave somebody.
  if (current.status !== 'bot_active') return { kind: 'not_bot_active', status: current.status };

  // The agent has to be a live member of THIS organisation: `assigned_agent_id`
  // is a plain uuid with no opinion, so a caller passing the wrong one would
  // hand a customer's conversation to somebody at another dealership.
  //
  // RLS is what actually refuses it — under `app.org_id` a foreign membership
  // row is not visible to this join at all — and mutation-testing this predicate
  // away changes no test, which is the honest description of it: a second lock
  // on a door the tenant policy already holds shut, kept because the cost is one
  // line and the failure it guards against is silent.
  const agent = await c.query<{ name: string | null }>(
    `SELECT u.name
     FROM users u
     JOIN memberships m ON m.user_id = u.id
     WHERE u.id = $1 AND m.organization_id = $2 AND m.status = 'active'
     LIMIT 1`,
    [req.assignedAgentId, req.organizationId],
  );
  if (agent.rows.length === 0) return { kind: 'agent_not_assignable' };
  const agentFirstName = (agent.rows[0]!.name ?? '').trim().split(/\s+/)[0] || 'un conseiller';

  // 1. Tell the customer, while the assistant may still speak.
  const notice = await sendMessage(c, {
    organizationId: req.organizationId,
    storeId: req.storeId,
    conversationId: req.conversationId,
    leadId: req.leadId,
    phoneE164: req.phoneE164,
    body: handoffNotice(agentFirstName, current.language),
    // Not 'bot': the daily assistant cap exists to stop the assistant pestering
    // people, and saying "a person is taking over" is the opposite of that. It
    // still passes suppression, consent and quiet hours like everything else.
    senderType: 'system',
    messageClass: req.followsClientMessage ? 'inbound_reply' : 'follow_up',
    scope: 'conversational',
    isSolicitation: false,
    nowUtc: req.nowUtc,
  });

  // 2. The conversation changes hands.
  await c.query(
    `UPDATE conversations
     SET status = 'handed_off', assigned_agent_id = $2, handed_off_at = now(),
         bot_summary = $3, bot_score = $4
     WHERE id = $1`,
    [req.conversationId, req.assignedAgentId, req.analysis.summary, req.analysis.score],
  );

  const analysis = await c.query<{ id: string }>(
    `INSERT INTO conversation_analysis
       (organization_id, store_id, conversation_id, lead_id, analysis_type, sentiment,
        buying_signals, concerns, suggested_response, summary, score, score_reason)
     VALUES ($1,$2,$3,$4,'handoff_summary',$5,$6,$7,$8,$9,$10,$11)
     RETURNING id`,
    [
      req.organizationId, req.storeId, req.conversationId, req.leadId,
      req.analysis.sentiment, req.analysis.buyingSignals, req.analysis.concerns,
      req.analysis.suggestedResponse, req.analysis.summary, req.analysis.score,
      req.analysis.scoreReason,
    ],
  );

  if (req.leadId) {
    // COALESCE: the first time a human took this lead, not the most recent. A
    // lead reached on two conversations has one moment when it stopped being
    // the assistant's, and speed-to-lead is measured from it.
    await c.query(
      `UPDATE leads
       SET chatbot_handoff_at = COALESCE(chatbot_handoff_at, now()),
           assigned_to = COALESCE(assigned_to, $2),
           updated_at = now()
       WHERE organization_id = $3 AND id = $1`,
      [req.leadId, req.assignedAgentId, req.organizationId],
    );
  }

  await recordEvent(c, {
    organizationId: req.organizationId,
    storeId: req.storeId,
    // The assistant did this, not a member of staff. Putting the receiving
    // agent's name here would read as though they chose to take it.
    actorUserId: null,
    entityType: 'conversation',
    entityId: req.conversationId,
    action: 'updated',
    changes: {
      status: { from: 'bot_active', to: 'handed_off' },
      trigger: req.trigger,
      assigned_agent_id: req.assignedAgentId,
      bot_score: req.analysis.score,
      analysis_id: analysis.rows[0]!.id,
      notice: notice.kind,
    },
  });

  return { kind: 'handed_off', agentFirstName, notice };
}
