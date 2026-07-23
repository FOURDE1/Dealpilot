import { useReducer, useMemo, useCallback, useEffect } from 'react';
import { computeDeal } from '../utils/deskingCalculations';
import { findLenderByName } from '../utils/lenderData';
import { PROVINCE_NAME_TO_CODE } from '../utils/dealertrackPdfParser';

// Map of parsed F&I-product fields → fiProducts[].id in our default catalog.
const PRODUCT_IMPORT_MAP = {
  extendedWarranty:     'ext-warranty',
  gapProtection:        'gap',
  replacementWarranty:  'wrap-warranty',
  lifeInsurance:        'life-ins',
  ahInsurance:          'disability-ins',
  criticalIllness:      'critical-illness',
  appearanceProtection: 'full-appearance',
  tireAndRim:           'tire-rim',
  antiTheft:            'theft-package',
};

const STORAGE_KEY = 'kia_desking_scenarios_v1';
const STATE_KEY = 'kia_desking_state_v1';

const DEFAULT_FEES = [
  { id: 'admin', label: 'Admin / Documentation', amount: 0, taxable: true, enabled: true },
  { id: 'rdprm', label: 'RDPRM / PPSA Lien', amount: 0, taxable: false, enabled: true },
  { id: 'tire', label: 'Tire Tax / Eco-Fee', amount: 12, taxable: true, enabled: true },
  { id: 'ac', label: 'A/C Excise Tax ($100)', amount: 100, taxable: false, enabled: true },
  { id: 'freight', label: 'Freight / PDI', amount: 0, taxable: true, enabled: true },
  { id: 'license', label: 'Government Licensing', amount: 0, taxable: false, enabled: true },
  { id: 'regulatory', label: 'AMVIC / OMVIC Fee', amount: 0, taxable: false, enabled: false },
  { id: 'fuel', label: 'Gas / Fuel Charge', amount: 0, taxable: true, enabled: false },
];

