import type { FastifyInstance } from 'fastify';
import { withTenant, type Pool } from '@dealpilot/db';
import { HeatmapQuery, type HeatmapReportT } from '@dealpilot/schemas';
import { AppError, parseOrThrow } from './errors.js';
import { requirePermission } from './permissions.js';
import { sessionUser } from './f01-routes.js';

/**
 * F-67 — the activity heatmap (reports-analytics.md §11 Target, D-068).
 *
 * The legacy drew a per-lead grid in the browser from one lead's timeline.
 * The Target is what this is: STORE-level, computed in SQL, bucketed in the
 * store's own timezone — because "Tuesday 7pm" means the store's Tuesday,
 * not UTC's — and its "best contact times" are ranked by INBOUND volume:
 * when customers actually answer is what an outbound-call scheduler wants
 * to know (ADR-020/022's quiet-hours-aware time picking reads this).
 */

const PERIOD_SQL: Record<string, string | null> = {
  '30d': '30 days', '90d': '90 days', '6m': '6 months', '1y': '1 year', all: null,
};

export function registerF67Routes(app: FastifyInstance, pool: Pool): void {
  app.get('/api/v1/analytics/activity-heatmap', async (request, reply) => {
    const query = parseOrThrow(HeatmapQuery, request.query);
    const user = sessionUser(request);
    const orgId = query.organization_id;
    if (!orgId) throw new AppError(400, 'organization_required', 'Pass organization_id', []);
    const report = await withTenant(pool, orgId, async (c): Promise<HeatmapReportT> => {
      await requirePermission(c, user.id, 'report:view');
      const interval = query.period in PERIOD_SQL ? PERIOD_SQL[query.period]! : '90 days';

      // The F-55 scope discipline: store-bound managers see their stores.
      const scopeRows = await c.query<{ store_id: string | null; is_owner: boolean }>(
        `SELECT m.store_id, 'owner' = ANY(m.roles) AS is_owner
         FROM memberships m
         WHERE m.user_id = $1 AND m.organization_id = $2 AND m.status = 'active'`,
        [user.id, orgId],
      );
      const orgWide = scopeRows.rows.some((m) => m.is_owner || m.store_id === null);
      const storeScope = orgWide
        ? null
        : [...new Set(scopeRows.rows.map((m) => m.store_id).filter((x): x is string => x !== null))];
      if (storeScope !== null && query.store_id && !storeScope.includes(query.store_id)) {
        throw new AppError(404, 'not_found', 'Not found', []);
      }

      // One timezone per report: the requested store's, else the org's first
      // store in scope — a multi-store group's grid is bucketed in the
      // timezone it shows, and the response says which one.
      const tz = await c.query<{ timezone: string }>(
        `SELECT timezone FROM stores
         WHERE organization_id = $1 AND deleted_at IS NULL
           AND ($2::uuid IS NULL OR id = $2)
           AND ($3::uuid[] IS NULL OR id = ANY($3))
         ORDER BY created_at LIMIT 1`,
        [orgId, query.store_id ?? null, storeScope],
      );
      const timezone = tz.rows[0]?.timezone ?? 'America/Toronto';

      // The conversations join exists only to know a message's store, so it
      // is added only when a store actually constrains the cut (review):
      // the org-wide default is one indexed scan of messages, not a hash
      // join of every conversation per window focus.
      const params: unknown[] = [orgId, interval, timezone, query.direction ?? null];
      let from = 'FROM messages m';
      let where = `WHERE m.organization_id = $1
           AND ($2::text IS NULL OR m.created_at >= now() - $2::interval)
           -- A send the carrier refused reached nobody: it is not activity
           -- (review). Inbound rows have no carrier verdict to fail.
           AND (m.direction = 'inbound' OR m.carrier_error IS NULL)
           AND ($4::text IS NULL OR m.direction = $4)`;
      if (query.store_id) {
        params.push(query.store_id);
        from += ' JOIN conversations cv ON cv.id = m.conversation_id';
        where += ` AND cv.store_id = $${params.length}`;
      } else if (storeScope !== null) {
        params.push(storeScope);
        from += ' JOIN conversations cv ON cv.id = m.conversation_id';
        where += ` AND cv.store_id = ANY($${params.length}::uuid[])`;
      }

      const cells = await c.query<{ dow: number; hour: number; inbound: number; outbound: number }>(
        `SELECT extract(dow  FROM (m.created_at AT TIME ZONE $3))::int AS dow,
                extract(hour FROM (m.created_at AT TIME ZONE $3))::int AS hour,
                count(*) FILTER (WHERE m.direction = 'inbound')::int  AS inbound,
                count(*) FILTER (WHERE m.direction = 'outbound')::int AS outbound
         ${from}
         ${where}
         GROUP BY 1, 2
         ORDER BY 1, 2`,
        params,
      );

      const totals = cells.rows.reduce(
        (t, r) => ({ inbound: t.inbound + r.inbound, outbound: t.outbound + r.outbound }),
        { inbound: 0, outbound: 0 },
      );
      const max_count = cells.rows.reduce((m, r) => Math.max(m, r.inbound + r.outbound), 0);
      const best_times = [...cells.rows]
        .filter((r) => r.inbound > 0)
        .sort((a, b) => b.inbound - a.inbound || a.dow - b.dow || a.hour - b.hour)
        .slice(0, 3)
        .map((r) => ({ dow: r.dow, hour: r.hour, inbound: r.inbound }));

      return {
        period: query.period,
        direction: query.direction ?? null,
        timezone,
        cells: cells.rows,
        best_times,
        totals,
        max_count,
      };
    });
    return reply.send(report);
  });
}
