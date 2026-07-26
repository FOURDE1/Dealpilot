import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, DialogContent, DialogTitle, Input, Label } from '@dealpilot/ui';
import type { DealChecklistItemT, DealT } from '@dealpilot/schemas';
import { ApiError } from '../../shared/api/client.js';
import { useSession } from '../../shared/auth/client.js';
import { useMembers } from '../team/api.js';
import { useDealChecklist, useUpdateChecklistItem } from './api.js';

/** Ticking or waiving the safety item is owner/gm territory (D-033 pending). */
const SAFETY_ROLES = new Set(['owner', 'gm']);

function ItemRow({
  item,
  dealFrozen,
  canManage,
  memberName,
  onError,
  dealId,
}: {
  item: DealChecklistItemT;
  dealFrozen: boolean;
  canManage: boolean;
  memberName: (id: string | null) => string | null;
  onError: (msg: string | null) => void;
  dealId: string;
}) {
  const { t, i18n } = useTranslation('checklist');
  const update = useUpdateChecklistItem(dealId);
  const [waiving, setWaiving] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmUnwaive, setConfirmUnwaive] = useState(false);
  const label = i18n.language.startsWith('fr') ? item.label_fr : item.label_en;
  const when = (iso: string | null) =>
    iso === null
      ? ''
      : new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
          new Date(iso),
        );
  const waived = item.overridden_at !== null;
  const done = item.completed_at !== null;
  const isSafety = item.code === 'safety';
  const canTick = !dealFrozen && (!isSafety || canManage);
  const canWaive = !dealFrozen && item.overridable && canManage && !done;

  async function send(body: Parameters<typeof update.mutateAsync>[0]['body']): Promise<boolean> {
    onError(null);
    try {
      await update.mutateAsync({ code: item.code, body });
      return true;
    } catch (err) {
      if (!(err instanceof ApiError)) {
        onError(t('genericError'));
        throw err;
      }
      onError(
        err.status === 409
          ? t('frozenError')
          : err.status === 403
            ? t('notAllowed')
            : err.code === 'hard_block'
              ? t('hardBlock')
              : t('genericError'),
      );
      return false;
    }
  }

  return (
    <li className="space-y-1 py-2 max-lg:py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label
          htmlFor={`chk-${item.code}`}
          className={`flex min-h-6 items-center gap-2 text-sm ${waived ? 'text-muted-foreground line-through' : ''}`}
        >
          <input
            id={`chk-${item.code}`}
            type="checkbox"
            checked={done}
            disabled={!canTick || waived || update.isPending}
            onChange={(e) => void send({ completed: e.target.checked })}
            className="size-4 accent-[var(--primary)]"
          />
          {label}
          {item.required ? null : <span className="text-xs text-muted-foreground">({t('optional')})</span>}
        </label>
        <span className="flex items-center gap-2">
          {done ? (
            <span className="text-xs text-success-text">
              {t('doneByAt', { name: memberName(item.completed_by) ?? t('formerMember'), at: when(item.completed_at) })}
            </span>
          ) : null}
          {waived ? (
            <span className="rounded bg-warning-bg px-1.5 py-0.5 text-xs font-medium text-warning-text">
              {t('waived')}
            </span>
          ) : null}
          {canWaive && !waived ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setWaiving((w) => !w)}>
              {t('waive')}
            </Button>
          ) : null}
          {waived && canManage && !dealFrozen ? (
            // Two clicks on purpose: reinstating erases the recorded reason.
            <Button
              type="button"
              variant={confirmUnwaive ? 'destructive' : 'ghost'}
              size="sm"
              disabled={update.isPending}
              onClick={() => {
                if (!confirmUnwaive) {
                  setConfirmUnwaive(true);
                  return;
                }
                setConfirmUnwaive(false);
                void send({ overridden: false });
              }}
              onBlur={() => setConfirmUnwaive(false)}
            >
              {confirmUnwaive ? t('unwaiveConfirm') : t('unwaive')}
            </Button>
          ) : null}
        </span>
      </div>
      {waived ? (
        <p className="text-xs text-muted-foreground">
          {t('waivedByAtWithReason', {
            name: memberName(item.overridden_by) ?? t('formerMember'),
            at: when(item.overridden_at),
            reason: item.override_reason ?? '',
          })}
        </p>
      ) : null}
      {waiving && !waived ? (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-muted/40 p-2">
          <div className="min-w-48 flex-1 space-y-1">
            <Label htmlFor={`waive-reason-${item.code}`}>{t('waiveReason')}</Label>
            <Input
              id={`waive-reason-${item.code}`}
              value={reason}
              maxLength={300}
              aria-invalid={reason.trim() !== '' && reason.trim().length < 3 ? true : undefined}
              aria-describedby={
                reason.trim() !== '' && reason.trim().length < 3
                  ? `waive-reason-${item.code}-error`
                  : undefined
              }
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={reason.trim().length < 3 || update.isPending}
            onClick={() => {
              void send({ overridden: true, override_reason: reason.trim() }).then((ok) => {
                // The typed reason survives a failed save.
                if (ok) {
                  setWaiving(false);
                  setReason('');
                }
              });
            }}
          >
            {t('confirmWaive')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setWaiving(false);
              setReason('');
            }}
          >
            {t('cancel')}
          </Button>
          {reason.trim() !== '' && reason.trim().length < 3 ? (
            <p id={`waive-reason-${item.code}-error`} role="alert" className="w-full text-xs text-danger-text">
              {t('reasonTooShort')}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** The F-08 panel: the gate between Signed and Delivered, item by item. */
export function ChecklistDialog({
  deal,
  dealLabel,
  onClose,
}: {
  deal: DealT | null;
  dealLabel?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation('checklist');
  const { data: session } = useSession();
  const checklist = useDealChecklist(deal?.id ?? '', { enabled: deal !== null });
  const members = useMembers(deal?.organization_id, { enabled: deal !== null });
  // Evidence must keep naming its author even after they leave the org.
  const removed = useMembers(deal?.organization_id, { enabled: deal !== null, status: 'revoked' });
  const [error, setError] = useState<string | null>(null);

  const me = members.data?.items.find((m) => m.user_id === session?.user.id);
  const canManage = me?.roles.some((r) => SAFETY_ROLES.has(r)) ?? false;
  const dealFrozen = deal?.delivered_at !== null && deal !== null;
  const memberName = (id: string | null) =>
    id === null
      ? null
      : (members.data?.items.find((m) => m.user_id === id)?.name ??
        removed.data?.items.find((m) => m.user_id === id)?.name ??
        null);

  const data = checklist.data;
  const doneCount = data?.items.filter((i) => i.completed_at !== null || i.overridden_at !== null).length ?? 0;

  return (
    <Dialog.Root open={deal !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[85svh] overflow-y-auto">
        <DialogTitle>
          {t('title')}
          {dealLabel ? <span className="text-muted-foreground"> — {dealLabel}</span> : null}
        </DialogTitle>
        {checklist.isPending && deal ? (
          <p className="mt-3 text-sm text-muted-foreground">{t('loading')}</p>
        ) : checklist.isError ? (
          <p role="alert" className="mt-3 text-sm text-danger-text">
            {t('loadError')}
          </p>
        ) : data && data.items.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t('noChecklist')}</p>
        ) : data ? (
          <div className="mt-3 space-y-3">
            {dealFrozen ? (
              <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">{t('frozen')}</p>
            ) : data.readiness.ready_for_delivery ? (
              <p role="status" className="rounded-md bg-success-bg px-3 py-2 text-sm font-medium text-success-text">
                {t('ready')}
              </p>
            ) : (
              <p className="rounded-md bg-warning-bg px-3 py-2 text-sm text-warning-text">
                {t('outstanding', { done: doneCount, total: data.items.length })}
                {data.readiness.hard_blocked ? ` ${t('safetyMissing')}` : ''}
              </p>
            )}
            {error ? (
              <p role="alert" className="text-sm text-danger-text">
                {error}
              </p>
            ) : null}
            <ul className="divide-y divide-border">
              {data.items.map((item) => (
                <ItemRow
                  key={item.code}
                  item={item}
                  dealId={deal?.id ?? ''}
                  dealFrozen={dealFrozen}
                  canManage={canManage}
                  memberName={memberName}
                  onError={setError}
                />
              ))}
            </ul>
          </div>
        ) : null}
        <div className="mt-4 flex justify-end">
          <Dialog.Close
            render={
              <Button type="button" variant="outline">
                {t('close')}
              </Button>
            }
          />
        </div>
      </DialogContent>
    </Dialog.Root>
  );
}
