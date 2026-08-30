import type { QueueNameT } from '@dealpilot/contracts';
import type {
  ActivityEntityTypeT,
  ImpersonationEndReasonT,
  ImpersonationModeT,
  OrganizationStatusT,
  PlatformCapabilityT,
  PlatformRoleT,
  PlatformSettingKeyT,
  QueueStateT,
  RetryOutcomeT,
  UsageMetricT,
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
  'announcements:read': 'cap_announcements_read',
  'announcements:publish': 'cap_announcements_publish',
  'announcements:publish_elevated': 'cap_announcements_publish_elevated',
  'settings:read': 'cap_settings_read',
  'settings:write': 'cap_settings_write',
  'queues:read': 'cap_queues_read',
  'queues:retry': 'cap_queues_retry',
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

/**
 * F-72 §5.3 — each kill switch says what it IS and what it STOPS. The scope
 * sentence is not decoration: the SMS switch also silences a human advisor's
 * replies, and the AI switch does not, and an operator deciding at 3am has to
 * read that rather than infer it from the name.
 */
export const SETTING_KEYS = {
  ai_outbound_killswitch: { label: 'ai_outbound_killswitch', scope: 'scope_ai_outbound_killswitch' },
  sms_send_killswitch: { label: 'sms_send_killswitch', scope: 'scope_sms_send_killswitch' },
} as const satisfies Record<PlatformSettingKeyT, { label: string; scope: string }>;

/**
 * F-73 §6 — every usage number carries its own caption, and the pairing is a
 * TYPE rather than a convention.
 *
 * The captions are the feature. Seven of §6's names were cut because no row
 * answers them, and four of the survivors were renamed because the obvious
 * name would have been a lie; a reader who sees only `members_who_acted`
 * beside a figure will read DAU. Pairing label and caption in one entry means
 * a metric cannot reach the screen bare — the compiler refuses the map, not a
 * reviewer catching a missing line — and `usage-card.test.tsx` proves the page
 * really renders both halves.
 */
export const USAGE_METRIC_KEYS = {
  members_who_acted: { label: 'metric_members_who_acted', caption: 'caption_members_who_acted' },
  leads_created: { label: 'metric_leads_created', caption: 'caption_leads_created' },
  deals_created: { label: 'metric_deals_created', caption: 'caption_deals_created' },
  deals_delivered: { label: 'metric_deals_delivered', caption: 'caption_deals_delivered' },
  ai_conversations_engaged: { label: 'metric_ai_conversations_engaged', caption: 'caption_ai_conversations_engaged' },
  sms_segments: { label: 'metric_sms_segments', caption: 'caption_sms_segments' },
  sms_messages_unsegmented: { label: 'metric_sms_messages_unsegmented', caption: 'caption_sms_messages_unsegmented' },
  ai_first_touch_p95_seconds: { label: 'metric_ai_first_touch_p95_seconds', caption: 'caption_ai_first_touch_p95_seconds' },
  ai_first_touch_sample_count: { label: 'metric_ai_first_touch_sample_count', caption: 'caption_ai_first_touch_sample_count' },
  seats_provisioned: { label: 'metric_seats_provisioned', caption: 'caption_seats_provisioned' },
  member_count: { label: 'metric_member_count', caption: 'caption_member_count' },
  store_count: { label: 'metric_store_count', caption: 'caption_store_count' },
  document_bytes: { label: 'metric_document_bytes', caption: 'caption_document_bytes' },
} as const satisfies Record<UsageMetricT, { label: string; caption: string }>;

/**
 * F-73 §9 — the ten job queues by name, and whether the console could ask.
 *
 * A queue name is an operator-facing word here, not a Redis key: `drip-tick`
 * says nothing to the person deciding whether a dealer's texts are stuck.
 * `QueueNameT` comes from the catalogue in @dealpilot/contracts, so a
 * queue added there fails this map to compile.
 */
export const QUEUE_KEYS = {
  'deferred-send': 'queue_deferred-send',
  'assistant-turn': 'queue_assistant-turn',
  'lead-reassign': 'queue_lead-reassign',
  'ai-extraction': 'queue_ai-extraction',
  'first-touch': 'queue_first-touch',
  'live-analysis': 'queue_live-analysis',
  'announcement-fanout': 'queue_announcement-fanout',
  'drip-tick': 'queue_drip-tick',
  'qa-review': 'queue_qa-review',
  'task-sweep': 'queue_task-sweep',
} as const satisfies Record<QueueNameT, string>;

/**
 * "We could not ask" and "nothing has failed" are different facts, and the
 * console has to say which one it is holding — a zero on an unreachable queue
 * is the answer an operator would act on wrongly.
 */
export const QUEUE_STATE_KEYS = {
  ok: 'state_ok',
  not_configured: 'state_not_configured',
  unreachable: 'state_unreachable',
} as const satisfies Record<QueueStateT, string>;

/**
 * F-73 §9 — what one requested retry did, in words.
 *
 * Five, and no `locked`: `reprocessJob-8.lua` returns 1 / -1 / -3 and has no
 * lock check, so a job a worker is holding comes back `not_failed` and a sixth
 * label would name a state nothing can produce. The two an operator is most
 * likely to misread are captioned rather than left to the word alone —
 * `not_attempted` means untouched, not failed, and `not_failed` usually means
 * somebody else got there first.
 */
export const RETRY_OUTCOME_KEYS = {
  retried: 'outcome_retried',
  gone: 'outcome_gone',
  not_failed: 'outcome_not_failed',
  not_attempted: 'outcome_not_attempted',
  error: 'outcome_error',
} as const satisfies Record<RetryOutcomeT, string>;

/** Destructive targets get the destructive button. */
export const DESTRUCTIVE_TARGETS: ReadonlySet<OrganizationStatusT> = new Set<OrganizationStatusT>(['suspended', 'offboarding']);

export { STATUS_KEYS, TIER_KEYS } from '../organizations/labels.js';
