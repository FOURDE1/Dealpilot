import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@dealpilot/ui';
import { BackLink } from '../../shared/ui/back-link.js';
import { usePageTitle } from '../../shared/use-page-title.js';
import { ApiError } from '../../shared/api/client.js';
import { useEndImpersonation, useImpersonation } from './api.js';
import { END_REASON_KEYS, MODE_KEYS } from './labels.js';

/**
 * F-71 — one support session: the facts, the End while it is live (the
 * server decides who may — a refusal is said in text, the F-69 rule), and
 * the request trail (§7 "every request", up to 500 rows).
 */
export function ImpersonationDetailPage() {
  const { t, i18n } = useTranslation('admin');
  const { sessionId = '' } = useParams();
  const session = useImpersonation(sessionId);
  const endSession = useEndImpersonation();
  const [notice, setNotice] = useState<{ kind: 'status' | 'alert'; text: string } | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  usePageTitle(session.data ? t('sessionTitle', { user: session.data.target_user.name }) : undefined);
  const fmt = (iso: string | null) => (iso ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : '—');

  const onEnd = async () => {
    setNotice(null);
    try {
      await endSession.mutateAsync(sessionId);
      setNotice({ kind: 'status', text: t('impersonationEnded') });
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setNotice({ kind: 'alert', text: t('notYoursToEnd') });
      else if (err instanceof ApiError && err.errorCode === 'impersonation_ended') setNotice({ kind: 'alert', text: t('alreadyEnded') });
      else setNotice({ kind: 'alert', text: t('saveError') });
    }
    requestAnimationFrame(() => noticeRef.current?.focus());
  };

  if (session.isPending) return <p aria-busy="true" className="text-sm text-muted-foreground">{t('loading')}</p>;
  if (session.isError || !session.data) return <p role="alert" className="text-sm text-danger-text">{t('loadError')}</p>;
  const s = session.data;

  return (
    <div className="space-y-6">
      <BackLink to="/admin/support-sessions">{t('backToSessions')}</BackLink>
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{t('sessionTitle', { user: s.target_user.name })}</h1>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{t(MODE_KEYS[s.mode])}</span>
        {s.active ? <span className="rounded-full bg-warning-bg px-2 py-0.5 text-xs text-warning-text">{t('activeNow')}</span> : null}
      </header>
      <p ref={noticeRef} tabIndex={-1} role={notice?.kind ?? 'status'} aria-live="polite" className={`text-sm outline-none ${notice ? (notice.kind === 'alert' ? 'text-danger-text' : 'text-success-text') : 'sr-only'}`}>
        {notice?.text ?? ''}
      </p>

      <section aria-labelledby="session-facts" className="space-y-2 rounded-lg border border-border bg-card p-4">
        <h2 id="session-facts" className="text-[15px] font-semibold">{t('factsTitle')}</h2>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
          <dt className="text-muted-foreground">{t('colTenant')}</dt>
          <dd><Link to={`/admin/tenants/${s.tenant.id}`} className="underline underline-offset-4">{s.tenant.name}</Link> <span className="font-mono text-xs text-muted-foreground">{s.tenant.slug}</span></dd>
          <dt className="text-muted-foreground">{t('colStaff')}</dt><dd>{s.platform_user.name} ({s.platform_user.email})</dd>
          <dt className="text-muted-foreground">{t('colActingAs')}</dt><dd>{s.target_user.name} ({s.target_user.email})</dd>
          <dt className="text-muted-foreground">{t('impersonateReason')}</dt><dd>{s.reason}</dd>
          <dt className="text-muted-foreground">{t('impersonateTicket')}</dt><dd>{s.ticket_ref ?? '—'}</dd>
          <dt className="text-muted-foreground">{t('colStarted')}</dt><dd>{fmt(s.started_at)}</dd>
          <dt className="text-muted-foreground">{t('colEnds')}</dt><dd>{s.active ? fmt(s.expires_at) : fmt(s.ended_at)}</dd>
          <dt className="text-muted-foreground">{t('colEndReason')}</dt><dd>{s.end_reason ? t(END_REASON_KEYS[s.end_reason]) : '—'}</dd>
        </dl>
        {s.active ? (
          // No "open the tenant app" here: the owning staffer sees the wall,
          // so an active session on this page is always someone ELSE's — the
          // link would open the viewer's own, non-impersonating identity (review).
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button type="button" size="sm" variant="destructive" disabled={endSession.isPending} onClick={() => void onEnd()}>{t('impersonateEnd')}</Button>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="session-requests" className="space-y-2 rounded-lg border border-border bg-card p-4">
        <h2 id="session-requests" className="text-[15px] font-semibold">{t('requestsTitle')}</h2>
        {s.requests.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noRequests')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-start text-xs text-muted-foreground">
                  <th scope="col" className="py-1 pe-3 text-start">{t('colAt')}</th>
                  <th scope="col" className="py-1 pe-3 text-start">{t('colMethod')}</th>
                  <th scope="col" className="py-1 pe-3 text-start">{t('colUrl')}</th>
                  <th scope="col" className="py-1 text-start">{t('colStatusCode')}</th>
                </tr>
              </thead>
              <tbody>
                {s.requests.map((r) => (
                  <tr key={r.seq} className="border-t border-border">
                    <td className="py-1 pe-3 whitespace-nowrap">{fmt(r.at)}</td>
                    <td className="py-1 pe-3 font-mono text-xs">{r.method}</td>
                    <td className="py-1 pe-3 font-mono text-xs break-all">{r.url}</td>
                    <td className="py-1 font-mono text-xs">{r.status_code}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
