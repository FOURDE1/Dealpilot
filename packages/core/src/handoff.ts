/**
 * When the assistant stops and a person starts (conversation-engine.md §9).
 *
 * Six triggers, and the asymmetry between them is the whole design. Handing off
 * too early costs a salesperson two minutes. Handing off too late costs the sale
 * — or, on trigger 6, means a machine kept talking to somebody in distress. So
 * every ambiguity resolves towards the human, and no trigger is conditional on
 * the assistant's own confidence in itself.
 *
 * This is a pure function over facts. The model supplies flags; it does not get
 * a vote on whether a handoff happens, because a model that can decide it is not
 * needed is one that can be argued into deciding it (§11).
 */

export type HandoffTrigger =
  | 'client_asked'
  | 'fields_complete'
  | 'high_intent'
  | 'cannot_answer'
  | 'turn_cap'
  | 'safety';

export type ConversationStatus = 'bot_active' | 'handed_off' | 'agent_active' | 'drip_active' | 'closed';

/**
 * What the model reported about this turn.
 *
 * Untrusted in the sense that matters: a flag set to `true` starts a handoff,
 * which is safe. There is deliberately no flag that PREVENTS one.
 */
export interface ConversationFlags {
  readonly wantsHuman: boolean;
  readonly highIntent: boolean;
  readonly cannotAnswer: boolean;
  /** Threats, self-harm, legal threats (§9 trigger 6). */
  readonly safety: boolean;
}

/** §9 trigger 2: "name + vehicle interest + budget + trade-in status all non-null". */
export interface LeadFacts {
  readonly firstName: string | null;
  readonly vehicleInterest: string | null;
  readonly budgetCents: number | null;
  readonly tradeInStatus: 'none' | 'has_trade' | 'unknown';
}

export interface HandoffFacts {
  readonly status: ConversationStatus;
  readonly flags: ConversationFlags;
  readonly lead: LeadFacts;
  /**
   * How many turns in a row the assistant has said it cannot answer, INCLUDING
   * this one. §9's Target threshold is 2 — one shrug is a bad question, two is
   * a conversation going nowhere.
   */
  readonly consecutiveCannotAnswer: number;
  /** Assistant messages sent in this conversation so far. */
  readonly botMessagesSent: number;
  readonly botTurnCap: number;
}

export type HandoffDecision =
  | { readonly handOff: false; readonly reason: string }
  | {
      readonly handOff: true;
      readonly trigger: HandoffTrigger;
      /** `immediate` skips the "let me connect you" pleasantry and pages a human. */
      readonly urgency: 'immediate' | 'normal';
      readonly reason: string;
    };

/** §9 trigger 4, Target definition. */
export const CANNOT_ANSWER_TURNS = 2;

/** A field a customer left blank is not a field they answered. */
function present(value: string | null): boolean {
  return value !== null && value.trim() !== '';
}

/**
 * §9 trigger 2. `unknown` is not an answer about a trade-in — it is the absence
 * of one, which is why the column has three values and not a boolean: "no
 * trade" and "never asked" look identical in a boolean and mean opposite things
 * for whether this lead is ready for a person.
 */
export function requiredFieldsCollected(lead: LeadFacts): boolean {
  return (
    present(lead.firstName) &&
    present(lead.vehicleInterest) &&
    lead.budgetCents !== null &&
    lead.tradeInStatus !== 'unknown'
  );
}

/**
 * Should a person take this conversation now?
 *
 * Order is by consequence, not by trigger number. Safety outranks everything —
 * somebody who has mentioned self-harm is not a lead with incomplete fields —
 * and an explicit request for a human outranks every inference about intent,
 * because it is the only trigger where the customer has told us directly.
 */
export function evaluateHandoff(facts: HandoffFacts): HandoffDecision {
  // Already somebody else's conversation. Re-handing off would reassign it out
  // from under the agent holding it.
  if (facts.status !== 'bot_active') {
    return { handOff: false, reason: `conversation is ${facts.status}, not bot_active` };
  }

  if (facts.flags.safety) {
    return {
      handOff: true,
      trigger: 'safety',
      urgency: 'immediate',
      reason: 'safety flag: threat, self-harm or legal language',
    };
  }
  if (facts.flags.wantsHuman) {
    return { handOff: true, trigger: 'client_asked', urgency: 'immediate', reason: 'the client asked for a person' };
  }
  if (facts.flags.highIntent) {
    return { handOff: true, trigger: 'high_intent', urgency: 'immediate', reason: 'high buying intent' };
  }
  if (requiredFieldsCollected(facts.lead)) {
    return {
      handOff: true,
      trigger: 'fields_complete',
      urgency: 'normal',
      reason: 'name, vehicle interest, budget and trade-in status are all known',
    };
  }
  if (facts.consecutiveCannotAnswer >= CANNOT_ANSWER_TURNS) {
    return {
      handOff: true,
      trigger: 'cannot_answer',
      urgency: 'normal',
      reason: `the assistant could not answer ${facts.consecutiveCannotAnswer} turns running`,
    };
  }
  if (facts.botMessagesSent >= facts.botTurnCap) {
    return {
      handOff: true,
      trigger: 'turn_cap',
      urgency: 'normal',
      reason: `${facts.botMessagesSent} assistant messages without a handoff (cap ${facts.botTurnCap})`,
    };
  }

  return { handOff: false, reason: 'no trigger met' };
}
