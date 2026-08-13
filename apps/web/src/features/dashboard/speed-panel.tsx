import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { SpeedToLeadSummary } from '@dealpilot/schemas';
import { apiRequest, failFromResponse as fail, routes } from '../../shared/api/client.js';
import { formatDuration, sloState, type SloState } from './speed.js';

/**
 * Speed to lead, on the first screen anybody sees (leads.md §5, ADR-025).
 *
 * The number is only useful if it is uncomfortable when it should be, so the
 * panel states the median plainly and colours the assistant's service level
 * against its own target rather than against a curve. A dashboard that always
 * looks fine is a dashboard nobody acts on.
 */

const SLO_CLASS: Record<SloState, string> = {
  meeting: 'bg-success-bg text-success-text',
  slipping: 'bg-warning-bg text-warning-text',
  breached: 'bg-danger-bg text-danger-text',
  unknown: 'bg-muted text-muted-foreground',
};

function useSpeedToLead(orgId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['speed-to-lead', orgId ?? 'single-org'],
    enabled,
    queryFn: async ({ signal }) => {
      const res = await apiRequest(routes.speedToLead.summary, {
        query: { organization_id: orgId, days: 30 },
        signal,
      });
      if (res.status !== 200) fail(res.status, res.body);
      return SpeedToLeadSummary.parse(res.body);
    },
  });
}

export function SpeedPanel({ orgId, enabled }: { orgId: string | undefined; enabled: boolean }) {
  const { t } = useTranslation('dashboard');
  const speed = useSpeedToLead(orgId, enabled);

  if (speed.isPending || speed.isError) return null;
  const s = speed.data;
  const total = s.contacted + s.uncontacted;
  if (total === 0) return null;

  const slo = sloState(s.ai_within_slo, s.ai_touches);
  const withinFive = s.by_rating.excellent;

  return (
    <section className="space-y-3" aria-labelledby="dash-speed-title">
      <h2 id="dash-speed-title" className="text-lg font-semibold">{t('speedTitle')}</h2>
      <p className="text-sm text-muted-foreground">{t('speedSubtitle')}</p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('speedMedian')}
          </p>
          <p className="text-3xl font-bold tabular-nums">
            {s.median_seconds === null ? '—' : formatDuration(s.median_seconds)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('speedUnderFive')}
          </p>
          <p className="text-3xl font-bold tabular-nums">{withinFive}</p>
          <p className="text-xs text-muted-foreground">{t('speedOfContacted', { n: s.contacted })}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('speedUnanswered')}
          </p>
          {/* Not styled as an alarm at zero, and impossible to miss above it. */}
          <p className={['text-3xl font-bold tabular-nums', s.uncontacted > 0 ? 'text-danger-text' : ''].join(' ')}>
            {s.uncontacted}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {t('speedSlo')}
          </p>
          <p className="text-3xl font-bold tabular-nums">
            {s.ai_touches === 0 ? '—' : `${Math.round((s.ai_within_slo / s.ai_touches) * 100)}%`}
          </p>
          <span className={['mt-1 inline-block rounded-full px-2 py-0.5 text-xs', SLO_CLASS[slo]].join(' ')}>
            {t(`speedSlo_${slo}`)}
          </span>
        </div>
      </div>
    </section>
  );
}
