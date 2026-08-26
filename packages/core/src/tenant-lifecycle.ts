/**
 * F-69 — the tenant lifecycle (admin-console.md §4.2 on the multi-tenancy.md
 * §3 vocabulary). ONE matrix, mirrored by the SQL `tenant_transitions()`
 * function in 0065; apps/api/src/tenant-lifecycle-drift.test.ts diffs them
 * pair for pair, so neither side can quietly grow a way around the other.
 *
 * `packages/core` carries no dependency on `@dealpilot/schemas` (the
 * lost-reasons precedent), so the status vocabulary is a local literal
 * union; the drift test asserts it equals `OrganizationStatus.options`.
 *
 * Deviations from §4.2, each deliberate (D-070): no `prospect` until
 * provisioning has a producer; `churned` is spelled `offboarding` (retention
 * clock) then `purged` (the retention slice's job — never a console act,
 * ADR-024); `suspended → active` and `offboarding → active` exist because a
 * wrongful action needs a way back; the Stripe-driven pairs are manual
 * super-admin transitions until the billing slice makes them webhook-driven.
 */

export type TenantStatus =
  | 'active'
  | 'trial'
  | 'past_due'
  | 'read_only'
  | 'suspended'
  | 'offboarding'
  | 'purged';

export const TENANT_STATUSES: readonly TenantStatus[] = [
  'active', 'trial', 'past_due', 'read_only', 'suspended', 'offboarding', 'purged',
];

export const TENANT_TRANSITIONS: readonly (readonly [TenantStatus, TenantStatus])[] = [
  ['trial', 'active'],
  ['trial', 'suspended'],
  ['active', 'past_due'],
  ['active', 'suspended'],
  ['past_due', 'active'],
  ['past_due', 'read_only'],
  ['past_due', 'suspended'],
  ['read_only', 'active'],
  ['read_only', 'suspended'],
  ['read_only', 'offboarding'],
  ['suspended', 'active'],
  ['suspended', 'offboarding'],
  ['offboarding', 'active'],
];

/** Destructive targets: the console demands the slug typed back. */
export const CONFIRMATION_REQUIRED: ReadonlySet<TenantStatus> = new Set<TenantStatus>(['suspended', 'offboarding']);

/**
 * Where outbound automation (drips, the assistant, first touch, deferred
 * sends) may run. `read_only` is NOT operational (multi-tenancy.md §8: a
 * read-only tenant's AI outbound pauses); `past_due` still is — the grace
 * period keeps full functionality (§4.2).
 */
export const OPERATIONAL_STATUSES: ReadonlySet<TenantStatus> = new Set<TenantStatus>(['active', 'trial', 'past_due']);

/** §4.2: dunning grace before read_only. Consumed by the billing slice's worker. */
export const GRACE_PERIOD_DAYS = 14;

/**
 * §4.2 / ADR-024: the trial length. Stamped as `organizations.trial_ends_at`
 * by `admin_provision_tenant()` (0066, F-70); nothing expires it yet — the
 * console shows the date and the billing slice's worker acts on it.
 */
export const TRIAL_DAYS = 14;

export function allowedTenantTransitions(from: TenantStatus): TenantStatus[] {
  return TENANT_TRANSITIONS.filter(([f]) => f === from).map(([, to]) => to);
}

export function canTenantTransition(from: TenantStatus, to: TenantStatus): boolean {
  return TENANT_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

export function tenantRequiresConfirmation(to: TenantStatus): boolean {
  return CONFIRMATION_REQUIRED.has(to);
}

export function isTenantOperational(status: string): boolean {
  return OPERATIONAL_STATUSES.has(status as TenantStatus);
}
