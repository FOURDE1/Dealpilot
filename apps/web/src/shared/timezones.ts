/**
 * F-76 (A8) — the one curated timezone list, as a LEAF module.
 *
 * `assertKnownTimezone` (apps/api) accepts region/city IANA names only, and
 * these twelve are the Canadian ones it was probed against (each PATCHes to
 * 200 — f01's lockstep test names this file). Both the provisioning form
 * (F-70) and the store form (F-76) render this list in a `Select` with an
 * « Autre (nom IANA) » escape to a free-text input; the server stays the
 * only authority on whether a typed name exists. Nothing here imports a page
 * module, so a form can pull the list without pulling another form's chunk.
 */
export const CANADA_TIMEZONES = [
  'America/St_Johns',
  'America/Halifax',
  'America/Moncton',
  'America/Montreal',
  'America/Toronto',
  'America/Winnipeg',
  'America/Regina',
  'America/Edmonton',
  'America/Vancouver',
  'America/Whitehorse',
  'America/Yellowknife',
  'America/Iqaluit',
] as const;
export type CanadaTimezone = (typeof CANADA_TIMEZONES)[number];

/** The `Select` option that reveals the free-text IANA input. Never sent to the server. */
export const OTHER_TZ = '__other__';

export function isKnownTimezone(tz: string): tz is CanadaTimezone {
  return (CANADA_TIMEZONES as readonly string[]).includes(tz);
}
