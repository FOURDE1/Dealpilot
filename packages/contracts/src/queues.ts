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

/**
 * The namespace, kept OUT of the queue names.
 *
 * These were `dealpilot:deferred-send` and `dealpilot:assistant-turn` until the
 * first environment that actually had Redis tried to boot: BullMQ rejects a
 * colon in a queue name, because a colon is its own Redis key separator, and
 * the constructor throws. Both the API and the workers died on startup.
 *
 * It survived that long because `createDeferredSendQueue` returns a no-op when
 * REDIS_URL is unset, and no local process sets it — so in eight commits of
 * F-32 the Queue was never once constructed. Declared in three places,
 * reachable from none.
 *
 * `prefix` is the supported way to namespace, and it produces the same Redis
 * keys the colon was reaching for.
 */
export const QUEUE_PREFIX = 'dealpilot';

export const QUEUE_DEFERRED_SEND = 'deferred-send';
export const QUEUE_ASSISTANT_TURN = 'assistant-turn';
export const QUEUE_LEAD_REASSIGN = 'lead-reassign';
export const QUEUE_AI_EXTRACTION = 'ai-extraction';
export const QUEUE_FIRST_TOUCH = 'first-touch';

/**
 * Build the options every Queue and Worker must be constructed with.
 *
 * Exists so the prefix cannot be supplied on one side and forgotten on the
 * other. That mistake is worse than the crash it replaced: the API would
 * enqueue under `dealpilot:` while the worker blocked on `bull:`, both
 * processes healthy, no error anywhere, and every deferred message waiting
 * forever for a consumer that is listening somewhere else.
 * `queue-naming.test.ts` fails the build if a call site skips this.
 *
 * Generic over the connection so this package keeps no bullmq dependency —
 * contracts is what the two sides agree on, not where either of them runs.
 */
export function queueOpts<C>(connection: C): { connection: C; prefix: string } {
  return { connection, prefix: QUEUE_PREFIX };
}

/**
 * A customer texted and the router said the assistant should answer.
 *
 * On the queue rather than inline in the webhook, for a reason with a number
 * attached: NFR-PERF puts intake ACK at p99 < 1s, and a model call with a tool
 * loop is seconds. A webhook that waited would have the carrier time out and
 * retry, which — before the idempotency index — would have produced a second
 * copy of the customer's message and a second reply.
 *
 * Carries the message ID, not the text. The worker re-reads the thread under a
 * tenant context, so what the model sees is what the database holds rather than
 * what a queue payload claimed it held.
 */
export const AssistantTurnJob = z.object({
  organization_id: z.uuid(),
  conversation_id: z.uuid(),
  /** The inbound message that triggered this turn. */
  message_id: z.uuid(),
  attempt: z.number().int().min(0).max(3).default(0),
});
export type AssistantTurnJobT = z.infer<typeof AssistantTurnJob>;

/**
 * Re-derive the structured facts after a client message (F-57, §5).
 *
 * Ids only, same reasoning as the assistant turn: the worker re-reads the
 * thread under a tenant context; a payload carrying text could drift from
 * what the database holds.
 */
export const AiExtractionJob = z.object({
  organization_id: z.uuid(),
  conversation_id: z.uuid(),
  /** The inbound message that triggered this pass. */
  message_id: z.uuid(),
});
export type AiExtractionJobT = z.infer<typeof AiExtractionJob>;

/**
 * A fresh lead's first AI message (F-59, overview.md §5): the 60-second SLA
 * job, deterministic id lead:{leadId}:first-touch so a double intake ACK
 * cannot queue two greetings.
 */
export const FirstTouchJob = z.object({
  organization_id: z.uuid(),
  lead_id: z.uuid(),
});
export type FirstTouchJobT = z.infer<typeof FirstTouchJob>;

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
 * F-42.2 — the ten-minute reassignment ladder (FR-LEAD-010, leads.md §5.2).
 * One delayed job per assignment, jobId `reassign:{lead_id}:{attempt}`
 * (deterministic = idempotent under webhook redelivery and double-enqueue).
 * The job VERIFIES at fire time instead of being cancelled (D-046 #1):
 * assigned_to and attempt are the claim check — if either moved, the job is
 * about an assignment that no longer exists and does nothing.
 */
export const LeadReassignJob = z.object({
  organization_id: z.uuid(),
  lead_id: z.uuid(),
  /** Who held the lead when this timer started. */
  assigned_to: z.uuid(),
  /** leads.assignment_attempts at enqueue time. */
  attempt: z.number().int().min(0),
});
export type LeadReassignJobT = z.infer<typeof LeadReassignJob>;

/** 10 minutes, per the §5.2 ladder. One constant so both sides agree. */
export const REASSIGN_AFTER_MS = 10 * 60 * 1000;

/** The ladder's length: the 3rd strike goes straight to the sales manager. */
export const REASSIGN_MAX_ATTEMPTS = 3;

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
