/**
 * F-45 — weighted store distribution (FR-LEAD-007, leads.md §3, D-049).
 *
 * Pure: the month's tallies in, a store out. The database owns the ledger
 * (0050) and the API owns the transaction; this module owns ONLY the
 * running-tally semantics, so they can be golden-tested without a database —
 * including the spec's own 60/40 worked example, verbatim.
 *
 * Running tally, never random: each store's target share is its slice of the
 * platform's ad spend; its actual share is its slice of the month's leads.
 * The next lead goes to the store FURTHEST BELOW target. Determinism the
 * house way — ties break by larger target, then store_id — because a
 * tiebreak by randomness is a flake generator.
 */

/** The two split platforms (leads.md §3). Google and Meta never share a tally. */
export const DISTRIBUTION_PLATFORMS = ['google', 'meta'] as const;
export type DistributionPlatform = (typeof DISTRIBUTION_PLATFORMS)[number];

/** One store's row of the month's ledger, as the engine needs it. */
export interface StoreTally {
  readonly store_id: string;
  readonly contribution_amount_cents: number;
  readonly leads_received: number;
}

export type DistributionDecision =
  | { readonly outcome: 'assigned'; readonly store_id: string }
  /** No ledger rows for this platform+month: the lead stays in the queue. */
  | { readonly outcome: 'no_config' }
  /** Rows exist but every contribution is zero — no shares to honour. */
  | { readonly outcome: 'no_spend' };

export function pickStore(tallies: readonly StoreTally[]): DistributionDecision {
  if (tallies.length === 0) return { outcome: 'no_config' };
  const totalSpend = tallies.reduce((s, t) => s + t.contribution_amount_cents, 0);
  if (totalSpend <= 0) return { outcome: 'no_spend' };
  const totalLeads = tallies.reduce((s, t) => s + t.leads_received, 0);

  let pick: StoreTally | null = null;
  let pickDeficit = -Infinity;
  let pickTarget = -Infinity;
  for (const t of tallies) {
    const target = t.contribution_amount_cents / totalSpend;
    const actual = totalLeads === 0 ? 0 : t.leads_received / totalLeads;
    const deficit = target - actual;
    const wins =
      pick === null ||
      deficit > pickDeficit ||
      (deficit === pickDeficit &&
        (target > pickTarget || (target === pickTarget && t.store_id < pick.store_id)));
    if (wins) {
      pick = t;
      pickDeficit = deficit;
      pickTarget = target;
    }
  }
  return { outcome: 'assigned', store_id: pick!.store_id };
}

/**
 * Which split a lead's source belongs to — the bridge between the source
 * vocabulary (leads.sql CHECK) and the two-platform tally. Everything not an
 * ad platform distributes nowhere and the lead keeps its intake behavior.
 */
export function distributionPlatformOf(source: string): DistributionPlatform | null {
  switch (source) {
    case 'google_ads':
      return 'google';
    case 'meta_lead_form':
      return 'meta';
    default:
      return null;
  }
}
