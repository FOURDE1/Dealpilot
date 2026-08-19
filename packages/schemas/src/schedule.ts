import { z } from 'zod';
import { CursorQuery, IsoDateTime, Uuid } from './common.js';

/**
 * F-42 — staff schedules (FR-LEAD-015) and the cascade vocabulary
 * (FR-LEAD-009). The weekly grid feeds §7.3 step 3; times are HH:MM in the
 * row's STORE timezone, because a TIME means nothing without one.
 */

/** 'HH:MM', 24h. Seconds are the database's business, not the API's. */
export const TimeOfDay = z
  .string()
  .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'expected HH:MM (24h)');

export const StaffSchedule = z.object({
  id: Uuid,
  organization_id: Uuid,
  store_id: Uuid,
  user_id: Uuid,
  /** 0 = Sunday … 6 = Saturday, matching EXTRACT(DOW). */
  day_of_week: z.number().int().min(0).max(6),
  // The API speaks HH:MM in BOTH directions — routes trim pg's 'HH:MM:SS'
  // before it leaves (2026-08-19 review: a loose z.string() here papered
  // over that drift).
  start_time: TimeOfDay,
  end_time: TimeOfDay,
  active: z.boolean(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});

export const CreateStaffScheduleInput = z
  .strictObject({
    organization_id: Uuid,
    store_id: Uuid,
    user_id: Uuid,
    day_of_week: z.number().int().min(0).max(6),
    start_time: TimeOfDay,
    end_time: TimeOfDay,
    active: z.boolean().default(true),
  })
  .refine((v) => v.end_time > v.start_time, {
    message: 'end_time must be after start_time (same-day windows; a split shift is two rows)',
    path: ['end_time'],
  });

export const UpdateStaffScheduleInput = z
  .strictObject({
    day_of_week: z.number().int().min(0).max(6).optional(),
    start_time: TimeOfDay.optional(),
    end_time: TimeOfDay.optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to change' })
  .refine((v) => !(v.start_time && v.end_time) || v.end_time > v.start_time, {
    message: 'end_time must be after start_time',
    path: ['end_time'],
  });

export const StaffScheduleListQuery = CursorQuery.extend({
  organization_id: Uuid.optional(),
  user_id: Uuid.optional(),
  store_id: Uuid.optional(),
});

/** Target vocabulary (leads.md:41) — lockstep with core and the 0049 CHECK. */
export const AssignmentMethod = z.enum([
  'auto_language',
  'auto_availability',
  'manual',
  'escalation',
  'reassignment',
]);

/** Mirrors core's CASCADE_REFUSALS — lockstep-tested, never imported. */
export const CascadeRefusal = z.enum([
  'no_candidates',
  'no_language_match',
  'nobody_online',
  'nobody_scheduled',
  'all_at_capacity',
]);

/** The §7.3 decision as the API returns it — refusals are values, not errors. */
export const CascadeAssignResult = z.union([
  z.object({
    outcome: z.literal('assigned'),
    user_id: Uuid,
    method: z.enum(['auto_language', 'auto_availability']),
  }),
  z.object({
    outcome: z.literal('escalated'),
    user_id: Uuid,
    method: z.literal('escalation'),
    reason: CascadeRefusal,
  }),
  z.object({ outcome: z.literal('no_one'), reason: CascadeRefusal }),
  z.object({ outcome: z.literal('already_assigned'), lead_id: Uuid }),
]);

export const ScheduleTodayItem = z.object({
  user_id: Uuid,
  working_now: z.boolean(),
  windows: z.array(z.object({ store_id: Uuid, start_time: TimeOfDay, end_time: TimeOfDay })),
});

export type StaffScheduleT = z.infer<typeof StaffSchedule>;
export type CascadeAssignResultT = z.infer<typeof CascadeAssignResult>;
export type CreateStaffScheduleInputT = z.infer<typeof CreateStaffScheduleInput>;
export type UpdateStaffScheduleInputT = z.infer<typeof UpdateStaffScheduleInput>;
export type AssignmentMethodT = z.infer<typeof AssignmentMethod>;
