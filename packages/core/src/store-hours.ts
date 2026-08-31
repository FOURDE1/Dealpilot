import { utcForLocal, zonedParts } from './compliance-quiet-hours.js';

/**
 * Is the store open right now, and if not, when does it reopen? (F-76)
 *
 * `stores.business_hours` and `stores.holiday_dates` were added in 0054 with
 * the note that their CONSUMER arrives with the AI engine. The engine landed
 * without it: the assistant's prompt has carried `withinBusinessHours: true`
 * and `hoursText: null` for every store since, telling a customer at 03:00 on
 * Christmas that the dealership is open. This module is that consumer — pure,
 * so the worker's wiring is one call and the arithmetic is golden-tested here.
 *
 * The clock is the one quiet-hours already proved across the March DST jump
 * (`zonedParts`/`utcForLocal`); no second clock is written.
 *
 * Two deliberate choices, both recorded in D-077:
 *  - An EMPTY grid means "hours not configured", not "always closed":
 *    `known: false`, and the worker keeps today's behaviour (open, no
 *    `Hours:` line) — except on a listed holiday, which closes the store for
 *    the day whether or not a grid exists: the holiday is the stronger
 *    statement, and the holidays hint promises it without a grid. The
 *    alternative would have every store that never filled the grid promise a
 *    morning follow-up at 14:00 on a Tuesday.
 *  - Phrases are COARSE ("later today", "tomorrow morning", "on Monday"), and
 *    a weekday name is used only for an opening inside the coming six days;
 *    from a week out the phrase is « dès la réouverture », because "on
 *    Monday" said nine days before that Monday is read as the coming one.
 *    Block 2 of the prompt forbids promising a reply time, and block 4 renders
 *    "somebody will follow up {phrase}" — an exact clock time there would be a
 *    callback promise nobody has made.
 */

export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
/** Monday-first, the order the grid renders and `hoursText` prints. */
export const DAY_KEYS: readonly DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export interface DayWindow {
  readonly open: string;
  readonly close: string;
}

/**
 * The grid as it comes out of the row: any key, any string. `Store.business_hours`
 * is deliberately not tightened (F-76 MUST CUT), so this reads defensively — a
 * key outside `DAY_KEYS` or a window that is not `HH:MM` counts as closed.
 */
export type BusinessHoursLike = Readonly<Record<string, DayWindow | undefined>>;

export interface StoreOpenState {
  /** The grid names at least one day with a valid window. */
  readonly known: boolean;
  /** known, today is not a holiday, today has a window, and open ≤ now < close. */
  readonly open: boolean;
  /** Today, in the store's zone, is a listed holiday — read even when the grid is unknown. */
  readonly todayIsHoliday: boolean;
  /**
   * The next opening instant when the store is CLOSED, holidays skipped,
   * looking at most 14 days ahead (today included). `null` when open, when
   * the grid is unknown, or when no opening falls inside the bound.
   */
  readonly nextOpenAtUtc: Date | null;
  /**
   * Coarse, per conversation language (block 4 of the prompt is never cached).
   * A weekday name only for an opening inside the coming six days;
   * non-committal (« dès la réouverture ») from a week out and whenever
   * `nextOpenAtUtc` is null.
   */
  readonly nextOpenPhrase: { readonly fr: string; readonly en: string };
  /**
   * ONE English line for the cached tenant block ('Mon–Fri 09:00–18:00, Sat
   * closed, Sun closed'); a per-language line there would double each store's
   * prompt-cache variants (ADR-022). `null` when the grid is unknown.
   */
  readonly hoursText: string | null;
}

const REOPEN_PHRASE = { fr: 'dès la réouverture', en: 'when the store reopens' } as const;

/** Sunday-first, as `Date#getUTCDay()` and `zonedParts().weekday` number them. */
const WEEKDAY_TO_KEY: readonly DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WEEKDAY_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'] as const;
const WEEKDAY_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const DAY_LABEL_EN: Record<DayKey, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
};

/** Days searched for the next opening, today included. */
const LOOKAHEAD_DAYS = 14;
/**
 * The last offset a bare weekday name is unambiguous for. Six days out the
 * nearest "Monday" IS the opening; seven or more days out it is a week early
 * (Quebec's two-week construction holiday is the everyday case).
 */
const WEEKDAY_NAME_MAX_OFFSET = 6;

const HHMM = /^(\d{2}):(\d{2})/;

/** Minutes since midnight, or null when the text is not `HH:MM…`. */
function minutesOrNull(text: string | undefined): number | null {
  const m = typeof text === 'string' ? HHMM.exec(text) : null;
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 24 || mm > 59) return null;
  return hh * 60 + mm;
}

interface ValidWindow {
  readonly openMin: number;
  readonly closeMin: number;
  /** `HH:MM`, as printed. */
  readonly open: string;
  readonly close: string;
}

/** The day's window if it is a real one (both times `HH:MM`, close after open). */
function windowFor(hours: BusinessHoursLike, key: DayKey): ValidWindow | null {
  const day = hours[key];
  if (!day) return null;
  const openMin = minutesOrNull(day.open);
  const closeMin = minutesOrNull(day.close);
  if (openMin === null || closeMin === null || closeMin <= openMin) return null;
  return { openMin, closeMin, open: day.open.slice(0, 5), close: day.close.slice(0, 5) };
}

const pad2 = (n: number): string => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number): string => `${y}-${pad2(m)}-${pad2(d)}`;

/**
 * The English hours line: consecutive days with an identical window are
 * grouped ('Mon–Fri 09:00–18:00'); closed days are listed one by one so a
 * reader never has to work out which days a closed range covers. `null` for
 * an empty grid — the prompt then prints no `Hours:` line at all.
 */
