import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@dealpilot/ui';
import { ApiError } from './api/client.js';
import { queryClient } from './api/queryClient.js';
import { ME_KEY, useMe } from './api/use-me.js';
import { useEndImpersonation } from '../features/admin/api.js';

/**
 * F-71 — the §7 banner: "Support session — acting as {user} at {tenant} —
 * ends {time}" with an End button, in the viewer's locale. Rendered from
 * `/api/v1/me`, which the impersonation gate answers AS THE TARGET while a
 * session is live; the auth session itself is still the staffer's. A
 * `role="status"` bar, not an alert: it stands on every page.
 */
export function SupportBanner() {
  const { t, i18n } = useTranslation('common');
  const me = useMe();
  const navigate = useNavigate();
  const endSession = useEndImpersonation();
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const session = me.data?.impersonation ?? null;

  // F-71: the API's impersonation answers reach the shell here (dispatched by
  // failFromResponse), so ROUND 18's refusal messages exist on screen and an
  // ended session clears its own banner without a click.
  useEffect(() => {
    const onImpersonation = (e: Event) => {
      const code = (e as CustomEvent<{ code?: string }>).detail?.code;
      if (code === 'impersonation_ended') {
        setRefusal(null);
        void queryClient.invalidateQueries({ queryKey: ME_KEY });
      } else if (code === 'impersonation_read_only') {
        setRefusal(t('impersonationReadOnly'));
      } else if (code === 'impersonation_forbidden') {
        setRefusal(t('impersonationForbidden'));
      }
    };
    window.addEventListener('dealpilot:impersonation', onImpersonation);
    return () => window.removeEventListener('dealpilot:impersonation', onImpersonation);
  }, [t]);

  if (!session) return null;
  const time = new Intl.DateTimeFormat(i18n.language, { timeStyle: 'short' }).format(new Date(session.expires_at));

  const onEnd = async () => {
    setError(null);
    try {
      await endSession.mutateAsync(session.id);
      // Everything cached was the target's view: drop it and return to the register.
      queryClient.clear();
      navigate(`/admin/support-sessions/${session.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.errorCode === 'impersonation_ended') {
        // Already over (TTL, revocation): same landing, nothing to retry.
        queryClient.clear();
        navigate(`/admin/support-sessions/${session.id}`);
        return;
      }
      setError(t('supportBannerEndError'));
    }
  };

  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-warning-bg px-4 py-2 text-sm text-warning-text">
      <span className="font-medium">
        {t('supportBanner', { user: session.acting_as.name, tenant: session.tenant.name, time })}
      </span>
      {session.mode === 'read_only' ? <span className="rounded-full border border-current px-2 py-0.5 text-xs">{t('supportBannerReadOnly')}</span> : null}
      <Button type="button" size="sm" variant="outline" disabled={endSession.isPending} onClick={() => void onEnd()}>
        {t('supportBannerEnd')}
      </Button>
      {error ? <span role="alert">{error}</span> : null}
      {refusal ? <span role="alert">{refusal}</span> : null}
    </div>
  );
}
