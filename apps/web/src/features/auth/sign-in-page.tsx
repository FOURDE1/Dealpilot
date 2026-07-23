import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Button } from '@dealpilot/ui';
import { signIn } from '../../shared/auth/client.js';
import { safeReturnTo } from '../../app/guards.js';
import { AuthCard, AuthError, AuthField } from './auth-card.js';

/**
 * Controlled inputs for this increment: the shared react-hook-form + zod Form
 * primitive is an H-05 deliverable — these screens migrate onto it then.
 */
export function SignInPage() {
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
    const { error: apiError } = await signIn.email({ email, password });
    setBusy(false);
    if (apiError) {
      setError('Courriel ou mot de passe invalide.');
      return;
    }
    navigate(safeReturnTo(location.search), { replace: true });
  }

  return (
    <AuthCard title="Connexion" subtitle="Accédez à votre espace 1Dealer">
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4" noValidate>
        <AuthField
          label="Courriel"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={setEmail}
          required
        />
        <AuthField
          label="Mot de passe"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          required
        />
        <AuthError message={error} />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Connexion…' : 'Se connecter'}
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        Pas de compte?{' '}
        <Link to="/signup" className="font-medium text-primary underline-offset-4 hover:underline">
          Créer un compte
        </Link>
      </p>
    </AuthCard>
  );
}
