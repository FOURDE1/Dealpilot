import { describe, expect, it } from 'vitest';
import { assignLead, type AssignmentCandidate, type AssignmentRule } from './lead-assignment.js';

/** Golden tests for §7.2 — every branch of the algorithm, no database. */

function rule(over: Partial<AssignmentRule> = {}): AssignmentRule {
  return {
    id: 'r1', name: 'règle', strategy: 'round_robin', priority: 1,
    sources: [], included_users: [], excluded_users: [],
    source_mappings: {}, max_leads_per_user: 0,
    ...over,
  };
}

function pool(...counts: [string, number][]): AssignmentCandidate[] {
  return counts.map(([user_id, active_count]) => ({ user_id, active_count }));
}

const fresh = () => -1;

describe('rule matching (priority ASC, first source match wins)', () => {
  it('lower priority number is checked first — the OPPOSITE of scoring', () => {
    const d = assignLead(
      { source: 'web' },
      [
        rule({ id: 'later', priority: 10, sources: [] }),
        rule({ id: 'first', priority: 1, sources: ['web'] }),
      ],
      pool(['a', 0]),
      fresh,
    );
    expect(d).toMatchObject({ outcome: 'assigned', rule_id: 'first' });
  });

  it('empty sources is a catch-all; a non-matching specific rule is skipped', () => {
    const d = assignLead(
      { source: 'referral' },
      [
        rule({ id: 'web-only', priority: 1, sources: ['web'] }),
        rule({ id: 'catch', priority: 2, sources: [] }),
      ],
      pool(['a', 0]),
      fresh,
    );
    expect(d).toMatchObject({ outcome: 'assigned', rule_id: 'catch' });
  });

  it('no rule matches → no_rule, never a guess', () => {
    const d = assignLead({ source: 'walk_in' }, [rule({ sources: ['web'] })], pool(['a', 0]), fresh);
    expect(d).toEqual({ outcome: 'no_rule' });
  });
});

describe('the pool (§7.2: candidates ∩ included − excluded, then the cap)', () => {
  it('included narrows, excluded removes, and exclusion beats inclusion', () => {
    const d = assignLead(
      { source: 'web' },
      [rule({ strategy: 'load_balanced', included_users: ['a', 'b'], excluded_users: ['a'] })],
      pool(['a', 0], ['b', 5], ['c', 0]),
      fresh,
    );
    expect(d).toMatchObject({ outcome: 'assigned', user_id: 'b' });
  });

  it('everyone excluded → no_eligible_users, its own named refusal', () => {
    const d = assignLead(
      { source: 'web' },
      [rule({ excluded_users: ['a', 'b'] })],
      pool(['a', 0], ['b', 0]),
      fresh,
    );
    expect(d).toEqual({ outcome: 'no_eligible_users' });
  });

  it('the cap drops users AT the limit, and all-capped is its own refusal', () => {
    const under = assignLead(
      { source: 'web' },
      [rule({ strategy: 'load_balanced', max_leads_per_user: 10 })],
      pool(['at-cap', 10], ['under', 9]),
      fresh,
    );
    expect(under).toMatchObject({ outcome: 'assigned', user_id: 'under' });

    const all = assignLead(
      { source: 'web' },
      [rule({ max_leads_per_user: 10 })],
      pool(['a', 10], ['b', 12]),
      fresh,
    );
    expect(all).toEqual({ outcome: 'all_at_capacity' });
  });

  it('0 means unlimited, not "cap at zero"', () => {
    const d = assignLead(
      { source: 'web' },
      [rule({ strategy: 'load_balanced', max_leads_per_user: 0 })],
      pool(['busy', 500]),
      fresh,
    );
    expect(d).toMatchObject({ outcome: 'assigned', user_id: 'busy' });
  });
});

describe('round_robin', () => {
  it('walks the cursor and wraps — golden sequence', () => {
    const rules = [rule({ id: 'rr' })];
    const p = pool(['a', 0], ['b', 0], ['c', 0]);
    let cursor = -1;
    const picks: string[] = [];
    for (let i = 0; i < 4; i++) {
      const d = assignLead({ source: 'web' }, rules, p, () => cursor);
      if (d.outcome !== 'assigned') throw new Error(d.outcome);
      picks.push(d.user_id);
      cursor = d.next_index!;
    }
    // a, b, c, then WRAPS to a — the modulo is the whole point of the cursor.
    expect(picks).toEqual(['a', 'b', 'c', 'a']);
  });

  it('a shrunken pool still lands inside it (cursor beyond length wraps)', () => {
    const d = assignLead({ source: 'web' }, [rule({ id: 'rr' })], pool(['a', 0], ['b', 0]), () => 5);
    if (d.outcome !== 'assigned') throw new Error(d.outcome);
    expect(['a', 'b']).toContain(d.user_id);
    expect(d.next_index).toBe(0); // (5+1) % 2
  });
});

describe('load_balanced', () => {
  it('fewest active wins; FIRST min wins ties (deterministic, testable)', () => {
    const d = assignLead(
      { source: 'web' },
      [rule({ strategy: 'load_balanced' })],
      pool(['first-min', 2], ['also-2', 2], ['busy', 7]),
      fresh,
    );
    expect(d).toMatchObject({ outcome: 'assigned', user_id: 'first-min' });
  });
});

describe('source_based', () => {
  it('honours the mapping when the mapped user is eligible', () => {
    const d = assignLead(
      { source: 'web' },
      [rule({ strategy: 'source_based', source_mappings: { web: 'specialist' } })],
      pool(['other', 0], ['specialist', 3]),
      fresh,
    );
    expect(d).toMatchObject({ outcome: 'assigned', user_id: 'specialist' });
  });

  it('an ineligible mapped user falls back to first eligible — a preference, not a wall', () => {
    const d = assignLead(
      { source: 'web' },
      [rule({
        strategy: 'source_based',
        source_mappings: { web: 'capped' },
        max_leads_per_user: 5,
      })],
      pool(['capped', 5], ['fallback', 1]),
      fresh,
    );
    expect(d).toMatchObject({ outcome: 'assigned', user_id: 'fallback' });
  });

  it('an unmapped source also falls back to first eligible', () => {
    const d = assignLead(
      { source: 'referral' },
      [rule({ strategy: 'source_based', source_mappings: { web: 'x' } })],
      pool(['a', 0]),
      fresh,
    );
    expect(d).toMatchObject({ outcome: 'assigned', user_id: 'a' });
  });
});
