import type { FastifyInstance } from 'fastify';
import { withTenant, type Pool } from '@dealpilot/db';
import { SupportAccessQuery, type SupportAccessEntryT } from '@dealpilot/schemas';
import { parseOrThrow } from './errors.js';
import { sessionUser } from './f01-routes.js';
import { requirePermission } from './permissions.js';

/**
 * F-71 — the tenant's own view of support access (admin-console.md §7
 * "every session visible to the tenant", §12 transparency). A TENANT route,
 * kept apart from the admin route files on purpose: it opens tenant context
 * (`withTenant`), which the platform-drift guard forbids in those.
 *
 * The register is read through the ordinary org-keyed policy (0067): a
 * non-member gets 404 from the membership gate, another tenant's rows are
 * invisible, and under impersonation the target can see the very session
 * reading — which is honest. The staffer's identity comes from the frozen
 * `platform_user_email` (users RLS hides a non-member's row).
 */

interface RegisterRow {
  id: string;
  organization_id: string;
  org_name: string;
  org_slug: string;
  platform_user_id: string;
  platform_user_email: string;
  target_user_id: string;
  target_email: string | null;
  target_name: string | null;
  mode: 'read_only' | 'full';
  reason: string;
  ticket_ref: string | null;
  started_at: Date;
  expires_at: Date;
  ended_at: Date | null;
  end_reason: 'manual' | 'ttl' | 'revoked' | null;
  active: boolean;
}

export function registerF71SupportAccessRoutes(app: FastifyInstance, pool: Pool): void {
  app.get('/api/v1/support-access', async (request, reply) => {
    const query = parseOrThrow(SupportAccessQuery, request.query);
    const user = sessionUser(request);
    const rows = await withTenant(pool, query.organization_id, async (c) => {
      await requirePermission(c, user.id, 'activity:read');
      const r = await c.query<RegisterRow>(
        `SELECT s.id, s.organization_id, o.name AS org_name, o.slug AS org_slug,
                s.platform_user_id, s.platform_user_email, s.target_user_id,
                tu.email AS target_email, tu.name AS target_name,
                s.mode, s.reason, s.ticket_ref, s.started_at, s.expires_at, s.ended_at, s.end_reason,
                (s.ended_at IS NULL AND s.expires_at > now()) AS active
         FROM impersonation_sessions s
         JOIN organizations o ON o.id = s.organization_id
         -- LEFT defensively: today user_org_read (0007) shows every past
         -- member (no status predicate), so the join always resolves; the
         -- session row must survive even if that visibility ever narrows.
         LEFT JOIN users tu ON tu.id = s.target_user_id
         WHERE s.organization_id = $1
         ORDER BY (s.ended_at IS NULL AND s.expires_at > now()) DESC, s.started_at DESC
         LIMIT $2`,
        [query.organization_id, query.limit],
      );
      return r.rows;
    });
    const items: SupportAccessEntryT[] = rows.map((row) => ({
      id: row.id,
      tenant: { id: row.organization_id, name: row.org_name, slug: row.org_slug },
      platform_user: { id: row.platform_user_id, email: row.platform_user_email, name: row.platform_user_email },
      target_user: { id: row.target_user_id, email: row.target_email ?? '', name: row.target_name ?? '' },
      mode: row.mode,
      reason: row.reason,
      ticket_ref: row.ticket_ref,
      started_at: row.started_at.toISOString(),
      expires_at: row.expires_at.toISOString(),
      ended_at: row.ended_at ? row.ended_at.toISOString() : null,
      end_reason: row.end_reason,
      active: row.active,
    }));
    return reply.send({ items });
  });
}
