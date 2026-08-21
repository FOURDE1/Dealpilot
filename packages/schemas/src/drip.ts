import { z } from 'zod';
import { CursorQuery, IsoDateTime, Uuid } from './common.js';

/**
 * F-61 — drip sequences (automation-notifications.md §11). Tenant config:
 * WHAT to send a lead after a trigger, on WHICH days. The engine (core/drip)
 * decides when a step is due; the compliance gate decides whether it may go.
 */

/**
 * Steps sorted by day, no duplicate days — the engine indexes them in order.
 * Bodies are an FR/EN PAIR by construction (ADR-019, Bill 96 — French is
 * required, never the nullable afterthought); the engine picks by the
 * conversation's language. Bodies carry §12's drip merge fields:
 * {{first_name}} {{last_name}} {{vehicle}} {{salesperson}} {{store_name}}
 * {{store_phone}}.
 */
export const DripSteps = z
  .array(
    z.strictObject({
      day: z.number().int().min(0).max(365),
      body_fr: z.string().trim().min(10).max(480),
      body_en: z.string().trim().min(10).max(480),
    }),
  )
  .min(1)
  .max(20)
  .refine(
    (steps) => steps.every((s, i) => i === 0 || s.day > steps[i - 1]!.day),
    { message: 'steps must be in strictly ascending day order' },
  );

export const DripTriggerEvent = z.enum(['lead.lost', 'lead.unresponsive', 'delivery.completed']);

/** The only condition key today; strictObject so a typo cannot silently match everything. */
export const DripTriggerCondition = z.strictObject({
  lost_reason: z.string().trim().min(1).max(80).optional(),
});

export const DripSequence = z.object({
  id: Uuid,
  organization_id: Uuid,
  /** NULL = org-wide; a store row narrows enrollment to that store's leads. */
  store_id: Uuid.nullable(),
  name: z.string(),
  trigger_event: DripTriggerEvent,
  trigger_condition: DripTriggerCondition,
  steps: DripSteps,
  duration_days: z.number().int(),
  scope: z.enum(['conversational', 'marketing']),
  active: z.boolean(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});

export const CreateDripSequenceInput = z.strictObject({
  organization_id: Uuid,
  store_id: Uuid.nullable().optional(),
  name: z.string().trim().min(1).max(80),
  trigger_event: DripTriggerEvent,
  trigger_condition: DripTriggerCondition.default({}),
  steps: DripSteps,
  duration_days: z.coerce.number().int().min(1).max(365),
  scope: z.enum(['conversational', 'marketing']).default('conversational'),
});

// No .default() anywhere: a defaulted field would inject into every PATCH
// and silently overwrite stored config (the defaults-leak regression).
export const UpdateDripSequenceInput = z
  .strictObject({
    name: z.string().trim().min(1).max(80).optional(),
    trigger_condition: DripTriggerCondition.optional(),
    steps: DripSteps.optional(),
    duration_days: z.coerce.number().int().min(1).max(365).optional(),
    scope: z.enum(['conversational', 'marketing']).optional(),
    // JSON body, not a query string: a real boolean (the enum-transform
    // pattern is for query params, where 'false' would coerce truthy).
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'empty update' });

export const DripEnrollmentStatus = z.enum([
  'active', 'completed', 'opted_out', 'expired', 'reactivated',
]);

export const DripEnrollment = z.object({
  id: Uuid,
  organization_id: Uuid,
  store_id: Uuid.nullable(),
  drip_sequence_id: Uuid,
  lead_id: Uuid,
  conversation_id: Uuid.nullable(),
  status: DripEnrollmentStatus,
  current_step: z.number().int(),
  enrolled_at: IsoDateTime,
  expires_at: IsoDateTime,
  last_message_sent_at: IsoDateTime.nullable(),
  opted_out_at: IsoDateTime.nullable(),
  reactivated_at: IsoDateTime.nullable(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});

export const ListDripSequencesQuery = CursorQuery.extend({
  organization_id: Uuid.optional(),
  store_id: Uuid.optional(),
  /** House boolean (appointment.ts): z.coerce.boolean would read "false" as true. */
  include_inactive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const ListDripEnrollmentsQuery = CursorQuery.extend({
  organization_id: Uuid.optional(),
  lead_id: Uuid.optional(),
  status: DripEnrollmentStatus.optional(),
});

export type DripStepT = z.infer<typeof DripSteps>[number];
export type DripSequenceT = z.infer<typeof DripSequence>;
export type CreateDripSequenceInputT = z.infer<typeof CreateDripSequenceInput>;
export type UpdateDripSequenceInputT = z.infer<typeof UpdateDripSequenceInput>;
export type DripEnrollmentT = z.infer<typeof DripEnrollment>;
