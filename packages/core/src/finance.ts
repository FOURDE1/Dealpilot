/**
 * Loan amortization + lease payment math (A-06), INTEGER CENTS in/out
 * (ADR-009). Intermediates run in floats; every returned money value is
 * rounded ONCE at the end — never round-then-accumulate.
 */

/** Standard amortized monthly payment. Zero rate divides evenly. */
export function monthlyPaymentCents(principalCents: number, annualRatePct: number, termMonths: number): number {
  const P = principalCents || 0;
  const n = termMonths || 0;
  const r = (annualRatePct || 0) / 100 / 12;
  if (P <= 0 || n <= 0) return 0;
  if (r === 0) return Math.round(P / n);
  return Math.round((P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1));
}

/** Legacy-canonical conversions: 12 payments spread over 26 / 52 periods. */
export function biweeklyFromMonthlyCents(monthlyCents: number): number {
  return Math.round(((monthlyCents || 0) * 12) / 26);
}

export function weeklyFromMonthlyCents(monthlyCents: number): number {
  return Math.round(((monthlyCents || 0) * 12) / 52);
}

/** Lease base (pre-tax) = depreciation + finance charge via money factor. */
export function leaseMonthlyBaseCents(
  adjustedCapCostCents: number,
  residualCents: number,
  moneyFactor: number,
  termMonths: number,
): number {
  const acc = adjustedCapCostCents || 0;
  const res = residualCents || 0;
  const n = termMonths || 0;
  if (n <= 0) return 0;
  const depreciation = (acc - res) / n;
  const financeCharge = (acc + res) * (moneyFactor || 0);
  return Math.round(depreciation + financeCharge);
}
