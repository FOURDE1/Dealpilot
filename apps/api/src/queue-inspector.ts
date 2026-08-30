import { Queue } from 'bullmq';
import { JOB_QUEUES, JOB_QUEUE_NAMES, queueOpts, type QueueNameT } from '@dealpilot/contracts';
import type { QueueStateT, RetryOutcomeT } from '@dealpilot/schemas';
import type { Env } from './env.js';

/**
 * F-73 §9 — reading the job queues from the platform console.
 *
 * Behind an interface for the reason `reassign-queue.ts:16-21` gives: the API
 * has to run with no Redis, every test builds one, and a console page that
 * must have a message broker would conscript sixty test files. The difference
 * from the two producers is the direction — they enqueue and degrade loudly
 * when they cannot; this one READS, and a read that cannot happen must say so
 * rather than answer zero.
 *
 * That distinction is the whole design. "Nothing has failed" and "we could not
 * ask" are different facts, and an operator staring at a stuck queue at 3am is
 * exactly the person who must be able to tell them apart, so every method
 * carries a `queue_state` and every count is NULL under anything but `ok`.
 */

/**
 * The per-read belt, and the SOLE hang control.
 *
 * A `Queue`'s first read against an unreachable Redis HANGS. `getJobCounts()`
 * awaits `this.client`, which is `RedisConnection.initializing`
 * (`redis-connection.js:157-159`), and `init()` awaits `waitUntilReady`
 * (`:189-191`), which waits for a 'ready' event that ioredis's default
 * retryStrategy — 1s to 20s, forever — never lets fire. Nothing rejects and
 * nothing times out. This race is the only thing that turns that into
 * `queue_state: 'unreachable'`; delete it and the DLQ page hangs.
 *
 * The obvious-looking shortcut is `skipWaitingForReady: true`, and it is a
 * trap: `initializing` is assigned exactly ONCE (`redis-connection.js:83`), so
 * an `init()` that skips the ready wait issues its `INFO` round-trip on a
 * socket still in `connecting`, `enableOfflineQueue: false` refuses it, and
 * the cached handle then reports `unreachable` FOREVER against a perfectly
 * healthy Redis. Reproduced live, both ways, against dealpilot-redis.
 */
export const QUEUE_READ_TIMEOUT_MS = 1500;

/**
 * How deep into the failed set the console will page at all.
 *
 * The console's own ceiling — NOT a match for `removeOnFail`, which is 5000 on
 * the seven job queues and 100/30/100 on the three repeatables. A cursor
 * position beyond it is refused by the codec before any Redis command is
 * issued, so a forged `o: 10_000_000` can never become a range read.
 */
export const DLQ_POSITION_MAX = 5000;

/**
 * The most zset entries one page may read.
 *
 * The tenant filter runs in TypeScript over the projected payloads (a queue's
 * failed set is not indexed by organization), so the filter's cost has to be
 * bounded and VISIBLE: every page reports `scanned`, and the caption says the
 * page is the first matches within this ceiling rather than pretending to be
 * every match.
 */
export const DLQ_SCAN_MAX = 500;

/** A carrier rejection quotes the number it rejected; 500 chars is the tail. */
export const FAILED_REASON_MAX = 500;
export const STACK_LINE_MAX = 300;
/** One allow-listed payload value. Ids are 36 chars; this is slack, not room. */
export const FIELD_VALUE_MAX = 120;

/**
 * The budget for one `retry()` loop, independent of the per-read belt.
 *
 * Twenty ids x two round-trips (a `getJob` and a `retry`) x the 1500 ms
 * per-read budget is up to 60s of work, which is longer than the request may
 * honestly live. So the loop stops early under load and `not_attempted` is a
 * NORMAL outcome rather than an error — and it is answerable precisely because
 * the register row is filed before the loop with the full requested list.
 *
 * It covers the loop, not the request: `organizationsOf` runs first, outside
 * this budget, because it precedes the register row. It has its own
 * {@link ATTRIBUTION_BUDGET_MS} wall clock — an unreachable Redis collapses to
 * ONE belt by stopping at the first unreadable id, but a slow-but-alive Redis
 * would otherwise spend one belt per id, so the clock is what bounds the case
 * that actually happens.
 */
