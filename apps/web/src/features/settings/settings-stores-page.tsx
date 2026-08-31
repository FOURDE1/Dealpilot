import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { DataTable, Label, Select, buttonVariants, type ColumnDef } from '@dealpilot/ui';
import type { StoreT } from '@dealpilot/schemas';
import { usePageTitle } from '../../shared/use-page-title.js';
import { BackLink } from '../../shared/ui/back-link.js';
import { can, usePermissionsMine } from '../../shared/permissions.js';
import { useOrganizations, useStores } from '../organizations/api.js';

/**
 * F-76 — /settings/stores: what each store's operating configuration holds,
 * at a glance. The columns are the facts the organization page's store table
 * does not show — timezone, texting number, whether hours are set (the
 * snapshot's own predicate: at least one day in `business_hours`), how many
 * holidays. Editing stays on the store's own form (one producer).
 */
export function SettingsStoresPage() {
  const { t } = useTranslation('settings');
  const { t: tOrgs } = useTranslation('orgs');
  usePageTitle(t('sec_stores'));
  const orgs = useOrganizations();
  const noOrg = orgs.isSuccess && orgs.data.items.length === 0;
  const multiOrg = (orgs.data?.items.length ?? 0) > 1;
  const [orgFilter, setOrgFilter] = useState('');
  const orgId = multiOrg ? orgFilter || orgs.data?.items[0]?.id : orgs.data?.items[0]?.id;
  const stores = useStores(orgId ?? '');
  const mine = usePermissionsMine(multiOrg ? orgId : undefined, { enabled: !orgs.isPending && !noOrg });
  const canCreate = can(mine.data, 'store:create');

  const columns = useMemo<ColumnDef<StoreT, unknown>[]>(
    () => [
      {
        id: 'store',
        accessorKey: 'name',
        header: t('col_store'),
        cell: ({ row }) => (
          <Link
            to={`/organizations/${row.original.organization_id}/stores/${row.original.id}`}
            className="font-medium text-primary-text underline-offset-4 hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      { id: 'code', accessorKey: 'code', header: t('col_code'), cell: ({ row }) => <span className="font-mono">{row.original.code}</span> },
      { id: 'timezone', accessorKey: 'timezone', header: t('col_timezone') },
      { id: 'sms', accessorFn: (s) => s.sms_number ?? '', header: t('col_sms'), cell: ({ row }) => row.original.sms_number ?? '—' },
      {
        id: 'hours',
        accessorFn: (s) => (Object.keys(s.business_hours).length > 0 ? 1 : 0),
        header: t('col_hours'),
        cell: ({ row }) => (Object.keys(row.original.business_hours).length > 0 ? t('hoursSet') : t('hoursUnset')),
      },
      { id: 'holidays', accessorFn: (s) => s.holiday_dates.length, header: t('col_holidays'), cell: ({ row }) => row.original.holiday_dates.length },
    ],
    [t],
  );

  return (
    <div className="space-y-6">
      <BackLink to="/settings">{t('title')}</BackLink>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{t('sec_stores')}</h1>
          <p className="text-sm text-muted-foreground">{t('storesSubtitle')}</p>
        </div>
        {canCreate && orgId ? (
          <Link to={`/organizations/${orgId}/stores/new`} className={buttonVariants({ size: 'sm' })}>
            {tOrgs('newStore')}
          </Link>
        ) : null}
      </header>

      {multiOrg ? (
        <div className="max-w-xs space-y-1">
          <Label htmlFor="settings-stores-org">{t('orgScope')}</Label>
          <Select id="settings-stores-org" value={orgId ?? ''} onChange={(e) => setOrgFilter(e.target.value)}>
            {orgs.data?.items.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      {noOrg ? (
        <div className="space-y-3 rounded-lg border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">{t('noOrg')}</p>
          <Link to="/organizations/new" className={buttonVariants({ size: 'sm' })}>
            {t('noOrgCta')}
          </Link>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={stores.data?.items}
          isPending={orgs.isPending || stores.isPending}
          isError={orgs.isError || stores.isError}
          loadingMessage={t('loading')}
          errorMessage={t('loadError')}
          emptyMessage={tOrgs('storesEmpty')}
        />
      )}
    </div>
  );
}
