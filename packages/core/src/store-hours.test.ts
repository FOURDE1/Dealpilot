import { describe, expect, it } from 'vitest';
import { utcForLocal } from './compliance-quiet-hours.js';
import { hoursText, localDateTimeText, storeOpenState, type BusinessHoursLike } from './store-hours.js';

/**
 * Golden cases for the store clock (F-76). Fixed instants, `America/Toronto`.
 *
 * Every case pins an instant the worker's tests cannot afford to enumerate:
 * the half-open close, a holiday today and tomorrow, the two-week bound, the
 * March DST jump, and the two shapes that must NOT throw — an empty grid and a
 * timezone `Intl` does not know.
 */

const TZ = 'America/Toronto';
/** A Toronto wall clock as a UTC instant, through the same helper the module uses. */
const at = (y: number, mo: number, d: number, hh: number, mm: number): Date => utcForLocal(TZ, y, mo, d, hh, mm);

const WEEKDAYS: BusinessHoursLike = {
  mon: { open: '09:00', close: '18:00' },
  tue: { open: '09:00', close: '18:00' },
  wed: { open: '09:00', close: '18:00' },
  thu: { open: '09:00', close: '18:00' },
  fri: { open: '09:00', close: '18:00' },
};
const WITH_SATURDAY: BusinessHoursLike = { ...WEEKDAYS, sat: { open: '09:00', close: '16:00' } };

// 2026-09-01 is a Tuesday; 2026-09-04 a Friday; 2026-03-08 the DST Sunday.
const TUE = { y: 2026, m: 9, d: 1 };

