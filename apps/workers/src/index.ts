import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { createPool } from '@dealpilot/db';
import { QUEUE_DEFERRED_SEND, type DeferredSendJobT } from '@dealpilot/contracts';
import { createCarrier } from '@dealpilot/api/carrier';
import { loadEnv } from '@dealpilot/api/env';
import { runDeferredSend } from './deferred-send.js';

export { runDeferredSend } from './deferred-send.js';
export type { DeferredSendDeps, DeferredSendResult } from './deferred-send.js';

/**
 * @dealpilot/workers — the job runner (ADR-012).
 *
 * Deliberately thin. Everything worth arguing about lives in the job modules,
 * which take a parsed payload and return an outcome, so they are tested against
 * a real database without a queue running. This file is BullMQ plumbing and
 * nothing else, because plumbing that contains decisions is plumbing nobody
 * tests.
 */

function connection(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.password ? { password: url.password } : {}),
    // BullMQ requires this to be null: a blocking command that gave up after
    // N retries would silently stop consuming the queue.
    maxRetriesPerRequest: null,
  };
}

export function createDeferredSendQueue(redisUrl: string): Queue<DeferredSendJobT> {
  return new Queue<DeferredSendJobT>(QUEUE_DEFERRED_SEND, { connection: connection(redisUrl) });
}

export async function start(): Promise<{ close: () => Promise<void> }> {
  const env = loadEnv();
  if (!env.REDIS_URL) {
    throw new Error('Workers need REDIS_URL. Refusing to start: a worker with no queue consumes nothing and says so at 3am instead of now.');
  }

  const pool = createPool({ connectionString: env.DATABASE_URL });
  const carrier = createCarrier(env, {
    info: () => {},
    warn: () => {},
  });
  const queue = createDeferredSendQueue(env.REDIS_URL);

  const worker = new Worker<DeferredSendJobT>(
    QUEUE_DEFERRED_SEND,
    async (job) =>
      runDeferredSend(
        {
          pool,
          carrier,
          env,
          reschedule: async (next, runAt) => {
            await queue.add(QUEUE_DEFERRED_SEND, next, {
              delay: Math.max(0, runAt.getTime() - Date.now()),
              removeOnComplete: 1000,
              removeOnFail: 5000,
            });
          },
        },
        job.data,
      ),
    { connection: connection(env.REDIS_URL), concurrency: 4 },
  );

  return {
    close: async () => {
      await worker.close();
      await queue.close();
      await pool.end();
    },
  };
}
