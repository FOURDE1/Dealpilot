import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@dealpilot/ui';
import type { ImpersonationSessionT } from '@dealpilot/schemas';
import { ApiError } from '../../shared/api/client.js';
import { queryClient } from '../../shared/api/queryClient.js';
import { useEndImpersonation } from './api.js';
import { MODE_KEYS } from './labels.js';

/**
 * F-71 — the console while a support session is live (admin-console.md §7;
 * D-072 O-27): closed, except the End. Page content, not an alert (the F-69
 * MFA-wall rule): the staffer reads who they are acting as and until when,
 * ends it here or opens the tenant app where the banner carries the same End.
 */
export function ImpersonationWall({ session }: { session: ImpersonationSessionT }) {
  const { t, i18n } = useTranslation('admin');
  const navigate = useNavigate();
  const endSession = useEndImpersonation();
  const [error, setError] = useState<string | null>(null);
  const time = new Intl.DateTimeFormat(i18n.language, { timeStyle: 'short' }).format(new Date(session.expires_at));

  const onEnd = async () => {
    setError(null);
    try {
      await endSession.mutateAsync(session.id);
      // Every cached answer was the target's: start clean, land on the register row.
      queryClient.clear();
      navigate(`/admin/support-sessions/${session.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.errorCode === 'impersonation_ended') {
        // Already over: same landing, nothing to retry (review).
        queryClient.clear();
        navigate(`/admin/support-sessions/${session.id}`);
        return;
      }
      setError(t('saveError'));
    }
  };

  return (
    <main id="main" tabIndex={-1} className="flex min-h-svh items-center justify-center bg-background p-6 text-foreground">
      <div className="max-w-md space-y-3 rounded-lg border border-border bg-card p-6">
        <h1 className="text-lg font-semibold">{t('wallTitle')}</h1>
        <p className="text-sm">{t('wallBody', { user: session.target_user.name, tenant: session.tenant.name, time })}</p>
        <p className="text-sm text-muted-foreground">{t('wallMode', { mode: t(MODE_KEYS[session.mode]) })}</p>
        {error ? <p role="alert" className="text-sm text-danger-text">{error}</p> : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" size="sm" variant="destructive" disabled={endSession.isPending} onClick={() => void onEnd()}>
            {t('impersonateEnd')}
          </Button>
          <Link to="/" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">{t('openTenantApp')}</Link>
        </div>
      </div>
    </main>
  );
}
