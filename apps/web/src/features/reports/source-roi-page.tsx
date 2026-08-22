import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink } from 'react-router';
import { Button, Input, Label, Select } from '@dealpilot/ui';
import {
  SourceRoiReport,
  LEAD_SOURCES,
  type SourceRoiReportT,
} from '@dealpilot/schemas';
import { usePageTitle } from '../../shared/use-page-title.js';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';
import { useOrganizations, useStores } from '../organizations/api.js';
import { LEAD_SOURCE_KEYS } from '../leads/labels.js';

/**
 * F-65 — source ROI (reports-analytics.md §8) + the spend ledger that feeds
 * it (expenses-accounting.md §10). Same shape as its win/loss sibling:
 * numbers over pictures, every value also text. ROI badges follow the
 * spec's bands (≥200% strong, ≥0% breakeven-plus, <0% losing) — with the
 * band ALSO named in text, never color alone.
 */

const PERIODS = ['30d', '90d', '6m', '1y', 'all'] as const;
type Period = (typeof PERIODS)[number];

function useSourceRoi(orgId: string | undefined, period: Period) {
  return useQuery({
    queryKey: ['source-roi', orgId ?? 'single-org', period],
    enabled: orgId !== undefined,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.sourceCosts.roi, {
        query: { organization_id: orgId, period },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return SourceRoiReport.parse(res.body);
    },
  });
}

