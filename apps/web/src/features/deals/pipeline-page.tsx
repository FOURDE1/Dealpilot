import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Label, Select } from '@dealpilot/ui';
import { PipelineStage, type DealT } from '@dealpilot/schemas';
import { ApiError } from '../../shared/api/client.js';
import { useOrganizations } from '../organizations/api.js';
import { useLeadNames } from '../leads/api.js';
import { leadDisplayName } from '../leads/labels.js';
import { usePipelineDeals, useUpdateDealTracks } from './api.js';
import { FUNDING_STATUS_KEYS, PIPELINE_STAGE_KEYS } from './labels.js';
import { formatCents } from './money.js';

/**
 * F-06 kanban: one column per canonical stage, cards move via a labeled
 * Select (keyboard/touch friendly — WCAG needs a non-drag path anyway).
 */
export function PipelinePage() {
  const { t, i18n } = useTranslation('deals');
  const orgs = useOrganizations();
  const multiOrg = (orgs.data?.items.length ?? 0) > 1;
  const [orgFilter, setOrgFilter] = useState('');
  const orgId = multiOrg ? orgFilter || orgs.data?.items[0]?.id : orgs.data?.items[0]?.id;
  const deals = usePipelineDeals(multiOrg ? orgId : undefined, { enabled: !orgs.isPending });
  const leads = useLeadNames(multiOrg ? orgId : undefined, { enabled: !orgs.isPending });
  const update = useUpdateDealTracks(multiOrg ? orgId : undefined);
  const [error, setError] = useState<string | null>(null);

  const leadName = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of leads.data ?? []) map.set(l.id, leadDisplayName(l) ?? l.phone);
    return map;
  }, [leads.data]);

  const byStage = useMemo(() => {
    const map = new Map<DealT['pipeline_stage'], DealT[]>();
    for (const stage of PipelineStage.options) map.set(stage, []);
    for (const d of deals.data?.items ?? []) map.get(d.pipeline_stage)?.push(d);
    return map;
  }, [deals.data]);

  const pendingId = update.isPending ? update.variables?.id : null;

  async function move(deal: DealT, patch: { pipeline_stage?: DealT['pipeline_stage']; funding_status?: DealT['funding_status'] }) {
    if (pendingId === deal.id) return; // one in-flight move per deal
    setError(null);
    try {
      await update.mutateAsync({ id: deal.id, body: patch });
    } catch (err) {
      setError(t('genericError'));
      if (!(err instanceof ApiError)) throw err;
    }
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">{t('pipelineTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('pipelineSubtitle')}</p>
        {multiOrg ? (
          <div className="mt-3 max-w-xs space-y-1">
            <Label htmlFor="pipeline-org">{t('orgScope')}</Label>
            <Select id="pipeline-org" value={orgId ?? ''} onChange={(e) => setOrgFilter(e.target.value)}>
              {orgs.data?.items.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </header>

      {error ? (
        <p role="alert" className="text-sm text-danger-text">
          {error}
        </p>
      ) : null}

      {deals.isPending || orgs.isPending ? (
        <p className="text-sm text-muted-foreground" aria-busy="true">
          {t('loading')}
        </p>
      ) : deals.isError ? (
        <p role="alert" className="text-sm text-danger-text">
          {t('loadError')}
        </p>
      ) : (deals.data.items.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">{t('pipelineEmpty')}</p>
      ) : (
        <>
        {deals.data.truncated ? (
          <p className="text-sm text-muted-foreground">{t('pipelineTruncated')}</p>
        ) : null}
        {/* tabIndex: the scroll region must be keyboard-scrollable even when
            the far columns hold no focusable cards. */}
        <div
          role="group"
          aria-label={t('pipelineTitle')}
          tabIndex={0}
          className="flex snap-x gap-3 overflow-x-auto pb-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {PipelineStage.options.map((stage) => {
            const cards = byStage.get(stage) ?? [];
            return (
              <section
                key={stage}
                aria-label={t(PIPELINE_STAGE_KEYS[stage])}
                className="w-64 shrink-0 snap-start rounded-lg border border-border bg-muted/40 p-2"
              >
                <h2 className="flex items-baseline justify-between px-1 pb-2 text-sm font-semibold">
                  {t(PIPELINE_STAGE_KEYS[stage])}
                  <span className="font-mono text-xs text-muted-foreground">{cards.length}</span>
                </h2>
                <div className="space-y-2">
                  {cards.map((d) => (
                    <article
                      key={d.id}
                      aria-busy={pendingId === d.id || undefined}
                      className="space-y-2 rounded-md border border-border bg-card p-3 text-sm"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        {d.lead_id ? (
                          <Link
                            to={`/leads/${d.lead_id}`}
                            className="font-medium text-primary underline-offset-4 hover:underline"
                          >
                            {leadName.get(d.lead_id) ?? '…'}
                          </Link>
                        ) : (
                          <span className="font-medium">—</span>
                        )}
                        <span className="font-mono text-[13px] tabular-nums">
                          {d.deal_type === 'cash'
                            ? formatCents(d.amount_financed_cents, i18n.language)
                            : t('monthlyAbbr', {
                                amount: formatCents(d.monthly_payment_cents, i18n.language),
                              })}
                        </span>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`stage-${d.id}`} className="text-xs">
                          {t('stageLabel')}
                        </Label>
                        <Select
                          id={`stage-${d.id}`}
                          value={d.pipeline_stage}
                          disabled={pendingId === d.id}
                          onChange={(e) =>
                            void move(d, { pipeline_stage: e.target.value as DealT['pipeline_stage'] })
                          }
                        >
                          {PipelineStage.options.map((sOpt) => (
                            <option key={sOpt} value={sOpt}>
                              {t(PIPELINE_STAGE_KEYS[sOpt])}
                            </option>
                          ))}
                        </Select>
                        <Label htmlFor={`funding-${d.id}`} className="text-xs">
                          {t('fundingLabel')}
                        </Label>
                        <Select
                          id={`funding-${d.id}`}
                          value={d.funding_status}
                          disabled={pendingId === d.id}
                          onChange={(e) =>
                            void move(d, { funding_status: e.target.value as DealT['funding_status'] })
                          }
                        >
                          {(['not_submitted', 'submitted', 'stips_required', 'funded'] as const).map((f) => (
                            <option key={f} value={f}>
                              {t(FUNDING_STATUS_KEYS[f])}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
        </>
      )}
    </div>
  );
}
