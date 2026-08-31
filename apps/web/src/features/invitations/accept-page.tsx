import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Input, Label } from '@dealpilot/ui';
import { ApiError } from '../../shared/api/client.js';
import { signIn, signUp, useSession } from '../../shared/auth/client.js';
import { usePageTitle } from '../../shared/use-page-title.js';
import { ROLE_KEYS } from '../team/team-page.js';
import { useAcceptInvitation, useInvitationPreview } from './api.js';

/**
 * /invitations/:token — the screen the invitation email points at.
 * Preview needs no session; accepting needs a session on the INVITED email.
 * The token never appears in an API path, and we scrub it from the address
 * bar once read (it grants a seat in someone's business).
 */
export function InvitationAcceptPage() {
  const { t } = useTranslation('invitations');
  const { t: tTeam } = useTranslation('team');
  const { token: tokenParam = '' } = useParams();
  const tokenRef = useRef(tokenParam);
  const navigate = useNavigate();
  const { data: session, isPending: sessionPending } = useSession();
  const preview = useInvitationPreview(tokenRef.current);
  const accept = useAcceptInvitation();
  const [mode, setMode] = useState<'signup' | 'signin'>('signup');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  usePageTitle(t('title'));

  useEffect(() => {
    // Keep the token out of history/Referer once we hold it.
    if (tokenParam !== '') window.history.replaceState(null, '', '/invitations/accepted');
  }, [tokenParam]);

  async function finishAccept() {
    setError(null);
    try {
      await accept.mutateAsync(tokenRef.current);
      void navigate('/');
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setError(
        err.status === 403 && err.code === 'wrong_account'
          ? t('wrongAccount', { email: preview.data?.email ?? '' })
          : err.status === 404
            ? t('invalid')
            : t('genericError'),
      );
    }
  }

  async function handleAuth(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const email = preview.data?.email ?? '';
    const res =
      mode === 'signup'
        ? await signUp.email({ email, password, name: name.trim() })
        : await signIn.email({ email, password });
    if (res.error) {
      // Returning member (owner-found, CR-08): the account exists — switch to
      // sign-in instead of leaving them on a dead "could not create" message.
      if (mode === 'signup' && res.error.code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') {
        setMode('signin');
        setPassword('');
        setError(t('accountExists', { email }));
        return;
      }
      setError(mode === 'signup' ? t('signUpFailed') : t('signInFailed'));
      return;
    }
    await finishAccept();
  }

  if (preview.isPending) {
    return <p className="p-6 text-sm text-muted-foreground">{t('loading')}</p>;
  }
  if (preview.isError || !preview.data) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p role="alert" className="mt-3 text-sm text-danger-text">
          {t('invalid')}
        </p>
      </main>
    );
  }

  const roles = preview.data.roles.map((r) => tTeam(ROLE_KEYS[r])).join(', ');

  return (
    <main className="mx-auto max-w-md space-y-4 p-6">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <p className="text-sm">
        {t('invitedAs', { org: preview.data.organization_name, roles })}
      </p>
      <p className="text-sm text-muted-foreground">{t('mustUseEmail', { email: preview.data.email })}</p>

      {error ? (
        <p role="alert" className="text-sm text-danger-text">
          {error}
        </p>
      ) : null}

      {sessionPending ? null : session ? (
        <div className="space-y-3">
          <p className="text-sm">{t('signedInAs', { email: session.user.email })}</p>
          <Button type="button" disabled={accept.isPending} onClick={() => void finishAccept()}>
            {accept.isPending ? t('accepting') : t('accept')}
          </Button>
        </div>
      ) : (
        <form onSubmit={(e) => void handleAuth(e)} className="space-y-3" noValidate>
          <div className="space-y-1">
            <Label htmlFor="inv-email">{t('email')}</Label>
            <Input id="inv-email" value={preview.data.email} readOnly aria-readonly className="bg-muted" />
          </div>
          {mode === 'signup' ? (
            <div className="space-y-1">
              <Label htmlFor="inv-name">{t('fullName')}</Label>
              <Input id="inv-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="inv-password">{t('password')}</Label>
            <Input
              id="inv-password"
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={accept.isPending || password === '' || (mode === 'signup' && name.trim() === '')}>
              {mode === 'signup' ? t('createAndAccept') : t('signInAndAccept')}
            </Button>
            <button
              type="button"
              className="text-sm font-medium text-primary-text underline-offset-4 hover:underline"
              onClick={() => setMode((m) => (m === 'signup' ? 'signin' : 'signup'))}
            >
              {mode === 'signup' ? t('haveAccount') : t('noAccount')}
            </button>
          </div>
        </form>
      )}
    </main>
  );
}
