import { z } from 'zod';
import { CursorQuery, IsoDateTime, Uuid } from './common.js';

/**
 * Appointments (F-38, conversation-engine.md §4) — the console's side.
 *
 * The assistant has booked these since F-33; this is the vocabulary that lets a
 * PERSON see them, take one, and cancel one. The shapes mirror the 0037 table's
 * CHECKs exactly, so a value the database would refuse never survives parsing.
 */

export const AppointmentKind = z.enum(['test_drive', 'showroom_visit', 'phone_call']);
export const AppointmentStatus = z.enum(['booked', 'confirmed', 'completed', 'no_show', 'cancelled']);
export const AppointmentBookedBy = z.enum(['assistant', 'agent', 'customer']);

export const Appointment = z.object({
  id: Uuid,
  organization_id: Uuid,
  store_id: Uuid,
  lead_id: Uuid.nullable(),
  conversation_id: Uuid.nullable(),
  /** Who is expected to be there. Null until somebody takes it. */
  assigned_agent_id: Uuid.nullable(),
  kind: AppointmentKind,
  status: AppointmentStatus,
  starts_at: IsoDateTime,
  ends_at: IsoDateTime,
  /** Text, not a vehicle id — the booking must survive the vehicle being sold. */
  vehicle_stock_number: z.string().nullable(),
  booked_by: AppointmentBookedBy,
  notes: z.string().nullable(),
  cancelled_at: IsoDateTime.nullable(),
  cancelled_reason: z.string().nullable(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
  deleted_at: IsoDateTime.nullable(),
});

export const AppointmentListQuery = CursorQuery.extend({
  organization_id: Uuid.optional(),
  store_id: Uuid.optional(),
  lead_id: Uuid.optional(),
  status: AppointmentStatus.optional(),
  /**
   * Default true: the board is for what is COMING. History stays reachable by
   * asking for it, not by scrolling past it every morning.
   *
   * NOT z.coerce.boolean — that turns the STRING "false" into true (any
   * non-empty string is truthy), so `?upcoming=false` would have quietly kept
   * serving the upcoming board. dispatch.ts hit and documented the same trap;
   * this is the house pattern for booleans that arrive as query strings.
   */
  // Zod 4: the default on a transform pipe is the OUTPUT value — an absent
  // param short-circuits to `true` without parsing.
  upcoming: z.enum(['true', 'false']).transform((v) => v === 'true').default(true),
});

export const CreateAppointmentInput = z.strictObject({
  organization_id: Uuid,
  store_id: Uuid,
  lead_id: Uuid.optional(),
  kind: AppointmentKind,
  starts_at: IsoDateTime,
  ends_at: IsoDateTime,
  vehicle_stock_number: z.string().trim().min(1).max(30).optional(),
  notes: z.string().trim().min(1).max(1000).optional(),
}).refine((v) => new Date(v.ends_at) > new Date(v.starts_at), {
  message: 'ends_at must be after starts_at',
  path: ['ends_at'],
});

/**
 * What the console may change: who takes it, and how it went.
 *
 * `cancelled` is deliberately NOT in this enum — cancelling requires a reason
 * (the 0037 CHECK) and has its own endpoint, so the reason cannot be skipped by
 * routing around the field.
 */
export const UpdateAppointmentInput = z.strictObject({
  assigned_agent_id: Uuid.nullable().optional(),
  status: z.enum(['booked', 'confirmed', 'completed', 'no_show']).optional(),
  notes: z.string().trim().min(1).max(1000).nullable().optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'nothing to change' });

export const CancelAppointmentInput = z.strictObject({
  /** Required, and not a formality: the board shows WHY the slot went empty. */
  reason: z.string().trim().min(3).max(500),
});

export type AppointmentT = z.infer<typeof Appointment>;
export type AppointmentKindT = z.infer<typeof AppointmentKind>;
export type AppointmentStatusT = z.infer<typeof AppointmentStatus>;
export type CreateAppointmentInputT = z.infer<typeof CreateAppointmentInput>;
export type UpdateAppointmentInputT = z.infer<typeof UpdateAppointmentInput>;
export type CancelAppointmentInputT = z.infer<typeof CancelAppointmentInput>;
