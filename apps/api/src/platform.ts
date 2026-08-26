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
  const e = err as { code?: string; message?: string } | null;
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