describe('storeOpenState — open, closed, and what comes next', () => {
  it('Tuesday 14:00 inside Mon–Fri 09–18 is open, with the English hours line', () => {
    const s = storeOpenState({ hours: WEEKDAYS, holidays: [], timezone: TZ, nowUtc: at(TUE.y, TUE.m, TUE.d, 14, 0) });
    expect(s.known).toBe(true);
    expect(s.open).toBe(true);
    expect(s.todayIsHoliday).toBe(false);
    expect(s.nextOpenAtUtc).toBeNull();
    expect(s.hoursText).toBe('Mon–Fri 09:00–18:00, Sat closed, Sun closed');
  });

  it('08:30 the same day is closed; the next opening is 09:00 local and the phrase is "later today"', () => {
    const s = storeOpenState({ hours: WEEKDAYS, holidays: [], timezone: TZ, nowUtc: at(TUE.y, TUE.m, TUE.d, 8, 30) });
    expect(s.open).toBe(false);
    expect(s.nextOpenAtUtc?.toISOString()).toBe(at(TUE.y, TUE.m, TUE.d, 9, 0).toISOString());
    expect(s.nextOpenPhrase).toEqual({ fr: 'plus tard aujourd’hui', en: 'later today' });
  });

  it('18:00 exactly is closed (half-open, like the quiet-hours window) and 17:59 is not', () => {
    const closing = storeOpenState({ hours: WEEKDAYS, holidays: [], timezone: TZ, nowUtc: at(TUE.y, TUE.m, TUE.d, 18, 0) });
    expect(closing.open).toBe(false);
    expect(closing.nextOpenAtUtc?.toISOString()).toBe(at(2026, 9, 2, 9, 0).toISOString());
    expect(closing.nextOpenPhrase).toEqual({ fr: 'demain matin', en: 'tomorrow morning' });

    const lastMinute = storeOpenState({ hours: WEEKDAYS, holidays: [], timezone: TZ, nowUtc: at(TUE.y, TUE.m, TUE.d, 17, 59) });
    expect(lastMinute.open).toBe(true);
  });

  it('Friday 20:00 with no weekend window waits for Monday 09:00 — a weekday name, no clock time', () => {
    const s = storeOpenState({ hours: WEEKDAYS, holidays: [], timezone: TZ, nowUtc: at(2026, 9, 4, 20, 0) });
    expect(s.open).toBe(false);
    expect(s.nextOpenAtUtc?.toISOString()).toBe(at(2026, 9, 7, 9, 0).toISOString());
    expect(s.nextOpenPhrase).toEqual({ fr: 'lundi', en: 'on Monday' });
  });

  it('a holiday today closes the store all day; the next opening is tomorrow', () => {
    const s = storeOpenState({ hours: WEEKDAYS, holidays: ['2026-09-01'], timezone: TZ, nowUtc: at(TUE.y, TUE.m, TUE.d, 14, 0) });
    expect(s.open).toBe(false);
    expect(s.todayIsHoliday).toBe(true);
    expect(s.nextOpenAtUtc?.toISOString()).toBe(at(2026, 9, 2, 9, 0).toISOString());
    expect(s.nextOpenPhrase).toEqual({ fr: 'demain matin', en: 'tomorrow morning' });
  });

  it('a holiday tomorrow is skipped; the next opening is the day after', () => {
    const s = storeOpenState({ hours: WEEKDAYS, holidays: ['2026-09-02'], timezone: TZ, nowUtc: at(TUE.y, TUE.m, TUE.d, 20, 0) });
    expect(s.open).toBe(false);
    expect(s.todayIsHoliday).toBe(false);
    expect(s.nextOpenAtUtc?.toISOString()).toBe(at(2026, 9, 3, 9, 0).toISOString());
    expect(s.nextOpenPhrase).toEqual({ fr: 'jeudi', en: 'on Thursday' });
  });

  it('an empty grid is UNKNOWN — not closed — with no hours line and no next opening', () => {
    const s = storeOpenState({ hours: {}, holidays: [], timezone: TZ, nowUtc: at(TUE.y, TUE.m, TUE.d, 14, 0) });
    expect(s).toMatchObject({ known: false, open: false, nextOpenAtUtc: null, hoursText: null });
    // Only coarse, non-committal words are ever available for an unknown grid.
    expect(s.nextOpenPhrase).toEqual({ fr: 'dès la réouverture', en: 'when the store reopens' });
  });

  it('a listed holiday closes the store all day even with NO grid — the holiday is the stronger statement', () => {
    // The holidays hint promises « Un jour férié compte comme fermé toute la
    // journée pour l’assistant » without conditioning it on a grid; the dev
    // store's grid is `{}`, so this is the common shape, not the corner.
    const s = storeOpenState({ hours: {}, holidays: ['2026-09-01'], timezone: TZ, nowUtc: at(TUE.y, TUE.m, TUE.d, 14, 0) });
    expect(s).toMatchObject({ known: false, open: false, todayIsHoliday: true, nextOpenAtUtc: null, hoursText: null });
    expect(s.nextOpenPhrase).toEqual({ fr: 'dès la réouverture', en: 'when the store reopens' });

    // The day after, the same grid-less store is back to "unknown" — open by default.
    const after = storeOpenState({ hours: {}, holidays: ['2026-09-01'], timezone: TZ, nowUtc: at(2026, 9, 2, 14, 0) });
    expect(after).toMatchObject({ known: false, open: false, todayIsHoliday: false, nextOpenAtUtc: null, hoursText: null });

    // "Today" is the STORE's day: 02:30 Toronto on the 2nd is still 23:30 on the 1st in Vancouver.
    const west = storeOpenState({ hours: {}, holidays: ['2026-09-01'], timezone: 'America/Vancouver', nowUtc: at(2026, 9, 2, 2, 30) });
    expect(west.todayIsHoliday).toBe(true);
    const east = storeOpenState({ hours: {}, holidays: ['2026-09-01'], timezone: TZ, nowUtc: at(2026, 9, 2, 2, 30) });
    expect(east.todayIsHoliday).toBe(false);
  });

  it('a grid whose only windows are invalid (close before open, bad text) is also unknown', () => {
    const s = storeOpenState({
      hours: { mon: { open: '18:00', close: '09:00' }, tue: { open: 'nine', close: '17:00' } },
      holidays: [], timezone: TZ, nowUtc: at(TUE.y, TUE.m, TUE.d, 14, 0),
    });
    expect(s.known).toBe(false);
    expect(hoursText({ monday: { open: '09:00', close: '17:00' } })).toBeNull();
  });

  it('a Saturday-only grid on a Tuesday names Saturday, whatever the hour', () => {
    const s = storeOpenState({ hours: { sat: { open: '13:00', close: '17:00' } }, holidays: [], timezone: TZ, nowUtc: at(TUE.y, TUE.m, TUE.d, 14, 0) });
    expect(s.open).toBe(false);
    expect(s.nextOpenAtUtc?.toISOString()).toBe(at(2026, 9, 5, 13, 0).toISOString());
    expect(s.nextOpenPhrase).toEqual({ fr: 'samedi', en: 'on Saturday' });
    expect(s.hoursText).toBe('Mon closed, Tue closed, Wed closed, Thu closed, Fri closed, Sat 13:00–17:00, Sun closed');
  });

  it('tomorrow at or after noon reads "tomorrow afternoon", not "tomorrow morning"', () => {
    const s = storeOpenState({
      hours: { wed: { open: '12:00', close: '20:00' } }, holidays: [], timezone: TZ, nowUtc: at(TUE.y, TUE.m, TUE.d, 14, 0),
    });
    expect(s.nextOpenPhrase).toEqual({ fr: 'demain après-midi', en: 'tomorrow afternoon' });
  });

  it('DST Sunday 2026-03-08 at 01:30 EST: the 09:00 opening is 09:00 EDT = 13:00Z (utcForLocal reused)', () => {
    // 01:30 local is still EST (UTC-5) — 06:30Z. At 02:00 the clocks jump.
    const nowUtc = new Date('2026-03-08T06:30:00Z');
    const s = storeOpenState({ hours: { sun: { open: '09:00', close: '17:00' } }, holidays: [], timezone: TZ, nowUtc });
    expect(s.open).toBe(false);
    expect(s.nextOpenAtUtc?.toISOString()).toBe('2026-03-08T13:00:00.000Z');
    expect(s.nextOpenPhrase).toEqual({ fr: 'plus tard aujourd’hui', en: 'later today' });
  });

  it('14 consecutive holidays exhaust the bound: closed, no instant, and the non-committal phrase', () => {
    const holidays = Array.from({ length: 14 }, (_, i) => `2026-09-${String(1 + i).padStart(2, '0')}`);
    const s = storeOpenState({ hours: WEEKDAYS, holidays, timezone: TZ, nowUtc: at(TUE.y, TUE.m, TUE.d, 14, 0) });
    expect(s).toMatchObject({ known: true, open: false, todayIsHoliday: true, nextOpenAtUtc: null });
    expect(s.nextOpenPhrase).toEqual({ fr: 'dès la réouverture', en: 'when the store reopens' });
    expect(s.hoursText).toBe('Mon–Fri 09:00–18:00, Sat closed, Sun closed');

    // One holiday fewer and the 15th day is reachable: Tue 2026-09-15.
    const s13 = storeOpenState({ hours: WEEKDAYS, holidays: holidays.slice(0, 13), timezone: TZ, nowUtc: at(TUE.y, TUE.m, TUE.d, 14, 0) });
    expect(s13.nextOpenAtUtc?.toISOString()).toBe(at(2026, 9, 14, 9, 0).toISOString());
  });

  it('a weekday name is promised only inside the coming six days; from a week out the phrase is non-committal', () => {
    const REOPEN = { fr: 'dès la réouverture', en: 'when the store reopens' };
    // Tue 2026-09-01 20:00 — today's window is behind us. Wed–Fri listed as
    // holidays, the weekend has no window: Monday 09-07 is offset 6.
    const now = at(TUE.y, TUE.m, TUE.d, 20, 0);
    const wedToFri = ['2026-09-02', '2026-09-03', '2026-09-04'];
    const six = storeOpenState({ hours: WEEKDAYS, holidays: wedToFri, timezone: TZ, nowUtc: now });
    expect(six.nextOpenAtUtc?.toISOString()).toBe(at(2026, 9, 7, 9, 0).toISOString());
    expect(six.nextOpenPhrase).toEqual({ fr: 'lundi', en: 'on Monday' });

    // Offset 7 (Tue 09-08): « mardi » said on a Tuesday evening reads as tomorrow's week, not next week's.
    const seven = storeOpenState({ hours: WEEKDAYS, holidays: [...wedToFri, '2026-09-07'], timezone: TZ, nowUtc: now });
    expect(seven.nextOpenAtUtc?.toISOString()).toBe(at(2026, 9, 8, 9, 0).toISOString());
    expect(seven.nextOpenPhrase).toEqual(REOPEN);

    // Offset 8 (Wed 09-09): « mercredi » would point at tomorrow — a listed holiday.
    const eight = storeOpenState({ hours: WEEKDAYS, holidays: [...wedToFri, '2026-09-07', '2026-09-08'], timezone: TZ, nowUtc: now });
    expect(eight.nextOpenAtUtc?.toISOString()).toBe(at(2026, 9, 9, 9, 0).toISOString());
    expect(eight.nextOpenPhrase).toEqual(REOPEN);

    // Offset 13 (Mon 09-14): the last day inside the bound still has an instant, and no weekday name.
    const twoWeeks = [...wedToFri, '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'];
    const thirteen = storeOpenState({ hours: WEEKDAYS, holidays: twoWeeks, timezone: TZ, nowUtc: now });
    expect(thirteen.nextOpenAtUtc?.toISOString()).toBe(at(2026, 9, 14, 9, 0).toISOString());
    expect(thirteen.nextOpenPhrase).toEqual(REOPEN);

    // Offset 14 (Tue 09-15) is outside the bound: no instant at all, same phrase.
    const fourteen = storeOpenState({ hours: WEEKDAYS, holidays: [...twoWeeks, '2026-09-14'], timezone: TZ, nowUtc: now });
    expect(fourteen).toMatchObject({ known: true, open: false, nextOpenAtUtc: null, nextOpenPhrase: REOPEN });
  });

  it('the Quebec construction holiday: a Saturday text during a two-week closure names no weekday for a Monday nine days out', () => {
    const REOPEN = { fr: 'dès la réouverture', en: 'when the store reopens' };
    const closure = [
      '2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24',
      '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31',
    ];
    // Sat 2026-07-25 10:00 EDT: « lundi » would be read as Jul 27 — a day the owner listed as closed.
    const sat = storeOpenState({ hours: WEEKDAYS, holidays: closure, timezone: 'America/Montreal', nowUtc: new Date('2026-07-25T14:00:00Z') });
    expect(sat.open).toBe(false);
    expect(sat.nextOpenAtUtc?.toISOString()).toBe('2026-08-03T13:00:00.000Z');
    expect(sat.nextOpenPhrase).toEqual(REOPEN);
    // Tue Jul 21 14:00: the same Monday, thirteen days out.
    const tue = storeOpenState({ hours: WEEKDAYS, holidays: closure, timezone: 'America/Montreal', nowUtc: new Date('2026-07-21T18:00:00Z') });
    expect(tue.nextOpenAtUtc?.toISOString()).toBe('2026-08-03T13:00:00.000Z');
    expect(tue.nextOpenPhrase).toEqual(REOPEN);
  });

  it('an unknown timezone never throws: the state reads as unknown', () => {
    expect(() => storeOpenState({ hours: WEEKDAYS, holidays: [], timezone: 'Mars/Olympus_Mons', nowUtc: at(TUE.y, TUE.m, TUE.d, 14, 0) })).not.toThrow();
    const s = storeOpenState({ hours: WEEKDAYS, holidays: [], timezone: 'Mars/Olympus_Mons', nowUtc: at(TUE.y, TUE.m, TUE.d, 14, 0) });
    expect(s).toMatchObject({ known: false, open: false, nextOpenAtUtc: null, hoursText: null });
  });

  it('a Vancouver store is judged on Vancouver time', () => {
    // 14:00 Toronto is 11:00 Vancouver — open either way; 07:00 Toronto is
    // 04:00 Vancouver and the phrase is still "later today".
    const s = storeOpenState({ hours: WEEKDAYS, holidays: [], timezone: 'America/Vancouver', nowUtc: at(TUE.y, TUE.m, TUE.d, 7, 0) });
    expect(s.open).toBe(false);
    expect(s.nextOpenAtUtc?.toISOString()).toBe(utcForLocal('America/Vancouver', 2026, 9, 1, 9, 0).toISOString());
    expect(s.nextOpenPhrase.en).toBe('later today');
  });
});

