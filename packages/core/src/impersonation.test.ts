import { describe, expect, it } from 'vitest';
import {
  IMPERSONATION_END_REASONS,
  IMPERSONATION_MODES,
  IMPERSONATION_REASON_MIN_CHARS,
  IMPERSONATION_TTL_MINUTES,
} from './impersonation.js';

describe('impersonation constants (F-71, admin-console.md §7)', () => {
  it('spells the spec: 60-minute hard TTL, two modes, three end reasons, 20-character reason', () => {
    expect(IMPERSONATION_TTL_MINUTES).toBe(60);
    expect([...IMPERSONATION_MODES]).toEqual(['read_only', 'full']);
    expect([...IMPERSONATION_END_REASONS].sort()).toEqual(['manual', 'revoked', 'ttl']);
    expect(IMPERSONATION_REASON_MIN_CHARS).toBe(20);
  });
});
