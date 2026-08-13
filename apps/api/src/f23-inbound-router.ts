import type { PoolClient } from '@dealpilot/db';
import { recordInbound } from './f19-send.js';
import { handleInboundSms } from './f18-inbound-sms.js';

/**
 * Where an inbound message goes (conversation-engine.md §12).
 *
 * This is the spine. Intake creates leads, the STOP pipeline honours opt-outs,
 * the send layer enforces the gate and the console shows a person the thread —
 * and until now nothing joined them, because nothing turned "a text arrived"
 * into "this conversation, this state, this next step".
 *
 * The order is the design, and it is the same order §5 and §1 insist on:
 *
 *   1. keywords, before ANY routing. An opt-out buried in an otherwise ordinary
 *      message is still an opt-out, and letting the engine see it first means a
 *      reply going to somebody who just asked us to stop.
 *   2. the conversation, found or created, so the message has somewhere to live
 *      whatever happens next.
 *   3. the message itself, recorded before anybody decides anything about it.
 *   4. only then, who handles it.
 *
 * Everything happens in the caller's transaction. A message recorded without
 * the opt-out it contained, or an opt-out without the message that proves it,
 * are both worse than neither.
 */

export interface InboundMessage {
  readonly organizationId: string;
  /**
   * Which rooftop received it. Resolved by the caller from the number the
   * customer texted — this module is not given a way to guess, because a guess
   * would put a customer's conversation in another store's inbox.
   */
  readonly storeId: string;
  readonly phoneE164: string;
  readonly body: string;
  readonly providerRef: string | null;
  /** True only when we have just asked whether they want to resubscribe (§5). */
  readonly awaitingReOptInPrompt?: boolean;
}

export type InboundRoute =
  | { kind: 'opted_out'; conversationId: string; messageId: string; keyword: string; consentsRevoked: number }
  | { kind: 'resubscribed'; conversationId: string; messageId: string; keyword: string }
  /** They are on the stop list and this was not a re-opt-in. Filed, not answered. */
  | { kind: 'filed_suppressed'; conversationId: string; messageId: string }
  | { kind: 'to_assistant'; conversationId: string; messageId: string; leadId: string | null }
  | { kind: 'to_agent'; conversationId: string; messageId: string; assignedAgentId: string | null }
  | { kind: 'reactivated'; conversationId: string; messageId: string; leadId: string | null };

/**
 * The live conversation for this number, or a new one.
 *
 * `ON CONFLICT … DO NOTHING`, never DO UPDATE: the partial unique index is what
 * makes "one live conversation per number" true under concurrency, and DO
 * UPDATE would invoke the UPDATE policy on a row this caller may not own yet
 * (the mistake that cost CR-14 a day). Two webhooks arriving together therefore
 * produce one conversation and one loser that re-reads it.
 */
