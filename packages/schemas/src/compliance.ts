import { z } from 'zod';
import { IsoDateTime, Uuid } from './common.js';

/**
 * F-15 compliance (compliance-and-quality.md §2, §3, §5).
 *
 * The vocabulary is deliberately narrow. Every value here appears in a CHECK
 * constraint in migration 0028 as well — a consent whose type the database will
 * not store is not a consent, and finding that out at INSERT time rather than at
 * validation time would mean a 500 where a 422 belongs.
 */

export const ConsentChannel = z.enum(['sms', 'mms', 'email', 'voice', 'all']);
export const ConsentScope = z.enum(['conversational', 'marketing', 'ai_outbound_call']);
export const ConsentType = z.enum(['express', 'implied_inquiry', 'implied_ebr']);
export const ConsentSource = z.enum([
  'form_checkbox', 'webhook_inquiry', 'sms_reply', 'voice',
  'delivery_completed', 'staff_manual', 're_opt_in',
]);
export const RevokedReason = z.enum([
  'stop_keyword', 'said_stop_extracted', 'email_unsubscribe', 'staff_manual', 'dsar_erasure',
]);

const PhoneE164 = z.string().regex(/^\+1[0-9]{10}$/, 'Use +1XXXXXXXXXX');

export const ConsentRecord = z.object({
  id: Uuid,
  organization_id: Uuid,
  store_id: Uuid.nullable(),
  grant_id: Uuid,
  lead_id: Uuid.nullable(),
  phone_e164: z.string().nullable(),
  email: z.string().nullable(),
  channel: ConsentChannel,
  scope: ConsentScope,
  consent_type: ConsentType,
  source: ConsentSource,
  evidence: z.record(z.string(), z.unknown()),
  granted_at: IsoDateTime,
  expires_at: IsoDateTime.nullable(),
  revoked_at: IsoDateTime.nullable(),
  revoked_reason: RevokedReason.nullable(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});

/**
 * One act by a person, which fans out to a row per channel and purpose.
 *
 * `evidence` is required and cannot be empty: a consent record with nothing
 * behind it is an assertion, and an assertion is what a regulator asks you to
 * substantiate. `expires_at` is absent on purpose — it is derived from the
 * consent type, never supplied, so nobody can grant themselves a longer window.
 */
export const RecordConsentInput = z
  .strictObject({
    organization_id: Uuid,
    store_id: Uuid.nullable().optional(),
    lead_id: Uuid.nullable().optional(),
    phone_e164: PhoneE164.nullable().optional(),
    email: z.email().nullable().optional(),
    channels: z.array(ConsentChannel).min(1).max(5),
    scopes: z.array(ConsentScope).min(1).max(3),
    consent_type: ConsentType,
    source: ConsentSource,
    /** What was shown, where, and to whom — the wording, the IP, the payload. */
    evidence: z.record(z.string(), z.unknown()).refine((e) => Object.keys(e).length > 0, {
      message: 'Consent needs evidence — what was shown and where',
    }),
    granted_at: IsoDateTime.optional(),
  })
  .refine((v) => v.lead_id != null || v.phone_e164 != null || v.email != null, {
    message: 'A consent needs somebody to belong to: a lead, a phone number or an email',
    path: ['lead_id'],
  });

export const RevokeConsentInput = z.strictObject({
  reason: RevokedReason,
  note: z.string().trim().min(1).max(500).optional(),
});

export const SuppressionRecord = z.object({
  id: Uuid,
  organization_id: Uuid,
  phone_e164: z.string(),
  channel: z.enum(['sms', 'mms', 'email', 'voice']),
  source: z.enum(['stop_keyword', 'said_stop_extracted', 'email_unsubscribe', 'staff_manual']),
  matched_keyword: z.string().nullable(),
  cleared_at: IsoDateTime.nullable(),
  created_at: IsoDateTime,
});

export const CreateSuppressionInput = z.strictObject({
  organization_id: Uuid,
  phone_e164: PhoneE164,
  channel: z.enum(['sms', 'mms', 'email', 'voice']),
  /** Staff acting on something said out loud; the automated paths write their own. */
  source: z.literal('staff_manual'),
  note: z.string().trim().min(1).max(500).optional(),
});

/**
 * What the gate says about contacting this lead right now.
 *
 * `blocked` carries a REMEDY, not just a reason. "No consent" tells somebody
 * nothing; "capture consent before contacting them" tells them what to do, and
 * the difference decides whether the rule gets followed or worked around.
 */
export const ComplianceCheck = z.object({
  status: z.enum(['allowed', 'deferred', 'blocked']),
  reason: z.string().nullable(),
  remedy: z.string().nullable(),
  detail: z.string().nullable(),
  /** When a deferral ends — the customer hears from us then, not never. */
  deferred_until: IsoDateTime.nullable(),
  timezone: z.string(),
  timezone_source: z.enum(['postal_code', 'area_code', 'store']),
  recipient_local_time: IsoDateTime,
  window_applied: z.string().nullable(),
  consent_record_id: Uuid.nullable(),
  gate_version: z.string(),
});

export const ComplianceCheckQuery = z.object({
  channel: z.enum(['sms', 'mms', 'email', 'voice']).default('sms'),
  scope: ConsentScope.default('conversational'),
  message_class: z
    .enum(['inbound_reply', 'first_touch', 'drip', 'follow_up', 're_engagement', 'outbound_voice'])
    .default('follow_up'),
  originator: z.enum(['ai', 'human', 'system']).default('ai'),
  is_solicitation: z.coerce.boolean().default(false),
});

export type ConsentRecord = z.infer<typeof ConsentRecord>;
export type RecordConsentInput = z.infer<typeof RecordConsentInput>;
export type SuppressionRecord = z.infer<typeof SuppressionRecord>;
export type ComplianceCheck = z.infer<typeof ComplianceCheck>;

/** Per-store quiet hours. A store may narrow the organisation's window, never widen it. */
export const CommsConfig = z.object({
  id: Uuid,
  organization_id: Uuid,
  store_id: Uuid.nullable(),
  sms_quiet_start: z.string(),
  sms_quiet_end: z.string(),
  first_touch_quiet_exempt: z.boolean(),
  ai_daily_contact_cap: z.number().int(),
  /** How many assistant messages before a person must take over (§9 trigger 5). */
  bot_turn_cap: z.number().int(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});

const TimeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

export const UpdateCommsConfigInput = z
  .strictObject({
    sms_quiet_start: TimeOfDay.optional(),
    sms_quiet_end: TimeOfDay.optional(),
    first_touch_quiet_exempt: z.boolean().optional(),
    ai_daily_contact_cap: z.number().int().min(0).max(10).optional(),
    bot_turn_cap: z.number().int().min(1).max(100).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Nothing to change',
    path: ['sms_quiet_start'],
  });

export const InternalDncRecord = z.object({
  id: Uuid,
  organization_id: Uuid,
  phone_e164: z.string(),
  reason: z.enum(['stop_keyword', 'said_stop_extracted', 'verbal_do_not_call', 'staff_manual']),
  source: z.enum(['sms', 'voice', 'console', 'import']),
  added_by: Uuid.nullable(),
  created_at: IsoDateTime,
});

/**
 * "Never call this person again."
 *
 * Section 4 gives no path back, so there is no clearing endpoint either — a
 * button that undoes a do-not-call request is a button somebody will press.
 */
export const CreateInternalDncInput = z.strictObject({
  organization_id: Uuid,
  phone_e164: PhoneE164,
  reason: z.enum(['verbal_do_not_call', 'staff_manual']),
  note: z.string().trim().min(1).max(500).optional(),
});

export type CommsConfig = z.infer<typeof CommsConfig>;
export type InternalDncRecord = z.infer<typeof InternalDncRecord>;
