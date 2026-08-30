import { describe, expect, it } from 'vitest';
import { BLOCKED_REASONS } from '@dealpilot/core';
import {
  BASIS_GONE_REASONS,
  OPTED_OUT_REASONS,
  PLATFORM_PAUSE_REASONS,
  WAITING_REASONS,
} from './drip-tick.js';

/**
 * F-72 — the drip's answer to every gate refusal, held as a partition.
 *
 * The four sets decide whether a ninety-day sequence ENDS or WAITS, and the
 * difference is not recoverable: an ended ride is not restarted by anything.
 * Before this guard the tick got there by fall-through, so "we decided this
 * reason waits" and "nobody thought about this reason" produced identical
 * code and identical behaviour — until the day the fall-through was wrong.
 *
 * A new reason upstream now fails the build here instead, with the question
 * asked out loud: does this one end the ride, or pause it?
 */

const SETS: [string, ReadonlySet<string>][] = [
  ['OPTED_OUT_REASONS', OPTED_OUT_REASONS],
  ['BASIS_GONE_REASONS', BASIS_GONE_REASONS],
  ['WAITING_REASONS', WAITING_REASONS],
  ['PLATFORM_PAUSE_REASONS', PLATFORM_PAUSE_REASONS],
];

describe('the drip classifies every blocked reason (F-72)', () => {
  it('has a vocabulary worth partitioning', () => {
    // Two sets summing to two values would satisfy everything below.
    expect(BLOCKED_REASONS.length, 'BLOCKED_REASONS read as near-empty').toBeGreaterThan(8);
  });

  it('the four sets cover BLOCKED_REASONS exactly', () => {
    const classified = SETS.flatMap(([, s]) => [...s]).sort();
    expect(
      classified,
      'every gate refusal must be classified as ending the ride or pausing it — an unclassified reason falls through to a wait nobody chose',
    ).toEqual([...BLOCKED_REASONS].sort());
  });

  it('the four sets are pairwise disjoint', () => {
    for (let i = 0; i < SETS.length; i += 1) {
      for (let j = i + 1; j < SETS.length; j += 1) {
        const [aName, a] = SETS[i]!;
        const [bName, b] = SETS[j]!;
        const both = [...a].filter((r) => b.has(r));
        expect(
          both,
          `${aName} and ${bName} both claim these, so which branch runs is decided by the order of the ifs: ${both.join(', ')}`,
        ).toEqual([]);
      }
    }
  });

  it('a platform pause pauses — it never ends a ride', () => {
    // The one classification F-72 exists to get right: a switch is lifted by
    // an operator minutes later, and every dealer's sequence must still be
    // there. `expired` is terminal and nothing restarts it.
    for (const reason of PLATFORM_PAUSE_REASONS) {
      expect(BASIS_GONE_REASONS.has(reason), `${reason} would expire the enrollment`).toBe(false);
      expect(OPTED_OUT_REASONS.has(reason), `${reason} would end the ride`).toBe(false);
    }
  });
});
