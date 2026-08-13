/**
 * Speed to lead (leads.md §5, ADR-025).
 *
 * The one number this product is sold on. Leads answered inside five minutes
 * are 21× more likely to qualify and 13.2% of dealerships manage it, so the
 * bands below are not decoration — they are the claim, and a dashboard that
 * rounds them generously is a dashboard that lies to the person paying for it.
 *
 * Everything here is pure and takes seconds. No clocks, no "now": a rating that
 * depends on when you look at it cannot be reproduced in a report.
 */

/** §5.1: full progress bar = SLA consumed. */
export const SLA_TARGET_SECONDS = 300;

/** ADR-025's service level for the assistant's first message. */
export const AI_FIRST_TOUCH_SLO_SECONDS = 60;

export type SpeedRating = 'excellent' | 'good' | 'fair' | 'slow';

/** §5.1's bands, in seconds: 5 minutes, 15, 30. */
export const RATING_BOUNDS: readonly { readonly rating: SpeedRating; readonly under: number }[] = [
  { rating: 'excellent', under: 300 },
  { rating: 'good', under: 900 },
  { rating: 'fair', under: 1800 },
];

/**
 * How well did we answer this lead?
 *
 * Strictly under, never "or equal": 300 seconds exactly is five minutes gone,
 * and the 21× figure is about leads answered INSIDE five minutes. Rounding the
 * boundary the friendly way is how a dashboard drifts from the promise.
 */
export function rateResponse(seconds: number): SpeedRating {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error(`response time must be a non-negative number of seconds: ${seconds}`);
  }
  for (const band of RATING_BOUNDS) if (seconds < band.under) return band.rating;
  return 'slow';
}

/** How much of the human SLA is gone, clamped so a bar cannot overflow. */
export function slaFraction(ageSeconds: number, target = SLA_TARGET_SECONDS): number {
  if (ageSeconds < 0) return 0;
  return Math.min(1, ageSeconds / target);
}

export type LeadAgeBand = 'fresh' | 'handoff_due' | 'escalate';

/**
 * What the board should be shouting (§5.1's lead-age colours).
 *
 * `assigned` matters at the far end only: after fifteen minutes an unassigned
 * lead is an escalation, while an assigned one is somebody's problem and
 * already on their screen.
 */
export function leadAgeBand(ageSeconds: number, opts: { assigned: boolean }): LeadAgeBand {
  if (ageSeconds < 300) return 'fresh';
  if (ageSeconds < 900) return 'handoff_due';
  return opts.assigned ? 'handoff_due' : 'escalate';
}

export interface SpeedSummary {
  readonly contacted: number;
  readonly uncontacted: number;
  readonly byRating: Readonly<Record<SpeedRating, number>>;
  /** Median, not mean: one lead answered three days late moves an average and not a median. */
  readonly medianSeconds: number | null;
  /** Of the assistant's own first touches, how many landed inside the SLO. */
  readonly aiWithinSlo: number;
  readonly aiTouches: number;
}

export interface SpeedSample {
  readonly responseTimeSeconds: number | null;
  /** True when the first outbound to this lead came from the assistant. */
  readonly firstTouchByAi: boolean;
}

export function summarise(samples: readonly SpeedSample[]): SpeedSummary {
  const byRating: Record<SpeedRating, number> = { excellent: 0, good: 0, fair: 0, slow: 0 };
  const times: number[] = [];
  let uncontacted = 0;
  let aiTouches = 0;
  let aiWithinSlo = 0;

  for (const s of samples) {
    if (s.responseTimeSeconds === null) {
      uncontacted += 1;
      continue;
    }
    byRating[rateResponse(s.responseTimeSeconds)] += 1;
    times.push(s.responseTimeSeconds);
    if (s.firstTouchByAi) {
      aiTouches += 1;
      if (s.responseTimeSeconds < AI_FIRST_TOUCH_SLO_SECONDS) aiWithinSlo += 1;
    }
  }

  times.sort((a, b) => a - b);
  const medianSeconds = times.length === 0
    ? null
    : times.length % 2 === 1
      ? times[(times.length - 1) / 2]!
      // Even count: the mean of the middle pair, floored — a median in whole
      // seconds, because a report that says 47.5 s invites a decimal nobody
      // measured.
      : Math.floor((times[times.length / 2 - 1]! + times[times.length / 2]!) / 2);

  return { contacted: times.length, uncontacted, byRating, medianSeconds, aiWithinSlo, aiTouches };
}
