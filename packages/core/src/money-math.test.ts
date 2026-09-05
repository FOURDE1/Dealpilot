import { describe, expect, it } from 'vitest';
import {
  PROVINCES,
  calculateTaxesCents,
  taxableVehicleAmountCents,
  combinedTaxRate,
  monthlyPaymentCents,
  biweeklyFromMonthlyCents,
  weeklyFromMonthlyCents,
  leaseMonthlyBaseCents,
  computeDeal,
  calculateCommission,
  buildClawbackLine,
} from './index.js';

/**
 * A-06 golden-number suite (ROADMAP 0.6). Values verified by hand against the
 * canonical legacy engine (deskingCalculations.js / canadianTaxRates.js) and
 * the CORRECTED rules of commissions-clawbacks.md §11 + desking-finance.md
 * §16 — including the five audited money bugs (gap-analysis §F). ALL money is
 * INTEGER CENTS (ADR-009).
 */

describe('tax engine', () => {
  it('QC splits GST/QST on $10,000 exactly', () => {
    const t = calculateTaxesCents(1_000_000, 'QC');
    expect(t.gst_cents).toBe(50_000);
    expect(t.pst_cents).toBe(99_750); // QST 9.975% on price excluding GST
    expect(t.hst_cents).toBe(0);
    expect(t.total_cents).toBe(149_750);
  });

  it('ON is single HST 13%', () => {
    const t = calculateTaxesCents(1_000_000, 'ON');
    expect(t.hst_cents).toBe(130_000);
    expect(t.total_cents).toBe(130_000);
  });

  it('Section 87 exemption zeroes everything', () => {
    const t = calculateTaxesCents(1_000_000, 'QC', { exempt: true });
    expect(t.total_cents).toBe(0);
    expect(t.exempt).toBe(true);
  });

  it('trade-in credit applies per province: QC yes, BC no', () => {
    expect(taxableVehicleAmountCents(3_000_000, 1_000_000, 'QC')).toBe(2_000_000);
    expect(taxableVehicleAmountCents(3_000_000, 1_000_000, 'BC')).toBe(3_000_000);
    expect(taxableVehicleAmountCents(1_000_000, 2_000_000, 'QC')).toBe(0); // never negative
  });

  it('combined rate: QC 14.975%, ON 13%', () => {
    expect(combinedTaxRate('QC')).toBeCloseTo(0.14975, 10);
    expect(combinedTaxRate('ON')).toBeCloseTo(0.13, 10);
  });

  it('all 13 provinces exist with a tax type', () => {
    expect(Object.keys(PROVINCES)).toHaveLength(13);
  });
});

describe('amortization', () => {
  it('finance payment golden: $20,000 @ 6% / 60mo = $386.66', () => {
    expect(monthlyPaymentCents(2_000_000, 6, 60)).toBe(38_666);
  });

  it('zero rate divides evenly', () => {
    expect(monthlyPaymentCents(1_200_000, 0, 60)).toBe(20_000);
  });

  it('degenerate inputs pay zero', () => {
    expect(monthlyPaymentCents(0, 6, 60)).toBe(0);
    expect(monthlyPaymentCents(2_000_000, 6, 0)).toBe(0);
  });

  it('biweekly and weekly derive from monthly (×12/26, ×12/52)', () => {
    expect(biweeklyFromMonthlyCents(38_666)).toBe(17_846);
    expect(weeklyFromMonthlyCents(38_666)).toBe(8_923);
  });

  it('lease base golden: cap $30k, residual $16.5k, mf 0.00125, 48mo = $339.38', () => {
    expect(leaseMonthlyBaseCents(3_000_000, 1_650_000, 0.00125, 48)).toBe(33_938);
  });
});

