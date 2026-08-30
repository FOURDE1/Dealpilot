import { Link, useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Label, Select } from '@dealpilot/ui';
import { USAGE_GAUGES, USAGE_PERIODS, USAGE_WINDOW_METRICS, UsagePeriod, type UsageMetricT, type UsagePeriodT } from '@dealpilot/schemas';
import { BackLink } from '../../shared/ui/back-link.js';
import { usePageTitle } from '../../shared/use-page-title.js';
import { useAdminTenant, useAdminTenantUsage } from './api.js';
import { TIER_KEYS, USAGE_METRIC_KEYS } from './labels.js';

/**
 * F-73 — what one tenant used, for one window (admin-console.md §6).
 *
 * Two rules shape this page and neither is decoration.
 *
 * Every figure is rendered with its own caption, because seven of §6's names
 * were cut for having no producer and four survivors were renamed to stop them
 * claiming something the row cannot support. `members_who_acted` beside a bare
 * number reads as DAU to anyone who has ever seen an analytics dashboard; the
 * caption is the only thing standing between that reflex and a figure a
 * support rep repeats to a dealer.
 *
 * And the plan allowances are a description, never a limit. Nothing in this
 * product stops at `included_sms_segments` and nothing bills past it, so the
 * bars say "included", never "limite" or "restant", carry no threshold marker,
 * and going past one is drawn in the ordinary accent — a red bar would
 * announce an enforcement that does not exist. The server does the other half:
 * `allowances` comes back null outside the month to date, so this page is
 * never handed a monthly number to divide a ninety-day count by.
 */

const PERIOD_KEYS = { mtd: 'periodMtd', '30d': 'period30d', '90d': 'period90d' } as const satisfies Record<UsagePeriodT, string>;

/** The literal key union, so a bar can only ever be labelled by a real metric. */
type UsageMetricLabelKey = (typeof USAGE_METRIC_KEYS)[UsageMetricT]['label'];

interface AllowanceRowProps {
  labelKey: UsageMetricLabelKey;
  used: number;
  /** null = unlimited — the plan column permits NULL and means exactly that. */
  included: number | null;
  format: (n: number) => string;
}

/**
 * One allowance, and every case the plan table actually permits.
 *
 * `included_seats` is nullable and NULL means unlimited; `included_sms_segments`
 * and `included_ai_conversations` are CHECKed `>= 0`, so a plan row an owner
 * edits down to 0 is legal — and `used / 0` is Infinity. Neither case gets a
 * bar: a bar needs a denominator, and inventing one (a zero bar, or a bar
 * pinned at 100%) would say something about the plan the plan does not say.
 */
function AllowanceRow({ labelKey, used, included, format }: AllowanceRowProps) {
  const { t } = useTranslation('usage');
  const usedText = format(used);
  if (included === null) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium">{t(labelKey)}</p>
        <p className="text-sm tabular-nums">{usedText}</p>
        <p className="text-xs text-muted-foreground">{t('allowanceUnlimited')}</p>
      </div>
    );
  }
  if (included === 0) {
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium">{t(labelKey)}</p>
        <p className="text-sm tabular-nums">{usedText}</p>
        <p className="text-xs text-muted-foreground">{t('allowanceNone')}</p>
      </div>
    );
  }
  // The FILL is clamped so the bar stays a bar; the sentence beside it is not,
  // so a tenant past what the plan includes reads its real figure. Both
  // numbers are in text and `aria-valuetext` repeats them — the fill's length
  // and its colour are never the only place the state is written. The colour
  // is the ordinary accent in every case: a red bar past the allowance would
  // announce an enforcement this product does not have.
  const pct = Math.min(100, Math.round((used / included) * 100));
  const sentence = t('allowanceIncluded', { used: usedText, included: format(included) });
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">{t(labelKey)}</p>
      <div
        role="progressbar"
        aria-label={t(labelKey)}
        aria-valuemin={0}
        aria-valuemax={included}
        aria-valuenow={Math.min(used, included)}
        aria-valuetext={sentence}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-primary" style={{ inlineSize: `${pct}%` }} />
      </div>
      <p className="text-sm tabular-nums">{sentence}</p>
    </div>
  );
}

