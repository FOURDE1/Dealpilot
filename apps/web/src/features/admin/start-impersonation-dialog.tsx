import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Label, Select } from '@dealpilot/ui';
import { IMPERSONATION_REASON_MIN_CHARS, type AdminTenantDetailT, type ImpersonationModeT } from '@dealpilot/schemas';
import { ApiError } from '../../shared/api/client.js';
import { queryClient } from '../../shared/api/queryClient.js';
import { useAdminMe, useAdminTenantMembers, useStartImpersonation } from './api.js';
import { MODE_KEYS } from './labels.js';

/**
 * F-71 — open a support session on one of the tenant's members
 * (admin-console.md §7). The reason is mandatory and at least twenty
 * characters — said as a live count, not a greyed button; `full` mode is
 * offered only to a caller holding the capability, and its effect is
 * spelled out before the Confirm. On 201 the tenant app opens, where the
 * banner carries the End.
 */
const TEXTAREA_CLASSES =
  'w-full rounded-md border border-input bg-input-bg px-3 py-2 text-sm text-foreground ' +
  'outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

export function StartImpersonationDialog({ tenant, open, onClose }: { tenant: AdminTenantDetailT; open: boolean; onClose: () => void }) {
  const { t } = useTranslation('admin');
  const navigate = useNavigate();
  const me = useAdminMe();
  const members = useAdminTenantMembers(tenant.id, open);
  const startSession = useStartImpersonation();
  const canFull = me.data?.capabilities.includes('impersonation:start_full') ?? false;
  const [target, setTarget] = useState('');
  const [mode, setMode] = useState<ImpersonationModeT>('read_only');
  const [reason, setReason] = useState('');
  const [ticket, setTicket] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<{ text: string; sessionId?: string } | null>(null);

  useEffect(() => {
    if (open) {
      setTarget('');
      setMode('read_only');
      setReason('');
      setTicket('');
      setTouched(false);
      setError(null);
      requestAnimationFrame(() => document.getElementById('imp-target')?.focus());
    }
  }, [open]);

  if (!open) return null;
  const reasonShort = reason.trim().length < IMPERSONATION_REASON_MIN_CHARS;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (!target || reasonShort) {
      document.getElementById(!target ? 'imp-target' : 'imp-reason')?.focus();
      return;
    }
    try {
      await startSession.mutateAsync({
        tenant_id: tenant.id,
        target_user_id: target,
        mode,
        reason: reason.trim(),
        ...(ticket.trim() ? { ticket_ref: ticket.trim() } : {}),
      });
      // From here every request is the target's: nothing cached applies.
      queryClient.clear();
      navigate('/');
    } catch (err) {
      if (err instanceof ApiError && err.errorCode === 'impersonation_active') setError({ text: t('impersonationAlreadyActive'), sessionId: err.detailMessages?.[0] });
      else if (err instanceof ApiError && err.errorCode === 'tenant_not_impersonable') setError({ text: t('tenantNotImpersonable') });
      else if (err instanceof ApiError && err.errorCode === 'cannot_impersonate_staff') setError({ text: t('cannotImpersonateStaff') });
      else if (err instanceof ApiError && err.status === 422 && err.fieldPath === 'reason') setError({ text: t('reasonTooShort') });
      else if (err instanceof ApiError && err.status === 404) setError({ text: t('targetNotFound') });
      else setError({ text: t('saveError') });
    }
  };

  return (
    <Dialog.Root open onOpenChange={(isOpen: boolean) => { if (!isOpen) onClose(); }}>
      <DialogContent>
        <DialogTitle>{t('impersonateTitle', { tenant: tenant.name })}</DialogTitle>
        <DialogDescription>{t('impersonateBody')}</DialogDescription>
        <form onSubmit={(e) => void submit(e)} noValidate className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="imp-target">{t('impersonateTarget')}</Label>
            <Select id="imp-target" required value={target} onChange={(e) => setTarget(e.target.value)} aria-invalid={touched && !target ? true : undefined} aria-describedby="imp-target-hint">
              <option value="">{members.isPending ? t('loading') : '—'}</option>
              {(members.data?.items ?? []).map((m) => (
                <option key={m.user_id} value={m.user_id} disabled={m.is_platform_staff}>
                  {m.name} — {m.email} — {m.roles.join(', ')}{m.is_platform_staff ? ` (${t('cannotImpersonateStaff')})` : ''}
                </option>
              ))}
            </Select>
            <p id="imp-target-hint" className={`text-xs ${touched && !target ? 'text-danger-text' : 'text-muted-foreground'}`}>{t('impersonateTargetHint')}</p>
          </div>
          <fieldset className="space-y-1">
            <legend className="text-[13px] font-medium">{t('impersonateMode')}</legend>
            {(['read_only', ...(canFull ? (['full'] as const) : [])] as ImpersonationModeT[]).map((m) => (
              <label key={m} htmlFor={`imp-mode-${m}`} className="flex min-h-11 items-start gap-2 text-sm">
                <input id={`imp-mode-${m}`} type="radio" name="imp-mode" className="mt-1 size-4" checked={mode === m} onChange={() => setMode(m)} aria-describedby={`imp-mode-${m}-hint`} />
                <span>
                  {t(MODE_KEYS[m])}
                  <span id={`imp-mode-${m}-hint`} className="block text-xs text-muted-foreground">{t(m === 'full' ? 'modeEffect_full' : 'modeEffect_read_only')}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="space-y-1">
            <Label htmlFor="imp-reason">{t('impersonateReason')}</Label>
            <textarea
              id="imp-reason"
              required
              maxLength={500}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={touched && reasonShort ? true : undefined}
              aria-describedby="imp-reason-hint"
              className={TEXTAREA_CLASSES}
            />
            <p id="imp-reason-hint" aria-live="polite" className={`text-xs ${touched && reasonShort ? 'text-danger-text' : 'text-muted-foreground'}`}>
              {reasonShort ? t('reasonTooShort') : ''} {t('reasonCount', { count: reason.trim().length })}
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="imp-ticket" optionalText={t('optional')}>{t('impersonateTicket')}</Label>
            <Input id="imp-ticket" maxLength={60} autoComplete="off" value={ticket} onChange={(e) => setTicket(e.target.value)} />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-danger-text">
              {error.text}
              {error.sessionId ? (
                <>
                  {' '}
                  <Link to={`/admin/support-sessions/${error.sessionId}`} className="underline underline-offset-4">{t('openSession')}</Link>
                </>
              ) : null}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>{t('cancel')}</Button>
            <Button type="submit" size="sm" variant={mode === 'full' ? 'destructive' : 'default'} disabled={startSession.isPending}>
              {t('impersonateStart')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog.Root>
  );
}
