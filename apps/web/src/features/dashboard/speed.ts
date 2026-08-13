/**
 * Presenting speed to lead (leads.md §5).
 *
 * Kept out of the component so it can be tested without a DOM — and because
 * "what counts as meeting the service level" is a claim about the product, not
 * a styling detail.
 */

export type SloState = 'meeting' | 'slipping' | 'breached' | 'unknown';

/**
 * Is the assistant meeting its 60-second service level?
 *
 * 95% and above is meeting it; below 80% is a breach. The gap is 'slipping'
 * rather than a second kind of fine — an SLO with only "good" and "bad" gets
 * argued about at the boundary, and one that reports 88% as healthy is one
 * nobody fixes until a customer complains.
 *
 * With no assistant touches at all the answer is 'unknown', never 'meeting'.
 * A service level nothing was measured against has not been met.
 */
export function sloState(within: number, touches: number): SloState {
  if (touches === 0) return 'unknown';
  const rate = within / touches;
  if (rate >= 0.95) return 'meeting';
  if (rate >= 0.8) return 'slipping';
  return 'breached';
}

/**
 * A duration a person can read at a glance.
 *
 * Seconds under a minute, then minutes, then hours — never "0.03 h", and never
 * a decimal nobody measured. Rounds DOWN, so a number on the dashboard is never
 * worse than the truth and never better than it either: 119 s reads "1 min",
 * which is honest, where "2 min" would overstate the delay.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
