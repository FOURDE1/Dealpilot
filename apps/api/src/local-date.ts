/**
 * YYYY-MM-DD from a Date's local parts — never via UTC.
 *
 * pg parses a `date` column into a JS Date at SERVER-LOCAL midnight, and
 * `toISOString()` then moves the day backwards on any server ahead of UTC
 * (F-07 found this on `vehicles.acquisition_date`: a car acquired 1 July was
 * reported as 30 June). The local getters read the day pg meant.
 *
 * Extracted from f07-vehicles-routes.ts in F-76 so the store-row serialiser
 * (`holiday_dates`, a `date[]`) shares the one correct rendering instead of
 * a second copy. The year is padded to four digits like the month and the
 * day: pg hands a year below 1000 back as a Date whose `getFullYear()` is
 * 1, 99 or 999, and an unpadded `1-01-01` fails the `YYYY-MM-DD` contract
 * every store exit is parsed against (the F-76 review's C1). The schema now
 * refuses such years on the way in; this keeps the rendering honest for any
 * row that predates it.
 */
export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).padStart(4, '0')}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
