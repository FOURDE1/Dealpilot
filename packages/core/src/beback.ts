/**
 * F-52 — the be-back queue's urgency tiers (leads.md §9).
 *
 * A dormant lead's urgency is a fact about TIME, not about the screen showing
 * it: the header alert, the card chip, and any future drip trigger must all
 * agree on what "critical" means, so the thresholds live here beside
 * scoreBand rather than in a component.
 *
 * Dormancy is measured from `last_contacted_at` — the trigger-stamped moment
 * an outbound message actually left — falling back to `updated_at` for leads
 * nothing was ever sent to (leads.md §9: `daysSince(last_contacted_at ||
 * updated_at)`).
 */

export const BEBACK_STATUSES = ['nurture', 'expired', 'lost', 'unresponsive'] as const;
export type BeBackStatus = (typeof BEBACK_STATUSES)[number];

export type BeBackTier = 'critical' | 'high' | 'medium' | 'low';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days since the lead was last touched. Never negative: a lead touched
 * "in the future" (clock skew between app and database) is simply fresh. */
export function daysDormant(dormantSince: string | Date, nowMs: number): number {
  const then = new Date(dormantSince).getTime();
  return Math.max(0, Math.floor((nowMs - then) / DAY_MS));
}

/** leads.md §9: ≥90 critical, ≥30 high, ≥14 medium, under 14 low. */
export function bebackTier(dormantSince: string | Date, nowMs: number): BeBackTier {
  const days = daysDormant(dormantSince, nowMs);
  if (days >= 90) return 'critical';
  if (days >= 30) return 'high';
  if (days >= 14) return 'medium';
  return 'low';
}
