import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { BackLink } from '../../shared/ui/back-link.js';
import { usePageTitle } from '../../shared/use-page-title.js';
import { Button, DataTable, Label, Select, type ColumnDef } from '@dealpilot/ui';
import type { DispatchAssignmentT } from '@dealpilot/schemas';
import { ApiError } from '../../shared/api/client.js';
import { useOrganizations } from '../organizations/api.js';
import { usePipelineDeals } from '../deals/api.js';
import { useLeadNames } from '../leads/api.js';
import { leadDisplayName } from '../leads/labels.js';
import { formatCents } from '../deals/money.js';
import { useDispatchList, useDriverCompanies, useOrgFleet, useResendDispatchEmail, useUpdateDispatch } from './api.js';
import { can, usePermissionsMine } from '../../shared/permissions.js';

export const DISPATCH_STATUS_KEYS = {
  assigned: 'status_assigned',
  departed: 'status_departed',
  arrived: 'status_arrived',
  completed: 'status_completed',
  cancelled: 'status_cancelled',
} as const satisfies Record<DispatchAssignmentT['status'], string>;

/** Mirror of packages/core DISPATCH_TRANSITIONS — forward or cancelled, never a jump. */
const NEXT_STATUSES: Record<DispatchAssignmentT['status'], DispatchAssignmentT['status'][]> = {
  assigned: ['departed', 'cancelled'],
  departed: ['arrived', 'cancelled'],
  arrived: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export const DISPATCH_TYPE_KEYS = {
  delivery: 'type_delivery',
  pickup: 'type_pickup',
  transfer: 'type_transfer',
} as const satisfies Record<DispatchAssignmentT['dispatch_type'], string>;

/** The logistics board: every run, conflicts loud, one status track. */
export function DispatchPage() {
  const { t, i18n } = useTranslation('dispatch');
  usePageTitle(t('title'));
  const orgs = useOrganizations();
  const multiOrg = (orgs.data?.items.length ?? 0) > 1;
  const [orgFilter, setOrgFilter] = useState('');
  const orgId = multiOrg ? orgFilter || orgs.data?.items[0]?.id : orgs.data?.items[0]?.id;
  const scope = multiOrg ? orgId : undefined;
  const [conflictsOnly, setConflictsOnly] = useState(false);
  const runs = useDispatchList(scope, { enabled: !orgs.isPending, conflictsOnly });
  const companies = useDriverCompanies(scope, { enabled: !orgs.isPending });
  const deals = usePipelineDeals(scope, { enabled: !orgs.isPending });
  const leads = useLeadNames(scope, { enabled: !orgs.isPending });
  const orgFleet = useOrgFleet(scope, { enabled: !orgs.isPending });
  const mine = usePermissionsMine(scope, { enabled: !orgs.isPending });
  const canDispatch = can(mine.data, 'dispatch:read');
  const canUpdate = can(mine.data, 'dispatch:update');
  const minePending = mine.isPending;
  const update = useUpdateDispatch();
  const resend = useResendDispatchEmail();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const dealCustomer = useMemo(() => {
    const names = new Map<string, string>();
    for (const l of leads.data ?? []) names.set(l.id, leadDisplayName(l) ?? l.phone);
    const map = new Map<string, string>();
    for (const d of deals.data?.items ?? [])
      map.set(d.id, d.lead_id ? (names.get(d.lead_id) ?? '…') : '—');
    return map;
  }, [deals.data, leads.data]);

  const companyName = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of companies.data?.items ?? []) map.set(c.id, c.name);
    return map;
  }, [companies.data]);

  async function move(run: DispatchAssignmentT, status: DispatchAssignmentT['status']) {
    setError(null);
    setNotice(null);
    try {
      await update.mutateAsync({ id: run.id, body: { status } });
    } catch (err) {
      if (!(err instanceof ApiError)) {
        setError(t('genericError'));
        throw err;
      }
      setError(
        err.code === 'invalid_transition'
          ? t('invalidTransition')
          : err.errorCode === 'run_ended' || err.code === 'run_ended'
            ? t('runEnded')
            : t('genericError'),
      );
    }
  }

  const plateNumber = (id: string | null) =>
    id === null ? '—' : (orgFleet.data?.plates.find((p) => p.id === id)?.plate_number ?? '—');
  const chaserName = (id: string | null) =>
    id === null ? '—' : (orgFleet.data?.chasers.find((c) => c.id === id)?.name ?? '—');

  const columns = useMemo<ColumnDef<DispatchAssignmentT, unknown>[]>(
    () => [
      {
        accessorKey: 'deal_id',
        header: t('customer'),
        enableSorting: false,
        cell: ({ row }) => dealCustomer.get(row.original.deal_id) ?? row.original.deal_id.slice(0, 8),
      },
      {
        accessorKey: 'dispatch_type',
        header: t('typeCol'),
        cell: ({ row }) => t(DISPATCH_TYPE_KEYS[row.original.dispatch_type]),
      },
      {
        accessorKey: 'driver_company_id',
        header: t('driverCompany'),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.driver_company_id
            ? (companyName.get(row.original.driver_company_id) ?? '—')
            : '—',
      },
      {
        accessorKey: 'dealer_plate_id',
        header: t('plateCol'),
        enableSorting: false,
        cell: ({ row }) => <span className="font-mono text-[13px]">{plateNumber(row.original.dealer_plate_id)}</span>,
      },
      {
        accessorKey: 'chaser_vehicle_id',
        header: t('chaserCol'),
        enableSorting: false,
        cell: ({ row }) => chaserName(row.original.chaser_vehicle_id),
      },
      {
        accessorKey: 'cash_to_collect_cents',
        header: t('cashToCollect'),
        cell: ({ row }) =>
          row.original.cash_to_collect_cents > 0 ? (
            <span className="font-mono font-semibold tabular-nums">
              {formatCents(row.original.cash_to_collect_cents, i18n.language)}
            </span>
          ) : (
            '—'
          ),
      },
      {
        accessorKey: 'conflict_flag',
        header: t('conflictCol'),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.conflict_flag ? (
            <span className="block max-w-52">
              <span className="rounded bg-warning-bg px-1.5 py-0.5 text-xs font-medium text-warning-text">
                {t('conflict')}
              </span>
              {row.original.conflict_reason ? (
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {row.original.conflict_reason}
                </span>
              ) : null}
            </span>
          ) : null,
      },
      {
        accessorKey: 'status',
        header: t('statusCol'),
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <Label htmlFor={`run-status-${row.original.id}`} className="sr-only">
              {t('statusCol')}
            </Label>
            <Select
              id={`run-status-${row.original.id}`}
              value={row.original.status}
              disabled={update.isPending || !canUpdate || NEXT_STATUSES[row.original.status].length === 0}
              className="h-8 w-36"
              onChange={(e) => void move(row.original, e.target.value as DispatchAssignmentT['status'])}
            >
              {[row.original.status, ...NEXT_STATUSES[row.original.status]].map((sOpt) => (
                <option key={sOpt} value={sOpt}>
                  {t(DISPATCH_STATUS_KEYS[sOpt])}
                </option>
              ))}
            </Select>
          </span>
        ),
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">{t('actionsCol')}</span>,
        cell: ({ row }) =>
          row.original.status === 'completed' ||
          row.original.status === 'cancelled' ||
          row.original.driver_company_id === null ? null : (
            <span className="flex justify-end gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={resend.isPending}
                aria-label={t('resendFor', { name: dealCustomer.get(row.original.deal_id) ?? '' })}
                onClick={() => {
                  setError(null);
                  setNotice(null);
                  resend
                    .mutateAsync(row.original.id)
                    .then(({ sent }) => {
                      if (sent) setNotice(t('resendOk'));
                      else setError(t('mailFailed'));
                    })
                    .catch((err: unknown) => {
                      if (!(err instanceof ApiError)) {
                        setError(t('genericError'));
                        throw err;
                      }
                      setError(
                        err.errorCode === 'no_driver_company' || err.code === 'no_driver_company'
                          ? t('noDriverCompany')
                          : t('genericError'),
                      );
                    });
                }}
              >
                {t('resend')}
              </Button>
            </span>
          ),
      },
    ],
    [t, i18n.language, dealCustomer, companyName, update.isPending, resend.isPending, orgFleet.data, canUpdate],
  );

  return (
    <div className="space-y-4">
      <BackLink to="/">{t('back')}</BackLink>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <label htmlFor="dispatch-conflicts" className="flex items-center gap-2 text-sm max-lg:min-h-11">
          <input
            id="dispatch-conflicts"
            type="checkbox"
            checked={conflictsOnly}
            onChange={(e) => setConflictsOnly(e.target.checked)}
            className="size-4 accent-[var(--primary)]"
          />
          {t('conflictsOnly')}
        </label>
      </header>
      {multiOrg ? (
        <div className="max-w-xs space-y-1">
          <Label htmlFor="dispatch-org">{t('orgScope')}</Label>
          <Select id="dispatch-org" value={orgId ?? ''} onChange={(e) => setOrgFilter(e.target.value)}>
            {orgs.data?.items.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger-text">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-success-text">
          {notice}
        </p>
      ) : null}
      {runs.data?.truncated ? (
        <p className="text-sm text-muted-foreground">{t('truncated')}</p>
      ) : null}
      {!minePending && !canDispatch ? (
        <p role="alert" className="text-sm text-danger-text">
          {t('notAllowed')}
        </p>
      ) : (
      <DataTable
        columns={columns}
        data={runs.data?.items}
        isPending={orgs.isPending || runs.isPending}
        isError={runs.isError}
        loadingMessage={t('loading')}
        errorMessage={t('loadError')}
        emptyMessage={
          conflictsOnly ? t('emptyConflicts') : t('empty')
        }
      />
      )}
      <p className="text-sm text-muted-foreground">
        {t('companiesHint')}{' '}
        <Link to="/organizations" className="text-primary underline-offset-4 hover:underline">
          {t('companiesLink')}
        </Link>
      </p>
    </div>
  );
}