const DEFAULT_FI_PRODUCTS = [
  // Protection Plans
  { id: 'ext-warranty', category: 'Protection Plans', label: 'Extended Warranty (MBP)', cost: 0, price: 0, taxable: true, enabled: false },
  { id: 'powertrain', category: 'Protection Plans', label: 'Powertrain Warranty', cost: 0, price: 0, taxable: true, enabled: false },
  { id: 'wrap-warranty', category: 'Protection Plans', label: 'Wrap Warranty', cost: 0, price: 0, taxable: true, enabled: false },
  { id: 'cpo-warranty', category: 'Protection Plans', label: 'CPO Warranty', cost: 0, price: 0, taxable: true, enabled: false },
  // GAP
  { id: 'gap', category: 'GAP & Loan Protection', label: 'GAP Insurance', cost: 0, price: 0, taxable: false, enabled: false },
  { id: 'loan-protect', category: 'GAP & Loan Protection', label: 'Loan / Credit Protection', cost: 0, price: 0, taxable: false, enabled: false },
  { id: 'total-loss', category: 'GAP & Loan Protection', label: 'Total Loss Protection', cost: 0, price: 0, taxable: false, enabled: false },
  { id: 'depreciation', category: 'GAP & Loan Protection', label: 'Depreciation Protection', cost: 0, price: 0, taxable: true, enabled: false },
  { id: 'payment-protect', category: 'GAP & Loan Protection', label: 'Payment Protection', cost: 0, price: 0, taxable: false, enabled: false },
  // Credit & Life
  { id: 'life-ins', category: 'Credit & Life Insurance', label: 'Credit Life Insurance', cost: 0, price: 0, taxable: false, enabled: false },
  { id: 'disability-ins', category: 'Credit & Life Insurance', label: 'Credit Disability Insurance', cost: 0, price: 0, taxable: false, enabled: false },
  { id: 'life-disab-combo', category: 'Credit & Life Insurance', label: 'Life & Disability Combo', cost: 0, price: 0, taxable: false, enabled: false },
  { id: 'critical-illness', category: 'Credit & Life Insurance', label: 'Critical Illness Coverage', cost: 0, price: 0, taxable: false, enabled: false },
  { id: 'job-loss', category: 'Credit & Life Insurance', label: 'Involuntary Job Loss', cost: 0, price: 0, taxable: false, enabled: false },
  // Appearance
  { id: 'ppf', category: 'Appearance Protection', label: 'Paint Protection Film (PPF)', cost: 0, price: 0, taxable: true, enabled: false },
  { id: 'ceramic', category: 'Appearance Protection', label: 'Ceramic Coating', cost: 0, price: 0, taxable: true, enabled: false },
  { id: 'paint-sealant', category: 'Appearance Protection', label: 'Paint Sealant', cost: 0, price: 0, taxable: true, enabled: false },
  { id: 'interior-protect', category: 'Appearance Protection', label: 'Fabric / Leather Protection', cost: 0, price: 0, taxable: true, enabled: false },
  { id: 'rust-protect', category: 'Appearance Protection', label: 'Rust Protection / Undercoating', cost: 0, price: 0, taxable: true, enabled: false },
  { id: 'anti-corrosion', category: 'Appearance Protection', label: 'Anti-Corrosion Module', cost: 0, price: 0, taxable: true, enabled: false },
  { id: 'full-appearance', category: 'Appearance Protection', label: 'Full Appearance Package', cost: 0, price: 0, taxable: true, enabled: false },
  // Tire & Wheel
  { id: 'tire-rim', category: 'Tire & Wheel', label: 'Tire & Rim Road Hazard', cost: 0, price: 0, taxable: true, enabled: false },
  { id: 'tire-wear', category: 'Tire & Wheel', label: 'Tire Wear Protection', cost: 0, price: 0, taxable: true, enabled: false },
  { id: 'winter-tires', category: 'Tire & Wheel', label: 'Winter Tire Package', cost: 0, price: 0, taxable: true, enabled: false },
  { id: 'wheel-locks', category: 'Tire & Wheel', label: 'Wheel Locks', cost: 0, price: 0, taxable: true, enabled: false },
  // Theft & Security
  { id: 'vin-etch', category: 'Theft & Security', label: 'VIN Etching / Theft Deterrent', cost: 0, price: 0, taxable: true, enabled: false },
  { id: 'gps-theft', category: 'Theft & Security', label: 'GPS Theft Recovery', cost: 0, price: 0, taxable: true, enabled: false },
  { id: 'theft-package', category: 'Theft & Security', label: 'Theft Protection Package', cost: 0, price: 0, taxable: true, enabled: false },
  { id: 'cat-lock', category: 'Theft & Security', label: 'Catalytic Converter Lock', cost: 0, price: 0, taxable: true, enabled: false },
  // Key & Electronic
  { id: 'key-protect', category: 'Key & Electronic', label: 'Key Replacement', cost: 0, price: 0, taxable: false, enabled: false },
  { id: 'remote-start', category: 'Key & Electronic', label: 'Remote Starter', cost: 0, price: 0, taxable: true, enabled: false },
  { id: 'tint', category: 'Key & Electronic', label: 'Window Tinting', cost: 0, price: 0, taxable: true, enabled: false },
  // Maintenance
  { id: 'prepaid-maint', category: 'Maintenance & Service', label: 'Prepaid Maintenance', cost: 0, price: 0, taxable: true, enabled: false },
  { id: 'brake-protect', category: 'Maintenance & Service', label: 'Brake Wear Protection', cost: 0, price: 0, taxable: true, enabled: false },
  { id: 'battery-protect', category: 'Maintenance & Service', label: 'Battery Protection', cost: 0, price: 0, taxable: true, enabled: false },
  { id: 'roadside', category: 'Maintenance & Service', label: 'Roadside Assistance', cost: 0, price: 0, taxable: true, enabled: false },
  // Windshield
  { id: 'windshield', category: 'Windshield & Glass', label: 'Windshield Chip / Replacement', cost: 0, price: 0, taxable: true, enabled: false },
  { id: 'glass-protect', category: 'Windshield & Glass', label: 'Glass Protection Plan', cost: 0, price: 0, taxable: true, enabled: false },
];