describe('desking (computeDeal, cents)', () => {
  const base = {
    salePriceCents: 3_000_000,
    msrpCents: 3_000_000,
    vehicleCostCents: 2_700_000,
    provinceCode: 'QC' as const,
    dealType: 'finance' as const,
    interestRatePct: 6,
    termMonths: 60,
  };

  it('simple QC finance deal: taxes, amount financed, payment, gross', () => {
    const d = computeDeal(base);
    expect(d.taxes.total_cents).toBe(449_250); // 14.975% of $30,000
    expect(d.amountFinancedCents).toBe(3_449_250);
    expect(d.financeMonthlyCents).toBe(monthlyPaymentCents(3_449_250, 6, 60));
    expect(d.frontGrossCents).toBe(300_000);
    expect(d.totalGrossCents).toBe(300_000);
  });

  it('F6 CORRECTED: rebates are POST-tax — tax base ignores the rebate', () => {
    const d = computeDeal({ ...base, rebatesCents: [200_000] });
    // Legacy undercharged: $28,000 × 14.975% = $419,300c. Corrected: tax on full $30,000.
    expect(d.taxes.total_cents).toBe(449_250);
    // The rebate still reduces what is financed.
    expect(d.amountFinancedCents).toBe(3_449_250 - 200_000);
  });

  it('trade-in: QC tax credit on allowance, equity reduces financing, spread cuts gross', () => {
    const d = computeDeal({
      ...base,
      trades: [{ allowanceCents: 1_000_000, acvCents: 900_000, lienCents: 400_000 }],
    });
    // Taxable = 30,000 − 10,000 = 20,000 → 299,500c
    expect(d.taxes.total_cents).toBe(299_500);
    expect(d.totalTradeEquityCents).toBe(600_000);
    expect(d.amountFinancedCents).toBe(3_000_000 + 299_500 - 600_000);
    // Over-allowance (allowance − ACV = $1,000) comes out of gross.
    expect(d.totalGrossCents).toBe(300_000 - 100_000);
  });

  it('fees and F&I: taxable flags respected, F&I gross adds to total gross', () => {
    const d = computeDeal({
      ...base,
      fees: [
        { amountCents: 49_900, taxable: false },
        { amountCents: 10_000, taxable: true },
      ],
      fiProducts: [{ priceCents: 250_000, costCents: 150_000, taxable: true }],
    });
    // Taxable base = 30,000 + 100 + 2,500 = 32,600 → ×14.975%
    expect(d.taxes.total_cents).toBe(Math.round(3_260_000 * 0.05) + Math.round(3_260_000 * 0.09975));
    expect(d.fiGrossCents).toBe(100_000);
    expect(d.totalGrossCents).toBe(400_000);
    expect(d.amountFinancedCents).toBe(3_000_000 + d.taxes.total_cents + 59_900 + 250_000);
  });

  it('lease: tax on payment at the combined rate; cash: total due', () => {
    const d = computeDeal({
      ...base,
      dealType: 'lease',
      residualPercent: 55,
      moneyFactor: 0.00125,
      leaseTermMonths: 48,
    });
    expect(d.leaseBaseCents).toBe(33_938);
    expect(d.leaseMonthlyCents).toBe(33_938 + 5_082);

    const cash = computeDeal({ ...base, dealType: 'cash' });
    expect(cash.cashTotalDueCents).toBe(3_000_000 + 449_250);
  });
});