export function hoursText(hours: BusinessHoursLike): string | null {
  const windows = DAY_KEYS.map((key) => ({ key, w: windowFor(hours, key) }));
  if (windows.every((d) => d.w === null)) return null;

  const parts: string[] = [];
  let i = 0;
  while (i < windows.length) {
    const start = windows[i];
    if (start === undefined) break;
    if (start.w === null) {
      parts.push(`${DAY_LABEL_EN[start.key]} closed`);
      i += 1;
      continue;
    }
    let j = i;
    while (j + 1 < windows.length) {
      const next = windows[j + 1];
      if (next === undefined || next.w === null) break;
      if (next.w.open !== start.w.open || next.w.close !== start.w.close) break;
      j += 1;
    }
    const last = windows[j];
    const label = j > i && last !== undefined
      ? `${DAY_LABEL_EN[start.key]}–${DAY_LABEL_EN[last.key]}`
      : DAY_LABEL_EN[start.key];
    parts.push(`${label} ${start.w.open}–${start.w.close}`);
    i = j + 1;
  }
  return parts.join(', ');
}

/** The coarse phrase for an opening `dayOffset` days from today at `openMin`. */
function phraseFor(dayOffset: number, openMin: number, weekday: number): { fr: string; en: string } {
  if (dayOffset === 0) return { fr: 'plus tard aujourd’hui', en: 'later today' };
  if (dayOffset === 1) {
    return openMin < 12 * 60
      ? { fr: 'demain matin', en: 'tomorrow morning' }
      : { fr: 'demain après-midi', en: 'tomorrow afternoon' };
  }
  if (dayOffset > WEEKDAY_NAME_MAX_OFFSET) return REOPEN_PHRASE;
  const fr = WEEKDAY_FR[weekday];
  const en = WEEKDAY_EN[weekday];
  return fr && en ? { fr, en: `on ${en}` } : REOPEN_PHRASE;
}

const UNKNOWN: StoreOpenState = {
  known: false,
  open: false,
  todayIsHoliday: false,
  nextOpenAtUtc: null,
  nextOpenPhrase: REOPEN_PHRASE,
  hoursText: null,
};

/**
 * Open/closed/next opening for one store at one instant.
 *
 * Never throws: `assertKnownTimezone` refuses unknown names at every store
 * write, but a row that predates it (or a zone a newer tzdata dropped) must
 * not crash a customer's reply — it reads as "hours unknown", which the
 * worker treats as today's behaviour.
 */
export function storeOpenState(input: {
  readonly hours: BusinessHoursLike;
  readonly holidays: readonly string[];
  readonly timezone: string;
  readonly nowUtc: Date;
}): StoreOpenState {
  let now: ReturnType<typeof zonedParts>;
  try {
    now = zonedParts(input.nowUtc, input.timezone);
  } catch {
    return UNKNOWN;
  }
  const holidays = new Set(input.holidays);
  const todayIsHoliday = holidays.has(ymd(now.year, now.month, now.day));

  // The holiday list is read BEFORE the grid: a listed day is closed whether
  // or not hours were ever set (the holidays hint promises exactly that, and
  // the grid-less store is the common one). Without a grid there is no
  // reopening instant to name, so the phrase stays non-committal.
  const text = hoursText(input.hours);
  if (text === null) return { ...UNKNOWN, todayIsHoliday };

  const nowMin = now.hour * 60 + now.minute;
  const todayKey = WEEKDAY_TO_KEY[now.weekday] ?? 'sun';
  const today = windowFor(input.hours, todayKey);
  // Half-open, as the quiet-hours window is: 17:59 is open, 18:00 is not.
  const open = !todayIsHoliday && today !== null && nowMin >= today.openMin && nowMin < today.closeMin;

  if (open) {
    return { known: true, open: true, todayIsHoliday, nextOpenAtUtc: null, nextOpenPhrase: REOPEN_PHRASE, hoursText: text };
  }

  // Walk the LOCAL calendar forward. The date arithmetic runs on UTC fields of
  // a date-only value, so a 23- or 25-hour day never makes the walk skip or
  // repeat a calendar day; only the final instant asks the zone.
  const base = Date.UTC(now.year, now.month - 1, now.day);
  for (let offset = 0; offset < LOOKAHEAD_DAYS; offset++) {
    const d = new Date(base + offset * 86_400_000);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    if (holidays.has(ymd(y, m, day))) continue;
    const weekday = d.getUTCDay();
    const w = windowFor(input.hours, WEEKDAY_TO_KEY[weekday] ?? 'sun');
    if (w === null) continue;
    if (offset === 0 && nowMin >= w.openMin) continue; // today's window is already behind us
    return {
      known: true,
      open: false,
      todayIsHoliday,
      nextOpenAtUtc: utcForLocal(input.timezone, y, m, day, Math.floor(w.openMin / 60), w.openMin % 60),
      nextOpenPhrase: phraseFor(offset, w.openMin, weekday),
      hoursText: text,
    };
  }
  // Two weeks of holidays or a grid with no reachable day: closed, and the
  // only honest promise is none.
  return { known: true, open: false, todayIsHoliday, nextOpenAtUtc: null, nextOpenPhrase: REOPEN_PHRASE, hoursText: text };
}

/**
 * The prompt's `Right now:` line, store-local and in the conversation's
 * language (« mardi 1 septembre 2026 à 03 h 00 »). Before F-76 this was
 * `now.toISOString()` — a UTC timestamp the model had to convert itself.
 * An unknown timezone falls back to that ISO string rather than throwing.
 */
export function localDateTimeText(nowUtc: Date, timezone: string, lang: 'fr' | 'en'): string {
  try {
    return new Intl.DateTimeFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: timezone,
    }).format(nowUtc);
  } catch {
    return nowUtc.toISOString();
  }
}