export function makeInitialState(overrides = {}) {
  const base = {
    dealId: null,
    customerName: '',
    vehicle: { year: '', make: '', model: '', color: '', vin: '', stock: '', mileage: 0, condition: 'new' },
    salePrice: 0,
    msrp: 0,
    vehicleCost: 0,
    trades: [{ enabled: true, year: '', make: '', model: '', mileage: 0, vin: '', acv: 0, allowance: 0, lien: 0 }],
    dealType: 'finance',
    cashDown: 0,
    rebates: [],
    interestRate: 6.99,
    term: 60,
    residualPercent: 55,
    moneyFactor: 0.00125,
    leaseTerm: 48,
    kmPerYear: 20000,
    excessKmCharge: 0.12,
    fees: DEFAULT_FEES.map((f) => ({ ...f })),
    fiProducts: DEFAULT_FI_PRODUCTS.map((p) => ({ ...p })),
    provinceCode: 'QC',
    nativeStatus: false,
    selectedLender: null,
  };
  const merged = { ...base, ...(overrides || {}) };
  // Guarantee arrays — overrides may set undefined which would wipe defaults.
  if (!Array.isArray(merged.trades) || merged.trades.length === 0) merged.trades = base.trades;
  if (!Array.isArray(merged.rebates)) merged.rebates = [];
  if (!Array.isArray(merged.fees)) merged.fees = base.fees;
  if (!Array.isArray(merged.fiProducts)) merged.fiProducts = base.fiProducts;
  if (!merged.vehicle || typeof merged.vehicle !== 'object') merged.vehicle = base.vehicle;
  return merged;
}

