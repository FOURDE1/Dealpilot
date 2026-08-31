import type { StoreT, UpdateStoreInputT } from '@dealpilot/schemas';
import { hoursChanged, toPayload, type HoursDraft } from './hours-grid.js';
import { holidaysChanged, normalizeHolidays } from './holiday-dates.js';

/**
 * F-76 — the « Exploitation » half of the store form's PATCH, pure.
 *
 * Same rule as the rest of the form: send only what differs from the values
 * the form OPENED with (never the live query — a colleague's concurrent edit
 * must not be reverted by an untouched field). Two shapes need care:
 *
 * - Numbers: a blank input means "no number" and travels as `null` (the
 *   schema's `PhoneE164.nullable()`); `''` would be a 422 `phone_nanp`
 *   because the normaliser strips it to zero digits. The trimmed string is
 *   otherwise sent raw — the SERVER normalises to E.164.
 * - `business_hours` and `holiday_dates` are REPLACED whole by the server, so
 *   the entire grid / list is sent whenever any of it changed.
 */

export interface OperationsDraft {
  readonly timezone: string;
  readonly phone: string;
  readonly sms: string;
  readonly hours: HoursDraft;
  readonly holidays: readonly string[];
}

export function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function operationsPatch(draft: OperationsDraft, base: StoreT): UpdateStoreInputT {
  const changes: UpdateStoreInputT = {};
  const timezone = draft.timezone.trim();
  if (timezone !== base.timezone) changes.timezone = timezone;
  const phone = blankToNull(draft.phone);
  if (phone !== base.phone) changes.phone = phone;
  const sms = blankToNull(draft.sms);
  if (sms !== base.sms_number) changes.sms_number = sms;
  if (hoursChanged(draft.hours, base.business_hours)) changes.business_hours = toPayload(draft.hours);
  if (holidaysChanged(draft.holidays, base.holiday_dates)) changes.holiday_dates = normalizeHolidays(draft.holidays);
  return changes;
}
