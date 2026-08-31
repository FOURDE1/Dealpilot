import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Label,
  Select,
} from '@dealpilot/ui';
import type { DuplicatePairT, LeadDuplicateT } from '@dealpilot/schemas';
import { usePageTitle } from '../../shared/use-page-title.js';
import { BackLink } from '../../shared/ui/back-link.js';
import { ApiError } from '../../shared/api/client.js';
import { useOrganizations } from '../organizations/api.js';
import { useDismissPair, useDuplicates, useMergePair } from './duplicate-api.js';
import { leadDisplayName } from './labels.js';

/**
 * F-54 — the duplicate review queue (leads.md §8): side-by-side pairs,
 * matched fields highlighted, two verbs. The OLDER lead is always the
 * keeper — merge folds the newer into it and retires the newer as lost
 * under 'Merged duplicate'. Merge is consequential and irreversible from
 * this screen, so it confirms; dismiss does not.
 */

type Tab = LeadDuplicateT['status'] | 'all';
const TABS: Tab[] = ['pending', 'merged', 'dismissed', 'all'];

const MATCH_KEYS = {
  phone: 'dup_match_phone',
  email: 'dup_match_email',
  name: 'dup_match_name',
  phone_email: 'dup_match_phone_email',
  phone_name: 'dup_match_phone_name',
  email_name: 'dup_match_email_name',
  phone_email_name: 'dup_match_phone_email_name',
} as const satisfies Record<DuplicatePairT['match_type'], string>;

function matchedFields(matchType: DuplicatePairT['match_type']): Set<'phone' | 'email' | 'name'> {
  return new Set(matchType.split('_') as ('phone' | 'email' | 'name')[]);
}

function SideCard({
  lead,
  roleLabel,
  matched,
  noName,
  locale,
}: {
  lead: DuplicatePairT['newer'];
  roleLabel: string;
  matched: Set<'phone' | 'email' | 'name'>;
  noName: string;
  locale: string;
}) {
  const hit = 'rounded-sm bg-caution-bg px-1 font-medium text-caution-text';
  return (
    <div className="min-w-0 flex-1 space-y-1 rounded-md border border-border bg-background p-3 text-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {roleLabel}
      </p>
      <p>
        <Link
          to={`/leads/${lead.id}`}
          className="font-medium text-primary-text underline underline-offset-4"
        >
          <span className={matched.has('name') ? hit : undefined}>
            {leadDisplayName(lead) ?? noName}
          </span>
        </Link>
      </p>
      <p className={`font-mono text-[13px] ${matched.has('phone') ? hit : ''}`}>{lead.phone}</p>
      {lead.email ? (
        <p className={`break-all text-[13px] ${matched.has('email') ? hit : ''}`}>{lead.email}</p>
      ) : null}
      {lead.vehicle_interest ? <p className="text-muted-foreground">{lead.vehicle_interest}</p> : null}
      <p className="text-[12px] text-muted-foreground">
        {new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(lead.created_at))}
      </p>
    </div>
  );
}

