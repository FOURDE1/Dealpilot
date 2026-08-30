import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, Input, Label, type ColumnDef } from '@dealpilot/ui';
import { JOB_QUEUES, QueueName, type QueueNameT } from '@dealpilot/contracts';
import type { z } from 'zod';
import { RETRY_MAX_JOBS, type AdminDlqPage, type AdminQueueDepthList } from '@dealpilot/schemas';
import { BackLink } from '../../shared/ui/back-link.js';
import { usePageTitle } from '../../shared/use-page-title.js';
import { useAdminDlq, useAdminQueues } from './api.js';
import { QUEUE_KEYS, QUEUE_STATE_KEYS } from './labels.js';
import { RetryJobsDialog } from './retry-jobs-dialog.js';

/** Derived from the response schemas, so a field the API renames stops compiling here. */
type QueueDepthRow = z.infer<typeof AdminQueueDepthList>['items'][number];
type DlqRow = z.infer<typeof AdminDlqPage>['items'][number];

/**
 * F-73 §9 — the job inspector, read half (admin-console.md §9).
 *
 * This is the only surface in the product that can answer "are the dealer's
 * texts stuck", so the two ways it could lie are what the screen is built
 * around.
 *
 * A COUNT THE CONSOLE COULD NOT FETCH IS NOT ZERO. `queue_state` arrives
 * beside every row and the counts are null under anything but `ok`; an
 * unreachable queue reads "unknown" with a sentence saying why, never an
 * inviting 0. An operator who walks away from a 0 that meant "Redis is down"
 * is the failure this page exists to prevent.
 *
 * A TENANT FILTER THE QUEUE CANNOT HONOUR IS NOT OFFERED. Four of the ten
 * queues carry no `organization_id` — three have no payload at all and an
 * announcement belongs to no tenant — so on those the field is replaced by the
 * sentence that says so. The server refuses the filter with a 422; the screen
 * never asks the question, because an empty page would read as "this tenant
 * has no failures".
 *
 * AND ONE ACTION, GATED. A retry on `deferred-send`, `assistant-turn`,
 * `first-touch` or `drip-tick` can put a SECOND SMS in front of a real
 * customer, so selecting jobs opens a dialog that says so in a sentence and
 * makes the operator type the queue name back before it will send anything.
 * The selection is capped at twenty by the same constant the server enforces.
 */

