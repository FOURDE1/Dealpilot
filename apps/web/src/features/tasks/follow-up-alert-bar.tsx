import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useTaskSummary } from './api.js';

/**
 * F-68 — the FollowUpAlertBar (leads.md §10.1): Overdue / Due Today / Due
 * This Week for the signed-in person, or a green all-clear. Numbers come
 * from the server's buckets, computed in each task's store timezone, so
 * "today" is the store's today — never the browser's.
 *
 * Text carries the meaning; color only underlines it (WCAG 1.4.1). A failed
 * fetch says so (review): silence would read as "nothing overdue".
 */
export function FollowUpAlertBar({
  orgId,
  assignedTo,
  enabled = true,
}: {
  orgId?: string;
  assignedTo?: string;
  enabled?: boolean;
}) {
  const { t } = useTranslation('tasks');
  const summary = useTaskSummary(orgId, { assignedTo, enabled });
  if (summary.isError) {
    return (
      <p role="alert" className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-danger-text">
        {t('alert_error')}
      </p>
    );
  }
  if (!summary.isSuccess) return null;
  const s = summary.data;
  const clear = s.overdue === 0 && s.today === 0 && s.week === 0;
  const link = 'font-medium underline-offset-4 hover:underline max-lg:min-h-11 max-lg:inline-flex max-lg:items-center';
  // The board reopens on the organization these counts were made for.
  const to = (bucket: string) => `/tasks?bucket=${bucket}${orgId ? `&org=${orgId}` : ''}`;
  return (
    <div
      role="status"
      aria-label={t('alert_label')}
      className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-card px-3 py-2 text-sm"
    >
      {clear ? (
        <span className="text-success-text">{t('alert_clear')}</span>
      ) : (
        <>
          {s.overdue > 0 ? (
            <Link to={to('overdue')} className={`${link} font-semibold text-danger-text`}>
              {t('alert_overdue', { count: s.overdue })}
            </Link>
          ) : null}
          {s.today > 0 ? (
            <Link to={to('today')} className={`${link} text-warning-text`}>
              {t('alert_today', { count: s.today })}
            </Link>
          ) : null}
          {s.week > 0 ? (
            <Link to={to('week')} className={`${link} text-info-text`}>
              {t('alert_week', { count: s.week })}
            </Link>
          ) : null}
        </>
      )}
    </div>
  );
}
