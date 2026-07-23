import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// -----------------------------------------------------------------------------
// Field → array of regex patterns. Patterns reflect the ACTUAL labels emitted
// by DealerTrack Canada worksheets (e.g. "Cash Price", "Lien Amount", "Total
// Amount Financed", "Total Monthly Payment"), plus French equivalents.
// -----------------------------------------------------------------------------
const FIELD_PATTERNS = {
  // === VEHICLE ===
  year: [
    /\bYear:\s*((?:19|20)\d{2})\b/i,
    /\bAnnée:\s*((?:19|20)\d{2})\b/i,
  ],
  make: [
    /\bMake:\s*([A-Za-zÀ-ÿ]+)/i,
    /\bMarque:\s*([A-Za-zÀ-ÿ]+)/i,
  ],
  model: [
    /\bModel:\s*([A-Za-zÀ-ÿ0-9 \-]+?)(?:\s{2,}|\n|$)/i,
    /\bModèle:\s*([A-Za-zÀ-ÿ0-9 \-]+?)(?:\s{2,}|\n|$)/i,
  ],
  vin: [
    /VIN\s*#?:\s*([A-HJ-NPR-Z0-9]{13,17})/i,
    /NIV\s*#?:\s*([A-HJ-NPR-Z0-9]{13,17})/i,
    /\b([A-HJ-NPR-Z0-9]{17})\b/,
  ],
  stockNumber: [
    /Stock\s*#?:\s*([A-Za-z0-9\-]+)/i,
    /Inventaire\s*#?:\s*([A-Za-z0-9\-]+)/i,
  ],
  mileage: [
    /(\d[\d,]*)\s*\n?\s*KMs?:/i,
    /KMs?:\s*(\d[\d,]*)/i,
    /Current\s+(\d[\d,]*)\s+KMs/i,
    /Kilométrage:\s*(\d[\d,]*)/i,
    /Odometer:\s*(\d[\d,]*)/i,
  ],
  bodyStyle: [
    /Body\s*Style:\s*(.+?)(?:\s{2,}|\n|$)/i,
  ],

  // === PRICING ===
  sellingPrice: [
    /Cash\s*Price:\s*\$?\s*([\d,]+\.?\d*)/i,
    /Prix\s*comptant:\s*\$?\s*([\d,]+\.?\d*)/i,
    /Selling\s*Price:\s*\$?\s*([\d,]+\.?\d*)/i,
    /Sale\s*Price:\s*\$?\s*([\d,]+\.?\d*)/i,
    /Prix\s*(?:de\s*)?vente:\s*\$?\s*([\d,]+\.?\d*)/i,
  ],
  msrp: [
    /MSRP:\s*\$?\s*([\d,]+\.?\d*)/i,
    /PDSF:\s*\$?\s*([\d,]+\.?\d*)/i,
  ],

  // === TRADE ===
  tradeAllowance: [
    /Net\s*Trade\s*In\s*Allowance:\s*\$?\s*([\d,]+\.?\d*)/i,
    /(?:Trade\s*(?:In\s*)?)?Allowance:\s*\$?\s*([\d,]+\.?\d*)/i,
    /Valeur\s*d[''’]?\s*échange:\s*\$?\s*([\d,]+\.?\d*)/i,
  ],
  tradePayoff: [
    /Lien\s*Amount:\s*\$?\s*([\d,]+\.?\d*)/i,
    /Pay\s*off:\s*\$?\s*([\d,]+\.?\d*)/i,
    /Payoff:\s*\$?\s*([\d,]+\.?\d*)/i,
    /Solde\s*(?:de\s*)?prêt:\s*\$?\s*([\d,]+\.?\d*)/i,
  ],
  tradeACV: [
    /ACV:\s*\$?\s*([\d,]+\.?\d*)/i,
    /Actual\s*Cash\s*Value:\s*\$?\s*([\d,]+\.?\d*)/i,
  ],

  // === FINANCE TERMS ===
  amountFinanced: [
    /Total\s*Amount\s*Financed:\s*\$?\s*([\d,]+\.?\d*)/i,
    /Amount\s*Financed:\s*\$?\s*([\d,]+\.?\d*)/i,
    /Montant\s*financé:\s*\$?\s*([\d,]+\.?\d*)/i,
  ],
  interestRate: [
    /Actual\s*Interest\s*Rate:\s*([\d]+\.?\d*)/i,
    /Interest\s*Rate:\s*([\d]+\.?\d*)/i,
    /Taux\s*d[''’]?intérêt:\s*([\d]+\.?\d*)/i,
    /APR:\s*([\d]+\.?\d*)/i,
    /Taux:\s*([\d]+\.?\d*)/i,
  ],
  term: [
    /\bTerm:\s*(\d{2,3})\b/i,
    /\bTerme:\s*(\d{2,3})\b/i,
    /Amortization:\s*(\d{2,3})/i,
  ],
  monthlyPayment: [
    /Total\s*Monthly\s*Payment:\s*\$?\s*([\d,]+\.?\d*)/i,
    /Monthly\s*Payment:\s*\$?\s*([\d,]+\.?\d*)/i,
    /Paiement\s*mensuel:\s*\$?\s*([\d,]+\.?\d*)/i,
    /Mensualité:\s*\$?\s*([\d,]+\.?\d*)/i,
  ],
  biWeeklyPayment: [
    /Payment\s*Frequency\s*Amount:\s*\$?\s*([\d,]+\.?\d*)/i,
    /Bi[\-\s]?Weekly[\s\S]{0,60}?\$?\s*([\d,]+\.?\d*)/i,
    /Aux\s*deux\s*semaines:\s*\$?\s*([\d,]+\.?\d*)/i,
  ],
  costOfBorrowing: [
    /Cost\s*of\s*Borrowing:\s*\$?\s*([\d,]+\.?\d*)/i,
    /Coût\s*d[''’]?emprunt:\s*\$?\s*([\d,]+\.?\d*)/i,
  ],
  totalObligation: [
    /Total\s*Obligation:\s*\$?\s*([\d,]+\.?\d*)/i,
    /Obligation\s*totale:\s*\$?\s*([\d,]+\.?\d*)/i,
  ],

  // === DOWN PAYMENT & REBATES ===
  cashDown: [
    /Cash\s*Down:\s*\$?\s*([\d,]+\.?\d*)/i,
    /Down\s*Payment:\s*\$?\s*([\d,]+\.?\d*)/i,
    /Comptant:\s*\$?\s*([\d,]+\.?\d*)/i,
    /Mise\s*de\s*fonds:\s*\$?\s*([\d,]+\.?\d*)/i,
  ],
  rebate: [
    /\bRebate:\s*\$?\s*([\d,]+\.?\d*)/i,
    /\bRabais:\s*\$?\s*([\d,]+\.?\d*)/i,
    /Cash\s*Forgone\s*\n?\s*\$?\s*([\d,]+\.?\d*)/i,
  ],

  // === TAXES ===
  gstHstRate: [
    /GST\/HST:\s*([\d.]+)/i,
    /TPS\/TVH:\s*([\d.]+)/i,
  ],
  gstHstAmount: [
    /GST\/HST:\s*[\d.]+\s+Exemption\s*Reason\s+\$?\s*([\d,]+\.?\d*)/i,
    /TPS\/TVH:\s*[\d.]+\s+.*?\s+\$?\s*([\d,]+\.?\d*)/i,
  ],
  pst: [
    /\bPST:\s*\$?\s*([\d,]+\.?\d*)/i,
    /\bTVP:\s*\$?\s*([\d,]+\.?\d*)/i,
  ],

  // === FEES ===
  adminFee: [
    /Admin\s*Fee:\s*\$?\s*([\d,]+\.?\d*)/i,
    /Frais\s*d[''’]?admin(?:istration)?:\s*\$?\s*([\d,]+\.?\d*)/i,
  ],
  licenseFee: [
    /License\s*Fee:\s*\$?\s*([\d,]+\.?\d*)/i,
    /Licence\s*Fee:\s*\$?\s*([\d,]+\.?\d*)/i,
    /Frais\s*(?:de\s*)?plaque:\s*\$?\s*([\d,]+\.?\d*)/i,
  ],
  ppsaFee: [
    /PPSA:\s*\$?\s*([\d,]+\.?\d*)/i,
    /RDPRM:\s*\$?\s*([\d,]+\.?\d*)/i,
  ],
  installationDeliveryFee: [
    /Installation\s*and\s*Delivery:\s*\$?\s*([\d,]+\.?\d*)/i,
    /Installation\s*et\s*livraison:\s*\$?\s*([\d,]+\.?\d*)/i,
  ],

  // === F&I PRODUCTS ===
  extendedWarranty: [
    /Extended\s*Service\s*Contract:\s*\$?\s*([\d,]+\.?\d*)/i,
    /Garantie\s*prolongée:\s*\$?\s*([\d,]+\.?\d*)/i,
  ],
  gapProtection: [
    /GAP\s*Protection:\s*\$?\s*([\d,]+\.?\d*)/i,
    /Protection\s*GAP:\s*\$?\s*([\d,]+\.?\d*)/i,
  ],
  replacementWarranty: [
    /Replacement\s*Warranty:\s*\$?\s*([\d,]+\.?\d*)/i,
  ],
  lifeInsurance: [
    /Life\s*Insurance:\s*\$?\s*([\d,]+\.?\d*)/i,
    /Assurance\s*vie:\s*\$?\s*([\d,]+\.?\d*)/i,
  ],
  ahInsurance: [
    /A\/H\s*Insurance:\s*\$?\s*([\d,]+\.?\d*)/i,
    /Assurance\s*A\/H:\s*\$?\s*([\d,]+\.?\d*)/i,
  ],
  criticalIllness: [
    /Critical\s*Illness:\s*\$?\s*([\d,]+\.?\d*)/i,
    /Maladies\s*graves:\s*\$?\s*([\d,]+\.?\d*)/i,
  ],
  appearanceProtection: [
    /Appearance\s*Protection:\s*\$?\s*([\d,]+\.?\d*)/i,
  ],
  tireAndRim: [
    /Tire\s*and\s*Rim:\s*\$?\s*([\d,]+\.?\d*)/i,
    /Tire\s*&\s*Rim:\s*\$?\s*([\d,]+\.?\d*)/i,
  ],
  antiTheft: [
    /Anti[\-\s]?theft:\s*\$?\s*([\d,]+\.?\d*)/i,
  ],

  // === LENDER & PROVINCE ===
  lenderName: [
    /Lender:\s*(.+?)(?:\s{2,}|Status|\n|$)/i,
    /Prêteur:\s*(.+?)(?:\s{2,}|\n|$)/i,
  ],
  province: [
    /Province:\s*([A-Za-zÀ-ÿ\s]+?)(?:\s{2,}|\n|$)/i,
  ],
};

