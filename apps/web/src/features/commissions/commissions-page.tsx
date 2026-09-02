import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../../shared/use-page-title.js';
import { BackLink } from '../../shared/ui/back-link.js';
import {
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Label,
  Select,
  type ColumnDef,
} from '@dealpilot/ui';
import type { CommissionClawbackT, CommissionT } from '@dealpilot/schemas';
import { useOrganizations } from '../organizations/api.js';
import { useMembers } from '../team/api.js';
import { usePipelineDeals } from '../deals/api.js';
import { useLeadNames } from '../leads/api.js';
import { leadDisplayName } from '../leads/labels.js';
import { formatCents, parseMoneyToCents } from '../deals/money.js';
import { ApiError } from '../../shared/api/client.js';
import { can, usePermissionsMine } from '../../shared/permissions.js';
import { useClawbacks, useCommissions, useConfirmClawback, useFlagClawback } from './api.js';

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

/**
 * Flag-dialog amount validation (T-W3). parseMoneyToCents, NEVER parseFloat:
 * parseFloat('1 375') === 1 and parseFloat('500,50') === 500 — an FR-typed
 * amount would silently record a wrong reversal that passes every server
 * check (A3). Valid means 0 < cents ≤ the line's amount, mirroring the
 * server's own 422s.
 */
export function parseClawbackAmount(raw: string, maxCents: number): number | null {
  const cents = parseMoneyToCents(raw);
  return cents === null || cents <= 0 || cents > maxCents ? null : cents;
}