export const RETRY_TOTAL_BUDGET_MS = 10_000;

/**
 * How long attribution may spend before the register row is written.
 *
 * Deliberately small: the row must be filed inside the request the operator is
 * waiting on, and an incomplete `organizations` array is an accepted outcome —
 * it names whom we could identify, never a guess.
 */
export const ATTRIBUTION_BUDGET_MS = 3_000;

type Warn = (obj: Record<string, unknown>, msg: string) => void;

/** One queue's depth, as the console renders a row of it. */
export interface QueueDepth {
  readonly name: QueueNameT;
  readonly queue_state: QueueStateT;
  /** null under anything but `ok`: a zero here would read as "nothing failed". */
  readonly counts: Readonly<Record<string, number>> | null;
}

/**
 * One failed job, as far as the inspector goes.
 *
 * `data` is the RAW payload and is deliberately un-projected here: the
 * allow-list that decides which keys a platform staffer may see is per queue
 * and lives with the catalogue, so the route applies it. Nothing in this file
 * puts `data` on the wire.
 */
export interface InspectorJob {
  readonly id: string;
  /**
   * Where this job sat in the range read that produced the page: 0-based
   * inside the window and counting the ids whose hash had already been
   * evicted, so `start + scan_offset` is the row's real position in the failed
   * zset.
   *
   * It exists for ONE caller — the DLQ cursor. Under a tenant filter the route
   * reads a whole scan window and shows at most `limit` of the matches in it,
   * so the next position has to be the one after the last row it actually
   * returned; advancing by the window steps over the matches that did not fit,
   * and no later page can address them again. The jobs-array index cannot
   * stand in for this: an id evicted between the range read and its `getJob`
   * is skipped from `jobs` and still occupies a position.
   */
  readonly scan_offset: number;
  /** ms since epoch, straight from BullMQ. The route renders the instant. */
  readonly failed_at_ms: number | null;
  /** Already redacted and truncated — see `redactFailedReason`. */
  readonly failed_reason: string | null;
  readonly first_stack_line: string | null;
  readonly data: unknown;
}

export interface FailedPage {
  readonly queue_state: QueueStateT;
  readonly jobs: readonly InspectorJob[];
  /** Ids the range read actually returned — the page's real cost. */
  readonly scanned: number;
}

export interface RetryResult {
  readonly queue_state: QueueStateT;
  readonly outcomes: readonly { job_id: string; retry_outcome: RetryOutcomeT }[];
}

export interface QueueInspector {
  /**
   * Whether a Redis was configured at all — NOT whether it answers.
   *
   * The retry route needs the two apart: an unconfigured inspector attempted
   * nothing and writes no audit row, while a configured-but-unreachable one
   * was genuinely asked and is recorded, every id `not_attempted`.
   */
  readonly configured: boolean;
  depths(): Promise<QueueDepth[]>;
  /** One position-addressed window of the failed set, newest first. */
  failed(name: QueueNameT, start: number, count: number): Promise<FailedPage>;
  /**
   * The distinct tenants the requested ids name — read BEFORE the register row.
   *
   * `admin_record_queue_retry` takes `p_organization_ids uuid[]` and its
   * COMMENT says the row is what lets the register answer "whose customer got
   * the second SMS". That answer has to be gathered before the row is filed,
   * and it cannot come from the request: `RetryJobsInput` carries ids, a
   * reason and the typed-back queue name, and a client-supplied tenant list in
   * an immutable register would be a claim the platform never checked.
   *
   * So it is read here, and it is read HONESTLY: what comes back is the set of
   * organizations visible in those payloads at request time, which is empty on
   * the four queues whose jobs carry no organization at all, and empty again
   * if Redis cannot be reached. Never a guess, and never an exception — a
   * failure to attribute must not be able to stop the register row from being
   * written, because an unattributed retry is still an audited one.
   */
  organizationsOf(name: QueueNameT, jobIds: readonly string[]): Promise<readonly string[]>;
  /**
   * Put failed jobs back on the queue, in the order asked, one at a time.
   *
   * Bounded by `RETRY_TOTAL_BUDGET_MS` and expected to run out: see that
   * constant for the arithmetic. Every requested id gets exactly one outcome,
   * so the response and the register row line up id for id.
   */
  retry(name: QueueNameT, jobIds: readonly string[]): Promise<RetryResult>;
  close(): Promise<void>;
}

