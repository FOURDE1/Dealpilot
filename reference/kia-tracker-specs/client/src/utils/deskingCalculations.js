import { calculateTaxes, taxableAmountForVehicle, combinedTaxRate, PROVINCES } from './canadianTaxRates';

export const DEAL_TYPES = ['finance', 'lease', 'cash'];

export function formatCurrency(n, locale = 'en-CA') {
  const v = Number.isFinite(Number(n)) ? Number(n) : 0;
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'CAD', minimumFractionDigits: 2 }).format(v);
}

export function formatPercent(n, digits = 2) {
  const v = Number.isFinite(Number(n)) ? Number(n) : 0;
  return `${v.toFixed(digits)}%`;
}

// Standard amortization formula. rate is monthly decimal.
export function monthlyPayment(principal, annualRatePct, termMonths) {
  const P = Number(principal) || 0;
  const n = Number(termMonths) || 0;
  const r = (Number(annualRatePct) || 0) / 100 / 12;
  if (P <= 0 || n <= 0) return 0;
  if (r === 0) return P / n;
  return (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

export function biweeklyFromMonthly(monthly) {
  return (Number(monthly) || 0) * 12 / 26;
}

export function weeklyFromMonthly(monthly) {
  return (Number(monthly) || 0) * 12 / 52;
}

// Lease payment using money factor.
// Base monthly (pre-tax) = depreciation + finance charge.
export function leaseMonthlyBase(adjustedCapCost, residual, moneyFactor, termMonths) {
  const acc = Number(adjustedCapCost) || 0;
  const res = Number(residual) || 0;
  const mf = Number(moneyFactor) || 0;
  const n = Number(termMonths) || 0;
  if (n <= 0) return 0;
  const depreciation = (acc - res) / n;
  const financeCharge = (acc + res) * mf;
  return depreciation + financeCharge;
}

// Sum line items that can be either a flat number or { amount, enabled }.
export function sumEnabled(entries) {
  return entries.reduce((acc, e) => {
    if (!e) return acc;
    if (typeof e === 'number') return acc + e;
    if (e.enabled === false) return acc;
    return acc + (Number(e.amount) || 0);
  }, 0);
}

// ---------------------------------------------------------------
// The heart: given the full desking state, compute everything.
// ---------------------------------------------------------------
export function computeDeal(state) {
  const {
    salePrice = 0,
    msrp = 0,
    vehicleCost = 0,
    trades = [],
    dealType = 'finance',
    cashDown = 0,
    rebates = [],
    interestRate = 0,
    term = 60,
    residualPercent = 55,
    moneyFactor = 0.00125,
    leaseTerm = 48,
    fees = [],
    fiProducts = [],
    provinceCode = 'QC',
    nativeStatus = false,
  } = state;

  const sp = Number(salePrice) || 0;
  const rebatesTotal = sumEnabled(rebates);

  // --- Trade math ---
  const tradeSummary = (trades || []).map((t) => {
    const allowance = Number(t.allowance) || 0;
    const acv = Number(t.acv) || 0;
    const lien = Number(t.lien) || 0;
    return {
      ...t,
      allowance,
      acv,
      lien,
      equity: allowance - lien,
      spread: allowance - acv, // positive = over-allowed (dealer pays more than ACV)
    };
  });
  const totalTradeAllowance = tradeSummary.reduce((a, t) => a + t.allowance, 0);
  const totalTradeEquity = tradeSummary.reduce((a, t) => a + t.equity, 0);
  const totalTradeSpread = tradeSummary.reduce((a, t) => a + t.spread, 0);

  // --- Fees & F&I ---
  const enabledFees = (fees || []).filter((f) => f && f.enabled !== false);
  const feesTotal = enabledFees.reduce((a, f) => a + (Number(f.amount) || 0), 0);
  const taxableFees = enabledFees.reduce((a, f) => a + (f.taxable ? (Number(f.amount) || 0) : 0), 0);

  const enabledProducts = (fiProducts || []).filter((p) => p && p.enabled !== false);
  const fiRevenue = enabledProducts.reduce((a, p) => a + (Number(p.price) || 0), 0);
  const fiCost = enabledProducts.reduce((a, p) => a + (Number(p.cost) || 0), 0);
  const fiGross = fiRevenue - fiCost;
  const taxableFi = enabledProducts.reduce((a, p) => a + (p.taxable !== false ? (Number(p.price) || 0) : 0), 0);

  // --- Taxable base ---
  const vehicleTaxable = taxableAmountForVehicle(sp, totalTradeAllowance, provinceCode);
  const taxableBase = Math.max(0, vehicleTaxable + taxableFees + taxableFi - rebatesTotal);
  const taxes = calculateTaxes(taxableBase, provinceCode, nativeStatus);

  // --- Finance calc ---
  const totalDownFinance = (Number(cashDown) || 0) + totalTradeEquity + rebatesTotal;
  const amountFinanced = Math.max(
    0,
    sp + taxes.total + feesTotal + fiRevenue - (Number(cashDown) || 0) - totalTradeEquity - rebatesTotal
  );
  const financeMonthly = monthlyPayment(amountFinanced, interestRate, term);
  const financeTotalPaid = financeMonthly * term;
  const costOfBorrowing = Math.max(0, financeTotalPaid - amountFinanced);

  // --- Lease calc ---
  const capCost = sp;
  const capReductions = (Number(cashDown) || 0) + totalTradeEquity + rebatesTotal;
  const adjustedCapCost = Math.max(0, capCost - capReductions + feesTotal + fiRevenue);
  const residualDollar = (Number(msrp) || sp) * ((Number(residualPercent) || 0) / 100);
  const leaseBase = leaseMonthlyBase(adjustedCapCost, residualDollar, moneyFactor, leaseTerm);
  const leaseTaxRate = combinedTaxRate(provinceCode);
  const leaseTaxOnPayment = nativeStatus ? 0 : leaseBase * leaseTaxRate;
  const leaseMonthly = leaseBase + leaseTaxOnPayment;
  const equivalentApr = (Number(moneyFactor) || 0) * 2400;
  const leaseTotalCost = leaseMonthly * leaseTerm + (Number(cashDown) || 0);

  // --- Cash calc ---
  const cashSubtotal = Math.max(0, sp - totalTradeEquity - rebatesTotal);
  const cashTotalDue = cashSubtotal + taxes.total + feesTotal + fiRevenue;

  // --- Profitability ---
  const frontGross = sp - (Number(vehicleCost) || 0);
  const totalGross = frontGross + fiGross + totalTradeSpread * -1; // over-allowed trade cuts gross
  const grossPct = sp > 0 ? (totalGross / sp) * 100 : 0;

  // Pick the current deal-type payment for the summary.
  const active = {
    finance: {
      monthly: financeMonthly,
      biweekly: biweeklyFromMonthly(financeMonthly),
      weekly: weeklyFromMonthly(financeMonthly),
      term,
      rate: interestRate,
      financed: amountFinanced,
      totalCost: financeTotalPaid + totalDownFinance,
    },
    lease: {
      monthly: leaseMonthly,
      biweekly: biweeklyFromMonthly(leaseMonthly),
      weekly: weeklyFromMonthly(leaseMonthly),
      term: leaseTerm,
      rate: equivalentApr,
      financed: adjustedCapCost,
      totalCost: leaseTotalCost,
    },
    cash: {
      monthly: 0,
      biweekly: 0,
      weekly: 0,
      term: 0,
      rate: 0,
      financed: cashTotalDue,
      totalCost: cashTotalDue,
    },
  }[dealType] || null;

  return {
    // inputs echoed for display
    salePrice: sp,
    msrp: Number(msrp) || 0,
    vehicleCost: Number(vehicleCost) || 0,
    rebatesTotal,
    // trades
    trades: tradeSummary,
    totalTradeAllowance,
    totalTradeEquity,
    totalTradeSpread,
    // taxes
    taxableBase,
    taxes,
    // fees & FI
    feesTotal,
    taxableFees,
    fiRevenue,
    fiCost,
    fiGross,
    // finance
    totalDownFinance,
    amountFinanced,
    financeMonthly,
    financeBiweekly: biweeklyFromMonthly(financeMonthly),
    financeWeekly: weeklyFromMonthly(financeMonthly),
    financeTotalPaid,
    costOfBorrowing,
    // lease
    capCost,
    capReductions,
    adjustedCapCost,
    residualDollar,
    leaseBase,
    leaseTaxOnPayment,
    leaseMonthly,
    leaseBiweekly: biweeklyFromMonthly(leaseMonthly),
    leaseWeekly: weeklyFromMonthly(leaseMonthly),
    equivalentApr,
    leaseTotalCost,
    // cash
    cashSubtotal,
    cashTotalDue,
    // profit
    frontGross,
    totalGross,
    grossPct,
    // active payment
    active,
    dealType,
    provinceCode,
    nativeStatus,
    province: PROVINCES[provinceCode] || PROVINCES.QC,
  };
}
