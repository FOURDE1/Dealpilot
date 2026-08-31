import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@dealpilot/ui';
import { signUp } from '../../shared/auth/client.js';
import { AuthCard, AuthError, AuthField } from './auth-card.js';

const MIN_PASSWORD = 12; // matches the A-05 server policy

export function SignUpPage() {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (password.length < MIN_PASSWORD) {
      setError(t('passwordTooShort', { min: MIN_PASSWORD }));
      return;
    }
    setBusy(true);
    setError(null);
    const { error: apiError } = await signUp.email({ name, email, password });
    setBusy(false);
    if (apiError) {
      // Localized messages only — never the server's raw English text.
      setError(apiError.code === 'USER_ALREADY_EXISTS' ? t('emailInUse') : t('signUpFailed'));
      return;
    }
    navigate('/', { replace: true });
  }

  return (
    <AuthCard title={t('signUpTitle')} subtitle={t('signUpSubtitle')}>
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4" noValidate>
        <AuthField label={t('fullName')} type="text" autoComplete="name" value={name} onChange={setName} required />
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
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          hint={t('passwordHint', { min: MIN_PASSWORD })}
          required
        />
        <AuthError message={error} />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? t('creatingAccount') : t('signUpAction')}
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        {t('haveAccount')}{' '}
        <Link to="/login" className="font-medium text-primary-text underline-offset-4 hover:underline">
          {t('signInAction')}
        </Link>
      </p>
    </AuthCard>
  );
}
