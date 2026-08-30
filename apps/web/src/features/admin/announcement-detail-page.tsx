import { useRef, useState } from 'react';
import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@dealpilot/ui';
import { BackLink } from '../../shared/ui/back-link.js';
import { usePageTitle } from '../../shared/use-page-title.js';
import { ApiError } from '../../shared/api/client.js';
import { AUDIENCE_KEYS, SEVERITY_CLASSES, SEVERITY_KEYS, inLanguage } from '../announcements/labels.js';
import { useAdminAnnouncement, useEndAnnouncement } from './api.js';

/**
 * F-72 — one announcement (admin-console.md §8, §12).
 *
 * There is nothing to edit here, by design: publishing is creating, the text
 * is frozen, and the single act the page offers is ending the display window
 * early. Both languages are shown side by side because both were published
 * and a reviewer has to be able to check the pair that dealers actually read.
 */
export function AnnouncementDetailPage() {
  const { t, i18n } = useTranslation('announcements');
  const { t: tAdmin } = useTranslation('admin');
  const { announcementId = '' } = useParams();
  const announcement = useAdminAnnouncement(announcementId);
  const end = useEndAnnouncement(announcementId);
  const [notice, setNotice] = useState<{ kind: 'status' | 'alert'; text: string } | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  usePageTitle(announcement.data ? inLanguage(i18n.language, announcement.data.title_en, announcement.data.title_fr) : undefined);

  const onEnd = async () => {
    setNotice(null);
    try {
      await end.mutateAsync();
      setNotice({ kind: 'status', text: t('ended') });
    } catch (err) {
      // 403: §3 keeps a louder severity to a super admin, in the definer. The
      // refusal has to name THAT rule — the console's F-71 session strings say
      // "only whoever opened it may end it", which is a different rule and
      // would send an operator hunting for a publisher mid-incident.
      if (err instanceof ApiError && err.status === 403) setNotice({ kind: 'alert', text: t('endForbidden') });
      else if (err instanceof ApiError && err.status === 409) setNotice({ kind: 'alert', text: t('endAlreadyEnded') });
      else setNotice({ kind: 'alert', text: tAdmin('saveError') });
    }
    requestAnimationFrame(() => noticeRef.current?.focus());
  };

  if (announcement.isPending) return <p aria-busy="true" className="text-sm text-muted-foreground">{tAdmin('loading')}</p>;
  if (announcement.isError || !announcement.data) return <p role="alert" className="text-sm text-danger-text">{t('loadError')}</p>;
  const a = announcement.data;
  const fmt = (iso: string) => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  const over = a.ends_at !== null && Date.parse(a.ends_at) <= Date.now();
  const scheduled = Date.parse(a.starts_at) > Date.now();

  return (
    <div className="space-y-6">
      <BackLink to="/admin/announcements">{tAdmin('backToAnnouncements')}</BackLink>
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{inLanguage(i18n.language, a.title_en, a.title_fr)}</h1>
        <span className={`rounded-full px-2 py-0.5 text-xs ${SEVERITY_CLASSES[a.severity]}`}>{t(SEVERITY_KEYS[a.severity])}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-foreground">
          {over ? t('ended') : scheduled ? t('scheduled') : t('active')}
        </span>
      </header>
      <p
        ref={noticeRef}
        tabIndex={-1}
        role={notice?.kind ?? 'status'}
        aria-live="polite"
        className={`text-sm outline-none ${notice ? (notice.kind === 'alert' ? 'text-danger-text' : 'text-success-text') : 'sr-only'}`}
      >
        {notice?.text ?? ''}
      </p>

      <section aria-labelledby="ann-facts" className="space-y-2 rounded-lg border border-border bg-card p-4">
        <h2 id="ann-facts" className="text-[15px] font-semibold">{tAdmin('factsTitle')}</h2>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
          <dt className="text-muted-foreground">{t('colAudience')}</dt>
          <dd>{t(AUDIENCE_KEYS[a.audience.type])}</dd>
          <dt className="text-muted-foreground">{t('colWindow')}</dt>
          <dd>{fmt(a.starts_at)}{a.ends_at ? ` — ${fmt(a.ends_at)}` : ''}</dd>
          <dt className="text-muted-foreground">{t('colPublishedBy')}</dt>
          <dd>{a.published_by_email} · {fmt(a.published_at)}</dd>
          <dt className="text-muted-foreground">{t('colNotified')}</dt>
          <dd>{a.recipients_notified}</dd>
          {a.status_incident_url ? (
            <>
              <dt className="text-muted-foreground">{t('fieldIncidentUrl')}</dt>
              <dd>
                <a href={a.status_incident_url} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                  {t('statusPage')}
                </a>
              </dd>
            </>
          ) : null}
        </dl>
        {a.dismissible ? null : <p className="text-sm text-muted-foreground">{t('nonDismissible')}</p>}
      </section>

      <section aria-labelledby="ann-text" className="space-y-3 rounded-lg border border-border bg-card p-4">
        <h2 id="ann-text" className="text-[15px] font-semibold">{t('bothLanguages')}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t('fieldTitleFr')}</p>
            <p className="font-medium">{a.title_fr}</p>
            <p className="text-xs text-muted-foreground">{t('fieldBodyFr')}</p>
            <p className="whitespace-pre-wrap text-sm">{a.body_fr}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t('fieldTitleEn')}</p>
            <p className="font-medium">{a.title_en}</p>
            <p className="text-xs text-muted-foreground">{t('fieldBodyEn')}</p>
            <p className="whitespace-pre-wrap text-sm">{a.body_en}</p>
          </div>
        </div>
      </section>

      {over ? null : (
        <section aria-labelledby="ann-end" className="space-y-2 rounded-lg border border-border bg-card p-4">
          <h2 id="ann-end" className="text-[15px] font-semibold">{t('endTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('endHint')}</p>
          <Button type="button" size="sm" variant="destructive" disabled={end.isPending} onClick={() => void onEnd()}>
            {t('end')}
          </Button>
        </section>
      )}
    </div>
  );
}
