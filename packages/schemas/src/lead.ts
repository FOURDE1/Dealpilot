import { z } from 'zod';
import { CursorQuery, Email, IsoDateTime, Locale, NonNegativeCents, PhoneE164, Uuid } from './common.js';

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

const nameField = z.string().trim().min(1).max(100);

/**
 * Whether this lead has something to trade in (conversation-engine.md §9).
 *
 * Three values, not a boolean: "no trade" and "nobody asked" are opposite facts
 * about whether the lead is ready for a person, and the handoff trigger that
 * reads this field would fire on every untouched lead if they were the same.
 */
export const TradeInStatus = z.enum(['none', 'has_trade', 'unknown']);

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
  /** What they will spend on the vehicle. Never a payment (D-043). */
  total_budget_cents: NonNegativeCents.nullable(),
  /** What they can pay per month. Never a price (D-043). */
  monthly_budget_cents: NonNegativeCents.nullable(),
  vehicle_interest: z.string().trim().min(1).max(200).nullable(),
  trade_in_status: TradeInStatus,
  /** Speed to lead (leads.md §5) — stamped by the send path, never by a screen. */
  first_contacted_at: IsoDateTime.nullable(),
  last_contacted_at: IsoDateTime.nullable(),
  response_time_seconds: z.number().int().min(0).nullable(),
  contact_attempts: z.number().int().min(0),
  assigned_at: IsoDateTime.nullable(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
  deleted_at: IsoDateTime.nullable(),
});

/**
 * Leads are always born `new` (leads.md §4) — status is not accepted on create.
 * `score` is engine-owned (never a client input). `assigned_to` is manually
 * settable via UPDATE to an active org member; the auto-assignment engine
 * (AI slice) will drive it later.
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
  total_budget_cents: NonNegativeCents.optional(),
  monthly_budget_cents: NonNegativeCents.optional(),
  vehicle_interest: z.string().trim().min(1).max(200).optional(),
  trade_in_status: TradeInStatus.optional(),
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
  total_budget_cents: NonNegativeCents.nullable().optional(),
  monthly_budget_cents: NonNegativeCents.nullable().optional(),
  vehicle_interest: z.string().trim().min(1).max(200).nullable().optional(),
  trade_in_status: TradeInStatus.optional(),
});

/** Org-scoped list with optional store/status filters (F-02); the
 * organization_id is a verified SELECTOR, never an authority claim. */
export const LeadListQuery = CursorQuery.extend({
  organization_id: Uuid.optional(),
  store_id: Uuid.optional(),
  status: LeadStatus.optional(),
  /** F-04: drives the "my leads" view; pass a member's user id. */
  assigned_to: Uuid.optional(),
});

export type LeadT = z.infer<typeof Lead>;
export type CreateLeadInputT = z.infer<typeof CreateLeadInput>;
export type UpdateLeadInputT = z.infer<typeof UpdateLeadInput>;

/**
 * The store's day, not a person's.
 *
 * No agent filter on purpose: a per-agent leaderboard is performance data about
 * named people and needs an authority of its own to read.
 */
export const SpeedToLeadQuery = z.object({
  organization_id: Uuid.optional(),
  store_id: Uuid.optional(),
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export const SpeedToLeadSummary = z.object({
  contacted: z.number().int(),
  uncontacted: z.number().int(),
  by_rating: z.object({
    excellent: z.number().int(),
    good: z.number().int(),
    fair: z.number().int(),
    slow: z.number().int(),
  }),
  median_seconds: z.number().int().nullable(),
  ai_within_slo: z.number().int(),
  ai_touches: z.number().int(),
});
