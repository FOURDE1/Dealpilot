/**
 * Canadian vehicle sales tax engine (A-06) — ported from the canonical legacy
 * canadianTaxRates.js, INTEGER CENTS in/out (ADR-009). Rates effective
 * 2025-2026; QC QST applies to the price excluding GST (rule since 2013).
 */

export interface ProvinceTax {
  name: string;
  nameFr: string;
  taxType: 'GST' | 'GST+PST' | 'GST+QST' | 'HST';
  gst: number;
  pst: number;
  hst: number;
  pstOnGst: boolean;
  tradeInTaxCredit: boolean;
}

export const PROVINCES: Record<string, ProvinceTax> = {
  AB: { name: 'Alberta', nameFr: 'Alberta', taxType: 'GST', gst: 0.05, pst: 0, hst: 0, pstOnGst: false, tradeInTaxCredit: true },
  BC: { name: 'British Columbia', nameFr: 'Colombie-Britannique', taxType: 'GST+PST', gst: 0.05, pst: 0.07, hst: 0, pstOnGst: false, tradeInTaxCredit: false },
  MB: { name: 'Manitoba', nameFr: 'Manitoba', taxType: 'GST+PST', gst: 0.05, pst: 0.07, hst: 0, pstOnGst: false, tradeInTaxCredit: false },
  NB: { name: 'New Brunswick', nameFr: 'Nouveau-Brunswick', taxType: 'HST', gst: 0, pst: 0, hst: 0.15, pstOnGst: false, tradeInTaxCredit: true },
  NL: { name: 'Newfoundland & Labrador', nameFr: 'Terre-Neuve-et-Labrador', taxType: 'HST', gst: 0, pst: 0, hst: 0.15, pstOnGst: false, tradeInTaxCredit: true },
  NS: { name: 'Nova Scotia', nameFr: 'Nouvelle-Écosse', taxType: 'HST', gst: 0, pst: 0, hst: 0.14, pstOnGst: false, tradeInTaxCredit: true },
  NT: { name: 'Northwest Territories', nameFr: 'Territoires du Nord-Ouest', taxType: 'GST', gst: 0.05, pst: 0, hst: 0, pstOnGst: false, tradeInTaxCredit: true },
  NU: { name: 'Nunavut', nameFr: 'Nunavut', taxType: 'GST', gst: 0.05, pst: 0, hst: 0, pstOnGst: false, tradeInTaxCredit: true },
  ON: { name: 'Ontario', nameFr: 'Ontario', taxType: 'HST', gst: 0, pst: 0, hst: 0.13, pstOnGst: false, tradeInTaxCredit: true },
  PE: { name: 'Prince Edward Island', nameFr: 'Île-du-Prince-Édouard', taxType: 'HST', gst: 0, pst: 0, hst: 0.15, pstOnGst: false, tradeInTaxCredit: true },
  QC: { name: 'Quebec', nameFr: 'Québec', taxType: 'GST+QST', gst: 0.05, pst: 0.09975, hst: 0, pstOnGst: false, tradeInTaxCredit: true },
  SK: { name: 'Saskatchewan', nameFr: 'Saskatchewan', taxType: 'GST+PST', gst: 0.05, pst: 0.06, hst: 0, pstOnGst: false, tradeInTaxCredit: true },
  YT: { name: 'Yukon', nameFr: 'Yukon', taxType: 'GST', gst: 0.05, pst: 0, hst: 0, pstOnGst: false, tradeInTaxCredit: true },
};

export const PROVINCE_CODES = Object.keys(PROVINCES);

function province(code: string): ProvinceTax {
  return PROVINCES[code] ?? PROVINCES['QC']!;
}

export interface TaxBreakdownLine {
  label: string;
  rate: number;
  amount_cents: number;
}

export interface TaxResult {
  gst_cents: number;
  pst_cents: number;
  hst_cents: number;
  total_cents: number;
  breakdown: TaxBreakdownLine[];
  exempt: boolean;
}

/**
 * Split tax on a pre-tax taxable amount. Each component is rounded to a cent
 * independently — the per-line amounts are what land in the deal's split tax
 * columns (gst_cents/qst_cents/...), never a blended-rate recompute.
 * `exempt` = Section 87 Indian Act exemption: everything is zero.
 */
export function calculateTaxesCents(
  taxableCents: number,
  provinceCode: string,
  opts: { exempt?: boolean } = {},
): TaxResult {
  const p = province(provinceCode);
  if (opts.exempt || !Number.isFinite(taxableCents) || taxableCents <= 0) {
    return {
      gst_cents: 0, pst_cents: 0, hst_cents: 0, total_cents: 0,
      breakdown: opts.exempt ? [{ label: 'Section 87 Exempt', rate: 0, amount_cents: 0 }] : [],
      exempt: !!opts.exempt,
    };
  }
  const gst = p.gst > 0 ? Math.round(taxableCents * p.gst) : 0;
  const pstBase = p.pstOnGst ? taxableCents + gst : taxableCents;
  const pst = p.pst > 0 ? Math.round(pstBase * p.pst) : 0;
  const hst = p.hst > 0 ? Math.round(taxableCents * p.hst) : 0;
  const breakdown: TaxBreakdownLine[] = [];
  if (p.hst > 0) breakdown.push({ label: `HST (${(p.hst * 100).toFixed(2)}%)`, rate: p.hst, amount_cents: hst });
  if (p.gst > 0) breakdown.push({ label: `GST (${(p.gst * 100).toFixed(2)}%)`, rate: p.gst, amount_cents: gst });
  if (p.pst > 0) {
    breakdown.push({
      label: `${provinceCode === 'QC' ? 'QST' : 'PST'} (${(p.pst * 100).toFixed(3)}%)`,
      rate: p.pst,
      amount_cents: pst,
    });
  }
  return { gst_cents: gst, pst_cents: pst, hst_cents: hst, total_cents: gst + pst + hst, breakdown, exempt: false };
}

/** Vehicle taxable amount honoring the province's trade-in credit rule. */
export function taxableVehicleAmountCents(
  salePriceCents: number,
  tradeAllowanceCents: number,
  provinceCode: string,
): number {
  const p = province(provinceCode);
  const sp = Math.max(0, salePriceCents || 0);
  if (!p.tradeInTaxCredit) return sp;
  return Math.max(0, sp - (tradeAllowanceCents || 0));
}

/** Blended rate — for tax-on-payment leases only, never for split columns. */
export function combinedTaxRate(provinceCode: string): number {
  const p = province(provinceCode);
  if (p.hst > 0) return p.hst;
  if (p.pstOnGst) return p.gst + (1 + p.gst) * p.pst - 1;
  return p.gst + p.pst;
}
