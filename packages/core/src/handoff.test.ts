import { describe, expect, it } from 'vitest';
import {
  CANNOT_ANSWER_TURNS, evaluateHandoff, requiredFieldsCollected,
  type HandoffFacts, type LeadFacts,
} from './handoff.js';

/**
 * §9's six triggers.
 *
 * Each one gets a case that fires it AND a case that proves it is what fired —
 * a trigger that only ever appears alongside four others is a trigger nobody has
 * tested. The interesting failures here are silent: a handoff that does not
 * happen looks exactly like a conversation still going well.
 */

const COMPLETE_LEAD: LeadFacts = {
  firstName: 'Marie',
  vehicleInterest: 'Sorento EX 2024',
  budgetCents: 3_500_000,
  tradeInStatus: 'has_trade',
};

const QUIET: HandoffFacts = {
  status: 'bot_active',
  flags: { wantsHuman: false, highIntent: false, cannotAnswer: false, safety: false },
  lead: { firstName: 'Marie', vehicleInterest: null, budgetCents: null, tradeInStatus: 'unknown' },
  consecutiveCannotAnswer: 0,
  botMessagesSent: 3,
  botTurnCap: 15,
};

function facts(over: Partial<HandoffFacts> = {}): HandoffFacts {
  return { ...QUIET, ...over };
}

describe('a conversation nothing has happened in', () => {
  it('stays with the assistant', () => {
    expect(evaluateHandoff(QUIET)).toMatchObject({ handOff: false });
  });
});

describe('each trigger, on its own', () => {
  it('1 — the client asks for a person', () => {
    const d = evaluateHandoff(facts({ flags: { ...QUIET.flags, wantsHuman: true } }));
    expect(d).toMatchObject({ handOff: true, trigger: 'client_asked', urgency: 'immediate' });
  });

  it('2 — every required field is known', () => {
    const d = evaluateHandoff(facts({ lead: COMPLETE_LEAD }));
    expect(d).toMatchObject({ handOff: true, trigger: 'fields_complete', urgency: 'normal' });
  });

  it('3 — high buying intent', () => {
    const d = evaluateHandoff(facts({ flags: { ...QUIET.flags, highIntent: true } }));
    expect(d).toMatchObject({ handOff: true, trigger: 'high_intent', urgency: 'immediate' });
  });

  it('4 — the assistant could not answer, twice running', () => {
    expect(evaluateHandoff(facts({ consecutiveCannotAnswer: 1 }))).toMatchObject({ handOff: false });
    const d = evaluateHandoff(facts({ consecutiveCannotAnswer: CANNOT_ANSWER_TURNS }));
    expect(d).toMatchObject({ handOff: true, trigger: 'cannot_answer' });
  });

  it('5 — the turn cap', () => {
    expect(evaluateHandoff(facts({ botMessagesSent: 14, botTurnCap: 15 }))).toMatchObject({ handOff: false });
    expect(evaluateHandoff(facts({ botMessagesSent: 15, botTurnCap: 15 })))
      .toMatchObject({ handOff: true, trigger: 'turn_cap' });
    // The cap is a tenant setting, so a tenant that lowers it is obeyed.
    expect(evaluateHandoff(facts({ botMessagesSent: 4, botTurnCap: 4 })))
      .toMatchObject({ handOff: true, trigger: 'turn_cap' });
  });

  it('6 — safety, which outranks everything', () => {
    const d = evaluateHandoff(facts({
      flags: { wantsHuman: false, highIntent: true, cannotAnswer: true, safety: true },
      lead: COMPLETE_LEAD,
      botMessagesSent: 99,
    }));
    // Not 'high_intent', not 'fields_complete', not 'turn_cap'. Somebody who has
    // mentioned self-harm is not a lead with a complete profile.
    expect(d).toMatchObject({ handOff: true, trigger: 'safety', urgency: 'immediate' });
  });
});

describe('what counts as a collected field', () => {
  it('needs all four', () => {
    expect(requiredFieldsCollected(COMPLETE_LEAD)).toBe(true);
    expect(requiredFieldsCollected({ ...COMPLETE_LEAD, firstName: null })).toBe(false);
    expect(requiredFieldsCollected({ ...COMPLETE_LEAD, vehicleInterest: null })).toBe(false);
    expect(requiredFieldsCollected({ ...COMPLETE_LEAD, budgetCents: null })).toBe(false);
  });

  it('does not count a blank string as an answer', () => {
    expect(requiredFieldsCollected({ ...COMPLETE_LEAD, firstName: '   ' })).toBe(false);
    expect(requiredFieldsCollected({ ...COMPLETE_LEAD, vehicleInterest: '' })).toBe(false);
  });

  it('counts a budget of zero, because zero is an answer', () => {
    // `budgetCents || null` would read 0 as missing and keep the assistant
    // talking to somebody who has already said they have nothing to spend.
    expect(requiredFieldsCollected({ ...COMPLETE_LEAD, budgetCents: 0 })).toBe(true);
  });

  it('treats "unknown" trade-in as unasked, and "none" as answered', () => {
    expect(requiredFieldsCollected({ ...COMPLETE_LEAD, tradeInStatus: 'unknown' })).toBe(false);
    // "I have no trade" is a complete answer — a boolean column would have made
    // these two indistinguishable and this trigger would never fire honestly.
    expect(requiredFieldsCollected({ ...COMPLETE_LEAD, tradeInStatus: 'none' })).toBe(true);
  });
});

describe('a conversation somebody already has', () => {
  it.each(['handed_off', 'agent_active', 'drip_active', 'closed'] as const)(
    'is never handed off again from %s',
    (status) => {
      const d = evaluateHandoff(facts({
        status,
        flags: { wantsHuman: true, highIntent: true, cannotAnswer: true, safety: true },
        lead: COMPLETE_LEAD,
      }));
      // Every trigger is firing at once and it still says no: reassigning would
      // take the conversation away from the agent currently holding it.
      expect(d).toMatchObject({ handOff: false });
    },
  );
});
