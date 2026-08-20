/**
 * F-54 — duplicate detection vocabulary (leads.md §8.1).
 *
 * Pure: the normalized forms, which fields matched, and what that is worth.
 * The SQL in the API mirrors these normalizations exactly (expression
 * indexes in 0056) — this module is the single place the RULES live, and
 * the tests here are the contract both sides answer to.
 */

export const MATCH_FIELDS = ['phone', 'email', 'name'] as const;
export type MatchField = (typeof MATCH_FIELDS)[number];

/** The seven legal joins, in canonical field order (DB CHECK mirrors). */
export type DuplicateMatchType =
  | 'phone'
  | 'email'
  | 'name'
  | 'phone_email'
  | 'phone_name'
  | 'email_name'
  | 'phone_email_name';

/** §8.1: strip non-digits, keep the LAST 10; valid only with ≥7 digits. */
export function normalizeDupPhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7) return null;
  return digits.slice(-10);
}

/** §8.1: lowercase + trim; valid only when non-empty. */
export function normalizeDupEmail(raw: string | null): string | null {
  const v = (raw ?? '').trim().toLowerCase();
  return v.length > 0 ? v : null;
}

/** §8.1: "first last" lowercased/trimmed; valid only when length > 1. */
export function normalizeDupName(first: string | null, last: string | null): string | null {
  const v = [first ?? '', last ?? ''].join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return v.length > 1 ? v : null;
}

/** Joined matched fields in canonical order — never an empty match. */
export function matchTypeOf(fields: readonly MatchField[]): DuplicateMatchType | null {
  const ordered = MATCH_FIELDS.filter((f) => fields.includes(f));
  if (ordered.length === 0) return null;
  return ordered.join('_') as DuplicateMatchType;
}

/** §8.1: a phone or email match is certainty (100); name alone is 90. */
export function confidenceOf(fields: readonly MatchField[]): number {
  return fields.includes('phone') || fields.includes('email') ? 100 : 90;
}

/**
 * Pair direction (§8.1): the NEWER lead is `lead_id`, the OLDER is
 * `duplicate_of` — the older lead is always the canonical keeper. Ties on
 * created_at break on id so the direction is deterministic.
 */
export function orientPair(
  a: { id: string; created_at: string },
  b: { id: string; created_at: string },
): { lead_id: string; duplicate_of: string } {
  const aNewer = a.created_at > b.created_at || (a.created_at === b.created_at && a.id > b.id);
  return aNewer ? { lead_id: a.id, duplicate_of: b.id } : { lead_id: b.id, duplicate_of: a.id };
}
