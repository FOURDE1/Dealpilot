import type { FastifyRequest } from 'fastify';
import { withUser, type Pool } from '@dealpilot/db';
import { AppError } from './errors.js';
import { requestContext } from './request-context.js';

/**
 * F-69 — what a tenant's lifecycle status means for the person asking
 * (admin-console.md §4.2, multi-tenancy.md §8).
 *
 * suspended        → 403 tenant_suspended on everything (sessions were already
 *                    revoked by the transition; this covers the re-sign-in).
 * offboarding/purged → 403 tenant_offboarding.
 * read_only        → 402 payment_required on every mutating VERB except the
 *                    listed exemptions; reads, exports and DSAR stay available.
 *                    Never data deletion (ADR-024).
 * past_due, trial, active → nothing (full functionality; §4.2 grace period).
 *
 * Wired into the two membership gates (`assertLiveMember`, `requireMember`),
 * which every business route passes through — so the rule lives in one place.
 */

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * `${METHOD} ${routedPath}` a read_only tenant may still hit. Each entry says
 * why. Not gated at all (never reach a membership gate): /api/auth/*,
 * POST /api/v1/organizations (no org yet), POST /api/v1/invitations/accept
 * (definer), the notification read marks (person-scoped, withUser), and the
 * carrier/intake webhooks (system). Billing endpoints register here when
 * their slice lands — settling the bill is the one write a read-only
 * tenant must be able to make.
 */
export const READ_ONLY_EXEMPT_ROUTES: ReadonlyMap<string, string> = new Map([
  ['POST /api/v1/deals/calculate', 'pure desking computation — reads nothing, writes nothing'],
]);

export function refuseByStatus(status: string): void {
  if (status === 'suspended') {
    throw new AppError(403, 'tenant_suspended', 'This organization is suspended — contact support', [
      { path: 'organization', code: 'tenant_suspended', message: 'Access is suspended by the platform' },
    ]);
  }
  if (status === 'offboarding' || status === 'purged') {
    throw new AppError(403, 'tenant_offboarding', 'This organization is closing — contact support', [
      { path: 'organization', code: 'tenant_offboarding', message: 'The retention clock is running' },
    ]);
  }
  if (status === 'read_only') {
    const ctx = requestContext.getStore();
    // No request context (a non-HTTP caller) counts as a write: fail closed.
    const mutating = !ctx || !READ_METHODS.has(ctx.method);
    if (mutating && !(ctx && READ_ONLY_EXEMPT_ROUTES.has(`${ctx.method} ${ctx.path}`))) {
      throw new AppError(402, 'payment_required', 'This organization is read-only until its subscription is settled', [
        { path: 'organization', code: 'payment_required', message: 'Reads and exports remain available' },
      ]);
    }
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function organizationIdOf(request: FastifyRequest): string | null {
  const q = request.query as Record<string, unknown> | undefined;
  const b = request.body as Record<string, unknown> | null | undefined;
  const candidate = q?.['organization_id'] ?? (b && typeof b === 'object' ? b['organization_id'] : undefined);
  return typeof candidate === 'string' && UUID.test(candidate) ? candidate : null;
}

/**
 * The lifecycle gate for every request that NAMES an organization (query or
 * body `organization_id`): list routes and creates. Runs after the session
 * gate. Routes that reach a record by its own id go through the membership
 * gates instead (`assertLiveMember`, `requireMember`), which apply the same
 * rule — this hook exists because several list routes prove membership
 * inline under withUser and never touch those gates (review of F-69: a
 * suspended tenant's owner could still list leads after signing back in).
 *
 * Not a member of that organization → nothing here: the route answers its
 * own 404, and this gate must not become a membership oracle.
 */
export function tenantStatusGate(pool: Pool) {
  return async (request: FastifyRequest) => {
    const routed = request.routeOptions.url ?? '';
    if (!routed.startsWith('/api/v1/') || routed.startsWith('/api/v1/admin/') || !request.session) return;
    const orgId = organizationIdOf(request);
    if (!orgId) return;
    const r = await withUser(pool, request.session.user.id, (c) =>
      c.query<{ status: string }>(
        `SELECT o.status FROM organizations o
         JOIN memberships m ON m.organization_id = o.id AND m.status = 'active'
         WHERE o.id = $1 AND o.deleted_at IS NULL
         LIMIT 1`,
        [orgId],
      ),
    );
    const status = r.rows[0]?.status;
    if (status) refuseByStatus(status);
  };
}