/** The register takes `uuid[]`; anything else must never reach the query. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const E164 = /\+1\d{10}/g;
const EMAIL = /[^\s<>@]+@[^\s<>@]+\.[A-Za-z]{2,}/g;

/**
 * The one PII control the allow-list structurally cannot provide.
 *
 * `failed_reason` and the stack line are free text written by whatever threw,
 * so no schema-derived allow-list can reach them — and both routinely quote a
 * real person. A Twilio rejection reads "The 'To' number +1514... is not
 * valid"; a Postgres unique violation reads "Key (email)=(marc@...) already
 * exists". Phone and email are the two identified-person fields this schema
 * carries, so both come out. (`redactHighRiskPII` in @dealpilot/ai covers SINs
 * and card numbers and is not on this path.)
 *
 * Named for the field rather than for one pattern: `redactE164` would tell the
 * next reader it only handles phones, and they would add an email leak beside
 * it in good faith.
 */
export function redactFailedReason(text: unknown): string | null {
  if (typeof text !== 'string' || text.trim() === '') return null;
  return text.replace(E164, '[phone redacted]').replace(EMAIL, '[email redacted]');
}

/** Redact first, then truncate: a cut in the middle of a number is not a redaction. */
function clip(text: string | null, max: number): string | null {
  if (text === null) return null;
  return text.length > max ? text.slice(0, max) : text;
}

function firstStackLine(stack: unknown): string | null {
  if (!Array.isArray(stack) || stack.length === 0) return null;
  const head = stack[0];
  if (typeof head !== 'string') return null;
  return head.split('\n')[0] ?? null;
}

/**
 * BullMQ's numeric result code, not its message text.
 *
 * `job.retry('failed')` runs `reprocessJob-8.lua`, whose header documents its
 * complete return set as 1 / -1 / -3, and `finishedErrors` builds a message
 * from that number and then assigns `error.code = code`
 * (`classes/scripts.js:1301`). Matching the English would break the moment
 * BullMQ rewords a string; matching the number cannot.
 *
 * There is no -2 branch and no `locked` outcome: the script contains no lock
 * check at all. A job a worker is holding sits in `active`, the ZREM on the
 * failed set finds nothing, and the script returns -3 — `not_failed`, inside a
 * 200.
 *
 * WHAT `error` MEANS, precisely, because on an `at_least_once` queue the
 * difference decides whether a customer may have been texted. The Lua returns
 * only 1 / -1 / -3, so a rejection carrying any other `code` — or no numeric
 * `code` at all — is a rejection with NO script result: either ioredis refused
 * the command before writing it (`enableOfflineQueue: false` on a socket that
 * is not writeable, which means the retry certainly did not happen), or the
 * socket closed with the EVALSHA already written (which means it may well
 * have). Those two are separable only by ioredis's English message, and
 * matching English is the thing this whole function exists to avoid. So
 * `error` is deliberately the UNKNOWN outcome and is read conservatively: the
 * job may or may not be back on the queue, and the failed list has to be
 * re-read before anyone acts.
 *
 * Reading it conservatively is safe, which is why one word carries both cases.
 * Acting on "it may have run" means asking again, and asking again cannot
 * compound: a job that WAS requeued is no longer in the failed set, so the
 * ZREM misses and the second request answers `not_failed`; one whose worker
 * has since finished it answers `gone`. Neither puts a second copy in `wait`,
 * so no `error` can become an extra SMS by way of the console. What it does
 * cost is the operator's certainty, so the console must say so in words: the
 * `jobs.outcome_error` label and the `jobs.outcomesHelp` sentence in
 * `packages/i18n` are where that is owed, in both locales.
 */
export function retryOutcomeOf(err: unknown): RetryOutcomeT {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === -1) return 'gone';
  if (code === -3) return 'not_failed';
  return 'error';
}

