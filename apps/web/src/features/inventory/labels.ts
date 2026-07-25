import type { VehicleT } from '@dealpilot/schemas';

export const LOCATION_STATUS_KEYS = {
  at_source: 'loc_at_source',
  in_transit: 'loc_in_transit',
  on_lot: 'loc_on_lot',
  at_garage: 'loc_at_garage',
  delivered: 'loc_delivered',
  wholesale: 'loc_wholesale',
} as const satisfies Record<VehicleT['location_status'], string>;

export const VEHICLE_DEAL_STATUS_KEYS = {
  available: 'vdeal_available',
  reserved: 'vdeal_reserved',
  sold_pending: 'vdeal_sold_pending',
  delivered: 'vdeal_delivered',
  wholesale: 'vdeal_wholesale',
} as const satisfies Record<VehicleT['deal_status'], string>;

export const VEHICLE_TYPE_KEYS = {
  new: 'vtype_new',
  used: 'vtype_used',
} as const satisfies Record<VehicleT['vehicle_type'], string>;

export const ACQUISITION_KEYS = {
  auction: 'acq_auction',
  dealer_trade: 'acq_dealer_trade',
  trade_in: 'acq_trade_in',
  internal_wholesale: 'acq_internal_wholesale',
  consignment: 'acq_consignment',
} as const satisfies Record<VehicleT['acquisition_type'], string>;

/** "2023 Kia Sportage EX" — the human name of a car everywhere in the UI. */
export function vehicleDisplayName(v: Pick<VehicleT, 'year' | 'make' | 'model' | 'trim'>): string {
  return [v.year, v.make, v.model, v.trim].filter(Boolean).join(' ');
}
