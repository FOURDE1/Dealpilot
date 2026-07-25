import { z } from 'zod';
import { CursorQuery, IsoDateTime, MESSAGE_KEYS, NonNegativeCents, Uuid, withKey } from './common.js';

/**
 * F-07 inventory — the cars a store owns. Vocabularies are exact per
 * inventory.md §4, with TWO independent status tracks: `location_status`
 * (where the car physically is) and `deal_status` (whether it is spoken for).
 * A car can be `on_lot` and `sold_pending` at the same time, which is the
 * normal state between signing and delivery.
 */
export const VehicleType = z.enum(['new', 'used']);

export const AcquisitionType = z.enum([
  'auction', 'dealer_trade', 'trade_in', 'internal_wholesale', 'consignment',
]);

export const LocationStatus = z.enum([
  'at_source', 'in_transit', 'on_lot', 'at_garage', 'delivered', 'wholesale',
]);

export const VehicleDealStatus = z.enum([
  'available', 'reserved', 'sold_pending', 'delivered', 'wholesale',
]);

/** 17 characters; I, O and Q are not in the VIN alphabet. */
export const Vin = z
  .string()
  .trim()
  .toUpperCase()
  .refine((v) => /^[A-HJ-NPR-Z0-9]{17}$/.test(v), withKey(MESSAGE_KEYS.vin_format));

const stockNumber = z.string().trim().min(1).max(30);
const shortText = (max: number) => z.string().trim().min(1).max(max);

export const Vehicle = z.object({
  id: Uuid,
  organization_id: Uuid,
  store_id: Uuid,
  stock_number: stockNumber,
  vin: Vin.nullable(),
  year: z.number().int().min(1900).max(2100),
  make: shortText(60),
  model: shortText(60),
  trim: shortText(60).nullable(),
  exterior_color: shortText(40).nullable(),
  mileage_km: z.number().int().min(0).nullable(),
  vehicle_type: VehicleType,
  acquisition_type: AcquisitionType,
  /** Date only (YYYY-MM-DD) — the day the car was bought, not a timestamp. */
  acquisition_date: z.iso.date(),
  acquisition_cost_cents: NonNegativeCents,
  transport_cost_cents: NonNegativeCents,
  recon_cost_cents: NonNegativeCents,
  list_price_cents: NonNegativeCents.nullable(),
  location_status: LocationStatus,
  deal_status: VehicleDealStatus,
  location_details: shortText(200).nullable(),
  /** Derived: what the car actually cost to put on the lot (server-computed). */
  total_cost_cents: z.number().int(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
  deleted_at: IsoDateTime.nullable(),
});

export const CreateVehicleInput = z.strictObject({
  organization_id: Uuid,
  store_id: Uuid,
  stock_number: stockNumber,
  vin: Vin.optional(),
  year: z.number().int().min(1900).max(2100),
  make: shortText(60),
  model: shortText(60),
  trim: shortText(60).optional(),
  exterior_color: shortText(40).optional(),
  mileage_km: z.number().int().min(0).optional(),
  vehicle_type: VehicleType.default('used'),
  acquisition_type: AcquisitionType,
  acquisition_date: z.iso.date().optional(),
  acquisition_cost_cents: NonNegativeCents.default(0),
  transport_cost_cents: NonNegativeCents.default(0),
  recon_cost_cents: NonNegativeCents.default(0),
  list_price_cents: NonNegativeCents.optional(),
  location_status: LocationStatus.default('on_lot'),
  location_details: shortText(200).optional(),
});

/** Defaults-free by construction (the F-05 lesson): a PATCH carries only what it changes. */
export const UpdateVehicleInput = z.strictObject({
  stock_number: stockNumber.optional(),
  vin: Vin.nullable().optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  make: shortText(60).optional(),
  model: shortText(60).optional(),
  trim: shortText(60).nullable().optional(),
  exterior_color: shortText(40).nullable().optional(),
  mileage_km: z.number().int().min(0).nullable().optional(),
  vehicle_type: VehicleType.optional(),
  acquisition_type: AcquisitionType.optional(),
  acquisition_date: z.iso.date().optional(),
  acquisition_cost_cents: NonNegativeCents.optional(),
  transport_cost_cents: NonNegativeCents.optional(),
  recon_cost_cents: NonNegativeCents.optional(),
  list_price_cents: NonNegativeCents.nullable().optional(),
  location_status: LocationStatus.optional(),
  deal_status: VehicleDealStatus.optional(),
  location_details: shortText(200).nullable().optional(),
});

export const VehicleListQuery = CursorQuery.extend({
  organization_id: Uuid.optional(),
  store_id: Uuid.optional(),
  deal_status: VehicleDealStatus.optional(),
  location_status: LocationStatus.optional(),
});

export type VehicleT = z.infer<typeof Vehicle>;
export type CreateVehicleInputT = z.infer<typeof CreateVehicleInput>;
export type UpdateVehicleInputT = z.infer<typeof UpdateVehicleInput>;
