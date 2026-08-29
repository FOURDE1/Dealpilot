import { describe, expect, it } from 'vitest';
import { adminAccess } from './access.js';

describe('adminAccess (F-69)', () => {
  it('maps the probe to a decision', () => {
    expect(adminAccess({ pending: true })).toBe('pending');
    expect(adminAccess({ pending: false, error: { status: 404 } })).toBe('denied');
    expect(adminAccess({ pending: false, error: { status: 403, errorCode: 'mfa_enrolment_required' } })).toBe('mfa');
    expect(adminAccess({ pending: false, error: { status: 403, errorCode: 'forbidden' } })).toBe('denied');
    expect(adminAccess({ pending: false, error: { status: 401, errorCode: 'admin_reauth_required' } })).toBe('reauth');
    // A deploy blip is not a verdict on who you are.
    expect(adminAccess({ pending: false, error: { status: 503 } })).toBe('error');
    expect(adminAccess({ pending: false, error: {} })).toBe('error');
    expect(adminAccess({ pending: false, ok: true })).toBe('ok');
    expect(adminAccess({ pending: false, ok: false })).toBe('denied');
    // F-71: a live support session closes the console (state, not authority).
    expect(adminAccess({ pending: false, ok: true, impersonating: true })).toBe('impersonating');
    expect(adminAccess({ pending: false, ok: false, impersonating: true })).toBe('denied');
    // …and the one-time "it just ended" 403 is a refetch, not the denied wall.
    expect(adminAccess({ pending: false, error: { status: 403, errorCode: 'impersonation_ended' } })).toBe('pending');
  });
});
