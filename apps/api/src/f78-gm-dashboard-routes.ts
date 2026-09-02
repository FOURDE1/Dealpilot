import type { FastifyInstance } from 'fastify';
import { withTenant, type Pool } from '@dealpilot/db';
import { FundingStatus, GmDashboardQuery, type GmDashboardReportT } from '@dealpilot/schemas';
import { AppError, parseOrThrow } from './errors.js';
import { requirePermission } from './permissions.js';
import { sessionUser } from './f01-routes.js';
import { WON, pct1dp } from './f55-analytics-routes.js';

/**
 * F-78 — the GM Command Center report (reports-analytics.md §14.1,
 * FR-REP-003, D-079). Every dashboard figure computed server-side in SQL,
 * one figure per claim, each with the window and clock it was computed on
 * returned on the wire — the successor of the floor-as-total tiles.
 *
 * CLOCK: one timezone per report, resolved f67-style (f67-heatmap-routes.ts)
 * — the org's first in-scope store's timezone (ORDER BY created_at LIMIT 1),
 * falling back to 'America/Toronto' when the org holds no store. That ONE
 * value feeds the month window (date_trunc AT TIME ZONE), the vehicle-aging
 * current date, and month.timezone on the wire; captions interpolate it.
 * Month predicates are `>= month_start` ONLY — no upper bound (delivered_at
 * and created_at cannot exceed now() outside time travel, and a literal
 * `< now()` bound would make month-boundary fixtures flake in the first
 * hour of a month).
 *
 * SCOPE: the F-55 membership store-scope block — owners and org-wide
 * memberships see the whole group; a store-bound manager's every query gains
 * `store_id = ANY(scope)`. leads.store_id is NULLABLE (NULL = the F-45
 * central queue), so a store-bound manager's lead figures (Prospects du
 * mois, conversion, sources) EXCLUDE central-queue leads — adopted
 * deliberately as F-55's shipped behaviour, not drifted into.
 *
 * PERFORMANCE: measured whole-report EXPLAIN on the biggest dev org: 16.5 ms
 * over existing indexes (idx_deals_org_stage / _org_funding, idx_leads_*,
 * idx_vehicles_org_deal_status). No new index ships with this slice.
 * Un-cut condition for a rotting index: a measured seq scan on the
 * stage_entered_at predicate for a >50k-deal org earns a partial
 * (organization_id, stage_entered_at) WHERE deleted_at IS NULL index — in a
 * NEW migration (see 0071's comment).
 *
 * NO metric reads activity_events, ever: an audit log as a metric source
 * makes a deleted or edited event a silent metric change.
 */

/** The seven OPEN stages, zero-filled in wire order — terminal stages
 * (delivered/complete/lost) never sit in the pipeline figure. */
const OPEN_STAGES = [
  'new', 'submitted', 'approved', 'signed', 'sourcing', 'pending_delivery', 'scheduled',
] as const;
// Derived, never hand-copied — the repo's recorded « new vocabulary value
// teaches one consumer » class: a fifth status must join the zero-filled partition.
const FUNDING_STATUSES = FundingStatus.options;

/** contacts-then-leads display name (A3): concat_ws never NULLs and skips
 * NULL parts, so a one-name-only customer still shows the name on file. */
const CUSTOMER_SQL = `COALESCE(
    NULLIF(btrim(concat_ws(' ', ct.first_name, ct.last_name)), ''),
    NULLIF(btrim(concat_ws(' ', l.first_name, l.last_name)), '')
  )`;

