import { withTenant, type Pool, type PoolClient } from '@dealpilot/db';
import { tenantOperational } from './tenant-status.js';
import { FirstTouchJob, type DeferredSendJobT, type FirstTouchJobT } from '@dealpilot/contracts';
import { safeFirstTouchMessage } from '@dealpilot/ai';
import { isPlatformPause } from '@dealpilot/core';
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
  /**
   * F-69: put THIS job back on the first-touch queue later — a tenant that
   * is not operational (read-only, suspended) greets the lead when it is
   * again, not never. Optional so tests without a queue still run.
   */
  readonly retryLater?: (job: FirstTouchJobT, runAt: Date) => Promise<void>;
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

/**
 * F-63 (§8.3): the confirming re-engagement for a HIGH-CONFIDENCE duplicate
 * submission — sent to the KEEPER's thread, because the resubmission is a
 * fact about the relationship that already exists, not about the record
 * intake just wrote. Same gate, same deferral, same delivery discipline as
 * the greeting; a different message class ('re_engagement') because that is
 * what it is.
 */
async function stageDuplicateConfirm(
  c: PoolClient,
  job: { organization_id: string; lead_id: string },
  keeperId: string,
  now: Date,
): Promise<Staged> {
  const keeperRow = await c.query<{
    id: string; store_id: string | null; phone: string; first_name: string | null;
    preferred_language: string;
  }>(
    `SELECT id, store_id, phone, first_name, preferred_language
     FROM leads WHERE id = $1 AND deleted_at IS NULL`,
    [keeperId],
  );
  const keeper = keeperRow.rows[0];
  if (keeper === undefined) return { kind: 'skipped', reason: 'keeper gone' };
  if (keeper.store_id === null) return { kind: 'skipped', reason: 'keeper has no store yet' };
  const store = await c.query<{ name: string; sms_number: string | null }>(
    `SELECT name, sms_number FROM stores WHERE id = $1 AND deleted_at IS NULL`,
    [keeper.store_id],
  );
  const storeRow = store.rows[0];
  if (!storeRow?.sms_number) return { kind: 'skipped', reason: 'store has no carrier number' };

  // The submission record is the job's idempotency ANCHOR: its
  // chatbot_engaged_at stamps "this resubmission got its machine response",
  // so a replay after any crash window is a recorded no-op, not a second
  // text (the greeting path's own discipline, applied to this identity).
  const source = await c.query<{ chatbot_engaged_at: string | null; created_at: Date }>(
    `SELECT chatbot_engaged_at, created_at FROM leads WHERE id = $1`,
    [job.lead_id],
  );
  if (source.rows[0]?.chatbot_engaged_at) {
    return { kind: 'skipped', reason: 'this resubmission was already confirmed' };
  }
  const sourceCreatedAt = source.rows[0]?.created_at ?? now;

  const language: 'fr' | 'en' = keeper.preferred_language.startsWith('fr') ? 'fr' : 'en';
  // NOT findOrCreateConversation: its lead-attach picks the NEWEST lead on
  // the phone, which — since the §8.3 gate requires a phone match — is
  // always the just-created duplicate record. The confirmation would then
  // refuse its own conversation and the phone's one live thread would be
  // bound to a record nobody works (review blocker). The thread belongs to
  // the KEEPER; we find it, adopt it, or create it saying so.
  const live = await c.query<{ id: string; lead_id: string | null; status: string }>(
    `SELECT id, lead_id, status FROM conversations
     WHERE organization_id = $1 AND phone_e164 = $2 AND channel = 'sms'
       AND status <> 'closed' AND deleted_at IS NULL`,
    [job.organization_id, keeper.phone],
  );
  let conversation = live.rows[0];
  if (conversation) {
    if (conversation.lead_id === null || conversation.lead_id === job.lead_id) {
      // Unowned, or owned by our own duplicate record: the keeper adopts it.
      await c.query(`UPDATE conversations SET lead_id = $2 WHERE id = $1`, [
        conversation.id, keeper.id,
      ]);
    } else if (conversation.lead_id !== keeper.id) {
      return { kind: 'skipped', reason: 'phone already has an active conversation on another lead' };
    }
  } else {
    await c.query(
      `INSERT INTO conversations (organization_id, store_id, lead_id, phone_e164, channel, language)
       VALUES ($1,$2,$3,$4,'sms',$5)
       ON CONFLICT (organization_id, phone_e164, channel)
         WHERE status <> 'closed' AND deleted_at IS NULL
       DO NOTHING`,
      [job.organization_id, keeper.store_id, keeper.id, keeper.phone, language],
    );
    conversation = (
      await c.query<{ id: string; lead_id: string | null; status: string }>(
        `SELECT id, lead_id, status FROM conversations
         WHERE organization_id = $1 AND phone_e164 = $2 AND channel = 'sms'
           AND status <> 'closed' AND deleted_at IS NULL`,
        [job.organization_id, keeper.phone],
      )
    ).rows[0]!;
  }
  // A person holds the thread: they can see the resubmission themselves —
  // the machine interjecting to confirm interest would talk over them.
  if (conversation.status === 'agent_active' || conversation.status === 'handed_off') {
    return { kind: 'skipped', reason: 'a person has the thread' };
  }

  // Person-level dedupe: however many jobs a form double-submit or provider
  // retry mints, one confirming text a day is the ceiling for one human.
  const recent = await c.query(
    `SELECT 1 FROM messages m
     JOIN send_decisions d ON d.id = m.send_decision_id
     WHERE m.conversation_id = $1 AND m.direction = 'outbound' AND m.sender_type = 'bot'
       AND d.message_class = 're_engagement' AND m.provider_ref IS NOT NULL
       AND m.created_at > now() - interval '24 hours' LIMIT 1`,
    [conversation.id],
  );
  if (recent.rows.length > 0) {
    // Mark the submission handled so nothing ever revisits it — the person
    // already has today's confirmation on their phone.
    await c.query(
      `UPDATE leads SET chatbot_engaged_at = COALESCE(chatbot_engaged_at, $2) WHERE id = $1`,
      [job.lead_id, now],
    );
    return { kind: 'skipped', reason: 'this person was confirmed within the last day' };
  }

  // Crash recovery scoped to THIS resubmission: a staged confirmation whose
  // carrier call never concluded is redelivered; a delivered one that missed
  // its stamp is stamped — never a second row (the greeting's discipline).
  const prior = await c.query<{ id: string; body: string; provider_ref: string | null }>(
    `SELECT m.id, m.body, m.provider_ref FROM messages m
     JOIN send_decisions d ON d.id = m.send_decision_id
     WHERE m.conversation_id = $1 AND m.direction = 'outbound' AND m.sender_type = 'bot'
       AND d.message_class = 're_engagement' AND m.created_at >= $2
     ORDER BY m.created_at DESC LIMIT 1`,
    [conversation.id, sourceCreatedAt],
  );
  if (prior.rows[0]) {
    if (prior.rows[0].provider_ref !== null) {
      return { kind: 'stamp_only', messageId: prior.rows[0].id, conversationId: conversation.id, leadId: job.lead_id };
    }
    return {
      kind: 'deliver', messageId: prior.rows[0].id, conversationId: conversation.id,
      leadId: job.lead_id, to: keeper.phone, from: storeRow.sms_number, body: prior.rows[0].body,
    };
  }

  const body = safeFirstTouchMessage({
    firstName: keeper.first_name,
    personaName: 'Alex',
    dealership: storeRow.name,
    vehicleInterest: null,
    language,
    isDuplicate: true,
  });
  const send = await sendMessage(c, {
    organizationId: job.organization_id,
    storeId: keeper.store_id,
    conversationId: conversation.id,
    leadId: keeper.id,
    phoneE164: keeper.phone,
    body,
    senderType: 'bot',
    messageClass: 're_engagement',
    scope: 'conversational',
    isSolicitation: false,
    nowUtc: now,
  });
  if (send.kind === 'deferred') {
    return {
      kind: 'defer',
      runAt: send.runAt.toISOString(),
      job: {
        organization_id: job.organization_id,
        conversation_id: conversation.id,
        send_decision_id: send.decisionId,
        body,
        sender_type: 'bot',
        message_class: 're_engagement',
        attempt: 0,
      },
    };
  }
  if (send.kind !== 'sent') {
    const reason = send.kind === 'blocked' ? `${send.kind}: ${send.reason}` : send.kind;
    return { kind: 'not_sent', reason };
  }
  // leadId here is the STAMP target — the source record, the job's anchor.
  // The message itself is attributed to the keeper (sendMessage above).
  return {
    kind: 'deliver', messageId: send.messageId, conversationId: conversation.id, leadId: job.lead_id,
    to: keeper.phone, from: storeRow.sms_number, body,
  };
}

