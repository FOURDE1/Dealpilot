import { describe, expect, it } from 'vitest';
import { UpdateStoreInput } from '@dealpilot/schemas';
import {
  DAY_KEYS,
  DEFAULT_WINDOW,
  emptyHours,
  fromStore,
  hoursChanged,
  hoursReducer,
  rowError,
  rowErrors,
  toPayload,
  type DayRow,
  type HoursDraft,
} from './hours-grid.js';

/**
 * F-76 (A23) — the grid against the schema it feeds.
 *
 * The last block is the one that matters: 200 seeded random drafts, each
 * judged by the client's `rowErrors` AND by `UpdateStoreInput.safeParse` on
 * the payload the client would send — per whole draft AND per open row — plus
 * a table of every named boundary with the verdict both sides must return.
 * The two must agree on every draft and every row — otherwise the form either
 * disables save for hours the server would take, or lets a save through that
 * comes back as a 422 the row cannot explain.
 */

const WEEK = { mon: { open: '09:00', close: '18:00' }, sat: { open: '10:00', close: '16:00' } };

describe('hours grid — load and payload', () => {
  it('round-trips a store\'s hours: load → payload deep-equals the input', () => {
    expect(toPayload(fromStore(WEEK))).toEqual(WEEK);
  });

  it('an all-closed draft is `{}` — a missing day IS a closed day', () => {
    expect(toPayload(emptyHours())).toEqual({});
    expect(toPayload(hoursReducer(fromStore(WEEK), { type: 'clear' }))).toEqual({});
  });

  it('ignores keys the schema does not know and slices seconds off the times', () => {
    const draft = fromStore({ mon: { open: '09:00:00', close: '18:00:00' }, monday: { open: '01:00', close: '02:00' } });
    expect(draft.mon).toEqual({ open: true, from: '09:00', to: '18:00' });
    expect(toPayload(draft)).toEqual({ mon: { open: '09:00', close: '18:00' } });
  });

  it('emits keys in DAY_KEYS order regardless of the order loaded', () => {
    const draft = fromStore({ fri: { open: '09:00', close: '12:00' }, mon: { open: '09:00', close: '12:00' }, tue: { open: '09:00', close: '12:00' } });
    expect(Object.keys(toPayload(draft))).toEqual(['mon', 'tue', 'fri']);
  });
});

describe('hours grid — the reducer', () => {
  it('toggling a closed day open seeds 09:00–18:00; toggling it closed omits it from the payload', () => {
    const opened = hoursReducer(emptyHours(), { type: 'toggle', day: 'wed' });
    expect(opened.wed).toEqual({ open: true, from: DEFAULT_WINDOW.from, to: DEFAULT_WINDOW.to });
    const closed = hoursReducer(opened, { type: 'toggle', day: 'wed' });
    expect(closed.wed.open).toBe(false);
    expect(toPayload(closed)).toEqual({});
  });

  it('the browser\'s `09:00:00` is stored as `09:00`', () => {
    const draft = hoursReducer(fromStore(WEEK), { type: 'time', day: 'mon', edge: 'to', value: '17:30:00' });
    expect(draft.mon.to).toBe('17:30');
  });

  it('copyMondayToWeekdays copies the flag and both times to tue..fri, leaving the weekend alone', () => {
    const draft = hoursReducer(fromStore(WEEK), { type: 'copyMondayToWeekdays' });
    for (const day of ['tue', 'wed', 'thu', 'fri'] as const) expect(draft[day]).toEqual(draft.mon);
    expect(draft.sat).toEqual({ open: true, from: '10:00', to: '16:00' });
    expect(draft.sun.open).toBe(false);
  });
});

describe('hours grid — row errors', () => {
  it('a closed row is never in error', () => {
    expect(rowError({ open: false, from: '', to: '' })).toBeNull();
    expect(rowError({ open: false, from: '18:00', to: '09:00' })).toBeNull();
  });

  it('an open row needs both times (`missing`) and close after open (`order`)', () => {
    expect(rowError({ open: true, from: '', to: '18:00' })).toBe('missing');
    expect(rowError({ open: true, from: '9:00', to: '18:00' })).toBe('missing');
    expect(rowError({ open: true, from: '18:00', to: '09:00' })).toBe('order');
    expect(rowError({ open: true, from: '09:00', to: '09:00' })).toBe('order');
    expect(rowError({ open: true, from: '09:00', to: '18:00' })).toBeNull();
  });

  it('rowErrors names the day', () => {
    const draft = hoursReducer(fromStore(WEEK), { type: 'time', day: 'sat', edge: 'to', value: '08:00' });
    expect(rowErrors(draft)).toEqual([{ day: 'sat', error: 'order' }]);
  });
});

describe('hours grid — hoursChanged', () => {
  it('is false for `{}` against an all-closed draft, and for an untouched load', () => {
    expect(hoursChanged(emptyHours(), {})).toBe(false);
    expect(hoursChanged(fromStore(WEEK), WEEK)).toBe(false);
  });

  it('is true once a time or a flag differs', () => {
    expect(hoursChanged(hoursReducer(fromStore(WEEK), { type: 'toggle', day: 'sun' }), WEEK)).toBe(true);
    expect(hoursChanged(hoursReducer(fromStore(WEEK), { type: 'time', day: 'mon', edge: 'to', value: '17:00' }), WEEK)).toBe(true);
  });
});

