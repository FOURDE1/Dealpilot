import type { FastifyInstance } from 'fastify';
import { withTenant, type Pool } from '@dealpilot/db';
import { LeaderboardQuery, type LeaderboardReportT } from '@dealpilot/schemas';
import { AppError, parseOrThrow } from './errors.js';
import { requirePermission } from './permissions.js';
import { sessionUser } from './f01-routes.js';

/**
 * F-66 — the salesperson leaderboard (reports-analytics.md §10, D-067).
 *
 * Rebuilt on the FK model the legacy lacked: deals hang on salesperson_id,
 * leads on assigned_to, and the fuzzy name-scoring ("startsWith + space →
 * 80") goes where fuzzy joins over money belong — nowhere. The §10
 * documented defects are FIXED, not ported: closed means the canonical
 * delivered/complete stages, response time is the F-24 stamp, and the
 * bands shown in the UI are the lead module's 5/15/30 minutes.
 */

const PERIOD_SQL: Record<string, string | null> = {
  '30d': '30 days', '90d': '90 days', '6m': '6 months', '1y': '1 year', all: null,
};

export function registerF66Routes(app: FastifyInstance, pool: Pool): void {
  app.get('/api/v1/analytics/leaderboard', async (request, reply) => {
    const query = parseOrThrow(LeaderboardQuery, request.query);
    const user = sessionUser(request);
    const orgId = query.organization_id;
    if (!orgId) throw new AppError(400, 'organization_required', 'Pass organization_id', []);
    const report = await withTenant(pool, orgId, async (c): Promise<LeaderboardReportT> => {
      await requirePermission(c, user.id, 'report:view');
      const interval = query.period in PERIOD_SQL ? PERIOD_SQL[query.period]! : '90 days';

      // The F-55 scope discipline: store-bound managers rank their stores.
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
      const params: unknown[] = [orgId, interval, query.store_id ?? null, storeScope];

      const dealRows = await c.query<{
        user_id: string; deals: number; closed: number; sales: string; gross: string; fi: string;
      }>(
        `WITH scoped AS (
           SELECT d.*,
                  (d.pipeline_stage IN ('delivered','complete')) AS is_closed,
                  -- A delivery belongs to the month it HAPPENED, not the month
                  -- the deal was opened: a car delivered in August shows on
                  -- August's board even if the paperwork started in January
                  -- (review). delivered_at is the F-05 stamp; created_at only
                  -- backstops legacy rows that never got one.
                  COALESCE(d.delivered_at, d.created_at) AS closed_on
           FROM deals d
           WHERE d.organization_id = $1 AND d.deleted_at IS NULL AND d.salesperson_id IS NOT NULL
             AND ($3::uuid IS NULL OR d.store_id = $3)
             AND ($4::uuid[] IS NULL OR d.store_id = ANY($4))
         )
         SELECT salesperson_id AS user_id,
                count(*) FILTER (WHERE $2::text IS NULL OR created_at >= now() - $2::interval)::int AS deals,
                count(*) FILTER (WHERE is_closed AND ($2::text IS NULL OR closed_on >= now() - $2::interval))::int AS closed,
                COALESCE(sum(sale_price_cents)  FILTER (WHERE is_closed AND ($2::text IS NULL OR closed_on >= now() - $2::interval)), 0)::bigint::text AS sales,
                COALESCE(sum(total_gross_cents) FILTER (WHERE is_closed AND ($2::text IS NULL OR closed_on >= now() - $2::interval)), 0)::bigint::text AS gross,
                COALESCE(sum(fi_reserve_cents)  FILTER (WHERE is_closed AND ($2::text IS NULL OR closed_on >= now() - $2::interval)), 0)::bigint::text AS fi
         FROM scoped
         GROUP BY 1`,
        params,
      );

      const leadRows = await c.query<{
        user_id: string; total: number; active: number; avg_response: string | null;
      }>(
        `SELECT l.assigned_to AS user_id,
                count(*)::int AS total,
                count(*) FILTER (WHERE l.status NOT IN ('converted','lost','expired'))::int AS active,
                avg(l.response_time_seconds)::text AS avg_response
         FROM leads l
         WHERE l.organization_id = $1 AND l.deleted_at IS NULL AND l.assigned_to IS NOT NULL
           AND ($2::text IS NULL OR l.created_at >= now() - $2::interval)
           AND ($3::uuid IS NULL OR l.store_id = $3)
           AND ($4::uuid[] IS NULL OR l.store_id = ANY($4))
         GROUP BY 1`,
        params,
      );

      const ids = [...new Set([...dealRows.rows.map((r) => r.user_id), ...leadRows.rows.map((r) => r.user_id)])];
      // Names from the RLS-scoped `users` table, and only for active members
      // of THIS organization. Reading Better Auth's global "user" table here
      // named a stranger from another dealer group whenever a foreign id had
      // been attached to a deal (review) — a row nobody here can vouch for
      // does not rank at all.
      const names = ids.length
        ? await c.query<{ id: string; name: string }>(
            `SELECT u.id, u.name FROM users u
             JOIN memberships m ON m.user_id = u.id AND m.organization_id = $2 AND m.status = 'active'
             WHERE u.id = ANY($1::uuid[])`,
            [ids, orgId],
          )
        : { rows: [] as { id: string; name: string }[] };
      const nameOf = new Map(names.rows.map((r) => [r.id, r.name]));

      const byUser = new Map<string, LeaderboardReportT['rows'][number]>();
      const blank = (user_id: string): LeaderboardReportT['rows'][number] => ({
        user_id,
        name: nameOf.get(user_id) ?? '',
        deals: 0, closed_deals: 0, total_sales_cents: 0, gross_profit_cents: 0,
        fi_reserve_cents: 0, total_leads: 0, active_leads: 0, conversion_rate: 0,
        avg_response_seconds: null,
      });
      for (const r of dealRows.rows) {
        const row = byUser.get(r.user_id) ?? blank(r.user_id);
        row.deals = r.deals;
        row.closed_deals = r.closed;
        row.total_sales_cents = Number(r.sales);
        row.gross_profit_cents = Number(r.gross);
        row.fi_reserve_cents = Number(r.fi);
        byUser.set(r.user_id, row);
      }
      for (const r of leadRows.rows) {
        const row = byUser.get(r.user_id) ?? blank(r.user_id);
        row.total_leads = r.total;
        row.active_leads = r.active;
        row.avg_response_seconds = r.avg_response === null ? null : Math.round(Number(r.avg_response));
        byUser.set(r.user_id, row);
      }
      for (const row of byUser.values()) {
        row.conversion_rate =
          row.total_leads === 0 ? 0 : Math.round((row.closed_deals / row.total_leads) * 1000) / 10;
      }

      // Every branch ends in a STABLE tiebreak (name, then id): Postgres
      // hash-aggregation order is unspecified, and without this two reps
      // tied at the same gross swapped gold and silver between refreshes
      // (review finding).
      const tiebreak = (a: { name: string; user_id: string }, b: { name: string; user_id: string }) =>
        a.name.localeCompare(b.name) || a.user_id.localeCompare(b.user_id);
      const rows = [...byUser.values()].filter((r) => nameOf.has(r.user_id)).sort((a, b) => {
        switch (query.sort) {
          case 'deals':
            return b.closed_deals - a.closed_deals || b.deals - a.deals || tiebreak(a, b);
          case 'conversion':
            return b.conversion_rate - a.conversion_rate || tiebreak(a, b);
          case 'response':
            // Fastest first; the never-responded sink to the bottom.
            return (
              (a.avg_response_seconds ?? Infinity) - (b.avg_response_seconds ?? Infinity) ||
              tiebreak(a, b)
            );
          case 'leads':
            return b.total_leads - a.total_leads || tiebreak(a, b);
          default:
            return b.gross_profit_cents - a.gross_profit_cents || tiebreak(a, b);
        }
      });

      return { period: query.period, sort: query.sort, rows };
    });
    return reply.send(report);
  });
}
