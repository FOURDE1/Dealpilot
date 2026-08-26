import type { FastifyInstance } from 'fastify';
import { withTenant, withUser, type Pool, type PoolClient } from '@dealpilot/db';
import {
  BulkCompleteTasksInput,
  BulkReassignTasksInput,
  CreateTaskInput,
  TaskListQuery,
  TaskSummaryQuery,
  UpdateTaskInput,
  type PermissionT,
  type TaskSubjectTypeT,
  type TaskSummaryT,
  type TaskT,
} from '@dealpilot/schemas';
import { AppError, notFound, parseOrThrow } from './errors.js';
import { idParam, requireMember, sessionUser } from './f01-routes.js';
import { requirePermission } from './permissions.js';
import { diff, recordEvent } from './activity.js';

/**
 * F-68 — the unified task system (appointments-tasks-communications.md §3.3).
 *
 * One table, a polymorphic subject, and the permission of the SUBJECT: a
 * task on a lead is lead work (F-38's precedent for appointments), a task
 * on a deal is deal work, a task on a vehicle is inventory work. There is
 * no `task:*` permission to configure because a task carries no authority
 * of its own — it is a note that says "do this to that", and whoever may
 * touch "that" may schedule it.
 *
 * Buckets (overdue / today / week) are computed HERE, per task, in that
 * task's store timezone: "due today" means the store's today, and a
 * Vancouver rooftop in a Montréal group keeps its own midnight.
 *
 * Scope (review): the F-55 store cut applies to the BOARD — a store-bound
 * manager's list and summary show their stores. A record's own task list
 * (subject filter) follows the record's visibility instead: leads are
 * org-wide readable, so the lead page shows every follow-up on that lead,
 * and the person who can open the lead can schedule on it. Scoping the
 * panel while not scoping the write minted duplicate follow-ups behind a
 * false "no follow-up scheduled".
 */

const SUBJECT_PERMISSION = {
  lead: 'lead:update',
  contact: 'lead:update',
  deal: 'deal:update',
  vehicle: 'vehicle:update',
} as const satisfies Record<TaskSubjectTypeT, PermissionT>;

/** Table per subject — keyed by a PARSED enum, never by a request string. */
const SUBJECT_TABLE = {
  lead: 'leads',
  contact: 'contacts',
  deal: 'deals',
  vehicle: 'vehicles',
} as const satisfies Record<TaskSubjectTypeT, string>;

/** The board's ceiling — bounded with a truncated flag, F-38's precedent. */
const BOARD_LIMIT = 200;

/**
 * Every read goes through this CTE so a task's bucket is computed in one
 * place. `$1` = organization, `$2` = now (bound once, so a page and its
 * summary agree on which side of midnight they were computed).
 */
const OPEN = `('pending','in_progress')`;

/**
 * `openOnly` narrows the CTE to open rows BEFORE the bucket is computed, so
 * the summary can use idx_tasks_open_by_assignee instead of walking every
 * task the organization ever had (review).
 */
function scopedTasks(openOnly: boolean): string {
  return `
  WITH scoped AS (
    SELECT t.*,
           CASE
             WHEN t.status NOT IN ${OPEN} THEN NULL
             WHEN t.due_at IS NULL THEN 'undated'
             WHEN t.due_at < $2::timestamptz THEN 'overdue'
             WHEN (t.due_at AT TIME ZONE s.timezone)::date = ($2::timestamptz AT TIME ZONE s.timezone)::date THEN 'today'
             WHEN t.due_at < $2::timestamptz + interval '7 days' THEN 'week'
             ELSE 'later'
           END AS bucket,
           -- What the task is ABOUT, by name (review): a board of rows that
           -- all read "Lead" tells nobody which customer to call.
           CASE t.subject_type
             WHEN 'lead' THEN (SELECT NULLIF(concat_ws(' ', l.first_name, l.last_name), '') FROM leads l WHERE l.id = t.subject_id)
             WHEN 'contact' THEN (SELECT NULLIF(concat_ws(' ', k.first_name, k.last_name), '') FROM contacts k WHERE k.id = t.subject_id)
             WHEN 'vehicle' THEN (SELECT concat_ws(' ', v.year::text, v.make, v.model, '#' || v.stock_number) FROM vehicles v WHERE v.id = t.subject_id)
             WHEN 'deal' THEN (SELECT NULLIF(concat_ws(' ', l.first_name, l.last_name), '') FROM deals d JOIN leads l ON l.id = d.lead_id WHERE d.id = t.subject_id)
           END AS subject_label
    FROM tasks t
    JOIN stores s ON s.id = t.store_id
    WHERE t.organization_id = $1 AND t.deleted_at IS NULL${openOnly ? ` AND t.status IN ${OPEN}` : ''}
  )`;
}
const SCOPED_TASKS = scopedTasks(false);

