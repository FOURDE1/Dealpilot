import { ANNOUNCEMENT_SEVERITY_RANK } from '@dealpilot/core';
import type { AnnouncementSeverityT, AnnouncementT } from '@dealpilot/schemas';

/**
 * F-72 — where each active announcement belongs in the tenant shell (R4).
 *
 * The shell mounts the same row component in two places: an interrupting bar
 * high up, above the MFA nag, and a quieter one just above the page. Which
 * announcement goes where is this one pure function rather than a condition
 * inside either component, so the rule has a test instead of two JSX paths
 * that can disagree.
 *
 * The two sets PARTITION the severity vocabulary — `order.test.ts` asserts
 * that every item lands in exactly one group, so a severity dropped from
 * either arm disappears from the shell loudly rather than silently.
 */

/** An incident or planned maintenance interrupts: it sits above everything. */
const BANNER_SEVERITIES: ReadonlySet<AnnouncementSeverityT> = new Set<AnnouncementSeverityT>(['incident', 'maintenance']);
/** News and promotions wait immediately above the page content. */
const NOTICE_SEVERITIES: ReadonlySet<AnnouncementSeverityT> = new Set<AnnouncementSeverityT>(['info', 'marketing']);

export interface SplitAnnouncements {
  banner: AnnouncementT[];
  notices: AnnouncementT[];
}

/**
 * Urgency first (§8's own order, carried by `ANNOUNCEMENT_SEVERITY_RANK`),
 * then the most recently started — an incident opened five minutes ago
 * outranks one that has been standing since yesterday.
 */
function byUrgencyThenNewest(a: AnnouncementT, b: AnnouncementT): number {
  const rank = ANNOUNCEMENT_SEVERITY_RANK[a.severity] - ANNOUNCEMENT_SEVERITY_RANK[b.severity];
  return rank !== 0 ? rank : Date.parse(b.starts_at) - Date.parse(a.starts_at);
}

export function splitAnnouncements(items: readonly AnnouncementT[]): SplitAnnouncements {
  const banner: AnnouncementT[] = [];
  const notices: AnnouncementT[] = [];
  for (const item of items) {
    if (BANNER_SEVERITIES.has(item.severity)) banner.push(item);
    else if (NOTICE_SEVERITIES.has(item.severity)) notices.push(item);
  }
  return { banner: banner.sort(byUrgencyThenNewest), notices: notices.sort(byUrgencyThenNewest) };
}
