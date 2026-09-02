import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { PIPELINE_STAGE_KEYS, FUNDING_STATUS_KEYS } from '../deals/labels.js';
import { formatCents } from '../deals/money.js';
import { LEAD_SOURCE_KEYS } from '../leads/labels.js';
import { useGmDashboard } from './api.js';

/**
 * F-78 — the GM Command Center (reports-analytics.md §14.1, FR-REP-003,
 * D-079): the floor-as-total tiles' successor. Every figure arrives
 * server-computed with the month window it was computed over; every tile
 * carries its caption saying what is counted, on which clock — captions
 * interpolate the WIRE's month block ({start}, {tz}), never a hardcoded
 * window. Rates are server quotients rendered AS SENT at 1 dp; nullable
 * figures render « — », never a fabricated 0. Bars are the O-42 chartless
 * kind: aria-hidden decoration with the numbers in text.
 */

function StatTile({ label, value, caption }: { label: string; value: string; caption: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-3xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{caption}</p>
    </div>
  );
}

/** Share-of-max bar: no denominator exists, so the fill is aria-hidden
 * decoration (never a progressbar) and the count lives in the text node. */
function DistributionRow({ label, count, max, num }: {
  label: string;
  count: number;
  max: number;
  num: (v: number) => string;
}) {
  const share = max === 0 ? 0 : Math.round((count / max) * 100);
  return (
    <li className="space-y-1 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span>{label}</span>
        <span className="tabular-nums">{num(count)}</span>
      </div>
      <div aria-hidden="true" className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary-text" style={{ inlineSize: `${share}%` }} />
      </div>
    </li>
  );
}

function BarGroup({ title, caption, children }: {
  title: string;
  caption: string;
  children: ReactNode;
}) {
  return (
    <div className="max-w-2xl space-y-2">
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {children}
      <p className="text-xs text-muted-foreground">{caption}</p>
    </div>
  );
}