export async function runFirstTouch(deps: FirstTouchDeps, raw: unknown): Promise<FirstTouchResult> {
  const job = FirstTouchJob.parse(raw);
  const now = deps.now?.() ?? new Date();

  // F-69: a suspended or read-only tenant's first touch is not sent NOW —
  // the lead is recorded by intake; the greeting is retried hourly until the
  // tenant is operational again (review: "waits" has to mean a retry).
  if (!(await withTenant(deps.pool, job.organization_id, tenantOperational))) {
    await deps.retryLater?.(job, new Date(now.getTime() + 60 * 60_000));
    return { kind: 'skipped', reason: deps.retryLater ? 'tenant_not_operational; retry in 1h' : 'tenant_not_operational' };
  }

  const staged = await withTenant(deps.pool, job.organization_id, async (c): Promise<Staged> => {
    // F-63: a duplicate-confirmation job targets the keeper, not this lead.
    if (job.duplicate_of) return stageDuplicateConfirm(c, job, job.duplicate_of, now);
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

  // F-72: a platform kill switch postponed this greeting, it did not refuse
  // it. Retry hourly like the tenant-not-operational branch above, so a lead
  // that arrived during an incident is still greeted once it lifts — dropping
  // it here would miss the 60-second SLA permanently and report success.
  if (staged.kind === 'not_sent' && isPlatformPause(staged.reason.replace(/^blocked: /, ''))) {
    await deps.retryLater?.(job, new Date(now.getTime() + 60 * 60_000));
    return {
      kind: 'skipped',
      reason: deps.retryLater ? `${staged.reason}; retry in 1h` : staged.reason,
    };
  }
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
