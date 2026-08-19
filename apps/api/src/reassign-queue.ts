import { Queue } from 'bullmq';
import {
  QUEUE_LEAD_REASSIGN, REASSIGN_AFTER_MS, queueOpts,
  type LeadReassignJobT,
} from '@dealpilot/contracts';
import type { Env } from './env.js';

/**
 * Arming the ten-minute reassignment timer (F-42.2, FR-LEAD-010, D-046).
 *
 * Behind an interface for the deferred-send reason: the API must run with no
 * Redis (every test builds one). An absent queue is a loud DEGRADATION, not a
 * failure — leads still get assigned, they just stop being taken back when
 * nobody follows up, and each skipped timer says so in the log.
 */

export interface ReassignQueue {
  /** Arm the timer for one just-made assignment. Fires in ten minutes. */
  arm(job: LeadReassignJobT): Promise<void>;
  close(): Promise<void>;
}

export function noReassignQueue(
  warn: (obj: Record<string, unknown>, msg: string) => void,
): ReassignQueue {
  return {
    async arm(job) {
      warn(
        { lead_id: job.lead_id, attempt: job.attempt },
        'a lead was assigned and there is no queue to arm its 10-minute timer — nobody will take it back if the agent goes quiet (set REDIS_URL)',
      );
    },
    async close() {},
  };
}

export function createReassignQueue(
  env: Env,
  warn: (obj: Record<string, unknown>, msg: string) => void,
): ReassignQueue {
  if (!env.REDIS_URL) return noReassignQueue(warn);

  const url = new URL(env.REDIS_URL);
  const connection = {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.password ? { password: url.password } : {}),
    maxRetriesPerRequest: null,
  };
  const queue = new Queue<LeadReassignJobT>(QUEUE_LEAD_REASSIGN, queueOpts(connection));

  return {
    async arm(job) {
      await queue.add(QUEUE_LEAD_REASSIGN, job, {
        delay: REASSIGN_AFTER_MS,
        // The spec's deterministic id (leads.md:254): a second arm for the
        // same assignment is the same job, not a second timer.
        jobId: `reassign:${job.lead_id}:${job.attempt}`,
        removeOnComplete: 1000,
        removeOnFail: 5000,
      });
    },
    async close() {
      await queue.close();
    },
  };
}
