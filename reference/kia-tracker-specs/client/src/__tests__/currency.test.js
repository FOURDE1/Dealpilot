import { describe, it, expect } from 'vitest';
import { formatCurrency, parseCurrency, centsToDollars, dollarsToCents } from '../lib/currency';

describe('Currency utilities', () => {
  describe('formatCurrency', () => {
    it('formats cents to CAD display string', () => {
      expect(formatCurrency(100000)).toBe('$1,000.00');
    });

    it('handles zero', () => {
      expect(formatCurrency(0)).toBe('$0.00');
    });

    it('handles null/undefined', () => {
      expect(formatCurrency(null)).toBe('$0.00');
      expect(formatCurrency(undefined)).toBe('$0.00');
    });

    it('handles small amounts', () => {
      expect(formatCurrency(50)).toBe('$0.50');
      expect(formatCurrency(1)).toBe('$0.01');
    });

    it('handles large amounts', () => {
      expect(formatCurrency(2500000)).toBe('$25,000.00');
    });
  });

  describe('parseCurrency', () => {
    it('parses dollar string to cents', () => {
      expect(parseCurrency('$1,000.00')).toBe(100000);
    });

    it('parses plain number string', () => {
      expect(parseCurrency('1000')).toBe(100000);
      expect(parseCurrency('1000.50')).toBe(100050);
    });

    it('parses number directly', () => {
      expect(parseCurrency(1000)).toBe(100000);
      expect(parseCurrency(25.99)).toBe(2599);
    });

    it('handles null/empty', () => {
      expect(parseCurrency(null)).toBe(0);
      expect(parseCurrency('')).toBe(0);
    });
  });

  describe('centsToDollars', () => {
    it('converts cents to dollar string', () => {
      expect(centsToDollars(100000)).toBe('1000.00');
      expect(centsToDollars(50)).toBe('0.50');
      expect(centsToDollars(0)).toBe('0.00');
    });
  });

  describe('dollarsToCents', () => {
    it('converts dollars to cents', () => {
      expect(dollarsToCents(1000)).toBe(100000);
      expect(dollarsToCents('25.99')).toBe(2599);
      expect(dollarsToCents(null)).toBe(0);
    });

    it('rounds correctly to avoid floating point', () => {
      expect(dollarsToCents(19.99)).toBe(1999);
      expect(dollarsToCents(0.1 + 0.2)).toBe(30); // 0.30000...04 -> 30
    });
  });
});
