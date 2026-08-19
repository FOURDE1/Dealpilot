import { describe, expect, it } from 'vitest';
import { pickStore, distributionPlatformOf, type StoreTally } from './lead-distribution.js';

/** Golden tests for §3 — the spec's own worked example, verbatim, no database. */

function tally(store_id: string, cents: number, received: number): StoreTally {
  return { store_id: store_id, contribution_amount_cents: cents, leads_received: received };
}

describe('the running tally (leads.md §3 worked example, 60/40)', () => {
  it('at 5/5 the 60% store is furthest below and receives the next lead', () => {
    expect(pickStore([tally('a', 6000, 5), tally('b', 4000, 5)])).toEqual({ outcome: 'assigned', store_id: 'a' });
  });

  it('at 6/5 (54.5%) store A is still below 60% — A again', () => {
    expect(pickStore([tally('a', 6000, 6), tally('b', 4000, 5)])).toEqual({ outcome: 'assigned', store_id: 'a' });
  });

  it('at 7/5 store A (58.3%) is STILL 1.7pp below target — the RULE keeps A', () => {
    // The spec's worked example hands this one to B with a shrug ('≈ target'),
    // contradicting its own rule #3: A remains furthest below. The rule is
    // normative, the example is arithmetic hand-waving, and the 100-lead
    // sequence below proves the rule converges on exactly 60/40 — which is
    // the example's actual point (recorded in D-049).
    expect(pickStore([tally('a', 6000, 7), tally('b', 4000, 5)])).toEqual({ outcome: 'assigned', store_id: 'a' });
  });

  it('at 8/5 store A (61.5%) has overshot — NOW B receives the next', () => {
    expect(pickStore([tally('a', 6000, 8), tally('b', 4000, 5)])).toEqual({ outcome: 'assigned', store_id: 'b' });
  });

  it('a fresh month (zero leads) starts with the LARGEST target', () => {
    expect(pickStore([tally('b', 4000, 0), tally('a', 6000, 0)])).toEqual({ outcome: 'assigned', store_id: 'a' });
  });

  it('a long sequence converges on the split — never random', () => {
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 100; i++) {
      const d = pickStore([tally('a', 6000, counts.a), tally('b', 4000, counts.b)]);
      if (d.outcome !== 'assigned') throw new Error('unexpected refusal');
      counts[d.store_id as 'a' | 'b'] += 1;
    }
    expect(counts).toEqual({ a: 60, b: 40 });
  });
});

describe('the named refusals', () => {
  it('no rows = no_config — the lead stays in the queue', () => {
    expect(pickStore([])).toEqual({ outcome: 'no_config' });
  });

  it('rows with zero spend everywhere = no_spend — there are no shares to honour', () => {
    expect(pickStore([tally('a', 0, 0), tally('b', 0, 0)])).toEqual({ outcome: 'no_spend' });
  });

  it('equal deficit AND equal target breaks by store_id — deterministic to the end', () => {
    expect(pickStore([tally('z', 5000, 0), tally('m', 5000, 0)])).toEqual({ outcome: 'assigned', store_id: 'm' });
  });
});

describe('the platform bridge', () => {
  it('maps the two ad sources and nothing else', () => {
    expect(distributionPlatformOf('google_ads')).toBe('google');
    expect(distributionPlatformOf('meta_lead_form')).toBe('meta');
    expect(distributionPlatformOf('website')).toBeNull();
    expect(distributionPlatformOf('autotrader')).toBeNull();
    expect(distributionPlatformOf('walk_in')).toBeNull();
  });
});
