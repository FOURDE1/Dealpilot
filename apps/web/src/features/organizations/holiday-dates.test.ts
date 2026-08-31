import { describe, expect, it } from 'vitest';
import { UpdateStoreInput } from '@dealpilot/schemas';
import {
  HOLIDAY_MAX,
  addHoliday,
  holidayListErrors,
  holidaysChanged,
  isCalendarDate,
  normalizeHolidays,
  removeHoliday,
} from './holiday-dates.js';

/**
 * F-76 (A2) — two kinds of rule, kept apart on purpose.
 *
 * The first block is LOCKSTEP: whatever the client refuses, the schema
 * refuses, and vice versa — asserted through `UpdateStoreInput.safeParse`
 * rather than a re-statement of the regex, and asserted on BOTH client
 * functions: `holidayListErrors` (the three checks by name) and `addHoliday`
 * (the path the field actually runs on « Ajouter » / Enter, which delegates
 * to it). Binding the form's own path is what makes the guard's title true:
 * a drift in `addHoliday` alone is red here, not only in a convenience case.
 * The second block is the client's own conveniences (dedupe, sort); the
 * schema holds no such rule and the test says so, so nobody reads it as a
 * server guarantee.
 */

/** 60 distinct valid dates: the 1st..28th of Jan–Feb 2027, then a few in March. */
function validDates(n: number): string[] {
  const out: string[] = [];
  for (let m = 1; out.length < n; m++) {
    for (let d = 1; d <= 28 && out.length < n; d++) {
      out.push(`2027-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
  }
  return out;
}

const agrees = (list: string[]) =>
  expect(UpdateStoreInput.safeParse({ holiday_dates: list }).success, JSON.stringify(list).slice(0, 80)).toBe(
    holidayListErrors(list).length === 0,
  );

/**
 * The form's path: `addHoliday(list, value)` accepts exactly when the schema
 * accepts the list it would then send (`normalizeHolidays` is the convenience
 * layer the schema does not care about, so the refused case is judged on the
 * un-normalised append — what the form would have sent had it not refused).
 */
const agreesAdd = (list: string[], value: string) => {
  const result = addHoliday(list, value);
  const sent = result.ok ? result.list : [...list, value];
  expect(UpdateStoreInput.safeParse({ holiday_dates: sent }).success, `${JSON.stringify(list).slice(0, 40)} + ${JSON.stringify(value)}`).toBe(result.ok);
};

describe('lockstep with UpdateStoreInput: format, calendar validity, max 60', () => {
  it('refuses what the schema refuses — regex misses, 2026-02-30, 2027-02-29, 61 entries', () => {
    for (const list of [
      ['2026-1-01'],
      ['26-12-25'],
      ['2026/12/25'],
      ['2026-12-25T00:00:00.000Z'],
      ['2026-02-30'],
      ['2027-02-29'],
      ['2026-13-01'],
      ['2026-00-10'],
      // The year bound (1900–2199): year 0 does not exist in Postgres, and a
      // three-digit year is what a mistyped native date input produces.
      ['0000-01-01'],
      ['0001-01-01'],
      ['0202-12-25'],
      ['0999-01-01'],
      ['1899-12-31'],
      ['2200-01-01'],
      validDates(61),
    ]) {
      expect(holidayListErrors(list).length, JSON.stringify(list).slice(0, 80)).toBeGreaterThan(0);
      agrees(list);
      // The same refusal through the form's path: the last entry added to the rest.
      agreesAdd(list.slice(0, -1), list[list.length - 1] ?? '');
      expect(addHoliday(list.slice(0, -1), list[list.length - 1] ?? '').ok).toBe(false);
    }
  });

  it('accepts what the schema accepts — real dates, leap day 2028, exactly 60 entries, the empty list', () => {
    for (const list of [[], ['2026-12-25', '2027-01-01'], ['2028-02-29'], ['1900-01-01', '2199-12-31'], validDates(HOLIDAY_MAX)]) {
      expect(holidayListErrors(list)).toEqual([]);
      agrees(list);
      if (list.length > 0) {
        agreesAdd(list.slice(0, -1), list[list.length - 1] ?? '');
        expect(addHoliday(list.slice(0, -1), list[list.length - 1] ?? '').ok).toBe(true);
      }
    }
  });

  it('the form’s add refuses an invalid date and the 61st distinct date with the reason the field renders; re-adding an existing one at 60 is a no-op', () => {
    expect(addHoliday([], '2026-02-30')).toEqual({ ok: false, reason: 'invalid' });
    expect(addHoliday([], '0202-12-25')).toEqual({ ok: false, reason: 'invalid' });
    expect(addHoliday([], '')).toEqual({ ok: false, reason: 'invalid' });
    agreesAdd([], '');
    const full = validDates(HOLIDAY_MAX);
    expect(addHoliday(full, '2029-07-01')).toEqual({ ok: false, reason: 'max' });
    agreesAdd(full, '2029-07-01');
    // An invalid date on a full list is 'invalid' (the fix is the date), not 'max'.
    expect(addHoliday(full, '2029-02-30')).toEqual({ ok: false, reason: 'invalid' });
    expect(addHoliday(full, full[3] ?? '')).toEqual({ ok: true, list: full });
  });

  it('names each error kind once', () => {
    expect(holidayListErrors(['nope', '2026-02-30', ...validDates(60)])).toEqual(['format', 'calendar', 'max']);
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(isCalendarDate('2026-02-28')).toBe(true);
    expect(isCalendarDate('0001-01-01')).toBe(false);
    expect(isCalendarDate('2199-12-31')).toBe(true);
  });
});

describe('client-only conveniences: dedupe and sort (NOT schema rules — the schema accepts duplicates in any order)', () => {
  it('the schema does accept a duplicate, which is why dedupe is a convenience', () => {
    expect(UpdateStoreInput.safeParse({ holiday_dates: ['2026-12-25', '2026-12-25'] }).success).toBe(true);
  });

  it('add stores the literal YYYY-MM-DD, deduplicates and sorts', () => {
    const first = addHoliday([], '2027-01-01');
    expect(first).toEqual({ ok: true, list: ['2027-01-01'] });
    const second = addHoliday(first.ok ? first.list : [], '2026-12-25');
    expect(second).toEqual({ ok: true, list: ['2026-12-25', '2027-01-01'] });
    const again = addHoliday(second.ok ? second.list : [], '2026-12-25');
    expect(again).toEqual({ ok: true, list: ['2026-12-25', '2027-01-01'] });
    expect(normalizeHolidays(['2027-01-01', '2026-12-25', '2027-01-01'])).toEqual(['2026-12-25', '2027-01-01']);
  });

  it('remove and changed', () => {
    expect(removeHoliday(['2026-12-25', '2027-01-01'], '2026-12-25')).toEqual(['2027-01-01']);
    expect(holidaysChanged(['2027-01-01', '2026-12-25'], ['2026-12-25', '2027-01-01'])).toBe(false);
    expect(holidaysChanged(['2026-12-25'], ['2026-12-25', '2027-01-01'])).toBe(true);
  });
});
