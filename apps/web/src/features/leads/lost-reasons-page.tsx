import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, Input, Label, Select, type ColumnDef } from '@dealpilot/ui';
import type { LostReasonT } from '@dealpilot/schemas';
import { lostReasonLabel } from '@dealpilot/core';
import { usePageTitle } from '../../shared/use-page-title.js';
import { BackLink } from '../../shared/ui/back-link.js';
import { ApiError } from '../../shared/api/client.js';
import { can, usePermissionsMine } from '../../shared/permissions.js';
import { useOrganizations } from '../organizations/api.js';
import {
  useCreateLostReason,
  useDeleteLostReason,
  useLostReasons,
  useUpdateLostReason,
} from './lost-reason-api.js';

/**
 * F-53 — the lost-reason vocabulary manager (leads.md §11). Members see the
 * list (it is their pick-list); organization:update edits it. Both language
 * columns are always visible — a bilingual vocabulary hides neither.
 */
export function LostReasonsPage() {
  const { t, i18n } = useTranslation('leads');
  usePageTitle(t('lr_title'));
  const orgs = useOrganizations();
  const [orgFilter, setOrgFilter] = useState('');
  const multiOrg = (orgs.data?.items.length ?? 0) > 1;
  const effectiveOrg = multiOrg ? orgFilter || orgs.data?.items[0]?.id : orgs.data?.items[0]?.id;

  const reasons = useLostReasons(effectiveOrg, { enabled: !orgs.isPending, includeInactive: true });
  const mine = usePermissionsMine(effectiveOrg, { enabled: !orgs.isPending });
  const canManage = can(mine.data, 'organization:update');
  const create = useCreateLostReason();
  const update = useUpdateLostReason();
  const remove = useDeleteLostReason();

  const [name, setName] = useState('');
  const [nameFr, setNameFr] = useState('');
  const [icon, setIcon] = useState('📝');
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!effectiveOrg) return;
    setError(null);
    create
      .mutateAsync({
        organization_id: effectiveOrg,
        name: name.trim(),
        name_fr: nameFr.trim(),
        icon: icon.trim() || '📝',
        display_order: (reasons.data?.items.length ?? 0) + 1,
      })
      .then(() => {
        setName('');
        setNameFr('');
        setIcon('📝');
      })
      .catch((err: unknown) => {
        if (!(err instanceof ApiError)) throw err;
        setError(err.code === 'duplicate_name' ? t('lr_duplicate') : t('genericError'));
      });
  }

  function act(promise: Promise<unknown>, inUseMessage?: string) {
    setError(null);
    promise.catch((err: unknown) => {
      if (!(err instanceof ApiError)) throw err;
      setError(err.code === 'reason_in_use' && inUseMessage ? inUseMessage : t('genericError'));
    });
  }

  const columns: ColumnDef<LostReasonT, unknown>[] = [
    {
      accessorKey: 'icon',
      header: t('lr_icon'),
      cell: ({ row }) => <span aria-hidden="true">{row.original.icon}</span>,
    },
    { accessorKey: 'name', header: t('lr_name') },
    { accessorKey: 'name_fr', header: t('lr_nameFr') },
    {
      accessorKey: 'is_active',
      header: t('lr_active'),
      cell: ({ row }) =>
        row.original.is_active ? (
          <span className="inline-flex rounded-md bg-success-bg px-2 py-0.5 text-[11px] font-semibold text-success-text">
            {t('lr_activeYes')}
          </span>
        ) : (
          <span className="inline-flex rounded-md bg-secondary px-2 py-0.5 text-[11px] font-semibold text-secondary-foreground">
            {t('lr_activeNo')}
          </span>
        ),
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: t('lr_actions'),
            cell: ({ row }: { row: { original: LostReasonT } }) => (
              <span className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={update.isPending}
                  aria-label={`${row.original.is_active ? t('lr_deactivate') : t('lr_activate')} — ${lostReasonLabel(row.original, i18n.language)}`}
                  onClick={() =>
                    act(update.mutateAsync({ id: row.original.id, is_active: !row.original.is_active }))
                  }
                >
                  {row.original.is_active ? t('lr_deactivate') : t('lr_activate')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={remove.isPending}
                  aria-label={`${t('lr_delete')} — ${lostReasonLabel(row.original, i18n.language)}`}
                  onClick={() => act(remove.mutateAsync(row.original.id), t('lr_inUse'))}
                >
                  {t('lr_delete')}
                </Button>
              </span>
            ),
          } satisfies ColumnDef<LostReasonT, unknown>,
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 gap-y-2">
        <h1 className="text-2xl font-semibold">{t('lr_title')}</h1>
        <BackLink to="/leads">{t('beback_back')}</BackLink>
      </header>
      <p className="max-w-2xl text-sm text-muted-foreground">{t('lr_subtitle')}</p>
      {multiOrg ? (
        <div className="max-w-xs space-y-1">
          <Label htmlFor="lr-org">{t('organization')}</Label>
          <Select id="lr-org" value={effectiveOrg ?? ''} onChange={(e) => setOrgFilter(e.target.value)}>
            {orgs.data?.items.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      {canManage ? (
        <form
          onSubmit={submit}
          className="grid grid-cols-1 items-end gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_6rem_auto]"
        >
          <div className="space-y-1">
            <Label htmlFor="lr-name">{t('lr_name')}</Label>
            <Input id="lr-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lr-name-fr">{t('lr_nameFr')}</Label>
            <Input id="lr-name-fr" value={nameFr} maxLength={80} onChange={(e) => setNameFr(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lr-icon">{t('lr_icon')}</Label>
            <Input id="lr-icon" value={icon} maxLength={8} onChange={(e) => setIcon(e.target.value)} />
          </div>
          <Button type="submit" disabled={create.isPending || name.trim() === '' || nameFr.trim() === ''}>
            {create.isPending ? t('lr_adding') : t('lr_add')}
          </Button>
          {error ? (
            <p role="alert" className="text-sm text-danger-text sm:col-span-2 lg:col-span-4">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
      {!canManage && error ? (
        <p role="alert" className="text-sm text-danger-text">
          {error}
        </p>
      ) : null}

      <DataTable
        columns={columns}
        data={reasons.data?.items ?? []}
        isPending={reasons.isPending}
        isError={reasons.isError}
        loadingMessage={t('lr_loading')}
        errorMessage={t('genericError')}
        emptyMessage={t('lr_empty')}
      />
    </div>
  );
}
