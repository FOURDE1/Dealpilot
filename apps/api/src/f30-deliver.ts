import { withTenant, type Pool } from '@dealpilot/db';
import type { Carrier } from './carrier.js';
import type { Env } from './env.js';
import { killSwitches } from './platform-settings.js';

/**
 * Handing a committed message to the carrier (F-30).
 *
 * Called AFTER the transaction that wrote the message row, never inside it,
 * and the ordering is the whole design.
 *
 * The two failure modes are not equally bad. A message SENT with no row is
 * unrecoverable — a CASL inquiry asks what was sent, to whom, and on what
 * basis, and there would be no answer. A row with nothing sent is merely wrong
 * on a screen, visible, and fixable. So the row wins the race: it is written and
 * committed first, and this runs afterwards.
 *
 * That leaves a real window where the row exists and the message has not gone
 * out. It is deliberate, it is the cheaper of the two, and it is legible in the
 * data: `provider_ref IS NULL AND carrier_error IS NULL` means in flight.
 */

export interface Deliverable {
  readonly organizationId: string;
  readonly messageId: string;
  /** The customer. From the conversation row, never from a request body. */
  readonly to: string;
  /** The store's carrier number. */
  readonly from: string;
  readonly body: string;
}

export type DeliveryOutcome =
  | { kind: 'accepted'; providerRef: string; segments: number }
  | { kind: 'rejected'; code: string; message: string; retryable: boolean };

/**
 * Send it, then record what the carrier said.
 *
 * Never throws for a carrier refusal — a rejection is an outcome, not an
 * exception. Throwing here would unwind a caller that has already committed a
 * message row and a `send_decisions` row, leaving it to guess what happened.
 *
 * F-72 §5.3 — the kill-switch BELT. `sendMessage` is the buckle: it refuses
 * at authorization, before a row exists. This belt exists because THREE paths
 * reach the carrier without passing `evaluateSend` at all, all of them the same
 * crash recovery: `processEnrollment` in `apps/workers/src/drip-tick.ts`, and
 * the two scans in `apps/workers/src/first-touch.ts` — `runFirstTouch`'s own
 * greeting and `stageDuplicateConfirm`'s re-engagement notice. Each re-delivers
 * a staged message whose carrier call never concluded (`provider_ref IS NULL`)
 * and so has no fresh decision behind it. The belt runs strictly BEFORE
 * `carrier.send`, so a failed switch read leaves the row in the already
 * documented in-flight state and nothing was sent; the next tick re-attempts
 * it once the switch lifts.
 *
 * Anything added here that can throw fails a whole BullMQ handler, so weigh it.
 * The switch read is not the only throw path — `carrier.send` throws through
 * `assertSendable`, and the post-send UPDATE throws on any database error — and
 * only two of the five worker call sites are caught per item: `drip-tick.ts`
 * wraps each enrollment, and `assistant-turn.ts`'s handoff phase may never fail
 * the job. The other three (`assistant-turn.ts`'s own reply, `deferred-send.ts`,
 * `first-touch.ts`) call it at function-body level under a bare processor.
 */
export async function deliverMessage(
  pool: Pool,
  carrier: Carrier,
  env: Env,
  msg: Deliverable,
): Promise<DeliveryOutcome> {
  const sw = await killSwitches(pool);
  if (sw.sms_send_killswitch || sw.ai_outbound_killswitch) {
    const paused = await withTenant(pool, msg.organizationId, async (c) => {
      const r = await c.query<{ sender_type: string }>(
        'SELECT sender_type FROM messages WHERE organization_id = $1 AND id = $2',
        [msg.organizationId, msg.messageId],
      );
      const senderType = r.rows[0]?.sender_type ?? null;
      // `originatorOf` (f19-send.ts) calls bot and drip 'ai'; agent and system
      // are a person's message and only the SMS switch stops those.
      const key = sw.sms_send_killswitch
        ? 'sms_send_killswitch'
        : senderType === 'bot' || senderType === 'drip'
          ? 'ai_outbound_killswitch'
          : null;
      if (!key) return null;
      await c.query(
        'UPDATE messages SET carrier_error = $3 WHERE organization_id = $1 AND id = $2',
        [msg.organizationId, msg.messageId, `platform_paused: ${key}`],
      );
      return key;
    });
    if (paused) {
      return {
        kind: 'rejected',
        code: 'platform_paused',
        message: `outbound is paused platform-wide (${paused})`,
        retryable: true,
      };
    }
  }

  const statusCallbackUrl = env.PUBLIC_WEBHOOK_ORIGIN
    ? new URL('/carrier/v1/sms/status', env.PUBLIC_WEBHOOK_ORIGIN).toString()
    : undefined;

  const result = await carrier.send({
    to: msg.to,
    from: msg.from,
    body: msg.body,
    statusCallbackUrl,
  });

  await withTenant(pool, msg.organizationId, async (c) => {
    if (result.kind === 'accepted') {
      // `provider_ref` and `segments` are delivery fields, which the
      // append-only trigger permits (0031). Body, direction and consent are
      // not, and this could not rewrite them if it tried.
      await c.query(
        `UPDATE messages SET provider_ref = $2, segments = $3, carrier_error = NULL
         WHERE organization_id = $1 AND id = $4`,
        [msg.organizationId, result.providerRef || null, result.segments, msg.messageId],
      );
      return;
    }
    await c.query(
      `UPDATE messages SET carrier_error = $2 WHERE organization_id = $1 AND id = $3`,
      [msg.organizationId, `${result.code}: ${result.message}`, msg.messageId],
    );
  });

  return result.kind === 'accepted'
    ? { kind: 'accepted', providerRef: result.providerRef, segments: result.segments }
    : { kind: 'rejected', code: result.code, message: result.message, retryable: result.retryable };
}
