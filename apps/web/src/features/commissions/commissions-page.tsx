import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../../shared/use-page-title.js';
import { BackLink } from '../../shared/ui/back-link.js';
import { DataTable, Label, Select, type ColumnDef } from '@dealpilot/ui';
import type { CommissionT } from '@dealpilot/schemas';
import { useOrganizations } from '../organizations/api.js';
import { useMembers } from '../team/api.js';
import { usePipelineDeals } from '../deals/api.js';
import { useLeadNames } from '../leads/api.js';
import { leadDisplayName } from '../leads/labels.js';
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
  usePageTitle(t('title'));
  const orgs = useOrganizations();
  const multiOrg = (orgs.data?.items.length ?? 0) > 1;
  const [orgFilter, setOrgFilter] = useState('');
  const orgId = multiOrg ? orgFilter || orgs.data?.items[0]?.id : orgs.data?.items[0]?.id;
  const commissions = useCommissions(multiOrg ? orgId : undefined, { enabled: !orgs.isPending });
  const members = useMembers(orgId, { enabled: !orgs.isPending });
  const deals = usePipelineDeals(multiOrg ? orgId : undefined, { enabled: !orgs.isPending });
  const leads = useLeadNames(multiOrg ? orgId : undefined, { enabled: !orgs.isPending });
  const dealLead = useMemo(() => {
    const names = new Map<string, string>();
    for (const l of leads.data ?? []) names.set(l.id, leadDisplayName(l) ?? l.phone);
    const map = new Map<string, { leadId: string | null; label: string }>();
    for (const d of deals.data?.items ?? [])
      map.set(d.id, { leadId: d.lead_id, label: d.lead_id ? (names.get(d.lead_id) ?? '…') : '—' });
    return map;
  }, [deals.data, leads.data]);
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
        cell: ({ row }) => {
          const ref = dealLead.get(row.original.deal_id);
          return ref?.leadId ? (
            <Link to={`/leads/${ref.leadId}`} className="text-primary underline-offset-4 hover:underline">
              {ref.label}
            </Link>
          ) : (
            <span className="font-mono text-[13px]">{row.original.deal_id.slice(0, 8)}</span>
          );
        },
      },
      {
        accessorKey: 'gross_for_commission_cents',
        header: t('grossForCommission'),
        // CR-10: a losing deal floors the commissionable gross at zero — showing
        // a bare $0.00 reads as a broken calculation. Say WHY, with the number.
        cell: ({ row }) => (
          <span className="block">
            <span className="font-mono tabular-nums">
              {formatCents(row.original.gross_for_commission_cents, locale)}
            </span>
            {row.original.total_gross_cents < 0 && row.original.gross_for_commission_cents === 0 ? (
              <span className="mt-0.5 block max-w-52 text-xs text-danger-text">
                {t('atLoss', { gross: formatCents(row.original.total_gross_cents, locale) })}
              </span>
            ) : null}
          </span>
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
    [t, locale, memberName, dealLead],
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
