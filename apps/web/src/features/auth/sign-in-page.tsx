import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@dealpilot/ui';
import { signIn } from '../../shared/auth/client.js';
import { safeReturnTo } from '../../app/guards.js';
import { AuthCard, AuthError, AuthField } from './auth-card.js';

/**
 * Controlled inputs for this increment: the shared react-hook-form + zod Form
 * primitive is an H-05 deliverable — these screens migrate onto it then.
 *
 * F-41: a 2FA-enabled account gets a CHALLENGE instead of a session — the
 * server answers `twoFactorRedirect: true` and no cookie until the code
 * verifies. The challenge lives at /login/verify (its own route — see
 * two-factor-page.tsx for why component state cannot survive here).
 */
export function SignInPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    // The challenge flag rides the fetch callback's context — the resolved
    // promise's `data` does NOT reliably carry it (learned by the journey
    // bouncing /login → / → /login when this read the promise instead).
    let challengedNow = false;
    const { error: apiError } = await signIn.email(
      { email, password },
      {
        onSuccess: (ctx) => {
          if ((ctx.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
            challengedNow = true;
          }
        },
      },
    );
    setBusy(false);
    if (apiError) {
      setError(t('invalidCredentials'));
      return;
    }
    if (challengedNow) {
      // A ROUTE, not component state: this page unmounts whenever useSession
      // refetches (RedirectIfAuthed shows its skeleton), and a challenge held
      // in useState died on the first wrong code. The URL survives remounts.
      navigate(`/login/verify${location.search}`, { replace: true });
      return;
    }
    navigate(safeReturnTo(location.search), { replace: true });
  }

  return (
    <AuthCard title={t('signInTitle')} subtitle={t('signInSubtitle')}>
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4" noValidate>
        <AuthField
          label={t('email')}
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={setEmail}
          required
        />
        <AuthField
          label={t('password')}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          required
        />
        <AuthError message={error} />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? t('signingIn') : t('signInAction')}
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        {t('noAccount')}{' '}
        <Link to="/signup" className="font-medium text-primary underline-offset-4 hover:underline">
          {t('createAccount')}
        </Link>
      </p>
    </AuthCard>
  );
}
