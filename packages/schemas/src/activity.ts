import { z } from 'zod';
import { CursorQuery, IsoDateTime, Uuid } from './common.js';

/**
 * F-10 activity trail (ADR-009): every state change, append-only, tenant-scoped.
 * The vocabulary is closed on purpose — an audit log whose verbs anyone can
 * invent at runtime cannot be filtered, translated, or reported on.
 */
export const ActivityEntityType = z.enum([
  'deal', 'lead', 'vehicle', 'membership', 'pay_plan', 'checklist_item',
  'checklist_template', 'intake_key', 'invitation', 'organization', 'store',
]);

export const ActivityAction = z.enum([
  'created', 'updated', 'deleted',
  'stage_changed', 'funding_changed', 'delivered',
  'assigned', 'unassigned',
  'checklist_completed', 'checklist_uncompleted', 'checklist_waived', 'checklist_unwaived',
  'roles_changed', 'revoked', 'reinstated',
]);

export const ActivityEvent = z.object({
  id: Uuid,
  organization_id: Uuid,
  store_id: Uuid.nullable(),
  /** NULL means the system acted — an intake webhook or a scheduled job. */
  actor_user_id: Uuid.nullable(),
  entity_type: ActivityEntityType,
  entity_id: Uuid,
  action: ActivityAction,
  /** {"field": {"from": x, "to": y}} */
  changes: z.record(z.string(), z.unknown()),
  reason: z.string().nullable(),
  created_at: IsoDateTime,
});

export const ActivityListQuery = CursorQuery.extend({
  organization_id: Uuid.optional(),
  entity_type: ActivityEntityType.optional(),
  entity_id: Uuid.optional(),
  actor_user_id: Uuid.optional(),
});

export type ActivityEventT = z.infer<typeof ActivityEvent>;
export type ActivityActionT = z.infer<typeof ActivityAction>;
export type ActivityEntityTypeT = z.infer<typeof ActivityEntityType>;
