/**
 * The lead assignment engine (F-40, leads.md §7).
 *
 * Pure: rules, the candidate pool and the round-robin cursor in; a decision
 * out. The database owns storage (0046) and the API owns the pool query and
 * cursor persistence; this module owns ONLY §7.2's algorithm, so every branch
 * of it can be golden-tested without a database.
 *
 * §7.2's shape, kept exactly:
 * - Rules are checked priority ASCENDING (lower number first) — note this is
 *   the OPPOSITE of scoring, which is additive and orders descending. One
 *   rule wins here; every rule counts there.
 * - The first rule whose `sources` is empty or contains the lead's source
 *   wins. No rule matching → no assignment, said plainly.
 * - Pool = candidates ∩ included_users − excluded_users; a cap on active
 *   leads drops candidates at or over it.
 * - round_robin walks the rule's own cursor; load_balanced takes the fewest
 *   active with first-min winning ties; source_based looks up the mapping and
 *   falls back to the first eligible.
 */

export const ASSIGNMENT_STRATEGIES = ['round_robin', 'load_balanced', 'source_based'] as const;
export type AssignmentStrategy = (typeof ASSIGNMENT_STRATEGIES)[number];

export interface AssignmentRule {
  id: string;
  name: string;
  strategy: AssignmentStrategy;
  priority: number;
  /** Empty = catch-all. */
  sources: readonly string[];
  /** Empty = every candidate. */
  included_users: readonly string[];
  excluded_users: readonly string[];
  /** source → user_id, for source_based. */
  source_mappings: Readonly<Record<string, string>>;
  /** 0 = unlimited. Cap on ACTIVE (non-terminal) leads. */
  max_leads_per_user: number;
}

export interface AssignmentCandidate {
  user_id: string;
  /** Non-terminal leads currently assigned to them. */
  active_count: number;
}

export type AssignmentDecision =
  | {
      outcome: 'assigned';
      user_id: string;
      rule_id: string;
      rule_name: string;
      strategy: AssignmentStrategy;
      /** For round_robin: the cursor value to persist. Unchanged otherwise. */
      next_index: number | null;
    }
  | {
      /**
       * Named refusals, because "the lead stayed unassigned" has three
       * different remedies: write a rule, hire or include somebody, or raise
       * the cap. The board's red escalation band needs to say which.
       */
      outcome: 'no_rule' | 'no_eligible_users' | 'all_at_capacity';
    };

export function assignLead(
  lead: { source: string },
  rules: readonly AssignmentRule[],
  candidates: readonly AssignmentCandidate[],
  /** The matched rule's persisted round-robin cursor (−1 when fresh). */
  cursorFor: (ruleId: string) => number,
): AssignmentDecision {
  const ordered = [...rules].sort((a, b) => a.priority - b.priority);
  const rule = ordered.find((r) => r.sources.length === 0 || r.sources.includes(lead.source));
  if (!rule) return { outcome: 'no_rule' };

  const included = new Set(rule.included_users);
  const excluded = new Set(rule.excluded_users);
  let pool = candidates.filter(
    (c) => (included.size === 0 || included.has(c.user_id)) && !excluded.has(c.user_id),
  );
  if (pool.length === 0) return { outcome: 'no_eligible_users' };

  if (rule.max_leads_per_user > 0) {
    pool = pool.filter((c) => c.active_count < rule.max_leads_per_user);
    if (pool.length === 0) return { outcome: 'all_at_capacity' };
  }

  switch (rule.strategy) {
    case 'round_robin': {
      const next = (cursorFor(rule.id) + 1) % pool.length;
      return {
        outcome: 'assigned', user_id: pool[next]!.user_id,
        rule_id: rule.id, rule_name: rule.name, strategy: rule.strategy, next_index: next,
      };
    }
    case 'load_balanced': {
      // First-min wins ties (§7.2), which keeps the choice deterministic and
      // therefore testable — a tiebreak by randomness is a flake generator.
      let best = pool[0]!;
      for (const c of pool) if (c.active_count < best.active_count) best = c;
      return {
        outcome: 'assigned', user_id: best.user_id,
        rule_id: rule.id, rule_name: rule.name, strategy: rule.strategy, next_index: null,
      };
    }
    case 'source_based': {
      const mapped = rule.source_mappings[lead.source];
      const hit = mapped === undefined ? undefined : pool.find((c) => c.user_id === mapped);
      // The mapping names somebody ineligible (excluded, capped, not a
      // candidate) → first eligible, not a failure: a mapping is a preference,
      // and a preference that cannot be honoured must not strand the lead.
      const chosen = hit ?? pool[0]!;
      return {
        outcome: 'assigned', user_id: chosen.user_id,
        rule_id: rule.id, rule_name: rule.name, strategy: rule.strategy, next_index: null,
      };
    }
  }
}
