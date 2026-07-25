import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { DataTable, buttonVariants, type ColumnDef } from '@dealpilot/ui';
import type { LeadT } from '@dealpilot/schemas';
import { Label, Select } from '@dealpilot/ui';
import { useOrganizations } from '../organizations/api.js';
import { useLeads } from './api.js';
import { LEAD_SOURCE_KEYS, LEAD_STATUS_KEYS, leadDisplayName } from './labels.js';

export function LeadsPage() {
  const { t, i18n } = useTranslation('leads');
  const orgs = useOrganizations();
  const multiOrg = (orgs.data?.items.length ?? 0) > 1;
  const [orgFilter, setOrgFilter] = useState('');
  // Multi-org users MUST scope the list (server 422s otherwise); single-org
  // users are scoped implicitly by their membership.
  const effectiveOrg = multiOrg ? orgFilter || orgs.data?.items[0]?.id : undefined;
  const leads = useLeads(effectiveOrg, { enabled: !orgs.isPending });

  const columns = useMemo<ColumnDef<LeadT, unknown>[]>(
    () => [
      {
        accessorKey: 'last_name',
        header: t('name'),
        cell: ({ row }) => (
          <Link
            to={`/leads/${row.original.id}`}
            className="font-medium text-primary hover:underline"
          >
            {leadDisplayName(row.original) ?? t('noName')}
          </Link>
        ),
      },
      {
        accessorKey: 'phone',
        header: t('phone'),
        cell: ({ row }) => <span className="font-mono text-[13px]">{row.original.phone}</span>,
      },
      {
        accessorKey: 'status',
        header: t('statusCol'),
        cell: ({ row }) => (
          <span className="inline-flex rounded-md bg-secondary px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-secondary-foreground">
            {t(LEAD_STATUS_KEYS[row.original.status])}
          </span>
        ),
      },
      {
        accessorKey: 'source',
        header: t('sourceCol'),
        cell: ({ row }) => t(LEAD_SOURCE_KEYS[row.original.source]),
      },
      {
        accessorKey: 'created_at',
        header: t('createdAt'),
        cell: ({ row }) =>
          new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
            new Date(row.original.created_at),
          ),
      },
    ],
    [t, i18n.language],
  );

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <Link to="/leads/new" className={buttonVariants()}>
          {t('newLead')}
        </Link>
      </header>
      {multiOrg ? (
        <div className="max-w-xs space-y-1">
          <Label htmlFor="leads-org-filter">{t('organization')}</Label>
          <Select
            id="leads-org-filter"
            value={effectiveOrg ?? ''}
            onChange={(e) => setOrgFilter(e.target.value)}
          >
            {(orgs.data?.items ?? []).map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      <DataTable
        columns={columns}
        data={leads.data?.items}
        isPending={leads.isPending}
        isError={leads.isError}
        loadingMessage={t('loading')}
        errorMessage={t('loadError')}
        emptyMessage={t('empty')}
      />
    </div>
  );
}
