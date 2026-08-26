import { useMemo, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, Input, Label, Select, buttonVariants, type ColumnDef } from '@dealpilot/ui';
import { OrganizationStatus, PlanTier, type AdminTenantT, type OrganizationStatusT, type PlanTierT } from '@dealpilot/schemas';
import { usePageTitle } from '../../shared/use-page-title.js';
import { useAdminMe, useAdminPlans, useAdminTenants } from './api.js';
import { STATUS_CLASSES, STATUS_KEYS, TIER_KEYS } from './labels.js';

/**
 * F-69 — the tenant directory (admin-console.md §11 `GET /admin/tenants`).
 * Filters live in the URL so a view is shareable; the list is keyset-paged
 * ("load more"), never a count — the header says how many are SHOWN and
 * whether more exist. Columns are not client-sortable: sorting a partial
 * page would order 25 of 300 and call it the order. The "new tenant" link
 * (F-70) is offered only to a caller holding `tenants:create` — the server
 * would refuse everyone else, so nobody else is shown the door.
 */

function isStatus(v: string | null): v is OrganizationStatusT {
  return v !== null && (OrganizationStatus.options as readonly string[]).includes(v);
}
function isTier(v: string | null): v is PlanTierT {
  return v !== null && (PlanTier.options as readonly string[]).includes(v);
}

export function TenantDirectoryPage() {
  const { t, i18n } = useTranslation('admin');
  const { t: tOrgs } = useTranslation('orgs');
  usePageTitle(t('tenantsTitle'));
  const [params, setParams] = useSearchParams();
  const filters = {
    status: isStatus(params.get('status')) ? (params.get('status') as OrganizationStatusT) : undefined,
    plan: isTier(params.get('plan')) ? (params.get('plan') as PlanTierT) : undefined,
    q: params.get('q') ?? undefined,
  };
  const tenants = useAdminTenants(filters);
  const plans = useAdminPlans();
  const me = useAdminMe();
  const canCreate = me.data?.capabilities.includes('tenants:create') ?? false;
  const rows = useMemo(() => tenants.data?.pages.flatMap((p: { items: AdminTenantT[] }) => p.items) ?? [], [tenants.data]);
  const fmtDate = (iso: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(iso));

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const next = new URLSearchParams();
    for (const key of ['status', 'plan', 'q'] as const) {
      const v = String(form.get(key) ?? '').trim();
      if (v) next.set(key, v);
    }
    setParams(next, { replace: true });
  };

  const columns = useMemo<ColumnDef<AdminTenantT, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('colName'),
        enableSorting: false,
        cell: ({ row }) => (
          <Link to={`/admin/tenants/${row.original.id}`} className="font-medium underline underline-offset-4">
            {row.original.name}
          </Link>
        ),
      },
      { accessorKey: 'slug', header: t('colSlug'), enableSorting: false, cell: ({ row }) => <span className="font-mono text-xs">{row.original.slug}</span> },
      {
        accessorKey: 'status',
        header: t('colStatus'),
        enableSorting: false,
        cell: ({ row }) => (
          <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_CLASSES[row.original.status]}`}>
            {tOrgs(STATUS_KEYS[row.original.status])}
          </span>
        ),
      },
      { accessorKey: 'plan_code', header: t('colPlan'), enableSorting: false, cell: ({ row }) => tOrgs(TIER_KEYS[row.original.plan_code]) },
      { accessorKey: 'store_count', header: t('colStores'), enableSorting: false },
      { accessorKey: 'member_count', header: t('colMembers'), enableSorting: false },
      { accessorKey: 'created_at', header: t('colCreated'), enableSorting: false, cell: ({ row }) => fmtDate(row.original.created_at) },
      {
        accessorKey: 'trial_ends_at',
        header: t('colTrialEnds'),
        enableSorting: false,
        // Text says "ended", never a colour alone; a tenant past its trial
        // that was activated keeps the date as history, without the marker.
        cell: ({ row }) => {
          const { status, trial_ends_at } = row.original;
          if (!trial_ends_at) return '—';
          const ended = status === 'trial' && new Date(trial_ends_at).getTime() < Date.now();
          return `${fmtDate(trial_ends_at)}${ended ? ` ${t('trialEnded')}` : ''}`;
        },
      },
    ],
    [t, tOrgs, i18n.language],
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('tenantsTitle')}</h1>
        <div className="flex flex-wrap items-center gap-3">
          {tenants.isSuccess ? (
            <p className="text-sm text-muted-foreground">
              {t(tenants.hasNextPage ? 'tenantShownMore' : 'tenantShown', { count: rows.length })}
            </p>
          ) : null}
          {canCreate ? (
            <Link to="/admin/tenants/new" className={buttonVariants({ size: 'sm' })}>{t('newTenant')}</Link>
          ) : null}
        </div>
      </header>

      {/*
        The inputs are keyed on the URL AND on the plan catalogue's arrival,
        so back/forward and a late-loading option list both re-apply the
        values the list is actually filtered by (review).
      */}
      <form key={`${params.toString()}|${plans.isSuccess ? 'plans' : ''}`} role="search" onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="tenant-status">{t('filterStatus')}</Label>
          <Select id="tenant-status" name="status" defaultValue={filters.status ?? ''}>
            <option value="">{t('all')}</option>
            {OrganizationStatus.options.map((s) => (
              <option key={s} value={s}>{tOrgs(STATUS_KEYS[s])}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="tenant-plan">{t('filterPlan')}</Label>
          <Select id="tenant-plan" name="plan" defaultValue={filters.plan ?? ''}>
            <option value="">{t('all')}</option>
            {(plans.data?.items ?? []).map((p) => (
              <option key={p.id} value={p.code}>{tOrgs(TIER_KEYS[p.code])}</option>
            ))}
          </Select>
        </div>
        <div className="min-w-56 space-y-1">
          <Label htmlFor="tenant-q">{t('searchLabel')}</Label>
          <Input id="tenant-q" name="q" type="search" maxLength={80} defaultValue={filters.q ?? ''} />
        </div>
        <Button type="submit" size="sm">{t('searchButton')}</Button>
      </form>

      <DataTable
        columns={columns}
        data={rows}
        isPending={tenants.isPending}
        isError={tenants.isError}
        loadingMessage={t('loading')}
        errorMessage={t('loadError')}
        emptyMessage={t('noTenants')}
      />
      {tenants.hasNextPage ? (
        <Button type="button" variant="outline" size="sm" disabled={tenants.isFetchingNextPage} onClick={() => void tenants.fetchNextPage()}>
          {t('loadMore')}
        </Button>
      ) : null}
    </div>
  );
}
