import { z } from 'zod';
import { QUEUE_NAMES, QueueName, type QueueNameT } from '@dealpilot/schemas';

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
/** Hourly repeatable scan (automation-notifications.md §11.1) — no payload. */
export const QUEUE_DRIP_TICK = 'drip-tick';
/** Silent monitoring pass per message on a human-held thread (F-62, §10). */
export const QUEUE_LIVE_ANALYSIS = 'live-analysis';
/** Nightly QA judge over the day's closed conversations (F-64, §9) — no payload. */
export const QUEUE_QA_REVIEW = 'qa-review';
/** 15-minute overdue-task sweep (F-68, appointments-tasks-communications.md §3.3) — no payload. */
export const QUEUE_TASK_SWEEP = 'task-sweep';
/** One notifications row per recipient of a published announcement (F-72, §8). */
export const QUEUE_ANNOUNCEMENT_FANOUT = 'announcement-fanout';

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
 * F-62 — one silent-monitoring pass over a human-held thread (§10
 * post-handoff). Ids only, same reasoning as extraction: the worker re-reads
 * the thread under a tenant context.
 */
export const LiveAnalysisJob = z.object({
  organization_id: z.uuid(),
  conversation_id: z.uuid(),
  /** The message (either side) that triggered this pass. */
  message_id: z.uuid(),
});
export type LiveAnalysisJobT = z.infer<typeof LiveAnalysisJob>;

/**
 * A fresh lead's first AI message (F-59, overview.md §5): the 60-second SLA
 * job, deterministic id lead:{leadId}:first-touch so a double intake ACK
 * cannot queue two greetings.
 */
