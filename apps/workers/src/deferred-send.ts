import { withTenant, type Pool } from '@dealpilot/db';
import {
  DeferredSendJob, MAX_DEFERRALS, QUEUE_DEFERRED_SEND, type DeferredSendJobT,
} from '@dealpilot/contracts';
import { sendMessage } from '@dealpilot/api/send';
import { deliverMessage } from '@dealpilot/api/deliver';
import type { Carrier } from '@dealpilot/api/carrier';
import type { Env } from '@dealpilot/api/env';

/**
 * Sending a message the gate told us to wait on (F-32).
 *
 * This job exists because `send_decisions.deferred_until` was written by the
 * send layer and read by NOTHING. A message the compliance gate deferred — a
 * follow-up composed at 22:40 for a customer whose quiet hours start at 21:00 —
 * was recorded as deferred and then silently dropped. It never went at 09:00.
 * It never went at all.
 *
 * The gate's own remedy string is the specification for this file:
 *
 *     're-enqueue and re-run the whole gate on wake'
 *
 * RE-RUN, not replay. Between the deferral and the wake, the customer may have
 * texted STOP, their consent may have expired, a person may have taken the
 * conversation, or the daily cap may now be spent. A worker that woke up and
 * sent the stored text would be a second send path with none of those checks —
 * and it would be the one that messages somebody who opted out at midnight.
 */

export const DEFERRED_SEND_QUEUE = QUEUE_DEFERRED_SEND;

export interface DeferredSendDeps {
  readonly pool: Pool;
  readonly carrier: Carrier;
  readonly env: Env;
  /** Injected so a test can drive the clock instead of waiting for 09:00. */
  readonly now?: () => Date;
  /** Put a job back to sleep. Returns nothing; failure to reschedule throws. */
  readonly reschedule: (job: DeferredSendJobT, runAt: Date) => Promise<void>;
}

export type DeferredSendResult =
  | { kind: 'sent'; messageId: string }
  | { kind: 'deferred_again'; runAt: Date; attempt: number }
  | { kind: 'abandoned'; reason: string }
  | { kind: 'blocked'; reason: string };

/**
 * Process one deferred send.
 *
 * Pure of BullMQ on purpose: it takes a parsed payload and returns an outcome,
 * so the interesting behaviour is testable without a queue running. The BullMQ
 * wiring in `index.ts` is the thin part.
 */
export async function runDeferredSend(
  deps: DeferredSendDeps,
  raw: unknown,
): Promise<DeferredSendResult> {
  // Parsed, not trusted. A deploy can land between enqueue and consume, so this
  // payload was written by a version of the code that no longer exists.
  const job = DeferredSendJob.parse(raw);
  const now = deps.now?.() ?? new Date();

  const conversation = await withTenant(deps.pool, job.organization_id, async (c) => {
    const r = await c.query<{
      id: string; store_id: string; lead_id: string | null; phone_e164: string; status: string;
    }>(
      `SELECT id, store_id, lead_id, phone_e164, status
       FROM conversations WHERE id = $1 AND deleted_at IS NULL`,
      [job.conversation_id],
    );
    return r.rows[0] ?? null;
  });

  // The conversation was deleted, or closed while this slept. A closed thread
  // is one somebody decided was finished; waking up to add to it would be the
  // system arguing with a person.
  if (!conversation) return { kind: 'abandoned', reason: 'conversation is gone' };
  if (conversation.status === 'closed') {
    return { kind: 'abandoned', reason: 'conversation was closed while deferred' };
  }

  const outcome = await withTenant(deps.pool, job.organization_id, (c) =>
    // The WHOLE gate, again. Suppression, consent, DNCL, quiet hours, the daily
    // cap — every one of them re-evaluated against now, not against the moment
    // the message was composed.
    sendMessage(c, {
      organizationId: job.organization_id,
      storeId: conversation.store_id,
      conversationId: conversation.id,
      leadId: conversation.lead_id,
      phoneE164: conversation.phone_e164,
      body: job.body,
      senderType: job.sender_type,
      messageClass: job.message_class,
      scope: 'conversational',
      isSolicitation: false,
      nowUtc: now,
    }),
  );

  if (outcome.kind === 'sent') {
    const store = await withTenant(deps.pool, job.organization_id, async (c) => {
      const r = await c.query<{ sms_number: string | null }>(
        `SELECT sms_number FROM stores WHERE id = $1`, [conversation.store_id],
      );
      return r.rows[0] ?? null;
    });
    if (store?.sms_number) {
      await deliverMessage(deps.pool, deps.carrier, deps.env, {
        organizationId: job.organization_id,
        messageId: outcome.messageId,
        to: conversation.phone_e164,
        from: store.sms_number,
        body: job.body,
      });
    }
    return { kind: 'sent', messageId: outcome.messageId };
  }

  if (outcome.kind === 'deferred') {
    const attempt = job.attempt + 1;
    if (attempt >= MAX_DEFERRALS) {
      // Deferring forever is how a message gets sent at a random hour on the
      // tenth attempt. Stopping is the honest outcome, and the decision rows
      // are already on file for whoever asks why.
      return { kind: 'abandoned', reason: `deferred ${attempt} times; giving up` };
    }
    await deps.reschedule({ ...job, attempt }, outcome.runAt);
    return { kind: 'deferred_again', runAt: outcome.runAt, attempt };
  }

  if (outcome.kind === 'blocked') {
    // The common and correct case: they texted STOP while this slept. The gate
    // refused, a `send_decisions` row records why, and nothing was sent.
    return { kind: 'blocked', reason: outcome.reason };
  }

  // The content guard refused the stored draft. It passed when composed, so
  // this means the guard got stricter — which is a change worth not sending
  // through.
  return { kind: 'blocked', reason: 'unsafe' };
}
