import type {
  ActivityEntityTypeT,
  ImpersonationEndReasonT,
  ImpersonationModeT,
  OrganizationStatusT,
  PlatformCapabilityT,
  PlatformRoleT,
} from '@dealpilot/schemas';

/**
 * Typed label keys for the console — a map that `satisfies Record<Enum, …>`
 * fails to compile the day a vocabulary grows without its label.
 */

export const ROLE_KEYS = {
  platform_super_admin: 'role_platform_super_admin',
  platform_support: 'role_platform_support',
  platform_billing: 'role_platform_billing',
} as const satisfies Record<PlatformRoleT, string>;

export const CAPABILITY_KEYS = {
  'tenants:read': 'cap_tenant_read',
  'tenants:update': 'cap_tenant_update',
  'tenants:set_status': 'cap_tenant_set_status',
  'tenants:set_plan': 'cap_tenant_set_plan',
  'plan:read': 'cap_plan_read',
  'staff:manage': 'cap_staff_manage',
  'tenants:create': 'cap_tenant_create',
  'impersonation:start_read_only': 'cap_impersonation_start_read_only',
  'impersonation:start_full': 'cap_impersonation_start_full',
  'impersonation:manage': 'cap_impersonation_manage',
} as const satisfies Record<PlatformCapabilityT, string>;

/** F-71 §7: the two session modes and the three ways one ends — labels, never raw tokens. */
export const MODE_KEYS = {
  read_only: 'mode_read_only',
  full: 'mode_full',
} as const satisfies Record<ImpersonationModeT, string>;

export const END_REASON_KEYS = {
  manual: 'endReason_manual',
  ttl: 'endReason_ttl',
  revoked: 'endReason_revoked',
} as const satisfies Record<ImpersonationEndReasonT, string>;

/** The verb on the lifecycle button, per target status. */
export const TRANSITION_KEYS = {
  active: 'transition_active',
  trial: 'transition_trial',
  past_due: 'transition_past_due',
  read_only: 'transition_read_only',
  suspended: 'transition_suspended',
  offboarding: 'transition_offboarding',
  purged: 'transition_purged',
} as const satisfies Record<OrganizationStatusT, string>;

/** What the dialog tells the person will happen. */
export const TRANSITION_EFFECT_KEYS = {
  active: 'transitionEffect_active',
  trial: 'transitionEffect_trial',
  past_due: 'transitionEffect_past_due',
  read_only: 'transitionEffect_read_only',
  suspended: 'transitionEffect_suspended',
  offboarding: 'transitionEffect_offboarding',
  purged: 'transitionEffect_purged',
} as const satisfies Record<OrganizationStatusT, string>;

/** Status chips — color underlines the text, never replaces it. Gated pairs only. */
export const STATUS_CLASSES = {
  active: 'bg-muted text-foreground',
  trial: 'bg-muted text-foreground',
  past_due: 'bg-warning-bg text-warning-text',
  read_only: 'bg-warning-bg text-warning-text',
  suspended: 'bg-danger-bg text-danger-text',
  offboarding: 'bg-danger-bg text-danger-text',
  purged: 'bg-danger-bg text-danger-text',
} as const satisfies Record<OrganizationStatusT, string>;

/** Store and staff statuses are vocabularies too — labels, never raw tokens (H-04). */
export const STORE_STATUS_KEYS = {
  active: 'storeStatus_active',
  paused: 'storeStatus_paused',
  closed: 'storeStatus_closed',
} as const satisfies Record<'active' | 'paused' | 'closed', string>;

export const STAFF_STATUS_KEYS = {
  active: 'staffStatus_active',
  revoked: 'staffStatus_revoked',
} as const satisfies Record<'active' | 'revoked', string>;

/** What a journal row is about — every entity the trail can name (F-70 review). */
export const ENTITY_KEYS = {
  deal: 'entity_deal',
  lead: 'entity_lead',
  vehicle: 'entity_vehicle',
  membership: 'entity_membership',
  pay_plan: 'entity_pay_plan',
  checklist_item: 'entity_checklist_item',
  checklist_template: 'entity_checklist_template',
  intake_key: 'entity_intake_key',
  invitation: 'entity_invitation',
  dispatch_assignment: 'entity_dispatch_assignment',
  deal_document: 'entity_deal_document',
  deal_fi_product: 'entity_deal_fi_product',
  tenant_branding: 'entity_tenant_branding',
  consent: 'entity_consent',
  suppression: 'entity_suppression',
  internal_dnc: 'entity_internal_dnc',
  conversation: 'entity_conversation',
  appointment: 'entity_appointment',
  contact: 'entity_contact',
  organization: 'entity_organization',
  store: 'entity_store',
  task: 'entity_task',
  impersonation_session: 'entity_impersonation_session',
} as const satisfies Record<ActivityEntityTypeT, string>;

/** Destructive targets get the destructive button. */
export const DESTRUCTIVE_TARGETS: ReadonlySet<OrganizationStatusT> = new Set<OrganizationStatusT>(['suspended', 'offboarding']);

export { STATUS_KEYS, TIER_KEYS } from '../organizations/labels.js';
