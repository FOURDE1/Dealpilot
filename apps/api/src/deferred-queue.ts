import { Queue } from 'bullmq';
import {
  QUEUE_ASSISTANT_TURN, QUEUE_DEFERRED_SEND, queueOpts,
  QUEUE_AI_EXTRACTION, QUEUE_FIRST_TOUCH, QUEUE_LIVE_ANALYSIS,
  type AiExtractionJobT, type AssistantTurnJobT, type DeferredSendJobT, type FirstTouchJobT,
  type LiveAnalysisJobT,
} from '@dealpilot/contracts';
import type { Env } from './env.js';

/**
 * Putting a deferred message on the queue (F-32).
 *
 * The gate can say "not now, at 09:00". Until this existed, that was where the
 * message ended: `send_decisions.deferred_until` was written and read by
 * nothing, so a follow-up composed at 22:40 was recorded as deferred and
 * silently never sent.
 *
 * Behind an interface for the same reason the carrier is: the API has to run
 * with no Redis (every test builds one), and a queue that must exist would make
 * sixty test files depend on a message broker.
 */

export interface DeferredSendQueue {
  /** Schedule a re-gated send. `runAt` is the gate's, not ours to adjust. */
  enqueue(job: DeferredSendJobT, runAt: Date): Promise<void>;
  /**
   * Ask the assistant to answer, now-ish.
   *
   * Queued rather than run inline because NFR-PERF puts the intake ACK at
   * p99 < 1s and a model call with a tool loop is seconds. A webhook that
   * waited would have the carrier time out and retry.
   */
  enqueueAssistantTurn(job: AssistantTurnJobT): Promise<void>;
  enqueueExtraction(job: AiExtractionJobT): Promise<void>;
  enqueueFirstTouch(job: FirstTouchJobT): Promise<void>;
  /** F-62: one silent-monitoring pass over a human-held thread (§10). */
  enqueueLiveAnalysis(job: LiveAnalysisJobT): Promise<void>;
  close(): Promise<void>;
}

/**
 * No queue configured.
 *
 * Unlike the carrier, this does NOT refuse to boot in production, and the
 * difference is worth stating: an absent carrier means nothing can be sent at
 * all, which is a broken product. An absent queue means only DEFERRED messages
 * are lost — quiet-hours follow-ups — while live conversation continues to
 * work. It is a degradation, not a failure.
 *
 * It is a loud degradation, though. Silently dropping the job is exactly the
 * bug this slice exists to fix, so the drop is logged with the conversation id
 * rather than swallowed.
 */
export function noDeferredSendQueue(
  warn: (obj: Record<string, unknown>, msg: string) => void,
): DeferredSendQueue {
  return {
    async enqueue(job) {
      warn(
        { conversation_id: job.conversation_id, send_decision_id: job.send_decision_id },
        'a message was deferred and there is no queue to wake it — it will not be sent (set REDIS_URL)',
      );
    },
    async enqueueAssistantTurn(job) {
      warn(
        { conversation_id: job.conversation_id },
        'a customer message needs an answer and there is no queue to run the assistant — nobody will reply (set REDIS_URL)',
      );
    },
    async enqueueExtraction(job) {
      warn(
        { conversation_id: job.conversation_id },
        'a client message arrived and there is no queue to run extraction — data capture is skipped (set REDIS_URL)',
      );
    },
    async enqueueFirstTouch(job) {
      warn(
        { lead_id: job.lead_id },
        'a fresh lead needs its first touch and there is no queue — the 60s SLA cannot be met (set REDIS_URL)',
      );
    },
    async enqueueLiveAnalysis(job) {
      warn(
        { conversation_id: job.conversation_id },
        'a message on a human-held thread has no queue to run silent monitoring — the panel goes stale (set REDIS_URL)',
      );
    },
    async close() {},
  };
}

export function createDeferredSendQueue(env: Env, warn: (obj: Record<string, unknown>, msg: string) => void): DeferredSendQueue {
  if (!env.REDIS_URL) return noDeferredSendQueue(warn);

  const url = new URL(env.REDIS_URL);
  const connection = {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.password ? { password: url.password } : {}),
    maxRetriesPerRequest: null,
  };
  const queue = new Queue<DeferredSendJobT>(QUEUE_DEFERRED_SEND, queueOpts(connection));
  const turns = new Queue<AssistantTurnJobT>(QUEUE_ASSISTANT_TURN, queueOpts(connection));
  const extractions = new Queue<AiExtractionJobT>(QUEUE_AI_EXTRACTION, queueOpts(connection));
  const firstTouches = new Queue<FirstTouchJobT>(QUEUE_FIRST_TOUCH, queueOpts(connection));
  const analyses = new Queue<LiveAnalysisJobT>(QUEUE_LIVE_ANALYSIS, queueOpts(connection));

  return {
    async enqueue(job, runAt) {
      await queue.add(QUEUE_DEFERRED_SEND, job, {
        // A delay, not a cron. The gate already computed the exact moment the
        // window opens for THIS recipient's timezone, jitter included.
        delay: Math.max(0, runAt.getTime() - Date.now()),
        removeOnComplete: 1000,
        removeOnFail: 5000,
      });
    },
    async enqueueAssistantTurn(job) {
      await turns.add(QUEUE_ASSISTANT_TURN, job, {
        removeOnComplete: 1000,
        removeOnFail: 5000,
        // A model call can fail transiently. Three attempts with backoff, then
        // it stops — a customer answered on the fourth retry twenty minutes
        // later is worse than one answered by a person.
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      });
    },
    async enqueueExtraction(job) {
      await extractions.add(QUEUE_AI_EXTRACTION, job, {
        removeOnComplete: 1000,
        removeOnFail: 5000,
        // Extraction is retry-safe: it re-reads the thread and re-derives from
        // scratch, so a duplicate run converges on the same facts.
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      });
    },
    async enqueueFirstTouch(job) {
      await firstTouches.add(QUEUE_FIRST_TOUCH, job, {
        // Deterministic: an intake retry that slips past the ACK dedupe still
        // cannot queue a second greeting for the same lead.
        jobId: `lead:${job.lead_id}:first-touch`,
        removeOnComplete: 1000,
        removeOnFail: 5000,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      });
    },
    async enqueueLiveAnalysis(job) {
      await analyses.add(QUEUE_LIVE_ANALYSIS, job, {
        // Deterministic per triggering message: a carrier retry that slips
        // past the dedupe cannot queue a second pass for the same message.
        jobId: `analysis:${job.message_id}`,
        removeOnComplete: 1000,
        removeOnFail: 5000,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      });
    },
    close: async () => {
      await queue.close();
      await analyses.close();
      await turns.close();
      await extractions.close();
      await firstTouches.close();
    },
  };
}
