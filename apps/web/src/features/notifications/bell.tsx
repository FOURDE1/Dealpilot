import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@dealpilot/ui';
import { useMarkAllRead, useMarkRead, useNotifications } from './api.js';

/**
 * F-72: an announcement is authored in BOTH languages, and migration 0051
 * decides the language at DISPLAY time — so the fan-out writes `title_en` and
 * `title_fr` into `params` and the reader's own UI locale picks between them
 * here. Both bundles therefore carry the identical single ICU argument
 * `{title}`, which is what keeps `check:parity` honest. Every other producer's
 * params are locale-free and pass through untouched.
 */
function notificationArgs(params: Record<string, string>, language: string): Record<string, string> {
  if (!('title_en' in params && 'title_fr' in params)) return params;
  return { ...params, title: language.startsWith('en') ? params['title_en']! : params['title_fr']! };
}

/**
 * F-47 — the bell (automation-notifications.md §5).
 *
 * A <details> dropdown, because summary/details carries keyboard and
 * open/close semantics for free. Twenty most recent; urgency stripe on the
 * start edge (red HIGH, amber MEDIUM, none LOW — with the unread dot
 * carrying the state beyond color alone); click deep-links and marks read.
 * Titles are i18n KEYS rendered here, in the viewer's own locale.
 */
export function NotificationsBell() {
  const { t, i18n } = useTranslation('notif');
  const navigate = useNavigate();
  const list = useNotifications();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const unread = list.data?.unread ?? 0;

  const stripe = (urgency: string) =>
    urgency === 'high' ? 'border-s-2 border-danger-text' : urgency === 'medium' ? 'border-s-2 border-warning-text' : '';

  return (
    <details className="relative">
      <summary
        className="flex h-9 min-w-9 cursor-pointer list-none items-center justify-center rounded-md px-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground [&::-webkit-details-marker]:hidden"
        aria-label={unread > 0 ? t('bellUnread', { count: unread }) : t('bell')}
      >
        <span aria-hidden="true">🔔</span>
        {unread > 0 ? (
          <span className="ms-1 rounded-full bg-danger-text px-1.5 text-xs font-semibold text-white">
            {unread > 20 ? '20+' : unread}
          </span>
        ) : null}
      </summary>
      <div className="absolute end-0 z-30 mt-2 w-80 max-w-[90vw] rounded-lg border border-border bg-card p-2 shadow-lg">
        <div className="flex items-center justify-between px-1 pb-2">
          <p className="text-sm font-medium">{t('bell')}</p>
          {unread > 0 ? (
            <Button type="button" variant="outline" size="sm" onClick={() => markAll.mutate()} disabled={markAll.isPending}>
              {t('markAll')}
            </Button>
          ) : null}
        </div>
        {(list.data?.items.length ?? 0) === 0 ? (
          <p className="px-1 pb-1 text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="max-h-96 space-y-1 overflow-y-auto">
            {list.data?.items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={`w-full rounded-md p-2 text-start text-sm hover:bg-accent ${stripe(n.urgency)} ${n.read_at === null ? 'font-medium' : 'text-muted-foreground'}`}
                  onClick={() => {
                    if (n.read_at === null) markRead.mutate(n.id);
                    if (n.link) void navigate(n.link);
                  }}
                >
                  {n.read_at === null ? (
                    <span aria-hidden="true" className="me-1 inline-block size-2 rounded-full bg-danger-text align-middle" />
                  ) : null}
                  {t(n.title_key as never, notificationArgs(n.params as Record<string, string>, i18n.language))}
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {new Date(n.created_at).toLocaleString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
