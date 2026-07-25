/**
 * Desking worksheet input parsing/formatting. All amounts are INTEGER CENTS
 * and rates are BASIS POINTS on the wire (ADR-009) — floats exist only inside
 * a single parse/format call, never in state.
 */

/** "35 000,00 $" (fr-CA) / "$35,000.00" (en-CA) from integer cents. */
export function formatCents(cents: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'CAD',
    currencyDisplay: 'narrowSymbol',
  }).format(cents / 100);
}

/** "5,99 %" / "5.99%" from basis points (599 = 5.99%). */
export function formatBps(bps: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(bps / 10_000);
}

/**
 * Human-typed amount → cents. Accepts FR and EN habits: "35 000,00",
 * "35,000.00", "1500", "1 500$". The LAST '.' or ',' is the decimal separator
 * when it is followed by 1–2 digits; every other '.'/',' is a thousands mark.
 * Returns null for empty/garbage input rather than guessing.
 */
export function parseMoneyToCents(raw: string): number | null {
  const s = raw.replace(/[\s  $]/g, '');
  if (s === '' || !/^[0-9.,]+$/.test(s)) return null;
  const lastSep = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  const decimals = lastSep === -1 ? '' : s.slice(lastSep + 1);
  const isDecimal = lastSep !== -1 && decimals.length >= 1 && decimals.length <= 2;
  const intPart = (isDecimal ? s.slice(0, lastSep) : s).replace(/[.,]/g, '');
  if (intPart === '' && decimals === '') return null;
  const cents =
    Number(intPart || '0') * 100 + (isDecimal ? Number(decimals.padEnd(2, '0')) : 0);
  return Number.isSafeInteger(cents) ? cents : null;
}

/**
 * Human-typed percentage ("5,99" / "5.99" / "5.999") → basis points (599/600).
 * Rates never carry thousands separators, so this is NOT parseMoneyToCents:
 * there, "5.999" would read as five thousand — here it is 5.999 %.
 */
export function parsePctToBps(raw: string): number | null {
  const s = raw.replace(/[\s%]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,4})?$/.test(s)) return null;
  const bps = Math.round(Number(s) * 100);
  return Number.isSafeInteger(bps) ? bps : null;
}
