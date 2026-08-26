import { withTenant, type Pool, type PoolClient } from '@dealpilot/db';
import { notify } from '@dealpilot/api/notifications';

/**
 * F-68 — the 15-minute overdue-task sweep (appointments-tasks-communications.md
 * §3.3): task overdue → its assignee and the store's sales managers;
 * unacknowledged ten minutes later → the GM.
 *
 * The scan runs through `tasks_needing_attention()` — SECURITY DEFINER, ids
 * only, on the drip-tick precedent — because "which tenants have an overdue
 * task" is exactly the question a tenant-scoped connection cannot ask. Every
 * read of a title and every notification row happens under withTenant, one
 * small transaction per task, so a poison task costs itself and nothing else.
 *
 * Acknowledgement is READING the alert: the definer scan escalates only when
 * no overdue notification for the task has a read_at. There is no separate
 * "acknowledge" button to forget, and the bell already records reads.
 *
 * The rule itself (who, and after how long) is code-seeded here until the
 * automation-rules module gives tenants the dial — the spec calls it a
 * seeded automation rule, and a seed is what this is.
 */

export const ESCALATE_AFTER_MINUTES = 10;

export interface TaskSweepDeps {
  readonly pool: Pool;
  /** Injected so a test can drive the clock instead of waiting ten minutes. */
  readonly now?: () => Date;
  readonly escalateAfterMinutes?: number;
  /** Where a poison task's error lands (the registrar's logger seam). */
  readonly warn?: (message: string, err: unknown) => void;
}

export interface TaskSweepSummary {
  scanned: number;
  /** First alerts sent (one per task, ever). */
  overdue: number;
  /** Escalations sent (one per task, ever). */
  escalated: number;
  /** Stamped with nobody to tell — no active assignee and no manager for that store. */
  unrouted: number;
  /** Closed or deleted between the scan and the transaction. */
  skipped: number;
  failed: number;
}

interface Candidate {
  organization_id: string;
  task_id: string;
  kind: 'overdue' | 'escalate';
}

interface TaskRow {
  id: string;
  title: string;
  store_id: string;
  assigned_to: string | null;
  subject_type: string;
  subject_id: string;
}

const OPEN = `('pending','in_progress')`;

/** Table per subject — keyed by the CHECK'd column value, never by free text. */
const SUBJECT_TABLE: Record<string, string> = {
  lead: 'leads',
  contact: 'contacts',
  deal: 'deals',
  vehicle: 'vehicles',
};

/** The board's deep link: the page opens on THAT task, not on "my tasks". */
export function taskLink(task: Pick<TaskRow, 'id' | 'subject_type' | 'subject_id'>): string {
  return task.subject_type === 'lead' ? `/leads/${task.subject_id}` : `/tasks?task=${task.id}`;
}

async function recipients(c: PoolClient, orgId: string, storeId: string, kind: Candidate['kind'], assignee: string | null): Promise<string[]> {
  // Managers of THIS store: an org-wide membership (store NULL) or one bound
  // to the task's store. A GM is the escalation target; an owner stands in
  // where a rooftop has no GM. The assignee joins the first alert only while
  // they are still an ACTIVE member here (review): a revoked person's bell
  // must never receive this organization's customer names.
  const roles = kind === 'overdue' ? ['sales_manager'] : ['gm', 'owner'];
  const r = await c.query<{ user_id: string }>(
    `SELECT DISTINCT m.user_id FROM memberships m
     WHERE m.organization_id = $1 AND m.status = 'active'
       AND (
         (m.roles && $2::text[] AND (m.store_id IS NULL OR m.store_id = $3))
         OR ($4::uuid IS NOT NULL AND m.user_id = $4)
       )`,
    [orgId, roles, storeId, kind === 'overdue' ? assignee : null],
  );
  return r.rows.map((x) => x.user_id);
}

async function handle(c: PoolClient, cand: Candidate, now: Date, minutes: number, summary: TaskSweepSummary): Promise<void> {
  const stamp = cand.kind === 'overdue' ? 'overdue_notified_at' : 'escalated_at';
  const t = await c.query<TaskRow>(
    `SELECT id, title, store_id, assigned_to, subject_type, subject_id FROM tasks
     WHERE id = $1 AND status IN ${OPEN} AND deleted_at IS NULL AND ${stamp} IS NULL
     FOR UPDATE`,
    [cand.task_id],
  );
  const task = t.rows[0];
  if (!task) {
    summary.skipped += 1;
    return;
  }
  // A task whose subject is gone (a deleted contact, a sold-and-removed
  // vehicle) is stamped and left alone (review): nobody is paged about a
  // record that no longer exists, and the sweep never retries it.
  const alive = await c.query(
    `SELECT 1 FROM ${SUBJECT_TABLE[task.subject_type] ?? 'leads'} WHERE id = $1 AND deleted_at IS NULL`,
    [task.subject_id],
  );
  const to = alive.rows.length === 0 ? [] : await recipients(c, cand.organization_id, task.store_id, cand.kind, task.assigned_to);
  const link = taskLink(task);
  for (const userId of to) {
    await notify(c, {
      organizationId: cand.organization_id,
      userId,
      storeId: task.store_id,
      urgency: cand.kind === 'overdue' ? 'medium' : 'high',
      titleKey: cand.kind === 'overdue' ? 'notif_task_overdue' : 'notif_task_escalated',
      params: { title: task.title, minutes },
      link,
      entityType: 'task',
      entityId: task.id,
    });
  }
  // Stamped even with nobody to tell: the sweep must not retry a task
  // forever because a store has no manager.
  await c.query(`UPDATE tasks SET ${stamp} = $2 WHERE id = $1`, [task.id, now]);
  if (to.length === 0) summary.unrouted += 1;
  else if (cand.kind === 'overdue') summary.overdue += 1;
  else summary.escalated += 1;
}

export async function runTaskSweep(deps: TaskSweepDeps): Promise<TaskSweepSummary> {
  const now = deps.now?.() ?? new Date();
  const minutes = deps.escalateAfterMinutes ?? ESCALATE_AFTER_MINUTES;
  const summary: TaskSweepSummary = { scanned: 0, overdue: 0, escalated: 0, unrouted: 0, skipped: 0, failed: 0 };

  const scan = await deps.pool.query<Candidate>(
    `SELECT organization_id, task_id, kind FROM tasks_needing_attention($1, $2::interval)`,
    [now, `${minutes} minutes`],
  );
  summary.scanned = scan.rows.length;

  for (const cand of scan.rows) {
    try {
      await withTenant(deps.pool, cand.organization_id, (c) => handle(c, cand, now, minutes, summary));
    } catch (err) {
      summary.failed += 1;
      deps.warn?.(`task sweep: ${cand.kind} for task ${cand.task_id} failed`, err);
    }
  }
  return summary;
}