function reducer(state, action) {
  switch (action.type) {
    case 'SET_FIELD':
      return { ...state, [action.field]: action.value };
    case 'SET_VEHICLE':
      return { ...state, vehicle: { ...state.vehicle, ...action.patch } };
    case 'SET_TRADE': {
      const trades = state.trades.slice();
      trades[action.index] = { ...trades[action.index], ...action.patch };
      return { ...state, trades };
    }
    case 'ADD_TRADE':
      return state.trades.length >= 2 ? state : { ...state, trades: [...state.trades, { enabled: true, year: '', make: '', model: '', mileage: 0, vin: '', acv: 0, allowance: 0, lien: 0 }] };
    case 'REMOVE_TRADE':
      return { ...state, trades: state.trades.filter((_, i) => i !== action.index) };
    case 'ADD_REBATE':
      return { ...state, rebates: [...state.rebates, { id: crypto.randomUUID(), label: 'Rebate', amount: 0, enabled: true }] };
    case 'UPDATE_REBATE': {
      const rebates = state.rebates.map((r) => (r.id === action.id ? { ...r, ...action.patch } : r));
      return { ...state, rebates };
    }
    case 'REMOVE_REBATE':
      return { ...state, rebates: state.rebates.filter((r) => r.id !== action.id) };
    case 'UPDATE_FEE': {
      const fees = state.fees.map((f) => (f.id === action.id ? { ...f, ...action.patch } : f));
      return { ...state, fees };
    }
    case 'ADD_FEE':
      return { ...state, fees: [...state.fees, { id: crypto.randomUUID(), label: 'Custom Fee', amount: 0, taxable: true, enabled: true, custom: true }] };
    case 'REMOVE_FEE':
      return { ...state, fees: state.fees.filter((f) => f.id !== action.id) };
    case 'UPDATE_PRODUCT': {
      const fiProducts = state.fiProducts.map((p) => (p.id === action.id ? { ...p, ...action.patch } : p));
      return { ...state, fiProducts };
    }
    case 'ADD_PRODUCT':
      return { ...state, fiProducts: [...state.fiProducts, { id: crypto.randomUUID(), category: 'Other / Custom', label: 'Custom Product', cost: 0, price: 0, taxable: true, enabled: true, custom: true }] };
    case 'REMOVE_PRODUCT':
      return { ...state, fiProducts: state.fiProducts.filter((p) => p.id !== action.id) };
    case 'LOAD_STATE':
      return makeInitialState(action.state || {});
    case 'SET_LENDER':
      return { ...state, selectedLender: action.lender || null };
    case 'CLEAR_LENDER':
      return { ...state, selectedLender: null };
    case 'IMPORT_PDF_DATA': {
      const d = action.data || {};
      const next = { ...state };

      // Scalar financial fields
      if (typeof d.sellingPrice === 'number') next.salePrice = d.sellingPrice;
      if (typeof d.msrp === 'number' && d.msrp > 0) next.msrp = d.msrp;
      if (typeof d.interestRate === 'number') next.interestRate = d.interestRate;
      if (typeof d.term === 'number') next.term = d.term;
      if (typeof d.cashDown === 'number') next.cashDown = d.cashDown;

      // Vehicle
      const v = { ...(state.vehicle || {}) };
      if (d.year) v.year = String(d.year);
      if (d.make) v.make = d.make;
      if (d.model) v.model = d.model;
      if (d.vin) v.vin = d.vin;
      if (d.stockNumber) v.stock = d.stockNumber;
      if (typeof d.mileage === 'number') v.mileage = d.mileage;
      if (d.bodyStyle && !v.color) v.color = d.bodyStyle;
      next.vehicle = v;

      // Trade
      const trades = Array.isArray(state.trades) && state.trades.length > 0
        ? state.trades.slice()
        : [{ enabled: true, year: '', make: '', model: '', mileage: 0, vin: '', acv: 0, allowance: 0, lien: 0 }];
      const t0 = { ...trades[0] };
      if (d.tradeYear) t0.year = String(d.tradeYear);
      if (d.tradeMake) t0.make = d.tradeMake;
      if (d.tradeModel) t0.model = d.tradeModel;
      if (typeof d.tradeMileage === 'number') t0.mileage = d.tradeMileage;
      if (typeof d.tradeAllowance === 'number') t0.allowance = d.tradeAllowance;
      if (typeof d.tradePayoff === 'number') t0.lien = d.tradePayoff;
      if (typeof d.tradeACV === 'number') t0.acv = d.tradeACV;
      trades[0] = t0;
      next.trades = trades;

      // Rebates (append as new line item if > 0)
      if (typeof d.rebate === 'number' && d.rebate > 0) {
        const rebates = Array.isArray(state.rebates) ? state.rebates.slice() : [];
        rebates.push({
          id: (crypto.randomUUID?.() || String(Date.now())),
          label: 'Rebate (PDF)', amount: d.rebate, enabled: true,
        });
        next.rebates = rebates;
      }

      // Fees (match by id, set amount + enable)
      const fees = Array.isArray(state.fees) ? state.fees.map((f) => ({ ...f })) : [];
      const setFee = (id, amount) => {
        const idx = fees.findIndex((f) => f.id === id);
        if (idx >= 0) { fees[idx].amount = amount; fees[idx].enabled = true; }
      };
      if (typeof d.adminFee === 'number') setFee('admin', d.adminFee);
      if (typeof d.licenseFee === 'number') setFee('license', d.licenseFee);
      if (typeof d.ppsaFee === 'number') setFee('rdprm', d.ppsaFee);
      if (typeof d.installationDeliveryFee === 'number') setFee('freight', d.installationDeliveryFee);
      next.fees = fees;

      // F&I products (match by id, set price + enable). Cost stays 0 unless known.
      const products = Array.isArray(state.fiProducts) ? state.fiProducts.map((p) => ({ ...p })) : [];
      for (const [parsedKey, productId] of Object.entries(PRODUCT_IMPORT_MAP)) {
        const amt = d[parsedKey];
        if (typeof amt !== 'number' || amt <= 0) continue;
        const idx = products.findIndex((p) => p.id === productId);
        if (idx >= 0) {
          products[idx].price = amt;
          products[idx].enabled = true;
        }
      }
      next.fiProducts = products;

      // Province mapping (e.g. "Ontario" → "ON")
      if (d.province) {
        const code = PROVINCE_NAME_TO_CODE[d.province.toLowerCase().trim()];
        if (code) next.provinceCode = code;
      }

      // Lender: prefer explicit lender passed in, else fuzzy-match parsed name.
      if (action.lender) {
        next.selectedLender = action.lender;
      } else if (d.lenderName) {
        const matched = findLenderByName(d.lenderName);
        if (matched) {
          next.selectedLender = {
            id: matched.id,
            name: matched.name,
            shortName: matched.shortName,
            category: matched.category,
          };
        }
      }

      return next;
    }
    case 'RESET':
      return makeInitialState(action.overrides);
    default:
      return state;
  }
}