export const FirstTouchJob = z.object({
  organization_id: z.uuid(),
  lead_id: z.uuid(),
  /**
   * F-63 (§8.3 duplicate-as-signal): when set, this is not a greeting — the
   * submission was a high-confidence duplicate and the message is the
   * confirming re-engagement, sent to THIS keeper lead's thread instead of
   * a first touch to the new record.
   */
  duplicate_of: z.uuid().optional(),
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

/**
 * F-72 §8 — the announcement fan-out job.
 *
 * No `organization_id`: an announcement belongs to no tenant, and this job
 * deliberately never opens `withTenant`. `announcement_fanout_batch` does the
 * recipient scan and the insert in one statement as its own owner, so the
 * worker holds no tenant context at any point.
 */
export const AnnouncementFanoutJob = z.object({
  announcement_id: z.uuid(),
  /** Keyset cursor into the recipient scan; the job re-enqueues itself. */
  after_user_id: z.uuid().optional(),
});
export type AnnouncementFanoutJobT = z.infer<typeof AnnouncementFanoutJob>;

/** Recipients per pass. A poison batch costs 500 rows, not the whole platform. */
export const ANNOUNCEMENT_FANOUT_BATCH = 500;

/* ------------------------------------------------------------------------ *
 * F-73 §9 — the catalogue the job inspector reads
 * ------------------------------------------------------------------------ */

/**
 * Which queue carries which payload — and which carries none.
 *
 * Until now the queue names and the payload schemas sat in this file with
 * nothing tying one to the other: a schema could be paired with the wrong
 * queue, or a new queue could arrive with no schema, and neither is a compile
 * error. The console is the first consumer that has to know the pairing (it
 * projects identifiers out of a failed job's payload), so the pairing becomes
 * a declaration, and queue-catalogue.test.ts asserts it in BOTH directions —
 * every `*Job` schema this file exports is claimed by exactly one queue, and
 * every `null` is named below with its reason.
 *
 * `null` is not `z.object({})`. Three queues genuinely have no payload; giving
 * them an empty schema would mint three vocabularies nobody writes and nobody
 * parses, which is the bug this catalogue exists to prevent.
 */
export const QUEUE_PAYLOAD: Record<QueueNameT, z.ZodObject | null> = {
  [QUEUE_DEFERRED_SEND]: DeferredSendJob,
  [QUEUE_ASSISTANT_TURN]: AssistantTurnJob,
  [QUEUE_LEAD_REASSIGN]: LeadReassignJob,
  [QUEUE_AI_EXTRACTION]: AiExtractionJob,
  [QUEUE_FIRST_TOUCH]: FirstTouchJob,
  [QUEUE_LIVE_ANALYSIS]: LiveAnalysisJob,
  [QUEUE_ANNOUNCEMENT_FANOUT]: AnnouncementFanoutJob,
  [QUEUE_DRIP_TICK]: null,
  [QUEUE_QA_REVIEW]: null,
  [QUEUE_TASK_SWEEP]: null,
} as const;

/**
 * The name vocabulary is `packages/schemas`' (F-73 put it on the wire), and is
 * re-exported here so worker code keeps importing queue facts from one place.
 * `QUEUE_PAYLOAD` is typed against it, so a name that exists in only one of the
 * two files is a compile error rather than a queue nobody can inspect.
 */
export { QueueName, type QueueNameT };
export const JOB_QUEUE_NAMES = QUEUE_NAMES;

/** Why a queue carries no payload. One line each; the guard requires one. */
export const QUEUES_WITHOUT_PAYLOAD: Readonly<Record<string, string>> = {
  [QUEUE_DRIP_TICK]: 'an hourly repeatable scan over every due sequence — the tick carries no subject',
  [QUEUE_QA_REVIEW]: 'a nightly repeatable pass over the day\'s closed conversations — the run carries no subject',
  [QUEUE_TASK_SWEEP]: 'a 15-minute repeatable sweep over overdue tasks — the sweep carries no subject',
};

/**
 * Which worker file consumes each queue.
 *
 * A file path in the contract looks out of place, and it earns its keep: the
 * `replay` classification below is a SAFETY claim about what a retry does, and
 * the only way to check a claim about a worker's behaviour is to point at the
 * worker. apps/workers/src/queue-replay.test.ts resolves these against the
 * workers' own directory and fails if one is missing, duplicated, or if a file
 * appears there that no queue and no exemption accounts for.
 *
 * Basenames, not paths: contracts knows WHICH file, and the guard that lives
 * next to those files knows where they are.
 */
export const QUEUE_WORKER_FILE = {
  [QUEUE_DEFERRED_SEND]: 'deferred-send.ts',
  [QUEUE_ASSISTANT_TURN]: 'assistant-turn.ts',
  [QUEUE_LEAD_REASSIGN]: 'lead-reassign.ts',
  [QUEUE_AI_EXTRACTION]: 'ai-extraction.ts',
  [QUEUE_FIRST_TOUCH]: 'first-touch.ts',
  [QUEUE_LIVE_ANALYSIS]: 'live-analysis.ts',
  [QUEUE_ANNOUNCEMENT_FANOUT]: 'announcement-fanout.ts',
  [QUEUE_DRIP_TICK]: 'drip-tick.ts',
  [QUEUE_QA_REVIEW]: 'qa-review.ts',
  [QUEUE_TASK_SWEEP]: 'task-sweep.ts',
} as const satisfies Record<QueueNameT, string>;

/**
 * What putting a failed job back on the queue can do to the world.
 *
 * `idempotent` — the work converges: a unique index, an `ON CONFLICT DO
 * NOTHING`, or a claim check the job re-tests at fire time. Running it twice
 * produces one outcome.
 *
 * `at_least_once` — the worker reaches a carrier. Re-running it can put a
 * SECOND SMS in front of a real dealer customer, because the recovery path is
 * to re-deliver a staged row whose `provider_ref` is still NULL and
 * `provider_ref` is written only AFTER `carrier.send` returns: a timeout in
 * that window leaves a message delivered and unmarked. The compliance gate
 * re-runs, which is what is actually proven; "no duplicate is sent" is not.
 * These queues carry the typed-back confirm at n >= 1, not n > 1 — one
 * duplicated message under CASL is the harm, not two.
 */
export type ReplayClassT = 'idempotent' | 'at_least_once';

export interface JobQueueEntry {
  /**
   * Whether a DLQ page can be filtered by tenant. DERIVED from the payload
   * below, never hand-typed, so a queue that gains or loses `organization_id`
   * moves the catalogue with it. Four of the ten cannot be scoped at all, and
   * for those the API REFUSES an `?organization_id=` filter rather than
   * returning an empty page that reads as "this tenant has no failures".
   */
  readonly org_scoped: boolean;
  /**
   * The ONLY payload keys a DLQ row may show, per queue.
   *
   * This is the whole PII story, and it is an allow-list because a denylist
   * fails open on the next queue somebody adds. This file's own header says a
   * payload never carries a message body; `DeferredSendJob.body` is exactly
   * that — up to 1600 characters of a real customer's SMS, carried because it
   * cannot be re-derived — so a generic payload viewer would render dealer
   * customers' text messages into the platform console. queue-catalogue.test.ts
   * asserts every listed key exists in its own schema and unwraps to a uuid, a
   * number or an enum — never a bare string — and refuses `'body'` by name.
   */
  readonly dlq_fields: readonly string[];
  readonly replay: ReplayClassT;
}

/** The hand-made half: two decisions per queue, each with its own guard. */
const QUEUE_DECISIONS = {
  [QUEUE_DEFERRED_SEND]: {
    dlq_fields: ['organization_id', 'conversation_id', 'send_decision_id', 'sender_type', 'message_class', 'attempt'],
    replay: 'at_least_once',
  },
  [QUEUE_ASSISTANT_TURN]: {
    dlq_fields: ['organization_id', 'conversation_id', 'message_id', 'attempt'],
    replay: 'at_least_once',
  },
  [QUEUE_LEAD_REASSIGN]: {
    dlq_fields: ['organization_id', 'lead_id', 'assigned_to', 'attempt'],
    replay: 'idempotent',
  },
  [QUEUE_AI_EXTRACTION]: {
    dlq_fields: ['organization_id', 'conversation_id', 'message_id'],
    replay: 'idempotent',
  },
  [QUEUE_FIRST_TOUCH]: {
    dlq_fields: ['organization_id', 'lead_id', 'duplicate_of'],
    replay: 'at_least_once',
  },
  [QUEUE_LIVE_ANALYSIS]: {
    dlq_fields: ['organization_id', 'conversation_id', 'message_id'],
    replay: 'idempotent',
  },
  [QUEUE_ANNOUNCEMENT_FANOUT]: {
    dlq_fields: ['announcement_id', 'after_user_id'],
    replay: 'idempotent',
  },
  [QUEUE_DRIP_TICK]: { dlq_fields: [], replay: 'at_least_once' },
  [QUEUE_QA_REVIEW]: { dlq_fields: [], replay: 'idempotent' },
  [QUEUE_TASK_SWEEP]: { dlq_fields: [], replay: 'idempotent' },
} as const satisfies Record<QueueNameT, Omit<JobQueueEntry, 'org_scoped'>>;

/** The one place `org_scoped` is decided, so nowhere else can decide it wrongly. */
export function queueIsOrgScoped(name: QueueNameT): boolean {
  const payload = QUEUE_PAYLOAD[name];
  return payload !== null && 'organization_id' in payload.shape;
}

const catalogue = {} as Record<QueueNameT, JobQueueEntry>;
for (const name of JOB_QUEUE_NAMES) {
  catalogue[name] = Object.freeze({ ...QUEUE_DECISIONS[name], org_scoped: queueIsOrgScoped(name) });
}

export const JOB_QUEUES: Readonly<Record<QueueNameT, JobQueueEntry>> = Object.freeze(catalogue);
