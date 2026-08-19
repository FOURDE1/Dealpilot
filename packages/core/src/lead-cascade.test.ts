import { describe, expect, it } from 'vitest';
import { cascadeAssign, type CascadeCandidate } from './lead-cascade.js';

/** Golden tests for §7.3 — every branch of the funnel, no database. */

function agent(over: Partial<CascadeCandidate> = {}): CascadeCandidate {
  return {
    user_id: 'a',
    languages: ['fr-CA'],
    online: null,
    scheduled_now: null,
    active_count: 0,
    max_active_leads: 10,
    ...over,
  };
}

const FR = { preferred_language: 'fr-CA' };
const EN = { preferred_language: 'en-CA' };
const MGRS = ['mgr-sales', 'mgr-gm'];

describe('the four steps, in order', () => {
  it('language is a HARD filter — an FR lead never lands on an EN-only agent', () => {
    const d = cascadeAssign(FR, [agent({ user_id: 'en-only', languages: ['en-CA'] })], [], MGRS);
    expect(d).toEqual({ outcome: 'escalated', user_id: 'mgr-sales', method: 'escalation', reason: 'no_language_match' });
  });

  it('a bilingual agent serves both — and the method says language narrowed the pool', () => {
    const pool = [
      agent({ user_id: 'en-only', languages: ['en-CA'] }),
      agent({ user_id: 'both', languages: ['fr-CA', 'en-CA'] }),
    ];
    expect(cascadeAssign(FR, pool, [], MGRS)).toEqual({
      outcome: 'assigned', user_id: 'both', method: 'auto_language',
    });
  });

  it('when everyone speaks the language, the method is auto_availability', () => {
    const pool = [agent({ user_id: 'a' }), agent({ user_id: 'b' })];
    expect(cascadeAssign(FR, pool, [], MGRS)).toMatchObject({ user_id: 'a', method: 'auto_availability' });
  });

  it('online: false filters, null passes — unknown is not offline (D-045 #1)', () => {
    const pool = [
      agent({ user_id: 'off', online: false }),
      agent({ user_id: 'unknown', online: null }),
    ];
    expect(cascadeAssign(FR, pool, [], MGRS)).toMatchObject({ outcome: 'assigned', user_id: 'unknown' });
    expect(cascadeAssign(FR, [agent({ user_id: 'off', online: false })], [], MGRS)).toMatchObject({
      outcome: 'escalated', reason: 'nobody_online',
    });
  });

  it('schedule: false filters, null passes — no rota rows means always available', () => {
    const pool = [
      agent({ user_id: 'off-shift', scheduled_now: false }),
      agent({ user_id: 'no-rota', scheduled_now: null }),
    ];
    expect(cascadeAssign(FR, pool, [], MGRS)).toMatchObject({ outcome: 'assigned', user_id: 'no-rota' });
    expect(cascadeAssign(FR, [agent({ scheduled_now: false })], [], MGRS)).toMatchObject({
      outcome: 'escalated', reason: 'nobody_scheduled',
    });
  });

  it('fewest active wins; first-min breaks the tie by roster position', () => {
    const pool = [
      agent({ user_id: 'busy', active_count: 5 }),
      agent({ user_id: 'first-min', active_count: 2 }),
      agent({ user_id: 'also-min', active_count: 2 }),
    ];
    expect(cascadeAssign(FR, pool, [], MGRS)).toMatchObject({ user_id: 'first-min' });
  });

  it('the cap is each agent\'s OWN max_active_leads — at cap means out', () => {
    const pool = [
      agent({ user_id: 'capped', active_count: 3, max_active_leads: 3 }),
      agent({ user_id: 'room', active_count: 9, max_active_leads: 10 }),
    ];
    expect(cascadeAssign(FR, pool, [], MGRS)).toMatchObject({ user_id: 'room' });
    expect(cascadeAssign(FR, [agent({ active_count: 10 })], [], MGRS)).toMatchObject({
      outcome: 'escalated', reason: 'all_at_capacity',
    });
  });
});

describe('escalation (D-045 #4)', () => {
  it('escalation ASSIGNS to the first manager, capacity notwithstanding', () => {
    expect(cascadeAssign(FR, [], [], MGRS)).toEqual({
      outcome: 'escalated', user_id: 'mgr-sales', method: 'escalation', reason: 'no_candidates',
    });
  });

  it('a manager who already had the lead is skipped for the next rung…', () => {
    expect(cascadeAssign(FR, [], ['mgr-sales'], MGRS)).toMatchObject({ user_id: 'mgr-gm' });
  });

  it('…but a fully burned ladder still lands on its first rung, not on nobody', () => {
    expect(cascadeAssign(FR, [], ['mgr-sales', 'mgr-gm'], MGRS)).toMatchObject({ user_id: 'mgr-sales' });
  });

  it('with no managers at all, the engine says no_one — it cannot invent people', () => {
    expect(cascadeAssign(FR, [], [], [])).toEqual({ outcome: 'no_one', reason: 'no_candidates' });
  });
});

describe('previous agents (FR-LEAD-010 reads)', () => {
  it('a previous agent is excluded even if they are the only eligible one', () => {
    const d = cascadeAssign(EN, [agent({ user_id: 'burned', languages: ['en-CA'] })], ['burned'], MGRS);
    expect(d).toMatchObject({ outcome: 'escalated', reason: 'no_candidates' });
  });

  it('exclusion happens BEFORE the language step — the refusal names the true first gap', () => {
    const pool = [
      agent({ user_id: 'burned', languages: ['en-CA'] }),
      agent({ user_id: 'fr-only', languages: ['fr-CA'] }),
    ];
    expect(cascadeAssign(EN, pool, ['burned'], MGRS)).toMatchObject({
      outcome: 'escalated', reason: 'no_language_match',
    });
  });
});
