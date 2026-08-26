import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { NavLink } from 'react-router';
import { Label, Select } from '@dealpilot/ui';
import { HeatmapReport, type HeatmapQueryT, type HeatmapReportT } from '@dealpilot/schemas';
import { usePageTitle } from '../../shared/use-page-title.js';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';
import { useOrganizations } from '../organizations/api.js';

/**
 * F-67 — the activity heatmap (reports-analytics.md §11 Target). A 7×24
 * grid: intensity is a five-step scale of count/max, and every busy cell
 * ALSO carries its numbers as text — color is the glance, text is the
 * fact. Best contact times rank by replies received.
 *
 * It is a real table: row and column headers name the day and the hour,
 * so a cell's own content is just its numbers (a screen reader already
 * announced the headers), and empty cells are simply empty rather than
 * 168 announcements of nothing (review).
 */

const PERIODS = ['30d', '90d', '6m', '1y', 'all'] as const;
const DIRECTIONS = ['inbound', 'outbound'] as const;
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const DAYS = [1, 2, 3, 4, 5, 6, 0]; // Monday-first for a dealership week
/**
 * Fill AND ink per step. The busiest cells sit on the solid success color,
 * where the page foreground fails contrast in the dark theme (1.7:1); the
 * token layer's `success-foreground` is the pair the contrast test gates.
 */
const STEPS = [
  'bg-muted text-muted-foreground',
  'bg-success/20 text-foreground',
  'bg-success/40 text-foreground',
  'bg-success/60 text-success-foreground',
  'bg-success/80 text-success-foreground',
  'bg-success text-success-foreground',
];
// Typed keys: the i18n resource types refuse a template-literal key.
const DAY_KEYS = ['hm_day_0', 'hm_day_1', 'hm_day_2', 'hm_day_3', 'hm_day_4', 'hm_day_5', 'hm_day_6'] as const;

function useHeatmap(orgId: string | undefined, period: HeatmapQueryT['period'], direction: HeatmapQueryT['direction'] | undefined) {
  return useQuery({
    queryKey: ['activity-heatmap', orgId ?? 'single-org', period, direction],
    enabled: orgId !== undefined,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.sourceCosts.heatmap, {
        query: { organization_id: orgId, period, ...(direction ? { direction } : {}) },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return HeatmapReport.parse(res.body);
    },
  });
}