export function useDesking(initialOverrides = {}) {
  const [state, dispatch] = useReducer(reducer, initialOverrides, makeInitialState);

  // Persist state across reloads (lightly debounced via effect frequency).
  useEffect(() => {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch {}
  }, [state]);

  const computed = useMemo(() => computeDeal(state), [state]);

  const setField = useCallback((field, value) => dispatch({ type: 'SET_FIELD', field, value }), []);
  const setVehicle = useCallback((patch) => dispatch({ type: 'SET_VEHICLE', patch }), []);
  const setTrade = useCallback((index, patch) => dispatch({ type: 'SET_TRADE', index, patch }), []);
  const addTrade = useCallback(() => dispatch({ type: 'ADD_TRADE' }), []);
  const removeTrade = useCallback((index) => dispatch({ type: 'REMOVE_TRADE', index }), []);
  const addRebate = useCallback(() => dispatch({ type: 'ADD_REBATE' }), []);
  const updateRebate = useCallback((id, patch) => dispatch({ type: 'UPDATE_REBATE', id, patch }), []);
  const removeRebate = useCallback((id) => dispatch({ type: 'REMOVE_REBATE', id }), []);
  const updateFee = useCallback((id, patch) => dispatch({ type: 'UPDATE_FEE', id, patch }), []);
  const addFee = useCallback(() => dispatch({ type: 'ADD_FEE' }), []);
  const removeFee = useCallback((id) => dispatch({ type: 'REMOVE_FEE', id }), []);
  const updateProduct = useCallback((id, patch) => dispatch({ type: 'UPDATE_PRODUCT', id, patch }), []);
  const addProduct = useCallback(() => dispatch({ type: 'ADD_PRODUCT' }), []);
  const removeProduct = useCallback((id) => dispatch({ type: 'REMOVE_PRODUCT', id }), []);
  const loadState = useCallback((s) => dispatch({ type: 'LOAD_STATE', state: s }), []);
  const reset = useCallback((overrides) => dispatch({ type: 'RESET', overrides }), []);
  const setLender = useCallback((lender) => dispatch({ type: 'SET_LENDER', lender }), []);
  const clearLender = useCallback(() => dispatch({ type: 'CLEAR_LENDER' }), []);
  const importPdfData = useCallback((data, lender) => dispatch({ type: 'IMPORT_PDF_DATA', data, lender }), []);

  return {
    state, computed,
    setField, setVehicle, setTrade, addTrade, removeTrade,
    addRebate, updateRebate, removeRebate,
    updateFee, addFee, removeFee,
    updateProduct, addProduct, removeProduct,
    loadState, reset,
    setLender, clearLender, importPdfData,
  };
}

// Scenario persistence (localStorage, max 4).
export function loadScenarios() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveScenarios(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 4)));
  } catch {}
}
