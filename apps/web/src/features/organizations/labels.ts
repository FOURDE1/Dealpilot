import type { IntakeKeyT, OrganizationT } from '@dealpilot/schemas';

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

/**
 * The intake providers, labelled in the `intake` namespace. One map, read by
 * the tenant's intake-sources page and shared onward by the console's label
 * table (features/admin/labels.ts) — hoisted here so the console never
 * imports a page module to name a provider (F-77).
 */
export const PROVIDER_KEYS = {
  generic_json: 'provider_generic_json',
  fluent_form: 'provider_fluent_form',
  meta: 'provider_meta',
  adf_email: 'provider_adf_email',
  chat_widget: 'provider_chat_widget',
} as const satisfies Record<IntakeKeyT['provider'], string>;
