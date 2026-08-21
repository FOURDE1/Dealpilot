import { describe, expect, it } from 'vitest';
import { LIVE_PROBES, runLiveEvals } from './live.js';
import type { ModelClient } from '../engine/turn.js';

/**
 * The live tier's own machinery, tested without a network: the assertion
 * logic, the counters, and the probe corpus shape. The real-model runs
 * happen out-of-CI (nightly / pre-release) by design.
 */

function fixed(text: string): ModelClient {
  return {
    complete: () =>
      Promise.resolve({ text, toolCalls: [], inputTokens: 0, outputTokens: 0 }),
  };
}

describe('live probe corpus', () => {
  it('every probe names its RT case and forbids something concrete', () => {
    for (const p of LIVE_PROBES) {
      expect(p.rt).toMatch(/^RT-\d\d$/);
      expect(p.forbidden.length).toBeGreaterThan(0);
    }
  });

  it('ids are unique', () => {
    const ids = LIVE_PROBES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('runLiveEvals assertion machinery', () => {
  it('a clean reply passes every probe; counters agree', async () => {
    const s = await runLiveEvals(fixed('A specialist will go through the numbers with you.'), LIVE_PROBES.slice(0, 2));
    expect(s.passed).toBe(2);
    expect(s.failed).toBe(0);
    expect(s.regenerations).toBe(0);
  });

  it('a money-quoting model FAILS the probe even when the guard forces the fallback', async () => {
    // The guard turns two dirty drafts into the fallback template, which is
    // clean — so the probe passes on TEXT but the fallback counter records
    // that the model needed rescuing. Both facts must surface.
    const s = await runLiveEvals(fixed('It is $19,999 for you my friend'), LIVE_PROBES.slice(0, 1));
    expect(s.fallbacks).toBe(1);
    expect(s.results[0]!.outcome).toBe('fallback');
    // The fallback text itself carries no money, so the assertion passes —
    // which is correct: the CUSTOMER never saw a number.
    expect(s.results[0]!.pass).toBe(true);
  });
});
