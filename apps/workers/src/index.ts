import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { createPool } from '@dealpilot/db';
import {
  QUEUE_AI_EXTRACTION,
  QUEUE_FIRST_TOUCH,
  QUEUE_ASSISTANT_TURN,
  QUEUE_DEFERRED_SEND,
  QUEUE_LEAD_REASSIGN,
  QUEUE_DRIP_TICK,
  QUEUE_LIVE_ANALYSIS,
  REASSIGN_AFTER_MS,
  queueOpts,
  type AiExtractionJobT,
  type FirstTouchJobT,
  type AssistantTurnJobT,
  type DeferredSendJobT,
  type LeadReassignJobT,
  type LiveAnalysisJobT,
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
import { runDripTick } from './drip-tick.js';
import { runLiveAnalysisJob } from './live-analysis.js';
import { createEmitOnlyEmitter } from '@dealpilot/api/realtime';
import { createAnthropicAnalysisClient } from '@dealpilot/ai';

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

/**
 * Every BullMQ Worker and Queue is an EventEmitter that re-emits its Redis
 * connection's errors — and an EventEmitter with no 'error' listener turns
 * any Redis blip (a disconnect race during drain included) into an uncaught
 * exception that kills the whole process. Found when the SIGTERM drain check
 * went flaky-red: the crash wasn't in a job, it was Node's default handler.
 */
function guarded<T extends { on(event: 'error', cb: (err: Error) => void): unknown }>(
  label: string,
  entity: T,
): T {
  entity.on('error', (err) => {
    process.stderr.write(
      `${JSON.stringify({ level: 50, time: Date.now(), name: 'workers', label, err: err.message, msg: 'queue connection error' })}\n`,
    );
  });
  return entity;
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

  // F-62: the producer side of the analysis queue, for the deferred-send
  // worker's agent replies (the API has its own in deferred-queue.ts).
  const analysisQueue = guarded('analysis-queue', new Queue<LiveAnalysisJobT>(
    QUEUE_LIVE_ANALYSIS,
    queueOpts(connection(env.REDIS_URL)),
  ));
  const worker = guarded('deferred-send', new Worker<DeferredSendJobT>(
    QUEUE_DEFERRED_SEND,
    async (job) =>
      runDeferredSend(
        {
          pool,
          carrier,
          env,
          analyze: async (next) => {
            await analysisQueue.add(QUEUE_LIVE_ANALYSIS, next, {
              jobId: `analysis:${next.message_id}`,
              removeOnComplete: 1000,
              removeOnFail: 5000,
              attempts: 3,
              backoff: { type: 'exponential', delay: 2000 },
            });
          },
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
  ));

  // The assistant only consumes when it is switched on. A worker draining the
  // queue with no model would mark every customer's message handled and answer
  // none of them, which is worse than the jobs piling up visibly.
  const assistant = createAssistant(env);
  // F-62: workers publish refresh hints through the same Redis the API's
  // Socket.IO adapter shares (f28b's fanout topology) — declared up here
  // because the turn worker's handoff moment emits too, not just analysis.
  const realtime = createEmitOnlyEmitter(env.REDIS_URL);
  const turnWorker = assistant.enabled
    ? guarded('assistant-turn', new Worker<AssistantTurnJobT>(
        QUEUE_ASSISTANT_TURN,
        async (job) =>
          runAssistantTurn(
            {
              pool, model: assistant.client, carrier, env,
              emitter: realtime.emitter,
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
      ))
    : null;

  // F-57: the data pass — same gating as the talk pass: only consumes when a
  // model is configured, so jobs pile up visibly rather than draining silently.
  const extractionWorker = assistant.enabled
    ? guarded('ai-extraction', new Worker<AiExtractionJobT>(
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
      ))
    : null;

  // F-62: silent monitoring (§10 post-handoff) — same gating as the other
  // model passes. With no Redis the emitter is silent and the panel simply
  // refetches on its own.
  const analysisWorker = assistant.enabled
    ? guarded('live-analysis', new Worker<LiveAnalysisJobT>(
        QUEUE_LIVE_ANALYSIS,
        async (job) =>
          runLiveAnalysisJob(
            {
              pool,
              analyst: createAnthropicAnalysisClient({
                apiKey: env.ANTHROPIC_API_KEY ?? '',
                model: env.AI_EXTRACTION_MODEL,
              }),
              emitter: realtime.emitter,
              model: env.AI_EXTRACTION_MODEL,
            },
            job.data,
          ),
        { ...queueOpts(connection(env.REDIS_URL)), concurrency: 2 },
      ))
    : null;

  // F-59: the first touch — template-only (no model), yet gated with the
  // same DEPLOYMENT-level switch as the assistant (AI_TRANSPORT): a greeting
  // from an assistant that cannot then reply is worse than a visible queue
  // of waiting jobs. The per-tenant ai_enabled switch arrives with the
  // admin console (D-059).
  const firstTouchWorker = assistant.enabled
    ? guarded('first-touch', new Worker<FirstTouchJobT>(
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
      ))
    : null;

  // F-61: the hourly drip tick (§11.1). NOT gated on assistant.enabled —
  // drips are tenant-authored templates, no model involved, and a rooftop
  // running with AI off still nurtures its lost leads. Repeatable job:
  // BullMQ upserts by (name, repeat), so re-registration on boot is a no-op.
  const dripQueue = guarded('drip-queue', new Queue(QUEUE_DRIP_TICK, queueOpts(connection(env.REDIS_URL))));
  await dripQueue.add(
    QUEUE_DRIP_TICK,
    {},
    { repeat: { pattern: '0 * * * *' }, removeOnComplete: 100, removeOnFail: 100 },
  );
  const dripWorker = guarded('drip-tick', new Worker(
    QUEUE_DRIP_TICK,
    async () => runDripTick({ pool, carrier, env }),
    { ...queueOpts(connection(env.REDIS_URL)), concurrency: 1 },
  ));

  // F-42.2: the ten-minute reassignment ladder (FR-LEAD-010, D-046). The
  // module verifies every claim against the database, so concurrency 2 is
  // parallelism, not risk.
  const reassignQueue = guarded('reassign-queue', new Queue<LeadReassignJobT>(QUEUE_LEAD_REASSIGN, queueOpts(connection(env.REDIS_URL))));
  const presence = redisPresenceStore(env.REDIS_URL);
  const reassignWorker = guarded('lead-reassign', new Worker<LeadReassignJobT>(
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
  ));

  return {
    close: async () => {
      await worker.close();
      await turnWorker?.close();
      await extractionWorker?.close();
      await firstTouchWorker?.close();
      await analysisWorker?.close();
      await analysisQueue.close();
      await realtime.close();
      await dripWorker.close();
      await dripQueue.close();
      await reassignWorker.close();
      await presence.close();
      await queue.close();
      await reassignQueue.close();
      await pool.end();
    },
  };
}
