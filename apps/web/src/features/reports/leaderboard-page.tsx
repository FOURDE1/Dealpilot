import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { NavLink } from 'react-router';
import { Label, Select } from '@dealpilot/ui';
import { LeaderboardReport, type LeaderboardQueryT, type LeaderboardReportT } from '@dealpilot/schemas';
import { rateResponse } from '@dealpilot/core';
import { usePageTitle } from '../../shared/use-page-title.js';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';
import { useOrganizations } from '../organizations/api.js';

/**
 * F-66 — the salesperson leaderboard (reports-analytics.md §10). Ranks are
 * server-sorted; the medals are decoration over an explicit rank number,
 * and the response badge reuses the lead module's 5/15/30 bands — the
 * legacy showed a 1h/4h scale here that contradicted its own SLA page.
 */

const PERIODS = ['30d', '90d', '6m', '1y', 'all'] as const;
const SORTS = ['gross', 'deals', 'conversion', 'response', 'leads'] as const;
const MEDALS = ['🥇', '🥈', '🥉'];

function useLeaderboard(orgId: string | undefined, period: LeaderboardQueryT['period'], sort: LeaderboardQueryT['sort']) {
  return useQuery({
    queryKey: ['leaderboard', orgId ?? 'single-org', period, sort],
    enabled: orgId !== undefined,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.sourceCosts.leaderboard, {
        query: { organization_id: orgId, period, sort },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return LeaderboardReport.parse(res.body);
    },
  });
}

const RESPONSE_TONE: Record<string, string> = {
  excellent: 'bg-success-bg text-success-text',
  good: 'bg-success-bg text-success-text',
  fair: 'bg-warning-bg text-warning-text',
  slow: 'bg-danger-bg text-danger-text',
};

export function LeaderboardPage() {
  const { t, i18n } = useTranslation('reports');
  usePageTitle(t('lb_title'));
  const orgs = useOrganizations();
  const [orgFilter, setOrgFilter] = useState('');
  const multiOrg = (orgs.data?.items.length ?? 0) > 1;
  const effectiveOrg = multiOrg ? orgFilter || orgs.data?.items[0]?.id : orgs.data?.items[0]?.id;
  const [period, setPeriod] = useState<LeaderboardQueryT['period']>('90d');
  const [sort, setSort] = useState<LeaderboardQueryT['sort']>('gross');

  const reportQ = useLeaderboard(effectiveOrg, period, sort);
  const forbidden = reportQ.isError && (reportQ.error as { status?: number } | null)?.status === 403;

  const money = (cents: number) =>
    (cents / 100).toLocaleString(i18n.language, { style: 'currency', currency: 'CAD' });
  const fmtNum = (v: number) => v.toLocaleString(i18n.language);
  const minutes = (s: number) => Math.round(s / 60);

  const responseBadge = (avg: number | null) => {
    if (avg === null) return <span className="text-muted-foreground">—</span>;
    const rating = rateResponse(avg);
    return (
      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${RESPONSE_TONE[rating] ?? ''}`}>
        {t('lb_minutes', { value: fmtNum(minutes(avg)) })} · {t(`lb_band_${rating}`)}
      </span>
    );
  };

  const body = (report: LeaderboardReportT) => (
    <section aria-labelledby="lb-table" className="space-y-2">
      <h2 id="lb-table" className="sr-only">{t('lb_title')}</h2>
      {report.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('wl_empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full max-w-5xl text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3">{t('lb_rank')}</th>
                <th className="py-2 pr-3">{t('lb_salesperson')}</th>
                <th className="py-2 pr-3 text-right">{t('lb_deals')}</th>
                <th className="py-2 pr-3 text-right">{t('lb_closed')}</th>
                <th className="py-2 pr-3 text-right">{t('lb_sales')}</th>
                <th className="py-2 pr-3 text-right">{t('lb_gross')}</th>
                <th className="py-2 pr-3 text-right">{t('lb_fi')}</th>
                <th className="py-2 pr-3 text-right">{t('lb_leads')}</th>
                <th className="py-2 pr-3 text-right">{t('lb_conversion')}</th>
                <th className="py-2 text-right">{t('lb_response')}</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r, i) => (
                <tr key={r.user_id} className={`border-b border-border ${i % 2 === 1 ? 'bg-muted/40' : ''}`}>
                  <td className="py-2 pr-3 tabular-nums">
                    {i + 1}
                    {i < 3 ? <span aria-hidden="true"> {MEDALS[i]}</span> : null}
                  </td>
                  <td className="py-2 pr-3 font-medium">{r.name}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(r.deals)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(r.closed_deals)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(r.total_sales_cents)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-success-text">{money(r.gross_profit_cents)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(r.fi_reserve_cents)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(r.total_leads)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{t('wl_pct', { value: fmtNum(r.conversion_rate) })}</td>
                  <td className="py-2 text-right">{responseBadge(r.avg_response_seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3 gap-y-2">
        <h1 className="text-2xl font-semibold">{t('lb_title')}</h1>
      </header>
      <nav aria-label={t('nav_reports')} className="flex gap-2 text-sm">
        <NavLink to="/analytics/win-loss" className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">
          {t('wl_title')}
        </NavLink>
        <NavLink to="/analytics/source-roi" className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">
          {t('roi_title')}
        </NavLink>
        <span aria-current="page" className="rounded-md border border-border bg-muted px-3 py-1.5 font-medium">
          {t('lb_title')}
        </span>
      </nav>
      <p className="max-w-2xl text-sm text-muted-foreground">{t('lb_subtitle')}</p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="lb-period">{t('wl_period')}</Label>
          <Select id="lb-period" value={period} onChange={(e) => setPeriod(e.target.value as LeaderboardQueryT['period'])}>
            {PERIODS.map((p) => (
              <option key={p} value={p}>{t(`wl_period_${p}`)}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="lb-sort">{t('lb_sort')}</Label>
          <Select id="lb-sort" value={sort} onChange={(e) => setSort(e.target.value as LeaderboardQueryT['sort'])}>
            {SORTS.map((s) => (
              <option key={s} value={s}>{t(`lb_sort_${s}`)}</option>
            ))}
          </Select>
        </div>
        {multiOrg ? (
          <div className="max-w-xs space-y-1">
            <Label htmlFor="lb-org">{t('wl_organization')}</Label>
            <Select id="lb-org" value={effectiveOrg ?? ''} onChange={(e) => setOrgFilter(e.target.value)}>
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
