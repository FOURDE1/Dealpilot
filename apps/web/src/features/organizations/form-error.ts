import type { TFunction } from 'i18next';
import { ApiError } from '../../shared/api/client.js';
import { isDayKey, type DayKey } from './hours-grid.js';

/**
 * Maps a mutation failure to a localized message. 409 = uniqueness conflict
 * on the form's key field; 422 = server-side validation with the offending
 * field in the envelope (the server is the only validation layer for these
 * forms until the H-05 Form primitive brings client-side zod).
 * Non-API errors are BUGS (contract drift, coding errors) — rethrown so they
 * surface instead of masquerading as a retryable failure (CLAUDE.md).
 */
export function formErrorMessage(
  t: TFunction<'orgs'>,
  err: unknown,
  uniqueField: 'slug' | 'code',
): string {
  if (!(err instanceof ApiError)) throw err;
  if (err.status === 409 && err.fieldPath === uniqueField) {
    return t(uniqueField === 'slug' ? 'slugTaken' : 'codeTaken');
  }
  if (err.status === 422) {
    if (err.fieldPath === 'slug') return t('slugInvalid');
    if (err.fieldPath === 'code') return t('codeInvalid');
    return t('invalidInput');
  }
  return t('genericError');
}

/**
 * F-76 — where a store-form refusal lands and what it says.
 *
 * `top` is the form's existing alert; the others are inputs of the
 * « Exploitation » fieldset (`hours` carries the day of the offending row).
 * Every detail path is visited in envelope order and the FIRST that maps
 * wins (A11): a bad time format arrives as TWO details —
 * `business_hours.mon.open` invalid_format, then `business_hours.mon` custom
 * — so grid paths match by PREFIX, and a path with any code on `timezone`
 * (`unknown_timezone`, or `too_small` for '') lands on the timezone field.
 */
export type StoreErrorField = 'top' | 'timezone' | 'phone' | 'sms_number' | 'holidays' | 'hours';

export interface StoreFieldError {
  readonly field: StoreErrorField;
  /** Set with `field: 'hours'` — the row the message belongs under. */
  readonly day?: DayKey;
  readonly message: string;
}

const HOURS_PREFIX = 'business_hours';

function gridDay(path: string): DayKey | null {
  if (!path.startsWith(`${HOURS_PREFIX}.`)) return null;
  const day = path.slice(HOURS_PREFIX.length + 1).split('.')[0] ?? '';
  return isDayKey(day) ? day : null;
}

function mapDetail(t: TFunction<'orgs'>, status: number, path: string, code: string | undefined): StoreFieldError | null {
  if (status === 409) {
    if (path === 'sms_number') return { field: 'sms_number', message: t('smsNumberTaken') };
    if (path === 'code') return { field: 'top', message: t('codeTaken') };
    return null;
  }
  // 422
  const day = gridDay(path);
  if (day) {
    // `custom` is the DayHours refine (close after open); anything else on a
    // row is a shape or format problem, which the "both times" message covers.
    return { field: 'hours', day, message: t(code === 'custom' ? 'hoursOrderError' : 'hoursMissingError') };
  }
  if (path === HOURS_PREFIX || path.startsWith(`${HOURS_PREFIX}.`)) return { field: 'top', message: t('hoursInvalid') };
  if (path === 'holiday_dates' || path.startsWith('holiday_dates.')) return { field: 'holidays', message: t('holidaysInvalid') };
  if (path === 'timezone') return { field: 'timezone', message: t('timezoneUnknown') };
  if (path === 'sms_number') return { field: 'sms_number', message: t('smsNumberInvalid') };
  if (path === 'phone') return { field: 'phone', message: t('phoneInvalid') };
  if (path === 'code') return { field: 'top', message: t('codeInvalid') };
  return null;
}

export function storeFieldError(t: TFunction<'orgs'>, err: unknown): StoreFieldError {
  if (!(err instanceof ApiError)) throw err;
  if (err.status === 409 || err.status === 422) {
    const paths = err.detailPaths ?? (err.fieldPath !== undefined ? [err.fieldPath] : []);
    const codes = err.detailCodes ?? [];
    for (let i = 0; i < paths.length; i++) {
      const mapped = mapDetail(t, err.status, paths[i] ?? '', codes[i]);
      if (mapped) return mapped;
    }
    // A 422 with no mappable path (the pre-fix pathless 409 falls to genericError).
    return { field: 'top', message: t(err.status === 422 ? 'invalidInput' : 'genericError') };
  }
  return { field: 'top', message: t('genericError') };
}
