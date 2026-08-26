import type { OrganizationT } from '@dealpilot/schemas';

/** Typed label keys for the organization vocabulary (shared with the F-69 console). */
export const STATUS_KEYS = {
  active: 'status_active',
  trial: 'status_trial',
  past_due: 'status_past_due',
  read_only: 'status_read_only',
  suspended: 'status_suspended',
  offboarding: 'status_offboarding',
  purged: 'status_purged',
} as const satisfies Record<OrganizationT['status'], string>;

export const TIER_KEYS = {
  core: 'tier_core',
  growth: 'tier_growth',
  scale: 'tier_scale',
  enterprise: 'tier_enterprise',
} as const satisfies Record<OrganizationT['plan_tier'], string>;