describe('hoursText — grouping', () => {
  it('groups consecutive identical windows and lists closed days one by one', () => {
    expect(hoursText(WITH_SATURDAY)).toBe('Mon–Fri 09:00–18:00, Sat 09:00–16:00, Sun closed');
    expect(hoursText({
      mon: { open: '09:00', close: '18:00' }, tue: { open: '09:00', close: '18:00' },
      wed: { open: '10:00', close: '18:00' },
      thu: { open: '09:00', close: '18:00' }, fri: { open: '09:00', close: '18:00' },
    })).toBe('Mon–Tue 09:00–18:00, Wed 10:00–18:00, Thu–Fri 09:00–18:00, Sat closed, Sun closed');
  });

  it('prints HH:MM even when the row carries seconds, and ignores keys outside the seven days', () => {
    expect(hoursText({ mon: { open: '09:00:00', close: '18:00:00' }, monday: { open: '00:00', close: '23:00' } }))
      .toBe('Mon 09:00–18:00, Tue closed, Wed closed, Thu closed, Fri closed, Sat closed, Sun closed');
  });

  it('is null for an empty grid', () => {
    expect(hoursText({})).toBeNull();
  });
});

describe('localDateTimeText — the prompt’s "Right now:" line, store-local', () => {
  const instant = at(TUE.y, TUE.m, TUE.d, 3, 0); // Tuesday 03:00 Toronto = 07:00Z

  it('French: weekday, date and the local hour — never the UTC timestamp', () => {
    const text = localDateTimeText(instant, TZ, 'fr');
    expect(text).toContain('mardi');
    expect(text).toContain('septembre 2026');
    expect(text).toMatch(/0?3 h 00/);
    expect(text).not.toContain('T07:00');
  });

  it('English: the same instant, same zone', () => {
    const text = localDateTimeText(instant, TZ, 'en');
    expect(text).toContain('Tuesday');
    expect(text).toContain('September 1, 2026');
    expect(text).toMatch(/3:00/);
  });

  it('falls back to the ISO string for a timezone Intl does not know, rather than throwing', () => {
    expect(localDateTimeText(instant, 'Mars/Olympus_Mons', 'fr')).toBe(instant.toISOString());
  });
});
