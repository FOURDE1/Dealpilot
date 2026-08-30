import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Label } from '@dealpilot/ui';
import { KILL_SWITCH_TTL_MS, type PlatformSettingT } from '@dealpilot/schemas';
import { usePageTitle } from '../../shared/use-page-title.js';
import { ApiError } from '../../shared/api/client.js';
import { useAdminMe, usePlatformSettings, useSetPlatformSetting } from './api.js';
import { SETTING_KEYS } from './labels.js';

/**
 * F-72 §5.3 — the kill switches. This is the 3am screen, so its copy is part
 * of the deliverable rather than decoration: each switch says what it IS,
 * what it STOPS, what keeps going anyway, who last moved it and when, and the
 * only propagation promise this deployment can honestly make — a bounded age,
 * because the API and each worker share no cache and REDIS_URL is optional.
 *
 * Stopping costs one reason and a click: at 3am, fast matters. RESUMING
 * releases a backlog onto real customers, so it costs typing the switch name
 * back — the F-69 confirm-slug idea, pointed at the dangerous direction
 * rather than the safe one. The server enforces both; this is the message.
 *
 * A resumed switch keeps no reason on the row (the definer NULLs it), so
 * "why was this off at 04:00" survives only in `platform_audit_events`, which
 * has no console page. That is deliberate, and F-72 adds no flip history.
 */

const TEXTAREA_CLASSES =
  'w-full rounded-md border border-input bg-input-bg px-3 py-2 text-sm text-foreground ' +
  'outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

const MIN_REASON = 10;

function SwitchCard({ setting, canWrite }: { setting: PlatformSettingT; canWrite: boolean }) {
  const { t, i18n } = useTranslation('switches');
  const { t: tAdmin } = useTranslation('admin');
  const flip = useSetPlatformSetting(setting.setting_key);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'status' | 'alert'; text: string } | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const labels = SETTING_KEYS[setting.setting_key];
  const fieldId = `ks-${setting.setting_key}`;
  // Resuming is the dangerous direction: the name has to be typed back.
  const resuming = setting.enabled;
  const reasonShort = reason.trim().length < MIN_REASON;
  const confirmMismatch = resuming && confirm.trim() !== setting.setting_key;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setNotice(null);
    // Refusals are spoken, not just disabled (WCAG 3.3.1): the field is
    // marked, and focus goes to the one that has to change.
    if (reasonShort) {
      reasonRef.current?.focus();
      return;
    }
    if (confirmMismatch) {
      // `Input` takes no ref (it forwards plain input attributes), so the id
      // is the handle — the tenant-new-page precedent.
      document.getElementById(`${fieldId}-confirm`)?.focus();
      return;
    }
    try {
      await flip.mutateAsync({
        enabled: !setting.enabled,
        reason: reason.trim(),
        ...(resuming ? { confirm_setting_key: confirm.trim() } : {}),
      });
      setReason('');
      setConfirm('');
      setTouched(false);
      setNotice({ kind: 'status', text: t(resuming ? 'off' : 'on') });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'key_mismatch') setNotice({ kind: 'alert', text: t('confirmMismatch') });
      else setNotice({ kind: 'alert', text: tAdmin('saveError') });
    }
    requestAnimationFrame(() => noticeRef.current?.focus());
  };

  return (
    <section aria-labelledby={`${fieldId}-name`} className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id={`${fieldId}-name`} className="text-[15px] font-semibold">{t(labels.label)}</h2>
        {/* The state is a WORD first; the colour only underlines it. */}
        <span className={`rounded-full px-2 py-0.5 text-xs ${setting.enabled ? 'bg-danger-bg text-danger-text' : 'bg-muted text-foreground'}`}>
          {t(setting.enabled ? 'on' : 'off')}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">{t(labels.scope)}</p>
      <p className="text-xs text-muted-foreground">
        {setting.changed_by_email
          ? t('changedBy', {
              email: setting.changed_by_email,
              date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(setting.changed_at)),
            })
          : t('neverChanged')}
      </p>
      {setting.reason ? <p className="text-sm">{setting.reason}</p> : null}
      <p className="text-xs text-muted-foreground">{t('takesEffect', { seconds: KILL_SWITCH_TTL_MS / 1000 })}</p>
      <p
        ref={noticeRef}
        tabIndex={-1}
        role={notice?.kind ?? 'status'}
        aria-live="polite"
        className={`text-sm outline-none ${notice ? (notice.kind === 'alert' ? 'text-danger-text' : 'text-success-text') : 'sr-only'}`}
      >
        {notice?.text ?? ''}
      </p>

      {canWrite ? (
        <form onSubmit={(e) => void submit(e)} noValidate className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor={`${fieldId}-reason`}>{t('reason')}</Label>
            <textarea
              id={`${fieldId}-reason`}
              ref={reasonRef}
              rows={2}
              maxLength={500}
              className={TEXTAREA_CLASSES}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={touched && reasonShort}
              aria-describedby={touched && reasonShort ? `${fieldId}-reason-error` : undefined}
            />
            {touched && reasonShort ? (
              <p id={`${fieldId}-reason-error`} className="text-xs text-danger-text">{tAdmin('required', { field: t('reason') })}</p>
            ) : null}
          </div>
          {resuming ? (
            <div className="space-y-1">
              <Label htmlFor={`${fieldId}-confirm`}>{t('confirmLabel', { key: setting.setting_key })}</Label>
              <Input
                id={`${fieldId}-confirm`}
                className="font-mono"
                autoComplete="off"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                aria-invalid={touched && confirmMismatch}
                aria-describedby={touched && confirmMismatch ? `${fieldId}-confirm-error` : undefined}
              />
              {touched && confirmMismatch ? (
                <p id={`${fieldId}-confirm-error`} className="text-xs text-danger-text">{t('confirmMismatch')}</p>
              ) : null}
            </div>
          ) : null}
          <Button type="submit" size="sm" variant={resuming ? 'default' : 'destructive'} disabled={flip.isPending} aria-busy={flip.isPending}>
            {t(resuming ? 'resume' : 'stop')}
          </Button>
        </form>
      ) : null}
    </section>
  );
}

export function PlatformSettingsPage() {
  const { t } = useTranslation('switches');
  const { t: tAdmin } = useTranslation('admin');
  usePageTitle(t('title'));
  const me = useAdminMe();
  const settings = usePlatformSettings();
  const canWrite = me.data?.capabilities.includes('settings:write') ?? false;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <p className="text-sm text-muted-foreground">{t('intro')}</p>
      {settings.isPending ? <p aria-busy="true" className="text-sm text-muted-foreground">{tAdmin('loading')}</p> : null}
      {settings.isError ? <p role="alert" className="text-sm text-danger-text">{t('loadError')}</p> : null}
      {(settings.data?.items ?? []).map((setting) => (
        <SwitchCard key={setting.setting_key} setting={setting} canWrite={canWrite} />
      ))}
    </div>
  );
}
