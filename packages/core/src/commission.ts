/**
 * Commission engine (A-06) — the corrected §11 rules from
 * commissions-clawbacks.md, INTEGER CENTS (ADR-009). Fixes the audited
 * defects: F2 (the $1,500 pad is 150,000 cents, never mixed units), F4
 * (every overrider is paid — override relationships are the CALLER's lookup
 * of receiver rows, independent of the seller's own fields). Tier resolution
 * uses the funded-month gross the caller computed over the half-open
 * tenant-timezone month [monthStart, nextMonthStart).
 */

export interface CommissionPlan {
  /** Base commission rate as a decimal (0.25 = 25%). */
  rate: number;
  hasPad: boolean;
  padCents: number;
  hasTieredRate?: boolean;
  /** Tier applies strictly ABOVE this monthly funded gross. */
  tierThresholdCents?: number;
  tierRate?: number;
}

export interface Overrider {
  salespersonId: string;
  overrideRate: number;
}

export interface CommissionInput {
  salePriceCents: number;
  vehicleCostCents: number;
  fiReserveCents: number;
  plan: CommissionPlan;
  /** Seller's funded gross for the deal's funded month (tier resolution). */
  fundedMonthlyGrossCents?: number;
  overriders?: Overrider[];
}

export interface OverrideLine {
  salespersonId: string;
  amountCents: number;
}

export interface CommissionResult {
  totalGrossCents: number;
  grossForCommissionCents: number;
  appliedRate: number;
  commissionCents: number;
  overrides: OverrideLine[];
}

export function calculateCommission(input: CommissionInput): CommissionResult {
  const { plan } = input;
  const totalGross =
    (input.salePriceCents || 0) - (input.vehicleCostCents || 0) + (input.fiReserveCents || 0);

  // Pad BEFORE rate (D-4), floored at zero.
  const pad = plan.hasPad ? plan.padCents || 0 : 0;
  const grossForCommission = Math.max(0, totalGross - pad);

  // Tier: strictly greater-than the threshold (§11 half-open month upstream).
  const tierApplies =
    plan.hasTieredRate === true &&
    (input.fundedMonthlyGrossCents ?? 0) > (plan.tierThresholdCents ?? Infinity);
  const appliedRate = tierApplies ? (plan.tierRate ?? plan.rate) : plan.rate;

  const commission = Math.round(grossForCommission * appliedRate);

  const overrides: OverrideLine[] = (input.overriders ?? []).map((o) => ({
    salespersonId: o.salespersonId,
    amountCents: Math.round(grossForCommission * o.overrideRate),
  }));

  return {
    totalGrossCents: totalGross,
    grossForCommissionCents: grossForCommission,
    appliedRate,
    commissionCents: commission,
    overrides,
  };
}
