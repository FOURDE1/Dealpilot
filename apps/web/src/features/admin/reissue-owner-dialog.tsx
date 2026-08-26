import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Label } from '@dealpilot/ui';
import type { AdminTenantDetailT, OwnerInvitationReissuedT } from '@dealpilot/schemas';
import { ApiError } from '../../shared/api/client.js';
import { useReissueOwnerInvitation } from './api.js';

/**
 * F-70 — re-send or correct the founding owner's seat (admin-console.md
 * §4.3) while the tenant still has no owner. The open seat is revoked and a
 * new link goes to the address typed here; once an owner is active the
 * server answers 409 and the tenant's own invitation screen is the door.
 */
export function ReissueOwnerDialog({
  tenant,
  open,
  onClose,
}: {
  tenant: AdminTenantDetailT;
  open: boolean;
  onClose: (result?: OwnerInvitationReissuedT | 'owner_exists') => void;
}) {
  const { t } = useTranslation('admin');
  const reissue = useReissueOwnerInvitation(tenant.id);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setEmail(tenant.owner_invitation?.email ?? '');
      setName(tenant.owner_invitation?.name ?? '');
      setError(null);
      requestAnimationFrame(() => document.getElementById('reissue-email')?.focus());
    }
  }, [open, tenant.owner_invitation]);

  if (!open) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const result = await reissue.mutateAsync({ email: email.trim(), ...(name.trim() ? { name: name.trim() } : {}) });
      onClose(result);
    } catch (err) {
      if (err instanceof ApiError && err.errorCode === 'owner_exists') onClose('owner_exists');
      else if (err instanceof ApiError && err.status === 422) {
        // The label the person sees, never the wire field name (H-04).
        setError(t('invalidField', { field: err.fieldPath === 'name' ? t('ownerName') : t('ownerEmail') }));
      }
      else setError(t('saveError'));
    }
  };

  return (
    <Dialog.Root open onOpenChange={(isOpen: boolean) => { if (!isOpen) onClose(); }}>
      <DialogContent>
        <DialogTitle>{t('reissueTitle')}</DialogTitle>
        <DialogDescription>{t('reissueBody')}</DialogDescription>
        <form onSubmit={(e) => void submit(e)} noValidate className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="reissue-email">{t('ownerEmail')}</Label>
            <Input id="reissue-email" type="email" required maxLength={254} autoComplete="off" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? 'reissue-error' : undefined} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="reissue-name" optionalText={t('optional')}>{t('ownerName')}</Label>
            <Input id="reissue-name" maxLength={120} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {error ? <p id="reissue-error" role="alert" className="text-sm text-danger-text">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onClose()}>{t('cancel')}</Button>
            <Button type="submit" size="sm" disabled={reissue.isPending || email.trim() === ''}>{t('reissueConfirm')}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog.Root>
  );
}
