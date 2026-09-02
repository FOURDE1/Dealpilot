import { z } from 'zod';
import { IsoDateTime, Uuid } from './common.js';
import { LeadSource } from './lead.js';
import { FundingStatus, PipelineStage } from './deal.js';

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

/**
 * F-78 — the GM Command Center report (reports-analytics.md §14.1,
 * FR-REP-003). Every figure is server-computed; the wire carries the month
 * window it was computed over (the store clock, resolved f67-style) so every
 * caption interpolates the real window instead of describing one. Rates are
 * server quotients at 1 dp, null-on-zero — a rate over nothing is not zero.
 */

const Int = z.number().int();

export const GmDashboardQuery = z.strictObject({
  organization_id: Uuid.optional(),
});

export const GmDashboardSalesperson = z.object({
  user_id: Uuid,
  /** Membership-scoped resolution (the F-66 rule — never the global user
   * table). NULL when the seller no longer holds an active membership: the
   * row STAYS so Σ rows.units + unattributed_units === month_sales.units
   * holds structurally; the page renders a placeholder. */
  name: z.string().nullable(),
  units: Int,
  gross_cents: Int,
});

export const GmRottingRow = z.object({
  deal_id: Uuid,
  lead_id: Uuid.nullable(),
  /** Server-joined display name: contact first (deals.contact_id, 0039),
   * then lead — concat_ws, so a one-name customer still shows it. */
  customer: z.string().nullable(),
  stage: PipelineStage,
  days_in_stage: Int,
});

export const GmDeliveredUnfundedRow = z.object({
  deal_id: Uuid,
  lead_id: Uuid.nullable(),
  customer: z.string().nullable(),
  funding_status: FundingStatus,
  days_since_delivery: Int,
});

export const GmDashboardReport = z.object({
  /** The report clock: the org's first in-scope store's timezone (f67 rule;
   * 'America/Toronto' when the org has no store). start = that zone's month
   * start; predicates are `>= start` only — no upper bound. */
  month: z.object({ timezone: z.string(), start: IsoDateTime }),
  /** Open deals right now: pipeline_stage NOT IN delivered/complete/lost.
   * by_stage is zero-filled over the seven open stages. */
  pipeline: z.object({
    total: Int,
    by_stage: z.array(z.object({ stage: PipelineStage, count: Int })),
  }),
  /** The same open deals, by where the money is — zero-filled, Σ = total. */
  funding_by_status: z.array(z.object({ status: FundingStatus, count: Int })),
  /** Closed = delivered/complete, closed_on = COALESCE(delivered_at,
   * created_at) — the F-66 classification, so this page and the leaderboard
   * can never call different deals "sold". Averages null on zero rows. */
  month_sales: z.object({
    units: Int,
    gross_cents: Int,
    avg_front_gross_cents: Int.nullable(),
    avg_back_gross_cents: Int.nullable(),
  }),
  /** The funding queue (no window): submitted/stips_required, not lost. */
  funding: z.object({ count: Int, amount_financed_cents: Int }),
  /** Age buckets on the store clock's date; over_30 = 31_60 + over_60. */
  inventory: z.object({
    in_stock: Int,
    over_30_days: Int,
    aging_0_30: Int,
    aging_31_60: Int,
    aging_over_60: Int,
  }),
  /** conversion_rate = pct1dp(converted, created) — server-side, 1 dp,
   * null when no leads (never 0). `converted` is deliberately wire-only (no
   * render site): it is the numerator the API goldens and the render test's
   * as-sent discriminator consume — a client recompute of the rate reds. */
  leads: z.object({ created: Int, converted: Int, conversion_rate: z.number().nullable() }),
  lead_sources: z.array(z.object({ source: LeadSource, count: Int })),
  salespeople: z.object({
    rows: z.array(GmDashboardSalesperson),
    unattributed_units: Int,
  }),
  /** Both lists cap at 10 rows; count is the TRUE total over the predicate. */
  attention: z.object({
    rotting: z.object({ count: Int, rows: z.array(GmRottingRow) }),
    delivered_unfunded: z.object({ count: Int, rows: z.array(GmDeliveredUnfundedRow) }),
  }),
});

export type GmDashboardQueryT = z.infer<typeof GmDashboardQuery>;
export type GmDashboardReportT = z.infer<typeof GmDashboardReport>;