const NUMERIC_FIELDS = new Set([
  'msrp', 'sellingPrice', 'tradeAllowance', 'tradePayoff', 'tradeACV', 'mileage',
  'cashDown', 'rebate', 'amountFinanced', 'interestRate', 'term', 'monthlyPayment',
  'biWeeklyPayment', 'gstHstRate', 'gstHstAmount', 'pst', 'costOfBorrowing', 'totalObligation',
  'adminFee', 'licenseFee', 'ppsaFee', 'installationDeliveryFee',
  'extendedWarranty', 'gapProtection', 'replacementWarranty', 'lifeInsurance',
  'ahInsurance', 'criticalIllness', 'appearanceProtection', 'tireAndRim', 'antiTheft',
  'year',
]);

const LABEL_KEYWORDS = {
  sellingPrice: ['cash price', 'selling price', 'sale price', 'prix comptant', 'prix vente'],
  msrp: ['msrp', 'pdsf'],
  tradeAllowance: ['net trade in allowance', 'trade allowance', 'allowance', "valeur d'échange", 'reprise'],
  tradePayoff: ['lien amount', 'payoff', 'pay off', 'solde prêt'],
  tradeACV: ['acv', 'actual cash value'],
  cashDown: ['cash down', 'down payment', 'comptant', 'mise de fonds'],
  amountFinanced: ['total amount financed', 'amount financed', 'montant financé'],
  interestRate: ['actual interest rate', 'interest rate', 'taux', 'apr'],
  term: ['term:', 'terme:', 'amortization'],
  monthlyPayment: ['total monthly payment', 'monthly payment', 'paiement mensuel'],
  biWeeklyPayment: ['payment frequency amount', 'bi-weekly', 'bi weekly'],
  costOfBorrowing: ['cost of borrowing', "coût d'emprunt"],
  totalObligation: ['total obligation', 'obligation totale'],
  adminFee: ['admin fee', "frais d'admin"],
  licenseFee: ['license fee', 'licence fee', 'plaque'],
  ppsaFee: ['ppsa', 'rdprm'],
  installationDeliveryFee: ['installation and delivery', 'installation et livraison'],
  gstHstAmount: ['gst/hst', 'tps/tvh'],
  pst: ['pst:', 'tvp:'],
  rebate: ['rebate', 'rabais', 'cash forgone'],
  extendedWarranty: ['extended service contract', 'garantie prolongée'],
  gapProtection: ['gap protection', 'protection gap'],
  replacementWarranty: ['replacement warranty'],
  lifeInsurance: ['life insurance', 'assurance vie'],
  ahInsurance: ['a/h insurance'],
  criticalIllness: ['critical illness', 'maladies graves'],
  appearanceProtection: ['appearance protection'],
  tireAndRim: ['tire and rim', 'tire & rim'],
  antiTheft: ['anti-theft', 'anti theft', 'antitheft'],
};

