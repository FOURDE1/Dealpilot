// Canadian Sales Tax Rates (effective 2025-2026).
// Sources: CRA, provincial revenue agencies.
// For QC: QST is applied to price excluding GST (rule in force since Jan 1, 2013).
// Combined effective rate in QC ≈ 14.975%.

export const PROVINCES = {
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

// Calculate taxes for a given pre-tax taxable amount.
// `nativeStatus` true => Section 87 Indian Act exemption, all zero.
export function calculateTaxes(taxableAmount, provinceCode, nativeStatus = false) {
  const p = PROVINCES[provinceCode] || PROVINCES.QC;
  if (nativeStatus || !taxableAmount || taxableAmount <= 0) {
    return {
      gst: 0, pst: 0, hst: 0, total: 0,
      breakdown: nativeStatus ? [{ label: 'Section 87 Exempt', rate: 0, amount: 0 }] : [],
      province: p,
      exempt: !!nativeStatus,
    };
  }
  const base = Number(taxableAmount) || 0;
  const gst = p.gst > 0 ? base * p.gst : 0;
  const pstBase = p.pstOnGst ? base + gst : base;
  const pst = p.pst > 0 ? pstBase * p.pst : 0;
  const hst = p.hst > 0 ? base * p.hst : 0;
  const total = gst + pst + hst;
  const breakdown = [];
  if (p.hst > 0) breakdown.push({ label: `HST (${(p.hst * 100).toFixed(2)}%)`, rate: p.hst, amount: hst });
  if (p.gst > 0) breakdown.push({ label: `GST (${(p.gst * 100).toFixed(2)}%)`, rate: p.gst, amount: gst });
  if (p.pst > 0) {
    const pstLabel = provinceCode === 'QC' ? 'QST' : 'PST';
    breakdown.push({ label: `${pstLabel} (${(p.pst * 100).toFixed(3)}%)`, rate: p.pst, amount: pst });
  }
  return { gst, pst, hst, total, breakdown, province: p, exempt: false };
}

// Taxable amount for a vehicle sale, honoring the province's trade-in credit rule.
// If the province gives credit, tax applies to (salePrice - tradeAllowance). Otherwise full salePrice.
export function taxableAmountForVehicle(salePrice, tradeAllowance, provinceCode) {
  const p = PROVINCES[provinceCode] || PROVINCES.QC;
  const sp = Number(salePrice) || 0;
  const ta = Number(tradeAllowance) || 0;
  if (p.tradeInTaxCredit) {
    return Math.max(0, sp - ta);
  }
  return Math.max(0, sp);
}

export function combinedTaxRate(provinceCode) {
  const p = PROVINCES[provinceCode] || PROVINCES.QC;
  if (p.hst > 0) return p.hst;
  if (p.pstOnGst) return p.gst + (1 + p.gst) * p.pst - 1;
  return p.gst + p.pst;
}
