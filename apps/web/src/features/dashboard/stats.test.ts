import { describe, expect, it } from 'vitest';
import { computeLeadStats, recentLeads } from './stats.js';

const lead = (status: string, created_at = '2026-07-25T10:00:00Z') =>
  ({ status, created_at }) as never;

describe('computeLeadStats', () => {
  it('buckets every status correctly — total is TOTAL, not "active"', () => {
    const stats = computeLeadStats([
      lead('new'),
      lead('new'),
      lead('chatbot_engaged'),
      lead('assigned'),
      lead('contacted'),
      lead('qualified'),
      lead('converted'),
      lead('unresponsive'),
      lead('nurture'),
      lead('expired'),
      lead('lost'),
    ]);
    expect(stats).toEqual({ total: 11, fresh: 2, inProgress: 4, converted: 1 });
  });

  it('handles empty input', () => {
    expect(computeLeadStats([])).toEqual({ total: 0, fresh: 0, inProgress: 0, converted: 0 });
  });
});

describe('recentLeads', () => {
  it('returns the newest first, capped, without mutating the input', () => {
    const input = [
      lead('new', '2026-07-01T00:00:00Z'),
      lead('new', '2026-07-03T00:00:00Z'),
      lead('new', '2026-07-02T00:00:00Z'),
    ];
    const frozen = [...input];
    const result = recentLeads(input, 2);
    expect(result.map((l: { created_at: string }) => l.created_at)).toEqual([
      '2026-07-03T00:00:00Z',
      '2026-07-02T00:00:00Z',
    ]);
    expect(input).toEqual(frozen);
  });
});