// -----------------------------------------------------------------------------
// Number parser — supports EN ("25,432.19"), FR ("25 432,19"), and bare forms.
// -----------------------------------------------------------------------------
export function parseNumber(raw) {
  if (raw == null) return null;
  let cleaned = String(raw).trim().replace(/^\$/, '').replace(/\s/g, '');
  if (/^\d+,\d{1,2}$/.test(cleaned)) {
    cleaned = cleaned.replace(',', '.');
  } else {
    cleaned = cleaned.replace(/,/g, '');
  }
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

async function extractText(arrayBuffer) {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const allItems = [];
  const pageTexts = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();

    const linesByY = new Map();
    for (const item of content.items) {
      const str = item?.str;
      if (!str || !str.trim()) continue;
      const x = item.transform?.[4] ?? 0;
      const y = item.transform?.[5] ?? 0;
      allItems.push({ str, x, y, page: p });
      const key = Math.round(y / 5) * 5;
      if (!linesByY.has(key)) linesByY.set(key, []);
      linesByY.get(key).push({ str, x });
    }

    const sortedY = Array.from(linesByY.keys()).sort((a, b) => b - a);
    const lines = sortedY.map((y) => {
      const row = linesByY.get(y).sort((a, b) => a.x - b.x);
      return row.map((i) => i.str).join('  ');
    }).filter(Boolean);
    pageTexts.push(lines.join('\n'));
  }

  return { fullText: pageTexts.join('\n\n'), items: allItems };
}