export function GmReport({ orgId }: { orgId: string | undefined }) {
  const { t, i18n } = useTranslation('dashboard');
  const { t: tCommon } = useTranslation('common');
  const { t: tDeals } = useTranslation('deals');
  const { t: tLeads } = useTranslation('leads');
  const reportQ = useGmDashboard(orgId, { enabled: orgId !== undefined });

  if (orgId === undefined || reportQ.isPending) {
    return <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>;
  }
  if (reportQ.isError) {
    // The alert replaces the report only — the rest of the page never blanks.
    return (
      <p role="alert" className="text-sm text-danger-text">
        {t('reportError')}
      </p>
    );
  }
  const report = reportQ.data;

  const num = (v: number) => v.toLocaleString(i18n.language);
  const money = (cents: number) => formatCents(cents, i18n.language);
  const dash = t('noCustomer');
  // A14: the month start is a zone-anchored instant — format it ON the wire's
  // clock, or a viewer west of the store reads « 31 août » for a month the
  // SQL counts from 1 sept.
  const startText = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeZone: report.month.timezone,
  }).format(new Date(report.month.start));
  const clockArgs = { start: startText, tz: report.month.timezone };
  // A17: the server's 1 dp quotient rendered as sent — min/max 1 fraction
  // digit, fed rate/100. Never recomputed from the counts client-side.
  const percent = (rate: number) =>
    new Intl.NumberFormat(i18n.language, {
      style: 'percent',
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(rate / 100);

  const { month_sales: sales, attention } = report;
  const stageMax = Math.max(...report.pipeline.by_stage.map((r) => r.count));
  const fundingMax = Math.max(...report.funding_by_status.map((r) => r.count));
  const aging = [
    { key: 'aging0_30', count: report.inventory.aging_0_30 },
    { key: 'aging31_60', count: report.inventory.aging_31_60 },
    { key: 'aging60Plus', count: report.inventory.aging_over_60 },
  ] as const;
  const agingMax = Math.max(...aging.map((r) => r.count));
  const sourceMax = Math.max(0, ...report.lead_sources.map((r) => r.count));

  const customerCell = (row: { lead_id: string | null; customer: string | null }) =>
    row.lead_id !== null ? (
      <Link
        to={`/leads/${row.lead_id}`}
        className="font-medium text-primary-text hover:underline max-lg:inline-flex max-lg:min-h-11 max-lg:items-center"
      >
        {row.customer ?? dash}
      </Link>
    ) : (
      (row.customer ?? dash)
    );

  return (
    <div className="space-y-6">
      <section className="space-y-3" aria-labelledby="gm-figures-title">
        <header>
          <h2 id="gm-figures-title" className="text-lg font-semibold">
            {t('gmTitle')}
          </h2>
          <p className="text-xs text-muted-foreground">{t('monthWindow', clockArgs)}</p>
        </header>
        {/* One tile per row below sm: a two-column tile at 360 px leaves the
            value ~124 px while NBSP-bound money strings (which can never
            wrap) run past 160 px — the body would scroll sideways, which R7
            forbids. Pinned by f78-gm-dashboard.e2e.ts B7's 360 px probe.
            Money figures are never truncated or ellipsized. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label={t('statPipeline')}
            value={num(report.pipeline.total)}
            caption={t('capPipeline')}
          />
          <StatTile label={t('statUnits')} value={num(sales.units)} caption={t('capUnits', clockArgs)} />
          <StatTile label={t('statGross')} value={money(sales.gross_cents)} caption={t('capGross')} />
          <StatTile
            label={t('statAvgFront')}
            value={sales.avg_front_gross_cents === null ? dash : money(sales.avg_front_gross_cents)}
            caption={t('capAvgPerUnit')}
          />
          <StatTile
            label={t('statAvgBack')}
            value={sales.avg_back_gross_cents === null ? dash : money(sales.avg_back_gross_cents)}
            caption={t('capAvgPerUnit')}
          />
          <StatTile
            label={t('statFunding')}
            value={t('fundingValue', {
              count: num(report.funding.count),
              amount: money(report.funding.amount_financed_cents),
            })}
            caption={t('capFunding')}
          />
          <StatTile
            label={t('statStock')}
            value={num(report.inventory.in_stock)}
            caption={t('capStock')}
          />
          <StatTile
            label={t('statOver30')}
            value={num(report.inventory.over_30_days)}
            caption={t('capOver30', { tz: report.month.timezone })}
          />
          <StatTile
            label={t('statLeads')}
            value={num(report.leads.created)}
            caption={t('capLeads', clockArgs)}
          />
          <StatTile
            label={t('statConversion')}
            value={report.leads.conversion_rate === null ? dash : percent(report.leads.conversion_rate)}
            caption={t('capConversion')}
          />
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="gm-attention-title">
        <h2 id="gm-attention-title" className="text-lg font-semibold">
          {t('attentionTitle')}
        </h2>

        <div className="space-y-2">
          <h3 className="text-[15px] font-semibold">{t('rottingTitle')}</h3>
          {attention.rotting.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('emptyRotting')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full max-w-2xl text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3">{t('colCustomer')}</th>
                    <th className="py-2 pr-3">{t('colStage')}</th>
                    <th className="py-2 text-right">{t('colDays')}</th>
                  </tr>
                </thead>
                <tbody>
                  {attention.rotting.rows.map((r) => (
                    <tr key={r.deal_id} className="border-b border-border">
                      <td className="py-2 pr-3">{customerCell(r)}</td>
                      <td className="py-2 pr-3">{tDeals(PIPELINE_STAGE_KEYS[r.stage])}</td>
                      <td className="py-2 text-right tabular-nums">{num(r.days_in_stage)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {attention.rotting.count > 10 ? (
            <p className="text-sm text-muted-foreground">
              {t('rowsTotal', { count: attention.rotting.count })}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">{t('capRotting')}</p>
        </div>

        <div className="space-y-2">
          <h3 className="text-[15px] font-semibold">{t('unfundedTitle')}</h3>
          {attention.delivered_unfunded.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('emptyUnfunded')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full max-w-2xl text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3">{t('colCustomer')}</th>
                    <th className="py-2 pr-3">{t('colFunding')}</th>
                    <th className="py-2 text-right">{t('colDays')}</th>
                  </tr>
                </thead>
                <tbody>
                  {attention.delivered_unfunded.rows.map((r) => (
                    <tr key={r.deal_id} className="border-b border-border">
                      <td className="py-2 pr-3">{customerCell(r)}</td>
                      <td className="py-2 pr-3">{tDeals(FUNDING_STATUS_KEYS[r.funding_status])}</td>
                      <td className="py-2 text-right tabular-nums">{num(r.days_since_delivery)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {attention.delivered_unfunded.count > 10 ? (
            <p className="text-sm text-muted-foreground">
              {t('rowsTotal', { count: attention.delivered_unfunded.count })}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">{t('capUnfunded')}</p>
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="gm-distributions-title">
        <h2 id="gm-distributions-title" className="text-lg font-semibold">
          {t('distributionsTitle')}
        </h2>

        <BarGroup title={t('stageBarsTitle')} caption={t('capStageBars')}>
          <ul className="space-y-2">
            {report.pipeline.by_stage.map((r) => (
              <DistributionRow
                key={r.stage}
                label={tDeals(PIPELINE_STAGE_KEYS[r.stage])}
                count={r.count}
                max={stageMax}
                num={num}
              />
            ))}
          </ul>
        </BarGroup>

        <BarGroup title={t('fundingBarsTitle')} caption={t('capFundingBars')}>
          <ul className="space-y-2">
            {report.funding_by_status.map((r) => (
              <DistributionRow
                key={r.status}
                label={tDeals(FUNDING_STATUS_KEYS[r.status])}
                count={r.count}
                max={fundingMax}
                num={num}
              />
            ))}
          </ul>
        </BarGroup>

        <BarGroup title={t('agingTitle')} caption={t('capAging')}>
          <ul className="space-y-2">
            {aging.map((r) => (
              <DistributionRow key={r.key} label={t(r.key)} count={r.count} max={agingMax} num={num} />
            ))}
          </ul>
        </BarGroup>

        <BarGroup title={t('sourcesTitle')} caption={t('capSources')}>
          {report.lead_sources.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('emptySources')}</p>
          ) : (
            <ul className="space-y-2">
              {report.lead_sources.map((r) => (
                <DistributionRow
                  key={r.source}
                  label={tLeads(LEAD_SOURCE_KEYS[r.source])}
                  count={r.count}
                  max={sourceMax}
                  num={num}
                />
              ))}
            </ul>
          )}
        </BarGroup>

        <div className="space-y-2">
          <h3 className="text-[15px] font-semibold">{t('salespeopleTitle')}</h3>
          {report.salespeople.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('emptySalespeople')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full max-w-2xl text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3">{t('colSeller')}</th>
                    <th className="py-2 pr-3 text-right">{t('colUnits')}</th>
                    <th className="py-2 text-right">{t('colGross')}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.salespeople.rows.map((r) => (
                    <tr key={r.user_id} className="border-b border-border">
                      {/* A2: a seller with no active membership keeps the row
                          (the invariant needs it) — named by a placeholder,
                          never resolved from the global user table. */}
                      <td className="py-2 pr-3 font-medium">{r.name ?? t('formerSeller')}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{num(r.units)}</td>
                      <td className="py-2 text-right tabular-nums">{money(r.gross_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {report.salespeople.unattributed_units > 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('unattributedUnits', { count: report.salespeople.unattributed_units })}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">{t('capSalespeople')}</p>
        </div>
      </section>
    </div>
  );
}
