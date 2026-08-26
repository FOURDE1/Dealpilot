import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Label, Select } from '@dealpilot/ui';
import { PLATFORM_ROLES, type PlatformRoleT, type PlatformStaffMemberT } from '@dealpilot/schemas';
import { usePageTitle } from '../../shared/use-page-title.js';
import { ApiError } from '../../shared/api/client.js';
import { useAdminMe, useGrantStaff, usePlatformStaff, useRevokeStaff } from './api.js';
import { ROLE_KEYS, STAFF_STATUS_KEYS } from './labels.js';

/**
 * F-69 — platform staff (admin-console.md §3 "manage platform staff
 * accounts"). Grant = re-role = reinstate (one form); revoke asks first and
 * is immediate; you cannot revoke yourself (said in text, not a greyed
 * button), and the last super admin stays.
 */
export function PlatformStaffPage() {
  const { t, i18n } = useTranslation('admin');
  usePageTitle(t('staffTitle'));
  const me = useAdminMe();
  const staff = usePlatformStaff();
  const grant = useGrantStaff();
  const revoke = useRevokeStaff();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<PlatformRoleT>('platform_support');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<{ kind: 'status' | 'alert'; text: string } | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<PlatformStaffMemberT | null>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const fmt = (iso: string | null) => (iso ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(iso)) : '—');

  const announce = (kind: 'status' | 'alert', text: string) => {
    setMessage({ kind, text });
    requestAnimationFrame(() => messageRef.current?.focus());
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setEmailError(null);
    try {
      const result = await grant.mutateAsync({ email: email.trim(), role, ...(note.trim() ? { note: note.trim() } : {}) });
      const key = ({ granted: 'granted', reinstated: 'reinstated', role_changed: 'roleChanged', unchanged: 'unchanged' } as const)[result.outcome];
      announce('status', t(key));
      setEmail('');
      setNote('');
    } catch (err) {
      if (err instanceof ApiError && err.fieldPath === 'email') setEmailError(t('needsAccount'));
      else if (err instanceof ApiError && err.code === 'last_super_admin') announce('alert', t('lastSuperAdmin'));
      else announce('alert', t('saveError'));
    }
  };

  const doRevoke = async () => {
    if (!confirming) return;
    setMessage(null);
    try {
      await revoke.mutateAsync(confirming.user_id);
      announce('status', t('revoked'));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'last_super_admin') announce('alert', t('lastSuperAdmin'));
      else announce('alert', t('saveError'));
    } finally {
      setConfirming(null);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t('staffTitle')}</h1>

      <form onSubmit={(e) => void submit(e)} aria-labelledby="add-staff" className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h2 id="add-staff" className="text-[15px] font-semibold">{t('addStaff')}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="staff-email">{t('email')}</Label>
            <Input id="staff-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={emailError !== null} aria-describedby={emailError ? 'staff-email-error' : undefined} />
            {emailError ? <p id="staff-email-error" role="alert" className="text-xs text-danger-text">{emailError}</p> : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="staff-role">{t('role')}</Label>
            <Select id="staff-role" value={role} onChange={(e) => setRole(e.target.value as PlatformRoleT)}>
              {PLATFORM_ROLES.map((r) => (
                <option key={r} value={r}>{t(ROLE_KEYS[r])}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="staff-note">{t('note')}</Label>
            <Input id="staff-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <Button type="submit" size="sm" disabled={grant.isPending}>{t('grant')}</Button>
      </form>

      <p
        ref={messageRef}
        tabIndex={-1}
        role={message?.kind === 'alert' ? 'alert' : 'status'}
        className={`text-sm outline-none ${message?.kind === 'alert' ? 'text-danger-text' : 'text-success-text'} ${message ? '' : 'sr-only'}`}
      >
        {message?.text ?? ''}
      </p>

      {staff.isPending ? <p aria-busy="true" className="text-sm text-muted-foreground">{t('loading')}</p> : null}
      {staff.isError ? <p role="alert" className="text-sm text-danger-text">{t('loadError')}</p> : null}
      {staff.isSuccess ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2">{t('colName')}</th>
                <th scope="col" className="px-4 py-2">{t('colEmail')}</th>
                <th scope="col" className="px-4 py-2">{t('colRole')}</th>
                <th scope="col" className="px-4 py-2">{t('colMfa')}</th>
                <th scope="col" className="px-4 py-2">{t('colStatus')}</th>
                <th scope="col" className="px-4 py-2">{t('colGranted')}</th>
                <th scope="col" className="px-4 py-2">{t('colRevoked')}</th>
                <th scope="col" className="px-4 py-2"><span className="sr-only">{t('revoke')}</span></th>
              </tr>
            </thead>
            <tbody>
              {staff.data.items.map((m) => {
                const self = m.user_id === me.data?.user.id;
                return (
                  <tr key={m.user_id} className="border-t border-border">
                    <td className="px-4 py-2">{m.name}</td>
                    <td className="px-4 py-2">{m.email}</td>
                    <td className="px-4 py-2">{t(ROLE_KEYS[m.role])}</td>
                    <td className={`px-4 py-2 ${m.mfa_enabled ? '' : 'text-warning-text'}`}>{m.mfa_enabled ? t('mfaOn') : t('mfaOff')}</td>
                    <td className="px-4 py-2">{t(STAFF_STATUS_KEYS[m.status])}</td>
                    <td className="px-4 py-2">{fmt(m.granted_at)}</td>
                    <td className="px-4 py-2">{fmt(m.revoked_at)}</td>
                    <td className="px-4 py-2">
                      {m.status !== 'active' ? null : self ? (
                        <span className="text-xs text-muted-foreground">{t('cannotRevokeSelf')}</span>
                      ) : (
                        <Button type="button" size="sm" variant="outline" disabled={revoke.isPending} onClick={() => setConfirming(m)}>
                          {t('revoke')}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <Dialog.Root open={confirming !== null} onOpenChange={(open: boolean) => { if (!open) setConfirming(null); }}>
        <DialogContent>
          <DialogTitle>{t('revokeTitle', { name: confirming?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('revokeBody')}</DialogDescription>
          <div className="flex justify-end gap-2 pt-3">
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(null)}>{t('cancel')}</Button>
            <Button type="button" variant="destructive" size="sm" disabled={revoke.isPending} onClick={() => void doRevoke()}>{t('revoke')}</Button>
          </div>
        </DialogContent>
      </Dialog.Root>
    </div>
  );
}