function RoiBadge({
  roi,
  noSpendLabel,
  bandLabels,
  locale,
}: {
  roi: number | null;
  noSpendLabel: string;
  bandLabels: { strong: string; positive: string; negative: string };
  locale: string;
}) {
  if (roi === null) {
    return <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{noSpendLabel}</span>;
  }
  // The band is NAMED, not just colored — color alone conveys nothing to a
  // fifth of the room (WCAG 1.4.1).
  const [tone, band] =
    roi >= 200
      ? ['bg-success-bg text-success-text', bandLabels.strong]
      : roi >= 0
        ? ['bg-warning-bg text-warning-text', bandLabels.positive]
        : ['bg-danger-bg text-danger-text', bandLabels.negative];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${tone}`}>
      {roi.toLocaleString(locale)}% · {band}
    </span>
  );
}

export function SourceRoiPage() {
  const { t, i18n } = useTranslation('reports');
  const { t: tLeads } = useTranslation('leads');
  usePageTitle(t('roi_title'));
  const orgs = useOrganizations();
  const queryClient = useQueryClient();
  const [orgFilter, setOrgFilter] = useState('');
  const multiOrg = (orgs.data?.items.length ?? 0) > 1;
  const effectiveOrg = multiOrg ? orgFilter || orgs.data?.items[0]?.id : orgs.data?.items[0]?.id;
  const [period, setPeriod] = useState<Period>('90d');

  const [spendSource, setSpendSource] = useState<string>('website');
  // LOCAL month, not toISOString(): after 20:00 Eastern on a month's last
  // day the UTC month is already next month (review) — spend entered that
  // evening would land in the wrong bucket.
  const [spendMonth, setSpendMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [spendStore, setSpendStore] = useState('');
  const [spendDollars, setSpendDollars] = useState('');
  const stores = useStores(effectiveOrg ?? '');

  const reportQ = useSourceRoi(effectiveOrg, period);
  const forbidden = reportQ.isError && (reportQ.error as { status?: number } | null)?.status === 403;

  const save = useMutation({
    mutationFn: async () => {
      const cents = Math.round(Number(spendDollars) * 100);
      const res = await apiRequest(routes.sourceCosts.upsert, {
        body: {
          organization_id: effectiveOrg!,
          source: spendSource,
          month: spendMonth,
          spend_cents: Number.isFinite(cents) && cents >= 0 ? cents : 0,
          ...(spendStore ? { store_id: spendStore } : {}),
        },
      });
      if (res.status !== 201) fail(res.status, res.body);
    },
    onSuccess: () => {
      setSpendDollars('');
      void queryClient.invalidateQueries({ queryKey: ['source-roi'] });
    },
  });

  const money = (cents: number) =>
    (cents / 100).toLocaleString(i18n.language, { style: 'currency', currency: 'CAD' });
  const fmtNum = (v: number) => v.toLocaleString(i18n.language);
  const monthLabel = (iso: string) =>
    new Date(`${iso}-02T00:00:00`).toLocaleDateString(i18n.language, { year: 'numeric', month: 'long' });
  const sourceLabel = (s: string) =>
    s === 'unknown' ? t('roi_unknownSource') : tLeads(LEAD_SOURCE_KEYS[s as keyof typeof LEAD_SOURCE_KEYS] ?? s);

  const body = (report: SourceRoiReportT) => (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('roi_totalLeads')}</p>
          <p className="text-3xl font-bold tabular-nums">{fmtNum(report.totals.total_leads)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('roi_converted')}</p>
          <p className="text-3xl font-bold tabular-nums">{fmtNum(report.totals.total_converted)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('roi_spend')}</p>
          <p className="text-3xl font-bold tabular-nums">{money(report.totals.total_spend_cents)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('roi_revenue')}</p>
          <p className="text-3xl font-bold tabular-nums">{money(report.totals.total_revenue_cents)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('roi_overall')}</p>
          <p className="text-3xl font-bold tabular-nums">
            <RoiBadge roi={report.totals.overall_roi} noSpendLabel={t('roi_noSpend')} bandLabels={{ strong: t('roi_band_strong'), positive: t('roi_band_positive'), negative: t('roi_band_negative') }} locale={i18n.language} />
          </p>
        </div>
      </div>

      <section aria-labelledby="roi-sources" className="space-y-2">
        <h2 id="roi-sources" className="text-lg font-semibold">{t('roi_bySource')}</h2>
        <div className="overflow-x-auto">
          <table className="w-full max-w-4xl text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-3">{t('wl_source')}</th>
                <th className="py-2 pr-3 text-right">{t('roi_leads')}</th>
                <th className="py-2 pr-3 text-right">{t('roi_converted')}</th>
                <th className="py-2 pr-3 text-right">{t('roi_convRate')}</th>
                <th className="py-2 pr-3 text-right">{t('roi_spend')}</th>
                <th className="py-2 pr-3 text-right">{t('roi_costPerLead')}</th>
                <th className="py-2 text-right">{t('roi_roi')}</th>
              </tr>
            </thead>
            <tbody>
              {report.sources.map((s) => (
                <tr key={s.source} className="border-b border-border">
                  <td className="py-2 pr-3">{sourceLabel(s.source)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(s.total_leads)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(s.converted_leads)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{t('wl_pct', { value: fmtNum(s.conversion_rate) })}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(s.spend_cents)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{s.total_leads === 0 ? '—' : money(s.cost_per_lead_cents)}</td>
                  <td className="py-2 text-right"><RoiBadge roi={s.roi} noSpendLabel={t('roi_noSpend')} bandLabels={{ strong: t('roi_band_strong'), positive: t('roi_band_positive'), negative: t('roi_band_negative') }} locale={i18n.language} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="roi-monthly" className="space-y-2">
        <h2 id="roi-monthly" className="text-lg font-semibold">{t('roi_monthly')}</h2>
        {report.monthly.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('wl_empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full max-w-3xl text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">{t('roi_month')}</th>
                  <th className="py-2 pr-3">{t('wl_source')}</th>
                  <th className="py-2 pr-3 text-right">{t('roi_leads')}</th>
                  <th className="py-2 pr-3 text-right">{t('roi_spend')}</th>
                  <th className="py-2 text-right">{t('roi_roi')}</th>
                </tr>
              </thead>
              <tbody>
                {report.monthly.map((m) => (
                  <tr key={`${m.month}:${m.source}`} className="border-b border-border">
                    <td className="py-2 pr-3">{monthLabel(m.month)}</td>
                    <td className="py-2 pr-3">{sourceLabel(m.source)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(m.leads)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{money(m.spend_cents)}</td>
                    <td className="py-2 text-right"><RoiBadge roi={m.roi} noSpendLabel={t('roi_noSpend')} bandLabels={{ strong: t('roi_band_strong'), positive: t('roi_band_positive'), negative: t('roi_band_negative') }} locale={i18n.language} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3 gap-y-2">
        <h1 className="text-2xl font-semibold">{t('roi_title')}</h1>
      </header>
      <nav aria-label={t('nav_reports')} className="flex gap-2 text-sm">
        <NavLink to="/analytics/win-loss" className="rounded-md border border-border px-3 py-1.5 hover:bg-muted">
          {t('wl_title')}
        </NavLink>
        <span aria-current="page" className="rounded-md border border-border bg-muted px-3 py-1.5 font-medium">
          {t('roi_title')}
        </span>
      </nav>
      <p className="max-w-2xl text-sm text-muted-foreground">{t('roi_subtitle')}</p>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="roi-period">{t('wl_period')}</Label>
          <Select id="roi-period" value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
            {PERIODS.map((p) => (
              <option key={p} value={p}>{t(`wl_period_${p}`)}</option>
            ))}
          </Select>
        </div>
        {multiOrg ? (
          <div className="max-w-xs space-y-1">
            <Label htmlFor="roi-org">{t('wl_organization')}</Label>
            <Select id="roi-org" value={effectiveOrg ?? ''} onChange={(e) => setOrgFilter(e.target.value)}>
              {orgs.data?.items.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>

      <section aria-labelledby="roi-editor" className="max-w-2xl space-y-2 rounded-lg border border-border bg-card p-4">
        <h2 id="roi-editor" className="text-sm font-semibold">{t('roi_editorTitle')}</h2>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (effectiveOrg && spendDollars !== '') save.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="roi-src">{t('wl_source')}</Label>
            <Select id="roi-src" value={spendSource} onChange={(e) => setSpendSource(e.target.value)}>
              {LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>{tLeads(LEAD_SOURCE_KEYS[s])}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="roi-month">{t('roi_month')}</Label>
            {/* pattern carries browsers that fall back to a text input. */}
            <Input
              id="roi-month"
              type="month"
              pattern="[0-9]{4}-[0-9]{2}"
              value={spendMonth}
              onChange={(e) => setSpendMonth(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="roi-store">{t('roi_scope')}</Label>
            <Select id="roi-store" value={spendStore} onChange={(e) => setSpendStore(e.target.value)}>
              <option value="">{t('roi_orgWide')}</option>
              {stores.data?.items.map((st) => (
                <option key={st.id} value={st.id}>{st.name}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="roi-amount">{t('roi_amount')}</Label>
            <Input
              id="roi-amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={spendDollars}
              onChange={(e) => setSpendDollars(e.target.value)}
              required
            />
          </div>
          <Button type="submit" disabled={save.isPending || !effectiveOrg}>
            {save.isPending ? t('roi_saving') : t('roi_save')}
          </Button>
        </form>
        {save.isError ? (
          <p role="alert" className="text-sm text-danger-text">
            {(save.error as { status?: number } | null)?.status === 403 ? t('roi_saveForbidden') : t('wl_error')}
          </p>
        ) : null}
        {save.isSuccess ? <p className="text-sm text-success-text">{t('roi_saved')}</p> : null}
      </section>

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
