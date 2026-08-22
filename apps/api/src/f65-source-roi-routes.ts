import type { FastifyInstance } from 'fastify';
import { withTenant, withUser, type Pool } from '@dealpilot/db';
import {
  ListSourceCostsQuery,
  SourceRoiQuery,
  UpsertSourceCostInput,
  type SourceRoiReportT,
} from '@dealpilot/schemas';
import { AppError, notFound, parseOrThrow } from './errors.js';
import { requirePermission } from './permissions.js';
import { idParam, keysetPage, requireMember, sessionUser } from './f01-routes.js';

/**
 * F-65 — marketing spend + source ROI (expenses-accounting.md §10,
 * reports-analytics.md §8, D-066).
 *
 * The ledger is tenant config (members read, organization:update writes,
 * POST is the §10 UPSERT); the report is manager material behind
 * report:view like the rest of F-55's family. Cents end to end — the
 * legacy's dollars-here-cents-there is its own flagged hazard — and
 * STORE-SCOPED, which the legacy's own §8 calls out as its gap.
 */

const PERIOD_SQL: Record<string, string | null> = {
  '30d': '30 days', '90d': '90 days', '6m': '6 months', '1y': '1 year', all: null,
};

function centsDiv(spend: number, count: number): number {
  return count === 0 ? 0 : Math.round(spend / count);
}
function pct1(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10;
}
function roiOf(revenue: number, spend: number): number | null {
  if (spend === 0) return null;
  return Math.round(((revenue - spend) / spend) * 1000) / 10;
}