async function findOrCreateConversation(c: PoolClient, msg: InboundMessage): Promise<{
  id: string; status: string; lead_id: string | null; assigned_agent_id: string | null;
}> {
  const row = { organizationId: msg.organizationId, phone: msg.phoneE164 };
  const existing = await c.query<{
    id: string; status: string; lead_id: string | null; assigned_agent_id: string | null;
  }>(
    `SELECT id, status, lead_id, assigned_agent_id FROM conversations
     WHERE organization_id = $1 AND phone_e164 = $2 AND channel = 'sms'
       AND status <> 'closed' AND deleted_at IS NULL`,
    [row.organizationId, row.phone],
  );
  if (existing.rows[0]) return existing.rows[0];

  // A lead already on file for this number joins the conversation, so the
  // console shows a name rather than a phone number, and the daily assistant
  // cap counts against the person rather than the thread.
  const lead = await c.query<{ id: string }>(
    `SELECT id FROM leads
     WHERE organization_id = $1 AND phone = $2 AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [row.organizationId, row.phone],
  );

  await c.query(
    `INSERT INTO conversations (organization_id, store_id, lead_id, phone_e164, channel)
     VALUES ($1,$2,$3,$4,'sms')
     ON CONFLICT (organization_id, phone_e164, channel)
       WHERE status <> 'closed' AND deleted_at IS NULL
     DO NOTHING`,
    [msg.organizationId, msg.storeId, lead.rows[0]?.id ?? null, msg.phoneE164],
  );

  const created = await c.query<{
    id: string; status: string; lead_id: string | null; assigned_agent_id: string | null;
  }>(
    `SELECT id, status, lead_id, assigned_agent_id FROM conversations
     WHERE organization_id = $1 AND phone_e164 = $2 AND channel = 'sms'
       AND status <> 'closed' AND deleted_at IS NULL`,
    [row.organizationId, row.phone],
  );
  return created.rows[0]!;
}

async function isSuppressed(c: PoolClient, orgId: string, phone: string): Promise<boolean> {
  const r = await c.query(
    `SELECT 1 FROM suppression_list
     WHERE organization_id = $1 AND phone_e164 = $2 AND channel = 'sms' AND cleared_at IS NULL`,
    [orgId, phone],
  );
  return r.rows.length > 0;
}

export async function routeInbound(c: PoolClient, msg: InboundMessage): Promise<InboundRoute> {
  // 1. Keywords first — §5, and before any routing decision exists to be made.
  const keyword = await handleInboundSms(c, {
    organizationId: msg.organizationId,
    storeId: msg.storeId,
    phoneE164: msg.phoneE164,
    body: msg.body,
    messageRef: msg.providerRef,
    ...(msg.awaitingReOptInPrompt === undefined ? {} : { awaitingReOptInPrompt: msg.awaitingReOptInPrompt }),
  });

  // 2 and 3. Somewhere to live, and the message in it. This happens even for an
  // opt-out: the text that withdrew consent is the evidence that it was
  // withdrawn, and it belongs in the thread a person will read.
  const conversation = await findOrCreateConversation(c, msg);
  const messageId = await recordInbound(c, {
    organizationId: msg.organizationId,
    conversationId: conversation.id,
    body: msg.body,
    providerRef: msg.providerRef,
  });
  const base = { conversationId: conversation.id, messageId };

  if (keyword.kind === 'opted_out') {
    // The conversation closes: they have asked us to stop, and leaving it open
    // in the console invites somebody to type into it.
    await c.query(
      `UPDATE conversations SET status = 'closed', closed_at = now() WHERE id = $1`,
      [conversation.id],
    );
    return { kind: 'opted_out', ...base, keyword: keyword.keyword, consentsRevoked: keyword.consentsRevoked };
  }
  if (keyword.kind === 'resubscribed') {
    return { kind: 'resubscribed', ...base, keyword: keyword.keyword };
  }

  // 4. Who handles it.
  //
  // A suppressed number is filed and NOT answered. The gate would refuse any
  // reply anyway, so handing this to the assistant would spend a model call to
  // produce a message that cannot be sent — and would look, in the logs, like
  // an attempt to re-engage somebody who opted out.
  if (await isSuppressed(c, msg.organizationId, msg.phoneE164)) {
    return { kind: 'filed_suppressed', ...base };
  }

  if (conversation.status === 'handed_off' || conversation.status === 'agent_active') {
    // §9's silent monitoring: after a handoff the assistant never messages the
    // client again. It still reads — the analysis panel updates — but the reply
    // is a person's to write.
    return { kind: 'to_agent', ...base, assignedAgentId: conversation.assigned_agent_id };
  }

  if (conversation.status === 'drip_active') {
    // §12: "drip_active + client reply → reactivate lead and re-enter
    // assignment". Somebody answering a follow-up campaign is a live lead
    // again, whatever the campaign had concluded about them.
    await c.query(
      `UPDATE conversations SET status = 'bot_active' WHERE id = $1`, [conversation.id],
    );
    if (conversation.lead_id) {
      await c.query(
        `UPDATE leads SET status = 'chatbot_engaged', updated_at = now()
         WHERE organization_id = $1 AND id = $2 AND status NOT IN ('converted','won')`,
        [msg.organizationId, conversation.lead_id],
      );
    }
    return { kind: 'reactivated', ...base, leadId: conversation.lead_id };
  }

  return { kind: 'to_assistant', ...base, leadId: conversation.lead_id };
}
