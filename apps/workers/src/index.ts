import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { createPool } from '@dealpilot/db';
import {
  QUEUE_AI_EXTRACTION,
  QUEUE_FIRST_TOUCH,
  QUEUE_ASSISTANT_TURN,
  QUEUE_DEFERRED_SEND,
  QUEUE_LEAD_REASSIGN,
  REASSIGN_AFTER_MS,
  queueOpts,
  type AiExtractionJobT,
  type FirstTouchJobT,
  type AssistantTurnJobT,
  type DeferredSendJobT,
  type LeadReassignJobT,
} from '@dealpilot/contracts';
import { createCarrier } from '@dealpilot/api/carrier';
import { redisPresenceStore } from '@dealpilot/api/presence';
import { createAssistant } from '@dealpilot/api/assistant';
import { loadEnv } from '@dealpilot/api/env';
import { runDeferredSend } from './deferred-send.js';
import { runAssistantTurn } from './assistant-turn.js';
import { runAiExtraction } from './ai-extraction.js';
import { runFirstTouch } from './first-touch.js';
import { createAnthropicExtractionClient } from '@dealpilot/ai';
import { runLeadReassign } from './lead-reassign.js';

export { runDeferredSend } from './deferred-send.js';
export type { DeferredSendDeps, DeferredSendResult } from './deferred-send.js';
export { runAssistantTurn } from './assistant-turn.js';
export type { AssistantTurnDeps, AssistantTurnResult } from './assistant-turn.js';
export { runLeadReassign } from './lead-reassign.js';
export type { LeadReassignDeps, LeadReassignResult } from './lead-reassign.js';

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
          runAssistantTurn(
            {
              pool, model: assistant.client, carrier, env,
              armReassign: async (next) => {
                await reassignQueue.add(QUEUE_LEAD_REASSIGN, next, {
                  delay: REASSIGN_AFTER_MS,
                  jobId: `reassign:${next.lead_id}:${next.attempt}`,
                  removeOnComplete: 1000,
                  removeOnFail: 5000,
                });
              },
            },
            job.data,
          ),
        { ...queueOpts(connection(env.REDIS_URL)), concurrency: 2 },
      )
    : null;

  // F-57: the data pass — same gating as the talk pass: only consumes when a
  // model is configured, so jobs pile up visibly rather than draining silently.
  const extractionWorker = assistant.enabled
    ? new Worker<AiExtractionJobT>(
        QUEUE_AI_EXTRACTION,
        async (job) =>
          runAiExtraction(
            {
              pool,
              extractor: createAnthropicExtractionClient({
                apiKey: env.ANTHROPIC_API_KEY ?? '',
                model: env.AI_EXTRACTION_MODEL,
              }),
              model: env.AI_EXTRACTION_MODEL,
            },
            job.data,
          ),
        { ...queueOpts(connection(env.REDIS_URL)), concurrency: 2 },
      )
    : null;

  // F-59: the first touch — template-only (no model), yet gated with the
  // same DEPLOYMENT-level switch as the assistant (AI_TRANSPORT): a greeting
  // from an assistant that cannot then reply is worse than a visible queue
  // of waiting jobs. The per-tenant ai_enabled switch arrives with the
  // admin console (D-059).
  const firstTouchWorker = assistant.enabled
    ? new Worker<FirstTouchJobT>(
        QUEUE_FIRST_TOUCH,
        async (job) =>
          runFirstTouch(
            {
              pool, carrier, env,
              // A tenant-disabled quiet-hours exemption defers the greeting to
              // the window opening — as a deferred-send job, re-gated on wake.
              defer: async (next, runAt) => {
                await queue.add(QUEUE_DEFERRED_SEND, next, {
                  delay: Math.max(0, runAt.getTime() - Date.now()),
                  removeOnComplete: 1000,
                  removeOnFail: 5000,
                });
              },
            },
            job.data,
          ),
        { ...queueOpts(connection(env.REDIS_URL)), concurrency: 2 },
      )
    : null;

  // F-42.2: the ten-minute reassignment ladder (FR-LEAD-010, D-046). The
  // module verifies every claim against the database, so concurrency 2 is
  // parallelism, not risk.
  const reassignQueue = new Queue<LeadReassignJobT>(QUEUE_LEAD_REASSIGN, queueOpts(connection(env.REDIS_URL)));
  const presence = redisPresenceStore(env.REDIS_URL);
  const reassignWorker = new Worker<LeadReassignJobT>(
    QUEUE_LEAD_REASSIGN,
    async (job) =>
      runLeadReassign(
        {
          pool,
          presence,
          armNext: async (next) => {
            await reassignQueue.add(QUEUE_LEAD_REASSIGN, next, {
              delay: REASSIGN_AFTER_MS,
              jobId: `reassign:${next.lead_id}:${next.attempt}`,
              removeOnComplete: 1000,
              removeOnFail: 5000,
            });
          },
        },
        job.data,
      ),
    { ...queueOpts(connection(env.REDIS_URL)), concurrency: 2 },
  );

  return {
    close: async () => {
      await worker.close();
      await turnWorker?.close();
      await extractionWorker?.close();
      await firstTouchWorker?.close();
      await reassignWorker.close();
      await presence.close();
      await queue.close();
      await reassignQueue.close();
      await pool.end();
    },
  };
}
