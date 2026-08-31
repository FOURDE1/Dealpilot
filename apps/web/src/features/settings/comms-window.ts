import type { CommsConfig } from '@dealpilot/schemas';

/**
 * F-76 — the automations form's pure half.
 *
 * The API (apps/api/src/f15-compliance-routes.ts, PUT comms-config) accepts
 * `HH:MM`, refuses a window outside the platform ceiling 09:00–21:00 with
 * `window_too_wide` on `sms_quiet_start`, refuses `start >= end` with
 * `invalid_window` on `sms_quiet_end`, and caps the two integers at 0..10
 * and 1..100 (`UpdateCommsConfigInput`). GET returns `null` while no row
 * exists — the platform defaults then apply (migration 0028's column
 * defaults, 0033's `bot_turn_cap`), which is what `fromRow(null)` shows.
 *
 * The client mirrors those rules so save is disabled with a message under
 * the field; the server stays the authority and its 422s map by path.
 */

export const PLATFORM_WINDOW = { start: '09:00', end: '21:00' } as const;
export const CAP_RANGES = {
  daily: { min: 0, max: 10 },
  turn: { min: 1, max: 100 },
} as const;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface CommsDraft {
  readonly start: string;
  readonly end: string;
  readonly firstTouchExempt: boolean;
  /** Text as typed — validated as an integer before it becomes a number. */
  readonly dailyCap: string;
  readonly turnCap: string;
}

/** What applies while no row exists. */
export const COMMS_DEFAULTS: CommsDraft = {
  start: PLATFORM_WINDOW.start,
  end: PLATFORM_WINDOW.end,
  firstTouchExempt: true,
  dailyCap: '3',
  turnCap: '15',
};

/** pg's `time` arrives as `HH:MM:SS`; the inputs and the PUT speak `HH:MM`. */
export function fromRow(row: CommsConfig | null): CommsDraft {
  if (!row) return COMMS_DEFAULTS;
  return {
    start: row.sms_quiet_start.slice(0, 5),
    end: row.sms_quiet_end.slice(0, 5),
    firstTouchExempt: row.first_touch_quiet_exempt,
    dailyCap: String(row.ai_daily_contact_cap),
    turnCap: String(row.bot_turn_cap),
  };
}

export type WindowError = 'format' | 'tooWide' | 'inverted';

/**
 * The ceiling is reported on the field that breaks it (the server always
 * says `sms_quiet_start`; the client can be more precise), the order on the
 * end — where the server's `invalid_window` also lands.
 */
export function validateWindow(start: string, end: string): { start: WindowError | null; end: WindowError | null } {
  const startError: WindowError | null = !HHMM.test(start) ? 'format' : start < PLATFORM_WINDOW.start ? 'tooWide' : null;
  let endError: WindowError | null = !HHMM.test(end) ? 'format' : end > PLATFORM_WINDOW.end ? 'tooWide' : null;
  if (startError === null && endError === null && end <= start) endError = 'inverted';
  return { start: startError, end: endError };
}

/** Integer-only, within the range — `'3.5'`, `''` and `'-1'` are all invalid. */
export function capInvalid(value: string, range: { min: number; max: number }): boolean {
  const text = value.trim();
  if (!/^\d+$/.test(text)) return true;
  const n = Number(text);
  return n < range.min || n > range.max;
}

export interface CommsPatch {
  sms_quiet_start?: string;
  sms_quiet_end?: string;
  first_touch_quiet_exempt?: boolean;
  ai_daily_contact_cap?: number;
  bot_turn_cap?: number;
}

/** Only the keys that differ from what the form opened with — `{}` when nothing changed. */
export function commsDiff(base: CommsDraft, draft: CommsDraft): CommsPatch {
  const patch: CommsPatch = {};
  if (draft.start !== base.start) patch.sms_quiet_start = draft.start;
  if (draft.end !== base.end) patch.sms_quiet_end = draft.end;
  if (draft.firstTouchExempt !== base.firstTouchExempt) patch.first_touch_quiet_exempt = draft.firstTouchExempt;
  if (draft.dailyCap.trim() !== base.dailyCap.trim()) patch.ai_daily_contact_cap = Number(draft.dailyCap.trim());
  if (draft.turnCap.trim() !== base.turnCap.trim()) patch.bot_turn_cap = Number(draft.turnCap.trim());
  return patch;
}
