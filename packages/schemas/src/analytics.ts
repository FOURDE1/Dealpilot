import { z } from 'zod';
import { Uuid } from './common.js';
import { LeadSource } from './lead.js';

/**
 * F-55 — win/loss analytics (reports-analytics.md §9). Aggregate numbers
 * about the WHOLE funnel: won (converted, or carrying a deal), lost, open.
 * Open leads never sit in a rate denominator — an undecided lead is not a
 * failure yet.
 */

export const AnalyticsPeriod = z.enum(['30d', '90d', '6m', '1y', 'all']);

export const WinLossQuery = z.object({
  organization_id: Uuid.optional(),
  store_id: Uuid.optional(),
  period: AnalyticsPeriod.default('90d'),
});

export const WinLossSummary = z.object({
  total: z.number().int(),
  won: z.number().int(),
  lost: z.number().int(),
  open: z.number().int(),
  /** won / (won + lost) × 100, one decimal; null when nothing is decided. */
  win_rate: z.number().nullable(),
  loss_rate: z.number().nullable(),
  /** §8.3: certain resubmissions in the window — the duplicate-as-signal count. */
  duplicate_resubmissions: z.number().int(),
});

/** Localizable by construction — the legacy aggregated the EN name only
 * (a flagged Bill 96 gap); here both labels and the icon ride along. */
export const WinLossLostReason = z.object({
  /** NULL is the one honest sentinel: no reason recorded (opt-outs, system). */
  id: Uuid.nullable(),
  name: z.string(),
  name_fr: z.string(),
  icon: z.string(),
  count: z.number().int(),
  percentage: z.number(),
});

export const WinLossMonth = z.object({
  /** YYYY-MM, bucketed by lead CREATION month (spec §9). */
  month: z.string(),
  won: z.number().int(),
  lost: z.number().int(),
  win_rate: z.number().nullable(),
});

export const WinLossSource = z.object({
  source: LeadSource,
  total: z.number().int(),
  won: z.number().int(),
  lost: z.number().int(),
  win_rate: z.number().nullable(),
});

export const WinLossReport = z.object({
  summary: WinLossSummary,
  /** Sorted count DESC. Reason-less losses (opt-outs, system) aggregate
   * under the sentinel name 'unknown' — D-055 #6. */
  lost_reasons: z.array(WinLossLostReason),
  monthly_trend: z.array(WinLossMonth),
  source_performance: z.array(WinLossSource),
});

export type WinLossQueryT = z.infer<typeof WinLossQuery>;
export type WinLossReportT = z.infer<typeof WinLossReport>;
