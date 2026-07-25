import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { BackLink } from '../../shared/ui/back-link.js';
import { DataTable, Label, Select, type ColumnDef } from '@dealpilot/ui';
import type { CommissionT } from '@dealpilot/schemas';
import { useOrganizations } from '../organizations/api.js';
import { useMembers } from '../team/api.js';
import { formatCents } from '../deals/money.js';
import { useCommissions } from './api.js';

const KIND_KEYS = {
  sale: 'kind_sale',
  override: 'kind_override',
  clawback: 'kind_clawback',
} as const satisfies Record<CommissionT['kind'], string>;

/** Current-month total in cents (half-open month, local clock — display only). */
export function monthTotal(items: readonly Pick<CommissionT, 'amount_cents' | 'funded_at'>[], now = new Date()): number {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return items
    .filter((c) => {
      const at = new Date(c.funded_at);
      return at >= start && at < end;
    })
    .reduce((sum, c) => sum + c.amount_cents, 0);
}

export function CommissionsPage() {
  const { t, i18n } = useTranslation('commissions');
  const orgs = useOrganizations();
  const multiOrg = (orgs.data?.items.length ?? 0) > 1;
  const [orgFilter, setOrgFilter] = useState('');
  const orgId = multiOrg ? orgFilter || orgs.data?.items[0]?.id : orgs.data?.items[0]?.id;
  const commissions = useCommissions(multiOrg ? orgId : undefined, { enabled: !orgs.isPending });
  const members = useMembers(orgId, { enabled: !orgs.isPending });
  const memberName = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members.data?.items ?? []) map.set(m.user_id, m.name);
    return map;
  }, [members.data]);
  const locale = i18n.language;

  const columns = useMemo<ColumnDef<CommissionT, unknown>[]>(
    () => [
      {
        accessorKey: 'funded_at',
        header: t('fundedAt'),
        cell: ({ row }) =>
          new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(row.original.funded_at)),
      },
      { accessorKey: 'kind', header: t('kind'), cell: ({ row }) => t(KIND_KEYS[row.original.kind]) },
      {
        accessorKey: 'user_id',
        header: t('personCol'),
        cell: ({ row }) => memberName.get(row.original.user_id) ?? '—',
      },
      {
        accessorKey: 'deal_id',
        header: t('deal'),
        cell: ({ row }) => (
          <Link to="/pipeline" className="font-mono text-[13px] text-primary underline-offset-4 hover:underline">
            {row.original.deal_id.slice(0, 8)}
          </Link>
        ),
      },
      {
        accessorKey: 'gross_for_commission_cents',
        header: t('grossForCommission'),
        cell: ({ row }) => (
          <span className="font-mono tabular-nums">{formatCents(row.original.gross_for_commission_cents, locale)}</span>
        ),
      },
      {
        accessorKey: 'applied_rate',
        header: t('rateCol'),
        cell: ({ row }) =>
          new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 2 }).format(row.original.applied_rate),
      },
      {
        accessorKey: 'amount_cents',
        header: t('amount'),
        cell: ({ row }) => (
          <span className="font-mono font-semibold tabular-nums">{formatCents(row.original.amount_cents, locale)}</span>
        ),
      },
    ],
    [t, locale, memberName],
  );

  const total = monthTotal(commissions.data?.items ?? []);

  return (
    <div className="space-y-4">
      <BackLink to="/">{t('back')}</BackLink>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <p className="text-sm">
          {t('monthTotal')}{' '}
          <span className="font-mono text-base font-semibold tabular-nums">{formatCents(total, locale)}</span>
        </p>
      </header>
      {multiOrg ? (
        <div className="max-w-xs space-y-1">
          <Label htmlFor="comm-org">{t('orgScope')}</Label>
          <Select id="comm-org" value={orgId ?? ''} onChange={(e) => setOrgFilter(e.target.value)}>
            {orgs.data?.items.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      {commissions.data?.truncated ? (
        <p role="alert" className="text-sm text-danger-text">
          {t('truncatedWarning')}
        </p>
      ) : null}
      <DataTable
        columns={columns}
        data={commissions.data?.items}
        isPending={orgs.isPending || commissions.isPending}
        isError={commissions.isError}
        loadingMessage={t('loading')}
        errorMessage={t('loadError')}
        emptyMessage={t('empty')}
      />
    </div>
  );
}
