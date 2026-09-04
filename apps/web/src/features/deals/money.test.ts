import { describe, expect, it } from 'vitest';
import { formatBps, formatCents, parseMoneyToCents, parsePctToBps, spreadBps } from './money.js';

describe('parseMoneyToCents', () => {
  it.each([
    ['35000', 3_500_000],
    ['35 000,00', 3_500_000], // fr-CA with regular space
    ['35\u202f000,00', 3_500_000], // fr-CA narrow no-break space (Intl output)
    ['35\u00a0000,00', 3_500_000], // no-break space
    ['35,000.00', 3_500_000], // en-CA
    ['1,500', 150_000], // 3 digits after "," = thousands, not decimals
    ['1 500$', 150_000],
    ['640.09', 64_009],
    ['640,09', 64_009],
    ['0,5', 50], // one decimal digit padded
    ['1.234.567,89', 123_456_789], // EU style both separators
    ['0', 0],
  ])('parses %s → %d', (raw, cents) => {
    expect(parseMoneyToCents(raw)).toBe(cents);
  });

  it.each([['', null], ['abc', null], ['12abc', null], ['-5', null]])(
    'rejects %s',
    (raw, expected) => {
      expect(parseMoneyToCents(raw)).toBe(expected);
    },
  );
});

describe('parsePctToBps', () => {
  it('maps 5,99 → 599 and 5 → 500', () => {
    expect(parsePctToBps('5,99')).toBe(599);
    expect(parsePctToBps('5.99')).toBe(599);
    expect(parsePctToBps('5')).toBe(500);
  });

  it('reads 3-4 decimals as a rate, never as thousands', () => {
    expect(parsePctToBps('5.999')).toBe(600); // 5.999 % ≈ 600 bps — NOT 5 999 bps
    expect(parsePctToBps('0.125')).toBe(13);
    expect(parsePctToBps('5,9,9')).toBeNull();
    expect(parsePctToBps('')).toBeNull();
    expect(parsePctToBps('abc')).toBeNull();
  });
});

describe('formatters (golden per locale)', () => {
  it('formats cents per locale', () => {
    expect(formatCents(3_500_000, 'en-CA')).toBe('$35,000.00');
    // fr-CA uses narrow no-break space groups and trailing $
    expect(formatCents(3_500_000, 'fr-CA').replace(/[\s  ]/g, ' ')).toBe('35 000,00 $');
    expect(formatCents(64_009, 'en-CA')).toBe('$640.09');
  });

  it('formats basis points as percent', () => {
    expect(formatBps(599, 'en-CA')).toBe('5.99%');
    expect(formatBps(599, 'fr-CA').replace(/[\s  ]/g, ' ')).toBe('5,99 %');
  });
});

describe('spreadBps (F-81, render-derived — never a column)', () => {
  it('is sell minus buy when both sides are on file, signed', () => {
    expect(spreadBps(599, 799)).toBe(200);
    expect(spreadBps(799, 599)).toBe(-200);
    expect(spreadBps(0, 0)).toBe(0);
  });

  it('is null — not 0 — when either side is missing', () => {
    expect(spreadBps(null, 799)).toBeNull();
    expect(spreadBps(599, null)).toBeNull();
    expect(spreadBps(null, null)).toBeNull();
  });

  it('renders through formatBps as « 2,00 % » and a signed « -2,00 % »', () => {
    expect(formatBps(200, 'fr-CA')).toMatch(/2,00\s?%/);
    expect(formatBps(-200, 'fr-CA')).toMatch(/^-2,00\s?%$/);
    expect(formatBps(-200, 'en-CA')).toBe('-2.00%');
  });
});
