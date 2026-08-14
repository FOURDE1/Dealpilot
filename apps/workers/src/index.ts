import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { createPool } from '@dealpilot/db';
import {
  QUEUE_ASSISTANT_TURN, QUEUE_DEFERRED_SEND, queueOpts,
  type AssistantTurnJobT, type DeferredSendJobT,
} from '@dealpilot/contracts';
import { createCarrier } from '@dealpilot/api/carrier';
import { createAssistant } from '@dealpilot/api/assistant';
import { loadEnv } from '@dealpilot/api/env';
import { runDeferredSend } from './deferred-send.js';
import { runAssistantTurn } from './assistant-turn.js';

export { runDeferredSend } from './deferred-send.js';
export type { DeferredSendDeps, DeferredSendResult } from './deferred-send.js';
export { runAssistantTurn } from './assistant-turn.js';
export type { AssistantTurnDeps, AssistantTurnResult } from './assistant-turn.js';

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
  return new Queue<DeferredSendJobT>(QUEUE_DEFERRED_SEND, queueOpts(connection(redisUrl)));
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
    { ...queueOpts(connection(env.REDIS_URL)), concurrency: 4 },
  );

  // The assistant only consumes when it is switched on. A worker draining the
  // queue with no model would mark every customer's message handled and answer
  // none of them, which is worse than the jobs piling up visibly.
  const assistant = createAssistant(env);
  const turnWorker = assistant.enabled
    ? new Worker<AssistantTurnJobT>(
        QUEUE_ASSISTANT_TURN,
        async (job) =>
          runAssistantTurn({ pool, model: assistant.client, carrier, env }, job.data),
        { ...queueOpts(connection(env.REDIS_URL)), concurrency: 2 },
      )
    : null;

  return {
    close: async () => {
      await worker.close();
      await turnWorker?.close();
      await queue.close();
      await pool.end();
    },
  };
}
