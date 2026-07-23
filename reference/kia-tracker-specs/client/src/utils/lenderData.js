export const LENDER_CATEGORIES = {
  PRIME: 'PRIME',
  NEAR_PRIME: 'NEAR_PRIME',
  SUBPRIME: 'SUBPRIME',
  IN_HOUSE: 'IN_HOUSE',
  CAPTIVE: 'CAPTIVE',
  CUSTOM: 'CUSTOM',
};

export const CATEGORY_ORDER = ['PRIME', 'NEAR_PRIME', 'SUBPRIME', 'IN_HOUSE', 'CAPTIVE', 'CUSTOM'];

export const CATEGORY_LABEL_KEY = {
  PRIME: 'desking.prime',
  NEAR_PRIME: 'desking.nearPrime',
  SUBPRIME: 'desking.subprime',
  IN_HOUSE: 'desking.inHouse',
  CAPTIVE: 'desking.captive',
  CUSTOM: 'desking.custom',
};

export const DEFAULT_LENDERS = [
  { id: 'td', name: 'TD Auto Finance', shortName: 'TD', category: 'PRIME', defaultRate: null, notes: '' },
  { id: 'rbc', name: 'RBC Royal Bank', shortName: 'RBC', category: 'PRIME', defaultRate: null, notes: '' },
  { id: 'cibc', name: 'CIBC', shortName: 'CIBC', category: 'PRIME', defaultRate: null, notes: '' },
  { id: 'scotiabank', name: 'Scotiabank', shortName: 'Scotia', category: 'PRIME', defaultRate: null, notes: '' },
  { id: 'desjardins', name: 'Desjardins', shortName: 'Desj.', category: 'PRIME', defaultRate: null, notes: '' },
  { id: 'national-bank', name: 'National Bank', shortName: 'NBC', category: 'PRIME', defaultRate: null, notes: '' },
  { id: 'bmo', name: 'BMO Bank of Montreal', shortName: 'BMO', category: 'PRIME', defaultRate: null, notes: '' },

  { id: 'scotia-dealer-advantage', name: 'Scotia Dealer Advantage', shortName: 'SDA', category: 'NEAR_PRIME', defaultRate: null, notes: '' },
  { id: 'ia-financial', name: 'iA Financial Group (Industrial Alliance)', shortName: 'iA', category: 'NEAR_PRIME', defaultRate: null, notes: '' },
  { id: 'acc', name: 'ACC (Automotive Credit Corporation)', shortName: 'ACC', category: 'NEAR_PRIME', defaultRate: null, notes: '' },
  { id: 'td-non-prime', name: 'TD Non-Prime (TD Auto Finance Special)', shortName: 'TD NP', category: 'NEAR_PRIME', defaultRate: null, notes: 'TD subprime program' },
  { id: 'eden-park', name: 'Eden Park', shortName: 'Eden', category: 'NEAR_PRIME', defaultRate: null, notes: '' },

  { id: 'santander', name: 'Santander Consumer Canada', shortName: 'Sant.', category: 'SUBPRIME', defaultRate: null, notes: '' },
  { id: 'iceberg', name: 'Iceberg Finance', shortName: 'Ice.', category: 'SUBPRIME', defaultRate: null, notes: '' },
  { id: 'quantifi', name: 'Quantifi (by Desjardins)', shortName: 'Quant.', category: 'SUBPRIME', defaultRate: null, notes: '' },
  { id: 'rifco', name: 'Rifco National Auto Finance', shortName: 'Rifco', category: 'SUBPRIME', defaultRate: null, notes: '' },
  { id: 'northlake', name: 'Northlake Financial', shortName: 'NLake', category: 'SUBPRIME', defaultRate: null, notes: '' },

  { id: 'kia-finance', name: 'Kia Finance (KFCC)', shortName: 'KIA', category: 'CAPTIVE', defaultRate: null, notes: 'Kia Finance Company of Canada' },
];

const CUSTOM_KEY = 'dealTracker_customLenders';
const HIDDEN_KEY = 'dealTracker_hiddenLenders';

export function loadCustomLenders() {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveCustomLenders(list) {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list || []));
  } catch {}
}

export function loadHiddenLenderIds() {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveHiddenLenderIds(list) {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify(list || []));
  } catch {}
}

// Merge defaults + custom, excluding hidden.
export function getAllLenders({ includeHidden = false } = {}) {
  const custom = loadCustomLenders();
  const hidden = new Set(loadHiddenLenderIds());
  const all = [...DEFAULT_LENDERS, ...custom];
  return includeHidden ? all : all.filter((l) => !hidden.has(l.id));
}

// Fuzzy match a lender name against the list. Returns best match or null.
export function findLenderByName(rawName, lenders = getAllLenders()) {
  if (!rawName) return null;
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const needle = norm(rawName);
  if (!needle) return null;
  let best = null;
  let bestScore = 0;
  for (const l of lenders) {
    const hay = norm(l.name);
    const short = norm(l.shortName);
    if (!hay && !short) continue;
    let score = 0;
    if (hay === needle) score = 100;
    else if (hay.includes(needle) || needle.includes(hay)) score = 80;
    else if (short && (short === needle || needle.includes(short))) score = 70;
    if (score > bestScore) { bestScore = score; best = l; }
  }
  return bestScore >= 70 ? best : null;
}
