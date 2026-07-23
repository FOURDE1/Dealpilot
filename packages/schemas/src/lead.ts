import { z } from 'zod';
import { Email, IsoDateTime, Locale, NonNegativeCents, PhoneE164, Uuid } from './common.js';

/**
 * The 10-state lead status machine — exact vocabulary from
 * business-logic/leads.md §4. One vocabulary, defined once.
 */
export const LEAD_STATUSES = [
  'new',
  'chatbot_engaged',
  'assigned',
  'contacted',
  'qualified',
  'converted',
  'unresponsive',
  'nurture',
  'expired',
  'lost',
] as const;

export const LeadStatus = z.enum(LEAD_STATUSES);
export type LeadStatusT = z.infer<typeof LeadStatus>;

/** Canonical source enum (leads.md §2.1 — assigned to packages/schemas by spec). */
export const LEAD_SOURCES = [
  'fluent_form',
  'meta_lead_form',
  'manual',
  'chatbot',
  'website',
  'walk_in',
  'phone',
  'referral',
  'repeat',
  'service',
  'instagram',
  'marketplace',
  'google_ads',
  'autotrader',
  'cargurus',
  'kijiji',
  'oem',
  'appointment_promotion',
  'other',
] as const;

export const LeadSource = z.enum(LEAD_SOURCES);

/** Ad-spend attribution bucket (leads.md §2.1). */
export const SourcePlatform = z.enum(['google', 'meta', 'organic', 'oem', 'other']);

const nameField = z.string().trim().max(100);

export const Lead = z.object({
  id: Uuid,
  organization_id: Uuid,
  store_id: Uuid,
  status: LeadStatus,
  first_name: nameField.nullable(),
  last_name: nameField.nullable(),
  email: Email.nullable(),
  /** Phone is the one required contact field (leads.md §1: `phone NOT NULL`). */
  phone: PhoneE164,
  source: LeadSource,
  source_platform: SourcePlatform.nullable(),
  /** Bill 96: drives AI conversation language and assignment (leads.md §2.1). */
  preferred_language: Locale,
  assigned_to: Uuid.nullable(),
  /** Rules-engine-owned, clamped 0–100 (leads.md §6). Never client-writable. */
  score: z.number().int().min(0).max(100).nullable(),
  budget_cents: NonNegativeCents.nullable(),
  vehicle_interest: z.string().trim().max(200).nullable(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
  deleted_at: IsoDateTime.nullable(),
});

/**
 * Leads are always born `new` (leads.md §4) — status is not accepted on create.
 * `score` and `assigned_to` are engine-owned, not client inputs.
 */
export const CreateLeadInput = z.strictObject({
  organization_id: Uuid,
  store_id: Uuid,
  first_name: nameField.optional(),
  last_name: nameField.optional(),
  email: Email.optional(),
  phone: PhoneE164,
  source: LeadSource,
  source_platform: SourcePlatform.optional(),
  preferred_language: Locale.default('fr-CA'),
  budget_cents: NonNegativeCents.optional(),
  vehicle_interest: z.string().trim().max(200).optional(),
});

export const UpdateLeadInput = z.strictObject({
  store_id: Uuid.optional(),
  status: LeadStatus.optional(),
  first_name: nameField.nullable().optional(),
  last_name: nameField.nullable().optional(),
  email: Email.nullable().optional(),
  phone: PhoneE164.optional(),
  source: LeadSource.optional(),
  source_platform: SourcePlatform.nullable().optional(),
  preferred_language: Locale.optional(),
  assigned_to: Uuid.nullable().optional(),
  budget_cents: NonNegativeCents.nullable().optional(),
  vehicle_interest: z.string().trim().max(200).nullable().optional(),
});

export type LeadT = z.infer<typeof Lead>;
export type CreateLeadInputT = z.infer<typeof CreateLeadInput>;
export type UpdateLeadInputT = z.infer<typeof UpdateLeadInput>;
