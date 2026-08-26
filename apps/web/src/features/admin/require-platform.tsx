import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@dealpilot/ui';
import { signOut } from '../../shared/auth/client.js';
import { queryClient } from '../../shared/api/queryClient.js';
import { ApiError } from '../../shared/api/client.js';
import { FullPageSkeleton, loginRedirect } from '../../app/guards.js';
import { useAdminMe } from './api.js';
import { adminAccess } from './access.js';
import { MfaWall } from './mfa-wall.js';

/**
 * F-69 — the console's door. Reads the identity probe and does exactly one
 * thing per answer: not staff → home (the console does not exist for
 * them); not enrolled → the MFA wall; session aged out → sign out and back
 * through the TOTP challenge; a transient failure → say so with a retry;
 * otherwise the console.
 */
export function RequirePlatform({ children }: { children: ReactNode }) {
  const { t } = useTranslation('admin');
  const me = useAdminMe();
  const location = useLocation();
  const err = me.error instanceof ApiError ? { status: me.error.status, errorCode: me.error.code } : me.error ? {} : null;
  const access = adminAccess({ pending: me.isPending, error: err, ok: me.isSuccess });

  useEffect(() => {
    if (access !== 'reauth') return;
    // The account is fine; the CONSOLE session is not. Fresh sign-in mints a
    // session through the challenge again.
    void signOut().then(() => queryClient.clear());
  }, [access]);

  switch (access) {
    case 'pending':
      return <FullPageSkeleton />;
    case 'denied':
      return <Navigate to="/" replace />;
    case 'mfa':
      return <MfaWall />;
    case 'reauth':
      return <Navigate to={loginRedirect(location.pathname, location.search)} replace />;
    case 'error':
      return (
        <main id="main" tabIndex={-1} className="flex min-h-svh items-center justify-center bg-background p-6 text-foreground">
          <div className="max-w-md space-y-3 rounded-lg border border-border bg-card p-6">
            <p role="alert" className="text-sm text-danger-text">{t('probeError')}</p>
            <Button type="button" size="sm" onClick={() => void me.refetch()}>{t('retry')}</Button>
          </div>
        </main>
      );
    case 'ok':
      return children;
  }
}
