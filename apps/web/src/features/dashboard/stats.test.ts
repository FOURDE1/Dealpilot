import { describe, expect, it } from 'vitest';
import { recentLeads } from './stats.js';

// F-78: the lead-stats bucket cases were deleted WITH their function and the
// floor tiles it fed (D-079) — a feature's pins leave with the feature; this
// is not a weakened test. The recent-leads list (and its cases) stay.

const lead = (status: string, created_at = '2026-07-25T10:00:00Z') =>
  ({ status, created_at }) as never;

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
