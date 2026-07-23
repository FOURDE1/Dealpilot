import {
  calculateTaxesCents,
  combinedTaxRate,
  taxableVehicleAmountCents,
  type TaxResult,
} from './tax.js';
import {
  biweeklyFromMonthlyCents,
  leaseMonthlyBaseCents,
  monthlyPaymentCents,
  weeklyFromMonthlyCents,
} from './finance.js';

/**
 * Deal desking engine (A-06) — port of the CANONICAL legacy computeDeal
 * (deskingCalculations.js; desking-finance.md §16 D-1..D-12 resolutions),
 * INTEGER CENTS everywhere (ADR-009), with the audited corrections:
 * - F6/D-12: rebates are POST-tax — the taxable base ignores them; they only
 *   reduce what is financed/due (legacy undercharged tax).
 * - F2 companion: no dollars/cents split-brain — one unit, cents.
 */

export type DealType = 'finance' | 'lease' | 'cash';
export const DEAL_TYPES: DealType[] = ['finance', 'lease', 'cash'];

export interface TradeInput {
  allowanceCents: number;
  acvCents?: number;
  lienCents?: number;
}

export interface LineItem {
  amountCents: number;
  taxable?: boolean;
  enabled?: boolean;
}

export interface FiProductInput {
  priceCents: number;
  costCents?: number;
  taxable?: boolean;
  enabled?: boolean;
}

export interface DeskingInput {
  salePriceCents: number;
  msrpCents?: number;
  vehicleCostCents?: number;
  trades?: TradeInput[];
  dealType?: DealType;
  cashDownCents?: number;
  rebatesCents?: number[];
  interestRatePct?: number;
  termMonths?: number;
  residualPercent?: number;
  moneyFactor?: number;
  leaseTermMonths?: number;
  fees?: LineItem[];
  fiProducts?: FiProductInput[];
  provinceCode?: string;
  /** Section 87 Indian Act exemption. */
  taxExempt?: boolean;
}

export interface TradeSummary extends Required<TradeInput> {
  equityCents: number;
  /** positive = over-allowed: the dealer paid more than ACV, cutting gross. */
  spreadCents: number;
}

export interface PaymentSummary {
  monthlyCents: number;
  biweeklyCents: number;
  weeklyCents: number;
  termMonths: number;
  ratePct: number;
  financedCents: number;
  totalCostCents: number;
}

export interface DeskingResult {
  salePriceCents: number;
  rebatesTotalCents: number;
  trades: TradeSummary[];
  totalTradeAllowanceCents: number;
  totalTradeEquityCents: number;
  totalTradeSpreadCents: number;
  taxableBaseCents: number;
  taxes: TaxResult;
  feesTotalCents: number;
  fiRevenueCents: number;
  fiCostCents: number;
  fiGrossCents: number;
  amountFinancedCents: number;
  financeMonthlyCents: number;
  costOfBorrowingCents: number;
  adjustedCapCostCents: number;
  residualCents: number;
  leaseBaseCents: number;
  leaseTaxOnPaymentCents: number;
  leaseMonthlyCents: number;
  cashSubtotalCents: number;
  cashTotalDueCents: number;
  frontGrossCents: number;
  totalGrossCents: number;
  active: PaymentSummary | null;
  dealType: DealType;
  provinceCode: string;
}

const enabled = <T extends { enabled?: boolean }>(items: T[] | undefined): T[] =>
  (items ?? []).filter((i) => i && i.enabled !== false);