/**
 * No Redis configured.
 *
 * A degradation, not a failure, and a LOUD one: each method says which
 * console behaviour is missing rather than returning a shape that reads as an
 * answer. `configured: false` is what the retry route short-circuits on.
 */
export function noQueueInspector(warn: Warn): QueueInspector {
  return {
    configured: false,
    async depths() {
      warn({}, 'the console asked for queue depth and there is no queue to ask — the page says so instead of showing zeros (set REDIS_URL)');
      return JOB_QUEUE_NAMES.map((name) => ({ name, queue_state: 'not_configured' as const, counts: null }));
    },
    async failed(name) {
      warn({ queue: name }, 'the console asked for a failed-job page and there is no queue to ask — the page says so instead of showing an empty list (set REDIS_URL)');
      return { queue_state: 'not_configured', jobs: [], scanned: 0 };
    },
    async organizationsOf() {
      // Unreached in the route — the retry short-circuits on `configured`
      // before it asks — but answered rather than thrown, so a future caller
      // gets "nothing to attribute" instead of a crash.
      return [];
    },
    async retry(name, jobIds) {
      // Like `organizationsOf`, not reached through the route: the retry
      // handler short-circuits on `configured` and answers before it asks, so
      // that the register row is not written for a request nothing attempted.
      // Kept honest rather than thrown, and it still says what is missing.
      warn(
        { queue: name, requested: jobIds.length },
        'a staffer asked to put failed jobs back on the queue and there is no queue — nothing was attempted and nothing is recorded (set REDIS_URL)',
      );
      return { queue_state: 'not_configured', outcomes: [] };
    },
    async close() {},
  };
}

