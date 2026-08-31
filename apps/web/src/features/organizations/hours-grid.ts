/**
 * F-76 — the business-hours grid's data model, pure.
 *
 * The API's rule (packages/schemas/src/store.ts, `DayHours` +
 * `BusinessHoursShape`): a `partialRecord` over mon..sun, each day a strict
 * `{ open, close }` of `HH:MM` strings with `close > open` as a string
 * compare, and a MISSING day is a closed day. So the grid holds seven rows
 * with an explicit `open` flag, and `toPayload` OMITS closed rows — `{}` is
 * the all-closed payload, the DB default and the snapshot's « Non définies ».
 *
 * The client mirrors two server rules (both times present, close after open)
 * so the form can disable save with a row-level message instead of a round
 * trip. A mirrored rule is safe only while a test binds it to the schema:
 * hours-grid.test.ts runs 200 random drafts through both `rowErrors` and
 * `UpdateStoreInput.safeParse` and asserts they agree.
 */

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export interface DayRow {
  readonly open: boolean;
  /** `HH:MM` or `''` (never seconds: the `time` action slices the browser value). */
  readonly from: string;
  readonly to: string;
}
export type HoursDraft = Readonly<Record<DayKey, DayRow>>;

export interface DayWindow {
  readonly open: string;
  readonly close: string;
}
/** The wire shape, closed days omitted (the schema's own convention). */
export type HoursPayload = Partial<Record<DayKey, DayWindow>>;

/** The same regex as `TimeOfDay` (packages/schemas/src/schedule.ts). */
export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** FR-TEN-004's default window, seeded when a closed day is toggled open. */
export const DEFAULT_WINDOW = { from: '09:00', to: '18:00' } as const;

const CLOSED: DayRow = { open: false, from: '', to: '' };

export type HoursAction =
  | { type: 'load'; hours: Readonly<Record<string, DayWindow>> }
  | { type: 'toggle'; day: DayKey }
  | { type: 'time'; day: DayKey; edge: 'from' | 'to'; value: string }
  | { type: 'copyMondayToWeekdays' }
  | { type: 'clear' };

export function isDayKey(key: string): key is DayKey {
  return (DAY_KEYS as readonly string[]).includes(key);
}

export function emptyHours(): HoursDraft {
  return { mon: CLOSED, tue: CLOSED, wed: CLOSED, thu: CLOSED, fri: CLOSED, sat: CLOSED, sun: CLOSED };
}

/** `Store.business_hours` → seven rows; unknown keys ignored, times sliced to `HH:MM`. */
export function fromStore(hours: Readonly<Record<string, DayWindow>>): HoursDraft {
  const draft = { ...emptyHours() };
  for (const [key, window] of Object.entries(hours)) {
    if (!isDayKey(key)) continue;
    draft[key] = { open: true, from: window.open.slice(0, 5), to: window.close.slice(0, 5) };
  }
  return draft;
}

export function hoursReducer(state: HoursDraft, action: HoursAction): HoursDraft {
  switch (action.type) {
    case 'load':
      return fromStore(action.hours);
    case 'toggle': {
      const row = state[action.day];
      if (row.open) return { ...state, [action.day]: { ...row, open: false } };
      // Closed → open: seed the default window unless the row still holds times
      // from before it was closed (the times are kept, greyed, while closed).
      const from = row.from || DEFAULT_WINDOW.from;
      const to = row.to || DEFAULT_WINDOW.to;
      return { ...state, [action.day]: { open: true, from, to } };
    }
    case 'time':
      return { ...state, [action.day]: { ...state[action.day], [action.edge]: action.value.slice(0, 5) } };
    case 'copyMondayToWeekdays': {
      const mon = state.mon;
      return { ...state, tue: mon, wed: mon, thu: mon, fri: mon };
    }
    case 'clear':
      return emptyHours();
  }
}

export type RowError = 'missing' | 'order';

/** The client mirror of `DayHours`: an open row needs two `HH:MM` times, close after open. */
export function rowError(row: DayRow): RowError | null {
  if (!row.open) return null;
  if (!HHMM.test(row.from) || !HHMM.test(row.to)) return 'missing';
  if (row.to <= row.from) return 'order';
  return null;
}

export function rowErrors(draft: HoursDraft): ReadonlyArray<{ day: DayKey; error: RowError }> {
  const out: { day: DayKey; error: RowError }[] = [];
  for (const day of DAY_KEYS) {
    const error = rowError(draft[day]);
    if (error) out.push({ day, error });
  }
  return out;
}

/**
 * The PATCH body for `business_hours`: open rows only, in DAY_KEYS order.
 * The order is for determinism in tests and diffs on the client — jsonb
 * reorders keys on storage, so nothing downstream may depend on it.
 */
export function toPayload(draft: HoursDraft): HoursPayload {
  const payload: HoursPayload = {};
  for (const day of DAY_KEYS) {
    const row = draft[day];
    if (row.open) payload[day] = { open: row.from, close: row.to };
  }
  return payload;
}

/**
 * Whether saving would change what the server holds. `{}` and an all-closed
 * draft are the same hours, so no PATCH is sent for a grid nobody touched —
 * the server REPLACES the whole object on every PATCH.
 */
export function hoursChanged(draft: HoursDraft, base: Readonly<Record<string, DayWindow>>): boolean {
  return JSON.stringify(toPayload(draft)) !== JSON.stringify(toPayload(fromStore(base)));
}
