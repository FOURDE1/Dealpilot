/**
 * F-76 — the holiday list, pure.
 *
 * The API's rule (`HolidayDatesShape`, packages/schemas/src/store.ts): each
 * entry is `YYYY-MM-DD`, a real calendar date in 1900–2199, at most 60 of
 * them. The client mirrors exactly those three checks in `holidayListErrors`,
 * and the field's « Ajouter » runs `addHoliday`, which DELEGATES to it — so
 * the function the owner exercises is the function the lockstep binds
 * (holiday-dates.test.ts asserts both against `UpdateStoreInput.safeParse`).
 *
 * Deduplication and sorting are CLIENT conveniences — the schema accepts
 * duplicates and any order — so they live in `addHoliday`/`normalizeHolidays`
 * and are tested as conveniences, not as lockstep.
 */

export const HOLIDAY_MAX = 60;
export const HOLIDAY_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/** The schema's year bound: no year 0 in Postgres, no three-digit year from a mistyped input. */
export const HOLIDAY_YEAR_MIN = 1900;
export const HOLIDAY_YEAR_MAX = 2199;

/**
 * The same bound-then-rebuild-and-compare the schema does (JS rolls 02-30 to
 * 03-02). Line for line the `isCalendarDate` of packages/schemas/src/store.ts;
 * the lockstep test is what lets the two exist.
 */
export function isCalendarDate(s: string): boolean {
  if (!HOLIDAY_FORMAT.test(s)) return false;
  const year = Number(s.slice(0, 4));
  if (year < HOLIDAY_YEAR_MIN || year > HOLIDAY_YEAR_MAX) return false;
  const rebuilt = new Date(0);
  rebuilt.setUTCFullYear(year, Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return rebuilt.toISOString().slice(0, 10) === s;
}

export type HolidayListError = 'format' | 'calendar' | 'max';

export function holidayListErrors(list: readonly string[]): HolidayListError[] {
  const errors = new Set<HolidayListError>();
  for (const value of list) {
    if (!HOLIDAY_FORMAT.test(value)) errors.add('format');
    else if (!isCalendarDate(value)) errors.add('calendar');
  }
  if (list.length > HOLIDAY_MAX) errors.add('max');
  return [...errors];
}

/** Unique, ascending — `YYYY-MM-DD` sorts as text. */
export function normalizeHolidays(list: readonly string[]): string[] {
  return [...new Set(list)].sort();
}

export type AddHolidayResult =
  | { readonly ok: true; readonly list: string[] }
  | { readonly ok: false; readonly reason: 'invalid' | 'max' };

/**
 * The form's path. The list it would send is judged by the same three checks
 * the schema applies (`holidayListErrors`); a bad date is 'invalid' whatever
 * the list's size (the fix is the date), a 61st distinct date is 'max'.
 * Adding a date already present is a no-op.
 */
export function addHoliday(list: readonly string[], value: string): AddHolidayResult {
  const date = value.trim();
  const next = normalizeHolidays([...list, date]);
  const errors = holidayListErrors(next);
  if (errors.includes('format') || errors.includes('calendar')) return { ok: false, reason: 'invalid' };
  if (errors.includes('max')) return { ok: false, reason: 'max' };
  return { ok: true, list: next };
}

export function removeHoliday(list: readonly string[], value: string): string[] {
  return list.filter((d) => d !== value);
}

export function holidaysChanged(draft: readonly string[], base: readonly string[]): boolean {
  return JSON.stringify(normalizeHolidays(draft)) !== JSON.stringify(normalizeHolidays(base));
}
