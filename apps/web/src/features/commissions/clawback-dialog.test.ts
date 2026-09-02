import { describe, expect, it } from 'vitest';
import { formatCents } from '../deals/money.js';
import { parseClawbackAmount } from './commissions-page.js';

/**
 * F-79 T-W3 — the flag dialog's amount validation is parseMoneyToCents-backed
 * (A3), NEVER parseFloat: parseFloat('1 375') === 1 and parseFloat('500,50')
 * === 500 — both inside (0, max], so an FR-typed amount would silently
 * record a wrong reversal that passes every server check. A null here is what
 * the dialog maps to clawbackInvalidAmount.
 */
describe('parseClawbackAmount (T-W3)', () => {
  const max = 137_500; // the canonical line

  it("parses the FR comma decimal: '500,50' → 50050", () => {
    expect(parseClawbackAmount('500,50', max)).toBe(50_050);
  });
  it("parses the FR thousands space: '1 375' → 137500", () => {
    expect(parseClawbackAmount('1 375', max)).toBe(137_500);
  });
  it('round-trips the formatCents prefill in both locales', () => {
    // The dialog prefills via formatCents (A3) — NBSP groups and the narrow
    // symbol included, byte-exact, in whichever locale the viewer reads.
    expect(parseClawbackAmount(formatCents(137_500, 'fr-CA'), max)).toBe(137_500);
    expect(parseClawbackAmount(formatCents(137_500, 'en-CA'), max)).toBe(137_500);
  });
  it('empty → null', () => {
    expect(parseClawbackAmount('', max)).toBeNull();
  });
  it('garbage → null', () => {
    expect(parseClawbackAmount('abc', max)).toBeNull();
    expect(parseClawbackAmount('12abc', max)).toBeNull();
  });
  it('zero and negatives → null (server mirrors with a 422)', () => {
    expect(parseClawbackAmount('0', max)).toBeNull();
    expect(parseClawbackAmount('0,00', max)).toBeNull();
  });
  it('over the line amount → null (server mirrors with a 422 by path)', () => {
    expect(parseClawbackAmount('1 375,01', max)).toBeNull();
    expect(parseClawbackAmount('1376', max)).toBeNull();
  });
});
