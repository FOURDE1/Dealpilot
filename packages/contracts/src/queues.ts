import { z } from 'zod';

/**
 * The job contract (F-32, ADR-012).
 *
 * Names and payloads live here, beside the realtime contract, for the same
 * reason: two processes have to agree, and the agreement is worth writing down
 * once rather than twice. The API enqueues, the worker consumes, and neither
 * owns the shape.
 *
 * Payloads are Zod-parsed on BOTH sides. A job is data that outlives the
 * process that wrote it — a deploy can land between enqueue and consume, so the
 * worker reading a job is reading something an older version of the code
 * produced. Parsing on the way out is how that becomes a clear failure instead
 * of an undefined property three frames deep.
 *
 * Note what a payload never carries: message bodies, phone numbers, or anything
 * else a Redis instance should not be holding. A job carries IDENTIFIERS, and
 * the worker re-reads the facts from Postgres under a tenant context. Redis is
 * a scheduler here, not a second database.
 */

export const QUEUE_DEFERRED_SEND = 'dealpilot:deferred-send';

/**
 * A message the compliance gate deferred (usually quiet hours).
 *
 * The gate's own remedy for a deferral reads "re-enqueue and re-run the whole
 * gate on wake", and this payload is built to make that the only possible
 * behaviour: it carries no body and no decision, only what is needed to
 * re-derive one. A worker holding the original text could send it without
 * asking again, and the thing it would skip is consent that may have been
 * withdrawn while the job slept.
 */
export const DeferredSendJob = z.object({
  organization_id: z.uuid(),
  conversation_id: z.uuid(),
  /** The decision that deferred it — for the audit trail, not for replaying. */
  send_decision_id: z.uuid(),
  /**
   * What the assistant or agent wanted to say. Carried because it cannot be
   * re-derived — but it is re-gated on wake, never re-sent on trust.
   */
  body: z.string().min(1).max(1600),
  sender_type: z.enum(['bot', 'agent', 'system', 'drip']),
  message_class: z.enum([
    'inbound_reply', 'first_touch', 'drip', 'follow_up', 're_engagement', 'outbound_voice',
  ]),
  /** How many times this has already been put back to sleep (see the cap). */
  attempt: z.number().int().min(0).max(10).default(0),
});
export type DeferredSendJobT = z.infer<typeof DeferredSendJob>;

/**
 * How many times a message may be deferred before it is abandoned.
 *
 * A deferral is not a retry: it means "not now, try at the start of the next
 * window". Two or three is a message that keeps landing outside quiet hours;
 * five is a bug, or a customer in a timezone the resolver keeps getting wrong,
 * and continuing would text somebody at a random hour on the sixth attempt
 * rather than admit something is wrong.
 */
export const MAX_DEFERRALS = 5;
