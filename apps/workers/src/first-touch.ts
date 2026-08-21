import { withTenant, type Pool } from '@dealpilot/db';
import { FirstTouchJob, type DeferredSendJobT } from '@dealpilot/contracts';
import { safeFirstTouchMessage } from '@dealpilot/ai';
import { sendMessage } from '@dealpilot/api/send';
import { deliverMessage } from '@dealpilot/api/deliver';
import { findOrCreateConversation } from '@dealpilot/api/inbound-router';
import type { Carrier } from '@dealpilot/api/carrier';
import type { Env } from '@dealpilot/api/env';

/**
 * The first touch (F-59, overview.md §5): a fresh webhook lead gets the
 * assistant's opening SMS inside the 60-second SLA.
 *
 * No model call — the message is the §6 template, composed by the engine so
 * nothing can be talked out of the identification and STOP/ARRÊT parts. The
 * humanizing delay is deliberately absent (§6): speed IS the feature here.
 *
 * Ordering is the whole design (shaped by the F-59 review, D-059):
 *
 *   1. STAGE: gate + message row committed, nothing else stamped.
 *   2. DELIVER: post-commit carrier call. Retryable rejection THROWS so the
 *      queue's attempts fire; a retry finds the staged row (provider_ref
 *      still NULL) and redelivers it — one greeting row, ever.
 *   3. STAMP: chatbot_engaged_at + the forward-only status flip happen only
 *      after the carrier ACCEPTED. A crash between 2 and 3 re-runs into the
 *      stamp-only path.
 *
 * A gate DEFERRAL (tenant turned the quiet-hours exemption off) is not a
 * drop: the body rides a DeferredSendJob to the window opening, exactly the
 * F-21 shape — the deferred-send worker re-gates it on wake.
 */

export interface FirstTouchDeps {
  readonly pool: Pool;
  readonly carrier: Carrier;
  readonly env: Env;
  /** Re-enqueue a gate-deferred first touch at the window opening (§3). */
  readonly defer: (job: DeferredSendJobT, runAt: Date) => Promise<void>;
  readonly now?: () => Date;
}

export type FirstTouchResult =
  | { kind: 'sent'; messageId: string; conversationId: string }
  | { kind: 'deferred'; runAt: string }
  | { kind: 'not_sent'; reason: string }
  | { kind: 'skipped'; reason: string };

type Staged =
  | { kind: 'deliver'; messageId: string; conversationId: string; leadId: string; to: string; from: string; body: string }
  | { kind: 'stamp_only'; messageId: string; conversationId: string; leadId: string }
  | { kind: 'defer'; job: DeferredSendJobT; runAt: string }
  | { kind: 'not_sent'; reason: string }
  | { kind: 'skipped'; reason: string };