export function TenantUsagePage() {
  const { t, i18n } = useTranslation('usage');
  const { t: tAdmin } = useTranslation('admin');
  const { t: tOrgs } = useTranslation('orgs');
  const { tenantId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const parsed = UsagePeriod.safeParse(params.get('period'));
  const period: UsagePeriodT = parsed.success ? parsed.data : 'mtd';
  const tenant = useAdminTenant(tenantId);
  const usage = useAdminTenantUsage(tenantId, period);
  usePageTitle(t('title'));

  const number = (n: number) => new Intl.NumberFormat(i18n.language).format(n);
  const moment = (iso: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  /**
   * Bytes and seconds are quantities, not counts, and Intl already knows how
   * to say both in French and in English — a hand-rolled "1.2 MB" is wrong in
   * one of the two locales this product is legally obliged to serve.
   */
  const measure = (key: UsageMetricT, raw: number | null): string => {
    if (raw === null) return t('metricNotMeasured');
    if (key === 'document_bytes') {
      return new Intl.NumberFormat(i18n.language, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 }).format(raw / 1_000_000);
    }
    if (key === 'ai_first_touch_p95_seconds') {
      return new Intl.NumberFormat(i18n.language, { style: 'unit', unit: 'second', maximumFractionDigits: 0 }).format(raw);
    }
    return number(raw);
  };

  const metricRow = (key: UsageMetricT, raw: number | null) => (
    <div key={key} className="space-y-0.5">
      <dt className="text-sm text-muted-foreground">{t(USAGE_METRIC_KEYS[key].label)}</dt>
      <dd className="text-xl font-semibold tabular-nums">{measure(key, raw)}</dd>
      {/* The caption is part of the number, not a footnote: it is what stops
          the name from claiming more than the rows underneath it support. */}
      <dd className="text-xs text-muted-foreground">{t(USAGE_METRIC_KEYS[key].caption)}</dd>
    </div>
  );

  return (
    <div className="space-y-6">
      <BackLink to={`/admin/tenants/${tenantId}`}>{tAdmin('back')}</BackLink>
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        {tenant.data ? (
          <>
            <Link to={`/admin/tenants/${tenantId}`} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">
              {tenant.data.name}
            </Link>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{tOrgs(TIER_KEYS[tenant.data.plan_code])}</span>
          </>
        ) : null}
      </header>

      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => e.preventDefault()}>
        <div className="space-y-1">
          <Label htmlFor="usage-period">{t('periodLabel')}</Label>
          <Select
            id="usage-period"
            value={period}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              next.set('period', e.target.value);
              setParams(next, { replace: true });
            }}
          >
            {USAGE_PERIODS.map((p) => (
              <option key={p} value={p}>{t(PERIOD_KEYS[p])}</option>
            ))}
          </Select>
        </div>
      </form>

      {/* The window these figures are FOR, announced when the period changes:
          a number read without its window is this page's whole failure mode. */}
      <p role="status" className="text-sm text-muted-foreground">
        {usage.isSuccess ? t('windowLabel', { start: moment(usage.data.window_start), end: moment(usage.data.window_end) }) : ''}
      </p>

      {usage.isPending ? <p aria-busy="true" className="text-sm text-muted-foreground">{tAdmin('loading')}</p> : null}
      {usage.isError ? <p role="alert" className="text-sm text-danger-text">{tAdmin('loadError')}</p> : null}

      {usage.isSuccess ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section aria-labelledby="usage-gauges" className="space-y-3 rounded-lg border border-border bg-card p-4">
            <h2 id="usage-gauges" className="text-[15px] font-semibold">{t('gaugesHeading')}</h2>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {USAGE_GAUGES.map((key) => metricRow(key, usage.data.gauges[key]))}
            </dl>
          </section>

          <section aria-labelledby="usage-window" className="space-y-3 rounded-lg border border-border bg-card p-4">
            <h2 id="usage-window" className="text-[15px] font-semibold">{t('windowHeading')}</h2>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {USAGE_WINDOW_METRICS.map((key) => metricRow(key, usage.data.window_metrics[key]))}
            </dl>
          </section>

          <section aria-labelledby="usage-allowances" className="space-y-3 rounded-lg border border-border bg-card p-4 lg:col-span-2">
            <h2 id="usage-allowances" className="text-[15px] font-semibold">{t('allowancesHeading')}</h2>
            {usage.data.allowances === null ? (
              <p className="text-sm text-muted-foreground">{t('allowancesOnlyMtd')}</p>
            ) : (
              <>
                {/* Stated once, above the bars, and never conditional on how
                    full one is: what a tenant bought is a commercial fact, and
                    a bar that implied a stop would be a claim about a control
                    this product does not have. */}
                <p className="text-sm text-muted-foreground">{t('allowanceNotEnforced')}</p>
                {/* §5.1 prices one of the five allowances per rooftop; this
                    plan row is read per tenant and is NOT multiplied by
                    store_count, so the scope is stated rather than inferred. */}
                <p className="text-sm text-muted-foreground">{t('allowancePerTenant')}</p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <AllowanceRow
                    labelKey={USAGE_METRIC_KEYS.seats_provisioned.label}
                    used={usage.data.gauges.seats_provisioned}
                    included={usage.data.allowances.included_seats}
                    format={number}
                  />
                  <AllowanceRow
                    labelKey={USAGE_METRIC_KEYS.sms_segments.label}
                    used={usage.data.window_metrics.sms_segments}
                    included={usage.data.allowances.included_sms_segments}
                    format={number}
                  />
                  <AllowanceRow
                    labelKey={USAGE_METRIC_KEYS.ai_conversations_engaged.label}
                    used={usage.data.window_metrics.ai_conversations_engaged}
                    included={usage.data.allowances.included_ai_conversations}
                    format={number}
                  />
                </div>
              </>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
