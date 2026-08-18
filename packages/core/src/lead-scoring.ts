/**
 * The lead scoring rules engine (F-39, leads.md §6).
 *
 * Pure: rules and a lead in, a score and its breakdown out. The database owns
 * storage (0045) and the API owns triggers; this module owns ONLY the §6.2
 * semantics, so they can be golden-tested without a database.
 *
 * Two deliberate divergences from the legacy field list, per ADR-026:
 *
 * The `field` vocabulary is OUR leads table, not the legacy tracker's. Legacy
 * fields that reference columns this schema does not have (tags,
 * employment_status, monthly_income, address, income_threshold,
 * current_vehicle) are NOT accepted — a rule against a field that nothing
 * populates is a rule that silently never matches, which is the dead-vocabulary
 * bug class this codebase keeps hunting. They join the enum when their columns
 * do.
 *
 * `budget` compares in DOLLARS. The columns are integer cents (house rule), but
 * rules are authored by humans who think "budget over 500", not "over 50000".
 * The engine converts before comparing; the rule table stores what the person
 * meant.
 */

export const SCORING_FIELDS = [
  // Direct columns.
  'source', 'source_platform', 'status', 'preferred_language', 'vehicle_interest',
  'first_name', 'last_name', 'phone', 'email', 'trade_in_status', 'assigned_to',
  // Virtual (§6.2 step 2).
  'budget', 'has_phone', 'has_email', 'has_trade_in', 'created_days_ago',
] as const;
export type ScoringField = (typeof SCORING_FIELDS)[number];

export const SCORING_OPERATORS = [
  'gt', 'gte', 'lt', 'lte', 'eq', 'neq',
  'contains', 'not_contains', 'exists', 'not_exists', 'in', 'not_in',
] as const;
export type ScoringOperator = (typeof SCORING_OPERATORS)[number];

/** What the engine needs from a lead row — a subset, all optional-null. */
export interface ScorableLead {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  source: string;
  source_platform: string | null;
  status: string;
  preferred_language: string;
  vehicle_interest: string | null;
  trade_in_status: string;
  assigned_to: string | null;
  monthly_budget_cents: number | null;
  total_budget_cents: number | null;
  created_at: string;
}

export interface ScoringRule {
  id: string;
  name: string;
  field: ScoringField;
  operator: ScoringOperator;
  /** Stringly-typed by design (§6.1); comma lists for in/not_in. */
  value: string | null;
  score: number;
  priority: number;
}

export interface ScoreBreakdownEntry {
  rule_id: string;
  rule_name: string;
  field: ScoringField;
  points: number;
}

export interface ScoreResult {
  /** Clamped to [0, 100] (§6.2 step 5). */
  score: number;
  /** Every rule that MATCHED, in priority-descending evaluation order. */
  breakdown: ScoreBreakdownEntry[];
}

/** §6.2 step 2 — virtual fields resolved from the row. */
function resolve(lead: ScorableLead, field: ScoringField, now: Date): unknown {
  switch (field) {
    case 'budget': {
      const cents = lead.monthly_budget_cents ?? lead.total_budget_cents;
      return cents === null ? null : cents / 100;
    }
    case 'has_phone':
      return lead.phone !== null && lead.phone !== '';
    case 'has_email':
      return lead.email !== null && lead.email !== '';
    case 'has_trade_in':
      // 'unknown' is not a yes: a rule rewarding a trade-in must not fire on
      // "we never asked".
      return lead.trade_in_status === 'has_trade';
    case 'created_days_ago':
      return Math.floor((now.getTime() - new Date(lead.created_at).getTime()) / 86_400_000);
    default:
      return lead[field];
  }
}

/** Empty-ness for exists/not_exists: null, '', and false are all "absent". */
function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value !== '';
  if (typeof value === 'boolean') return value;
  return true;
}

/** §6.2 step 3 — operator semantics, exactly. */
function matches(value: unknown, operator: ScoringOperator, ruleValue: string | null): boolean {
  switch (operator) {
    case 'exists':
      return isPresent(value);
    case 'not_exists':
      return !isPresent(value);
    default:
      break;
  }
  // Every remaining operator needs a rule value to compare against; a rule
  // without one matches nothing rather than everything (fail closed).
  if (ruleValue === null) return false;

  if (operator === 'gt' || operator === 'gte' || operator === 'lt' || operator === 'lte') {
    // Numeric comparison only when BOTH sides parse as numbers and the value
    // is neither boolean nor array — a rule "status gte 5" matches nothing.
    if (typeof value === 'boolean' || Array.isArray(value)) return false;
    const left = typeof value === 'number' ? value : Number(value);
    const right = Number(ruleValue);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    if (operator === 'gt') return left > right;
    if (operator === 'gte') return left >= right;
    if (operator === 'lt') return left < right;
    return left <= right;
  }

  const text = value === null || value === undefined ? '' : String(value);
  switch (operator) {
    case 'eq':
      // Booleans compare by their string form so "has_trade_in eq true" works.
      return text.toLowerCase() === ruleValue.toLowerCase();
    case 'neq':
      return text.toLowerCase() !== ruleValue.toLowerCase();
    case 'contains':
      return text.toLowerCase().includes(ruleValue.toLowerCase());
    case 'not_contains':
      return !text.toLowerCase().includes(ruleValue.toLowerCase());
    case 'in':
    case 'not_in': {
      const list = ruleValue.split(',').map((v) => v.trim().toLowerCase()).filter((v) => v !== '');
      const hit = list.includes(text.toLowerCase());
      return operator === 'in' ? hit : !hit;
    }
  }
}

/**
 * §6.2 — additive, never first-match-wins: every matching rule contributes its
 * points, and the breakdown records each one so a screen can say WHY a lead is
 * hot. Base 0, clamped to [0, 100] at the end (a lead can accumulate −40 and
 * still read 0, by design — the clamp is on the RESULT, not the terms).
 */
export function calculateScore(
  lead: ScorableLead,
  rules: readonly ScoringRule[],
  now: Date = new Date(),
): ScoreResult {
  const ordered = [...rules].sort((a, b) => b.priority - a.priority);
  const breakdown: ScoreBreakdownEntry[] = [];
  let total = 0;
  for (const rule of ordered) {
    if (matches(resolve(lead, rule.field, now), rule.operator, rule.value)) {
      total += rule.score;
      breakdown.push({ rule_id: rule.id, rule_name: rule.name, field: rule.field, points: rule.score });
    }
  }
  return { score: Math.max(0, Math.min(100, total)), breakdown };
}

/** §6.4 — the shared UI + AI vocabulary. Bands, not colors: tokens are the UI's job. */
export function scoreBand(score: number): 'hot' | 'warm' | 'cold' {
  if (score >= 80) return 'hot';
  if (score >= 40) return 'warm';
  return 'cold';
}
