import type { AnnouncementAudienceT, AnnouncementSeverityT } from '@dealpilot/schemas';

/**
 * F-72 — the words and the colours the announcement surfaces use
 * (admin-console.md §8). Every map `satisfies Record<Enum, …>`, so the day a
 * fifth severity or a fourth audience arm is declared the console stops
 * compiling instead of rendering a raw token.
 */

export const SEVERITY_KEYS = {
  info: 'severity_info',
  maintenance: 'severity_maintenance',
  incident: 'severity_incident',
  marketing: 'severity_marketing',
} as const satisfies Record<AnnouncementSeverityT, string>;

export const AUDIENCE_KEYS = {
  all: 'audience_all',
  plan: 'audience_plan',
  organizations: 'audience_organizations',
} as const satisfies Record<AnnouncementAudienceT['type'], string>;

/**
 * Only the surface/text pairs packages/ui gates for contrast in BOTH themes.
 * `info` is deliberately the neutral pair rather than the yellow caution one:
 * yellow means caution, not information. `info` and `marketing` share it and
 * are told apart by the severity chip, which is why colour is never the only
 * signal on these rows.
 */
export const SEVERITY_CLASSES = {
  incident: 'bg-danger-bg text-danger-text',
  maintenance: 'bg-warning-bg text-warning-text',
  info: 'bg-muted text-foreground',
  marketing: 'bg-muted text-foreground',
} as const satisfies Record<AnnouncementSeverityT, string>;

/**
 * §8 authors every announcement in both languages, and migration 0051's rule
 * is that the language is picked at DISPLAY time from the reader's own UI
 * locale — this system stores no per-user language preference to pre-render
 * from. The banner, the register and the detail page all read the same way.
 */
export function inLanguage<T>(language: string, en: T, fr: T): T {
  return language.startsWith('en') ? en : fr;
}
