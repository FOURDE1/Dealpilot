import { z } from 'zod';
import { CursorQuery, IsoDateTime, NonNegativeCents, ProvinceCA, Uuid } from './common.js';

/**
 * F-05 desking: a worked deal on a lead. Money is INTEGER CENTS everywhere
 * (ADR-009) and the rate is basis points, so nothing in the wire format can
 * carry a float rounding error. Outputs come from @dealpilot/core (A-06) —
 * clients never send them.
 */
/**
 * The 10 canonical pipeline stages (deals-pipeline.md §2) — where the CAR is.
 * F-05 shipped an ad-hoc vocabulary; this is the spec's, corrected in F-06.
 */
export const PipelineStage = z.enum([
  'new', 'submitted', 'approved', 'signed', 'sourcing',
  'pending_delivery', 'scheduled', 'delivered', 'complete', 'lost',
]);

/** Where the MONEY is (deals-pipeline.md §3) — tracked independently. */
export const FundingStatus = z.enum(['not_submitted', 'submitted', 'stips_required', 'funded']);
export const DealType = z.enum(['finance', 'lease', 'cash']);

/** The desk inputs — everything a manager types on the worksheet. */
export const DeskingInputs = z.object({
  province: ProvinceCA,
  deal_type: DealType.default('finance'),
  sale_price_cents: NonNegativeCents,
  msrp_cents: NonNegativeCents.optional(),
  vehicle_cost_cents: NonNegativeCents.default(0),
  cash_down_cents: NonNegativeCents.default(0),
  trade_allowance_cents: NonNegativeCents.default(0),
  trade_acv_cents: NonNegativeCents.default(0),
  trade_lien_cents: NonNegativeCents.default(0),
  /** Rebates are POST-tax (audited legacy bug F6 — see A-06). */
  rebate_cents: NonNegativeCents.default(0),
  fees_cents: NonNegativeCents.default(0),
  fees_taxable: z.boolean().default(false),
  fi_price_cents: NonNegativeCents.default(0),
  fi_cost_cents: NonNegativeCents.default(0),
  /** Basis points: 599 = 5.99% APR. Integers only, like money. */
  interest_rate_bps: z.number().int().min(0).max(10_000).default(0),
  term_months: z.number().int().min(1).max(120).default(60),
  /** Lease only: residual as a percent of MSRP (the engine's own unit). */
  residual_percent: z.number().int().min(0).max(100).default(55),
  tax_exempt: z.boolean().default(false),
});

/** What the engine computed — split taxes, never a blended recompute. */
export const DeskingOutputs = z.object({
  gst_cents: z.number().int(),
  pst_cents: z.number().int(),
  hst_cents: z.number().int(),
  tax_total_cents: z.number().int(),
  amount_financed_cents: z.number().int(),
  monthly_payment_cents: z.number().int(),
  biweekly_payment_cents: z.number().int(),
  weekly_payment_cents: z.number().int(),
  front_gross_cents: z.number().int(),
  total_gross_cents: z.number().int(),
});

export const Deal = DeskingInputs.extend({
  id: Uuid,
  organization_id: Uuid,
  store_id: Uuid,
  lead_id: Uuid.nullable(),
  vehicle_id: Uuid.nullable(),
  salesperson_id: Uuid.nullable(),
  fi_reserve_cents: NonNegativeCents,
  pipeline_stage: PipelineStage,
  funding_status: FundingStatus,
  funded_at: IsoDateTime.nullable(),
  delivered_at: IsoDateTime.nullable(),
  /** Optional on input, NULL in the row — the entity must accept both. */
  msrp_cents: NonNegativeCents.nullable(),
}).extend(DeskingOutputs.shape).extend({
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
  deleted_at: IsoDateTime.nullable(),
});

/** Preview endpoint: pure math, nothing stored. */
export const CalculateDealInput = DeskingInputs.strict();

export const CreateDealInput = DeskingInputs.extend({
  organization_id: Uuid,
  store_id: Uuid,
  lead_id: Uuid.optional(),
  /** The car being sold (F-07); must belong to the same organization. */
  vehicle_id: Uuid.optional(),
  /** Who sold it (F-09) — drives the commission when the deal funds. */
  salesperson_id: Uuid.optional(),
  /** F&I reserve counts toward commissionable gross (commissions §11). */
  fi_reserve_cents: NonNegativeCents.optional(),
}).strict();

/**
 * Status is a workflow move; outputs are engine-owned and never accepted.
 * Written out field by field ON PURPOSE: deriving this from DeskingInputs via
 * `.partial()` keeps each field's `.default()`, so a one-field PATCH would
 * silently reset every other input to zero (the defaults-leak regression this
 * repo already guards against for the other entities).
 */
export const UpdateDealInput = z.strictObject({
  province: ProvinceCA.optional(),
  deal_type: DealType.optional(),
  sale_price_cents: NonNegativeCents.optional(),
  msrp_cents: NonNegativeCents.nullable().optional(),
  vehicle_cost_cents: NonNegativeCents.optional(),
  cash_down_cents: NonNegativeCents.optional(),
  trade_allowance_cents: NonNegativeCents.optional(),
  trade_acv_cents: NonNegativeCents.optional(),
  trade_lien_cents: NonNegativeCents.optional(),
  rebate_cents: NonNegativeCents.optional(),
  fees_cents: NonNegativeCents.optional(),
  fees_taxable: z.boolean().optional(),
  fi_price_cents: NonNegativeCents.optional(),
  fi_cost_cents: NonNegativeCents.optional(),
  interest_rate_bps: z.number().int().min(0).max(10_000).optional(),
  term_months: z.number().int().min(1).max(120).optional(),
  residual_percent: z.number().int().min(0).max(100).optional(),
  tax_exempt: z.boolean().optional(),
  pipeline_stage: PipelineStage.optional(),
  funding_status: FundingStatus.optional(),
  lead_id: Uuid.nullable().optional(),
  vehicle_id: Uuid.nullable().optional(),
  salesperson_id: Uuid.nullable().optional(),
  fi_reserve_cents: NonNegativeCents.optional(),
});

export const DealListQuery = CursorQuery.extend({
  organization_id: Uuid.optional(),
  store_id: Uuid.optional(),
  lead_id: Uuid.optional(),
  /** Kanban column, or the funding lane — the two tracks filter separately. */
  pipeline_stage: PipelineStage.optional(),
  funding_status: FundingStatus.optional(),
});

export type DealT = z.infer<typeof Deal>;
export type DeskingInputsT = z.infer<typeof DeskingInputs>;
export type DeskingOutputsT = z.infer<typeof DeskingOutputs>;
export type CalculateDealInputT = z.infer<typeof CalculateDealInput>;
export type CreateDealInputT = z.infer<typeof CreateDealInput>;
export type UpdateDealInputT = z.infer<typeof UpdateDealInput>;
