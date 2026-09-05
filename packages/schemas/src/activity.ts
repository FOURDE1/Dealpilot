import { z } from 'zod';
import { CursorQuery, IsoDateTime, Uuid } from './common.js';

/**
 * F-10 activity trail (ADR-009): every state change, append-only, tenant-scoped.
 * The vocabulary is closed on purpose — an audit log whose verbs anyone can
 * invent at runtime cannot be filtered, translated, or reported on.
 */
export const ActivityEntityType = z.enum([
  'deal', 'lead', 'vehicle', 'membership', 'pay_plan', 'checklist_item',
  'checklist_template', 'intake_key', 'invitation', 'dispatch_assignment',
  'deal_document', 'deal_fi_product', 'tenant_branding', 'consent', 'suppression', 'internal_dnc',
  'conversation', 'appointment', 'contact',
  'organization', 'store',
  /** F-68: a follow-up; parent = its subject, so a lead's trail shows its tasks. */
  'task',
  /**
   * F-71 (admin-console.md §7): a support session opened/ended on the tenant.
   * Written by the 0067 definers only — see SQL_PRODUCED_ENTITIES in
   * apps/api/src/f10-activity.test.ts.
   */
  'impersonation_session',
  /**
   * F-79: a flagged/confirmed commission reversal; parent = its deal, so the
   * deal's timeline shows it. Events carry STATUS ONLY, never amounts —
   * activity:read is floor-wide and pay stays behind commission:read_all.
   */
  'commission_clawback',
  /**
   * F-81 (lenders-billofsale.md §2): a lender submission on a deal; parent =
   * its deal, so the deal's timeline shows what each lender answered.
   * Actions REUSED only — 'created' on POST, 'updated' on PATCH and on the
   * selection flip (the chosen row AND the deselected sibling each get their
   * own); the promotion itself lands in the DEAL's 'updated' diff with
   * via:'submission_selected'. No new verb.
   */
  'deal_submission',
  /**
   * F-82 (expenses-accounting.md §2): a logged vehicle expense; parent = its
   * vehicle, so the car's timeline shows what was spent on it. Actions REUSED
   * only — 'created' on log, 'updated' on the ladder, a field edit and a
   * receipt. Events carry STATUS and facts ONLY, never an amount (F-79's
   * rule: activity:read is floor-wide and cost is masked) — amounts are
   * immutable after INSERT, so no diff can ever carry one.
   */
  'vehicle_expense',
]);

export const ActivityAction = z.enum([
  'created', 'updated', 'deleted',
  'stage_changed', 'funding_changed', 'delivered',
  'assigned', 'unassigned',
  'checklist_completed', 'checklist_uncompleted', 'checklist_waived', 'checklist_unwaived',
  'roles_changed', 'revoked', 'reinstated',
  /** Two customer records folded into one (FR-CON-003). */
  'merged',
  /** A lost lead enrolled in a nurture sequence (automation-notifications.md §11). */
  'drip_enrolled',
  /** A task closed by a person (the legacy logged this exact name — §3.1). */
  'task_completed',
]);

/**
 * F-69 (admin-console.md §12): who acted — a tenant member, platform staff,
 * or the system. 'ai' joins when its first producer does (dead-vocabulary rule).
 */
export const ActivityActorType = z.enum(['tenant', 'platform', 'system']);

export const ActivityEvent = z.object({
  id: Uuid,
  organization_id: Uuid,
  store_id: Uuid.nullable(),
  /** NULL means the system acted — an intake webhook or a scheduled job. */
  actor_user_id: Uuid.nullable(),
  actor_type: ActivityActorType,
  /** §12: a suspended-investigation event the tenant must not see. */
  restricted: z.boolean(),
  entity_type: ActivityEntityType,
  entity_id: Uuid,
  action: ActivityAction,
  /** {"field": {"from": x, "to": y}} */
  changes: z.record(z.string(), z.unknown()),
  reason: z.string().nullable(),
  /** Set when this happened under something else — a checklist item's deal. */
  parent_entity_type: ActivityEntityType.nullable(),
  parent_entity_id: Uuid.nullable(),
  /** F-71 §7/§12: the support session this act happened UNDER (actor_user_id is the impersonated user). */
  impersonation_id: Uuid.nullable(),
  created_at: IsoDateTime,
});

export const ActivityListQuery = CursorQuery.extend({
  organization_id: Uuid.optional(),
  entity_type: ActivityEntityType.optional(),
  entity_id: Uuid.optional(),
  actor_user_id: Uuid.optional(),
});

export type ActivityEventT = z.infer<typeof ActivityEvent>;
export type ActivityActorTypeT = z.infer<typeof ActivityActorType>;
export type ActivityActionT = z.infer<typeof ActivityAction>;
export type ActivityEntityTypeT = z.infer<typeof ActivityEntityType>;
