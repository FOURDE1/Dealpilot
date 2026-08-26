import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Label } from '@dealpilot/ui';
import type { AdminTenantDetailT, OrganizationStatusT } from '@dealpilot/schemas';
import { ApiError } from '../../shared/api/client.js';
import { useChangeTenantStatus } from './api.js';
import { DESTRUCTIVE_TARGETS, STATUS_KEYS, TRANSITION_EFFECT_KEYS } from './labels.js';

/**
 * F-69 — one lifecycle transition (admin-console.md §4.2). The dialog says
 * what will happen, demands a reason, and for a destructive target makes
 * the person type the slug back. It sends `expected_from` so a status that
 * moved under them is a 409, never a silent second change — and on that 409
 * the tenant is refetched, so the buttons and `expected_from` catch up.
 *
 * Validation is spoken, not just disabled: every refusal has text tied to
 * its field (WCAG 3.3.1), and Confirm stays reachable so the reason can be
 * announced on submit.
 */

const TEXTAREA_CLASSES =
  'w-full rounded-md border border-input bg-input-bg px-3 py-2 text-sm text-foreground ' +
  'outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

export function StatusTransitionDialog({
  tenant,
  to,
  onClose,
}: {
  tenant: AdminTenantDetailT;
  to: OrganizationStatusT | null;
  onClose: (changed?: { status: OrganizationStatusT; sessionsRevoked: number }) => void;
}) {
  const { t } = useTranslation('admin');
  const { t: tOrgs } = useTranslation('orgs');
  const change = useChangeTenantStatus(tenant.id);
  const [reason, setReason] = useState('');
  const [restricted, setRestricted] = useState(false);
  const [confirmSlug, setConfirmSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const destructive = to !== null && DESTRUCTIVE_TARGETS.has(to);

  useEffect(() => {
    if (to) {
      setReason('');
      setRestricted(false);
      setConfirmSlug('');
      setError(null);
      setTouched(false);
      requestAnimationFrame(() => reasonRef.current?.focus());
    }
  }, [to]);

  if (!to) return null;

  const reasonShort = reason.trim().length < 5;
  const slugMismatch = destructive && confirmSlug.trim() !== tenant.slug;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (reasonShort) {
      reasonRef.current?.focus();
      return;
    }
    if (slugMismatch) return;
    try {
      const result = await change.mutateAsync({
        status: to,
        expected_from: tenant.status,
        reason: reason.trim(),
        restricted: to === 'suspended' ? restricted : false,
        ...(destructive ? { confirm_slug: confirmSlug.trim() } : {}),
      });
      onClose({ status: result.status, sessionsRevoked: result.sessions_revoked });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'invalid_transition') setError(t('transitionConflict'));
      else if (err instanceof ApiError && err.code === 'stale_status') setError(t('staleStatus'));
      else setError(t('saveError'));
    }
  };

  return (
    <Dialog.Root open onOpenChange={(open: boolean) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogTitle>{t('transitionTitle', { status: tOrgs(STATUS_KEYS[to]) })}</DialogTitle>
        <DialogDescription>
          {t(TRANSITION_EFFECT_KEYS[to])}
          {destructive ? ` ${t('sessionsToRevoke', { count: tenant.member_count })}` : ''}
        </DialogDescription>
        <form onSubmit={(e) => void submit(e)} noValidate className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="transition-reason">{t('reason')}</Label>
            <textarea
              id="transition-reason"
              ref={reasonRef}
              required
              maxLength={500}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={touched && reasonShort}
              aria-describedby="transition-reason-hint"
              className={TEXTAREA_CLASSES}
            />
            <p id="transition-reason-hint" className={`text-xs ${touched && reasonShort ? 'text-danger-text' : 'text-muted-foreground'}`}>
              {t('reasonRequired')}
            </p>
          </div>
          {to === 'suspended' ? (
            <label htmlFor="transition-restricted" className="flex min-h-11 items-center gap-2 text-sm">
              <input id="transition-restricted" type="checkbox" className="size-4" checked={restricted} onChange={(e) => setRestricted(e.target.checked)} aria-describedby="transition-restricted-hint" />
              <span>
                {t('restrictedLabel')}
                <span id="transition-restricted-hint" className="block text-xs text-muted-foreground">{t('restrictedHint')}</span>
              </span>
            </label>
          ) : null}
          {destructive ? (
            <div className="space-y-1">
              <Label htmlFor="transition-slug">{t('confirmSlug', { slug: tenant.slug })}</Label>
              <Input
                id="transition-slug"
                value={confirmSlug}
                onChange={(e) => setConfirmSlug(e.target.value)}
                autoComplete="off"
                aria-invalid={touched && slugMismatch}
                aria-describedby={confirmSlug !== '' && slugMismatch ? 'transition-slug-error' : undefined}
              />
              {confirmSlug !== '' && slugMismatch ? (
                <p id="transition-slug-error" className="text-xs text-danger-text">{t('confirmSlugMismatch')}</p>
              ) : null}
            </div>
          ) : null}
          {error ? <p role="alert" className="text-sm text-danger-text">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onClose()}>{t('cancel')}</Button>
            <Button type="submit" size="sm" variant={destructive ? 'destructive' : 'default'} disabled={change.isPending}>
              {t('confirm')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog.Root>
  );
}
