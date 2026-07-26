import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../../shared/use-page-title.js';
import { Button, Label, Select } from '@dealpilot/ui';
import { PipelineStage, type DealT } from '@dealpilot/schemas';
import { ApiError } from '../../shared/api/client.js';
import { useOrganizations } from '../organizations/api.js';
import { useLeadNames } from '../leads/api.js';
import { leadDisplayName } from '../leads/labels.js';
import { usePipelineDeals, useUpdateDealTracks } from './api.js';
import { ChecklistDialog } from '../checklists/checklist-dialog.js';
import { DealActivityDialog } from '../activity/activity-dialog.js';
import { CHECKLIST_CODE_KEYS } from '../checklists/labels.js';
import { checklistKeys } from '../checklists/api.js';
import { useQueryClient } from '@tanstack/react-query';
import type { DealChecklistItemT } from '@dealpilot/schemas';
import { FUNDING_STATUS_KEYS, PIPELINE_STAGE_KEYS } from './labels.js';
import { formatCents } from './money.js';

/**
 * F-06 kanban: one column per canonical stage, cards move via a labeled
 * Select (keyboard/touch friendly — WCAG needs a non-drag path anyway).
 */
export function PipelinePage() {
  const { t, i18n } = useTranslation('deals');
  usePageTitle(t('pipelineTitle'));
  const { t: tCheck } = useTranslation('checklist');
  const { t: tActivity } = useTranslation('activity');
  const orgs = useOrganizations();
  const multiOrg = (orgs.data?.items.length ?? 0) > 1;
  const [orgFilter, setOrgFilter] = useState('');
  const orgId = multiOrg ? orgFilter || orgs.data?.items[0]?.id : orgs.data?.items[0]?.id;
  const deals = usePipelineDeals(multiOrg ? orgId : undefined, { enabled: !orgs.isPending });
  const leads = useLeadNames(multiOrg ? orgId : undefined, { enabled: !orgs.isPending });
  const update = useUpdateDealTracks(multiOrg ? orgId : undefined);
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [checklistDeal, setChecklistDeal] = useState<DealT | null>(null);
  const [activityDeal, setActivityDeal] = useState<DealT | null>(null);

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
  const [liveStatus, setLiveStatus] = useState('');

  function codeToLabel(dealId: string, code: string): string {
    // Prefer the deal's own (store-renamable) labels when the panel was opened;
    // fall back to the canonical names.
    const cached = queryClient.getQueryData<{ items: DealChecklistItemT[] }>(checklistKeys.deal(dealId));
    const item = cached?.items.find((i) => i.code === code);
    if (item) return i18n.language.startsWith('fr') ? item.label_fr : item.label_en;
    return code in CHECKLIST_CODE_KEYS
      ? tCheck(CHECKLIST_CODE_KEYS[code as keyof typeof CHECKLIST_CODE_KEYS])
      : code;
  }

  async function move(deal: DealT, patch: { pipeline_stage?: DealT['pipeline_stage']; funding_status?: DealT['funding_status'] }) {
    if (pendingId === deal.id) return; // one in-flight move per deal
    setError(null);
    try {
      const updated = await update.mutateAsync({ id: deal.id, body: patch });
      // The card re-mounts in its new column — put focus (and say what happened)
      // back where the user was working.
      setLiveStatus(
        patch.pipeline_stage
          ? t('movedTo', { stage: t(PIPELINE_STAGE_KEYS[updated.pipeline_stage]) })
          : t('fundingSet', { funding: t(FUNDING_STATUS_KEYS[updated.funding_status]) }),
      );
      requestAnimationFrame(() => {
        document
          .getElementById(patch.pipeline_stage ? `stage-${deal.id}` : `funding-${deal.id}`)
          ?.focus();
      });
    } catch (err) {
      if (!(err instanceof ApiError)) {
        setError(t('genericError'));
        throw err;
      }
      if (
        err.status === 422 &&
        (err.errorCode === 'checklist_incomplete' || err.errorCode === 'checklist_hard_blocked')
      ) {
        // One detail code per outstanding item — translate each.
        const codes = err.detailCodes ?? [];
        if (codes.includes('checklist_missing')) {
          setError(tCheck('noChecklist'));
        } else {
          const names = codes.map((c) => codeToLabel(deal.id, c)).join(', ');
          // A legal hard block is a different sentence than "finish these".
          setError(
            err.errorCode === 'checklist_hard_blocked'
              ? t('deliveryHardBlocked', { items: names })
              : t('deliveryBlocked', { items: names }),
          );
        }
      } else {
        setError(t('genericError'));
      }
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
      <p aria-live="polite" role="status" className="sr-only">
        {liveStatus}
      </p>

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
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start px-0"
                        aria-label={t('checklistFor', { name: leadName.get(d.lead_id ?? '') ?? d.id.slice(0, 8) })}
                        onClick={() => setChecklistDeal(d)}
                      >
                        {t('checklistAction')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start px-0"
                        aria-label={tActivity('historyFor', { name: leadName.get(d.lead_id ?? '') ?? d.id.slice(0, 8) })}
                        onClick={() => setActivityDeal(d)}
                      >
                        {tActivity('historyAction')}
                      </Button>
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
      <DealActivityDialog
        deal={activityDeal}
        dealLabel={activityDeal?.lead_id ? leadName.get(activityDeal.lead_id) : undefined}
        onClose={() => setActivityDeal(null)}
      />
      <ChecklistDialog
        deal={checklistDeal}
        dealLabel={checklistDeal?.lead_id ? leadName.get(checklistDeal.lead_id) : undefined}
        onClose={() => setChecklistDeal(null)}
      />
    </div>
  );
}
