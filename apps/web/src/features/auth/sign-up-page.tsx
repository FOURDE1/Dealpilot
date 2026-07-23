import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '@dealpilot/ui';
import { signUp } from '../../shared/auth/client.js';
import { AuthCard, AuthError, AuthField } from './auth-card.js';

const MIN_PASSWORD = 12; // matches the A-05 server policy

export function SignUpPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (password.length < MIN_PASSWORD) {
      setError(`Le mot de passe doit contenir au moins ${MIN_PASSWORD} caractères.`);
      return;
    }
    setBusy(true);
    setError(null);
    const { error: apiError } = await signUp.email({ name, email, password });
    setBusy(false);
    if (apiError) {
      setError(apiError.message ?? "Impossible de créer le compte. Réessayez.");
      return;
    }
    navigate('/', { replace: true });
  }

  return (
    <AuthCard title="Créer un compte" subtitle="Votre concession sur 1Dealer">
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4" noValidate>
        <AuthField label="Nom complet" type="text" autoComplete="name" value={name} onChange={setName} required />
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
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          hint={`Au moins ${MIN_PASSWORD} caractères.`}
          required
        />
        <AuthError message={error} />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Création…' : 'Créer le compte'}
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        Déjà un compte?{' '}
        <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          Se connecter
        </Link>
      </p>
    </AuthCard>
  );
}
