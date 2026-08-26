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

/**
 * F-66 — the salesperson leaderboard (reports-analytics.md §10), rebuilt on
 * REAL foreign keys (deals.salesperson_id, leads.assigned_to — the legacy's
 * fuzzy name-matching had nothing to hold on to) and with its documented
 * defects fixed: closed = the canonical delivered/complete stages, response
 * time = the F-24 speed-to-lead stamp, bands = the lead module's 5/15/30.
 */
export const LeaderboardSort = z.enum(['gross', 'deals', 'conversion', 'response', 'leads']);

export const LeaderboardQuery = z.object({
  organization_id: z.uuid().optional(),
  store_id: z.uuid().optional(),
  period: z.enum(['30d', '90d', '6m', '1y', 'all']).default('90d'),
  sort: LeaderboardSort.default('gross'),
});

export const LeaderboardRow = z.object({
  user_id: z.uuid(),
  name: z.string(),
  deals: z.number().int(),
  closed_deals: z.number().int(),
  total_sales_cents: z.number().int(),
  gross_profit_cents: z.number().int(),
  fi_reserve_cents: z.number().int(),
  total_leads: z.number().int(),
  active_leads: z.number().int(),
  /** closed_deals / leads assigned in the period × 100, 1dp; 0-guarded. */
  conversion_rate: z.number(),
  /** Mean of the F-24 stamp; null when nothing was ever responded to. */
  avg_response_seconds: z.number().nullable(),
});

export const LeaderboardReport = z.object({
  period: z.enum(['30d', '90d', '6m', '1y', 'all']),
  sort: LeaderboardSort,
  rows: z.array(LeaderboardRow),
});
export type LeaderboardReportT = z.infer<typeof LeaderboardReport>;
export type LeaderboardQueryT = z.infer<typeof LeaderboardQuery>;

/**
 * F-67 — the activity heatmap (reports-analytics.md §11 Target): store-level,
 * SQL-side, weekday × hour in the STORE's timezone. Only the channel that
 * exists rides the filter — SMS both ways; call/email chips arrive with
 * their modules rather than as dead vocabulary.
 */
/** The column's own vocabulary — an 'all' sentinel is what the
 * enum-vocabulary guard exists to refuse; absent means both directions. */
export const HeatmapDirection = z.enum(['inbound', 'outbound']);

export const HeatmapQuery = z.object({
  organization_id: z.uuid().optional(),
  store_id: z.uuid().optional(),
  period: z.enum(['30d', '90d', '6m', '1y', 'all']).default('90d'),
  direction: HeatmapDirection.optional(),
});

export const HeatmapCell = z.object({
  /** 0 = Sunday … 6 = Saturday, in the store's local time. */
  dow: z.number().int().min(0).max(6),
  hour: z.number().int().min(0).max(23),
  inbound: z.number().int(),
  outbound: z.number().int(),
});

export const HeatmapReport = z.object({
  period: z.enum(['30d', '90d', '6m', '1y', 'all']),
  /** Null = both directions. */
  direction: HeatmapDirection.nullable(),
  /** The timezone every cell was bucketed in. */
  timezone: z.string(),
  /** Only non-empty cells; the grid fills the rest with zero. */
  cells: z.array(HeatmapCell),
  /** Top-3 slots by INBOUND volume — when customers actually answer. */
  best_times: z.array(z.object({ dow: z.number().int(), hour: z.number().int(), inbound: z.number().int() })),
  totals: z.object({ inbound: z.number().int(), outbound: z.number().int() }),
  max_count: z.number().int(),
});
export type HeatmapReportT = z.infer<typeof HeatmapReport>;
export type HeatmapQueryT = z.infer<typeof HeatmapQuery>;
