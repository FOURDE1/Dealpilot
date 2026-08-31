import { describe, expect, it } from 'vitest';
import { UpdateCommsConfigInput } from '@dealpilot/schemas';
import { CAP_RANGES, COMMS_DEFAULTS, capInvalid, commsDiff, fromRow, validateWindow } from './comms-window.js';

const ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  organization_id: '22222222-2222-4222-8222-222222222222',
  store_id: null,
  sms_quiet_start: '10:00:00',
  sms_quiet_end: '20:00:00',
  first_touch_quiet_exempt: false,
  ai_daily_contact_cap: 2,
  bot_turn_cap: 10,
  created_at: '2026-08-30T12:00:00.000Z',
  updated_at: '2026-08-30T12:00:00.000Z',
};

describe('comms window — fromRow', () => {
  it('null → the platform defaults 09:00 / 21:00 / exempt / 3 / 15', () => {
    expect(fromRow(null)).toEqual({ start: '09:00', end: '21:00', firstTouchExempt: true, dailyCap: '3', turnCap: '15' });
    expect(fromRow(null)).toBe(COMMS_DEFAULTS);
  });

  it('slices pg\'s HH:MM:SS to HH:MM and stringifies the caps', () => {
    expect(fromRow(ROW)).toEqual({ start: '10:00', end: '20:00', firstTouchExempt: false, dailyCap: '2', turnCap: '10' });
  });
});

describe('comms window — validateWindow', () => {
  it.each([
    ['08:59', '21:00', 'tooWide', null],
    ['09:00', '21:01', null, 'tooWide'],
    ['12:00', '11:00', null, 'inverted'],
    ['10:00', '10:00', null, 'inverted'],
    ['9:00', '21:00', 'format', null],
    ['09:00', '21:00:00', null, 'format'],
    ['09:00', '21:00', null, null],
    ['09:30', '20:00', null, null],
  ] as const)('%s → %s: start=%s end=%s', (start, end, startError, endError) => {
    expect(validateWindow(start, end)).toEqual({ start: startError, end: endError });
  });

  it('the exact ceiling is valid on the client AND on the schema', () => {
    expect(validateWindow('09:00', '21:00')).toEqual({ start: null, end: null });
    expect(UpdateCommsConfigInput.safeParse({ sms_quiet_start: '09:00', sms_quiet_end: '21:00' }).success).toBe(true);
  });
});

describe('comms window — caps', () => {
  it('integer-only within the range', () => {
    for (const ok of ['0', '3', '10']) expect(capInvalid(ok, CAP_RANGES.daily), ok).toBe(false);
    for (const bad of ['', '-1', '11', '3.5', 'x', '1e1']) expect(capInvalid(bad, CAP_RANGES.daily), bad).toBe(true);
    expect(capInvalid('0', CAP_RANGES.turn)).toBe(true);
    expect(capInvalid('1', CAP_RANGES.turn)).toBe(false);
    expect(capInvalid('100', CAP_RANGES.turn)).toBe(false);
    expect(capInvalid('101', CAP_RANGES.turn)).toBe(true);
  });

  it('what the client accepts, UpdateCommsConfigInput accepts', () => {
    for (const v of ['0', '10']) {
      expect(UpdateCommsConfigInput.safeParse({ ai_daily_contact_cap: Number(v) }).success).toBe(!capInvalid(v, CAP_RANGES.daily));
    }
    for (const v of ['1', '100', '101']) {
      expect(UpdateCommsConfigInput.safeParse({ bot_turn_cap: Number(v) }).success).toBe(!capInvalid(v, CAP_RANGES.turn));
    }
  });
});

describe('comms window — commsDiff', () => {
  it('sends only the changed keys, and {} when nothing changed', () => {
    const base = fromRow(ROW);
    expect(commsDiff(base, base)).toEqual({});
    expect(commsDiff(base, { ...base, end: '19:30' })).toEqual({ sms_quiet_end: '19:30' });
    expect(commsDiff(base, { ...base, firstTouchExempt: true, turnCap: '8' })).toEqual({
      first_touch_quiet_exempt: true,
      bot_turn_cap: 8,
    });
    expect(commsDiff(COMMS_DEFAULTS, { ...COMMS_DEFAULTS, dailyCap: ' 2 ' })).toEqual({ ai_daily_contact_cap: 2 });
  });

  it('a one-key diff is a valid PUT body (the "Nothing to change" refine is unreachable from the screen)', () => {
    const patch = commsDiff(COMMS_DEFAULTS, { ...COMMS_DEFAULTS, turnCap: '8' });
    expect(UpdateCommsConfigInput.safeParse(patch).success).toBe(true);
    expect(UpdateCommsConfigInput.safeParse({}).success).toBe(false);
  });
});
