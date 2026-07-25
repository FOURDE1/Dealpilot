import type { ChecklistTemplateT } from '@dealpilot/schemas';

/**
 * Canonical names for the pipeline's gate error only — the PANEL always uses
 * the server's per-store labels (a store may rename its items).
 */
export const CHECKLIST_CODE_KEYS = {
  insurance: 'code_insurance',
  void_cheque: 'code_void_cheque',
  funding: 'code_funding',
  idv: 'code_idv',
  safety: 'code_safety',
  vehicle_ready: 'code_vehicle_ready',
  wet_ink_file: 'code_wet_ink_file',
  delivery_date: 'code_delivery_date',
  drivers_booked: 'code_drivers_booked',
  registration: 'code_registration',
} as const satisfies Record<ChecklistTemplateT['code'], string>;
