import type { LeadT } from '@dealpilot/schemas';

// F-78: the lead-stats bucket math (the floor-as-total tiles' feeder) was
// DELETED with the tiles it fed — the GM report's figures are
// server-computed (D-079). Only the recent-leads LIST survives: a list of
// rows is honest, labelled as one.

/** Newest-first, capped — the "recent" list. */
export function recentLeads<T extends Pick<LeadT, 'created_at'>>(
  items: readonly T[],
  count = 5,
): T[] {
  return [...items]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, count);
}
