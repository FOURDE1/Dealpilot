import type { LeadT } from '@dealpilot/schemas';

/** Statuses that mean "being worked" — the middle of the funnel. */
const IN_PROGRESS_STATUSES: readonly LeadT['status'][] = [
  'chatbot_engaged',
  'assigned',
  'contacted',
  'qualified',
];

export interface LeadStats {
  total: number;
  fresh: number;
  inProgress: number;
  converted: number;
}

/** Pure bucket math for the dashboard tiles (unit-tested). */
export function computeLeadStats(items: readonly Pick<LeadT, 'status'>[]): LeadStats {
  return {
    total: items.length,
    fresh: items.filter((l) => l.status === 'new').length,
    inProgress: items.filter((l) => IN_PROGRESS_STATUSES.includes(l.status)).length,
    converted: items.filter((l) => l.status === 'converted').length,
  };
}

/** Newest-first, capped — the "recent" list. */
export function recentLeads<T extends Pick<LeadT, 'created_at'>>(
  items: readonly T[],
  count = 5,
): T[] {
  return [...items]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, count);
}
