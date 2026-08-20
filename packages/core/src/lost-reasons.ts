/**
 * F-53 — the default lost-reason vocabulary (leads.md §11, ADR-026).
 *
 * Nine bilingual defaults every organization starts from. This list is the
 * CANONICAL copy: F-01 provisioning inserts it for each new organization.
 * Migration 0055 carries a frozen duplicate for organizations that existed
 * before it — that copy is history and never edited (forward-only rule).
 */
export const LOST_REASON_DEFAULTS = [
  { name: 'Price too high', name_fr: 'Prix trop élevé', icon: '💰' },
  { name: 'Chose competitor', name_fr: 'A choisi un concurrent', icon: '🏪' },
  { name: 'Bad timing', name_fr: 'Mauvais moment', icon: '⏰' },
  { name: 'No response', name_fr: 'Aucune réponse', icon: '📵' },
  { name: 'Changed mind', name_fr: "A changé d'avis", icon: '🔄' },
  { name: 'Found elsewhere', name_fr: 'Trouvé ailleurs', icon: '🔍' },
  { name: 'Financing denied', name_fr: 'Financement refusé', icon: '🏦' },
  { name: 'Just browsing', name_fr: 'Juste en exploration', icon: '👀' },
  { name: 'Other', name_fr: 'Autre', icon: '📝' },
] as const;

/** The label a reader should see: FR-first product, FR when the locale is French. */
export function lostReasonLabel(
  reason: { name: string; name_fr: string },
  locale: string,
): string {
  return locale.startsWith('fr') ? reason.name_fr : reason.name;
}
