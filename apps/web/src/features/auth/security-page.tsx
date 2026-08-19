import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, Label } from '@dealpilot/ui';
import { usePageTitle } from '../../shared/use-page-title.js';
import { ME_KEY, useMe } from '../../shared/api/use-me.js';
import { twoFactor } from '../../shared/auth/client.js';

/**
 * F-41 — your account's second factor (FR-AUTH-006).
 *
 * Enrolment is a three-step contract: password proves it is you, the secret
 * goes into your authenticator (MANUAL ENTRY for now — a QR needs a rendering
 * dependency the owner has not approved yet; every authenticator app accepts a
 * typed key), and a first code proves the authenticator actually holds the
 * secret before 2FA turns on. Backup codes appear ONCE, at enrolment, because
 * codes that can be re-fetched are codes an attacker with a session can fetch.
 */

export function SecurityPage() {
  const { t } = useTranslation('security');
  usePageTitle(t('title'));
  const queryClient = useQueryClient();
  const me = useMe();

  const [password, setPassword] = useState('');
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const [enrolled, setEnrolled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const secret = totpUri === null ? null : (new URL(totpUri).searchParams.get('secret') ?? null);

  async function onEnable(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error: apiError } = await twoFactor.enable({ password });
    setBusy(false);
    if (apiError || !data) {
      setError(t('wrongPassword'));
      return;
    }
    setTotpUri(data.totpURI);
    setBackupCodes(data.backupCodes ?? []);
    setPassword('');
  }

  async function onVerify(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: apiError } = await twoFactor.verifyTotp({ code: code.trim() });
    setBusy(false);
    if (apiError) {
      setError(t('codeInvalid'));
      return;
    }
    setEnrolled(true);
    setTotpUri(null);
    setCode('');
    void queryClient.invalidateQueries({ queryKey: ME_KEY });
  }

  async function onDisable(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: apiError } = await twoFactor.disable({ password });
    setBusy(false);
    if (apiError) {
      setError(t('wrongPassword'));
      return;
    }
    setPassword('');
    setEnrolled(false);
    void queryClient.invalidateQueries({ queryKey: ME_KEY });
  }

  const mfaOn = me.data?.mfa.enabled === true || enrolled;
  const mfaRequired = me.data?.mfa.required === true;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      {mfaRequired && !mfaOn ? (
        <p role="alert" className="rounded-md bg-warning-bg p-3 text-sm font-medium text-warning-text">
          {t('requiredBanner')}
        </p>
      ) : null}

      {/* Step 3 result: the codes, exactly once. */}
      {backupCodes.length > 0 && enrolled ? (
        <section aria-label={t('backupTitle')} className="space-y-2 rounded-lg border border-border p-4">
          <h2 className="text-sm font-semibold">{t('backupTitle')}</h2>
          <p className="text-sm text-warning-text">{t('backupOnce')}</p>
          <ul className="grid grid-cols-2 gap-1 font-mono text-sm">
            {backupCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {mfaOn ? (
        <section aria-label={t('statusOn')} className="space-y-3 rounded-lg border border-border p-4">
          <p role="status" className="text-sm font-medium text-success-text">{t('statusOn')}</p>
          {mfaRequired ? (
            <p className="text-sm text-muted-foreground">{t('disableForbidden')}</p>
          ) : (
            <form onSubmit={(e) => void onDisable(e)} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="sec-pass-off">{t('password')}</Label>
                <Input id="sec-pass-off" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              {error ? <p role="alert" className="text-sm text-danger-text">{error}</p> : null}
              <Button type="submit" variant="destructive" disabled={busy || password === ''}>
                {t('disable')}
              </Button>
            </form>
          )}
        </section>
      ) : totpUri === null ? (
        <form onSubmit={(e) => void onEnable(e)} className="space-y-3 rounded-lg border border-border p-4" aria-label={t('enableTitle')}>
          <h2 className="text-sm font-semibold">{t('enableTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('enableBody')}</p>
          <div className="space-y-1">
            <Label htmlFor="sec-pass">{t('password')}</Label>
            <Input id="sec-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error ? <p role="alert" className="text-sm text-danger-text">{error}</p> : null}
          <Button type="submit" disabled={busy || password === ''}>{t('enable')}</Button>
        </form>
      ) : (
        <form onSubmit={(e) => void onVerify(e)} className="space-y-3 rounded-lg border border-border p-4" aria-label={t('verifyTitle')}>
          <h2 className="text-sm font-semibold">{t('verifyTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('secretIntro')}</p>
          {secret ? (
            <p className="select-all break-all rounded-md bg-muted p-3 font-mono text-sm" aria-label={t('secretLabel')}>
              {secret}
            </p>
          ) : null}
          <details className="text-xs text-muted-foreground">
            <summary>{t('uriSummary')}</summary>
            <p className="mt-1 select-all break-all font-mono">{totpUri}</p>
          </details>
          <div className="space-y-1">
            <Label htmlFor="sec-code">{t('firstCode')}</Label>
            <Input id="sec-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required />
            <p className="text-xs text-muted-foreground">{t('firstCodeHint')}</p>
          </div>
          {error ? <p role="alert" className="text-sm text-danger-text">{error}</p> : null}
          <Button type="submit" disabled={busy || code.trim().length < 6}>{t('verify')}</Button>
        </form>
      )}
    </div>
  );
}