export function DuplicatesPage() {
  const { t, i18n } = useTranslation('leads');
  usePageTitle(t('dup_title'));
  const orgs = useOrganizations();
  const [orgFilter, setOrgFilter] = useState('');
  const multiOrg = (orgs.data?.items.length ?? 0) > 1;
  const effectiveOrg = multiOrg ? orgFilter || orgs.data?.items[0]?.id : orgs.data?.items[0]?.id;

  const [tab, setTab] = useState<Tab>('pending');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const list = useDuplicates(effectiveOrg, {
    status: tab === 'all' ? undefined : tab,
    cursor,
    enabled: !orgs.isPending,
  });
  const merge = useMergePair();
  const dismiss = useDismissPair();
  const [confirmPair, setConfirmPair] = useState<DuplicatePairT | null>(null);
  const acting = merge.isPending || dismiss.isPending;
  const [error, setError] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState('');

  const headingRef = useRef<HTMLHeadingElement>(null);

  function act(promise: Promise<unknown>, done: string) {
    setError(null);
    promise
      .then(() => {
        setLiveStatus(done);
        // The acted-on card unmounts on refetch — focus must not fall to <body>.
        requestAnimationFrame(() => headingRef.current?.focus());
      })
      .catch((err: unknown) => {
        // A timeout or network drop deserves feedback exactly as much as a 4xx.
        setError(
          err instanceof ApiError && err.code === 'already_resolved'
            ? t('dup_alreadyResolved')
            : t('genericError'),
        );
      });
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 gap-y-2">
        <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold">
          {t('dup_title')}
        </h1>
        <BackLink to="/leads">{t('beback_back')}</BackLink>
      </header>
      <p className="max-w-2xl text-sm text-muted-foreground">{t('dup_subtitle')}</p>
      <p aria-live="polite" role="status" className="sr-only">
        {liveStatus}
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div role="group" aria-label={t('dup_tabs')} className="flex flex-wrap gap-1">
          {TABS.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={tab === s}
              onClick={() => {
                setTab(s);
                setCursor(undefined);
              }}
              className={`rounded-md px-3 py-2 text-sm font-medium max-lg:min-h-11 ${
                tab === s
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground hover:bg-muted'
              }`}
            >
              {t(`dup_tab_${s}`)}
            </button>
          ))}
        </div>
        {multiOrg ? (
          <div className="ml-auto max-w-xs space-y-1">
            <Label htmlFor="dup-org">{t('organization')}</Label>
            <Select id="dup-org" value={effectiveOrg ?? ''} onChange={(e) => setOrgFilter(e.target.value)}>
              {orgs.data?.items.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger-text">
          {error}
        </p>
      ) : null}

      {orgs.isError ? (
        <p role="alert" className="text-sm text-danger-text">
          {t('genericError')}
        </p>
      ) : orgs.isSuccess && !effectiveOrg ? (
        <p className="text-sm text-muted-foreground">{t('dup_empty')}</p>
      ) : list.isPending ? (
        <p aria-busy="true" className="text-sm text-muted-foreground">
          {t('dup_loading')}
        </p>
      ) : list.isError ? (
        <p role="alert" className="text-sm text-danger-text">
          {t('genericError')}
        </p>
      ) : list.data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('dup_empty')}</p>
      ) : (
        <ul className="max-w-4xl space-y-3">
          {list.data.items.map((pair) => {
            const matched = matchedFields(pair.match_type);
            const pairName = leadDisplayName(pair.newer) ?? pair.newer.phone;
            return (
              <li key={pair.id}>
                <article className="space-y-3 rounded-lg border border-border bg-card p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="inline-flex rounded-md bg-secondary px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-secondary-foreground">
                      {t(MATCH_KEYS[pair.match_type])}
                    </span>
                    <span className="text-muted-foreground">
                      {t('dup_confidence', { value: pair.confidence })}
                    </span>
                    {pair.status !== 'pending' ? (
                      <span className="inline-flex rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                        {t(`dup_tab_${pair.status}`)}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <SideCard
                      lead={pair.older}
                      roleLabel={t('dup_keeper')}
                      matched={matched}
                      noName={t('noName')}
                      locale={i18n.language}
                    />
                    <SideCard
                      lead={pair.newer}
                      roleLabel={t('dup_newer')}
                      matched={matched}
                      noName={t('noName')}
                      locale={i18n.language}
                    />
                  </div>
                  {pair.status === 'pending' ? (
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={acting}
                        aria-label={`${t('dup_dismiss')} — ${pairName}`}
                        onClick={() =>
                          act(dismiss.mutateAsync(pair.id), t('dup_dismissed_live', { name: pairName }))
                        }
                      >
                        {dismiss.isPending && dismiss.variables === pair.id
                          ? t('dup_working')
                          : t('dup_dismiss')}
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={acting}
                        aria-label={`${t('dup_merge')} — ${pairName}`}
                        onClick={() => setConfirmPair(pair)}
                      >
                        {merge.isPending && merge.variables === pair.id
                          ? t('dup_merging')
                          : t('dup_merge')}
                      </Button>
                    </div>
                  ) : null}
                </article>
              </li>
            );
          })}
        </ul>
      )}
      {!list.isPending && !list.isError && (list.data?.next_cursor || cursor) ? (
        <div className="flex flex-wrap gap-2">
          {cursor ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setCursor(undefined)}>
              {t('dup_firstPage')}
            </Button>
          ) : null}
          {list.data?.next_cursor ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCursor(list.data.next_cursor ?? undefined)}
            >
              {t('dup_nextPage')}
            </Button>
          ) : null}
        </div>
      ) : null}

      <Dialog.Root
        open={confirmPair !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmPair(null);
        }}
      >
        <DialogContent>
          <DialogTitle>{t('dup_mergeTitle')}</DialogTitle>
          <DialogDescription>
            {confirmPair
              ? t('dup_mergeBody', {
                  newer: leadDisplayName(confirmPair.newer) ?? confirmPair.newer.phone,
                  keeper: leadDisplayName(confirmPair.older) ?? confirmPair.older.phone,
                })
              : ''}
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close
              render={
                <Button type="button" variant="outline">
                  {t('lostModal_cancel')}
                </Button>
              }
            />
            <Button
              type="button"
              variant="destructive"
              disabled={merge.isPending}
              onClick={() => {
                if (!confirmPair) return;
                act(
                  merge.mutateAsync(confirmPair.id),
                  t('dup_merged_live', {
                    name: leadDisplayName(confirmPair.newer) ?? confirmPair.newer.phone,
                  }),
                );
                setConfirmPair(null);
              }}
            >
              {merge.isPending ? t('dup_merging') : t('dup_mergeConfirm')}
            </Button>
          </div>
        </DialogContent>
      </Dialog.Root>
    </div>
  );
}