export function registerF78Routes(app: FastifyInstance, pool: Pool): void {
  app.get('/api/v1/reports/gm-dashboard', async (request, reply) => {
    const query = parseOrThrow(GmDashboardQuery, request.query);
    const user = sessionUser(request);
    const orgId = query.organization_id;
    if (!orgId) throw new AppError(400, 'organization_required', 'Pass organization_id', []);

    const report = await withTenant(pool, orgId, async (c): Promise<GmDashboardReportT> => {
      await requirePermission(c, user.id, 'report:view');

      // The F-55 scope discipline: store-bound managers report on their store.
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

      // ONE clock for the whole report (f67's resolution): the first
      // in-scope store's timezone, else Toronto for a storeless org.
      const tzRow = await c.query<{ timezone: string }>(
        `SELECT timezone FROM stores
         WHERE organization_id = $1 AND deleted_at IS NULL
           AND ($2::uuid[] IS NULL OR id = ANY($2))
         ORDER BY created_at LIMIT 1`,
        [orgId, storeScope],
      );
      const tz = tzRow.rows[0]?.timezone ?? 'America/Toronto';

      // The window, computed ONCE SQL-side and returned on the wire so every
      // caption interpolates the real window instead of describing one.
      const windowRow = await c.query<{ month_start: Date }>(
        `SELECT (date_trunc('month', now() AT TIME ZONE $1) AT TIME ZONE $1) AS month_start`,
        [tz],
      );
      const monthStart = windowRow.rows[0]!.month_start;

      const scoped = (alias: string, n: number) =>
        `($${n}::uuid[] IS NULL OR ${alias}.store_id = ANY($${n}))`;

      // Q1 + Q10 — the open pipeline, by stage and by funding status. One
      // GROUP BY each over the same predicate; the route zero-fills so the
      // bars always render every labelled row.
      const stageRows = await c.query<{ pipeline_stage: string; count: number }>(
        `SELECT d.pipeline_stage, count(*)::int AS count
         FROM deals d
         WHERE d.organization_id = $1 AND d.deleted_at IS NULL
           AND d.pipeline_stage NOT IN ('delivered','complete','lost')
           AND ${scoped('d', 2)}
         GROUP BY 1`,
        [orgId, storeScope],
      );
      const byStage = new Map(stageRows.rows.map((r) => [r.pipeline_stage, r.count]));
      const fundingBars = await c.query<{ funding_status: string; count: number }>(
        `SELECT d.funding_status, count(*)::int AS count
         FROM deals d
         WHERE d.organization_id = $1 AND d.deleted_at IS NULL
           AND d.pipeline_stage NOT IN ('delivered','complete','lost')
           AND ${scoped('d', 2)}
         GROUP BY 1`,
        [orgId, storeScope],
      );
      const byFunding = new Map(fundingBars.rows.map((r) => [r.funding_status, r.count]));

      // Q2 — month sales on the F-66 closed classification (closed =
      // delivered/complete, closed_on = COALESCE(delivered_at, created_at)),
      // so this page and the leaderboard can never call different deals
      // "sold". Averages are SQL-side and NULL on zero rows — never 0.
      const sales = await c.query<{
        units: number; gross: string; avg_front: string | null; avg_back: string | null;
      }>(
        `SELECT count(*)::int AS units,
                COALESCE(sum(d.total_gross_cents), 0)::bigint::text AS gross,
                round(avg(d.front_gross_cents))::bigint::text AS avg_front,
                round(avg(d.total_gross_cents - d.front_gross_cents))::bigint::text AS avg_back
         FROM deals d
         WHERE d.organization_id = $1 AND d.deleted_at IS NULL
           AND d.pipeline_stage IN ('delivered','complete')
           AND COALESCE(d.delivered_at, d.created_at) >= $2
           AND ${scoped('d', 3)}`,
        [orgId, monthStart, storeScope],
      );
      const s = sales.rows[0]!;

      // Q3 — the funding queue (no window: a queue, not a month figure).
      // Lost deals never count — the money conversation is over.
      const funding = await c.query<{ count: number; amount: string }>(
        `SELECT count(*)::int AS count,
                COALESCE(sum(d.amount_financed_cents), 0)::bigint::text AS amount
         FROM deals d
         WHERE d.organization_id = $1 AND d.deleted_at IS NULL
           AND d.pipeline_stage <> 'lost'
           AND d.funding_status IN ('submitted','stips_required')
           AND ${scoped('d', 2)}`,
        [orgId, storeScope],
      );

      // Q4 — inventory, aged on the SAME resolved clock's current date
      // (acquisition_date is a bare date; UTC must never move a date).
      const inv = await c.query<{
        in_stock: number; over_30: number; a0: number; a31: number; a60: number;
      }>(
        `SELECT count(*)::int AS in_stock,
                count(*) FILTER (WHERE v.acquisition_date <  today - 30)::int AS over_30,
                count(*) FILTER (WHERE v.acquisition_date >= today - 30)::int AS a0,
                count(*) FILTER (WHERE v.acquisition_date <  today - 30 AND v.acquisition_date >= today - 60)::int AS a31,
                count(*) FILTER (WHERE v.acquisition_date <  today - 60)::int AS a60
         FROM vehicles v, (SELECT (now() AT TIME ZONE $2)::date AS today) AS clock
         WHERE v.organization_id = $1 AND v.deleted_at IS NULL
           AND v.deal_status IN ('available','reserved','sold_pending')
           AND ${scoped('v', 3)}`,
        [orgId, tz, storeScope],
      );
      const i = inv.rows[0]!;

      // Q5 — leads & conversion this month, on F-55's WON classification.
      // The rate is pct1dp — its own server-side quotient, null when no
      // leads (a rate over nothing is not zero).
      const leads = await c.query<{ created: number; converted: number }>(
        `SELECT count(*)::int AS created,
                count(*) FILTER (WHERE ${WON})::int AS converted
         FROM leads l
         WHERE l.organization_id = $1 AND l.deleted_at IS NULL
           AND l.created_at >= $2
           AND ${scoped('l', 3)}`,
        [orgId, monthStart, storeScope],
      );
      const lead = leads.rows[0]!;

      // Q6 — lead sources this month.
      const sources = await c.query<{ source: string; count: number }>(
        `SELECT l.source, count(*)::int AS count
         FROM leads l
         WHERE l.organization_id = $1 AND l.deleted_at IS NULL
           AND l.created_at >= $2
           AND ${scoped('l', 3)}
         GROUP BY 1
         ORDER BY count DESC, source`,
        [orgId, monthStart, storeScope],
      );

      // Q7 — sales by salesperson over Q2's closed-in-window rows. Names via
      // the F-66 membership-scoped resolution (never the global user table);
      // a seller with no active membership KEEPS the row with name null (the
      // page renders a placeholder) so Σ rows.units + unattributed_units ===
      // month_sales.units holds structurally.
      const sellers = await c.query<{ user_id: string | null; units: number; gross: string }>(
        `SELECT d.salesperson_id AS user_id, count(*)::int AS units,
                COALESCE(sum(d.total_gross_cents), 0)::bigint::text AS gross
         FROM deals d
         WHERE d.organization_id = $1 AND d.deleted_at IS NULL
           AND d.pipeline_stage IN ('delivered','complete')
           AND COALESCE(d.delivered_at, d.created_at) >= $2
           AND ${scoped('d', 3)}
         GROUP BY 1`,
        [orgId, monthStart, storeScope],
      );
      const sellerIds = sellers.rows.map((r) => r.user_id).filter((x): x is string => x !== null);
      const names = sellerIds.length
        ? await c.query<{ id: string; name: string }>(
            `SELECT u.id, u.name FROM users u
             JOIN memberships m ON m.user_id = u.id AND m.organization_id = $2 AND m.status = 'active'
             WHERE u.id = ANY($1::uuid[])`,
            [sellerIds, orgId],
          )
        : { rows: [] as { id: string; name: string }[] };
      const nameOf = new Map(names.rows.map((r) => [r.id, r.name]));
      const sellerRows = sellers.rows
        .filter((r): r is typeof r & { user_id: string } => r.user_id !== null)
        .map((r) => ({
          user_id: r.user_id,
          name: nameOf.get(r.user_id) ?? null,
          units: r.units,
          gross_cents: Number(r.gross),
        }))
        // Gross desc, then name asc, then id — the F-66 stable-order lesson.
        .sort(
          (a, b) =>
            b.gross_cents - a.gross_cents ||
            (a.name ?? '').localeCompare(b.name ?? '') ||
            a.user_id.localeCompare(b.user_id),
        );
      const unattributed = sellers.rows.find((r) => r.user_id === null)?.units ?? 0;

      // Q8 — attention: rotting (the 0071 consumer). Open deals whose stage
      // has not moved in 7+ days, oldest first; count(*) OVER () carries the
      // TRUE total past the 10-row cap. Ages from stage_entered_at are a
      // FLOOR for pre-0071 rows (they understate, never accuse — the
      // consuming caption says so).
      const rotting = await c.query<{
        deal_id: string; lead_id: string | null; customer: string | null;
        stage: string; days: number; total: number;
      }>(
        `SELECT d.id AS deal_id, d.lead_id, ${CUSTOMER_SQL} AS customer,
                d.pipeline_stage AS stage,
                floor(extract(epoch FROM (now() - d.stage_entered_at)) / 86400)::int AS days,
                count(*) OVER ()::int AS total
         FROM deals d
         LEFT JOIN contacts ct ON ct.id = d.contact_id
         LEFT JOIN leads l ON l.id = d.lead_id
         WHERE d.organization_id = $1 AND d.deleted_at IS NULL
           AND d.pipeline_stage NOT IN ('delivered','complete','lost')
           AND d.stage_entered_at < now() - interval '7 days'
           AND ${scoped('d', 2)}
         ORDER BY d.stage_entered_at ASC
         LIMIT 10`,
        [orgId, storeScope],
      );

      // Q9 — attention: delivered, unfunded. STATE-based predicate (current
      // stage, not the sticky delivered_at stamp): a deal regressed out of
      // delivered, or moved to lost, must never sit here. Every
      // delivered-unfunded deal is uncollected money — no threshold, oldest
      // first, true count on the wire.
      const unfunded = await c.query<{
        deal_id: string; lead_id: string | null; customer: string | null;
        funding_status: string; days: number; total: number;
      }>(
        `SELECT d.id AS deal_id, d.lead_id, ${CUSTOMER_SQL} AS customer,
                d.funding_status,
                floor(extract(epoch FROM (now() - COALESCE(d.delivered_at, d.created_at))) / 86400)::int AS days,
                count(*) OVER ()::int AS total
         FROM deals d
         LEFT JOIN contacts ct ON ct.id = d.contact_id
         LEFT JOIN leads l ON l.id = d.lead_id
         WHERE d.organization_id = $1 AND d.deleted_at IS NULL
           AND d.pipeline_stage IN ('delivered','complete')
           AND d.funding_status <> 'funded'
           AND ${scoped('d', 2)}
         ORDER BY COALESCE(d.delivered_at, d.created_at) ASC
         LIMIT 10`,
        [orgId, storeScope],
      );

      const byStageTotal = OPEN_STAGES.reduce((acc, st) => acc + (byStage.get(st) ?? 0), 0);
      return {
        month: { timezone: tz, start: monthStart.toISOString() },
        pipeline: {
          total: byStageTotal,
          by_stage: OPEN_STAGES.map((st) => ({ stage: st, count: byStage.get(st) ?? 0 })),
        },
        funding_by_status: FUNDING_STATUSES.map((st) => ({
          status: st,
          count: byFunding.get(st) ?? 0,
        })),
        month_sales: {
          units: s.units,
          gross_cents: Number(s.gross),
          avg_front_gross_cents: s.avg_front === null ? null : Number(s.avg_front),
          avg_back_gross_cents: s.avg_back === null ? null : Number(s.avg_back),
        },
        funding: {
          count: funding.rows[0]!.count,
          amount_financed_cents: Number(funding.rows[0]!.amount),
        },
        inventory: {
          in_stock: i.in_stock,
          over_30_days: i.over_30,
          aging_0_30: i.a0,
          aging_31_60: i.a31,
          aging_over_60: i.a60,
        },
        leads: {
          created: lead.created,
          converted: lead.converted,
          conversion_rate: pct1dp(lead.converted, lead.created),
        },
        lead_sources: sources.rows.map((r) => ({
          source: r.source as GmDashboardReportT['lead_sources'][number]['source'],
          count: r.count,
        })),
        salespeople: { rows: sellerRows, unattributed_units: unattributed },
        attention: {
          rotting: {
            count: rotting.rows[0]?.total ?? 0,
            rows: rotting.rows.map((r) => ({
              deal_id: r.deal_id,
              lead_id: r.lead_id,
              customer: r.customer,
              stage: r.stage as GmDashboardReportT['attention']['rotting']['rows'][number]['stage'],
              days_in_stage: r.days,
            })),
          },
          delivered_unfunded: {
            count: unfunded.rows[0]?.total ?? 0,
            rows: unfunded.rows.map((r) => ({
              deal_id: r.deal_id,
              lead_id: r.lead_id,
              customer: r.customer,
              funding_status:
                r.funding_status as GmDashboardReportT['attention']['delivered_unfunded']['rows'][number]['funding_status'],
              days_since_delivery: r.days,
            })),
          },
        },
      };
    });
    return reply.send(report);
  });
}
