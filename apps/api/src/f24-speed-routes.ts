import type { FastifyInstance } from 'fastify';
import { withTenant, withUser, type Pool } from '@dealpilot/db';
import { summarise, type SpeedSample } from '@dealpilot/core';
import { SpeedToLeadQuery } from '@dealpilot/schemas';
import { AppError, notFound, parseOrThrow } from './errors.js';
import { callerOrgIds, sessionUser } from './f01-routes.js';
import { requirePermission } from './permissions.js';

/**
 * F-24 speed to lead (leads.md §5, ADR-025).
 *
 * Aggregate only, deliberately. A per-agent leaderboard is performance data
 * about named people and needs an authority of its own to read; the store's
 * median is the number the product is sold on and every member who can see the
 * history can see it.
 */
export function registerF24Routes(app: FastifyInstance, pool: Pool): void {
  app.get('/api/v1/leads/speed-to-lead', async (request, reply) => {
    const query = parseOrThrow(SpeedToLeadQuery, request.query);
    const user = sessionUser(request);

    const orgId = await withUser(pool, user.id, async (c) => {
      if (query.organization_id) {
        const member = await c.query(
          `SELECT 1 FROM memberships m
           JOIN organizations o ON o.id = m.organization_id AND o.deleted_at IS NULL
           WHERE m.organization_id = $1 AND m.status = 'active' LIMIT 1`,
          [query.organization_id],
        );
        if (member.rows.length === 0) throw notFound();
        return query.organization_id;
      }
      const orgs = await callerOrgIds(c);
      if (orgs.length === 0) return null;
      if (orgs.length > 1) {
        throw new AppError(400, 'organization_required', 'Pass organization_id — you belong to several organizations');
      }
      return orgs[0]!;
    });
    if (!orgId) {
      return reply.send({
        contacted: 0, uncontacted: 0,
        by_rating: { excellent: 0, good: 0, fair: 0, slow: 0 },
        median_seconds: null, ai_within_slo: 0, ai_touches: 0,
      });
    }

    const summary = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'activity:read');
      const rows = await c.query<{ response_time_seconds: number | null; first_sender: string | null }>(
        `SELECT l.response_time_seconds,
                (SELECT m.sender_type
                 FROM messages m
                 JOIN conversations cv ON cv.id = m.conversation_id
                 WHERE cv.lead_id = l.id AND m.direction = 'outbound'
                 -- No path writes two outbound messages in one transaction, so
                 -- created_at orders them; if one ever does, this needs the
                 -- same seq treatment conversation_analysis got in 0035.
                 ORDER BY m.created_at, m.id
                 LIMIT 1) AS first_sender
         FROM leads l
         WHERE l.organization_id = $1
           AND l.deleted_at IS NULL
           AND l.created_at >= now() - make_interval(days => $2::int)
           AND ($3::uuid IS NULL OR l.store_id = $3)`,
        [orgId, query.days, query.store_id ?? null],
      );

      const samples: SpeedSample[] = rows.rows.map((r) => ({
        responseTimeSeconds: r.response_time_seconds,
        firstTouchByAi: r.first_sender === 'bot',
      }));
      return summarise(samples);
    });

    return reply.send({
      contacted: summary.contacted,
      uncontacted: summary.uncontacted,
      by_rating: summary.byRating,
      median_seconds: summary.medianSeconds,
      ai_within_slo: summary.aiWithinSlo,
      ai_touches: summary.aiTouches,
    });
  });
}
