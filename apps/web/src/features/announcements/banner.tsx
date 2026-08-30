import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@dealpilot/ui';
import type { AnnouncementT } from '@dealpilot/schemas';
import { useActiveAnnouncements, useDismissAnnouncement } from './api.js';
import { SEVERITY_CLASSES, SEVERITY_KEYS, inLanguage } from './labels.js';
import { splitAnnouncements, type SplitAnnouncements } from './order.js';

/**
 * F-72 — the §8 platform banner, in the tenant shell (R4).
 *
 * Two mounts, one query, one row. `<AnnouncementBanner />` carries what
 * interrupts (an incident, planned maintenance) and sits high, above the MFA
 * nag; `<AnnouncementNotices />` carries what can wait (news, a promotion)
 * and sits immediately above the page. Which announcement goes where is
 * `splitAnnouncements()`, not a condition inside either component.
 *
 * `role="status"`, never `alert`: these bars STAND on every page, and an
 * assertive live region on every navigation would shout over real alerts and
 * collide with every `getByRole('alert')` in the suite (the F-41 nag learned
 * this first). Colour never carries the meaning alone — each row opens with a
 * severity chip in words.
 */

function AnnouncementRow({
  item,
  pending,
  onDismiss,
}: {
  item: AnnouncementT;
  pending: boolean;
  onDismiss: () => void;
}) {
  const { t, i18n } = useTranslation('announcements');
  const title = inLanguage(i18n.language, item.title_en, item.title_fr);
  const body = inLanguage(i18n.language, item.body_en, item.body_fr);

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-2 text-sm ${SEVERITY_CLASSES[item.severity]}`}>
      <span className="rounded-full border border-current px-2 py-0.5 text-xs">{t(SEVERITY_KEYS[item.severity])}</span>
      <span className="font-medium">{title}</span>
      <span>{body}</span>
      {item.status_incident_url ? (
        // §8's status-page link, typed by the publisher. Opened in a new tab
        // because leaving the app during an incident loses whatever the
        // dealer was in the middle of.
        <a href={item.status_incident_url} target="_blank" rel="noreferrer" className="underline underline-offset-4">
          {t('statusPage')}
        </a>
      ) : null}
      {item.ends_at ? (
        <span className="text-xs">
          {t('until', { date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.ends_at)) })}
        </span>
      ) : null}
      {item.dismissible ? (
        // A text button, not an icon — there is no ✕ idiom in this codebase —
        // and the label names WHICH announcement, because several can stand
        // at once (the duplicates-page precedent).
        <Button type="button" size="sm" variant="outline" disabled={pending} aria-label={t('dismissOne', { title })} onClick={onDismiss}>
          {t('dismiss')}
        </Button>
      ) : null}
    </div>
  );
}

function AnnouncementRegion({ group }: { group: keyof SplitAnnouncements }) {
  const { t } = useTranslation('announcements');
  const list = useActiveAnnouncements();
  const dismiss = useDismissAnnouncement();
  const regionRef = useRef<HTMLDivElement>(null);
  // Dismissal is permanent, so the row leaves at the click rather than a
  // round trip later; a refusal puts it back, which is what the reader sees.
  const [dismissed, setDismissed] = useState<readonly string[]>([]);
  const items = useMemo(() => splitAnnouncements(list.data?.items ?? [])[group], [list.data, group]);
  const shown = items.filter((a) => !dismissed.includes(a.id));

  const onDismiss = async (id: string) => {
    setDismissed((d) => [...d, id]);
    // Focus moves in the SAME frame the button is unmounted by that update:
    // park it on the region, or on the page itself once the region empties, so
    // a keyboard reader is never dropped to the body. Waiting for the round
    // trip would leave them on <body> for its whole duration — a Tab there
    // restarts at the top of the document.
    requestAnimationFrame(() => (regionRef.current ?? document.getElementById('main'))?.focus());
    try {
      await dismiss.mutateAsync(id);
    } catch {
      // Refused — a support session may not dismiss in the dealer's name, the
      // announcement may already be over, the network may be down. The row
      // comes back, which is the signal: nothing was silenced. Focus stays on
      // the region, whose `role="status"` announces the row's return.
      setDismissed((d) => d.filter((other) => other !== id));
    }
  };

  if (shown.length === 0) return null;

  return (
    <div ref={regionRef} tabIndex={-1} role="status" aria-label={t('bannerLabel')} className="outline-none">
      {shown.map((item) => (
        <AnnouncementRow key={item.id} item={item} pending={dismiss.isPending} onDismiss={() => void onDismiss(item.id)} />
      ))}
    </div>
  );
}

/** Incident and maintenance: above the MFA nag and the lifecycle chain. */
export function AnnouncementBanner() {
  return <AnnouncementRegion group="banner" />;
}

/** Information and marketing: below the lifecycle chain, above the page. */
export function AnnouncementNotices() {
  return <AnnouncementRegion group="notices" />;
}
