import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../../shared/use-page-title.js';
import { DataTable, buttonVariants, type ColumnDef } from '@dealpilot/ui';
import type { LeadT } from '@dealpilot/schemas';
import { Label, Select } from '@dealpilot/ui';
import { useOrganizations } from '../organizations/api.js';
import { useLeads } from './api.js';
import { useSession } from '../../shared/auth/client.js';
import { useMembers } from '../team/api.js';
import { scoreBand } from '@dealpilot/core';
import {
  LEAD_SOURCE_KEYS, LEAD_STATUS_KEYS, SCORE_BAND_CLASSES, SCORE_BAND_KEYS, leadDisplayName,
} from './labels.js';

export function LeadsPage() {
  const { t, i18n } = useTranslation('leads');
  usePageTitle(t('title'));
  const orgs = useOrganizations();
  const multiOrg = (orgs.data?.items.length ?? 0) > 1;
  const [orgFilter, setOrgFilter] = useState('');
  // Multi-org users MUST scope the list (server 422s otherwise); single-org
  // users are scoped implicitly by their membership.
  const effectiveOrg = multiOrg ? orgFilter || orgs.data?.items[0]?.id : undefined;
  const { data: session } = useSession();
  const [mineOnly, setMineOnly] = useState(false);
  const leads = useLeads(effectiveOrg, {
    enabled: !orgs.isPending,
    assignedTo: mineOnly ? session?.user.id : undefined,
  });
  const members = useMembers(effectiveOrg ?? orgs.data?.items[0]?.id, { enabled: !orgs.isPending });
  const memberName = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members.data?.items ?? []) map.set(m.user_id, m.name);
    return map;
  }, [members.data]);

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
        accessorKey: 'score',
        header: t('scoreCol'),
        // §6.4's shared vocabulary, banded by the SAME function the engine
        // uses — the number and its colour cannot disagree. A null score is a
        // lead created before F-39; a dash, not a fake zero.
        cell: ({ row }) =>
          row.original.score === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${SCORE_BAND_CLASSES[scoreBand(row.original.score)]}`}
            >
              {row.original.score} · {t(SCORE_BAND_KEYS[scoreBand(row.original.score)])}
            </span>
          ),
      },
      {
        accessorKey: 'source',
        header: t('sourceCol'),
        cell: ({ row }) => t(LEAD_SOURCE_KEYS[row.original.source]),
      },
      {
        accessorKey: 'assigned_to',
        header: t('assignedTo'),
        cell: ({ row }) =>
          row.original.assigned_to
            ? (memberName.get(row.original.assigned_to) ?? t('formerMember'))
            : t('unassigned'),
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
    [t, i18n.language, memberName],
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-y-2 gap-3">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <span className="flex flex-wrap items-center gap-4">
          <label htmlFor="my-leads" className="flex items-center gap-2 text-sm max-lg:min-h-11">
            <input
              id="my-leads"
              type="checkbox"
              checked={mineOnly}
              onChange={(e) => setMineOnly(e.target.checked)}
              className="size-4 accent-[var(--primary)]"
            />
            {t('myLeads')}
          </label>
          <Link to="/leads/scoring" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            {t('scoringRulesLink')}
          </Link>
          <Link to="/leads/distribution" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            {t('distributionLink')}
          </Link>
          <Link to="/leads/assignment" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            {t('assignmentRulesLink')}
          </Link>
          <Link to="/leads/new" className={buttonVariants()}>
            {t('newLead')}
          </Link>
        </span>
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
