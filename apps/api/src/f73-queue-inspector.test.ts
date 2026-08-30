import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { JOB_QUEUES, QUEUE_LEAD_REASSIGN, QUEUE_PREFIX, QUEUE_QA_REVIEW, QUEUE_TASK_SWEEP, queueOpts } from '@dealpilot/contracts';
import { loadEnv } from './env.js';
import {
  createQueueInspector, FAILED_REASON_MAX, QUEUE_READ_TIMEOUT_MS, STACK_LINE_MAX,
  type QueueInspector,
} from './queue-inspector.js';

/**
 * F-73 §9 — the inspector against a REAL Redis.
 *
 * `f73-queues.test.ts` proves what the console does with an answer; this
 * proves the answer. Four of the five things here cannot be learned from a
 * fake, because every one of them is a claim about BullMQ or ioredis rather
 * than about our code:
 *
 *  - that a freshly built, lazily cached handle answers its FIRST read at all
 *    (the `skipWaitingForReady` regression — a handle built with it reports
 *    `unreachable` forever against a healthy Redis, because
 *    `RedisConnection.initializing` is assigned once);
 *  - that `getRanges` positions a page, so the second page repeats no row;
 *  - that an unreachable Redis is BOUNDED rather than hanging, and that the
 *    process can still exit afterwards;
 *  - that looking at a queue does not WRITE to it.
 *
 * The tripwire below is the reason this file is worth having: skipping is fine
 * on a laptop with nothing running, but `RLS_REQUIRED` means "this run must be
 * real", and a Redis suite that quietly skips in CI is a guard that does not
 * exist.
 */

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6381';
/** Nothing listens here. The whole point is that nothing ever will. */
const DEAD_REDIS_URL = 'redis://127.0.0.1:6399';

let redis: Redis | undefined;
let ready = false;
const built: QueueInspector[] = [];

function inspectorFor(url: string, warn: (obj: Record<string, unknown>, msg: string) => void = () => {}): QueueInspector {
  const inspector = createQueueInspector(loadEnv({ NODE_ENV: 'test', REDIS_URL: url }), warn);
  built.push(inspector);
  return inspector;
}

const workerConnection = () => ({
  host: new URL(REDIS_URL).hostname,
  port: Number(new URL(REDIS_URL).port || 6379),
  // A Worker holds a BLOCKING connection, so this is the value BullMQ demands
  // of it — and precisely the value the inspector must not copy.
  maxRetriesPerRequest: null,
});

async function redisReachable(): Promise<boolean> {
  const probe = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null, connectTimeout: 1500 });
  try {
    await probe.connect();
    await probe.ping();
    return true;
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}

