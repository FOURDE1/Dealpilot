import { z } from 'zod';
import { CursorQuery, IsoDateTime, Uuid } from './common.js';
import { LeadSource } from './lead.js';

/**
 * F-65 — the marketing spend ledger (expenses-accounting.md §10) and the
 * source-ROI report it feeds (reports-analytics.md §8). Cents everywhere
 * (ADR-009); `source` rides the ONE lead-source enum, which is the fix for
 * the legacy's seeded-sources-outside-the-CHECK drift.
 */

/** 'YYYY-MM' in, first-of-month date out — a month is a value, not a range. */
export const SpendMonth = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month is YYYY-MM')
  .transform((m) => `${m}-01`);

export const SourceCost = z.object({
  id: Uuid,
  organization_id: Uuid,
  store_id: Uuid.nullable(),
  source: z.string(),
  month: z.string(),
  spend_cents: z.number().int(),
  notes: z.string().nullable(),
  created_by: Uuid.nullable(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});

/** POST is an UPSERT (§10): one row per source/month/store; re-posting overwrites. */
export const UpsertSourceCostInput = z.strictObject({
  organization_id: Uuid,
  store_id: Uuid.nullable().optional(),
  source: LeadSource,
  month: SpendMonth,
  spend_cents: z.number().int().min(0).max(1_000_000_000),
  notes: z.string().trim().min(1).max(500).nullable().optional(),
});

export const ListSourceCostsQuery = CursorQuery.extend({
  organization_id: Uuid.optional(),
  month: SpendMonth.optional(),
  source: LeadSource.optional(),
  store_id: Uuid.optional(),
});

export const RoiPeriod = z.enum(['30d', '90d', '6m', '1y', 'all']);

const money = z.number().int();
const SourceRoiRow = z.object({
  source: z.string(),
  total_leads: z.number().int(),
  converted_leads: z.number().int(),
  total_revenue_cents: money,
  spend_cents: money,
  /** Cents, 0 when no leads. */
  cost_per_lead_cents: money,
  cost_per_conversion_cents: money,
  /** Percent, 1dp; 0-guarded. */
  conversion_rate: z.number(),
  /** Percent return, 1dp; null when spend is zero — 0/0 is not 0% ROI. */
  roi: z.number().nullable(),
});

export const SourceRoiReport = z.object({
  period: RoiPeriod,
  sources: z.array(SourceRoiRow),
  totals: z.object({
    total_leads: z.number().int(),
    total_converted: z.number().int(),
    total_spend_cents: money,
    total_revenue_cents: money,
    avg_cost_per_lead_cents: money,
    avg_conversion_rate: z.number(),
    overall_roi: z.number().nullable(),
  }),
  monthly: z.array(
    z.object({
      month: z.string(),
      source: z.string(),
      leads: z.number().int(),
      converted: z.number().int(),
      revenue_cents: money,
      spend_cents: money,
      cost_per_lead_cents: money,
      roi: z.number().nullable(),
    }),
  ),
});

export const SourceRoiQuery = z.object({
  organization_id: Uuid.optional(),
  store_id: Uuid.optional(),
  period: RoiPeriod.default('90d'),
});

export type SourceCostT = z.infer<typeof SourceCost>;
export type UpsertSourceCostInputT = z.infer<typeof UpsertSourceCostInput>;
export type SourceRoiReportT = z.infer<typeof SourceRoiReport>;
