/**
 * The outbound guard (conversation-engine.md §10.3).
 *
 * The last thing between a generated message and a customer's phone. It is
 * deterministic on purpose: everything upstream of it — the system prompt, the
 * tool schemas, the data starvation — is a reason to EXPECT the model to behave.
 * This is the layer that holds when it does not.
 *
 * §10 is blunt about what must never reach a customer: "never state or estimate
 * vehicle prices, payments, interest rates, approval odds, trade-in values,
 * rebates, 'guaranteed' anything". A dealership that quotes a payment by text
 * has made an offer, and one that says "you're approved" has made a credit
 * decision it may not be able to honour.
 *
 * Two rules this module holds to:
 *
 *  - it runs on EVERY draft regardless of why the model produced it, so a
 *    jailbreak and an honest mistake are handled identically;
 *  - it NAMES the violation, because the caller's next move is to regenerate
 *    with the violation quoted back at the model, and "blocked" alone gives it
 *    nothing to correct.
 */

export type ViolationKind =
  | 'currency'
  | 'percentage'
  | 'approval_promise'
  | 'unknown_stock_number'
  | 'delivery_promise';

export interface Violation {
  readonly kind: ViolationKind;
  /** The exact text that tripped it — quoted back to the model on retry. */
  readonly matched: string;
  /** Why it is forbidden, in words a person can act on. */
  readonly reason: string;
}

export interface GuardContext {
  /**
   * Stock numbers the inventory tool actually returned for this conversation.
   * A vehicle the model was not shown is a vehicle it invented.
   */
  readonly allowedStockNumbers: readonly string[];
  /**
   * Server-composed templates are exempt from the currency rule — the credit
   * application link and its kin are written by us, not the model, and may
   * legitimately carry figures.
   */
  readonly isServerTemplate?: boolean;
}

/**
 * Word boundaries that survive accents.
 *
 * JavaScript's \b is defined over ASCII word characters, so it does NOT match
 * after "approuvé": the accented letter counts as a non-word character and the
 * boundary silently fails. Every French approval promise walked straight
 * through the first version of this guard for exactly that reason. These
 * lookarounds are Unicode-aware, which is why the patterns below carry `u`.
 */
const BEFORE = '(?<![\\p{L}\\p{N}])';
const AFTER = '(?![\\p{L}\\p{N}])';

/**
 * Money, in both the forms Canada writes it.
 *
 * `$1,200` and `1 200 $` are the same claim. Guarding only the English form
 * would leave the French half of this market unprotected — the half the product
 * is built for.
 */
const CURRENCY = /\$\s?\d[\d\s,.]*|\d[\d\s,.]*\s?\$/gu;

/** Interest rates, payments as percentages, "0 %" offers. */
const PERCENTAGE = /\d+(?:[.,]\d+)?\s?%/gu;

/**
 * Approval language, but only where it is a PROMISE.
 *
 * "Once the lender has approved it…" is how anybody would describe the process,
 * and a guard that blocks it leaves the assistant unable to explain the next
 * step — which is how a guard gets switched off. What is forbidden is the
 * assertion: "you're approved".
 */
const APPROVAL_PROMISE = new RegExp(
  [
    `${BEFORE}(?:you(?:'re|’re| are)|vous ?êtes|tu es|c'est)\\s+(?:pre[- ]?)?(?:approved|approuvée?s?)${AFTER}`,
    `${BEFORE}guarantee[ds]?${AFTER}`,
    `${BEFORE}garantie?s?${AFTER}`,
    `${BEFORE}(?:approval|approbation)\\s+(?:is\\s+)?(?:guaranteed|assurée?)${AFTER}`,
  ].join('|'),
  'giu',
);

/** Promises about when a car will arrive — a date is a commitment. */
const DELIVERY_PROMISE = new RegExp(
  [
    `${BEFORE}(?:guarantee[ds]?|promise[ds]?|promis|garantie?s?)${AFTER}[^.!?]{0,40}(?:deliver\\p{L}*|livrais\\p{L}*|livrée?s?)${AFTER}`,
    `${BEFORE}(?:deliver\\p{L}*|livrais\\p{L}*)${AFTER}[^.!?]{0,20}(?:guaranteed|garantie?s?)${AFTER}`,
  ].join('|'),
  'giu',
);

/**
 * Stock-number shapes this product uses.
 *
 * Deliberately narrow: it must not fire on an ordinary word or a year. A false
 * positive blocks a perfectly good message, and the cost of that is a
 * conversation that stalls for no reason the customer can see.
 */
const STOCK_NUMBER = /(?<![\p{L}\p{N}])[A-Z]{1,4}-?\d{3,6}(?![\p{L}\p{N}])/gu;

function collect(re: RegExp, text: string): string[] {
  return [...text.matchAll(re)].map((m) => m[0].trim()).filter((m) => m.length > 0);
}

/**
 * Check a draft before it goes out.
 *
 * Returns EVERY violation rather than the first: the spec allows exactly one
 * corrective regeneration before falling back to a template, and discovering
 * problems one at a time would waste it.
 */
export function outboundGuard(draft: string, ctx: GuardContext): readonly Violation[] {
  const violations: Violation[] = [];

  if (!ctx.isServerTemplate) {
    for (const matched of collect(CURRENCY, draft)) {
      violations.push({
        kind: 'currency',
        matched,
        reason: 'A price or payment quoted by text is an offer the dealership may not be able to honour',
      });
    }
  }

  for (const matched of collect(PERCENTAGE, draft)) {
    violations.push({
      kind: 'percentage',
      matched,
      reason: 'Rates are set by a lender after an application, never by this conversation',
    });
  }

  for (const matched of collect(APPROVAL_PROMISE, draft)) {
    violations.push({
      kind: 'approval_promise',
      matched,
      reason: 'Only a lender approves credit; saying so here promises a decision nobody has made',
    });
  }

  for (const matched of collect(DELIVERY_PROMISE, draft)) {
    violations.push({
      kind: 'delivery_promise',
      matched,
      reason: 'A promised delivery date is a commitment the store has not agreed to',
    });
  }

  // §10.1 keeps prices out of the tool results so they cannot be leaked. This
  // keeps inventory out of the model's imagination: a stock number it never
  // received is one it invented, and the customer will drive in for it.
  const allowed = new Set(ctx.allowedStockNumbers.map((s) => s.toUpperCase().replace(/-/g, '')));
  for (const matched of collect(STOCK_NUMBER, draft)) {
    if (!allowed.has(matched.toUpperCase().replace(/-/g, ''))) {
      violations.push({
        kind: 'unknown_stock_number',
        matched,
        reason: 'That vehicle was not in the inventory results — it may not exist, or may be sold',
      });
    }
  }

  return violations;
}

/** Did this draft pass? Convenience for the common call site. */
export function isSendable(draft: string, ctx: GuardContext): boolean {
  return outboundGuard(draft, ctx).length === 0;
}

/**
 * What to say when the model cannot produce a clean draft twice running.
 *
 * §10.3 asks for a language-appropriate fallback rather than silence: the
 * customer asked a question, and going quiet reads as being ignored. It says
 * nothing the guard would block, and it hands the conversation to a person.
 */
export function fallbackMessage(language: 'fr' | 'en'): string {
  return language === 'fr'
    ? 'Je préfère faire vérifier cette information par un collègue. Quelqu’un vous répond sous peu.'
    : 'Let me get one of our advisors to confirm that for you — someone will reply shortly.';
}
