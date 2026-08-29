/**
 * F-71 — impersonation with audit (admin-console.md §7; D-072).
 *
 * The numbers and vocabularies the register and the API share. `packages/core`
 * carries no dependency on `@dealpilot/schemas` (the lost-reasons precedent),
 * so the Zod enums spell the same literals and `schemas.test.ts` asserts the
 * two lists are equal (the TENANT_STATUSES discipline).
 */

/** §7: hard TTL, no refresh. Passed INTO impersonation_start() so there is one number. */
export const IMPERSONATION_TTL_MINUTES = 60;

/** §7: `read_only` refuses every mutating verb; `full` is a super admin's alone. */
export const IMPERSONATION_MODES = ['read_only', 'full'] as const;
export type ImpersonationMode = (typeof IMPERSONATION_MODES)[number];

/**
 * §7 `end_reason`: `manual` = a person ended it (`ended_by` says who);
 * `ttl` = the clock; `revoked` = loss of standing (the staffer signed out or
 * was revoked, the tenant left an impersonable status or was deleted, the
 * target's membership ended).
 */
export const IMPERSONATION_END_REASONS = ['manual', 'ttl', 'revoked'] as const;
export type ImpersonationEndReason = (typeof IMPERSONATION_END_REASONS)[number];

/** §7 "reason: required, minimum 20 characters" — Zod and the column CHECK both carry it. */
export const IMPERSONATION_REASON_MIN_CHARS = 20;
