import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import {
  QUEUE_DEFERRED_SEND, QUEUE_PREFIX, queueOpts, type DeferredSendJobT,
} from '@dealpilot/contracts';
import { createDeferredSendQueue } from '@dealpilot/api/deferred-queue';

/**
 * A job actually travelling from the API to a worker.
 *
 * This had never happened. Not once, in any environment — and two bugs lived in
 * the gap. The queue names contained a colon, which BullMQ refuses, so the API
 * and the workers both died on boot wherever Redis existed; and the workers app
 * had no entrypoint, so nothing ever started the process that would have shown
 * it. Both were invisible to 974 unit tests because every one of them stopped
 * at the seam: the producer was mocked, or the consumer was called directly
 * with a payload built by hand.
 *
 * So this test refuses to mock the seam. It enqueues through the REAL producer
 * the API uses — `createDeferredSendQueue` — and consumes with a real BullMQ
 * Worker, over a real Redis.
 *
 * The second assertion is the one that would have caught the subtler half. Name
 * and prefix have to agree between the two processes, and when they do not,
 * nothing throws: the API writes under one namespace, the worker blocks on
 * another, and deferred messages wait forever for a consumer that is listening
 * somewhere else. Both sides look healthy the whole time. Checking the Redis
 * keyspace directly is how that becomes visible rather than a mystery at 3am.
 */

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6381';
const run = Date.now().toString(36);

let redis: Redis | undefined;
let ready = false;

async function redisReachable(): Promise<boolean> {
  const probe = new Redis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    connectTimeout: 1500,
  });
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

function job(): DeferredSendJobT {
  return {
    organization_id: '00000000-0000-4000-8000-000000000001',
    conversation_id: '00000000-0000-4000-8000-000000000002',
    send_decision_id: '00000000-0000-4000-8000-000000000003',
    body: `quiet hours are over — ${run}`,
    sender_type: 'bot',
    message_class: 'inbound_reply',
    attempt: 0,
  };
}

beforeAll(async () => {
  if (!(await redisReachable())) {
    // Same tripwire the fan-out suite uses: skipping is fine on a laptop with
    // no stack running, but RLS_REQUIRED means "this run must be real".
    if (process.env['RLS_REQUIRED']) throw new Error('RLS_REQUIRED set but Redis unreachable');
    return;
  }
  redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  ready = true;
});

afterAll(async () => {
  redis?.disconnect();
});

describe('API → Redis → worker', () => {
  it('delivers a job enqueued through the real producer', async (ctx) => {
    if (!ready) return ctx.skip();

    // The producer the API itself builds — not a Queue constructed here, which
    // would only prove that this file agrees with itself.
    const producer = createDeferredSendQueue({ REDIS_URL } as never, () => {});

    const received: DeferredSendJobT[] = [];
    const worker = new Worker<DeferredSendJobT>(
      QUEUE_DEFERRED_SEND,
      async (j) => {
        received.push(j.data);
      },
      { ...queueOpts({ host: new URL(REDIS_URL).hostname, port: Number(new URL(REDIS_URL).port || 6379), maxRetriesPerRequest: null }), concurrency: 1 },
    );

    try {
      const sent = job();
      // runAt in the past → no delay; this is about transport, not scheduling.
      await producer.enqueue(sent, new Date(Date.now() - 1000));

      const landed = await new Promise<DeferredSendJobT | null>((resolve) => {
        const deadline = setTimeout(() => resolve(null), 10_000);
        const poll = setInterval(() => {
          const hit = received.find((r) => r.body === sent.body);
          if (hit) {
            clearInterval(poll);
            clearTimeout(deadline);
            resolve(hit);
          }
        }, 50);
      });

      expect(
        landed,
        'the job never reached the worker. If both processes look healthy, suspect the namespace: a producer and a consumer that disagree on name or prefix never meet, and neither one errors.',
      ).not.toBeNull();
      // The payload is Zod-parsed on both sides; this proves it survived the
      // trip rather than arriving as an empty object.
      expect(landed).toMatchObject({
        body: sent.body,
        sender_type: 'bot',
        message_class: 'inbound_reply',
        organization_id: sent.organization_id,
      });
    } finally {
      await worker.close();
      await producer.close();
    }
  }, 30_000);

  it('writes under the configured prefix and nowhere else', async (ctx) => {
    if (!ready) return ctx.skip();

    const producer = createDeferredSendQueue({ REDIS_URL } as never, () => {});
    try {
      // Delayed far enough out that nothing consumes it while we look.
      await producer.enqueue(job(), new Date(Date.now() + 600_000));

      const ours = await redis!.keys(`${QUEUE_PREFIX}:${QUEUE_DEFERRED_SEND}:*`);
      const bullDefault = await redis!.keys(`bull:${QUEUE_DEFERRED_SEND}:*`);

      expect(
        ours.length,
        `nothing was written under "${QUEUE_PREFIX}:${QUEUE_DEFERRED_SEND}". The producer is namespacing somewhere the workers are not reading.`,
      ).toBeGreaterThan(0);
      expect(
        bullDefault,
        'keys landed under BullMQ\'s default "bull:" prefix, which means a call site skipped queueOpts. Nothing will throw — the workers simply never see these jobs.',
      ).toEqual([]);
    } finally {
      // Leave the queue as we found it; a delayed job left behind would be
      // picked up by a real worker ten minutes later.
      await producer.close();
      const leftover = await redis!.keys(`${QUEUE_PREFIX}:${QUEUE_DEFERRED_SEND}:*`);
      if (leftover.length > 0) await redis!.del(...leftover);
    }
  }, 30_000);
});

describe('the queue BullMQ actually built', () => {
  it('is reachable under the name both sides import', async (ctx) => {
    if (!ready) return ctx.skip();
    // Constructed here the same way the workers do it, purely to read back what
    // BullMQ resolved — the assertion is that there is no second opinion about
    // where this queue lives.
    const q = new Queue(QUEUE_DEFERRED_SEND, queueOpts({ host: '127.0.0.1', port: 6381, maxRetriesPerRequest: null }));
    try {
      expect(q.name).toBe(QUEUE_DEFERRED_SEND);
      expect(q.opts.prefix).toBe(QUEUE_PREFIX);
      expect(q.name).not.toContain(':');
    } finally {
      await q.close();
    }
  });
});