export function registerF65Routes(app: FastifyInstance, pool: Pool): void {
  app.get('/api/v1/source-costs', async (request, reply) => {
    const query = parseOrThrow(ListSourceCostsQuery, request.query);
    const user = sessionUser(request);
    const orgId = query.organization_id;
    if (!orgId) throw new AppError(400, 'organization_required', 'Pass organization_id', []);
    const page = await withTenant(pool, orgId, async (c) => {
      await requireMember(c, user.id);
      let sql = `SELECT * FROM source_costs WHERE organization_id = $1`;
      const params: unknown[] = [orgId];
      if (query.month) {
        params.push(query.month);
        sql += ` AND month = $${params.length}`;
      }
      if (query.source) {
        params.push(query.source);
        sql += ` AND source = $${params.length}`;
      }
      if (query.store_id) {
        params.push(query.store_id);
        sql += ` AND store_id = $${params.length}`;
      }
      // Cursor-paginated like every list (the legacy's silent truncation is
      // its own §13 defect class); keyset orders by created_at/id, and the
      // month/source filters carry the §10 exact-match views.
      return keysetPage(c, sql, params, query);
    });
    return reply.send(page);
  });

  app.post('/api/v1/source-costs', async (request, reply) => {
    const input = parseOrThrow(UpsertSourceCostInput, request.body);
    const user = sessionUser(request);
    const row = await withTenant(pool, input.organization_id, async (c) => {
      await requirePermission(c, user.id, 'organization:update');
      if (input.store_id) {
        const store = await c.query(`SELECT 1 FROM stores WHERE id = $1 AND deleted_at IS NULL`, [input.store_id]);
        if (store.rows.length === 0) {
          throw new AppError(422, 'validation_failed', 'Unknown store', [
            { path: 'store_id', code: 'unknown_store', message: input.store_id },
          ]);
        }
      }
      // §10: one row per (source, month, store); re-posting overwrites.
      const r = await c.query<Record<string, unknown>>(
        `INSERT INTO source_costs (organization_id, store_id, source, month, spend_cents, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (organization_id, source, month, store_id)
         -- Re-posting an amount without a note must not erase last month's
         -- note (review): absent input keeps what the row already says.
         DO UPDATE SET spend_cents = EXCLUDED.spend_cents,
                       notes = COALESCE(EXCLUDED.notes, source_costs.notes)
         RETURNING *`,
        [
          input.organization_id, input.store_id ?? null, input.source, input.month,
          input.spend_cents, input.notes ?? null, user.id,
        ],
      );
      return r.rows[0]!;
    });
    return reply.status(201).send(row);
  });

  app.delete('/api/v1/source-costs/:id', async (request, reply) => {
    const id = idParam(request);
    const user = sessionUser(request);
    const orgId = await withUser(pool, user.id, async (c) => {
      const r = await c.query<{ organization_id: string }>(
        `SELECT organization_id FROM source_costs WHERE id = $1`, [id],
      );
      if (r.rows.length === 0) throw notFound();
      return r.rows[0]!.organization_id;
    });
    await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'organization:update');
      const gone = await c.query(`DELETE FROM source_costs WHERE id = $1`, [id]);
      if (gone.rowCount === 0) throw notFound();
    });
    return reply.status(204).send();
  });

  app.get('/api/v1/analytics/source-roi', async (request, reply) => {
    const query = parseOrThrow(SourceRoiQuery, request.query);
    const user = sessionUser(request);
    const orgId = query.organization_id;
    if (!orgId) throw new AppError(400, 'organization_required', 'Pass organization_id', []);
    const report = await withTenant(pool, orgId, async (c): Promise<SourceRoiReportT> => {
      await requirePermission(c, user.id, 'report:view');
      // 'all' maps to a NULL interval on purpose — `?? '90 days'` here once
      // silently turned all-time into a quarter (review blocker).
      const interval = query.period in PERIOD_SQL ? PERIOD_SQL[query.period]! : '90 days';

      // WHO comes from the matrix; WHERE from the membership that carries it
      // (the F-55 discipline this family follows): store-bound managers
      // report on their stores, org-wide grants and owners on the group.
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
      const storeFilter = query.store_id ?? null;
      const scopeFilter = storeScope;
      const params: unknown[] = [orgId, interval, storeFilter, scopeFilter];

      // §8 step 1+2 in one pass: leads in window, revenue = gross sale price
      // of the converted lead's FIRST deal (revenue, not profit — the spec's
      // own emphasis).
      const bySource = await c.query<{
        source: string; month: string; total_leads: number; converted_leads: number; revenue: string;
      }>(
        `SELECT COALESCE(l.source, 'unknown') AS source,
                to_char(l.created_at, 'YYYY-MM') AS month,
                count(*)::int AS total_leads,
                count(*) FILTER (WHERE l.status = 'converted' OR EXISTS (
                  SELECT 1 FROM deals dd WHERE dd.lead_id = l.id AND dd.deleted_at IS NULL))::int AS converted_leads,
                COALESCE(sum(
                  (SELECT d.sale_price_cents FROM deals d
                   WHERE d.lead_id = l.id AND d.deleted_at IS NULL
                   ORDER BY d.created_at ASC LIMIT 1)
                ) FILTER (WHERE l.status = 'converted' OR EXISTS (
                  SELECT 1 FROM deals dd WHERE dd.lead_id = l.id AND dd.deleted_at IS NULL)), 0)::bigint::text AS revenue
         FROM leads l
         WHERE l.organization_id = $1 AND l.deleted_at IS NULL
           AND ($2::text IS NULL OR l.created_at >= now() - $2::interval)
           AND ($3::uuid IS NULL OR l.store_id = $3)
           AND ($4::uuid[] IS NULL OR l.store_id = ANY($4))
         GROUP BY 1, 2`,
        params,
      );

      // §8 step 3: spend from the month the window starts in. Store view is
      // STRICT (that store's rows only); the org view sums everything.
      const spendRows = await c.query<{ source: string; month: string; spend: string }>(
        `SELECT source, to_char(month, 'YYYY-MM') AS month, sum(spend_cents)::bigint::text AS spend
         FROM source_costs
         WHERE organization_id = $1
           AND ($2::text IS NULL OR month >= date_trunc('month', now() - $2::interval)::date)
           AND ($3::uuid IS NULL OR store_id = $3)
           AND ($4::uuid[] IS NULL OR store_id = ANY($4))
         GROUP BY 1, 2`,
        params,
      );

      type Agg = { leads: number; converted: number; revenue: number; spend: number };
      const sources = new Map<string, Agg>();
      const monthly = new Map<string, Agg & { month: string; source: string }>();
      const bump = (source: string, month: string, patch: Partial<Agg>) => {
        const s = sources.get(source) ?? { leads: 0, converted: 0, revenue: 0, spend: 0 };
        const key = `${month}:${source}`;
        const m = monthly.get(key) ?? { month, source, leads: 0, converted: 0, revenue: 0, spend: 0 };
        for (const [k, v] of Object.entries(patch)) {
          s[k as keyof Agg] += v ?? 0;
          m[k as keyof Agg] += v ?? 0;
        }
        sources.set(source, s);
        monthly.set(key, m);
      };
      for (const r of bySource.rows) {
        bump(r.source, r.month, {
          leads: r.total_leads, converted: r.converted_leads, revenue: Number(r.revenue),
        });
      }
      // §8 step 4: sources with spend but zero leads still appear.
      for (const r of spendRows.rows) bump(r.source, r.month, { spend: Number(r.spend) });

      const sourceRows = [...sources.entries()]
        .map(([source, a]) => ({
          source,
          total_leads: a.leads,
          converted_leads: a.converted,
          total_revenue_cents: a.revenue,
          spend_cents: a.spend,
          cost_per_lead_cents: centsDiv(a.spend, a.leads),
          cost_per_conversion_cents: centsDiv(a.spend, a.converted),
          conversion_rate: pct1(a.converted, a.leads),
          roi: roiOf(a.revenue, a.spend),
        }))
        .sort((x, y) => (y.roi ?? -Infinity) - (x.roi ?? -Infinity));

      const totals = sourceRows.reduce(
        (t, r) => ({
          total_leads: t.total_leads + r.total_leads,
          total_converted: t.total_converted + r.converted_leads,
          total_spend_cents: t.total_spend_cents + r.spend_cents,
          total_revenue_cents: t.total_revenue_cents + r.total_revenue_cents,
        }),
        { total_leads: 0, total_converted: 0, total_spend_cents: 0, total_revenue_cents: 0 },
      );

      return {
        period: query.period,
        sources: sourceRows,
        totals: {
          ...totals,
          avg_cost_per_lead_cents: centsDiv(totals.total_spend_cents, totals.total_leads),
          avg_conversion_rate: pct1(totals.total_converted, totals.total_leads),
          overall_roi: roiOf(totals.total_revenue_cents, totals.total_spend_cents),
        },
        monthly: [...monthly.values()]
          .map((m) => ({
            month: m.month,
            source: m.source,
            leads: m.leads,
            converted: m.converted,
            revenue_cents: m.revenue,
            spend_cents: m.spend,
            cost_per_lead_cents: centsDiv(m.spend, m.leads),
            roi: roiOf(m.revenue, m.spend),
          }))
          .sort((a, b) => a.month.localeCompare(b.month) || a.source.localeCompare(b.source)),
      };
    });
    return reply.send(report);
  });
}
