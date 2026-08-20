import { z } from 'zod';
import { CursorQuery, IsoDateTime, Uuid } from './common.js';
import { LeadSource, LeadStatus } from './lead.js';

/**
 * F-54 — duplicate detection & merge (leads.md §8). A pair is the same
 * PERSON arriving twice: the newer lead (`lead_id`) against the older
 * keeper (`duplicate_of`). Pending pairs are the review queue; merge and
 * dismiss are the two human verbs.
 */

export const DuplicateMatchType = z.enum([
  'phone',
  'email',
  'name',
  'phone_email',
  'phone_name',
  'email_name',
  'phone_email_name',
]);

export const DuplicateStatus = z.enum(['pending', 'merged', 'dismissed']);

export const LeadDuplicate = z.object({
  id: Uuid,
  organization_id: Uuid,
  store_id: Uuid.nullable(),
  /** The NEWER lead — merged away on merge. */
  lead_id: Uuid,
  /** The OLDER lead — always the canonical keeper. */
  duplicate_of: Uuid,
  match_type: DuplicateMatchType,
  confidence: z.number().int().min(0).max(100),
  status: DuplicateStatus,
  resolved_by: Uuid.nullable(),
  resolved_at: IsoDateTime.nullable(),
  merged_by: Uuid.nullable(),
  merged_at: IsoDateTime.nullable(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});

/** Enough of each side for the side-by-side review card. */
export const DuplicateLeadSummary = z.object({
  id: Uuid,
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  phone: z.string(),
  email: z.string().nullable(),
  vehicle_interest: z.string().nullable(),
  status: LeadStatus,
  source: LeadSource,
  created_at: IsoDateTime,
});

export const DuplicatePair = LeadDuplicate.extend({
  newer: DuplicateLeadSummary,
  older: DuplicateLeadSummary,
});

export const DuplicateListQuery = CursorQuery.extend({
  organization_id: Uuid.optional(),
  /** The screen's tabs pass an explicit status; ABSENT means every status —
   * a filter's vocabulary is the column's, never a superset of it. */
  status: DuplicateStatus.optional(),
  /** Either side: the lead-detail banner asks "am I in a pending pair?". */
  lead_id: Uuid.optional(),
});

export const DuplicateScanInput = z.strictObject({
  organization_id: Uuid,
  store_id: Uuid.optional(),
});

/** What a scan did: pairs it created (existing pairs are never duplicated). */
export const DuplicateScanResult = z.object({
  created: z.number().int().min(0),
});

export type LeadDuplicateT = z.infer<typeof LeadDuplicate>;
export type DuplicatePairT = z.infer<typeof DuplicatePair>;
export type DuplicateScanInputT = z.infer<typeof DuplicateScanInput>;
