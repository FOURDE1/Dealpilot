import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { DataTable, Label, Select, type ColumnDef } from '@dealpilot/ui';
import type { ImpersonationSessionT } from '@dealpilot/schemas';
import { usePageTitle } from '../../shared/use-page-title.js';
import { useImpersonations } from './api.js';
import { END_REASON_KEYS, MODE_KEYS } from './labels.js';

/**
 * F-71 — the support-session register (admin-console.md §7 "impersonation
 * register"). Filters live in the URL (a tenant id from the tenant page,
 * active yes/no); newest first; every row links to its trail. The list is
 * bounded (200) like the directory — no client-side sorting of a partial page.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ImpersonationPage() {
  const { t, i18n } = useTranslation('admin');
  usePageTitle(t('impersonationTitle'));
  const [params, setParams] = useSearchParams();
  const tenantId = UUID.test(params.get('tenant') ?? '') ? params.get('tenant')! : undefined;
  const activeParam = params.get('active');
  const active = activeParam === 'true' || activeParam === 'false' ? activeParam : undefined;
  const sessions = useImpersonations({ tenantId, active });
  const fmt = (iso: string | null) => (iso ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : '—');

  const columns = useMemo<ColumnDef<ImpersonationSessionT, unknown>[]>(
    () => [
      {
        accessorKey: 'tenant',
        header: t('colTenant'),
        enableSorting: false,
        cell: ({ row }) => <Link to={`/admin/tenants/${row.original.tenant.id}`} className="underline underline-offset-4">{row.original.tenant.name}</Link>,
      },
      { accessorKey: 'platform_user', header: t('colStaff'), enableSorting: false, cell: ({ row }) => row.original.platform_user.email },
      { accessorKey: 'target_user', header: t('colActingAs'), enableSorting: false, cell: ({ row }) => `${row.original.target_user.name} (${row.original.target_user.email})` },
      { accessorKey: 'mode', header: t('colMode'), enableSorting: false, cell: ({ row }) => t(MODE_KEYS[row.original.mode]) },
      { accessorKey: 'started_at', header: t('colStarted'), enableSorting: false, cell: ({ row }) => fmt(row.original.started_at) },
      {
        accessorKey: 'ended_at',
        header: t('colEnds'),
        enableSorting: false,
        cell: ({ row }) => (row.original.active ? `${fmt(row.original.expires_at)} · ${t('activeNow')}` : fmt(row.original.ended_at)),
      },
      { accessorKey: 'end_reason', header: t('colEndReason'), enableSorting: false, cell: ({ row }) => (row.original.end_reason ? t(END_REASON_KEYS[row.original.end_reason]) : '—') },
      {
        accessorKey: 'request_count',
        header: t('colRequests'),
        enableSorting: false,
        cell: ({ row }) => <Link to={`/admin/support-sessions/${row.original.id}`} className="underline underline-offset-4">{t('requestCount', { count: row.original.request_count })}</Link>,
      },
    ],
    [t, i18n.language],
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('impersonationTitle')}</h1>
        {sessions.isSuccess ? <p className="text-sm text-muted-foreground">{t('sessionsShown', { count: sessions.data.items.length })}</p> : null}
      </header>
      <form role="search" className="flex flex-wrap items-end gap-3" onSubmit={(e) => e.preventDefault()}>
        <div className="space-y-1">
          <Label htmlFor="imp-active">{t('filterActive')}</Label>
          <Select
            id="imp-active"
            value={active ?? ''}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              if (e.target.value) next.set('active', e.target.value);
              else next.delete('active');
              setParams(next, { replace: true });
            }}
          >
            <option value="">{t('filterActiveAll')}</option>
            <option value="true">{t('filterActiveYes')}</option>
            <option value="false">{t('filterActiveNo')}</option>
          </Select>
        </div>
        {tenantId ? (
          <p className="text-sm text-muted-foreground">
            {t('filteredByTenant')}{' '}
            <Link to="/admin/support-sessions" className="underline underline-offset-4">{t('clearFilter')}</Link>
          </p>
        ) : null}
      </form>
      <DataTable
        columns={columns}
        data={sessions.data?.items ?? []}
        isPending={sessions.isPending}
        isError={sessions.isError}
        loadingMessage={t('loading')}
        errorMessage={t('loadError')}
        emptyMessage={t('noSessions')}
      />
    </div>
  );
}
