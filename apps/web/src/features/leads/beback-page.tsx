import { useDeferredValue, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { bebackTier, daysDormant, lostReasonLabel, scoreBand, type BeBackTier } from '@dealpilot/core';
import type { BeBackLeadT, BeBackQueryT } from '@dealpilot/schemas';
import { Input, Label, Select, Button } from '@dealpilot/ui';
import { usePageTitle } from '../../shared/use-page-title.js';
import { BackLink } from '../../shared/ui/back-link.js';
import { useOrganizations } from '../organizations/api.js';
import { useBeBackQueue, useReactivateLead } from './api.js';
import {
  LEAD_STATUS_KEYS,
  SCORE_BAND_CLASSES,
  SCORE_BAND_KEYS,
  leadDisplayName,
} from './labels.js';

/**
 * F-52 — the be-back queue (leads.md §9): dormant leads ranked for
 * re-engagement. An <ol>, not a table: the queue is a RANKED pile worked
 * from the top, and each entry needs a verb (reactivate) plus quick contact
 * links, which a row of cells buries.
 */

const SORTS: BeBackQueryT['sort'][] = ['aging', 'score', 'recent', 'created'];

/** The spec's red/orange/yellow/emerald ramp on the token system — medium's
 * yellow is the caution pair added for exactly this (D-054). */
const TIER_CLASSES: Record<BeBackTier, string> = {
  critical: 'bg-danger-bg text-danger-text',
  high: 'bg-warning-bg text-warning-text',
  medium: 'bg-caution-bg text-caution-text',
  low: 'bg-success-bg text-success-text',
};
const TIER_KEYS = {
  critical: 'beback_tier_critical',
  high: 'beback_tier_high',
  medium: 'beback_tier_medium',
  low: 'beback_tier_low',
} as const satisfies Record<BeBackTier, string>;

/** Same floor the shared BackLink applies: bare text links are ~20px tall,
 * and these are the card's primary touch actions on a phone. */
const ACTION_LINK =
  'text-sm font-medium text-primary underline-offset-4 hover:underline max-lg:inline-flex max-lg:min-h-11 max-lg:items-center';

function TierChip({ tier, label }: { tier: BeBackTier; label: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold md:px-2 ${TIER_CLASSES[tier]}`}
    >
      <span aria-hidden="true" className="size-2 rounded-full bg-current md:hidden" />
      <span className="sr-only md:not-sr-only">{label}</span>
    </span>
  );
}

export function BeBackPage() {
  const { t, i18n } = useTranslation('leads');
  const { t: tCommon } = useTranslation('common');
  usePageTitle(t('beback_title'));
  const orgs = useOrganizations();
  const [orgFilter, setOrgFilter] = useState('');
  const multiOrg = (orgs.data?.items.length ?? 0) > 1;
  const effectiveOrg = multiOrg ? orgFilter || orgs.data?.items[0]?.id : undefined;

  const [sort, setSort] = useState<BeBackQueryT['sort']>('aging');
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search);

  const queue = useBeBackQueue({ orgId: effectiveOrg, sort, q }, { enabled: !orgs.isPending });
  const reactivate = useReactivateLead();
  // One reactivation at a time: the shared mutation's state tracks only the
  // LATEST call, so a second in-flight card would silently orphan the first.
  const pendingId = reactivate.isPending ? reactivate.variables : null;
  const [liveStatus, setLiveStatus] = useState('');
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const now = Date.now();

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 gap-y-2">
        <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold">
          {t('beback_title')}
        </h1>
        <BackLink to="/leads">{t('beback_back')}</BackLink>
      </header>
      <p className="max-w-2xl text-sm text-muted-foreground">{t('beback_subtitle')}</p>
      <p aria-live="polite" role="status" className="sr-only">
        {liveStatus}
      </p>

      {queue.data && queue.data.critical > 0 ? (
        <p role="status" className={`rounded-md px-3 py-2 text-sm font-medium ${TIER_CLASSES.critical}`}>
          {t('beback_critical_alert', { count: queue.data.critical })}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="beback-search">{t('beback_search')}</Label>
          <Input
            id="beback-search"
            type="search"
            value={search}
            maxLength={120}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="beback-sort">{t('beback_sort')}</Label>
          <Select id="beback-sort" value={sort} onChange={(e) => setSort(e.target.value as BeBackQueryT['sort'])}>
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`beback_sort_${s}`)}
              </option>
            ))}
          </Select>
        </div>
        {multiOrg ? (
          <div className="max-w-xs space-y-1">
            <Label htmlFor="beback-org">{t('organization')}</Label>
            <Select
              id="beback-org"
              value={effectiveOrg ?? ''}
              onChange={(e) => setOrgFilter(e.target.value)}
            >
              {orgs.data?.items.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>

      {queue.isPending ? (
        <p aria-busy="true" className="text-sm text-muted-foreground">
          {tCommon('loading')}
        </p>
      ) : queue.isError ? (
        <p role="alert" className="text-sm text-danger-text">
          {t('beback_error')}
        </p>
      ) : queue.data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {q.trim() !== '' ? t('beback_noResults') : t('beback_empty')}
        </p>
      ) : (
        <>
          <p ref={summaryRef} tabIndex={-1} className="text-sm text-muted-foreground">
            {t('beback_showing', { shown: queue.data.items.length, total: queue.data.total })}
          </p>
          <ol className="max-w-3xl space-y-2">
            {queue.data.items.map((lead: BeBackLeadT) => {
              const tier = bebackTier(lead.dormant_since, now);
              const days = daysDormant(lead.dormant_since, now);
              const name = leadDisplayName(lead) ?? t('noName');
              return (
                <li key={lead.id}>
                  <article className="space-y-2 rounded-lg border border-border bg-card p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <TierChip tier={tier} label={t(TIER_KEYS[tier])} />
                      <Link
                        to={`/leads/${lead.id}`}
                        className="font-medium text-primary underline-offset-4 hover:underline"
                      >
                        {name}
                      </Link>
                      <span className="inline-flex rounded-md bg-secondary px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-secondary-foreground">
                        {t(LEAD_STATUS_KEYS[lead.status])}
                      </span>
                      {lead.score !== null ? (
                        <span
                          className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold ${SCORE_BAND_CLASSES[scoreBand(lead.score)]}`}
                        >
                          {lead.score} · {t(SCORE_BAND_KEYS[scoreBand(lead.score)])}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-muted-foreground">
                      {t('beback_days', { count: days })} · {t('beback_attempts', { count: lead.contact_attempts })}
                      {lead.vehicle_interest ? <> · {lead.vehicle_interest}</> : null}
                      {lead.lost_reason ? (
                        <>
                          {' · '}
                          <span aria-hidden="true">{lead.lost_reason.icon}</span>{' '}
                          {lostReasonLabel(lead.lost_reason, i18n.language)}
                        </>
                      ) : null}
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                      <a href={`tel:${lead.phone}`} aria-label={`${t('beback_call')} — ${name}`} className={ACTION_LINK}>
                        {t('beback_call')}
                      </a>
                      <a href={`sms:${lead.phone}`} aria-label={`${t('beback_text')} — ${name}`} className={ACTION_LINK}>
                        {t('beback_text')}
                      </a>
                      {lead.email ? (
                        <a
                          href={`mailto:${lead.email}`}
                          aria-label={`${t('beback_email')} — ${name}`}
                          className={ACTION_LINK}
                        >
                          {t('beback_email')}
                        </a>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        className="ml-auto"
                        aria-label={`${t('beback_reactivate')} — ${name}`}
                        disabled={pendingId !== null}
                        onClick={() => {
                          reactivate.mutate(lead.id, {
                            onSuccess: () => {
                              // The card vanishes on refetch — say so, and put
                              // focus back on the queue rather than <body>.
                              setLiveStatus(t('beback_reactivated', { name }));
                              requestAnimationFrame(() => {
                                (summaryRef.current ?? headingRef.current)?.focus();
                              });
                            },
                          });
                        }}
                      >
                        {pendingId === lead.id ? t('beback_reactivating') : t('beback_reactivate')}
                      </Button>
                    </div>
                  </article>
                </li>
              );
            })}
          </ol>
        </>
      )}
      {reactivate.isError ? (
        <p role="alert" className="text-sm text-danger-text">
          {t('beback_reactivate_error')}
        </p>
      ) : null}
    </div>
  );
}