/** mulberry32 — deterministic, so a red run names a reproducible draft. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Valid and invalid shapes on purpose: blanks, a missing leading zero, a
// 24:00 that no regex accepts, seconds, and values that pair up equal or
// inverted. Most rows draw an ordered valid pair so that whole drafts are
// accepted often enough for the "accepted" branch to be exercised too. The
// random pool is NOT the proof for any one boundary: a whole-draft verdict is
// masked whenever another row of the same draft is invalid (every 24:00 row
// the seed produces shares its draft with one — the F-76 review measured it),
// so the loop also judges each open row on its own, and the table below
// names every boundary deterministically.
const TIME_POOL = ['', '9:00', '24:00', '00:00', '09:00', '12:00', '12:00', '18:00', '23:59', '09:00:00'];

/**
 * Every boundary by name, as an open Monday in an otherwise closed week:
 * `[from, to, accepted]`. Both sides must return the STATED verdict — not
 * merely agree with each other — so a drift they happen to share is red too.
 */
const BOUNDARY_ROWS: ReadonlyArray<readonly [string, string, boolean]> = [
  ['09:00', '18:00', true],
  ['00:00', '23:59', true],
  ['23:58', '23:59', true],
  ['09:00', '09:01', true],
  // equal pairs — `close > open` is strict on both sides
  ['09:00', '09:00', false],
  ['12:00', '12:00', false],
  // inverted pairs
  ['18:00', '09:00', false],
  ['23:59', '00:00', false],
  // 24:00 — a real end-of-day in ISO 8601, refused by TimeOfDay and by HHMM alike
  ['24:00', '09:00', false],
  ['09:00', '24:00', false],
  ['00:00', '24:00', false],
  // a missing leading zero
  ['9:00', '18:00', false],
  ['09:00', '9:00', false],
  // blanks
  ['', '18:00', false],
  ['09:00', '', false],
  ['', '', false],
  // seconds — the reducer slices them before they reach a row; a row that
  // somehow carries them is refused rather than silently trimmed on send
  ['09:00:00', '18:00', false],
  ['09:00', '18:00:00', false],
];
const VALID_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['09:00', '18:00'],
  ['10:00', '16:00'],
  ['00:00', '23:59'],
  ['12:00', '12:30'],
  ['08:30', '17:00'],
];

function randomDraft(next: () => number): HoursDraft {
  const pick = () => TIME_POOL[Math.floor(next() * TIME_POOL.length)] ?? '';
  const draft: Record<string, DayRow> = {};
  for (const day of DAY_KEYS) {
    const open = next() < 0.7;
    if (next() < 0.8) {
      const pair = VALID_PAIRS[Math.floor(next() * VALID_PAIRS.length)] ?? ['09:00', '18:00'];
      // One in five valid pairs is flipped: an inverted window is the rule
      // most worth proving, and a closed row must still be fine with it.
      const flip = next() < 0.2;
      draft[day] = { open, from: flip ? pair[1] : pair[0], to: flip ? pair[0] : pair[1] };
    } else {
      draft[day] = { open, from: pick(), to: pick() };
    }
  }
  return draft as unknown as HoursDraft;
}

describe('PROPERTY — the client rule and UpdateStoreInput agree on every draft and every row', () => {
  it('every named boundary — 24:00, 9:00, blank, seconds, equal and inverted pairs — gets the stated verdict from BOTH sides', () => {
    for (const [from, to, accepted] of BOUNDARY_ROWS) {
      const row: DayRow = { open: true, from, to };
      const draft: HoursDraft = { ...emptyHours(), mon: row };
      expect(rowError(row) === null, `client ${from}-${to}`).toBe(accepted);
      expect(UpdateStoreInput.safeParse({ business_hours: toPayload(draft) }).success, `server ${from}-${to}`).toBe(accepted);
      // The same times on a CLOSED row are never an error and never sent.
      expect(rowError({ ...row, open: false })).toBeNull();
      expect(toPayload({ ...emptyHours(), mon: { ...row, open: false } })).toEqual({});
    }
  });

  it('rowErrors(d).length === 0 ⇔ UpdateStoreInput.safeParse({ business_hours: toPayload(d) }).success (200 drafts, per draft and per open row)', () => {
    const next = rng(76);
    let accepted = 0;
    let openRowsWith2400 = 0;
    let openEqualPairs = 0;
    for (let i = 0; i < 200; i++) {
      const draft = randomDraft(next);
      const clientOk = rowErrors(draft).length === 0;
      const serverOk = UpdateStoreInput.safeParse({ business_hours: toPayload(draft) }).success;
      expect(serverOk, `draft #${i}: ${JSON.stringify(toPayload(draft))}`).toBe(clientOk);
      if (clientOk) accepted++;
      // Per row, so one invalid row can never mask another's verdict.
      for (const day of DAY_KEYS) {
        const row = draft[day];
        if (!row.open) continue;
        if (row.from === '24:00' || row.to === '24:00') openRowsWith2400++;
        if (row.from === row.to) openEqualPairs++;
        const rowOk = UpdateStoreInput.safeParse({ business_hours: { [day]: { open: row.from, close: row.to } } }).success;
        expect(rowOk, `draft #${i} ${day} ${row.from}-${row.to}`).toBe(rowError(row) === null);
      }
    }
    // Both branches must be exercised or the equivalence proves nothing, and
    // the seed must keep producing the two shapes the table exists for.
    expect(accepted).toBeGreaterThan(10);
    expect(accepted).toBeLessThan(190);
    expect(openRowsWith2400).toBeGreaterThan(0);
    expect(openEqualPairs).toBeGreaterThan(0);
  });
});