function findNearbyNumber(items, keyword) {
  const kwLower = keyword.toLowerCase();
  const labelItems = items.filter((it) => it.str.toLowerCase().includes(kwLower));
  if (labelItems.length === 0) return null;

  for (const label of labelItems) {
    const candidates = items.filter((it) => {
      if (it === label) return false;
      const dx = it.x - label.x;
      const dy = it.y - label.y;
      const sameRow = Math.abs(dy) < 6 && dx > -10 && dx < 400;
      const rowBelow = dy < 0 && dy > -30 && dx > -200 && dx < 300;
      if (!sameRow && !rowBelow) return false;
      const clean = it.str.trim().replace(/[$\s,]/g, '').replace(',', '.');
      return /^\d+(\.\d{1,4})?$/.test(clean) || /^\d+([.,]\d{1,4})?%?$/.test(it.str.trim());
    });
    if (candidates.length === 0) continue;

    candidates.sort((a, b) => {
      const dyA = Math.abs(a.y - label.y);
      const dyB = Math.abs(b.y - label.y);
      const sameRowA = dyA < 6, sameRowB = dyB < 6;
      if (sameRowA && !sameRowB) return -1;
      if (sameRowB && !sameRowA) return 1;
      const distA = Math.abs(a.x - label.x) + dyA;
      const distB = Math.abs(b.x - label.x) + dyB;
      return distA - distB;
    });
    return candidates[0].str;
  }
  return null;
}

function applyWarnings(data) {
  const warnings = [];
  if (data.interestRate != null && (data.interestRate < 0 || data.interestRate > 30)) {
    warnings.push(`Interest rate ${data.interestRate}% is outside the expected 0–30% range.`);
  }
  if (data.term != null && (data.term < 12 || data.term > 120)) {
    warnings.push(`Term ${data.term} months is outside the expected 12–120 range.`);
  }
  for (const key of ['sellingPrice', 'msrp', 'amountFinanced', 'tradeAllowance', 'tradePayoff']) {
    if (data[key] != null && data[key] < 0) {
      warnings.push(`${key} is negative (${data[key]}).`);
    }
  }
  return warnings;
}