/** The sink-side key list (F-38): what a PATCH may touch, in SQL identifier position. */
const PATCHABLE = ['title', 'description', 'task_type', 'priority', 'status', 'due_at', 'assigned_to'] as const;

async function loadTask(c: PoolClient, orgId: string, id: string, now: Date): Promise<TaskT> {
  const r = await c.query<TaskT>(`${SCOPED_TASKS} SELECT * FROM scoped WHERE id = $3`, [orgId, now, id]);
  if (r.rows.length === 0) throw notFound();
  return r.rows[0]!;
}

async function taskOrg(pool: Pool, userId: string, id: string): Promise<string> {
  return withUser(pool, userId, async (c) => {
    // Visible under withUser via tasks_member_read (0064) — the D-046 lesson.
    const r = await c.query<{ organization_id: string }>(
      `SELECT organization_id FROM tasks WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (r.rows.length === 0) throw notFound();
    return r.rows[0]!.organization_id;
  });
}

/** organization_id optional on reads: single-org callers are scoped by membership. */
async function resolveOrg(pool: Pool, userId: string, requested: string | undefined): Promise<string> {
  return withUser(pool, userId, async (c) => {
    if (requested) {
      const member = await c.query(
        `SELECT 1 FROM memberships m
         JOIN organizations o ON o.id = m.organization_id AND o.deleted_at IS NULL
         WHERE m.organization_id = $1 AND m.status = 'active' LIMIT 1`,
        [requested],
      );
      if (member.rows.length === 0) throw notFound();
      return requested;
    }
    const r = await c.query<{ organization_id: string }>(
      `SELECT DISTINCT m.organization_id FROM memberships m
       JOIN organizations o ON o.id = m.organization_id AND o.deleted_at IS NULL
       WHERE m.status = 'active'`,
    );
    if (r.rows.length === 0) throw notFound();
    if (r.rows.length > 1) {
      throw new AppError(400, 'organization_required', 'Pass organization_id — you belong to several organizations');
    }
    return r.rows[0]!.organization_id;
  });
}

/** The F-55 scope discipline: store-bound members' BOARD shows their stores. */
async function storeScope(c: PoolClient, userId: string, orgId: string, requestedStore: string | undefined): Promise<string[] | null> {
  const rows = await c.query<{ store_id: string | null; is_owner: boolean }>(
    `SELECT m.store_id, 'owner' = ANY(m.roles) AS is_owner
     FROM memberships m
     WHERE m.user_id = $1 AND m.organization_id = $2 AND m.status = 'active'`,
    [userId, orgId],
  );
  if (rows.rows.length === 0) throw notFound();
  const orgWide = rows.rows.some((m) => m.is_owner || m.store_id === null);
  const scope = orgWide
    ? null
    : [...new Set(rows.rows.map((m) => m.store_id).filter((x): x is string => x !== null))];
  if (scope !== null && requestedStore && !scope.includes(requestedStore)) throw notFound();
  return scope;
}

async function requireActiveMember(c: PoolClient, orgId: string, userId: string, path: string): Promise<void> {
  const r = await c.query(
    `SELECT 1 FROM memberships WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`,
    [orgId, userId],
  );
  if (r.rows.length === 0) {
    throw new AppError(422, 'not_a_member', 'That person is not an active member here.', [
      { path, code: 'not_a_member', message: 'Assignee must be an active member of this organization' },
    ]);
  }
}

async function subjectStore(
  c: PoolClient,
  type: TaskSubjectTypeT,
  id: string,
): Promise<{ store_id: string | null } | null> {
  const r = await c.query<{ store_id: string | null }>(
    `SELECT store_id FROM ${SUBJECT_TABLE[type]} WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return r.rows[0] ?? null;
}

/* ------------------------------------------------------------------------ */
/* §2.4 — the appointment automations                                        */
/* ------------------------------------------------------------------------ */

/** Task titles are stored text, so the automation writes them in the STORE's language. */
const AUTOMATION_TITLES = {
  'fr-CA': {
    kind: { test_drive: 'essai routier', showroom_visit: 'visite en salle', phone_call: 'appel' },
    appointment_no_show: (kind: string) => `Be-back — rendez-vous manqué (${kind})`,
    appointment_showed_no_deal: (kind: string) => `Suivi après la visite (${kind})`,
  },
  'en-CA': {
    kind: { test_drive: 'test drive', showroom_visit: 'showroom visit', phone_call: 'phone call' },
    appointment_no_show: (kind: string) => `Be-back — missed appointment (${kind})`,
    appointment_showed_no_deal: (kind: string) => `Follow up after visit (${kind})`,
  },
} as const;

export interface AppointmentForTask {
  readonly id: string;
  readonly organization_id: string;
  readonly store_id: string;
  readonly lead_id: string | null;
  readonly assigned_agent_id: string | null;
  readonly kind: string;
}

/**
 * On a PATCH to `no_show` or `completed` (§2.4): a be-back task due in an
 * hour, or — when the visit produced no deal — a follow-up due tomorrow.
 * Called INSIDE the appointment's transaction, so the task exists exactly
 * when the status does (the legacy's "best-effort, failures logged" was a
 * task that sometimes did not get made). Deduped by (appointment, source):
 * flipping a status back and forth makes one task, not one per flip.
 *
 * Returns the task id, or null when nothing was owed — including when the
 * lead has since been deleted (review): no follow-up on a customer record
 * that no longer exists.
 */
export async function appointmentAutomationTask(
  c: PoolClient,
  appointment: AppointmentForTask,
  transition: 'no_show' | 'completed',
): Promise<string | null> {
  if (!appointment.lead_id) return null;
  const lead = await c.query<{ assigned_to: string | null; store_id: string }>(
    `SELECT assigned_to, store_id FROM leads WHERE id = $1 AND deleted_at IS NULL`,
    [appointment.lead_id],
  );
  if (lead.rows.length === 0) return null;
  const source = transition === 'no_show' ? 'appointment_no_show' : 'appointment_showed_no_deal';
  if (transition === 'completed') {
    // "Did a deal result?" — the lead's LIVE deals, since the appointment
    // carries none. A deal lost in June is not the result of August's visit
    // (review).
    const deal = await c.query(
      `SELECT 1 FROM deals WHERE lead_id = $1 AND deleted_at IS NULL AND pipeline_stage <> 'lost' LIMIT 1`,
      [appointment.lead_id],
    );
    if (deal.rows.length > 0) return null;
  }
  // Once per (appointment, source), ever — a be-back completed and then the
  // appointment flipped again is not a second be-back (review).
  const dup = await c.query(
    `SELECT 1 FROM tasks WHERE appointment_id = $1 AND source = $2 AND deleted_at IS NULL`,
    [appointment.id, source],
  );
  if (dup.rows.length > 0) return null;
  // The assignee must still be on the team (review): the appointment's
  // agent, else the lead's owner, else nobody — never a revoked account.
  const candidates = [appointment.assigned_agent_id, lead.rows[0]!.assigned_to].filter((x): x is string => x !== null);
  const active = candidates.length
    ? await c.query<{ user_id: string }>(
        `SELECT user_id FROM memberships
         WHERE organization_id = $1 AND user_id = ANY($2::uuid[]) AND status = 'active'`,
        [appointment.organization_id, candidates],
      )
    : { rows: [] as { user_id: string }[] };
  const assignee = candidates.find((id) => active.rows.some((m) => m.user_id === id)) ?? null;

  const store = await c.query<{ default_locale: 'fr-CA' | 'en-CA' }>(
    `SELECT default_locale FROM stores WHERE id = $1`,
    [appointment.store_id],
  );
  const words = AUTOMATION_TITLES[store.rows[0]?.default_locale ?? 'fr-CA'];
  const kindLabel = (words.kind as Record<string, string>)[appointment.kind] ?? appointment.kind;
  const title = words[source](kindLabel);
  const dueInHours = transition === 'no_show' ? 1 : 24;

  const r = await c.query<{ id: string }>(
    `INSERT INTO tasks
       (organization_id, store_id, subject_type, subject_id, title, task_type, priority, source,
        due_at, assigned_to, appointment_id)
     VALUES ($1, $2, 'lead', $3, $4, 'follow_up', 'high', $5,
             now() + make_interval(hours => $6), $7, $8)
     RETURNING id`,
    [
      // A task lives in its SUBJECT's store (the POST invariant, review).
      appointment.organization_id, lead.rows[0]!.store_id, appointment.lead_id, title, source,
      dueInHours, assignee, appointment.id,
    ],
  );
  await recordEvent(c, {
    organizationId: appointment.organization_id,
    storeId: lead.rows[0]!.store_id,
    actorUserId: null,
    entityType: 'task',
    entityId: r.rows[0]!.id,
    action: 'created',
    parentEntityType: 'lead',
    parentEntityId: appointment.lead_id,
    changes: { source: { to: source }, appointment_id: { to: appointment.id } },
  });
  return r.rows[0]!.id;
}

/**
 * F-04's revoke cascade, for tasks (review): someone who is no longer on
 * the team cannot owe work — their OPEN tasks return to the pool in the
 * same transaction, so the overdue sweep never pages a stranger about a
 * customer of an organization they left. Returns the released ids.
 */
export async function releaseTasksOf(c: PoolClient, orgId: string, userId: string): Promise<string[]> {
  const r = await c.query<{ id: string }>(
    `UPDATE tasks SET assigned_to = NULL
     WHERE organization_id = $1 AND assigned_to = $2 AND status IN ${OPEN} AND deleted_at IS NULL
     RETURNING id`,
    [orgId, userId],
  );
  return r.rows.map((x) => x.id);
}

/* ------------------------------------------------------------------------ */
/* Routes                                                                    */
/* ------------------------------------------------------------------------ */

export function registerF68Routes(app: FastifyInstance, pool: Pool): void {
  app.get('/api/v1/tasks', async (request, reply) => {
    const query = parseOrThrow(TaskListQuery, request.query);
    const user = sessionUser(request);
    const orgId = await resolveOrg(pool, user.id, query.organization_id);
    const now = new Date();
    const page = await withTenant(pool, orgId, async (c) => {
      const scope = await storeScope(c, user.id, orgId, query.store_id);
      // A record's own list follows the record's visibility, not the board's cut.
      const boardScope = query.subject_id ? null : scope;
      const r = await c.query<TaskT>(
        `${SCOPED_TASKS}
         SELECT * FROM scoped
         WHERE ($3::uuid IS NULL OR store_id = $3)
           AND ($4::uuid[] IS NULL OR store_id = ANY($4))
           AND ($5::text IS NULL OR subject_type = $5)
           AND ($6::uuid IS NULL OR subject_id = $6)
           AND ($7::uuid IS NULL OR assigned_to = $7)
           AND CASE WHEN $8::text IS NOT NULL THEN status = $8
                    WHEN $9::boolean THEN status IN ${OPEN}
                    ELSE true END
           AND ($10::text IS NULL OR bucket = $10)
         -- Incomplete first, then by due date with the undated last (§3.1).
         ORDER BY (status IN ${OPEN}) DESC, due_at ASC NULLS LAST, created_at DESC, id DESC
         LIMIT $11`,
        [
          orgId, now, query.store_id ?? null, boardScope, query.subject_type ?? null, query.subject_id ?? null,
          query.assigned_to ?? null, query.status ?? null, query.open, query.bucket ?? null, BOARD_LIMIT + 1,
        ],
      );
      const truncated = r.rows.length > BOARD_LIMIT;
      return { items: truncated ? r.rows.slice(0, BOARD_LIMIT) : r.rows, truncated };
    });
    return reply.send(page);
  });

  app.get('/api/v1/tasks/summary', async (request, reply) => {
    const query = parseOrThrow(TaskSummaryQuery, request.query);
    const user = sessionUser(request);
    const orgId = await resolveOrg(pool, user.id, query.organization_id);
    const summary = await withTenant(pool, orgId, async (c): Promise<TaskSummaryT> => {
      const scope = await storeScope(c, user.id, orgId, query.store_id);
      const r = await c.query<{ bucket: string; n: number }>(
        `${scopedTasks(true)}
         SELECT bucket, count(*)::int AS n FROM scoped
         WHERE bucket IS NOT NULL
           AND ($3::uuid IS NULL OR store_id = $3)
           AND ($4::uuid[] IS NULL OR store_id = ANY($4))
           AND ($5::uuid IS NULL OR assigned_to = $5)
         GROUP BY bucket`,
        [orgId, new Date(), query.store_id ?? null, scope, query.assigned_to ?? null],
      );
      const out: TaskSummaryT = { overdue: 0, today: 0, week: 0, later: 0, undated: 0, total_open: 0 };
      for (const row of r.rows) {
        if (row.bucket in out) out[row.bucket as keyof TaskSummaryT] = row.n;
        out.total_open += row.n;
      }
      return out;
    });
    return reply.send(summary);
  });

  app.post('/api/v1/tasks', async (request, reply) => {
    const input = parseOrThrow(CreateTaskInput, request.body);
    const user = sessionUser(request);
    const orgId = input.organization_id;
    const task = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, SUBJECT_PERMISSION[input.subject_type]);
      const subject = await subjectStore(c, input.subject_type, input.subject_id);
      if (!subject) {
        throw new AppError(422, 'validation_failed', 'Unknown subject for this organization', [
          { path: 'subject_id', code: 'invalid_reference', message: `${input.subject_type} not found in this organization` },
        ]);
      }
      if (input.store_id && subject.store_id && input.store_id !== subject.store_id) {
        throw new AppError(422, 'validation_failed', 'The subject belongs to another store', [
          { path: 'store_id', code: 'store_mismatch', message: 'A task lives in its subject’s store' },
        ]);
      }
      const storeId = subject.store_id ?? input.store_id;
      if (!storeId) {
        throw new AppError(422, 'validation_failed', 'This contact belongs to no store — pass store_id', [
          { path: 'store_id', code: 'store_required', message: 'store_id is required for a contact without a store' },
        ]);
      }
      const store = await c.query(
        `SELECT 1 FROM stores WHERE id = $1 AND deleted_at IS NULL AND status <> 'closed'`,
        [storeId],
      );
      if (store.rows.length === 0) {
        throw new AppError(422, 'validation_failed', 'Unknown store for this organization', [
          { path: 'store_id', code: 'invalid_reference', message: 'Store not found in this organization (or closed)' },
        ]);
      }
      if (input.assigned_to) await requireActiveMember(c, orgId, input.assigned_to, 'assigned_to');

      const r = await c.query<{ id: string }>(
        `INSERT INTO tasks
           (organization_id, store_id, subject_type, subject_id, title, description, task_type,
            priority, due_at, assigned_to, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id`,
        [
          orgId, storeId, input.subject_type, input.subject_id, input.title, input.description ?? null,
          input.task_type, input.priority, input.due_at ?? null, input.assigned_to ?? null, user.id,
        ],
      );
      const id = r.rows[0]!.id;
      await recordEvent(c, {
        organizationId: orgId,
        storeId,
        actorUserId: user.id,
        entityType: 'task',
        entityId: id,
        action: 'created',
        parentEntityType: input.subject_type,
        parentEntityId: input.subject_id,
        changes: input.assigned_to ? { assigned_to: { to: input.assigned_to } } : undefined,
      });
      return loadTask(c, orgId, id, new Date());
    });
    return reply.status(201).send(task);
  });

  app.patch('/api/v1/tasks/:id', async (request, reply) => {
    const id = idParam(request);
    const input = parseOrThrow(UpdateTaskInput, request.body);
    const user = sessionUser(request);
    const orgId = await taskOrg(pool, user.id, id);

    const task = await withTenant(pool, orgId, async (c) => {
      const prior = await c.query<TaskT>(
        `SELECT * FROM tasks WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [id],
      );
      if (prior.rows.length === 0) throw notFound();
      const before = prior.rows[0]!;
      await requirePermission(c, user.id, SUBJECT_PERMISSION[before.subject_type]);
      if (input.assigned_to) await requireActiveMember(c, orgId, input.assigned_to, 'assigned_to');

      // The strictObject already bounds the keys, but this list — not luck —
      // keeps them out of identifier position if the schema ever loosens.
      for (const key of Object.keys(input)) {
        if (!(PATCHABLE as readonly string[]).includes(key)) throw new Error(`unpatchable column reached the SQL sink: ${key}`);
      }
      // diff() compares in pg's own shapes (a timestamptz comes back as a
      // Date), so re-sending the current due_at is not a change (review).
      const changes = diff(before as unknown as Record<string, unknown>, input as Record<string, unknown>, PATCHABLE);
      const sets: string[] = [];
      const params: unknown[] = [id];
      for (const key of Object.keys(changes)) {
        params.push((input as Record<string, unknown>)[key]);
        sets.push(`${key} = $${params.length}`);
      }
      const completingNow = input.status === 'completed' && before.status !== 'completed';
      const wasClosed = before.status === 'completed' || before.status === 'cancelled';
      const reopening = input.status !== undefined && (input.status === 'pending' || input.status === 'in_progress') && wasClosed;
      // completed_at travels with the status — the 0064 CHECK refuses either alone.
      if (completingNow) sets.push(`completed_at = now()`);
      if (before.status === 'completed' && input.status !== undefined && input.status !== 'completed') sets.push(`completed_at = NULL`);
      // A new due date or a reopened task is a NEW overdue episode (review):
      // the sweep's stamps go, so it is alerted again when it is late again,
      // and never escalated about a due date that no longer exists.
      if ('due_at' in changes || reopening) sets.push(`overdue_notified_at = NULL`, `escalated_at = NULL`);
      if (sets.length === 0) return loadTask(c, orgId, id, new Date());

      await c.query(`UPDATE tasks SET ${sets.join(', ')} WHERE id = $1`, params);

      const assignedChanged = 'assigned_to' in changes;
      await recordEvent(c, {
        organizationId: orgId,
        storeId: before.store_id,
        actorUserId: user.id,
        entityType: 'task',
        entityId: id,
        action: completingNow
          ? 'task_completed'
          : assignedChanged
            ? (input.assigned_to ? 'assigned' : 'unassigned')
            : 'updated',
        parentEntityType: before.subject_type,
        parentEntityId: before.subject_id,
        changes,
      });
      return loadTask(c, orgId, id, new Date());
    });
    return reply.send(task);
  });

  app.delete('/api/v1/tasks/:id', async (request, reply) => {
    const id = idParam(request);
    const user = sessionUser(request);
    const orgId = await taskOrg(pool, user.id, id);
    await withTenant(pool, orgId, async (c) => {
      const prior = await c.query<TaskT>(
        `SELECT * FROM tasks WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [id],
      );
      if (prior.rows.length === 0) throw notFound();
      const before = prior.rows[0]!;
      await requirePermission(c, user.id, SUBJECT_PERMISSION[before.subject_type]);
      await c.query(`UPDATE tasks SET deleted_at = now() WHERE id = $1`, [id]);
      await recordEvent(c, {
        organizationId: orgId,
        storeId: before.store_id,
        actorUserId: user.id,
        entityType: 'task',
        entityId: id,
        action: 'deleted',
        parentEntityType: before.subject_type,
        parentEntityId: before.subject_id,
      });
    });
    return reply.status(204).send();
  });

  /**
   * Bulk (§3.2): a screenful of ids, only the ones still open actually
   * change, and `updated` says how many did. The caller's membership is
   * proven FIRST (review — a non-member could otherwise read a 200/404
   * difference as "is this uuid a task there?"), then permission for every
   * subject kind in the selection, then anything moves.
   */
  app.post('/api/v1/tasks/bulk/complete', async (request, reply) => {
    const input = parseOrThrow(BulkCompleteTasksInput, request.body);
    const user = sessionUser(request);
    const orgId = input.organization_id;
    const result = await withTenant(pool, orgId, async (c) => {
      // The deny-by-default gate for a body-supplied organization_id (review):
      // withTenant sets the tenant context for WHOEVER asks, so the caller's
      // membership is proven before any query whose outcome could differ by
      // what exists in that tenant.
      await requireMember(c, user.id);
      const kinds = await c.query<{ subject_type: TaskSubjectTypeT }>(
        `SELECT DISTINCT subject_type FROM tasks
         WHERE organization_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`,
        [orgId, input.task_ids],
      );
      for (const k of kinds.rows) await requirePermission(c, user.id, SUBJECT_PERMISSION[k.subject_type]);
      const r = await c.query<TaskT & { was: string }>(
        `UPDATE tasks t SET status = 'completed', completed_at = now()
         FROM (SELECT id, status AS was FROM tasks
               WHERE organization_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL
                 AND status IN ${OPEN}) p
         WHERE t.id = p.id
         RETURNING t.*, p.was`,
        [orgId, input.task_ids],
      );
      for (const t of r.rows) {
        await recordEvent(c, {
          organizationId: orgId,
          storeId: t.store_id,
          actorUserId: user.id,
          entityType: 'task',
          entityId: t.id,
          action: 'task_completed',
          parentEntityType: t.subject_type,
          parentEntityId: t.subject_id,
          changes: { status: { from: t.was, to: 'completed' } },
        });
      }
      return { updated: r.rows.length };
    });
    return reply.send(result);
  });

  app.post('/api/v1/tasks/bulk/reassign', async (request, reply) => {
    const input = parseOrThrow(BulkReassignTasksInput, request.body);
    const user = sessionUser(request);
    const orgId = input.organization_id;
    const result = await withTenant(pool, orgId, async (c) => {
      // The deny-by-default gate for a body-supplied organization_id (review):
      // withTenant sets the tenant context for WHOEVER asks, so the caller's
      // membership is proven before any query whose outcome could differ by
      // what exists in that tenant.
      await requireMember(c, user.id);
      const kinds = await c.query<{ subject_type: TaskSubjectTypeT }>(
        `SELECT DISTINCT subject_type FROM tasks
         WHERE organization_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`,
        [orgId, input.task_ids],
      );
      for (const k of kinds.rows) await requirePermission(c, user.id, SUBJECT_PERMISSION[k.subject_type]);
      await requireActiveMember(c, orgId, input.assigned_to, 'assigned_to');
      const r = await c.query<TaskT & { was: string | null }>(
        `UPDATE tasks t SET assigned_to = $3
         FROM (SELECT id, assigned_to AS was FROM tasks
               WHERE organization_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL
                 AND status IN ${OPEN} AND assigned_to IS DISTINCT FROM $3) p
         WHERE t.id = p.id
         RETURNING t.*, p.was`,
        [orgId, input.task_ids, input.assigned_to],
      );
      for (const t of r.rows) {
        await recordEvent(c, {
          organizationId: orgId,
          storeId: t.store_id,
          actorUserId: user.id,
          entityType: 'task',
          entityId: t.id,
          action: 'assigned',
          parentEntityType: t.subject_type,
          parentEntityId: t.subject_id,
          changes: { assigned_to: { from: t.was, to: input.assigned_to } },
        });
      }
      return { updated: r.rows.length };
    });
    return reply.send(result);
  });
}
