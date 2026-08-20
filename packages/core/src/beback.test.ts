import { describe, expect, it } from 'vitest';
import { BEBACK_STATUSES, bebackTier, daysDormant } from './beback.js';

const NOW = Date.parse('2026-08-20T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 24 * 60 * 60 * 1000).toISOString();

describe('bebackTier (leads.md §9)', () => {
  it('places each threshold on its boundary', () => {
    expect(bebackTier(daysAgo(90), NOW)).toBe('critical');
    expect(bebackTier(daysAgo(89.99), NOW)).toBe('high');
    expect(bebackTier(daysAgo(30), NOW)).toBe('high');
    expect(bebackTier(daysAgo(29.99), NOW)).toBe('medium');
    expect(bebackTier(daysAgo(14), NOW)).toBe('medium');
    expect(bebackTier(daysAgo(13.99), NOW)).toBe('low');
    expect(bebackTier(daysAgo(0), NOW)).toBe('low');
    expect(bebackTier(daysAgo(365), NOW)).toBe('critical');
  });

  it('treats clock skew as fresh, never as negative days', () => {
    expect(daysDormant(daysAgo(-1), NOW)).toBe(0);
    expect(bebackTier(daysAgo(-1), NOW)).toBe('low');
  });

  it('counts whole days only', () => {
    expect(daysDormant(daysAgo(89.99), NOW)).toBe(89);
    expect(daysDormant(daysAgo(90), NOW)).toBe(90);
  });

  it('the population vocabulary is exactly the four dormant statuses', () => {
    expect([...BEBACK_STATUSES].sort()).toEqual(['expired', 'lost', 'nurture', 'unresponsive']);
  });
});