export async function runFirstTouch(deps: FirstTouchDeps, raw: unknown): Promise<FirstTouchResult> {
  const job = FirstTouchJob.parse(raw);
  const now = deps.now?.() ?? new Date();

  const staged = await withTenant(deps.pool, job.organization_id, async (c): Promise<Staged> => {
    const leadRow = await c.query<{
      id: string; store_id: string | null; phone: string; first_name: string | null;
      vehicle_interest: string | null; preferred_language: string; status: string;
      chatbot_engaged_at: string | null;
    }>(
      `SELECT id, store_id, phone, first_name, vehicle_interest, preferred_language,
              status, chatbot_engaged_at
       FROM leads WHERE id = $1 AND deleted_at IS NULL`,
      [job.lead_id],
    );
    const lead = leadRow.rows[0];
    if (lead === undefined) return { kind: 'skipped', reason: 'lead gone' };
    if (lead.chatbot_engaged_at !== null) return { kind: 'skipped', reason: 'already touched' };
    if (!['new', 'assigned', 'chatbot_engaged'].includes(lead.status)) {
      return { kind: 'skipped', reason: `status ${lead.status} is past a first touch` };
    }
    if (lead.store_id === null) {
      return { kind: 'skipped', reason: 'no store yet (central queue)' };
    }
    const store = await c.query<{ name: string; sms_number: string | null }>(
      `SELECT name, sms_number FROM stores WHERE id = $1 AND deleted_at IS NULL`,
      [lead.store_id],
    );
    const storeRow = store.rows[0];
    if (!storeRow?.sms_number) {
      return { kind: 'skipped', reason: 'store has no carrier number' };
    }

    const language: 'fr' | 'en' = lead.preferred_language.startsWith('fr') ? 'fr' : 'en';
    const conversation = await findOrCreateConversation(
      c,
      {
        organizationId: job.organization_id,
        storeId: lead.store_id,
        phoneE164: lead.phone,
        body: '',
        providerRef: `first-touch:${lead.id}`,
      },
      { language },
    );
    // The thread belongs to whoever it is attached to. A DIFFERENT lead on
    // this phone means an older enquiry already owns the conversation —
    // greeting a second lead into somebody's live thread helps nobody, and
    // the SLA trigger would stamp the wrong lead (review finding, D-059).
    if (conversation.lead_id !== null && conversation.lead_id !== lead.id) {
      return { kind: 'skipped', reason: 'phone already has an active conversation on another lead' };
    }

    // Crash recovery BEFORE composing anything new: a staged greeting whose
    // carrier call never concluded (provider_ref NULL) is redelivered, and a
    // delivered one that missed its stamp is stamped — never a second row.
    const pending = await c.query<{ id: string; body: string; provider_ref: string | null }>(
      `SELECT id, body, provider_ref FROM messages
       WHERE conversation_id = $1 AND direction = 'outbound' AND sender_type = 'bot'
       ORDER BY created_at LIMIT 1`,
      [conversation.id],
    );
    const prior = pending.rows[0];
    if (prior !== undefined) {
      if (prior.provider_ref !== null) {
        return { kind: 'stamp_only', messageId: prior.id, conversationId: conversation.id, leadId: lead.id };
      }
      return {
        kind: 'deliver', messageId: prior.id, conversationId: conversation.id, leadId: lead.id,
        to: lead.phone, from: storeRow.sms_number, body: prior.body,
      };
    }

    // §3: a lead in a pending duplicate pair opens with the confirming
    // variant. §6/§10: the template must survive the guard even when the
    // provider sent a price-shaped vehicle_interest — safeFirstTouchMessage
    // degrades to the generic phrase rather than tripping the gate.
    const dup = await c.query(
      `SELECT 1 FROM lead_duplicates WHERE lead_id = $1 AND status = 'pending' LIMIT 1`,
      [lead.id],
    );
    const body = safeFirstTouchMessage({
      firstName: lead.first_name,
      personaName: 'Alex',
      dealership: storeRow.name,
      vehicleInterest: lead.vehicle_interest,
      language,
      isDuplicate: dup.rows.length > 0,
    });

    const send = await sendMessage(c, {
      organizationId: job.organization_id,
      storeId: lead.store_id,
      conversationId: conversation.id,
      leadId: lead.id,
      phoneE164: lead.phone,
      body,
      senderType: 'bot',
      messageClass: 'first_touch',
      scope: 'conversational',
      isSolicitation: false,
      nowUtc: now,
    });

    if (send.kind === 'deferred') {
      // §3: the tenant turned the exemption off, so the greeting waits for
      // the window — as a job, not as a forgotten send_decisions row.
      return {
        kind: 'defer',
        runAt: send.runAt.toISOString(),
        job: {
          organization_id: job.organization_id,
          conversation_id: conversation.id,
          send_decision_id: send.decisionId,
          body,
          sender_type: 'bot',
          message_class: 'first_touch',
          attempt: 0,
        },
      };
    }
    if (send.kind !== 'sent') {
      const reason = send.kind === 'blocked' ? `${send.kind}: ${send.reason}` : send.kind;
      return { kind: 'not_sent', reason };
    }
    return {
      kind: 'deliver', messageId: send.messageId, conversationId: conversation.id, leadId: lead.id,
      to: lead.phone, from: storeRow.sms_number, body,
    };
  });

  if (staged.kind === 'skipped' || staged.kind === 'not_sent') return staged;
  if (staged.kind === 'defer') {
    await deps.defer(staged.job, new Date(staged.runAt));
    return { kind: 'deferred', runAt: staged.runAt };
  }

  if (staged.kind === 'deliver') {
    const delivery = await deliverMessage(deps.pool, deps.carrier, deps.env, {
      organizationId: job.organization_id,
      messageId: staged.messageId,
      to: staged.to,
      from: staged.from,
      body: staged.body,
    });
    if (delivery.kind === 'rejected') {
      if (delivery.retryable) {
        // The queue's attempts exist for exactly this; the staged row waits
        // (provider_ref NULL) and the retry redelivers it.
        throw new Error(`carrier rejected retryably: ${delivery.code}`);
      }
      return { kind: 'not_sent', reason: `carrier: ${delivery.code}` };
    }
  }

  // The SLA stamp — only now, with the carrier's acceptance in hand. Status
  // moves FORWARD only; an assigned lead keeps its owner.
  await withTenant(deps.pool, job.organization_id, (c) =>
    c.query(
      `UPDATE leads
       SET chatbot_engaged_at = COALESCE(chatbot_engaged_at, $2),
           status = CASE WHEN status = 'new' THEN 'chatbot_engaged' ELSE status END
       WHERE id = $1`,
      [staged.leadId, now],
    ),
  );
  return { kind: 'sent', messageId: staged.messageId, conversationId: staged.conversationId };
}
