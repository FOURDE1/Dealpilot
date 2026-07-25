import { z } from 'zod';
import { Email, IsoDateTime, Locale, PhoneE164, Uuid } from './common.js';
import { LeadSource } from './lead.js';

/**
 * F-03 intake keys — per-store webhook credentials (leads.md §10). The `token`
 * is the public URL segment; the `secret` signs the HMAC and is returned RAW
 * exactly once, on creation. Providers beyond generic_json land with their own
 * signature schemes later.
 */
export const IntakeProvider = z.enum(['generic_json', 'fluent_form', 'meta', 'adf_email', 'chat_widget']);

const label = z.string().trim().min(1).max(100);

/** Safe to expose: never carries the secret. */
export const IntakeKey = z.object({
  id: Uuid,
  organization_id: Uuid,
  store_id: Uuid,
  label,
  provider: IntakeProvider,
  default_source: LeadSource,
  token: z.string(),
  active: z.boolean(),
  last_used_at: IsoDateTime.nullable(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
  revoked_at: IsoDateTime.nullable(),
});

/** The one-time creation response: the raw secret + the full webhook URL. */
export const IntakeKeyCreated = IntakeKey.extend({
  secret: z.string(),
  webhook_url: z.string(),
});

export const CreateIntakeKeyInput = z.strictObject({
  organization_id: Uuid,
  store_id: Uuid,
  label,
  provider: IntakeProvider.default('generic_json'),
  default_source: LeadSource.default('website'),
});

/**
 * The generic_json inbound payload. `phone` is the one required contact field
 * (leads.md §1); source/store/org come from the resolved key, never the body.
 */
export const IntakeLeadPayload = z.strictObject({
  phone: PhoneE164,
  first_name: z.string().trim().min(1).max(100).optional(),
  last_name: z.string().trim().min(1).max(100).optional(),
  email: Email.optional(),
  vehicle_interest: z.string().trim().min(1).max(200).optional(),
  preferred_language: Locale.optional(),
});

export type IntakeKeyT = z.infer<typeof IntakeKey>;
export type IntakeKeyCreatedT = z.infer<typeof IntakeKeyCreated>;
export type CreateIntakeKeyInputT = z.infer<typeof CreateIntakeKeyInput>;
export type IntakeLeadPayloadT = z.infer<typeof IntakeLeadPayload>;
