import { describe, expect, it } from 'vitest';
import {
  confidenceOf,
  matchTypeOf,
  normalizeDupEmail,
  normalizeDupName,
  normalizeDupPhone,
  orientPair,
} from './lead-duplicates.js';

describe('duplicate normalization (leads.md §8.1)', () => {
  it('phone keeps the last 10 digits and rejects short fragments', () => {
    expect(normalizeDupPhone('+1 (514) 555-0100')).toBe('5145550100');
    expect(normalizeDupPhone('15145550100')).toBe('5145550100');
    expect(normalizeDupPhone('555-0100')).toBe('5550100');
    expect(normalizeDupPhone('555010')).toBeNull();
    expect(normalizeDupPhone(null)).toBeNull();
  });

  it('email lowercases and trims; empty is invalid', () => {
    expect(normalizeDupEmail('  Yvon.T@Example.COM ')).toBe('yvon.t@example.com');
    expect(normalizeDupEmail('   ')).toBeNull();
    expect(normalizeDupEmail(null)).toBeNull();
  });

  it('name joins first+last lowercased; single characters are noise', () => {
    expect(normalizeDupName(' Yvon ', 'Tremblay')).toBe('yvon tremblay');
    expect(normalizeDupName('Yvon', null)).toBe('yvon');
    expect(normalizeDupName('A', null)).toBeNull();
    expect(normalizeDupName(null, null)).toBeNull();
  });

  it('match types join in canonical order whatever order the fields arrive', () => {
    expect(matchTypeOf(['email', 'phone'])).toBe('phone_email');
    expect(matchTypeOf(['name', 'phone', 'email'])).toBe('phone_email_name');
    expect(matchTypeOf(['name'])).toBe('name');
    expect(matchTypeOf([])).toBeNull();
  });

  it('phone or email certainty is 100; a name alone is 90', () => {
    expect(confidenceOf(['phone'])).toBe(100);
    expect(confidenceOf(['email', 'name'])).toBe(100);
    expect(confidenceOf(['name'])).toBe(90);
  });

  it('the older lead is always the keeper; created_at ties break on id', () => {
    const older = { id: 'a', created_at: '2026-08-01T00:00:00Z' };
    const newer = { id: 'b', created_at: '2026-08-15T00:00:00Z' };
    expect(orientPair(older, newer)).toEqual({ lead_id: 'b', duplicate_of: 'a' });
    expect(orientPair(newer, older)).toEqual({ lead_id: 'b', duplicate_of: 'a' });
    const twinA = { id: 'a', created_at: '2026-08-01T00:00:00Z' };
    const twinB = { id: 'b', created_at: '2026-08-01T00:00:00Z' };
    expect(orientPair(twinA, twinB)).toEqual({ lead_id: 'b', duplicate_of: 'a' });
  });
});
