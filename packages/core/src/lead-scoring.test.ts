import { describe, expect, it } from 'vitest';
import { calculateScore, scoreBand, type ScorableLead, type ScoringRule } from './lead-scoring.js';

/**
 * Golden tests for §6.2 — the semantics that make or break trust in a score.
 * Money/priority paths get golden numbers per NFR-QUAL-002.
 */

const NOW = new Date('2026-08-16T12:00:00Z');

function lead(over: Partial<ScorableLead> = {}): ScorableLead {
  return {
    first_name: 'Marie', last_name: 'Tremblay',
    email: 'marie@example.test', phone: '+15145550001',
    source: 'walk_in', source_platform: null,
    status: 'new', preferred_language: 'fr-CA',
    vehicle_interest: 'Kia Sportage', trade_in_status: 'unknown',
    assigned_to: null,
    monthly_budget_cents: null, total_budget_cents: null,
    created_at: '2026-08-16T09:00:00Z',
    ...over,
  };
}

function rule(over: Partial<ScoringRule>): ScoringRule {
  return { id: 'r1', name: 'règle', field: 'has_phone', operator: 'exists', value: null, score: 10, priority: 100, ...over };
}

describe('additive evaluation (§6.2 step 4)', () => {
  it('every matching rule adds; nothing is first-match-wins', () => {
    const r = calculateScore(lead(), [
      rule({ id: 'a', field: 'has_phone', operator: 'exists', score: 10 }),
      rule({ id: 'b', field: 'has_email', operator: 'exists', score: 10, priority: 90 }),
      rule({ id: 'c', field: 'source', operator: 'eq', value: 'walk_in', score: 15, priority: 80 }),
    ]);
    expect(r.score).toBe(35);
    expect(r.breakdown.map((b) => b.rule_id)).toEqual(['a', 'b', 'c']);
  });

  it('clamps the RESULT to [0,100], not the terms', () => {
    expect(calculateScore(lead(), [rule({ score: -40 })]).score).toBe(0);
    expect(calculateScore(lead(), [rule({ score: 150 })]).score).toBe(100);
    // −40 then +50: the sum is 10 — proof the clamp did not zero the negative
    // term before the positive one landed.
    const r = calculateScore(lead(), [
      rule({ id: 'neg', score: -40 }),
      rule({ id: 'pos', score: 50, priority: 50 }),
    ]);
    expect(r.score).toBe(10);
  });

  it('orders the breakdown by priority DESC so the screen reads like the config', () => {
    const r = calculateScore(lead(), [
      rule({ id: 'low', priority: 10, score: 1 }),
      rule({ id: 'high', priority: 200, score: 1 }),
    ]);
    expect(r.breakdown.map((b) => b.rule_id)).toEqual(['high', 'low']);
  });
});

describe('virtual fields (§6.2 step 2)', () => {
  it('budget prefers monthly over total, and compares in DOLLARS', () => {
    const l = lead({ monthly_budget_cents: 45_000, total_budget_cents: 3_000_000 });
    // $450: gte 400 matches, gte 500 does not — cents would have matched both.
    expect(calculateScore(l, [rule({ field: 'budget', operator: 'gte', value: '400' })]).score).toBe(10);
    expect(calculateScore(l, [rule({ field: 'budget', operator: 'gte', value: '500' })]).score).toBe(0);
  });

  it('budget falls back to total when monthly is absent', () => {
    const l = lead({ total_budget_cents: 3_000_000 });
    expect(calculateScore(l, [rule({ field: 'budget', operator: 'gte', value: '25000' })]).score).toBe(10);
  });

  it('has_trade_in: "unknown" is not a yes', () => {
    const r = rule({ field: 'has_trade_in', operator: 'eq', value: 'true', score: 20 });
    expect(calculateScore(lead({ trade_in_status: 'has_trade' }), [r]).score).toBe(20);
    expect(calculateScore(lead({ trade_in_status: 'unknown' }), [r]).score).toBe(0);
    expect(calculateScore(lead({ trade_in_status: 'none' }), [r]).score).toBe(0);
  });

  it('created_days_ago floors whole days', () => {
    const l = lead({ created_at: '2026-08-09T13:00:00Z' }); // 6d23h before NOW
    expect(calculateScore(l, [rule({ field: 'created_days_ago', operator: 'gte', value: '7', score: -10 })], NOW).score).toBe(0);
    const older = lead({ created_at: '2026-08-09T11:00:00Z' }); // 7d1h
    const r = calculateScore(older, [rule({ id: 'cold', field: 'created_days_ago', operator: 'gte', value: '7', score: -10 })], NOW);
    expect(r.breakdown).toHaveLength(1);
    expect(r.score).toBe(0); // clamped from −10
  });
});

