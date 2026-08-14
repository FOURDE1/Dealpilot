import { withTenant, type Pool } from '@dealpilot/db';
import type { Carrier } from './carrier.js';
import type { Env } from './env.js';

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
 */
export async function deliverMessage(
  pool: Pool,
  carrier: Carrier,
  env: Env,
  msg: Deliverable,
): Promise<DeliveryOutcome> {
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
