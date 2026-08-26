import { describe, expect, it } from 'vitest';
import {
  CONFIRMATION_REQUIRED,
  OPERATIONAL_STATUSES,
  TENANT_STATUSES,
  TENANT_TRANSITIONS,
  TRIAL_DAYS,
  allowedTenantTransitions,
  canTenantTransition,
  isTenantOperational,
  tenantRequiresConfirmation,
} from './tenant-lifecycle.js';

describe('tenant lifecycle (F-69, admin-console.md §4.2)', () => {
  it('every pair names two known statuses and never targets purged from the console', () => {
    for (const [from, to] of TENANT_TRANSITIONS) {
      expect(TENANT_STATUSES).toContain(from);
      expect(TENANT_STATUSES).toContain(to);
      expect(to).not.toBe('purged');
      expect(from).not.toBe(to);
    }
    // No duplicates: a pair listed twice is a matrix nobody proof-read.
    const keys = TENANT_TRANSITIONS.map(([f, t]) => `${f}>${t}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('the spec rows are all there, plus the two reinstatement additions', () => {
    for (const [from, to] of [
      ['trial', 'active'], ['active', 'past_due'], ['past_due', 'read_only'], ['read_only', 'active'],
      ['active', 'suspended'], ['suspended', 'offboarding'], ['read_only', 'offboarding'],
      ['suspended', 'active'], ['offboarding', 'active'],
    ] as const) {
      expect(canTenantTransition(from, to), `${from} → ${to}`).toBe(true);
    }
    expect(canTenantTransition('purged', 'active')).toBe(false);
    expect(canTenantTransition('active', 'trial')).toBe(false);
    expect(allowedTenantTransitions('purged')).toEqual([]);
    expect(allowedTenantTransitions('active').sort()).toEqual(['past_due', 'suspended']);
  });

  it('confirmation is demanded for exactly the destructive targets', () => {
    expect([...CONFIRMATION_REQUIRED].sort()).toEqual(['offboarding', 'suspended']);
    expect(tenantRequiresConfirmation('suspended')).toBe(true);
    expect(tenantRequiresConfirmation('active')).toBe(false);
  });

  it('the trial is 14 days, trial is operational, and no prospect exists until Stripe (F-70, D-071)', () => {
    expect(TRIAL_DAYS).toBe(14);
    expect(OPERATIONAL_STATUSES.has('trial')).toBe(true);
    expect(TENANT_STATUSES).not.toContain('prospect');
    expect(TENANT_STATUSES).toHaveLength(7);
  });

  it('operational = full functionality, including the grace period; read_only is not', () => {
    expect([...OPERATIONAL_STATUSES].sort()).toEqual(['active', 'past_due', 'trial']);
    expect(isTenantOperational('past_due')).toBe(true);
    expect(isTenantOperational('read_only')).toBe(false);
    expect(isTenantOperational('suspended')).toBe(false);
    expect(isTenantOperational('nonsense')).toBe(false);
  });
});
