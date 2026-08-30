import type { FastifyReply, FastifyRequest } from 'fastify';
import { connectionScope, type Pool } from '@dealpilot/db';
import type { ImpersonationSessionT } from '@dealpilot/schemas';
import { AppError } from './errors.js';
import { platformErrorFrom } from './platform.js';
import { requestContext, type ImpersonationContext } from './request-context.js';
import { READ_METHODS, READ_ONLY_EXEMPT_ROUTES, organizationIdOf } from './tenant-status.js';

/**
 * F-71 — impersonation with audit (admin-console.md §7; D-072).
 *
 * An impersonation is a REGISTER ROW bound to the staffer's own Better Auth
 * session (0067 `impersonation_sessions.platform_session_id`). No session is
 * minted for the target and no cookie changes hands: the browser keeps the
 * staffer's cookie, and this gate — registered after the session gate and
 * before the platform gate — asks the database once per request whether
 * that authenticated session is impersonating someone right now
 * (`impersonation_identity`, which also re-proves the session's standing —
 * the staffer still active in a role that could open this MODE, the tenant
 * with standing, the target still a member, the clock — and closes a row
 * that lost it). Public routes (the auth mount included) ask nothing.
 *
 * When it is: the refusals of §7 run first (the console is closed but for
 * the probe and the End; read-only mode refuses every mutating verb; two
 * routes are refused in both modes), then `request.session.user` becomes
 * the TARGET for the rest of the request. The named-organization refusal
 * lives in `impersonationScopeGate` — a preHandler, because a request BODY
 * does not exist yet in onRequest (Fastify parses it later) — for the rest
 * of the request — `sessionUser`, `withUser`, `withTenant`, the membership
 * gates, `has_permission`, `/api/v1/me` and `recordEvent` all see the
 * target. `request.session.session` stays the staffer's (the platform gate's
 * identity and 12-hour clock). The database keeps the session inside ONE
 * organization through `app.impersonation_org` (`connectionScope`).
 */

export interface ImpersonationFacts extends ImpersonationContext {
  tenant: { id: string; name: string; slug: string };
  actingAs: { id: string; email: string; name: string };
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set only while a live impersonation is bound to this request's session. */
    impersonation?: ImpersonationFacts;
  }
}

interface IdentityRow {
  id: string;
  organization_id: string;
  org_name: string;
  org_slug: string;
  org_status: string;
  platform_user_id: string;
  target_user_id: string;
  target_email: string;
  target_name: string;
  mode: 'read_only' | 'full';
  started_at: Date;
  expires_at: Date;
  live: boolean;
  end_reason: string | null;
}

/**
 * The console stays closed during a session — except the probe, the End, and
 * the F-72 kill switches. The switches are exempt because the incident that
 * makes a super admin open a support session is exactly the incident in which
 * they may need to stop all outbound, and making them end the session first
 * costs minutes. Publishing an announcement is NOT exempt: it is an
 * announcement to customers, not an emergency stop.
 *
 * These strings must match `request.routeOptions.url` character for
 * character, parameter names included — a mismatch silently never exempts.
 */
const ADMIN_ALLOWED_DURING: ReadonlySet<string> = new Set([
  'GET /api/v1/admin/me',
  'DELETE /api/v1/admin/impersonation-sessions/:id',
  'GET /api/v1/admin/platform-settings',
  'POST /api/v1/admin/platform-settings/:setting_key',
]);

/** Refused in BOTH modes, with why (the READ_ONLY_EXEMPT_ROUTES shape). */
export const IMPERSONATION_BLOCKED_ROUTES: ReadonlyMap<string, string> = new Map([
  ['POST /api/v1/organizations', 'would make the target the owner of a NEW tenant outside the session’s scope'],
  ['POST /api/v1/invitations/accept', 'would transfer authority into the target’s account'],
  ['POST /api/v1/announcements/:id/dismiss', 'would silence a platform notice on the dealer’s behalf, permanently and in their name'],
]);

function factsOf(row: IdentityRow): ImpersonationFacts {
  return {
    id: row.id,
    organizationId: row.organization_id,
    mode: row.mode,
    platformUserId: row.platform_user_id,
    targetUserId: row.target_user_id,
    expiresAt: row.expires_at,
    tenant: { id: row.organization_id, name: row.org_name, slug: row.org_slug },
    actingAs: { id: row.target_user_id, email: row.target_email, name: row.target_name },
  };
}

