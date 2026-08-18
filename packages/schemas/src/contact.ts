import { z } from 'zod';
import { CursorQuery, Email, IsoDateTime, Locale, PhoneE164, PostalCodeCA, ProvinceCA, Uuid } from './common.js';

/**
 * Contacts — the customer master (FR-CON).
 *
 * A lead is an enquiry and a deal is a transaction; neither is the person. The
 * same customer buying twice was two unrelated rows until this existed.
 *
 * NOTHING HERE CARRIES HIGH-SENSITIVITY PII. Date of birth, driver's licence
 * number, SIN, income and banking details are named in FR-CON-001 and required
 * by FR-CON-007 (P0) to be AES-256-GCM encrypted with per-tenant KMS keys
 * (ADR-015). No KMS key is provisioned, so those fields are absent from the
 * table AND from this contract — a schema that accepted them would be an API
 * that drops the most sensitive thing a customer hands over, silently.
 */

const nameField = z.string().trim().min(1).max(100);

export const PreferredContact = z.enum(['text', 'email', 'phone']);

export const Contact = z.object({
  id: Uuid,
  organization_id: Uuid,
  store_id: Uuid.nullable(),
  first_name: nameField.nullable(),
  last_name: nameField.nullable(),
  email: Email.nullable(),
  phone: PhoneE164.nullable(),
  phone_alt: PhoneE164.nullable(),
  address_line1: z.string().nullable(),
  city: z.string().nullable(),
  province: ProvinceCA.nullable(),
  postal_code: PostalCodeCA.nullable(),
  employer: z.string().nullable(),
  preferred_language: Locale,
  preferred_contact: PreferredContact,
  tags: z.array(z.string()),
  source: z.string().nullable(),
  referred_by_contact_id: Uuid.nullable(),
  /**
   * What the customer told a salesperson. NOT what the send gate reads — that
   * is `consent_ledger`, per channel, per scope, with evidence. Two records on
   * purpose: this one is a preference, the ledger is proof.
   */
  consent_marketing: z.boolean(),
  consent_marketing_at: IsoDateTime.nullable(),
  customer_since: IsoDateTime.nullable(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
  deleted_at: IsoDateTime.nullable(),
});

export const CreateContactInput = z.strictObject({
  organization_id: Uuid,
  store_id: Uuid.optional(),
  first_name: nameField.optional(),
  last_name: nameField.optional(),
  email: Email.optional(),
  /** Optional, but see the refine: a contact reachable by nothing is a note. */
  phone: PhoneE164.optional(),
  phone_alt: PhoneE164.optional(),
  address_line1: z.string().trim().max(200).optional(),
  city: z.string().trim().max(100).optional(),
  province: ProvinceCA.optional(),
  postal_code: PostalCodeCA.optional(),
  employer: z.string().trim().max(200).optional(),
  preferred_language: Locale.default('fr-CA'),
  preferred_contact: PreferredContact.default('text'),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  source: z.string().trim().max(60).optional(),
  referred_by_contact_id: Uuid.optional(),
  consent_marketing: z.boolean().default(false),
}).refine((v) => v.phone !== undefined || v.email !== undefined, {
  message: 'A contact needs a phone or an email — one with neither cannot be reached or matched',
  path: ['phone'],
});

export const UpdateContactInput = z.strictObject({
  store_id: Uuid.nullable().optional(),
  first_name: nameField.nullable().optional(),
  last_name: nameField.nullable().optional(),
  email: Email.nullable().optional(),
  phone: PhoneE164.nullable().optional(),
  phone_alt: PhoneE164.nullable().optional(),
  address_line1: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().max(100).nullable().optional(),
  province: ProvinceCA.nullable().optional(),
  postal_code: PostalCodeCA.nullable().optional(),
  employer: z.string().trim().max(200).nullable().optional(),
  preferred_language: Locale.optional(),
  preferred_contact: PreferredContact.optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  source: z.string().trim().max(60).nullable().optional(),
  referred_by_contact_id: Uuid.nullable().optional(),
  consent_marketing: z.boolean().optional(),
});

export const ContactListQuery = CursorQuery.extend({
  organization_id: Uuid.optional(),
  store_id: Uuid.optional(),
  /** Weighted full-text search: name, then email/phone, then city (FR-CON-004). */
  q: z.string().trim().min(1).max(120).optional(),
});

/**
 * A possible duplicate found at create time (FR-CON-003).
 *
 * Returned rather than blocking. Two people at one address really do share a
 * phone, and refusing the second would send a salesperson to invent a fake
 * number — which is worse than a duplicate, because it is a duplicate nobody
 * can find later.
 */
export const DuplicateMatch = z.object({
  contact: Contact,
  matched_on: z.array(z.enum(['phone', 'email'])),
});

export type ContactT = z.infer<typeof Contact>;
export type CreateContactInputT = z.infer<typeof CreateContactInput>;
export type UpdateContactInputT = z.infer<typeof UpdateContactInput>;
export type DuplicateMatchT = z.infer<typeof DuplicateMatch>;

/**
 * Folding a duplicate into the record that survives (FR-CON-003).
 *
 * Two ids and nothing else. There is deliberately no "which fields to keep"
 * option: a field-by-field merge screen is where somebody picks the wrong
 * email under time pressure, and the loser is soft-deleted rather than removed
 * precisely so that a mistake stays inspectable. The keeper is the record that
 * continues; the merged record's history moves to it.
 */
export const MergeContactsInput = z.object({
  keep_id: Uuid,
  merge_id: Uuid,
}).strict();

/** What the merge actually moved — reported so the caller can show it. */
export const MergeContactsResult = z.object({
  keep_id: Uuid,
  merged_id: Uuid,
  moved: z.object({
    deals: z.number().int().min(0),
    parties: z.number().int().min(0),
    leads: z.number().int().min(0),
    activity: z.number().int().min(0),
  }),
  /** The OLDER of the two, because that is when the relationship began. */
  customer_since: z.string().nullable(),
});

export type MergeContactsInputT = z.infer<typeof MergeContactsInput>;
export type MergeContactsResultT = z.infer<typeof MergeContactsResult>;
