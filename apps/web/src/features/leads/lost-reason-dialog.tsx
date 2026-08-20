import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { lostReasonLabel } from '@dealpilot/core';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Label, Select } from '@dealpilot/ui';
import { useLostReasons } from './lost-reason-api.js';

/**
 * F-53 (leads.md §11): the LostReasonModal — selecting `lost` opens this
 * instead of firing the PATCH, because the API refuses a loss without a WHY
 * and a 422 after the fact is a worse conversation than a pick-list before.
 */
export function LostReasonDialog({
  open,
  orgId,
  storeId,
  pending,
  onConfirm,
  onClose,
}: {
  open: boolean;
  orgId: string | undefined;
  /** Narrows the pick-list to org-wide reasons plus this store's own. */
  storeId: string | null | undefined;
  pending: boolean;
  onConfirm: (reasonId: string, note: string | null) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation('leads');
  const reasons = useLostReasons(orgId, { enabled: open, storeId: storeId ?? undefined });
  const [reasonId, setReasonId] = useState('');
  const [note, setNote] = useState('');
  const items = reasons.data?.items ?? [];

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          // A dialog is per-decision, not per-page: yesterday's pick must not
          // preload tomorrow's loss (or another lead's).
          setReasonId('');
          setNote('');
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogTitle>{t('lostModal_title')}</DialogTitle>
        <DialogDescription>{t('lostModal_body')}</DialogDescription>
        <div className="mt-3 space-y-3">
          {reasons.isPending ? (
            <p aria-busy="true" className="text-sm text-muted-foreground">
              {t('lostModal_loading')}
            </p>
          ) : null}
          {reasons.isError ? (
            <p role="alert" className="text-sm text-danger-text">
              {t('lostModal_loadError')}
            </p>
          ) : null}
          {reasons.isSuccess && items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('lostModal_none')}</p>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="lost-reason">{t('lostModal_reason')}</Label>
            <Select id="lost-reason" value={reasonId} onChange={(e) => setReasonId(e.target.value)}>
              <option value="" disabled>
                {t('lostModal_pick')}
              </option>
              {items.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.icon} {lostReasonLabel(r, i18n.language)}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="lost-note">{t('lostModal_note')}</Label>
            <Input
              id="lost-note"
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Dialog.Close
            render={
              <Button type="button" variant="outline">
                {t('lostModal_cancel')}
              </Button>
            }
          />
          <Button
            type="button"
            variant="destructive"
            disabled={reasonId === '' || pending}
            onClick={() => onConfirm(reasonId, note.trim() === '' ? null : note.trim())}
          >
            {pending ? t('lostModal_saving') : t('lostModal_confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog.Root>
  );
}
