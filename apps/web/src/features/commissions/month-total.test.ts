import { describe, expect, it } from 'vitest';
import { monthTotal } from './commissions-page.js';

describe('monthTotal', () => {
  const now = new Date('2026-07-25T12:00:00');
  it('sums only the current month (half-open)', () => {
    expect(
      monthTotal(
        [
          // Mid-month stamps: the assertion must hold in every timezone.
          { amount_cents: 137_500, funded_at: '2026-07-05T12:00:00Z' },
          { amount_cents: 27_500, funded_at: '2026-07-24T12:00:00Z' },
          { amount_cents: 99_900, funded_at: '2026-06-15T12:00:00Z' },
          { amount_cents: 11_100, funded_at: '2026-08-15T12:00:00Z' },
          { amount_cents: -5_000, funded_at: '2026-07-10T12:00:00Z' }, // clawback subtracts
        ],
        now,
      ),
    ).toBe(137_500 + 27_500 - 5_000);
  });
  it('is zero when empty', () => {
    expect(monthTotal([], now)).toBe(0);
  });
});
