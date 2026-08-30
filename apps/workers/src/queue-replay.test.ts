import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JOB_QUEUES, JOB_QUEUE_NAMES, QUEUE_WORKER_FILE, type QueueNameT } from '@dealpilot/contracts';

/**
 * F-73 §9 — `replay` is a safety control, so it is checked against the workers
 * rather than believed.
 *
 * The console can put a failed job back on its queue. On four of the ten
 * queues that reaches a carrier, and a second SMS to a dealer's customer is a
 * CASL problem, not a duplicate row. So each queue carries a classification,
 * and the API demands the queue name typed back before retrying anything on an
 * `at_least_once` one.
 *
 * A classification is a comment unless something can fail. This guard makes it
 * fail two ways:
 *
 *   1. The partition is DERIVED. A worker that can send is a worker whose file
 *      calls `deliverMessage(` or `sendMessage(` — the two chokepoints every
 *      outbound path goes through — and `replay === 'at_least_once'` must hold
 *      exactly for those. Adding a send to a worker and forgetting the
 *      catalogue is red; so is quietly reclassifying one to skip the confirm.
 *   2. Each `idempotent` claim cites the literal that makes it true, and the
 *      literal has to still be in the file it names. Delete the `ON CONFLICT`
 *      and the claim goes with it.
 *
 * What is NOT claimed: that an `idempotent` retry is free. It means the work
 * converges on one outcome, not that it costs nothing to run twice.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

/** The two calls every outbound message in this product passes through. */
const SEND_PATH = /\bdeliverMessage\(|\bsendMessage\(/;

/**
 * Files in this directory that consume no queue. Named individually, because
 * "everything else" is how a new worker escapes the catalogue.
 */
const NOT_A_QUEUE_WORKER: Readonly<Record<string, string>> = {
  'index.ts': 'the process wiring — it builds every Queue and Worker, and consumes none itself',
  'main.ts': 'the entrypoint',
  'tenant-status.ts': 'a shared guard the workers call, not a job handler',
};

/**
 * Why each `idempotent` queue converges — the file, and the literal in it.
 *
 * `null` is the four that reach a carrier: there is no such literal, which is
 * the whole point. `provider_ref IS NULL` proves "never a second message ROW";
 * it does not prove "never a second SEND", because `provider_ref` is written
 * only after `carrier.send` returns and a timeout in that window leaves an SMS
 * delivered and unmarked.
 */
const REPLAY_EVIDENCE: Record<QueueNameT, { file: string; evidence: string } | null> = {
  'deferred-send': null,
  'assistant-turn': null,
  'first-touch': null,
  'drip-tick': null,
  'lead-reassign': {
    file: 'apps/workers/src/lead-reassign.ts',
    // The job VERIFIES at fire time instead of being cancelled (D-046 #1): if
    // the assignment moved, the timer is about something that no longer exists.
    evidence: 'lead.assignment_attempts !== job.attempt',
  },
  'ai-extraction': {
    file: 'apps/workers/src/ai-extraction.ts',
    evidence: 'ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING',
  },
  'live-analysis': {
    file: 'apps/workers/src/live-analysis.ts',
    evidence: 'ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING',
  },
  'qa-review': {
    file: 'apps/workers/src/qa-review.ts',
    evidence: "ON CONFLICT (conversation_id) WHERE reviewer_type = 'model' DO NOTHING",
  },
  'task-sweep': {
    file: 'apps/workers/src/task-sweep.ts',
    // The stamp column is the claim check: a task already swept is not re-swept.
    evidence: 'AND ${stamp} IS NULL',
  },
  'announcement-fanout': {
    // The idempotence is in the schema, not the worker: one bell row per
    // (announcement, person), so a crash mid-batch and a redelivery converge.
    file: 'packages/db/migrations/20260830000068_announcements-killswitches.sql',
    evidence: 'CREATE UNIQUE INDEX idx_notifications_announcement_once',
  },
};

function workerSource(queue: QueueNameT): string {
  return readFileSync(join(here, QUEUE_WORKER_FILE[queue]), 'utf8');
}

describe('QUEUE_WORKER_FILE points at the workers that exist (F-73)', () => {
  it('maps every queue to a distinct file that is really there', () => {
    const mapped = JOB_QUEUE_NAMES.map((q) => QUEUE_WORKER_FILE[q]);
    expect(mapped.length).toBe(JOB_QUEUE_NAMES.length);
    expect(new Set(mapped).size, 'two queues claim the same worker file').toBe(mapped.length);
    for (const q of JOB_QUEUE_NAMES) {
      const path = join(here, QUEUE_WORKER_FILE[q]);
      expect(existsSync(path), `${q} names ${QUEUE_WORKER_FILE[q]}, which is not in apps/workers/src`).toBe(true);
    }
  });

  it('accounts for every worker file — a new one is either a queue or an exemption', () => {
    const onDisk = readdirSync(here)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .sort();
    // A path that resolved to nothing would make this pass while checking nothing.
    expect(onDisk.length).toBeGreaterThan(8);
    const accounted = new Set([...JOB_QUEUE_NAMES.map((q) => QUEUE_WORKER_FILE[q]), ...Object.keys(NOT_A_QUEUE_WORKER)]);
    const unaccounted = onDisk.filter((f) => !accounted.has(f));
    expect(
      unaccounted,
      'these files sit with the workers and belong to no queue and no exemption. If one consumes a queue, the catalogue is missing it; if it does not, say so in NOT_A_QUEUE_WORKER with a reason.',
    ).toEqual([]);
    // And the exemptions are asserted too: a stale one would hide a deletion.
    for (const f of Object.keys(NOT_A_QUEUE_WORKER)) {
      expect(onDisk, `${f} is exempted and no longer exists`).toContain(f);
    }
  });
});

describe('replay tracks the send path, not the author (F-73 §9)', () => {
  it('classifies at_least_once exactly where the worker can reach a carrier', () => {
    const reachesCarrier = JOB_QUEUE_NAMES.filter((q) => SEND_PATH.test(workerSource(q))).sort();
    // The four are named here so a regex that stopped matching goes red rather
    // than agreeing with an empty set.
    expect(
      reachesCarrier,
      'the send-path detection found a different set of workers — check deliverMessage/sendMessage have not been renamed',
    ).toEqual(['assistant-turn', 'deferred-send', 'drip-tick', 'first-touch']);

    for (const q of JOB_QUEUE_NAMES) {
      const sends = reachesCarrier.includes(q);
      expect(
        JOB_QUEUES[q].replay,
        sends
          ? `${q}'s worker calls a send path, so retrying one of its failed jobs can put a second message in front of a real customer. It must be 'at_least_once' — that is what makes the console demand the queue name typed back.`
          : `${q}'s worker reaches no send path, so 'at_least_once' would demand a confirmation for a retry that cannot duplicate a message. Confirmations that are always asked stop being read.`,
      ).toBe(sends ? 'at_least_once' : 'idempotent');
    }
  });

  it('every idempotent claim still has the literal it rests on', () => {
    let checked = 0;
    for (const q of JOB_QUEUE_NAMES) {
      const cited = REPLAY_EVIDENCE[q];
      if (JOB_QUEUES[q].replay === 'at_least_once') {
        expect(cited, `${q} is at_least_once — it must cite no evidence of convergence, because there is none`).toBeNull();
        continue;
      }
      expect(cited, `${q} is idempotent and cites nothing`).not.toBeNull();
      const path = join(repoRoot, cited!.file);
      expect(existsSync(path), `${q} cites ${cited!.file}, which does not exist`).toBe(true);
      expect(
        readFileSync(path, 'utf8'),
        `${q} is classified idempotent on the strength of \`${cited!.evidence}\` in ${cited!.file}, and that text is no longer there. Either the convergence went away — in which case a retry can now duplicate work and the classification is wrong — or the line moved and the citation needs updating.`,
      ).toContain(cited!.evidence);
      checked += 1;
    }
    expect(checked, 'no evidence was checked — this guard is looking at nothing').toBeGreaterThan(4);
  });
});