export function QueuesPage() {
  const { t } = useTranslation('jobs');
  const { t: tAdmin } = useTranslation('admin');
  usePageTitle(t('title'));
  const queues = useAdminQueues();

  // One banner, not ten rows of the same sentence: with no REDIS_URL every
  // queue answers `not_configured` at once, and that is a fact about the
  // instance rather than about any queue.
  const unconfigured = queues.data?.items.every((q) => q.queue_state === 'not_configured') ?? false;
  const unreachable = queues.data?.items.some((q) => q.queue_state === 'unreachable') ?? false;

  const count = (q: QueueDepthRow, key: string) => (q.counts === null ? t('countsUnknown') : String(q.counts[key] ?? 0));

  const columns = useMemo<ColumnDef<QueueDepthRow, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('colQueue'),
        enableSorting: false,
        cell: ({ row }) => (
          <Link to={`/admin/queues/${row.original.name}`} className="underline underline-offset-4">
            {t(QUEUE_KEYS[row.original.name])}
          </Link>
        ),
      },
      // The state is a word, never a colour: "unreachable" has to survive a
      // greyscale screen and a screen reader alike.
      { accessorKey: 'queue_state', header: t('colState'), enableSorting: false, cell: ({ row }) => t(QUEUE_STATE_KEYS[row.original.queue_state]) },
      { accessorKey: 'waiting', header: t('queueDepth'), enableSorting: false, cell: ({ row }) => count(row.original, 'waiting') },
      { accessorKey: 'failed', header: t('failedCount'), enableSorting: false, cell: ({ row }) => count(row.original, 'failed') },
    ],
    [t],
  );

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>
      {/* Standing, not transient: it describes the instance for as long as it
          is true, so it is a status region rather than an alert. */}
      <p role="status" className="text-sm text-muted-foreground">
        {unconfigured ? t('stateNotConfiguredHelp') : unreachable ? t('stateUnreachableHelp') : ''}
      </p>
      <DataTable
        columns={columns}
        data={queues.data?.items ?? []}
        isPending={queues.isPending}
        isError={queues.isError}
        loadingMessage={tAdmin('loading')}
        errorMessage={tAdmin('loadError')}
        emptyMessage={tAdmin('loadError')}
      />
    </div>
  );
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One queue's failed set — identifiers only, and the paging basis said out loud. */
export function QueueDlqPage() {
  const { t, i18n } = useTranslation('jobs');
  const { t: tAdmin } = useTranslation('admin');
  const { queueName = '' } = useParams();
  const parsed = QueueName.safeParse(queueName);
  const name: QueueNameT | null = parsed.success ? parsed.data : null;
  // Derived from the payload shape in the catalogue, so the screen and the
  // server's 422 cannot disagree about which queues carry a tenant.
  const orgScoped = name !== null && JOB_QUEUES[name].org_scoped;

  const [draft, setDraft] = useState('');
  const [organizationId, setOrganizationId] = useState<string | undefined>(undefined);
  // A Set, and reset by the dialog's own close: a job that was just put back
  // leaves the failed set, and a checkbox still ticked beside it is how the
  // same customer gets a third message.
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [confirming, setConfirming] = useState(false);
  // A path that is not one of the ten is a 404 here, not a request: the hook
  // still has to be called (hooks are unconditional) so it is called disabled,
  // with a placeholder name it will never fetch under.
  const dlq = useAdminDlq(name ?? 'deferred-send', organizationId, name !== null);
  // "Could not load the data. Try again." would send the operator to do the one
  // thing that cannot work: nothing was requested and no reload will help.
  usePageTitle(name === null ? t('queueUnknown') : t('dlqTitle', { queue: t(QUEUE_KEYS[name]) }));

  const fmt = (iso: string | null) => (iso ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : '—');

  const toggle = (jobId: string) =>
    setSelected((was) => (was.includes(jobId) ? was.filter((id) => id !== jobId) : was.length >= RETRY_MAX_JOBS ? was : [...was, jobId]));
  // At the cap `toggle` returns the array unchanged, so an unguarded box would
  // look operable, be pressed, and do nothing at all. The state is made
  // perceivable BEFORE the click, and said out loud when it bites.
  const atCap = selected.length >= RETRY_MAX_JOBS;

  const columns = useMemo<ColumnDef<DlqRow, unknown>[]>(
    () => [
      {
        id: 'select',
        header: t('retryColSelect'),
        enableSorting: false,
        // Every box carries its own name: a column of unlabelled checkboxes
        // reads as "checkbox, checkbox, checkbox" to a screen reader, on the
        // one screen where picking the wrong row texts a stranger.
        cell: ({ row }) => (
          <input
            type="checkbox"
            className="size-4"
            aria-label={t('retrySelectJob', { jobId: row.original.job_id })}
            checked={selected.includes(row.original.job_id)}
            disabled={atCap && !selected.includes(row.original.job_id)}
            onChange={() => toggle(row.original.job_id)}
          />
        ),
      },
      {
        accessorKey: 'job_id',
        header: t('colJobId'),
        enableSorting: false,
        // The moment of failure rides under the id rather than taking a column
        // of its own: it is the first thing an operator correlates against an
        // incident, and it needs no header to be readable.
        cell: ({ row }) => (
          <>
            <span className="font-mono text-xs">{row.original.job_id}</span>
            <span className="block text-xs text-muted-foreground">{fmt(row.original.failed_at)}</span>
          </>
        ),
      },
      {
        accessorKey: 'fields',
        header: t('colFields'),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.fields.length === 0 ? (
            '—'
          ) : (
            <ul className="space-y-0.5">
              {row.original.fields.map((f) => (
                <li key={f.key} className="font-mono text-xs">
                  {f.key}: {f.value}
                </li>
              ))}
            </ul>
          ),
      },
      { accessorKey: 'failed_reason', header: t('colFailedReason'), enableSorting: false, cell: ({ row }) => row.original.failed_reason ?? '—' },
      {
        accessorKey: 'first_stack_line',
        header: t('colStackLine'),
        enableSorting: false,
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.first_stack_line ?? '—'}</span>,
      },
    ],
    [t, i18n.language, selected, atCap],
  );

  if (name === null) {
    return (
      <div className="space-y-4">
        <BackLink to="/admin/queues">{tAdmin('back')}</BackLink>
        <p role="alert" className="text-sm text-danger-text">{t('queueUnknown')}</p>
      </div>
    );
  }

  const pages = dlq.data?.pages ?? [];
  const items = pages.flatMap((p) => p.items);
  const scanned = pages.reduce((sum, p) => sum + p.scanned, 0);
  // Every loaded page, never just the first. A page 2 that answers
  // `unreachable` carries no cursor, so the load-more button disappears and
  // the list would read as COMPLETE — the "a count the console could not fetch
  // is not zero" failure this page exists to prevent, one page further in.
  const degraded = pages.find((p) => p.queue_state !== 'ok');

  return (
    <div className="space-y-4">
      <BackLink to="/admin/queues">{tAdmin('back')}</BackLink>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t('dlqTitle', { queue: t(QUEUE_KEYS[name]) })}</h1>
        {/* Both captions are permanent, because both are permanently true: a
            DLQ row is identifiers only, and the list underneath is a live
            capped set paged by position. */}
        <p className="text-sm text-muted-foreground">{t('noPayload')}</p>
        <p className="text-sm text-muted-foreground">{t('pagingPositional')}</p>
      </header>

      {orgScoped ? (
        <form
          role="search"
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const next = UUID.test(draft.trim()) ? draft.trim() : undefined;
            // The rows under the ticks are about to be replaced. A selection
            // that survives the filter retries jobs the operator can no longer
            // see — on `deferred-send` that is a second SMS to a customer of a
            // tenant they were not even looking at.
            if (next !== organizationId) setSelected([]);
            setOrganizationId(next);
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="dlq-org">{t('orgFilterLabel')}</Label>
            <Input id="dlq-org" value={draft} onChange={(e) => setDraft(e.target.value)} className="min-w-72 font-mono text-[12px]" />
          </div>
          <Button type="submit" size="sm" variant="outline">{tAdmin('searchButton')}</Button>
        </form>
      ) : (
        // Not a disabled field: a greyed-out box invites the reader to wonder
        // what would happen if it were on. The sentence answers instead.
        <p className="text-sm text-muted-foreground">{t('orgFilterUnavailable')}</p>
      )}

      <p role="status" className="text-sm text-muted-foreground">
        {degraded
          ? t(degraded.queue_state === 'not_configured' ? 'stateNotConfiguredHelp' : 'stateUnreachableHelp')
          : dlq.isSuccess
            ? t('scannedCaption', { scanned })
            : ''}
      </p>

      <DataTable
        columns={columns}
        data={items}
        isPending={dlq.isPending}
        isError={dlq.isError}
        loadingMessage={tAdmin('loading')}
        errorMessage={tAdmin('loadError')}
        emptyMessage={t('dlqEmpty')}
      />
      {dlq.hasNextPage ? (
        <Button type="button" size="sm" variant="outline" disabled={dlq.isFetchingNextPage} onClick={() => void dlq.fetchNextPage()}>
          {tAdmin('loadMore')}
        </Button>
      ) : null}

      {degraded?.queue_state === 'not_configured' ? (
        // Not a disabled button. There is no queue to put anything back on,
        // and a greyed-out control invites the reader to hunt for the reason.
        <p className="text-sm text-muted-foreground">{t('retryUnavailableNoQueue')}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" size="sm" disabled={selected.length === 0} onClick={() => setConfirming(true)}>
            {t('retryButton')}
          </Button>
          <span className="text-sm text-muted-foreground">{t('retrySelected', { count: selected.length })}</span>
          <span className="text-xs text-muted-foreground">{t('retryMax')}</span>
          {/* Announced when the cap bites rather than a caption that was
              already standing there: the twenty-first tick has to say why it
              did nothing. */}
          <span role="status" className="text-xs text-muted-foreground">{atCap ? t('retryMaxReached') : ''}</span>
        </div>
      )}

      {/*
        Mounted only while it is open, so its `useRetryDlqJobs` observer is
        created and destroyed with it. Left mounted, the mutation state would
        survive every close — `useMutation` keeps one observer for the life of
        the component and only resets it when a `mutationKey` changes, which
        this one does not have. The second open would then render the FIRST
        batch's outcomes with no way to submit, or a standing "nothing was put
        back on the queue" describing a request the operator never made. On the
        one screen where "was a customer texted?" is the question, a stale
        answer is worse than none.
      */}
      {confirming ? (
        <RetryJobsDialog
          queue={name}
          jobIds={selected}
          organizationId={organizationId}
          onClose={() => {
            setConfirming(false);
            setSelected([]);
          }}
        />
      ) : null}
    </div>
  );
}
