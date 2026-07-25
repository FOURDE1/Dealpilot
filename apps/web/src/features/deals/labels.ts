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

export const DEAL_STATUS_KEYS = {
  working: 'status_working',
  submitted: 'status_submitted',
  approved: 'status_approved',
  funded: 'status_funded',
  delivered: 'status_delivered',
  lost: 'status_lost',
} as const satisfies Record<DealT['status'], string>;