export function HeatmapPage() {
  const { t, i18n } = useTranslation('reports');
  usePageTitle(t('hm_title'));
  const orgs = useOrganizations();
  const [orgFilter, setOrgFilter] = useState('');
  const multiOrg = (orgs.data?.items.length ?? 0) > 1;
  const effectiveOrg = multiOrg ? orgFilter || orgs.data?.items[0]?.id : orgs.data?.items[0]?.id;
  const [period, setPeriod] = useState<HeatmapQueryT['period']>('90d');
  const [direction, setDirection] = useState<HeatmapQueryT['direction'] | undefined>(undefined);

  const reportQ = useHeatmap(effectiveOrg, period, direction);
  const forbidden = reportQ.isError && (reportQ.error as { status?: number } | null)?.status === 403;
  const fmtNum = (v: number) => v.toLocaleString(i18n.language);
  const day = (d: number) => t(DAY_KEYS[d] ?? 'hm_day_0');

  const body = (report: HeatmapReportT) => {
    const byKey = new Map(report.cells.map((c) => [`${c.dow}:${c.hour}`, c]));
    const step = (n: number) =>
      report.max_count === 0 ? 0 : Math.min(5, Math.ceil((n / report.max_count) * 5));
    return (
      <>
        <p className="text-xs text-muted-foreground">{t('hm_timezone', { tz: report.timezone })}</p>
        <div className="grid grid-cols-2 gap-3 md:max-w-sm">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('hm_inbound')}</p>
            <p className="text-3xl font-bold tabular-nums">{fmtNum(report.totals.inbound)}</p>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('hm_outbound')}</p>
            <p className="text-3xl font-bold tabular-nums">{fmtNum(report.totals.outbound)}</p>
          </div>
        </div>

        {report.cells.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('hm_noActivity')}</p>
        ) : (
          <>
            <section aria-labelledby="hm-best" className="space-y-2">
              <h2 id="hm-best" className="text-lg font-semibold">{t('hm_bestTimes')}</h2>
              {report.best_times.length === 0 ? (
                // Nothing received in the cut (a sent-only filter, or a period
                // with no replies) — say so instead of heading an empty list.
                <p className="text-sm text-muted-foreground">{t('hm_noReplies')}</p>
              ) : (
                <ol className="list-decimal pl-5 text-sm">
                  {report.best_times.map((s: HeatmapReportT['best_times'][number]) => (
                    <li key={`${s.dow}:${s.hour}`}>
                      {t('hm_slot', { day: day(s.dow), hour: s.hour, count: s.inbound })}
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section aria-labelledby="hm-grid" className="space-y-2">
              <h2 id="hm-grid" className="sr-only">{t('hm_title')}</h2>
              <div className="overflow-x-auto">
                <table className="text-xs">
                  <thead>
                    <tr>
                      <th scope="col" className="pr-2 text-left font-normal text-muted-foreground">
                        <span className="sr-only">{t('hm_corner')}</span>
                      </th>
                      {HOURS.map((h) => (
                        <th key={h} scope="col" className="w-6 text-center font-normal text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {DAYS.map((d) => (
                      <tr key={d}>
                        <th scope="row" className="pr-2 text-left font-medium">
                          <span aria-hidden="true">{day(d).slice(0, 3)}</span>
                          <span className="sr-only">{day(d)}</span>
                        </th>
                        {HOURS.map((h) => {
                          const cell = byKey.get(`${d}:${h}`);
                          const inbound = cell?.inbound ?? 0;
                          const outbound = cell?.outbound ?? 0;
                          const total = inbound + outbound;
                          return (
                            <td key={h} className="p-0.5">
                              <div
                                title={total > 0 ? t('hm_cell', { day: day(d), hour: h, inbound, outbound }) : undefined}
                                className={`flex h-6 w-6 items-center justify-center rounded-sm text-[10px] tabular-nums ${STEPS[step(total)]}`}
                              >
                                {total > 0 ? (
                                  <>
                                    <span aria-hidden="true">{total}</span>
                                    <span className="sr-only">{t('hm_breakdown', { inbound, outbound })}</span>
                                  </>
                                ) : null}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </>
    );
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3 gap-y-2">
        <h1 className="text-2xl font-semibold">{t('hm_title')}</h1>
      </header>
      <nav aria-label={t('nav_reports')} className="flex flex-wrap gap-2 text-sm">
        <NavLink to="/analytics/win-loss" className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">{t('wl_title')}</NavLink>
        <NavLink to="/analytics/source-roi" className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">{t('roi_title')}</NavLink>
        <NavLink to="/analytics/leaderboard" className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">{t('lb_title')}</NavLink>
        <span aria-current="page" className="rounded-md border border-border bg-muted px-3 py-1.5 font-medium">{t('hm_title')}</span>
      </nav>
      <p className="max-w-2xl text-sm text-muted-foreground">{t('hm_subtitle')}</p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="hm-period">{t('wl_period')}</Label>
          <Select id="hm-period" value={period} onChange={(e) => setPeriod(e.target.value as HeatmapQueryT['period'])}>
            {PERIODS.map((p) => (
              <option key={p} value={p}>{t(`wl_period_${p}`)}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="hm-direction">{t('hm_direction')}</Label>
          <Select
            id="hm-direction"
            value={direction ?? ''}
            onChange={(e) => setDirection((e.target.value || undefined) as HeatmapQueryT['direction'] | undefined)}
          >
            <option value="">{t('hm_direction_all')}</option>
            {DIRECTIONS.map((d) => (
              <option key={d} value={d}>{t(`hm_direction_${d}`)}</option>
            ))}
          </Select>
        </div>
        {multiOrg ? (
          <div className="max-w-xs space-y-1">
            <Label htmlFor="hm-org">{t('wl_organization')}</Label>
            <Select id="hm-org" value={effectiveOrg ?? ''} onChange={(e) => setOrgFilter(e.target.value)}>
              {orgs.data?.items.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>

      {orgs.isError ? (
        <p role="alert" className="text-sm text-danger-text">{t('wl_error')}</p>
      ) : orgs.isSuccess && !effectiveOrg ? (
        <p className="text-sm text-muted-foreground">{t('wl_empty')}</p>
      ) : reportQ.isPending || orgs.isPending ? (
        <p aria-busy="true" className="text-sm text-muted-foreground">{t('wl_loading')}</p>
      ) : forbidden ? (
        <p className="text-sm text-muted-foreground">{t('wl_forbidden')}</p>
      ) : reportQ.isError ? (
        <p role="alert" className="text-sm text-danger-text">{t('wl_error')}</p>
      ) : (
        body(reportQ.data)
      )}
    </div>
  );
}