export function createQueueInspector(env: Env, warn: Warn): QueueInspector {
  if (!env.REDIS_URL) return noQueueInspector(warn);

  const url = new URL(env.REDIS_URL);
  const connection = {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.password ? { password: url.password } : {}),
    /**
     * Deliberately NOT the producers' `maxRetriesPerRequest: null`. That value
     * makes ioredis buffer a command indefinitely while Redis is away, which
     * is right for an enqueue (the job is worth waiting for) and wrong for a
     * console read (the operator is waiting). BullMQ does not force it on us
     * either: `Queue` passes `hasBlockingConnection = false`
     * (`queue-base.js:20`), and `redis-connection.js:49-51` only overrides
     * `maxRetriesPerRequest` when `blocking` is true.
     *
     * With these three, a command issued on a connection that HAS reached
     * ready — every read after the first — rejects instead of buffering. The
     * first read is the one the race above exists for.
     */
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    connectTimeout: 1500,
  };

  const handles = new Map<QueueNameT, Queue>();

  function handle(name: QueueNameT): Queue {
    const cached = handles.get(name);
    if (cached) return cached;
    // `skipMetasUpdate` is what makes this an INSPECTOR: the Queue constructor
    // otherwise fires `client.hset(this.keys.meta, …)` on connect
    // (`queue.js:41-45`), so a console page that only looks would write to
    // every queue it looked at. `skipWaitingForReady` is deliberately absent —
    // see QUEUE_READ_TIMEOUT_MS.
    const queue = new Queue(name, { ...queueOpts(connection), skipMetasUpdate: true });
    // Before any command, the way `apps/workers/src/index.ts:82-92` does it: a
    // BullMQ Queue re-emits its connection's errors, and an EventEmitter with
    // no 'error' listener turns any Redis blip into an uncaught exception that
    // takes the whole API down.
    queue.on('error', (err: Error) => warn({ queue: name, err: err.message }, 'queue_inspector_connection_error'));
    handles.set(name, queue);
    return queue;
  }

  /**
   * One read, bounded.
   *
   * The `.catch` is on the READ, not on the race, and the distinction is worth
   * the line. `Promise.race` does subscribe to its losers, so an abandoned read
   * that rejects at shutdown is not literally unowned in THIS shape — measured,
   * both ways. But the only thing owning it is a race that settled on the timer
   * and threw its result away, which is one refactor from the unhandled
   * rejection that failed CI 33291543933 (1603/1603 green, exit 1): swap the
   * race for any timeout helper that does not subscribe, and the rejection is
   * loose. Catching where the failure happens is also what lets the log name
   * WHICH read failed rather than "something in that race did".
   */
  async function bounded<T>(name: QueueNameT, label: string, read: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
    const attempt = read()
      .then((value) => ({ ok: true as const, value }))
      .catch((err: unknown) => {
        warn({ queue: name, label, err: err instanceof Error ? err.message : String(err) }, 'queue_inspector_read_failed');
        return { ok: false as const };
      });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settled = await Promise.race([
      attempt,
      new Promise<{ ok: false }>((resolve) => {
        timer = setTimeout(() => {
          warn({ queue: name, label, budgetMs: QUEUE_READ_TIMEOUT_MS }, 'queue_inspector_read_timed_out');
          resolve({ ok: false });
        }, QUEUE_READ_TIMEOUT_MS);
      }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
    return settled;
  }

  function projectJob(job: { id?: string; finishedOn?: number | undefined; failedReason?: string | undefined; stacktrace: string[] | null; data: unknown }, scanOffset: number): InspectorJob {
    return {
      id: String(job.id ?? ''),
      scan_offset: scanOffset,
      failed_at_ms: typeof job.finishedOn === 'number' ? job.finishedOn : null,
      failed_reason: clip(redactFailedReason(job.failedReason), FAILED_REASON_MAX),
      first_stack_line: clip(redactFailedReason(firstStackLine(job.stacktrace)), STACK_LINE_MAX),
      data: job.data,
    };
  }

  return {
    configured: true,

    async depths() {
      // Ten already-caught promises, each with its own belt: one dead Redis
      // costs one budget, not ten in series.
      return Promise.all(
        JOB_QUEUE_NAMES.map(async (name): Promise<QueueDepth> => {
          const counts = await bounded(name, 'getJobCounts', () => handle(name).getJobCounts());
          return counts.ok
            ? { name, queue_state: 'ok', counts: counts.value }
            : { name, queue_state: 'unreachable', counts: null };
        }),
      );
    },

    async failed(name, start, count) {
      const queue = handle(name);
      // `getRanges`, never `getJobs`. `getJobs-1.lua` runs a bounded backfill
      // loop (GET_JOBS_MAX_BACKFILL_ITERATIONS = 5, `scripts.js:21`) that
      // advances its internal cursor by ids READ rather than jobs RETURNED, so
      // `start + returned` under-advances whenever a job was evicted mid-scan
      // and the next page repeats rows. `getRanges` hands back the zset range
      // itself (ZREVRANGE for asc=false — newest first), which is what makes
      // both the cursor and `scanned` honest.
      const ids = await bounded(name, 'getRanges', () => queue.getRanges(['failed'], start, start + count - 1, false));
      if (!ids.ok) return { queue_state: 'unreachable', jobs: [], scanned: 0 };

      const jobs: InspectorJob[] = [];
      // Indexed, because the OFFSET is what the cursor is built from: the
      // route has to be able to resume just after a row it showed, and only
      // the range read knows where a row sat.
      for (const [offset, id] of ids.value.entries()) {
        const got = await bounded(name, 'getJob', () => queue.getJob(id));
        // Redis went away mid-page: report what was read and say the state,
        // rather than presenting a short page as the whole answer.
        if (!got.ok) return { queue_state: 'unreachable', jobs, scanned: ids.value.length };
        // The id was in the range and its hash is gone — evicted by
        // `removeOnFail` between the two reads. Skipped, and still counted in
        // `scanned` and in the offsets, so the cursor advances past it instead
        // of re-reading it.
        if (!got.value) continue;
        jobs.push(projectJob(got.value as Parameters<typeof projectJob>[0], offset));
      }
      return { queue_state: 'ok', jobs, scanned: ids.value.length };
    },

    async organizationsOf(name, jobIds) {
      // Four of the ten queues carry no organization in their payload at all,
      // so on those the honest answer is "none" and Redis is never asked —
      // derived from the payload shape, so it cannot drift from the DLQ
      // filter's own 422.
      if (!JOB_QUEUES[name].org_scoped) return [];
      const queue = handle(name);
      const found = new Set<string>();
      const deadline = Date.now() + ATTRIBUTION_BUDGET_MS;
      for (const id of jobIds) {
        // Checked BEFORE each read, never during: this runs ahead of the
        // register row, and the operator is waiting on the request that writes
        // it. A dead Redis collapses to one belt via the `break` below; a
        // SLOW-but-alive Redis would otherwise cost one belt per id, so the
        // wall clock is what actually bounds the reachable case. An incomplete
        // attribution is already an accepted outcome — the register records
        // the requested ids either way.
        if (Date.now() >= deadline) break;
        const got = await bounded(name, 'getJob', () => queue.getJob(id));
        // One dead read means the rest are dead too. Stopping here is what
        // keeps an unreachable Redis to ONE budget instead of twenty — and the
        // register row this attribution precedes must still be written inside
        // the request the operator is waiting on.
        if (!got.ok) break;
        const data = (got.value as { data?: unknown } | undefined)?.data;
        if (typeof data !== 'object' || data === null) continue;
        const org = (data as Record<string, unknown>)['organization_id'];
        // Shape-checked, not trusted: nothing parses a payload on the way out
        // of BullMQ, and a non-uuid string handed to a `uuid[]` parameter is a
        // 22P02 that would surface as a 500 on the one route that must not
        // lose its audit row.
        if (typeof org === 'string' && UUID.test(org)) found.add(org);
      }
      return [...found];
    },

    async retry(name, jobIds) {
      const queue = handle(name);
      const outcomes: { job_id: string; retry_outcome: RetryOutcomeT }[] = [];
      const deadline = Date.now() + RETRY_TOTAL_BUDGET_MS;
      let reachable = true;

      for (const id of jobIds) {
        // The budget is checked BEFORE the pair and never during it. A budget
        // that could abandon a call in flight would report `not_attempted` for
        // an id whose `job.retry()` still landed in Redis — and on an
        // `at_least_once` queue that lie is what makes an operator retry it
        // again, which is a second SMS to a real customer.
        if (!reachable || Date.now() >= deadline) {
          outcomes.push({ job_id: id, retry_outcome: 'not_attempted' });
          continue;
        }
        const got = await bounded(name, 'getJob', () => queue.getJob(id));
        if (!got.ok) {
          reachable = false;
          outcomes.push({ job_id: id, retry_outcome: 'not_attempted' });
          continue;
        }
        if (!got.value) {
          outcomes.push({ job_id: id, retry_outcome: 'gone' });
          continue;
        }
        try {
          // NOT raced. This is the one command in the file that CHANGES the
          // world, and the race's losing branch cannot say whether it ran. The
          // preceding `getJob` proves the connection reached ready, and past
          // that point `maxRetriesPerRequest: 2` with `enableOfflineQueue:
          // false` makes a command against a dropped connection reject rather
          // than hang — so the honest bound here is the error, not a timer.
          await (got.value as { retry: (state: 'failed') => Promise<void> }).retry('failed');
          outcomes.push({ job_id: id, retry_outcome: 'retried' });
        } catch (err) {
          outcomes.push({ job_id: id, retry_outcome: retryOutcomeOf(err) });
        }
      }
      return { queue_state: reachable ? 'ok' : 'unreachable', outcomes };
    },

    async close() {
      for (const [name, queue] of handles) {
        try {
          await queue.close();
        } catch (err) {
          // A belt, not a repair: `RedisConnection.close()` already
          // disconnects a never-ready connection and swallows the in-flight
          // init rejection (`:424-429`). But `disconnect()` is the one call
          // that stops ioredis's retry loop unconditionally, it costs a line,
          // and a handle left retrying floods production logs and hangs a
          // vitest teardown without ever producing a rejection to notice.
          warn({ queue: name, err: err instanceof Error ? err.message : String(err) }, 'queue_inspector_close_failed');
          try {
            await queue.disconnect();
          } catch {
            // Already gone. There is nothing further to try and nothing to say.
          }
        } finally {
          handles.delete(name);
        }
      }
    },
  };
}
