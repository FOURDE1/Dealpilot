import type { FastifyInstance } from 'fastify';
import { withTenant, type Pool } from '@dealpilot/db';
import { WinLossQuery } from '@dealpilot/schemas';
import { AppError, parseOrThrow } from './errors.js';
import { requirePermission } from './permissions.js';
import { sessionUser } from './f01-routes.js';

/**
 * F-55 — win/loss analytics (reports-analytics.md §9, leads.md §11).
 *
 * Classification (§9): won := status 'converted' OR the lead carries a live
 * deal (the legacy's converted_deal_id clause — a lead somebody desked was
 * won whatever its status says); lost := status 'lost' and not won; open :=
 * neither, excluded from every denominator. Reason-less losses (STOP
 * opt-outs, system writes — D-055 #6) aggregate under 'unknown'. Everything
 * is computed in SQL over the period's leads; rates get one decimal here.
 */

const PERIOD_SQL: Record<string, string | null> = {
  '30d': '30 days',
  '90d': '90 days',
  '6m': '6 months',
  '1y': '1 year',
  all: null,
};

const WON = `(l.status = 'converted' OR EXISTS (
  SELECT 1 FROM deals dd WHERE dd.lead_id = l.id AND dd.deleted_at IS NULL))`;
const LOST = `(l.status = 'lost' AND NOT ${WON})`;

/** §9: each rate is its OWN quotient at 1 dp — the loss rate is never the
 * complement of the rounded win rate (they diverge on half-decimals). */
function pct1dp(part: number, decided: number): number | null {
  if (decided === 0) return null;
  return Math.round((part / decided) * 1000) / 10;
}

export function registerF55Routes(app: FastifyInstance, pool: Pool): void {
  app.get('/api/v1/analytics/win-loss', async (request, reply) => {
    const query = parseOrThrow(WinLossQuery, request.query);
    const user = sessionUser(request);
    const orgId = query.organization_id;
    if (!orgId) throw new AppError(400, 'organization_required', 'Pass organization_id', []);

    const report = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'report:view');

      // WHO comes from the matrix; WHERE from the membership that carries it
      // (authentication-authorization.md §6: store-bound managers report on
      // their store, org-wide grants and owners on the whole group — the
      // vehicle:read_costs shape, F-07).
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

      const params: unknown[] = [orgId];
      let where = `FROM leads l WHERE l.organization_id = $1 AND l.deleted_at IS NULL`;
      if (storeScope !== null) {
        params.push(storeScope);
        where += ` AND l.store_id = ANY($${params.length}::uuid[])`;
      }
      const interval = PERIOD_SQL[query.period];
      if (interval !== null && interval !== undefined) {
        params.push(interval);
        where += ` AND l.created_at >= now() - $${params.length}::interval`;
      }
      if (query.store_id) {
        params.push(query.store_id);
        where += ` AND l.store_id = $${params.length}`;
      }

      const summaryRow = await c.query<{ total: number; won: number; lost: number }>(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE ${WON})::int AS won,
                count(*) FILTER (WHERE ${LOST})::int AS lost
         ${where}`,
        params,
      );
      const s = summaryRow.rows[0]!;
      const open = s.total - s.won - s.lost;
      const decided = s.won + s.lost;

      // F-63 (§8.3): "duplicate counts feed analytics" — certain
      // resubmissions whose NEW record falls in this window/scope. The pair's
      // lead_id side is the resubmission, so the same lead filters apply.
      const dupRow = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n
         FROM lead_duplicates ld
         JOIN leads l ON l.id = ld.lead_id
         ${where.replace('FROM leads l WHERE', 'WHERE')} AND ld.confidence = 100`,
        params,
      );

      // Grouped by ID, never by name: a tenant may legally NAME a reason
      // 'unknown', and only a null id means "no reason recorded".
      const reasons = await c.query<{ id: string | null; name: string; name_fr: string; icon: string; count: number }>(
        `SELECT lr.id,
                COALESCE(lr.name, 'unknown') AS name,
                COALESCE(lr.name_fr, 'unknown') AS name_fr,
                COALESCE(lr.icon, '❔') AS icon,
                count(*)::int AS count
         ${where.replace('FROM leads l', 'FROM leads l LEFT JOIN lost_reasons lr ON lr.id = l.lost_reason_id')}
           AND ${LOST}
         GROUP BY 1, 2, 3, 4
         ORDER BY count DESC, name`,
        params,
      );
      const lostTotal = reasons.rows.reduce((acc, r) => acc + r.count, 0);

      const months = await c.query<{ month: string; won: number; lost: number }>(
        `SELECT to_char(l.created_at, 'YYYY-MM') AS month,
                count(*) FILTER (WHERE ${WON})::int AS won,
                count(*) FILTER (WHERE ${LOST})::int AS lost
         ${where}
         GROUP BY 1 ORDER BY 1`,
        params,
      );

      const sources = await c.query<{ source: string; total: number; won: number; lost: number }>(
        `SELECT l.source, count(*)::int AS total,
                count(*) FILTER (WHERE ${WON})::int AS won,
                count(*) FILTER (WHERE ${LOST})::int AS lost
         ${where}
         GROUP BY 1 ORDER BY total DESC, source`,
        params,
      );

      return {
        summary: {
          total: s.total,
          won: s.won,
          lost: s.lost,
          open,
          win_rate: pct1dp(s.won, decided),
          loss_rate: pct1dp(s.lost, decided),
          duplicate_resubmissions: dupRow.rows[0]!.n,
        },
        lost_reasons: reasons.rows.map((r) => ({
          ...r,
          percentage: lostTotal === 0 ? 0 : Math.round((r.count / lostTotal) * 1000) / 10,
        })),
        monthly_trend: months.rows.map((m) => ({ ...m, win_rate: pct1dp(m.won, m.won + m.lost) })),
        source_performance: sources.rows.map((x) => ({ ...x, win_rate: pct1dp(x.won, x.won + x.lost) })),
      };
    });
    return reply.send(report);
  });
}
