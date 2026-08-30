import type { FastifyRequest } from 'fastify';
import type { Pool } from '@dealpilot/db';
import { capabilitiesOf, type PlatformCapabilityT, type PlatformRoleT } from '@dealpilot/schemas';
import { AppError, notFound } from './errors.js';
import type { Env } from './env.js';

/**
 * F-69 — the platform gate (admin-console.md §2/§3).
 *
 * Everything under /api/v1/admin/ passes here after the session gate and
 * before any handler: identity (an active platform_staff row — non-staff get
 * 404 and learn nothing), MFA enrolment (mandatory, no exceptions, NOT behind
 * env.REQUIRE_MFA), and session age (a console session is re-authenticated
 * every ADMIN_SESSION_MAX_AGE_HOURS; Better Auth refreshes only expiresAt on
 * activity, so "session"."createdAt" is the honest re-auth clock).
 *
 * "TOTP on every request" (§2) is realised as: the enrolled flag is read per
 * request; an enrolled account's sign-in cannot mint a session without the
 * challenge (twoFactorRedirect); `trustDevice` is refused at the auth mount
 * (app.ts) so no device ever skips the challenge; and the age cap bounds how
 * long a passed challenge is good for.
 *
 * The identity read is a SECURITY DEFINER function on a bare pool
 * connection: platform staff never receive tenant RLS context.
 */

export interface PlatformActor {
  userId: string;
  role: PlatformRoleT;
  capabilities: PlatformCapabilityT[];
  sessionCreatedAt: Date;
}

declare module 'fastify' {
  interface FastifyRequest {
    platform?: PlatformActor;
  }
}

export function platformGate(pool: Pool, env: Env) {
  return async (request: FastifyRequest) => {
    const routed = request.routeOptions.url ?? '';
    if (!routed.startsWith('/api/v1/admin/')) return;
    // The session gate already ran (registration order) and refused 401.
    const { user, session } = request.session!;
    const r = await pool.query<{ role: PlatformRoleT; mfa_enabled: boolean; session_created_at: Date | null }>(
      'SELECT * FROM platform_identity($1::uuid, $2::text)',
      [user.id, session.id],
    );
    const row = r.rows[0];
    if (!row) throw notFound();
    if (row.mfa_enabled !== true) {
      throw new AppError(403, 'mfa_enrolment_required', 'Platform staff must enrol two-factor authentication first', [
        { path: 'mfa', code: 'mfa_enrolment_required', message: 'Enrol at /security' },
      ]);
    }
    const createdAt = row.session_created_at ?? new Date(0);
    const ageMs = Date.now() - createdAt.getTime();
    if (ageMs > env.ADMIN_SESSION_MAX_AGE_HOURS * 3_600_000) {
      throw new AppError(401, 'admin_reauth_required', 'Sign in again to use the console');
    }
    request.platform = { userId: user.id, role: row.role, capabilities: capabilitiesOf(row.role), sessionCreatedAt: createdAt };
    // §12: platform reads are logged too — actor, role, route, request id.
    request.log.info({ staffUserId: user.id, role: row.role, method: request.method, url: routed }, 'platform_access');
  };
}

/** The capability check every admin handler starts with (never a role name). */
export function requirePlatform(request: FastifyRequest, cap: PlatformCapabilityT): PlatformActor {
  const actor = request.platform;
  if (!actor) throw notFound();
  if (!actor.capabilities.includes(cap)) {
    throw new AppError(403, 'forbidden', 'Your platform role does not allow this', [
      { path: 'capability', code: 'forbidden', message: cap },
    ]);
  }
  return actor;
}

