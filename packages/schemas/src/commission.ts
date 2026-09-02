import { z } from 'zod';
import { CursorQuery, IsoDateTime, NonNegativeCents, Uuid } from './common.js';

/**
 * F-09 pay plans and commission lines (commissions-clawbacks.md §11).
 * Rates are decimals (0.25 = 25%); every money value is INTEGER CENTS, pad
 * included — the legacy "$1,500 pad became $15" defect cannot be expressed.
 */
const rate = z.number().min(0).max(1);

export const PayPlan = z.object({
  id: Uuid,
  organization_id: Uuid,
  user_id: Uuid,
  store_id: Uuid.nullable(),
  commission_rate: rate,
  has_pad: z.boolean(),
  pad_cents: NonNegativeCents,
  has_tiered_rate: z.boolean(),
  tier_threshold_cents: NonNegativeCents.nullable(),
  tier_rate: rate.nullable(),
  /** This person earns `override_rate` on that person's funded deals. */
  override_on_user_id: Uuid.nullable(),
  override_rate: rate.nullable(),
  active: z.boolean(),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});

export const CreatePayPlanInput = z
  .strictObject({
    organization_id: Uuid,
    user_id: Uuid,
    store_id: Uuid.optional(),
    commission_rate: rate,
    has_pad: z.boolean().default(false),
    pad_cents: NonNegativeCents.default(0),
    has_tiered_rate: z.boolean().default(false),
    tier_threshold_cents: NonNegativeCents.optional(),
    tier_rate: rate.optional(),
    override_on_user_id: Uuid.optional(),
    override_rate: rate.optional(),
  })
  .refine((p) => !p.has_tiered_rate || (p.tier_threshold_cents !== undefined && p.tier_rate !== undefined), {
    message: 'A tier needs both a threshold and a rate',
    path: ['tier_rate'],
  })
  .refine((p) => (p.override_on_user_id === undefined) === (p.override_rate === undefined), {
    message: 'An override needs both the person and the rate',
    path: ['override_rate'],
  });

/** Defaults-free (the F-05 lesson): a PATCH carries only what it changes. */
export const UpdatePayPlanInput = z.strictObject({
  commission_rate: rate.optional(),
  has_pad: z.boolean().optional(),
  pad_cents: NonNegativeCents.optional(),
  has_tiered_rate: z.boolean().optional(),
  tier_threshold_cents: NonNegativeCents.nullable().optional(),
  tier_rate: rate.nullable().optional(),
  override_on_user_id: Uuid.nullable().optional(),
  override_rate: rate.nullable().optional(),
  active: z.boolean().optional(),
});

export const CommissionKind = z.enum(['sale', 'override', 'clawback']);

/** A written line: what was paid, to whom, and the numbers behind it. */
export const Commission = z.object({
  id: Uuid,
  organization_id: Uuid,
  deal_id: Uuid,
  user_id: Uuid,
  kind: CommissionKind,
  total_gross_cents: z.number().int(),
  gross_for_commission_cents: z.number().int(),
  applied_rate: rate,
  amount_cents: z.number().int(),
  funded_at: IsoDateTime,
  created_at: IsoDateTime,
});

export const ClawbackStatus = z.enum(['flagged', 'reversed']);

/**
 * F-79 (commissions-clawbacks.md §8, §11.4): one lifecycle row per clawback —
 * terminal per commission line (D-080). The negative commissions line is
 * derived from THIS row at confirm time, never sent by a client. `created_at`
 * is the flag moment (0072 carries no separate flagged_at column).
 */
export const CommissionClawback = z.object({
  id: Uuid,
  organization_id: Uuid,
  deal_id: Uuid,
  commission_id: Uuid,
  status: ClawbackStatus,
  reason: z.string(),
  original_amount_cents: z.number().int(),
  reversed_amount_cents: z.number().int(),
  flagged_by: Uuid,
  confirmed_by: Uuid.nullable(),
  confirmed_at: IsoDateTime.nullable(),
  created_at: IsoDateTime,
});

export const FlagClawbackInput = z.strictObject({
  organization_id: Uuid,
  commission_id: Uuid,
  reason: z.string().trim().min(3).max(500),
  /** Partial allowed: 0 < reversed ≤ the line's amount (server re-checks). */
  reversed_amount_cents: z.number().int().positive(),
});

export const ClawbackListQuery = CursorQuery.extend({
  organization_id: Uuid.optional(),
  deal_id: Uuid.optional(),
  commission_id: Uuid.optional(),
});

export const PayPlanListQuery = CursorQuery.extend({
  organization_id: Uuid.optional(),
  user_id: Uuid.optional(),
});

export const CommissionListQuery = CursorQuery.extend({
  organization_id: Uuid.optional(),
  user_id: Uuid.optional(),
  deal_id: Uuid.optional(),
});

export type PayPlanT = z.infer<typeof PayPlan>;
export type CommissionClawbackT = z.infer<typeof CommissionClawback>;
export type FlagClawbackInputT = z.infer<typeof FlagClawbackInput>;
export type CommissionT = z.infer<typeof Commission>;
export type CreatePayPlanInputT = z.infer<typeof CreatePayPlanInput>;
export type UpdatePayPlanInputT = z.infer<typeof UpdatePayPlanInput>;
