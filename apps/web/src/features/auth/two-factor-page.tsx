import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@dealpilot/ui';
import { twoFactor } from '../../shared/auth/client.js';
import { safeReturnTo } from '../../app/guards.js';
import { AuthCard, AuthError, AuthField } from './auth-card.js';

/**
 * F-41 — the sign-in TOTP challenge, as its OWN route (/login/verify).
 *
 * A route, not component state, because the auth screens live under
 * RedirectIfAuthed, and Better Auth's useSession refetches after every auth
 * call — flipping isPending, swapping in the guard's skeleton, and REMOUNTING
 * whatever was here. Challenge state kept in a useState died on the first
 * wrong code; a URL survives remounts by construction. (Found by the f41
 * journey, not by reasoning.)
 *
 * The challenge itself lives in the server-side cookie the sign-in set, so
 * landing here without one simply fails verification with the same message.
 */
export function TwoFactorPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const location = useLocation();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleVerify(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: apiError } = await twoFactor.verifyTotp({ code: code.trim() });
    setBusy(false);
    if (apiError) {
      // One message for wrong AND locked: which of the two it was is exactly
      // what a brute-forcer wants to know.
      setError(t('mfaCodeInvalid'));
      return;
    }
    navigate(safeReturnTo(location.search), { replace: true });
  }

  return (
    <AuthCard title={t('mfaTitle')} subtitle={t('mfaSubtitle')}>
      <form onSubmit={(e) => void handleVerify(e)} className="space-y-4" noValidate>
        <AuthField
          label={t('mfaCode')}
          type="text"
          autoComplete="one-time-code"
          inputMode="numeric"
          value={code}
          onChange={setCode}
          required
        />
        <AuthError message={error} />
        <Button type="submit" className="w-full" disabled={busy || code.trim().length < 6}>
          {busy ? t('signingIn') : t('mfaVerify')}
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        <Link to="/login" className="font-medium text-primary-text underline-offset-4 hover:underline">
          {t('signInTitle')}
        </Link>
      </p>
    </AuthCard>
  );
}