export function computeDeal(input: DeskingInput): DeskingResult {
  const {
    salePriceCents = 0,
    msrpCents = 0,
    vehicleCostCents = 0,
    dealType = 'finance',
    cashDownCents = 0,
    interestRatePct = 0,
    termMonths = 60,
    residualPercent = 55,
    moneyFactor = 0.00125,
    leaseTermMonths = 48,
    provinceCode = 'QC',
    taxExempt = false,
  } = input;

  const sp = Math.max(0, salePriceCents);
  const rebatesTotal = (input.rebatesCents ?? []).reduce((a, r) => a + (r || 0), 0);

  const trades: TradeSummary[] = (input.trades ?? []).map((t) => {
    const allowanceCents = t.allowanceCents || 0;
    const acvCents = t.acvCents ?? 0;
    const lienCents = t.lienCents ?? 0;
    return {
      allowanceCents,
      acvCents,
      lienCents,
      equityCents: allowanceCents - lienCents,
      spreadCents: allowanceCents - acvCents,
    };
  });
  const totalTradeAllowance = trades.reduce((a, t) => a + t.allowanceCents, 0);
  const totalTradeEquity = trades.reduce((a, t) => a + t.equityCents, 0);
  const totalTradeSpread = trades.reduce((a, t) => a + t.spreadCents, 0);

  const fees = enabled(input.fees);
  const feesTotal = fees.reduce((a, f) => a + (f.amountCents || 0), 0);
  const taxableFees = fees.reduce((a, f) => a + (f.taxable ? f.amountCents || 0 : 0), 0);

  const products = enabled(input.fiProducts);
  const fiRevenue = products.reduce((a, p) => a + (p.priceCents || 0), 0);
  const fiCost = products.reduce((a, p) => a + (p.costCents ?? 0), 0);
  const fiGross = fiRevenue - fiCost;
  const taxableFi = products.reduce((a, p) => a + (p.taxable !== false ? p.priceCents || 0 : 0), 0);

  // F6/D-12 correction: rebates do NOT shrink the taxable base.
  const vehicleTaxable = taxableVehicleAmountCents(sp, totalTradeAllowance, provinceCode);
  const taxableBase = Math.max(0, vehicleTaxable + taxableFees + taxableFi);
  const taxes = calculateTaxesCents(taxableBase, provinceCode, { exempt: taxExempt });

  // Finance: rebates apply post-tax, reducing what is financed.
  const amountFinanced = Math.max(
    0,
    sp + taxes.total_cents + feesTotal + fiRevenue - cashDownCents - totalTradeEquity - rebatesTotal,
  );
  const financeMonthly = monthlyPaymentCents(amountFinanced, interestRatePct, termMonths);
  const financeTotalPaid = financeMonthly * termMonths;
  const costOfBorrowing = Math.max(0, financeTotalPaid - amountFinanced);

  // Lease (canonical: cap reductions include rebates; tax on payment).
  const capReductions = cashDownCents + totalTradeEquity + rebatesTotal;
  const adjustedCapCost = Math.max(0, sp - capReductions + feesTotal + fiRevenue);
  const residualCents = Math.round((msrpCents || sp) * (residualPercent / 100));
  const leaseBase = leaseMonthlyBaseCents(adjustedCapCost, residualCents, moneyFactor, leaseTermMonths);
  const leaseTaxOnPayment = taxExempt ? 0 : Math.round(leaseBase * combinedTaxRate(provinceCode));
  const leaseMonthly = leaseBase + leaseTaxOnPayment;
  const leaseTotalCost = leaseMonthly * leaseTermMonths + cashDownCents;

  // Cash.
  const cashSubtotal = Math.max(0, sp - totalTradeEquity - rebatesTotal);
  const cashTotalDue = cashSubtotal + taxes.total_cents + feesTotal + fiRevenue;

  // Profitability: over-allowed trades cut gross.
  const frontGross = sp - vehicleCostCents;
  const totalGross = frontGross + fiGross - totalTradeSpread;

  const summaries: Record<DealType, PaymentSummary> = {
    finance: {
      monthlyCents: financeMonthly,
      biweeklyCents: biweeklyFromMonthlyCents(financeMonthly),
      weeklyCents: weeklyFromMonthlyCents(financeMonthly),
      termMonths,
      ratePct: interestRatePct,
      financedCents: amountFinanced,
      totalCostCents: financeTotalPaid + cashDownCents + totalTradeEquity + rebatesTotal,
    },
    lease: {
      monthlyCents: leaseMonthly,
      biweeklyCents: biweeklyFromMonthlyCents(leaseMonthly),
      weeklyCents: weeklyFromMonthlyCents(leaseMonthly),
      termMonths: leaseTermMonths,
      ratePct: moneyFactor * 2400,
      financedCents: adjustedCapCost,
      totalCostCents: leaseTotalCost,
    },
    cash: {
      monthlyCents: 0,
      biweeklyCents: 0,
      weeklyCents: 0,
      termMonths: 0,
      ratePct: 0,
      financedCents: cashTotalDue,
      totalCostCents: cashTotalDue,
    },
  };

  return {
    salePriceCents: sp,
    rebatesTotalCents: rebatesTotal,
    trades,
    totalTradeAllowanceCents: totalTradeAllowance,
    totalTradeEquityCents: totalTradeEquity,
    totalTradeSpreadCents: totalTradeSpread,
    taxableBaseCents: taxableBase,
    taxes,
    feesTotalCents: feesTotal,
    fiRevenueCents: fiRevenue,
    fiCostCents: fiCost,
    fiGrossCents: fiGross,
    amountFinancedCents: amountFinanced,
    financeMonthlyCents: financeMonthly,
    costOfBorrowingCents: costOfBorrowing,
    adjustedCapCostCents: adjustedCapCost,
    residualCents,
    leaseBaseCents: leaseBase,
    leaseTaxOnPaymentCents: leaseTaxOnPayment,
    leaseMonthlyCents: leaseMonthly,
    cashSubtotalCents: cashSubtotal,
    cashTotalDueCents: cashTotalDue,
    frontGrossCents: frontGross,
    totalGrossCents: totalGross,
    active: summaries[dealType] ?? null,
    dealType,
    provinceCode,
  };
}
