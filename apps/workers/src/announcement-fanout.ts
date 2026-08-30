import type { Pool } from '@dealpilot/db';
import {
  ANNOUNCEMENT_FANOUT_BATCH,
  AnnouncementFanoutJob,
  type AnnouncementFanoutJobT,
} from '@dealpilot/contracts';

/**
 * F-72 — fanning a published announcement out to one bell row per recipient
 * (admin-console.md §8; D-073).
 *
 * The scan AND the insert live in ONE statement inside
 * `announcement_fanout_batch` (0068), executed as the definer's owner. This
 * worker therefore never opens tenant context at all — there is no
 * `withTenant` here and no organization id in the job. That is deliberate:
 * "which people, across every tenant, match this audience" is exactly the
 * question a tenant-scoped connection cannot ask.
 *
 * Idempotence is a database fact, not a promise: a partial unique index on
 * `notifications (entity_id, user_id) WHERE entity_type = 'announcement'`
 * plus `ON CONFLICT DO NOTHING`. A crash mid-walk, a BullMQ redelivery and a
 * double publish all converge on one row per person.
 *
 * The job walks a keyset cursor and re-enqueues itself, so an announcement to
 * every rooftop is many small transactions rather than one long one.
 */

export interface AnnouncementFanoutDeps {
  readonly pool: Pool;
  /** Re-arm the next link in the walk (the queue seam, injected for tests). */
  readonly next: (job: AnnouncementFanoutJobT, opts?: { delayMs?: number }) => Promise<void>;
  readonly batchSize?: number;
}

export type AnnouncementFanoutResult =
  | { kind: 'skipped'; reason: 'announcement_gone' | 'window_closed' | 'not_started' }
  | { kind: 'ran'; inserted: number; done: boolean };

interface StateRow {
  state: 'gone' | 'ended' | 'scheduled' | 'live';
  starts_at: Date | null;
}

interface BatchRow {
  last_user_id: string | null;
  inserted: number;
  done: boolean;
}

export async function runAnnouncementFanout(
  raw: unknown,
  deps: AnnouncementFanoutDeps,
): Promise<AnnouncementFanoutResult> {
  // Parsed on the way out as well as the way in (contracts/queues.ts): a job
  // outlives the process that wrote it, so a payload from an older deploy or a
  // replay names its own defect here instead of reaching `$1::uuid` and
  // surfacing as a 22P02 from inside a definer, three attempts later.
  const job = AnnouncementFanoutJob.parse(raw);
  // The pre-check exists so an announcement somebody ended between publish and
  // consume does not raise PA021 out of the batch definer, burn the retry
  // budget and land a DLQ entry for a deliberate act.
  const s = await deps.pool.query<StateRow>('SELECT * FROM announcement_fanout_state($1::uuid)', [
    job.announcement_id,
  ]);
  const state = s.rows[0]?.state ?? 'gone';

  // The row is append-only and cannot come back; nothing to retry.
  if (state === 'gone') return { kind: 'skipped', reason: 'announcement_gone' };
  // Ended before it reached anyone — including the legal case of a publish
  // whose window had already closed. Nobody is notified, and that is correct.
  if (state === 'ended') return { kind: 'skipped', reason: 'window_closed' };
  if (state === 'scheduled') {
    const startsAt = s.rows[0]?.starts_at;
    const delayMs = startsAt ? Math.max(1000, startsAt.getTime() - Date.now()) : 1000;
    await deps.next({ announcement_id: job.announcement_id }, { delayMs });
    return { kind: 'skipped', reason: 'not_started' };
  }

  const limit = deps.batchSize ?? ANNOUNCEMENT_FANOUT_BATCH;
  const r = await deps.pool.query<BatchRow>(
    'SELECT * FROM announcement_fanout_batch($1::uuid, $2::uuid, $3::int)',
    [job.announcement_id, job.after_user_id ?? null, limit],
  );
  const row = r.rows[0];
  const inserted = Number(row?.inserted ?? 0);
  const done = row?.done ?? true;

  if (!done && row?.last_user_id) {
    await deps.next({ announcement_id: job.announcement_id, after_user_id: row.last_user_id });
  }
  return { kind: 'ran', inserted, done };
}
