import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, Label, Select, buttonVariants, type ColumnDef } from '@dealpilot/ui';
import { AnnouncementSeverity, type AdminAnnouncementT, type AnnouncementSeverityT } from '@dealpilot/schemas';
import { usePageTitle } from '../../shared/use-page-title.js';
import { AUDIENCE_KEYS, SEVERITY_CLASSES, SEVERITY_KEYS, inLanguage } from '../announcements/labels.js';
import { useAdminAnnouncements, useAdminMe } from './api.js';

/**
 * F-72 — the announcement register (admin-console.md §8, §11).
 *
 * A published announcement is immutable (§12), so this is a history as much
 * as a list: nothing on it can be edited, and the only act it offers is
 * opening one to end it early. Newest first, keyset-paged like the tenant
 * directory — no client-side sorting of a partial page.
 *
 * "Notices sent" counts real `notifications` rows rather than a stored
 * counter, so it can be behind while the fan-out walks, but it can never
 * claim a delivery that did not happen.
 */

function isSeverity(v: string | null): v is AnnouncementSeverityT {
  return v !== null && (AnnouncementSeverity.options as readonly string[]).includes(v);
}

export function AnnouncementsPage() {
  const { t, i18n } = useTranslation('announcements');
  const { t: tAdmin } = useTranslation('admin');
  usePageTitle(t('title'));
  const [params, setParams] = useSearchParams();
  const severity = isSeverity(params.get('severity')) ? (params.get('severity') as AnnouncementSeverityT) : undefined;
  const list = useAdminAnnouncements(severity);
  const me = useAdminMe();
  const canPublish = me.data?.capabilities.includes('announcements:publish') ?? false;
  const rows = useMemo(() => list.data?.pages.flatMap((p: { items: AdminAnnouncementT[] }) => p.items) ?? [], [list.data]);

  const columns = useMemo<ColumnDef<AdminAnnouncementT, unknown>[]>(() => {
    const fmt = (iso: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
    /** Active, scheduled or over — said in words, from the window alone. */
    const state = (a: AdminAnnouncementT) => {
      const now = Date.now();
      if (a.ends_at !== null && Date.parse(a.ends_at) <= now) return t('ended');
      return Date.parse(a.starts_at) > now ? t('scheduled') : t('active');
    };
    return [
      {
        accessorKey: 'severity',
        header: t('colSeverity'),
        enableSorting: false,
        cell: ({ row }) => (
          <span className={`rounded-full px-2 py-0.5 text-xs ${SEVERITY_CLASSES[row.original.severity]}`}>
            {t(SEVERITY_KEYS[row.original.severity])}
          </span>
        ),
      },
      {
        accessorKey: 'title_fr',
        header: t('colTitle'),
        enableSorting: false,
        cell: ({ row }) => (
          <Link to={`/admin/announcements/${row.original.id}`} className="font-medium underline underline-offset-4">
            {inLanguage(i18n.language, row.original.title_en, row.original.title_fr)}
          </Link>
        ),
      },
      { accessorKey: 'audience', header: t('colAudience'), enableSorting: false, cell: ({ row }) => t(AUDIENCE_KEYS[row.original.audience.type]) },
      {
        accessorKey: 'starts_at',
        header: t('colWindow'),
        enableSorting: false,
        cell: ({ row }) => `${state(row.original)} · ${fmt(row.original.starts_at)}${row.original.ends_at ? ` — ${fmt(row.original.ends_at)}` : ''}`,
      },
      { accessorKey: 'published_by_email', header: t('colPublishedBy'), enableSorting: false },
      { accessorKey: 'recipients_notified', header: t('colNotified'), enableSorting: false },
    ];
  }, [t, i18n.language]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        {canPublish ? (
          <Link to="/admin/announcements/new" className={buttonVariants({ size: 'sm' })}>{t('newAnnouncement')}</Link>
        ) : null}
      </header>

      <form role="search" className="flex flex-wrap items-end gap-3" onSubmit={(e) => e.preventDefault()}>
        <div className="space-y-1">
          <Label htmlFor="ann-severity">{t('fieldSeverity')}</Label>
          <Select
            id="ann-severity"
            value={severity ?? ''}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              if (e.target.value) next.set('severity', e.target.value);
              else next.delete('severity');
              setParams(next, { replace: true });
            }}
          >
            <option value="">{tAdmin('all')}</option>
            {AnnouncementSeverity.options.map((s) => (
              <option key={s} value={s}>{t(SEVERITY_KEYS[s])}</option>
            ))}
          </Select>
        </div>
      </form>

      <DataTable
        columns={columns}
        data={rows}
        isPending={list.isPending}
        isError={list.isError}
        loadingMessage={tAdmin('loading')}
        errorMessage={t('loadError')}
        emptyMessage={t('empty')}
      />
      {list.hasNextPage ? (
        <Button type="button" variant="outline" size="sm" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
          {tAdmin('loadMore')}
        </Button>
      ) : null}
    </div>
  );
}
