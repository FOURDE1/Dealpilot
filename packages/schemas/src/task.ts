import { z } from 'zod';
import { IsoDateTime, Uuid } from './common.js';

/**
 * Tasks (F-68, appointments-tasks-communications.md §3.3) — the unified,
 * polymorphic task system that replaces the legacy's two disagreeing tables.
 *
 * The shapes mirror the 0064 CHECKs exactly. The subject is `lead | deal |
 * contact | vehicle` — the spec's `inventory` spelled the way every other
 * vocabulary here already spells that row.
 */

export const TaskSubjectType = z.enum(['lead', 'deal', 'contact', 'vehicle']);
export const TaskType = z.enum([
  'follow_up', 'call', 'email', 'meeting', 'test_drive', 'appointment', 'delivery', 'other',
]);
export const TaskPriority = z.enum(['low', 'medium', 'high', 'urgent']);
export const TaskStatus = z.enum(['pending', 'in_progress', 'completed', 'cancelled']);
export const TaskSource = z.enum([
  'manual', 'appointment_no_show', 'appointment_showed_no_deal', 'workflow_step', 'ai_suggested',
]);
/**
 * Where an OPEN task sits relative to the store's clock (leads.md §10.1):
 * overdue = due before now; today = due on the store's calendar date;
 * week = within seven days; later; undated. Computed server-side, per
 * task, in that task's store timezone — "due today" is the store's today.
 */
export const TaskBucket = z.enum(['overdue', 'today', 'week', 'later', 'undated']);

/** Open = still needs somebody. The board's default filter. */
export const OPEN_TASK_STATUSES = ['pending', 'in_progress'] as const satisfies readonly z.infer<typeof TaskStatus>[];

export const Task = z.object({
  id: Uuid,
  organization_id: Uuid,
  store_id: Uuid,
  subject_type: TaskSubjectType,
  subject_id: Uuid,
  title: z.string(),
  description: z.string().nullable(),
  task_type: TaskType,
  priority: TaskPriority,
  status: TaskStatus,
  source: TaskSource,
  due_at: IsoDateTime.nullable(),
  assigned_to: Uuid.nullable(),
  appointment_id: Uuid.nullable(),
  completed_at: IsoDateTime.nullable(),
  /** The overdue sweep's stamps — read-only from the API's side. */
  overdue_notified_at: IsoDateTime.nullable(),
  escalated_at: IsoDateTime.nullable(),
  created_by: Uuid.nullable(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
  deleted_at: IsoDateTime.nullable(),
  /** Null once the task is closed — a finished task is in no bucket. */
  bucket: TaskBucket.nullable(),
  /** The subject's display name (lead/contact name, vehicle, the deal's lead) — computed, never stored. */
  subject_label: z.string().nullable(),
});

export const TaskListQuery = z.object({
  organization_id: Uuid.optional(),
  store_id: Uuid.optional(),
  subject_type: TaskSubjectType.optional(),
  subject_id: Uuid.optional(),
  assigned_to: Uuid.optional(),
  /** An explicit status wins over `open`. */
  status: TaskStatus.optional(),
  /**
   * Default true: the board is for what still needs doing. History stays
   * reachable by asking for it. Strings on the wire — see the appointment
   * schema's note on the z.coerce.boolean trap.
   */
  open: z.enum(['true', 'false']).transform((v) => v === 'true').default(true),
  bucket: TaskBucket.optional(),
});

export const TaskListPage = z.object({
  items: z.array(Task),
  /** The board is bounded (200), never silently cut — F-38's precedent. */
  truncated: z.boolean(),
});

export const TaskSummaryQuery = z.object({
  organization_id: Uuid.optional(),
  store_id: Uuid.optional(),
  assigned_to: Uuid.optional(),
});

/** The FollowUpAlertBar's numbers (leads.md §10.1): open tasks per bucket. */
export const TaskSummary = z.object({
  overdue: z.number().int(),
  today: z.number().int(),
  week: z.number().int(),
  later: z.number().int(),
  undated: z.number().int(),
  total_open: z.number().int(),
});

export const CreateTaskInput = z.strictObject({
  organization_id: Uuid,
  subject_type: TaskSubjectType,
  subject_id: Uuid,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(2000).optional(),
  task_type: TaskType.default('follow_up'),
  priority: TaskPriority.default('medium'),
  due_at: IsoDateTime.optional(),
  assigned_to: Uuid.optional(),
  /**
   * Derived from the subject when it has a store (leads, deals, vehicles
   * always do). Required only for a contact that belongs to no store.
   */
  store_id: Uuid.optional(),
});

export const UpdateTaskInput = z.strictObject({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).max(2000).nullable().optional(),
  task_type: TaskType.optional(),
  priority: TaskPriority.optional(),
  /** completed sets completed_at; leaving completed clears it (0064 CHECK). */
  status: TaskStatus.optional(),
  due_at: IsoDateTime.nullable().optional(),
  assigned_to: Uuid.nullable().optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'nothing to change' });

/** Bulk operations cap at 50 ids (§3.2) — a screenful, not a migration. */
export const BULK_TASK_LIMIT = 50;

export const BulkCompleteTasksInput = z.strictObject({
  organization_id: Uuid,
  task_ids: z.array(Uuid).min(1).max(BULK_TASK_LIMIT),
});

export const BulkReassignTasksInput = z.strictObject({
  organization_id: Uuid,
  task_ids: z.array(Uuid).min(1).max(BULK_TASK_LIMIT),
  assigned_to: Uuid,
});

/** `updated` is the number of rows that actually changed, never the number asked. */
export const BulkTasksResult = z.object({ updated: z.number().int() });

export type TaskT = z.infer<typeof Task>;
export type TaskSubjectTypeT = z.infer<typeof TaskSubjectType>;
export type TaskTypeT = z.infer<typeof TaskType>;
export type TaskPriorityT = z.infer<typeof TaskPriority>;
export type TaskStatusT = z.infer<typeof TaskStatus>;
export type TaskSourceT = z.infer<typeof TaskSource>;
export type TaskBucketT = z.infer<typeof TaskBucket>;
export type TaskListQueryT = z.infer<typeof TaskListQuery>;
export type TaskSummaryT = z.infer<typeof TaskSummary>;
export type CreateTaskInputT = z.infer<typeof CreateTaskInput>;
export type UpdateTaskInputT = z.infer<typeof UpdateTaskInput>;
export type BulkCompleteTasksInputT = z.infer<typeof BulkCompleteTasksInput>;
export type BulkReassignTasksInputT = z.infer<typeof BulkReassignTasksInput>;
