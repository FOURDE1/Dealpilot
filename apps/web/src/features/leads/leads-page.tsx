import { useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { DataTable, buttonVariants, type ColumnDef } from '@dealpilot/ui';
import type { LeadT } from '@dealpilot/schemas';
import { useLeads } from './api.js';
import { LEAD_SOURCE_KEYS, LEAD_STATUS_KEYS, leadDisplayName } from './labels.js';

export function LeadsPage() {
  const { t, i18n } = useTranslation('leads');
  const leads = useLeads();

  const columns = useMemo<ColumnDef<LeadT, unknown>[]>(
    () => [
      {
        accessorKey: 'last_name',
        header: t('name'),
        cell: ({ row }) => (
          <Link to={`/leads/${row.original.id}`} className="font-medium text-primary hover:underline">
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
