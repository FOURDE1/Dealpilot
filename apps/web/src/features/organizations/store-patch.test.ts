import { describe, expect, it } from 'vitest';
import type { StoreT } from '@dealpilot/schemas';
import { emptyHours, fromStore, hoursReducer } from './hours-grid.js';
import { blankToNull, operationsPatch } from './store-patch.js';

const BASE: StoreT = {
  id: '11111111-1111-4111-8111-111111111111',
  organization_id: '22222222-2222-4222-8222-222222222222',
  name: 'Succursale A',
  code: 'SUC-A',
  phone: null,
  sms_number: '+15145550142',
  address_line1: null,
  city: null,
  province: 'QC',
  postal_code: null,
  default_locale: 'fr-CA',
  timezone: 'America/Montreal',
  business_hours: { mon: { open: '09:00', close: '18:00' } },
  holiday_dates: ['2026-12-25'],
  status: 'active',
  bill_of_sale_system: 'CAMS',
  esign_platform: null,
  dispatch_conflict_window_hours: 4,
  created_at: '2026-08-30T12:00:00.000Z',
  updated_at: '2026-08-30T12:00:00.000Z',
  deleted_at: null,
};

const untouched = () => ({
  timezone: BASE.timezone,
  phone: '',
  sms: BASE.sms_number ?? '',
  hours: fromStore(BASE.business_hours),
  holidays: [...BASE.holiday_dates],
});

describe('operationsPatch', () => {
  it('sends nothing for an untouched form', () => {
    expect(operationsPatch(untouched(), BASE)).toEqual({});
  });

  it('a blank number or phone NEVER leaves the browser as \'\' — it is null (clear) or omitted (already null)', () => {
    expect(blankToNull('')).toBeNull();
    expect(blankToNull('   ')).toBeNull();
    expect(blankToNull(' 514 555 0199 ')).toBe('514 555 0199');
    // sms_number held a value: blank clears it.
    expect(operationsPatch({ ...untouched(), sms: '' }, BASE)).toEqual({ sms_number: null });
    // phone was already null: a blank phone is not a change and not sent.
    expect(operationsPatch({ ...untouched(), phone: '  ' }, BASE)).toEqual({});
    const patch = operationsPatch({ ...untouched(), sms: '', phone: '' }, BASE);
    expect(Object.values(patch)).not.toContain('');
  });

  it('sends the raw typed number — the server normalises to E.164', () => {
    expect(operationsPatch({ ...untouched(), phone: '514 555 0199' }, BASE)).toEqual({ phone: '514 555 0199' });
  });

  it('sends the WHOLE grid and the WHOLE list when any part changed (the server replaces both)', () => {
    const hours = hoursReducer(fromStore(BASE.business_hours), { type: 'toggle', day: 'sat' });
    expect(operationsPatch({ ...untouched(), hours }, BASE)).toEqual({
      business_hours: { mon: { open: '09:00', close: '18:00' }, sat: { open: '09:00', close: '18:00' } },
    });
    expect(operationsPatch({ ...untouched(), holidays: ['2027-01-01', '2026-12-25'] }, BASE)).toEqual({
      holiday_dates: ['2026-12-25', '2027-01-01'],
    });
    expect(operationsPatch({ ...untouched(), hours: emptyHours() }, BASE)).toEqual({ business_hours: {} });
  });

  it('trims the timezone and sends it only when different', () => {
    expect(operationsPatch({ ...untouched(), timezone: ' America/Montreal ' }, BASE)).toEqual({});
    expect(operationsPatch({ ...untouched(), timezone: 'America/Vancouver' }, BASE)).toEqual({ timezone: 'America/Vancouver' });
  });
});