export function CommissionsPage() {
  const { t, i18n } = useTranslation('commissions');
  usePageTitle(t('title'));
  const orgs = useOrganizations();
  const multiOrg = (orgs.data?.items.length ?? 0) > 1;
  const [orgFilter, setOrgFilter] = useState('');
  const orgId = multiOrg ? orgFilter || orgs.data?.items[0]?.id : orgs.data?.items[0]?.id;
  const commissions = useCommissions(multiOrg ? orgId : undefined, { enabled: !orgs.isPending });
  // F-78 zero-request pattern: buttons render only on `can` — the server stays
  // the authority (403s still handled). The clawback LIST is fetched for every
  // member: the server self-filters (f09 clamp), and a salesperson must see
  // the badge on their own flagged line.
  const mine = usePermissionsMine(multiOrg ? orgId : undefined, { enabled: !orgs.isPending });
  const canClawback = can(mine.data, 'commission:clawback');
  const clawbacks = useClawbacks(multiOrg ? orgId : undefined, { enabled: !orgs.isPending });
  const flagClawback = useFlagClawback();
  const confirmClawback = useConfirmClawback();
  const clawbackByCommission = useMemo(
    () => new Map((clawbacks.data?.items ?? []).map((cc) => [cc.commission_id, cc])),
    [clawbacks.data],
  );
  // Flag dialog state (prefill happens at open — the handler seeds all four).
  const [flagRow, setFlagRow] = useState<CommissionT | null>(null);
  const [flagReason, setFlagReason] = useState('');
  const [flagAmount, setFlagAmount] = useState('');
  const [flagError, setFlagError] = useState<string | null>(null);
  // Confirm dialog state — reads the STORED row, no inputs (R4/A7).
  const [confirmCc, setConfirmCc] = useState<CommissionClawbackT | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
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
            <Link to={`/leads/${ref.leadId}`} className="text-primary-text underline-offset-4 hover:underline">
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
      {
        id: 'clawback',
        header: t('clawbackCol'),
        // A9 — EXHAUSTIVE branches; nothing disabled-but-visible.
        cell: ({ row }) => {
          const c = row.original;
          // 1. A clawback line is not itself clawbackable.
          if (c.kind === 'clawback') return '—';
          const cc = clawbackByCommission.get(c.id);
          // 2. Flagged → badge, plus the confirm trigger ONLY when permitted.
          if (cc?.status === 'flagged') {
            return (
              <span className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning-text">
                  {t('statusFlagged')}
                </span>
                {canClawback ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setConfirmError(null);
                      setConfirmCc(cc);
                    }}
                  >
                    {t('clawbackConfirm')}
                  </Button>
                ) : null}
              </span>
            );
          }
          // 3. Reversed → terminal badge. The 'définitive' copy is reachable
          // beyond the title attribute via the sr-only span (A8, WCAG 2.2 AA).
          if (cc?.status === 'reversed') {
            return (
              <span
                className="rounded-full bg-success-bg px-2 py-0.5 text-xs font-medium text-success-text"
                title={t('clawbackTerminal')}
              >
                {t('statusReversed')}
                <span className="sr-only"> {t('clawbackTerminal')}</span>
              </span>
            );
          }
          // 4. No clawback and (no permission OR nothing paid — the $0 loss
          // line is a real, reachable row) → em-dash.
          if (!canClawback || c.amount_cents <= 0) return '—';
          // 5. Permitted, positive, unflagged → the flag trigger.
          return (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setFlagReason('');
                setFlagAmount(formatCents(c.amount_cents, locale));
                setFlagError(null);
                setFlagRow(c);
              }}
            >
              {t('clawbackAction')}
            </Button>
          );
        },
      },
    ],
    [t, locale, memberName, dealLead, clawbackByCommission, canClawback],
  );

  const total = monthTotal(commissions.data?.items ?? []);
  const flagAmountInvalid =
    flagRow !== null && flagAmount.trim() !== '' && parseClawbackAmount(flagAmount, flagRow.amount_cents) === null;

  function handleFlag() {
    if (!flagRow || !orgId) return;
    setFlagError(null);
    const cents = parseClawbackAmount(flagAmount, flagRow.amount_cents);
    if (cents === null) {
      setFlagError(t('clawbackInvalidAmount'));
      return;
    }
    flagClawback
      .mutateAsync({
        organization_id: orgId,
        commission_id: flagRow.id,
        reason: flagReason.trim(),
        reversed_amount_cents: cents,
      })
      .then(() => setFlagRow(null))
      .catch((err: unknown) => {
        if (!(err instanceof ApiError)) {
          setFlagError(t('genericError'));
          throw err;
        }
        // The error map: 409 duplicate (partial-index refusal), 422
        // clawback_terminal, field 422s by path, everything else generic.
        if (err.status === 409) setFlagError(t('clawbackAlreadyFlagged'));
        else if (err.errorCode === 'clawback_terminal') setFlagError(t('clawbackTerminal'));
        else if (err.status === 422 && err.fieldPath === 'reversed_amount_cents')
          setFlagError(t('clawbackInvalidAmount'));
        else if (err.status === 422) setFlagError(t('checkFields'));
        else setFlagError(t('genericError'));
      });
  }

  function handleConfirm() {
    if (!confirmCc) return;
    setConfirmError(null);
    confirmClawback
      .mutateAsync(confirmCc.id)
      .then(() => setConfirmCc(null))
      .catch((err: unknown) => {
        if (!(err instanceof ApiError)) {
          setConfirmError(t('genericError'));
          throw err;
        }
        // 422 clawback_cap_reached: the (deal, person) clawback slot is taken
        // by a sibling line (same-person sale+override edge) — A12's surface.
        if (err.errorCode === 'clawback_cap_reached') setConfirmError(t('clawbackCapReached'));
        else if (err.errorCode === 'already_reversed' || err.errorCode === 'clawback_terminal')
          setConfirmError(t('clawbackTerminal'));
        else setConfirmError(t('genericError'));
      });
  }

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
      <Dialog.Root open={flagRow !== null} onOpenChange={(open) => (!open ? setFlagRow(null) : undefined)}>
        <DialogContent>
          <DialogTitle>{t('clawbackTitle')}</DialogTitle>
          <DialogDescription>{t('clawbackDesc')}</DialogDescription>
          <div className="mt-3 space-y-3">
            <div className="space-y-1">
              <Label htmlFor="clawback-reason">{t('clawbackReason')}</Label>
              <Input
                id="clawback-reason"
                value={flagReason}
                onChange={(e) => setFlagReason(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="clawback-amount">{t('clawbackAmount')}</Label>
              <Input
                id="clawback-amount"
                inputMode="decimal"
                value={flagAmount}
                aria-invalid={flagAmountInvalid || undefined}
                aria-describedby={flagAmountInvalid ? 'clawback-amount-error' : 'clawback-amount-max'}
                className={flagAmountInvalid ? 'border-danger-border' : undefined}
                onChange={(e) => setFlagAmount(e.target.value)}
              />
              <p id="clawback-amount-max" className="text-xs text-muted-foreground">
                {t('clawbackAmountMax', {
                  max: flagRow ? formatCents(flagRow.amount_cents, locale) : '',
                })}
              </p>
              {flagAmountInvalid ? (
                <p id="clawback-amount-error" role="alert" className="text-xs text-danger-text">
                  {t('clawbackInvalidAmount')}
                </p>
              ) : null}
            </div>
            {flagError ? (
              <p role="alert" className="text-sm text-danger-text">
                {flagError}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Dialog.Close
                render={
                  <Button type="button" variant="outline">
                    {t('cancel')}
                  </Button>
                }
              />
              <Button
                type="button"
                disabled={
                  flagClawback.isPending ||
                  flagReason.trim().length < 3 ||
                  flagAmount.trim() === '' ||
                  flagAmountInvalid
                }
                onClick={handleFlag}
              >
                {t('clawbackSubmit')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog.Root>
      <Dialog.Root open={confirmCc !== null} onOpenChange={(open) => (!open ? setConfirmCc(null) : undefined)}>
        <DialogContent>
          <DialogTitle>{t('clawbackConfirmTitle')}</DialogTitle>
          {/* No inputs: the server derives the negative line from the STORED
              row (R4); the body restates that amount and the EN-COURS period,
              and the définitive sentence is visible BEFORE the action (A8). */}
          <DialogDescription>
            {confirmCc
              ? t('clawbackConfirmBody', {
                  amount: formatCents(confirmCc.reversed_amount_cents, locale),
                })
              : ''}
          </DialogDescription>
          {confirmError ? (
            <p role="alert" className="mt-3 text-sm text-danger-text">
              {confirmError}
            </p>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close
              render={
                <Button type="button" variant="outline">
                  {t('cancel')}
                </Button>
              }
            />
            {/* Distinct accessible name (« Confirmer », dialog-scoped) — never
                strict-mode-collides with the row's « Confirmer la reprise ». */}
            <Button type="button" disabled={confirmClawback.isPending} onClick={handleConfirm}>
              {t('clawbackConfirmSubmit')}
            </Button>
          </div>
        </DialogContent>
      </Dialog.Root>
    </div>
  );
}