export async function parseDealerTrackPdf(arrayBuffer) {
  try {
    const { fullText, items } = await extractText(arrayBuffer);
    const data = {};

    // Strategy 1: regex against reconstructed line-based text.
    for (const [key, patterns] of Object.entries(FIELD_PATTERNS)) {
      const list = Array.isArray(patterns) ? patterns : [patterns];
      for (const pattern of list) {
        const match = fullText.match(pattern);
        if (!match || !match[1]) continue;
        const raw = match[1].trim();
        if (NUMERIC_FIELDS.has(key)) {
          const n = parseNumber(raw);
          if (n != null && n >= 0) { data[key] = n; break; }
        } else if (raw.length > 0 && raw.length < 100) {
          data[key] = raw; break;
        }
      }
    }

    // Strategy 2: proximity-based fallback for numeric fields still missing.
    for (const [key, keywords] of Object.entries(LABEL_KEYWORDS)) {
      if (data[key] != null) continue;
      for (const kw of keywords) {
        const raw = findNearbyNumber(items, kw);
        if (!raw) continue;
        const n = parseNumber(raw);
        if (n != null && n >= 0) { data[key] = n; break; }
      }
    }

    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log('[DealerTrack PDF] Raw text:\n', fullText);
      // eslint-disable-next-line no-console
      console.log('[DealerTrack PDF] Parsed data:', data);
      // eslint-disable-next-line no-console
      console.log('[DealerTrack PDF] Items sample:', items.slice(0, 60));
    }

    const matchedCount = Object.keys(data).length;
    if (matchedCount < 2) {
      return {
        success: false,
        error: 'Could not identify DealerTrack worksheet fields. The PDF may be scanned/image-based or in an unsupported format.',
        rawText: fullText,
        data,
      };
    }

    return {
      success: true,
      data,
      rawText: fullText,
      warnings: applyWarnings(data),
      matchedCount,
    };
  } catch (err) {
    return {
      success: false,
      error: err?.message || 'Failed to parse PDF',
      data: {},
      rawText: '',
    };
  }
}

export const PARSED_FIELD_GROUPS = {
  parsedVehicle:  ['year', 'make', 'model', 'vin', 'stockNumber', 'mileage', 'bodyStyle'],
  parsedPricing:  ['msrp', 'sellingPrice'],
  parsedTrade:    ['tradeAllowance', 'tradePayoff', 'tradeACV'],
  parsedFinance:  ['amountFinanced', 'interestRate', 'term', 'monthlyPayment', 'biWeeklyPayment', 'cashDown', 'rebate', 'costOfBorrowing', 'totalObligation'],
  parsedFees:     ['adminFee', 'licenseFee', 'ppsaFee', 'installationDeliveryFee', 'gstHstAmount', 'pst'],
  parsedProducts: ['extendedWarranty', 'gapProtection', 'replacementWarranty', 'lifeInsurance', 'ahInsurance', 'criticalIllness', 'appearanceProtection', 'tireAndRim', 'antiTheft'],
  parsedLender:   ['lenderName', 'province'],
};

export const FIELD_LABELS = {
  year: 'Year', make: 'Make', model: 'Model', vin: 'VIN', stockNumber: 'Stock #',
  mileage: 'Mileage (KMs)', bodyStyle: 'Body Style',
  msrp: 'MSRP', sellingPrice: 'Cash/Selling Price',
  tradeAllowance: 'Trade Allowance', tradePayoff: 'Lien/Payoff Amount', tradeACV: 'Trade ACV',
  amountFinanced: 'Total Amount Financed', interestRate: 'Interest Rate', term: 'Term (months)',
  monthlyPayment: 'Monthly Payment', biWeeklyPayment: 'Bi-weekly Payment',
  cashDown: 'Cash Down', rebate: 'Rebate',
  costOfBorrowing: 'Cost of Borrowing', totalObligation: 'Total Obligation',
  adminFee: 'Admin Fee', licenseFee: 'License Fee', ppsaFee: 'PPSA / RDPRM',
  installationDeliveryFee: 'Installation & Delivery',
  extendedWarranty: 'Extended Service Contract', gapProtection: 'GAP Protection',
  replacementWarranty: 'Replacement Warranty', lifeInsurance: 'Life Insurance',
  ahInsurance: 'A/H Insurance', criticalIllness: 'Critical Illness',
  appearanceProtection: 'Appearance Protection', tireAndRim: 'Tire & Rim', antiTheft: 'Anti-theft',
  gstHstAmount: 'GST/HST Amount', pst: 'PST',
  lenderName: 'Lender', province: 'Province',
};

export const PROVINCE_NAME_TO_CODE = {
  'alberta': 'AB',
  'british columbia': 'BC', 'colombie-britannique': 'BC',
  'manitoba': 'MB',
  'new brunswick': 'NB', 'nouveau-brunswick': 'NB',
  'newfoundland': 'NL', 'newfoundland and labrador': 'NL', 'terre-neuve-et-labrador': 'NL', 'terre-neuve': 'NL',
  'nova scotia': 'NS', 'nouvelle-écosse': 'NS',
  'northwest territories': 'NT', 'territoires du nord-ouest': 'NT',
  'nunavut': 'NU',
  'ontario': 'ON',
  'prince edward island': 'PE', 'île-du-prince-édouard': 'PE',
  'quebec': 'QC', 'québec': 'QC',
  'saskatchewan': 'SK',
  'yukon': 'YT',
};
