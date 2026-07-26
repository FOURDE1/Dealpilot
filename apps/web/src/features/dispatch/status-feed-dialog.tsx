import { useTranslation } from 'react-i18next';
import { Button, Dialog, DialogContent, DialogTitle } from '@dealpilot/ui';
import type { ActivityEventT, DispatchAssignmentT } from '@dealpilot/schemas';
import { useMembers } from '../team/api.js';
import { useDispatchStatusUpdates } from './api.js';
import { DISPATCH_STATUS_KEYS } from './dispatch-page.js';

/**
 * F-11c: what happened to one run, in order — booked, departed, arrived,
 * cancelled. Reads the dedicated status-updates feed (the activity trail, the
 * single truth) and localizes the dispatch statuses that the generic timeline
 * would leave as raw strings.
 */
export function DispatchStatusFeedDialog({
  run,
  runLabel,
  onClose,
}: {
  run: DispatchAssignmentT | null;
  runLabel?: string;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation('dispatch');
  const feed = useDispatchStatusUpdates(run?.id ?? '', { enabled: run !== null });
  const members = useMembers(run?.organization_id, { enabled: run !== null });
  // Evidence keeps naming its author even after they leave the org (F-08 rule).
  const removed = useMembers(run?.organization_id, { enabled: run !== null, status: 'revoked' });

  const actorName = (event: ActivityEventT): string => {
    if (event.actor_user_id === null) return t('feedSystem');
    return (
      members.data?.items.find((m) => m.user_id === event.actor_user_id)?.name ??
      removed.data?.items.find((m) => m.user_id === event.actor_user_id)?.name ??
      t('feedUnlisted')
    );
  };

  const fmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });

  const line = (event: ActivityEventT): string => {
    if (event.action === 'created') return t('feedBooked');
    const status = (event.changes as { status?: { to?: unknown } }).status?.to;
    if (event.action === 'stage_changed' && typeof status === 'string' && status in DISPATCH_STATUS_KEYS) {
      return t('feedStatus', { status: t(DISPATCH_STATUS_KEYS[status as DispatchAssignmentT['status']]) });
    }
    return t('feedUpdated');
  };

  return (
    <Dialog.Root open={run !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[85svh] overflow-y-auto">
        <DialogTitle>
          {t('feedTitle')}
          {runLabel ? <span className="text-muted-foreground"> — {runLabel}</span> : null}
        </DialogTitle>
        <div className="mt-3">
          {run && run.customer_notified_at ? (
            <p className="mb-3 rounded-md bg-success-bg px-3 py-2 text-sm text-success-text">
              {t('feedNotified', { at: fmt.format(new Date(run.customer_notified_at)) })}
            </p>
          ) : run ? (
            <p className="mb-3 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              {t('feedNotNotified')}
            </p>
          ) : null}
          {feed.isPending && run ? (
            <p className="text-sm text-muted-foreground">{t('loading')}</p>
          ) : feed.isError ? (
            <p role="alert" className="text-sm text-danger-text">
              {t('loadError')}
            </p>
          ) : (feed.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">{t('feedEmpty')}</p>
          ) : (
            // role="list" restores list semantics WebKit strips once list-style
            // is none (Tailwind preflight) — the sequence is the point.
            <ol role="list" className="divide-y divide-border">
              {feed.data?.map((event) => (
                <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2 text-sm">
                  <span>
                    <span className="font-medium">{line(event)}</span>
                    <span className="text-muted-foreground"> — {actorName(event)}</span>
                  </span>
                  <time dateTime={event.created_at} className="text-xs text-muted-foreground">
                    {fmt.format(new Date(event.created_at))}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="mt-4 flex justify-end">
          <Dialog.Close
            render={
              <Button type="button" variant="outline">
                {t('close')}
              </Button>
            }
          />
        </div>
      </DialogContent>
    </Dialog.Root>
  );
}
