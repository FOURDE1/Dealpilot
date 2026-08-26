import { useState } from 'react';
import { NavLink } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Label, Select } from '@dealpilot/ui';
import { WinLossReport, type WinLossQueryT, type WinLossReportT } from '@dealpilot/schemas';
import { lostReasonLabel } from '@dealpilot/core';
import { usePageTitle } from '../../shared/use-page-title.js';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';
import { useOrganizations } from '../organizations/api.js';
import { LEAD_SOURCE_KEYS } from '../leads/labels.js';

/**
 * F-55 — win/loss analytics (reports-analytics.md §9). Numbers, not
 * pictures: the bars are plain divs — a horizontal bar is a width, and a
 * charting dependency is a decision this page does not need. Every count
 * is also text, so nothing is conveyed by geometry alone.
 */

const PERIODS: WinLossQueryT['period'][] = ['30d', '90d', '6m', '1y', 'all'];

function useWinLoss(orgId: string | undefined, period: WinLossQueryT['period']) {
  return useQuery({
    queryKey: ['win-loss', orgId ?? 'single-org', period],
    enabled: orgId !== undefined,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.analytics.winLoss, {
        query: { organization_id: orgId, period },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return WinLossReport.parse(res.body);
    },
  });
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  const toneClass =
    tone === 'good' ? 'text-success-text' : tone === 'bad' ? 'text-danger-text' : '';
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`text-3xl font-bold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}

function Bar({ share, className }: { share: number; className: string }) {
  return (
    <div aria-hidden="true" className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div className={`h-full ${className}`} style={{ width: `${Math.max(share, 2)}%` }} />
    </div>
  );
}

export function WinLossPage() {
  const { t, i18n } = useTranslation('reports');
  const { t: tLeads } = useTranslation('leads');
  usePageTitle(t('wl_title'));
  const orgs = useOrganizations();
  const [orgFilter, setOrgFilter] = useState('');
  const multiOrg = (orgs.data?.items.length ?? 0) > 1;
  const effectiveOrg = multiOrg ? orgFilter || orgs.data?.items[0]?.id : orgs.data?.items[0]?.id;
  const [period, setPeriod] = useState<WinLossQueryT['period']>('90d');

  const reportQ = useWinLoss(effectiveOrg, period);
  const forbidden =
    reportQ.isError && (reportQ.error as { status?: number } | null)?.status === 403;

  const fmtNum = (v: number) => v.toLocaleString(i18n.language);
  const fmtRate = (v: number | null) =>
    v === null ? '—' : t('wl_pct', { value: fmtNum(v) });
  const monthLabel = (iso: string) =>
    new Date(`${iso}-02T00:00:00`).toLocaleDateString(i18n.language, { year: 'numeric', month: 'long' });

  const body = (report: WinLossReportT) => {
    const best = report.source_performance.reduce<WinLossReportT['source_performance'][number] | null>(
      (acc, x) => ((x.win_rate ?? -1) > (acc?.win_rate ?? -1) ? x : acc),
      null,
    );
    const worst = report.source_performance.reduce<WinLossReportT['source_performance'][number] | null>(
      (acc, x) =>
        x.win_rate !== null && (acc === null || (acc.win_rate ?? 101) > x.win_rate) ? x : acc,
      null,
    );
    const maxMonthly = Math.max(1, ...report.monthly_trend.map((m) => m.won + m.lost));
    return (
      <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label={t('wl_total')} value={fmtNum(report.summary.total)} />
          <StatCard label={t('wl_won')} value={fmtNum(report.summary.won)} tone="good" />
          <StatCard label={t('wl_lost')} value={fmtNum(report.summary.lost)} tone="bad" />
          <StatCard label={t('wl_open')} value={fmtNum(report.summary.open)} />
          <StatCard
            label={t('wl_winRate')}
            value={fmtRate(report.summary.win_rate)}
            tone={
              report.summary.win_rate === null
                ? undefined
                : report.summary.win_rate >= 50
                  ? 'good'
                  : 'bad'
            }
          />
        </div>

        <section aria-labelledby="wl-reasons" className="space-y-2">
          <h2 id="wl-reasons" className="text-lg font-semibold">
            {t('wl_reasonsTitle')}
          </h2>
          {report.lost_reasons.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('wl_noLosses')}</p>
          ) : (
            <ul className="max-w-2xl space-y-2">
              {report.lost_reasons.map((r) => (
                <li key={r.id ?? 'none'} className="space-y-1 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span>
                      <span aria-hidden="true">{r.icon}</span>{' '}
                      {r.id === null ? t('wl_unknownReason') : lostReasonLabel(r, i18n.language)}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {fmtNum(r.count)} · {t('wl_pct', { value: fmtNum(r.percentage) })}
                    </span>
                  </div>
                  <Bar share={r.percentage} className="bg-danger-border" />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="wl-trend" className="space-y-2">
          <h2 id="wl-trend" className="text-lg font-semibold">
            {t('wl_trendTitle')}
          </h2>
          {report.monthly_trend.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('wl_empty')}</p>
          ) : (
            <ul className="max-w-2xl space-y-2">
              {report.monthly_trend.map((m) => (
                <li key={m.month} className="space-y-1 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span>{monthLabel(m.month)}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {t('wl_monthCounts', { won: m.won, lost: m.lost })} · {fmtRate(m.win_rate)}
                    </span>
                  </div>
                  <div aria-hidden="true" className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-success" style={{ width: `${(m.won / maxMonthly) * 100}%` }} />
                    <div className="h-full bg-danger-border" style={{ width: `${(m.lost / maxMonthly) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="wl-sources" className="space-y-2">
          <h2 id="wl-sources" className="text-lg font-semibold">
            {t('wl_sourcesTitle')}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full max-w-2xl text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">{t('wl_source')}</th>
                  <th className="py-2 pr-3 text-right">{t('wl_total')}</th>
                  <th className="py-2 pr-3 text-right">{t('wl_won')}</th>
                  <th className="py-2 pr-3 text-right">{t('wl_lost')}</th>
                  <th className="py-2 text-right">{t('wl_winRate')}</th>
                </tr>
              </thead>
              <tbody>
                {report.source_performance.map((x) => {
                  const isBest = best !== null && x.source === best.source && x.win_rate !== null;
                  const isWorst =
                    worst !== null && x.source === worst.source && best?.source !== worst.source;
                  return (
                    <tr
                      key={x.source}
                      className={`border-b border-border ${isBest ? 'bg-success-bg' : isWorst ? 'bg-danger-bg' : ''}`}
                    >
                      <td className="py-2 pr-3">
                        {tLeads(LEAD_SOURCE_KEYS[x.source])}
                        {isBest ? <span className="sr-only"> — {t('wl_best')}</span> : null}
                        {isWorst ? <span className="sr-only"> — {t('wl_worst')}</span> : null}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(x.total)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(x.won)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(x.lost)}</td>
                      <td className="py-2 text-right tabular-nums">{fmtRate(x.win_rate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </>
    );
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3 gap-y-2">
        <h1 className="text-2xl font-semibold">{t('wl_title')}</h1>
      </header>
      <nav aria-label={t('nav_reports')} className="flex gap-2 text-sm">
        <span aria-current="page" className="rounded-md border border-border bg-muted px-3 py-1.5 font-medium">
          {t('wl_title')}
        </span>
        <NavLink to="/analytics/source-roi" className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">
          {t('roi_title')}
        </NavLink>
        <NavLink to="/analytics/leaderboard" className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">
          {t('lb_title')}
        </NavLink>
      </nav>
      <p className="max-w-2xl text-sm text-muted-foreground">{t('wl_subtitle')}</p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="wl-period">{t('wl_period')}</Label>
          <Select
            id="wl-period"
            value={period}
            onChange={(e) => setPeriod(e.target.value as WinLossQueryT['period'])}
          >
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {t(`wl_period_${p}`)}
              </option>
            ))}
          </Select>
        </div>
        {multiOrg ? (
          <div className="max-w-xs space-y-1">
            <Label htmlFor="wl-org">{t('wl_organization')}</Label>
            <Select id="wl-org" value={effectiveOrg ?? ''} onChange={(e) => setOrgFilter(e.target.value)}>
              {orgs.data?.items.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>

      {orgs.isError ? (
        <p role="alert" className="text-sm text-danger-text">
          {t('wl_error')}
        </p>
      ) : orgs.isSuccess && !effectiveOrg ? (
        <p className="text-sm text-muted-foreground">{t('wl_empty')}</p>
      ) : reportQ.isPending || orgs.isPending ? (
        <p aria-busy="true" className="text-sm text-muted-foreground">
          {t('wl_loading')}
        </p>
      ) : forbidden ? (
        <p className="text-sm text-muted-foreground">{t('wl_forbidden')}</p>
      ) : reportQ.isError ? (
        <p role="alert" className="text-sm text-danger-text">
          {t('wl_error')}
        </p>
      ) : (
        body(reportQ.data)
      )}
    </div>
  );
}
