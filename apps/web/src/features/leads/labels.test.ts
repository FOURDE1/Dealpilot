import { describe, expect, it } from 'vitest';
import { agingBand } from './labels.js';

/** FR-LEAD-016 golden: the clock, its bands, and who never turns red. */
const NOW = Date.parse('2026-08-20T12:00:00Z');
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

describe('agingBand', () => {
  it('under 5 minutes is fresh, to 15 is aging', () => {
    expect(agingBand({ created_at: at(4), assigned_to: null, status: 'new' }, NOW)).toBe('fresh');
    expect(agingBand({ created_at: at(6), assigned_to: null, status: 'new' }, NOW)).toBe('aging');
    expect(agingBand({ created_at: at(14), assigned_to: null, status: 'chatbot_engaged' }, NOW)).toBe('aging');
  });

  it('past 15 minutes only a NOBODY-owns-it lead is overdue', () => {
    expect(agingBand({ created_at: at(20), assigned_to: null, status: 'new' }, NOW)).toBe('overdue');
    // An owned lead's age is its owner's story — amber, never red.
    expect(agingBand({ created_at: at(20), assigned_to: 'u1', status: 'chatbot_engaged' }, NOW)).toBe('aging');
  });

  it('worked leads carry no freshness clock at all', () => {
    for (const status of ['assigned', 'contacted', 'qualified', 'converted', 'lost'] as const) {
      expect(agingBand({ created_at: at(200), assigned_to: null, status }, NOW)).toBeNull();
    }
  });
});
