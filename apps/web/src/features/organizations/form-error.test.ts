import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { frCA } from '@dealpilot/i18n';
import { ApiError } from '../../shared/api/client.js';
import { formErrorMessage, storeFieldError } from './form-error.js';

/**
 * F-76 (A11) — every row of the refusal table, one envelope each.
 *
 * `t` returns the fr-CA string for the key so a test reads like the screen:
 * the assertion names the field AND the sentence, and a renamed key would
 * surface here as an `undefined` message rather than pass by key equality.
 */
const orgs = frCA.orgs as Record<string, string>;
const t = ((key: string) => orgs[key] ?? `MISSING:${key}`) as unknown as TFunction<'orgs'>;

/** An ApiError the way failFromResponse builds one from an envelope. */
function apiError(status: number, details: { path?: string; code?: string }[], errorCode = 'validation_failed') {
  return new ApiError(
    status,
    details[0]?.path,
    details[0]?.code,
    errorCode,
    details.map((d) => d.code).filter((c): c is string => typeof c === 'string'),
    details.map(() => ''),
    details.map((d) => d.path ?? ''),
  );
}

describe('storeFieldError — the § 3.3 table', () => {
  it('the two-detail bad-format envelope lands on row mon (prefix match, first detail wins)', () => {
    const err = apiError(422, [
      { path: 'business_hours.mon.open', code: 'invalid_format' },
      { path: 'business_hours.mon', code: 'custom' },
    ]);
    expect(storeFieldError(t, err)).toEqual({ field: 'hours', day: 'mon', message: orgs['hoursMissingError'] });
  });

  it('the DayHours refine (custom on business_hours.mon) is the order message on row mon', () => {
    const err = apiError(422, [{ path: 'business_hours.mon', code: 'custom' }]);
    expect(storeFieldError(t, err)).toEqual({ field: 'hours', day: 'mon', message: orgs['hoursOrderError'] });
  });

  it('an unknown day key or an unrecognized leaf is the top-level hoursInvalid', () => {
    expect(storeFieldError(t, apiError(422, [{ path: 'business_hours.monday', code: 'invalid_key' }]))).toEqual({
      field: 'top',
      message: orgs['hoursInvalid'],
    });
    expect(storeFieldError(t, apiError(422, [{ path: 'business_hours', code: 'unrecognized_keys' }]))).toEqual({
      field: 'top',
      message: orgs['hoursInvalid'],
    });
  });

  it('holiday_dates.<i> with any code is the list\'s error line', () => {
    expect(storeFieldError(t, apiError(422, [{ path: 'holiday_dates.0', code: 'custom' }]))).toEqual({
      field: 'holidays',
      message: orgs['holidaysInvalid'],
    });
    expect(storeFieldError(t, apiError(422, [{ path: 'holiday_dates', code: 'too_big' }])).field).toBe('holidays');
  });

  it('timezone with ANY code — unknown_timezone, or too_small for \'\' — is the timezone field', () => {
    for (const code of ['unknown_timezone', 'too_small']) {
      expect(storeFieldError(t, apiError(422, [{ path: 'timezone', code }]))).toEqual({
        field: 'timezone',
        message: orgs['timezoneUnknown'],
      });
    }
  });

  it('sms_number / phone with phone_nanp are their own fields', () => {
    expect(storeFieldError(t, apiError(422, [{ path: 'sms_number', code: 'phone_nanp' }]))).toEqual({
      field: 'sms_number',
      message: orgs['smsNumberInvalid'],
    });
    expect(storeFieldError(t, apiError(422, [{ path: 'phone', code: 'phone_nanp' }]))).toEqual({
      field: 'phone',
      message: orgs['phoneInvalid'],
    });
  });

  it('409 sms_number / unique_violation is the number field, and names no store', () => {
    const mapped = storeFieldError(t, apiError(409, [{ path: 'sms_number', code: 'unique_violation' }], 'conflict'));
    expect(mapped).toEqual({ field: 'sms_number', message: orgs['smsNumberTaken'] });
    expect(mapped.message).not.toMatch(/retirez/);
  });

  it('a 409 with NO path (the pre-fix shape) is the top-level genericError, without throwing', () => {
    const err = new ApiError(409, undefined, undefined, 'conflict', [], [], []);
    expect(storeFieldError(t, err)).toEqual({ field: 'top', message: orgs['genericError'] });
    const bare = new ApiError(409);
    expect(storeFieldError(t, bare)).toEqual({ field: 'top', message: orgs['genericError'] });
  });

  it('the pre-existing code rows and the unmapped fallbacks still hold', () => {
    expect(storeFieldError(t, apiError(409, [{ path: 'code', code: 'unique_violation' }], 'conflict'))).toEqual({
      field: 'top',
      message: orgs['codeTaken'],
    });
    expect(storeFieldError(t, apiError(422, [{ path: 'code', code: 'custom' }]))).toEqual({ field: 'top', message: orgs['codeInvalid'] });
    expect(storeFieldError(t, apiError(422, [{ path: 'name', code: 'too_small' }]))).toEqual({ field: 'top', message: orgs['invalidInput'] });
    expect(storeFieldError(t, apiError(500, [], 'internal'))).toEqual({ field: 'top', message: orgs['genericError'] });
    expect(storeFieldError(t, apiError(403, [], 'forbidden'))).toEqual({ field: 'top', message: orgs['genericError'] });
  });

  it('a non-ApiError is a bug and is rethrown', () => {
    expect(() => storeFieldError(t, new TypeError('contract drift'))).toThrow(TypeError);
    expect(() => formErrorMessage(t, new TypeError('contract drift'), 'code')).toThrow(TypeError);
  });
});