async function wipe(name: string): Promise<void> {
  const keys = await redis!.keys(`${QUEUE_PREFIX}:${name}:*`);
  if (keys.length > 0) await redis!.del(...keys);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Three genuinely failed jobs, made the only way a job ever fails: a worker
 * threw.
 *
 * Not `zadd` into the failed set by hand — the failed zset's score, the job
 * hash's `failedReason` and its `stacktrace` are all written by BullMQ's own
 * Lua, and a hand-made entry would be testing this file's idea of the format.
 * One at a time, waiting for each, so the three carry distinct `finishedOn`
 * values and "newest first" is an assertion rather than a coin toss.
 */
async function failThree(): Promise<void> {
  const failed: string[] = [];
  const worker = new Worker(
    QUEUE_QA_REVIEW,
    async (job) => {
      // Long enough that both caps are exercised end to end, with the two
      // identified-person fields at the FRONT so the truncation cannot be
      // what removes them.
      throw new Error(
        `nightly QA pass ${String(job.data)} could not reach +15145550188 for marc@concessionnaire.qc.ca — ${'context '.repeat(80)}`,
      );
    },
    { ...queueOpts(workerConnection()), concurrency: 1 },
  );
  worker.on('failed', (job) => {
    if (job?.id) failed.push(job.id);
  });
  const queue = new Queue(QUEUE_QA_REVIEW, queueOpts(workerConnection()));
  try {
    for (let n = 1; n <= 3; n += 1) {
      await queue.add(QUEUE_QA_REVIEW, n, { attempts: 1, removeOnFail: 100 });
      const deadline = Date.now() + 15_000;
      while (failed.length < n && Date.now() < deadline) await sleep(20);
      expect(failed.length, `job ${n} never failed — the worker is not consuming`).toBe(n);
      // Distinct finishedOn: two failures inside one millisecond would make
      // ZREVRANGE fall back to lexicographic order and the ordering assertion
      // would pass either way.
      await sleep(5);
    }
  } finally {
    await worker.close();
    await queue.close();
  }
}

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

/**
 * Three failed jobs on an ORG-SCOPED queue, made the same honest way.
 *
 * `qa-review` above carries no payload at all, so it can prove nothing about
 * attribution. These three are what `organizationsOf` reads before the
 * register row is written: two tenants across three jobs, and one payload
 * whose organization_id is not a uuid — which the register's `uuid[]`
 * parameter would turn into a 22P02 on the one route that must not lose its
 * audit row.
 */
async function failThreeScoped(): Promise<string[]> {
  const ids: string[] = [];
  const worker = new Worker(
    QUEUE_LEAD_REASSIGN,
    async () => {
      throw new Error('reassign refused for the fixture');
    },
    { ...queueOpts(workerConnection()), concurrency: 1 },
  );
  worker.on('failed', (job) => {
    if (job?.id) ids.push(job.id);
  });
  const queue = new Queue(QUEUE_LEAD_REASSIGN, queueOpts(workerConnection()));
  try {
    const payloads = [
      { organization_id: ORG_A, lead_id: ORG_A },
      { organization_id: ORG_B, lead_id: ORG_B },
      // Not a uuid, and not a hypothetical: nothing parses a payload on the way
      // out of BullMQ, so an older deploy's row can hold anything here.
      { organization_id: 'not-a-uuid', lead_id: ORG_A },
    ];
    for (let n = 0; n < payloads.length; n += 1) {
      await queue.add(QUEUE_LEAD_REASSIGN, payloads[n], { attempts: 1, removeOnFail: 100 });
      const deadline = Date.now() + 15_000;
      while (ids.length < n + 1 && Date.now() < deadline) await sleep(20);
      expect(ids.length, `scoped job ${n} never failed — the worker is not consuming`).toBe(n + 1);
      await sleep(5);
    }
  } finally {
    await worker.close();
    await queue.close();
  }
  return ids;
}

let scopedIds: string[] = [];

beforeAll(async () => {
  if (!(await redisReachable())) {
    if (process.env['RLS_REQUIRED']) throw new Error('RLS_REQUIRED set but Redis unreachable');
    return;
  }
  redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  ready = true;
  await wipe(QUEUE_QA_REVIEW);
  await wipe(QUEUE_TASK_SWEEP);
  await wipe(QUEUE_LEAD_REASSIGN);
  await failThree();
  scopedIds = await failThreeScoped();
}, 60_000);

afterAll(async () => {
  for (const inspector of built) await inspector.close();
  if (ready) {
    await wipe(QUEUE_QA_REVIEW);
    await wipe(QUEUE_TASK_SWEEP);
    await wipe(QUEUE_LEAD_REASSIGN);
  }
  redis?.disconnect();
});

describe('a healthy Redis', () => {
  it('answers the FIRST read on a freshly built handle', async (ctx) => {
    if (!ready) return ctx.skip();
    // MUTATION: add `skipWaitingForReady: true` to the Queue options → this
    // goes red, permanently, against a Redis that is perfectly fine. `init()`
    // would then issue its INFO round-trip on a socket still in `connecting`,
    // `enableOfflineQueue: false` refuses it, and `initializing` — assigned
    // exactly once — stays rejected for the life of the cached handle.
    const inspector = inspectorFor(REDIS_URL);
    const depths = await inspector.depths();
    for (const row of depths) {
      expect(row.queue_state, `${row.name} could not be read`).toBe('ok');
      expect(row.counts).not.toBeNull();
    }
    const qa = depths.find((d) => d.name === QUEUE_QA_REVIEW)!;
    expect(qa.counts!['failed']).toBe(3);
  });

  it('reads the failed set newest first, and pages it by position', async (ctx) => {
    if (!ready) return ctx.skip();
    const inspector = inspectorFor(REDIS_URL);

    const all = await inspector.failed(QUEUE_QA_REVIEW, 0, 10);
    expect(all.queue_state).toBe('ok');
    expect(all.scanned).toBe(3);
    expect(all.jobs).toHaveLength(3);
    const times = all.jobs.map((j) => j.failed_at_ms ?? 0);
    expect(times, 'the failed set must come back newest first').toEqual([...times].sort((a, b) => b - a));
    // The failure text a worker threw, carried through the inspector's own
    // redaction — this is the end-to-end proof that the one field no
    // allow-list can reach never shows a real customer.
    expect(all.jobs[0]!.failed_reason).toContain('[phone redacted]');
    expect(all.jobs[0]!.failed_reason).toContain('[email redacted]');
    expect(all.jobs[0]!.failed_reason).not.toContain('5145550188');
    expect(all.jobs[0]!.failed_reason).not.toContain('concessionnaire.qc.ca');
    expect(all.jobs[0]!.failed_reason).toHaveLength(FAILED_REASON_MAX);
    // The stack's first line repeats the message, so it is a second copy of the
    // same leak and gets the same treatment under its own, shorter cap.
    expect(all.jobs[0]!.first_stack_line).toContain('[phone redacted]');
    expect(all.jobs[0]!.first_stack_line).not.toContain('concessionnaire.qc.ca');
    expect(all.jobs[0]!.first_stack_line).toHaveLength(STACK_LINE_MAX);

    const first = await inspector.failed(QUEUE_QA_REVIEW, 0, 2);
    const second = await inspector.failed(QUEUE_QA_REVIEW, first.scanned, 2);
    expect(first.scanned).toBe(2);
    expect(second.scanned).toBe(1);
    // The cursor advances by ids READ. `getJobs` cannot promise this: its Lua
    // backfill advances by ids read but RETURNS fewer, so a page computed from
    // the returned count would repeat rows here.
    const seen = [...first.jobs, ...second.jobs].map((j) => j.id);
    expect(new Set(seen).size).toBe(3);
    expect(seen).toEqual(all.jobs.map((j) => j.id));
  });

  it('skips an id whose job was evicted between the range read and the hash read, and still advances past it', async (ctx) => {
    if (!ready) return ctx.skip();
    const inspector = inspectorFor(REDIS_URL);
    const before = await inspector.failed(QUEUE_QA_REVIEW, 0, 10);
    const victim = before.jobs[1]!.id;
    // Exactly what `removeOnFail` eviction leaves behind for a reader that is
    // mid-page: the id is still in the zset, its hash is gone.
    await redis!.del(`${QUEUE_PREFIX}:${QUEUE_QA_REVIEW}:${victim}`);
    try {
      const after = await inspector.failed(QUEUE_QA_REVIEW, 0, 10);
      // `scanned` counts what the range returned, so the cursor steps over the
      // gap; the page is one row shorter and reports no missing job as a null.
      expect(after.scanned).toBe(3);
      expect(after.jobs.map((j) => j.id)).toEqual(before.jobs.map((j) => j.id).filter((id) => id !== victim));
    } finally {
      await redis!.zrem(`${QUEUE_PREFIX}:${QUEUE_QA_REVIEW}:failed`, victim);
    }
  });

  it('puts one named job back on the queue, and answers honestly about the ones it cannot', async (ctx) => {
    if (!ready) return ctx.skip();
    const inspector = inspectorFor(REDIS_URL);
    const page = await inspector.failed(QUEUE_QA_REVIEW, 0, 10);
    const target = page.jobs[page.jobs.length - 1]!.id;

    const done = await inspector.retry(QUEUE_QA_REVIEW, [target]);
    expect(done.queue_state).toBe('ok');
    expect(done.outcomes).toEqual([{ job_id: target, retry_outcome: 'retried' }]);
    const depths = await inspector.depths();
    const qa = depths.find((d) => d.name === QUEUE_QA_REVIEW)!;
    expect(qa.counts!['failed']).toBe(page.jobs.length - 1);
    expect(qa.counts!['waiting']).toBe(1);

    // Retried twice: the second call finds it in `wait`, the Lua ZREM on the
    // failed set returns 0, and the script returns -3. That is `not_failed`
    // inside a 200 — and it is also what a job a WORKER is holding produces,
    // which is why there is no `locked` outcome to declare.
    const again = await inspector.retry(QUEUE_QA_REVIEW, [target, 'no-such-job-73']);
    expect(again.outcomes).toEqual([
      { job_id: target, retry_outcome: 'not_failed' },
      { job_id: 'no-such-job-73', retry_outcome: 'gone' },
    ]);
  });

  it('names the distinct tenants behind a set of ids, and refuses to invent one', async (ctx) => {
    if (!ready) return ctx.skip();
    const inspector = inspectorFor(REDIS_URL);
    const orgs = await inspector.organizationsOf(QUEUE_LEAD_REASSIGN, scopedIds);
    // Two tenants across three jobs: the third payload's organization_id is
    // not a uuid, and it is DROPPED rather than passed to a `uuid[]` parameter
    // that would raise 22P02 and cost the register the row it exists for.
    expect([...orgs].sort()).toEqual([ORG_A, ORG_B].sort());

    // An id nobody ever enqueued attributes nothing and raises nothing — a
    // browse and a retry are separate requests, and jobs leave in between.
    expect(await inspector.organizationsOf(QUEUE_LEAD_REASSIGN, ['no-such-job-73'])).toEqual([]);
  });

  it('asks Redis nothing at all for a queue whose jobs name no tenant', async (ctx) => {
    if (!ready) return ctx.skip();
    // Derived from the payload shape, not hand-typed here — the same fact the
    // DLQ filter's 422 is built on.
    expect(JOB_QUEUES[QUEUE_QA_REVIEW].org_scoped).toBe(false);
    const reads: string[] = [];
    const inspector = inspectorFor(REDIS_URL, (obj, msg) => reads.push(`${msg}:${String((obj as { label?: unknown }).label)}`));
    expect(await inspector.organizationsOf(QUEUE_QA_REVIEW, ['1', '2', '3'])).toEqual([]);
    expect(reads, 'a queue that cannot name a tenant was still asked').toEqual([]);
  });

  it('does not write to a queue it merely looked at', async (ctx) => {
    if (!ready) return ctx.skip();
    const metaKey = `${QUEUE_PREFIX}:${QUEUE_TASK_SWEEP}:meta`;
    expect(await redis!.exists(metaKey), 'the fixture did not start clean').toBe(0);
    const inspector = inspectorFor(REDIS_URL);
    await inspector.depths();
    await inspector.failed(QUEUE_TASK_SWEEP, 0, 5);
    // MUTATION: drop `skipMetasUpdate: true` → red. BullMQ's Queue constructor
    // otherwise fires `client.hset(this.keys.meta, …)` on connect, so a console
    // page that only looks would write to all ten queues it listed.
    expect(await redis!.exists(metaKey), 'the inspector wrote to a queue it only read').toBe(0);
  });
});

describe('a Redis that is not there', () => {
  it('is bounded, says unreachable, closes cleanly, and leaves nothing rejecting behind', async (ctx) => {
    if (!ready) return ctx.skip();
    const rejections: unknown[] = [];
    const onRejection = (err: unknown) => rejections.push(err);
    process.on('unhandledRejection', onRejection);

    const connectionErrors: string[] = [];
    const inspector = inspectorFor(DEAD_REDIS_URL, (obj, msg) => {
      if (msg === 'queue_inspector_connection_error') connectionErrors.push(String((obj as { queue?: unknown }).queue));
    });
    try {
      const started = Date.now();
      const depths = await inspector.depths();
      const elapsed = Date.now() - started;

      // MUTATION: delete the bounded race → this never returns. A Queue's read
      // awaits `waitUntilReady`, and ioredis's default retryStrategy retries
      // for ever, so nothing rejects and nothing times out.
      expect(elapsed, 'the read was not bounded').toBeLessThan(QUEUE_READ_TIMEOUT_MS * 3);
      for (const row of depths) {
        expect(row.queue_state).toBe('unreachable');
        // Never zeros: "we could not ask" and "nothing has failed" are
        // different facts and an operator has to be able to tell them apart.
        expect(row.counts).toBeNull();
      }
      const page = await inspector.failed(QUEUE_QA_REVIEW, 0, 10);
      expect(page).toMatchObject({ queue_state: 'unreachable', jobs: [], scanned: 0 });

      // Attribution against a dead Redis answers "no tenants" rather than
      // throwing, and stops at the FIRST dead read rather than spending one
      // budget per id — the register row it precedes has to be written inside
      // the request the operator is waiting on.
      const attributionStarted = Date.now();
      expect(await inspector.organizationsOf(QUEUE_LEAD_REASSIGN, ['1', '2', '3', '4', '5'])).toEqual([]);
      expect(Date.now() - attributionStarted, 'attribution spent a budget per id').toBeLessThan(QUEUE_READ_TIMEOUT_MS * 3);

      // And the loop itself. Five ids, one dead read: every id comes back
      // `not_attempted` and NOT `error`, because nothing was attempted — an
      // `error` here would tell an operator the retry was tried and failed,
      // which on an at_least_once queue is what makes them try it again. It
      // also stops after the first dead read rather than spending five
      // budgets, which is what keeps the request inside RETRY_TOTAL_BUDGET_MS.
      const retryStarted = Date.now();
      const put = await inspector.retry(QUEUE_LEAD_REASSIGN, ['1', '2', '3', '4', '5']);
      expect(put.queue_state).toBe('unreachable');
      expect(put.outcomes.map((o) => o.retry_outcome)).toEqual(Array.from({ length: 5 }, () => 'not_attempted'));
      expect(Date.now() - retryStarted, 'the loop spent a budget per id').toBeLessThan(QUEUE_READ_TIMEOUT_MS * 3);

      await inspector.close();
      const afterClose = connectionErrors.length;
      // A reconnect storm surfaces as an ioredis 'error' EVENT, not as a
      // rejection — so an unhandledRejection capture alone would stay empty
      // while the run hung at teardown and production logs flooded. Both are
      // watched, and the run must be able to exit.
      await sleep(1_500);
      expect(connectionErrors.length, 'a handle kept retrying after close()').toBe(afterClose);
      // A tripwire, and only a tripwire: moving the `.catch` from the read onto
      // the race does NOT trip it, because `Promise.race` subscribes to its
      // losers (checked, both ways). What it catches is a read that ends up
      // owned by nobody at all — the shape that took CI 33291543933 to exit 1
      // with 1603/1603 green.
      expect(rejections, 'a read rejected with nobody owning it').toEqual([]);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  }, 30_000);
});