export function impersonationGate(pool: Pool) {
  return async (request: FastifyRequest) => {
    // Public routes (the auth mount included) never impersonate: the
    // staffer's own credentials stay the staffer's.
    if (!request.session) return;
    const routed = request.routeOptions.url ?? '';
    const r = await pool.query<IdentityRow>('SELECT * FROM impersonation_identity($1::text)', [request.session.session.id]);
    const row = r.rows[0];
    if (!row) return; // the plain staffer, or any tenant user
    if (!row.live) {
      // Closed just now (TTL, revocation, lost standing): say so once; the
      // next request is the plain staffer again.
      throw new AppError(403, 'impersonation_ended', 'The support session has ended', [
        { path: 'impersonation', code: row.end_reason ?? 'revoked', message: row.id },
      ]);
    }
    const key = `${request.method} ${routed}`;
    const facts = factsOf(row);
    // Attached BEFORE any refusal: a request the session refused was still a
    // request served under the session, and §7 wants every one in the trail.
    request.impersonation = facts;
    if (routed.startsWith('/api/v1/admin/')) {
      // NO user swap: the console acts as the staffer, and only for the probe
      // and the End. Everything else is state, not authority — 409.
      if (ADMIN_ALLOWED_DURING.has(key)) return;
      throw new AppError(409, 'impersonation_active', 'End the support session before using the console', [
        { path: 'impersonation', code: 'impersonation_active', message: row.id },
      ]);
    }
    if (IMPERSONATION_BLOCKED_ROUTES.has(key)) {
      throw new AppError(403, 'impersonation_forbidden', 'Not available during a support session', [
        { path: 'route', code: 'impersonation_forbidden', message: key },
      ]);
    }
    if (row.mode === 'read_only' && !READ_METHODS.has(request.method) && !READ_ONLY_EXEMPT_ROUTES.has(key)) {
      throw new AppError(403, 'impersonation_read_only', 'This support session is read-only', [
        { path: 'impersonation', code: 'impersonation_read_only', message: row.id },
      ]);
    }
    // recordEvent and requirePermission read the request context; every
    // transaction opened from here carries the scope GUC.
    const ctx = requestContext.getStore();
    if (ctx) ctx.impersonation = facts;
    const scope = connectionScope.getStore();
    if (scope) scope.impersonationOrgId = row.organization_id;
    // THE swap: the session row stays the staffer's; the user becomes the target.
    request.session = {
      ...request.session,
      user: { ...request.session.user, id: row.target_user_id, email: row.target_email, name: row.target_name },
    };
    request.log.info(
      { impersonationId: row.id, staffUserId: row.platform_user_id, targetUserId: row.target_user_id, method: request.method, url: routed, mode: row.mode },
      'impersonated_access',
    );
  };
}

/**
 * The named-organization refusal (§7 scope; O-22). A preHandler ON PURPOSE:
 * `organizationIdOf` reads the body, and in onRequest the body is always
 * undefined (Fastify parses it after preParsing) — registered there, the
 * body half of this check would be vacuous (review). Runs BEFORE
 * tenantStatusGate; the 0067 policies and `has_permission` remain the
 * boundary this belt merely names earlier and with the honest code.
 */
export function impersonationScopeGate() {
  return async (request: FastifyRequest) => {
    const imp = request.impersonation;
    if (!imp) return;
    const routed = request.routeOptions.url ?? '';
    if (!routed.startsWith('/api/v1/') || routed.startsWith('/api/v1/admin/')) return;
    const named = organizationIdOf(request);
    if (named && named !== imp.organizationId) {
      throw new AppError(403, 'impersonation_scope', 'Outside the support session’s tenant', [
        { path: 'organization_id', code: 'impersonation_scope', message: imp.organizationId },
      ]);
    }
  };
}

/** §7 "every request": one immutable trail row per request served under a session. */
export function impersonationRequestLog(pool: Pool) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const imp = request.impersonation;
    if (!imp) return;
    try {
      await pool.query('SELECT impersonation_log_request($1::uuid, $2, $3, $4, $5::int)', [
        imp.id, request.method, request.routeOptions.url ?? '', request.url, reply.statusCode,
      ]);
    } catch (err) {
      // The response is already on the wire; a lost trail line is logged, never hidden.
      request.log.error({ err, impersonationId: imp.id }, 'impersonation_log_failed');
    }
  };
}

export interface ImpersonationRow {
  id: string;
  organization_id: string;
  org_name: string;
  org_slug: string;
  platform_user_id: string;
  platform_email: string;
  platform_name: string | null;
  target_user_id: string;
  target_email: string;
  target_name: string;
  mode: 'read_only' | 'full';
  reason: string;
  ticket_ref: string | null;
  started_at: Date;
  expires_at: Date;
  ended_at: Date | null;
  end_reason: 'manual' | 'ttl' | 'revoked' | null;
  ended_by: string | null;
  active: boolean;
  request_count: number;
}

/** Row → wire, in one place: the register's shape is the contract's. */
export function sessionOf(row: ImpersonationRow): ImpersonationSessionT {
  return {
    id: row.id,
    tenant: { id: row.organization_id, name: row.org_name, slug: row.org_slug },
    platform_user: { id: row.platform_user_id, email: row.platform_email, name: row.platform_name ?? row.platform_email },
    target_user: { id: row.target_user_id, email: row.target_email, name: row.target_name },
    mode: row.mode,
    reason: row.reason,
    ticket_ref: row.ticket_ref,
    started_at: row.started_at.toISOString(),
    expires_at: row.expires_at.toISOString(),
    ended_at: row.ended_at ? row.ended_at.toISOString() : null,
    end_reason: row.end_reason,
    ended_by: row.ended_by,
    active: row.active,
    request_count: row.request_count,
  };
}

/** One register row as the console sees it (PA002 → 404). */
export async function readImpersonation(pool: Pool, actorId: string, id: string): Promise<ImpersonationSessionT> {
  try {
    const r = await pool.query<ImpersonationRow>('SELECT * FROM admin_get_impersonation($1::uuid, $2::uuid)', [actorId, id]);
    return sessionOf(r.rows[0]!);
  } catch (err) {
    throw platformErrorFrom(err) ?? err;
  }
}
