import type { TaskBucketT, TaskPriorityT, TaskStatusT, TaskSubjectTypeT, TaskTypeT } from '@dealpilot/schemas';

/**
 * Typed label keys — the i18n resource types refuse a template-literal
 * key, and a map that `satisfies Record<Enum, …>` fails to compile the day
 * the vocabulary grows without its label.
 */

export const PRIORITY_KEYS = {
  low: 'priority_low',
  medium: 'priority_medium',
  high: 'priority_high',
  urgent: 'priority_urgent',
} as const satisfies Record<TaskPriorityT, string>;

/**
 * Color is the glance; the label is the fact — every chip carries both. Only
 * pairs the contrast gate covers (packages/ui/src/theme/contrast.test.ts):
 * status text on its own tint, or foreground on muted.
 */
export const PRIORITY_CLASSES = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-muted text-foreground',
  high: 'bg-warning-bg text-warning-text',
  urgent: 'bg-danger-bg text-danger-text font-semibold',
} as const satisfies Record<TaskPriorityT, string>;

export const STATUS_KEYS = {
  pending: 'status_pending',
  in_progress: 'status_in_progress',
  completed: 'status_completed',
  cancelled: 'status_cancelled',
} as const satisfies Record<TaskStatusT, string>;

export const TYPE_KEYS = {
  follow_up: 'type_follow_up',
  call: 'type_call',
  email: 'type_email',
  meeting: 'type_meeting',
  test_drive: 'type_test_drive',
  appointment: 'type_appointment',
  delivery: 'type_delivery',
  other: 'type_other',
} as const satisfies Record<TaskTypeT, string>;

export const SUBJECT_KEYS = {
  lead: 'subject_lead',
  deal: 'subject_deal',
  contact: 'subject_contact',
  vehicle: 'subject_vehicle',
} as const satisfies Record<TaskSubjectTypeT, string>;

export const BUCKET_KEYS = {
  overdue: 'bucket_overdue',
  today: 'bucket_today',
  week: 'bucket_week',
  later: 'bucket_later',
  undated: 'bucket_undated',
} as const satisfies Record<TaskBucketT, string>;

export const BUCKET_CLASSES = {
  overdue: 'bg-danger-bg text-danger-text font-semibold',
  today: 'bg-warning-bg text-warning-text font-medium',
  week: 'bg-muted text-foreground',
  later: 'bg-muted text-muted-foreground',
  undated: 'bg-muted text-muted-foreground',
} as const satisfies Record<TaskBucketT, string>;

/** Where a task's subject lives in the app; null when no screen exists yet. */
export function subjectHref(subjectType: TaskSubjectTypeT, subjectId: string): string | null {
  switch (subjectType) {
    case 'lead':
      return `/leads/${subjectId}`;
    case 'contact':
      return `/contacts/${subjectId}`;
    case 'vehicle':
      return `/inventory/${subjectId}`;
    case 'deal':
      return null;
  }
}

/** Tomorrow 09:00 local, as a datetime-local input value (leads.md §10.1). */
export function tomorrowAtNine(now = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
