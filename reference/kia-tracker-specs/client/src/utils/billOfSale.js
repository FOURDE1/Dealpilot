import { computeDeal, formatCurrency } from './deskingCalculations';
import { PROVINCES } from './canadianTaxRates';

export const BOS_SESSION_KEY = 'kia_bos_payload_v1';

// Transform the live desking state into a flat Bill of Sale payload.
// Critical rule: stop at "Total To Be Financed" — no cost of borrowing, no
// total-with-interest line.
export function getBillOfSaleData(state, deal = null) {
  const computed = computeDeal(state);
  const province = PROVINCES[state.provinceCode] || PROVINCES.QC;

  const salePrice = Number(state.salePrice) || 0;
  const omvicFee = state.provinceCode === 'ON' ? 10 : 0;

  // Fees — itemized (exclude admin/PPSA/freight etc)
  const fees = (state.fees || [])
    .filter((f) => f && f.enabled !== false && Number(f.amount) > 0)
    .map((f) => ({ id: f.id, label: f.label, amount: Number(f.amount) || 0, taxable: !!f.taxable }));
  const feesTotal = fees.reduce((s, f) => s + f.amount, 0);

  // F&I products — itemized
  const fiProducts = (state.fiProducts || [])
    .filter((p) => p && p.enabled !== false && Number(p.price) > 0)
    .map((p) => ({ id: p.id, label: p.label, price: Number(p.price) || 0, category: p.category }));
  const fiTotal = fiProducts.reduce((s, p) => s + p.price, 0);

  // Well-known products (pick out for explicit lines on the BoS)
  const findProduct = (id) => fiProducts.find((p) => p.id === id)?.price || 0;
  const extWarranty = findProduct('ext-warranty');
  const lifeInsurance = findProduct('life-ins');
  const ahInsurance = findProduct('disability-ins');

  // Well-known fees
  const findFee = (id) => fees.find((f) => f.id === id)?.amount || 0;
  const ppsaFee = findFee('rdprm'); // our state uses 'rdprm' id; PPSA in ON

  // Trade
  const trades = Array.isArray(state.trades) ? state.trades : [];
  const tradeAllowance = trades.reduce((s, t) => s + (Number(t?.allowance) || 0), 0);
  const tradeLien = trades.reduce((s, t) => s + (Number(t?.lien) || 0), 0);
  const tradeNetEquity = tradeAllowance - tradeLien;

  // Pricing stack
  const totalVehiclePrice = salePrice + omvicFee + extWarranty;
  const totalLessTrade = Math.max(0, totalVehiclePrice - tradeAllowance);
  const taxAmount = computed.taxes.total;
  const taxLabel = province.hst > 0 ? 'HST'
    : (province.gst > 0 && province.pst > 0) ? (state.provinceCode === 'QC' ? 'GST + QST' : 'GST + PST')
    : province.gst > 0 ? 'GST' : 'Tax';
  const totalPurchasePrice = totalLessTrade + taxAmount + feesTotal + fiTotal;
  const cashDown = Number(state.cashDown) || 0;
  const rebatesTotal = computed.rebatesTotal;
  const totalToBeFinanced = Math.max(0, totalPurchasePrice - cashDown - rebatesTotal - tradeNetEquity + tradeAllowance - tradeAllowance);
  // simpler: state engine already has the "correct" number:
  const amountFinanced = computed.amountFinanced;

  // Payment frequency — assume monthly for BoS (we compute monthly only).
  const paymentFrequency = 'monthly';
  const numberOfPayments = state.term || 0;

  return {
    generatedAt: new Date().toISOString(),
    date: new Date().toLocaleDateString('en-CA'),
    deliveryDate: '',

    dealership: {
      name: 'KIA MONT-LAURIER',
      address: '',
      cityProv: '',
      phone: '',
    },

    customer: {
      name: deal?.customerName || state.customerName || deal?.customer_name || '',
      cobuyer: '',
      address: deal?.address || '',
      city: deal?.city || '',
      province: province.name,
      provinceCode: state.provinceCode,
      postalCode: deal?.postalCode || deal?.postal_code || '',
      phone: deal?.phone || '',
      cellPhone: deal?.cellPhone || deal?.cell_phone || '',
      driverLicense: '',
      salesperson: deal?.salesperson || deal?.salesperson_name || '',
    },

    vehicle: {
      condition: state.vehicle?.condition === 'new' ? 'New' : 'Used',
      year: state.vehicle?.year || '',
      make: state.vehicle?.make || '',
      model: state.vehicle?.model || '',
      color: state.vehicle?.color || '',
      stockNumber: state.vehicle?.stock || '',
      vin: state.vehicle?.vin || '',
      mileage: state.vehicle?.mileage || 0,
      trim: state.vehicle?.trim || '',
    },

    pricing: {
      salePrice,
      omvicFee,
      extWarranty,
      totalVehiclePrice,
      tradeAllowance,
      totalLessTrade,
      taxAmount,
      taxLabel,
      feesTotal,
      fees,
      fiTotal,
      fiProducts,
      totalPurchasePrice,
    },

    financing: {
      cashDown,
      rebatesTotal,
      tradeNetEquity,
      amountFinanced,
      totalToBeFinanced: amountFinanced, // same number, different label
      rate: state.interestRate,
      term: state.term,
      paymentAmount: computed.financeMonthly,
      paymentFrequency,
      numberOfPayments,
      paymentsStartDate: '',
      lender: state.selectedLender
        ? { name: state.selectedLender.name, shortName: state.selectedLender.shortName }
        : null,
    },

    trades: trades
      .filter((t) => t && (t.allowance || t.acv || t.year || t.vin))
      .map((t) => ({
        year: t.year || '',
        make: t.make || '',
        model: t.model || '',
        vin: t.vin || '',
        mileage: t.mileage || 0,
        acv: Number(t.acv) || 0,
        allowance: Number(t.allowance) || 0,
        lien: Number(t.lien) || 0,
        lienholder: t.lienholder || '',
      })),

    products: {
      extWarranty,
      lifeInsurance,
      ahInsurance,
      ppsaFee,
    },

    taxExempt: !!state.nativeStatus,
    comments: '',
  };
}

export { formatCurrency };