describe('commission engine (corrected §11 rules)', () => {
  const PLAN_V03 = { rate: 0.25, hasPad: true, padCents: 150_000 };

  it('golden: Vendeur 03 deal with Vendeur 07 override', () => {
    const r = calculateCommission({
      salePriceCents: 3_500_000,
      vehicleCostCents: 3_000_000,
      fiReserveCents: 200_000,
      plan: PLAN_V03,
      overriders: [{ salespersonId: 'vendeur-07', overrideRate: 0.05 }],
    });
    expect(r.totalGrossCents).toBe(700_000);
    expect(r.grossForCommissionCents).toBe(550_000); // pad BEFORE rate
    expect(r.commissionCents).toBe(137_500);
    expect(r.overrides).toEqual([{ salespersonId: 'vendeur-07', amountCents: 27_500 }]);
  });

  it('F2 CORRECTED: the pad is $1,500 in cents — never $15', () => {
    const r = calculateCommission({
      salePriceCents: 2_000_000,
      vehicleCostCents: 1_900_000,
      fiReserveCents: 0,
      plan: PLAN_V03,
    });
    // gross $1,000 − pad $1,500 → floors at 0, not (100,000 − 1,500)
    expect(r.grossForCommissionCents).toBe(0);
    expect(r.commissionCents).toBe(0);
  });

  it('tier: Vendeur 10 jumps 25%→30% only above $60,000 funded monthly gross', () => {
    const plan = {
      rate: 0.25, hasPad: true, padCents: 150_000,
      hasTieredRate: true, tierThresholdCents: 6_000_000, tierRate: 0.3,
    };
    const deal = { salePriceCents: 3_000_000, vehicleCostCents: 2_500_000, fiReserveCents: 0, plan };
    const below = calculateCommission({ ...deal, fundedMonthlyGrossCents: 6_000_000 });
    expect(below.appliedRate).toBe(0.25); // threshold is exclusive: > not ≥
    const above = calculateCommission({ ...deal, fundedMonthlyGrossCents: 6_000_001 });
    expect(above.appliedRate).toBe(0.3);
    expect(above.commissionCents).toBe(Math.round(350_000 * 0.3));
  });

  it('F4 CORRECTED: every overrider is paid, independent of seller fields', () => {
    const r = calculateCommission({
      salePriceCents: 3_000_000,
      vehicleCostCents: 2_500_000,
      fiReserveCents: 100_000,
      plan: { rate: 0.2, hasPad: false, padCents: 0 },
      overriders: [
        { salespersonId: 'vendeur-09', overrideRate: 0.05 },
        { salespersonId: 'vendeur-07', overrideRate: 0.05 },
      ],
    });
    expect(r.grossForCommissionCents).toBe(600_000); // no pad
    expect(r.overrides).toHaveLength(2);
    expect(r.overrides[0]!.amountCents).toBe(30_000);
  });

  it('negative gross floors at zero commission but reports the true gross', () => {
    const r = calculateCommission({
      salePriceCents: 2_000_000,
      vehicleCostCents: 2_200_000,
      fiReserveCents: 0,
      plan: { rate: 0.3, hasPad: false, padCents: 0 },
    });
    expect(r.totalGrossCents).toBe(-200_000);
    expect(r.commissionCents).toBe(0);
  });
});

describe('clawback line builder (F-79 §11.4 — T-C1…T-C6)', () => {
  // The canonical line is RE-DERIVED from the engine, never hand-copied:
  // $35,000 sale on a $30,000 car with a $2,000 F&I reserve on the 25% +
  // $1,500-pad plan → total_gross 700 000¢, gfc 550 000¢, amount 137 500¢
  // (fiReserve ADDS into totalGross — the same inputs the A-06 golden above
  // and deskAndFund(3_500_000, 3_000_000, 200_000) in the API suite use).
  const canonical = calculateCommission({
    salePriceCents: 3_500_000,
    vehicleCostCents: 3_000_000,
    fiReserveCents: 200_000,
    plan: { rate: 0.25, hasPad: true, padCents: 150_000 },
  });
  const src = {
    totalGrossCents: canonical.totalGrossCents,
    grossForCommissionCents: canonical.grossForCommissionCents,
    appliedRate: canonical.appliedRate,
    amountCents: canonical.commissionCents,
  };
  const stamp = '2026-09-02T15:00:00.000Z';

  it('the canonical inputs are what the engine says they are', () => {
    expect(src.totalGrossCents).toBe(700_000);
    expect(src.grossForCommissionCents).toBe(550_000);
    expect(src.appliedRate).toBe(0.25);
    expect(src.amountCents).toBe(137_500);
  });

  it('T-C1: partial reversal — negative amount, inputs copied verbatim, funded_at echoes the stamp', () => {
    const line = buildClawbackLine(src, 50_000, stamp);
    expect(line.kind).toBe('clawback');
    expect(line.amount_cents).toBe(-50_000);
    expect(line.total_gross_cents).toBe(700_000);
    expect(line.gross_for_commission_cents).toBe(550_000);
    expect(line.applied_rate).toBe(0.25);
    expect(line.funded_at).toBe(stamp);
  });

  it('T-C2: full reversal', () => {
    expect(buildClawbackLine(src, 137_500, stamp).amount_cents).toBe(-137_500);
  });

  it('T-C3: reversing more than the line throws', () => {
    expect(() => buildClawbackLine(src, 137_501, stamp)).toThrow(RangeError);
  });

  it('T-C4: reversing zero throws', () => {
    expect(() => buildClawbackLine(src, 0, stamp)).toThrow(RangeError);
  });

  it('T-C5: reversing a negative amount throws', () => {
    expect(() => buildClawbackLine(src, -1, stamp)).toThrow(RangeError);
  });

  it('T-C6: a non-integer cent amount throws', () => {
    expect(() => buildClawbackLine(src, 0.5, stamp)).toThrow(RangeError);
  });
});
