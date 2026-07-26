import { z } from 'zod';
import { CursorQuery, IsoDateTime, Uuid } from './common.js';

/**
 * F-11 dispatch / transport (dispatch-transport.md). Sending drivers, a dealer
 * plate and — when there is no trade-in to drive back — a chaser car.
 */

export const FleetStatus = z.enum(['available', 'in_use']);

/**
 * ONE lifecycle (ADR-009). Legacy carried `status` and `dispatch_status` in
 * parallel and they drifted; legacy `in_transit` is `departed` here.
 */
export const DispatchStatus = z.enum([
  // No 'pending': a run is created assigned, because booking IS the assignment.
  // A value no code path can produce is a promise the vocabulary does not keep.
  'assigned', 'departed', 'arrived', 'completed', 'cancelled',
]);

export const DispatchCompany = z.enum(['supreme', 'denises_guys']);

export const ChaserVehicle = z.object({
  id: Uuid,
  organization_id: Uuid,
  store_id: Uuid,
  name: z.string(),
  status: FleetStatus,
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});

export const CreateChaserInput = z.strictObject({
  organization_id: Uuid,
  store_id: Uuid,
  name: z.string().trim().min(1).max(80),
});

/**
 * `status` is NOT writable: it is derived from whether a run has departed. A
 * hand-set status was the back door that let a plate be marked available while
 * a driver still had it, and in-use with nothing holding it.
 */
export const UpdateChaserInput = z.strictObject({
  name: z.string().trim().min(1).max(80).optional(),
});

export const DealerPlate = z.object({
  id: Uuid,
  organization_id: Uuid,
  store_id: Uuid,
  plate_number: z.string(),
  status: FleetStatus,
  assigned_chaser_id: Uuid.nullable(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});

export const CreatePlateInput = z.strictObject({
  organization_id: Uuid,
  store_id: Uuid,
  plate_number: z.string().trim().min(2).max(12),
});

/** `status` is derived from the run, not set by hand — see UpdateChaserInput. */
export const UpdatePlateInput = z.strictObject({
  plate_number: z.string().trim().min(2).max(12).optional(),
});

export const DispatchAssignment = z.object({
  id: Uuid,
  organization_id: Uuid,
  store_id: Uuid,
  deal_id: Uuid,
  chaser_vehicle_id: Uuid.nullable(),
  dealer_plate_id: Uuid.nullable(),
  /** Snapshot of the rule's inputs, so the assignment stays explainable. */
  has_trade_in: z.boolean(),
  num_drivers_needed: z.number().int(),
  dispatch_company: DispatchCompany.nullable(),
  status: DispatchStatus,
  /** A conflict flags for review — it never blocks the booking. */
  conflict_flag: z.boolean(),
  conflict_reason: z.string().nullable(),
  driver_name: z.string().nullable(),
  driver_phone: z.string().nullable(),
  driver_vehicle: z.string().nullable(),
  eta_departure: IsoDateTime.nullable(),
  eta_arrival: IsoDateTime.nullable(),
  actual_departure: IsoDateTime.nullable(),
  actual_arrival: IsoDateTime.nullable(),
  customer_notified_at: IsoDateTime.nullable(),
  assigned_at: IsoDateTime.nullable(),
  completed_at: IsoDateTime.nullable(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});

/** Book a run for a deal. Resources are chosen by the server, not the caller. */
export const CreateDispatchInput = z.strictObject({
  deal_id: Uuid,
  /**
   * When the customer is expecting the car. Falls back to the deal's
   * booked_delivery_at; one of the two must exist or there is nothing to
   * schedule against and no conflict can be computed.
   */
  booked_delivery_at: IsoDateTime.optional(),
  dispatch_company: DispatchCompany.optional(),
});

/** Defaults-free (the F-05 lesson): a PATCH carries only what it changes. */
export const UpdateDispatchInput = z.strictObject({
  status: DispatchStatus.optional(),
  dispatch_company: DispatchCompany.nullable().optional(),
  driver_name: z.string().trim().min(1).max(120).nullable().optional(),
  driver_phone: z.string().trim().min(1).max(40).nullable().optional(),
  driver_vehicle: z.string().trim().min(1).max(120).nullable().optional(),
  eta_departure: IsoDateTime.nullable().optional(),
  eta_arrival: IsoDateTime.nullable().optional(),
});

export const DispatchListQuery = CursorQuery.extend({
  organization_id: Uuid.optional(),
  store_id: Uuid.optional(),
  status: DispatchStatus.optional(),
  /**
   * The logistics dashboard's one job: what needs a human. NOT z.coerce.boolean
   * — that turns the string "false" into true, so `?conflicts_only=false` would
   * have hidden every clean run.
   */
  conflicts_only: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

export const FleetListQuery = CursorQuery.extend({
  organization_id: Uuid.optional(),
  store_id: Uuid.optional(),
  status: FleetStatus.optional(),
});

export type DispatchAssignmentT = z.infer<typeof DispatchAssignment>;
export type ChaserVehicleT = z.infer<typeof ChaserVehicle>;
export type DealerPlateT = z.infer<typeof DealerPlate>;
