import { ProvinceCA, type DealT } from '@dealpilot/schemas';

export const PROVINCE_KEYS = {
  AB: 'province_AB',
  BC: 'province_BC',
  MB: 'province_MB',
  NB: 'province_NB',
  NL: 'province_NL',
  NS: 'province_NS',
  NT: 'province_NT',
  NU: 'province_NU',
  ON: 'province_ON',
  PE: 'province_PE',
  QC: 'province_QC',
  SK: 'province_SK',
  YT: 'province_YT',
} as const satisfies Record<(typeof ProvinceCA.options)[number], string>;

export const DEAL_TYPE_KEYS = {
  finance: 'dealType_finance',
  lease: 'dealType_lease',
  cash: 'dealType_cash',
} as const satisfies Record<DealT['deal_type'], string>;

export const PIPELINE_STAGE_KEYS = {
  new: 'stage_new',
  submitted: 'stage_submitted',
  approved: 'stage_approved',
  signed: 'stage_signed',
  sourcing: 'stage_sourcing',
  pending_delivery: 'stage_pending_delivery',
  scheduled: 'stage_scheduled',
  delivered: 'stage_delivered',
  complete: 'stage_complete',
  lost: 'stage_lost',
} as const satisfies Record<DealT['pipeline_stage'], string>;

export const FUNDING_STATUS_KEYS = {
  not_submitted: 'funding_not_submitted',
  submitted: 'funding_submitted',
  stips_required: 'funding_stips_required',
  funded: 'funding_funded',
} as const satisfies Record<DealT['funding_status'], string>;