/** SQLSTATE → HTTP for the 0065 definer surface (the conflictFrom pattern). */
export function platformErrorFrom(err: unknown): AppError | null {
  // node-postgres exposes DETAIL as `detail` — the 0066 definers carry the
  // existing organization id (PA011) or the offending store code (PA012) there.
  const e = err as { code?: string; message?: string; detail?: string } | null;
  switch (e?.code) {
    case 'PA001':
    case 'PA002':
      return notFound();
    case 'PA003':
      return new AppError(409, 'last_super_admin', 'The platform must keep one active super admin');
    case 'PA004':
      return new AppError(409, 'invalid_transition', 'That status change is not allowed', [
        { path: 'status', code: 'invalid_transition', message: e?.message ?? '' },
      ]);
    case 'PA005':
      return new AppError(409, 'stale_status', 'The tenant status changed since you loaded it');
    case 'PA006':
      return new AppError(422, 'validation_failed', 'You cannot revoke yourself', [
        { path: 'userId', code: 'cannot_revoke_self', message: 'Ask another super admin' },
      ]);
    case 'PA007':
      return new AppError(422, 'validation_failed', 'Unknown plan', [
        { path: 'plan_id', code: 'unknown_plan', message: 'No active plan has this id' },
      ]);
    case 'PA008':
      return new AppError(422, 'validation_failed', 'No account with that email', [
        { path: 'email', code: 'needs_account', message: 'The person must sign up first' },
      ]);
    case 'PA009':
      return new AppError(403, 'forbidden', 'Your platform role does not allow this');
    case 'PA011':
      // Idempotent on slug (§4.3): the message IS the existing tenant's id.
      return new AppError(409, 'slug_taken', 'A tenant with this slug already exists', [
        { path: 'slug', code: 'slug_taken', message: e?.detail ?? '' },
      ]);
    case 'PA012':
      return new AppError(422, 'validation_failed', 'Duplicate store code', [
        { path: 'stores', code: 'duplicate_store_code', message: e?.detail ?? '' },
      ]);
    case 'PA013':
      return new AppError(409, 'owner_exists', 'This tenant already has an active owner; invitations are now the tenant’s own (F-12)');
    case 'PA015':
      // No active membership in that tenant: indistinguishable from an unknown id (no oracle).
      return notFound();
    case 'PA016':
      return new AppError(403, 'cannot_impersonate_staff', 'Platform staff cannot be impersonated');
    case 'PA017':
      return new AppError(409, 'tenant_not_impersonable', 'This tenant is not in a status that allows a support session', [
        { path: 'tenant_id', code: 'tenant_not_impersonable', message: e?.message ?? '' },
      ]);
    case 'PA018':
      return new AppError(409, 'impersonation_active', 'This console session already has a support session open');
    case 'PA019':
      return new AppError(409, 'impersonation_ended', 'The support session has already ended');
    case 'PA020':
      return new AppError(403, 'forbidden', 'Only the staffer who opened the session, or a super admin, may end it');
    // F-72 (0068). One SQLSTATE, one response: PA009 already carries the
    // announcement severity/role refusal, so nothing here is double-booked.
    case 'PA021':
      // Not found and not visible to this person are the same refusal: no oracle.
      return notFound();
    case 'PA022':
      return new AppError(409, 'invalid_window', 'A published announcement’s window may only be shortened', [
        { path: 'ends_at', code: 'invalid_window', message: e?.message ?? '' },
      ]);
    case 'PA023':
      return new AppError(422, 'not_dismissible', 'This announcement cannot be dismissed', [
        { path: 'id', code: 'not_dismissible', message: 'maintenance and incident notices stay up while active' },
      ]);
    case 'PA024':
      return notFound();
    case 'PA025':
      return new AppError(409, 'already_ended', 'This announcement has already ended', [
        { path: 'id', code: 'already_ended', message: e?.message ?? '' },
      ]);
    case 'PA026':
      return new AppError(422, 'validation_failed', 'Unknown organization in the audience', [
        { path: 'audience', code: 'unknown_organization', message: e?.detail ?? e?.message ?? '' },
      ]);
    case '23514':
      return new AppError(422, 'validation_failed', 'Reason required', [
        { path: 'reason', code: 'reason_required', message: 'Say why' },
      ]);
    case '22023':
      return new AppError(422, 'validation_failed', 'Unknown field', [
        { path: 'body', code: 'unknown_field', message: e?.message ?? '' },
      ]);
    default:
      return null;
  }
}