describe('operator semantics (§6.2 step 3)', () => {
  it('exists on booleans is the value itself', () => {
    const has = rule({ field: 'has_trade_in', operator: 'exists' });
    expect(calculateScore(lead({ trade_in_status: 'has_trade' }), [has]).score).toBe(10);
    expect(calculateScore(lead({ trade_in_status: 'none' }), [has]).score).toBe(0);
  });

  it('not_exists rewards the gap (the seeded "Unassigned −15" shape)', () => {
    const r = rule({ field: 'assigned_to', operator: 'not_exists', score: 15 });
    expect(calculateScore(lead({ assigned_to: null }), [r]).score).toBe(15);
    expect(calculateScore(lead({ assigned_to: '5e0d2c9e-0000-4000-8000-000000000001' }), [r]).score).toBe(0);
  });

  it('numeric comparison refuses non-numbers instead of coercing garbage', () => {
    expect(calculateScore(lead(), [rule({ field: 'status', operator: 'gte', value: '5' })]).score).toBe(0);
  });

  it('eq and contains are case-insensitive; contains is substring', () => {
    const l = lead({ vehicle_interest: 'Kia Sportage 2026' });
    expect(calculateScore(l, [rule({ field: 'vehicle_interest', operator: 'contains', value: 'sportage' })]).score).toBe(10);
    expect(calculateScore(l, [rule({ field: 'source', operator: 'eq', value: 'WALK_IN' })]).score).toBe(10);
  });

  it('in/not_in split on commas and trim', () => {
    expect(calculateScore(lead(), [rule({ field: 'source', operator: 'in', value: 'web, walk_in ,referral' })]).score).toBe(10);
    expect(calculateScore(lead(), [rule({ field: 'source', operator: 'not_in', value: 'web,referral' })]).score).toBe(10);
    expect(calculateScore(lead(), [rule({ field: 'source', operator: 'in', value: 'web,referral' })]).score).toBe(0);
  });

  it('a comparison rule with no value matches NOTHING (fail closed)', () => {
    expect(calculateScore(lead(), [rule({ field: 'source', operator: 'eq', value: null })]).score).toBe(0);
    expect(calculateScore(lead(), [rule({ field: 'budget', operator: 'gte', value: null })]).score).toBe(0);
  });

  it('null fields compare as empty text, not the string "null"', () => {
    const l = lead({ vehicle_interest: null });
    expect(calculateScore(l, [rule({ field: 'vehicle_interest', operator: 'contains', value: 'null' })]).score).toBe(0);
    expect(calculateScore(l, [rule({ field: 'vehicle_interest', operator: 'neq', value: 'x', score: 5 })]).score).toBe(5);
  });
});

describe('score bands (§6.4)', () => {
  it('hot ≥80, warm 40–79, cold <40 — boundaries exact', () => {
    expect(scoreBand(80)).toBe('hot');
    expect(scoreBand(79)).toBe('warm');
    expect(scoreBand(40)).toBe('warm');
    expect(scoreBand(39)).toBe('cold');
    expect(scoreBand(0)).toBe('cold');
    expect(scoreBand(100)).toBe('hot');
  });
});
