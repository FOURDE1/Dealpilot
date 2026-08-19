/**
 * F-42 — the post-handoff assignment cascade (FR-LEAD-009, leads.md §7.3).
 *
 * Pure: a lead, a candidate pool, and the managers in, a decision out. The
 * database owns storage (0049) and the API owns the pool query, timezone
 * math, and persistence; this module owns ONLY the funnel semantics, so they
 * can be golden-tested without a database.
 *
 * The funnel, in the spec's order: (1) language match — HARD, Bill 96 is law
 * (D-045 #2); (2) online; (3) on schedule; (4) fewest active leads under the
 * agent's own max_active_leads. No agent survives → the lead is ASSIGNED to
 * the sales manager with method 'escalation' (D-045 #4) — an alerted but
 * unowned lead is an unowned lead.
 *
 * Presence and schedules are TRI-STATE (D-045 #1): `null` means the subsystem
 * has no data for this candidate (presence not yet built; no schedule rows)
 * and the candidate PASSES that step — a funnel that escalates everything
 * because an optional subsystem is not deployed is a funnel nobody turns on.
 * `false` is an affirmative "not available" and filters.
 */

/** Target vocabulary, leads.md:41 — lockstep-tested against schemas + 0049. */
export const ASSIGNMENT_METHODS = [
  'auto_language',
  'auto_availability',
  'manual',
  'escalation',
  'reassignment',
] as const;
export type AssignmentMethod = (typeof ASSIGNMENT_METHODS)[number];

/** History rows may name the funnel; rules may not (D-045 #9). */
export const CASCADE_STRATEGY = 'cascade' as const;

/** What the funnel needs from a lead row. */
export interface CascadeLead {
  readonly preferred_language: string;
}

/** One agent as the funnel sees them. Order of the array IS the tie-break order. */
export interface CascadeCandidate {
  readonly user_id: string;
  /** What they can speak (users.preferred_languages), not their UI locale. */
  readonly languages: readonly string[];
  /** Presence verdict; null until FR-LEAD-014 ships a presence source. */
  readonly online: boolean | null;
  /** Schedule verdict; null when the user has no active schedule rows. */
  readonly scheduled_now: boolean | null;
  readonly active_count: number;
  readonly max_active_leads: number;
}

/**
 * Why nobody was assignable — each names the FIRST step that emptied the
 * pool, because "escalated" has five different remedies: add people, hire a
 * second language, get someone online, fix the rota, or raise a cap.
 */
export const CASCADE_REFUSALS = [
  'no_candidates',
  'no_language_match',
  'nobody_online',
  'nobody_scheduled',
  'all_at_capacity',
] as const;
export type CascadeRefusal = (typeof CASCADE_REFUSALS)[number];

export type CascadeDecision =
  | {
      readonly outcome: 'assigned';
      readonly user_id: string;
      /** auto_language when the language step narrowed the pool (D-045 #5). */
      readonly method: 'auto_language' | 'auto_availability';
    }
  | {
      /** Assigned to the manager — escalation is ownership, not a memo. */
      readonly outcome: 'escalated';
      readonly user_id: string;
      readonly method: 'escalation';
      readonly reason: CascadeRefusal;
    }
  | {
      /** Not even a manager exists. The engine cannot invent people. */
      readonly outcome: 'no_one';
      readonly reason: CascadeRefusal;
    };

/**
 * Run the §7.3 funnel.
 *
 * `candidates` must arrive in deterministic roster order (the API orders by
 * membership created_at) — first-min breaks the step-4 tie by position, the
 * same rule as §7.2, because a tiebreak by randomness is a flake generator.
 * `previousAgents` are excluded up front (FR-LEAD-010 reads); `managers` is
 * the escalation ladder in preference order (sales_manager → gm → owner,
 * resolved by the API) and is NOT subject to capacity (D-045 #4).
 */
export function cascadeAssign(
  lead: CascadeLead,
  candidates: readonly CascadeCandidate[],
  previousAgents: readonly string[],
  managers: readonly string[],
): CascadeDecision {
  const escalate = (reason: CascadeRefusal): CascadeDecision => {
    // A previous agent is skipped even as manager where possible — but the
    // 3-strike rule assigns the manager REGARDLESS, so a fully burned ladder
    // still lands on its first rung rather than nobody.
    const target = managers.find((m) => !previousAgents.includes(m)) ?? managers[0];
    return target === undefined
      ? { outcome: 'no_one', reason }
      : { outcome: 'escalated', user_id: target, method: 'escalation', reason };
  };

  const fresh = candidates.filter((c) => !previousAgents.includes(c.user_id));
  if (fresh.length === 0) return escalate('no_candidates');

  // 1. Language — hard. An FR lead never lands on an EN-only agent.
  const speaking = fresh.filter((c) => c.languages.includes(lead.preferred_language));
  if (speaking.length === 0) return escalate('no_language_match');
  const languageNarrowed = speaking.length < fresh.length;

  // 2. Online — only an affirmative "offline" filters (tri-state, D-045 #1).
  const online = speaking.filter((c) => c.online !== false);
  if (online.length === 0) return escalate('nobody_online');

  // 3. On schedule — same tri-state rule.
  const working = online.filter((c) => c.scheduled_now !== false);
  if (working.length === 0) return escalate('nobody_scheduled');

  // 4. Fewest active leads, under each agent's OWN cap; first-min wins ties.
  const underCap = working.filter((c) => c.active_count < c.max_active_leads);
  if (underCap.length === 0) return escalate('all_at_capacity');
  let pick = underCap[0]!;
  for (const c of underCap) if (c.active_count < pick.active_count) pick = c;

  return {
    outcome: 'assigned',
    user_id: pick.user_id,
    method: languageNarrowed ? 'auto_language' : 'auto_availability',
  };
}
