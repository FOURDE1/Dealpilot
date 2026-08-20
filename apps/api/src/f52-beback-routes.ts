import type { FastifyInstance } from 'fastify';
import { withUser, type Pool } from '@dealpilot/db';
import { BeBackQuery } from '@dealpilot/schemas';
import { BEBACK_STATUSES } from '@dealpilot/core';
import { AppError, notFound, parseOrThrow } from './errors.js';
import { callerOrgIds, sessionUser } from './f01-routes.js';

/**
 * F-52 — the be-back queue (FR-LEAD, leads.md §9).
 *
 * Dormant leads (nurture / expired / lost / unresponsive) ranked for
 * re-engagement. Deliberately NOT keysetPage: the queue is worked from the
 * top under one of four sort orders, so it returns a bounded sorted head
 * plus honest totals — `total` for depth, `critical` (90+ days silent) for
 * the header alert. Reactivation is the EXISTING lead PATCH to `contacted`
 * (transitions are free in the vocabulary; proven in f48) — a second write
 * path here would be the one that skips something.
 *
 * Membership-read, same authority as GET /api/v1/leads: the queue shows
 * nothing that list cannot already show.
 */

/** Allow-list at the sink: a sort NAME arrives, ORDER BY text never does. */
const SORT_SQL: Record<string, string> = {
  aging: 'dormant_since ASC, id ASC',
  score: 'score DESC NULLS LAST, dormant_since ASC, id ASC',
  recent: 'updated_at DESC, id DESC',
  created: 'created_at ASC, id ASC',
};

/** LIKE has its own metacharacters; a search for "100%" must not match everything. */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export function registerF52Routes(app: FastifyInstance, pool: Pool): void {
  app.get('/api/v1/leads/be-back', async (request, reply) => {
    const query = parseOrThrow(BeBackQuery, request.query);
    const user = sessionUser(request);
    const result = await withUser(pool, user.id, async (c) => {
      let orgId = query.organization_id;
      if (orgId) {
        const member = await c.query(
          `SELECT 1 FROM memberships m
           JOIN organizations o ON o.id = m.organization_id AND o.deleted_at IS NULL
           WHERE m.organization_id = $1 AND m.status = 'active' LIMIT 1`,
          [orgId],
        );
        if (member.rows.length === 0) throw notFound();
      } else {
        const orgs = await callerOrgIds(c);
        if (orgs.length === 0) return { items: [], total: 0, critical: 0 };
        if (orgs.length > 1) {
          throw new AppError(400, 'organization_required', 'Pass organization_id — you belong to several organizations');
        }
        orgId = orgs[0]!;
      }

      const params: unknown[] = [orgId, [...BEBACK_STATUSES]];
      let where = `FROM leads
        WHERE leads.organization_id = $1 AND deleted_at IS NULL AND status = ANY($2::text[])`;
      if (query.store_id) {
        params.push(query.store_id);
        where += ` AND leads.store_id = $${params.length}`;
      }
      // The search predicate stays OUT of `where`: the critical alert is
      // queue-wide state (leads.md §9) and must not vanish because the user
      // typed a term that happens to match only calm leads. The combined
      // name column is what the screen shows, so "Yvon Tremblay" — or any
      // fragment spanning the first/last boundary — matches.
      let qPred = '';
      if (query.q) {
        params.push(`%${escapeLike(query.q)}%`);
        const n = params.length;
        qPred = `((COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) ILIKE $${n} OR vehicle_interest ILIKE $${n} OR phone ILIKE $${n} OR email ILIKE $${n})`;
      }

      const totals = await c.query<{ total: number; critical: number }>(
        `SELECT count(*) FILTER (WHERE ${qPred || 'TRUE'})::int AS total,
                count(*) FILTER (WHERE COALESCE(last_contacted_at, updated_at) <= now() - interval '90 days')::int AS critical
         ${where}`,
        params,
      );

      params.push(query.limit);
      // The reason resolves here so the card can say WHY (F-53) without a
      // second fetch; a subquery keeps `where` join-free for the totals.
      const items = await c.query(
        `SELECT leads.id, leads.store_id, status, first_name, last_name, phone, email,
                vehicle_interest, score, source, assigned_to, contact_attempts,
                last_contacted_at, leads.created_at, leads.updated_at,
                COALESCE(last_contacted_at, updated_at) AS dormant_since,
                (SELECT jsonb_build_object('name', lr.name, 'name_fr', lr.name_fr, 'icon', lr.icon)
                 FROM lost_reasons lr WHERE lr.id = leads.lost_reason_id) AS lost_reason
         ${where}${qPred ? ` AND ${qPred}` : ''}
         ORDER BY ${SORT_SQL[query.sort]!}
         LIMIT $${params.length}`,
        params,
      );

      return {
        items: items.rows,
        total: totals.rows[0]?.total ?? 0,
        critical: totals.rows[0]?.critical ?? 0,
      };
    });
    return reply.send(result);
  });
}
