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
  store_id: Uuid.nullable(),
  label,
  provider: IntakeProvider,
  default_source: LeadSource,
  connector_key: z.string(),
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
  /** NULL = an ORG-LEVEL key — the dealer group's ad-platform front door (F-45). */
  store_id: Uuid.nullable().default(null),
  label,
  provider: IntakeProvider.default('generic_json'),
  default_source: LeadSource.default('website'),
  /**
   * Which connector definition reads this source's payloads (ADR-005).
   *
   * A key that could not name one would make the framework decorative: adding a
   * lead source is supposed to be configuration, and configuration nobody can
   * set is code with extra steps.
   */
  /**
   * A built-in preset OR a tenant connector's source_key (F-49) — the route
   * verifies existence, because an enum cannot know a tenant's rows.
   */
  connector_key: z
    .string()
    .regex(/^[a-z0-9_]{2,40}$/)
    .default('website_form'),
});

/**
 * The generic_json inbound payload. `phone` is the one required contact field
 * (leads.md §1); source/store/org come from the resolved key, never the body.
 */
/**
 * A lead arriving from a provider.
 *
 * `consent` and `consent_text` are what the form actually collected. Without
 * them a submitted lead has no basis to be contacted on, which is how every
 * webhook lead in this system was unmessageable until the connector framework
 * landed: the enquiry arrived, the lead appeared, and nothing could be sent.
 *
 * Loose rather than strict on the extras: providers add fields without warning,
 * and rejecting a whole lead because a payload grew a field is worse than
 * ignoring the field.
 */
export const IntakeLeadPayload = z.object({
  phone: PhoneE164,
  first_name: z.string().trim().min(1).max(100).optional(),
  last_name: z.string().trim().min(1).max(100).optional(),
  email: Email.optional(),
  vehicle_interest: z.string().trim().min(1).max(200).optional(),
  preferred_language: Locale.optional(),
  /** Whether the customer ticked the form's consent box. */
  consent: z.union([z.boolean(), z.string(), z.number()]).optional(),
  /** The exact wording they were shown — this IS the evidence. */
  consent_text: z.string().trim().min(1).max(2000).optional(),
  /** Free text the customer typed. Untrusted: spotlight before any model. */
  message: z.string().trim().max(4000).optional(),
});

export type IntakeKeyT = z.infer<typeof IntakeKey>;
export type IntakeKeyCreatedT = z.infer<typeof IntakeKeyCreated>;
export type CreateIntakeKeyInputT = z.infer<typeof CreateIntakeKeyInput>;
export type IntakeLeadPayloadT = z.infer<typeof IntakeLeadPayload>;
