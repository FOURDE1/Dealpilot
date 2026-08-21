import { foldForKeywordMatch, OPT_OUT_EN, OPT_OUT_FR } from './compliance-keywords.js';

/**
 * F-61 — client-facing drip sequences (automation-notifications.md §11).
 *
 * This module answers exactly one question: given an enrollment and its
 * sequence, what should the hourly tick do RIGHT NOW? It never touches the
 * database and it never sends anything — the worker owns I/O, and every
 * actual send still passes the full compliance gate in f19 (consent,
 * suppression, quiet hours, daily cap). A drip that this module says is
 * "due" can still be deferred or blocked there, and that is the design:
 * due-ness is scheduling, not permission.
 */

export interface DripStep {
  /** Days after enrollment this step fires. 0 = same day. */
  readonly day: number;
  /** FR/EN pair (ADR-019); §12 merge fields ride inside as {{key}} tokens. */
  readonly body_fr: string;
  readonly body_en: string;
}

export interface DripEnrollmentFacts {
  /** Steps already sent — also the index of the NEXT step to send. */
  readonly currentStep: number;
  readonly enrolledAt: Date;
  readonly expiresAt: Date;
}

export type DripTickDecision =
  | { readonly kind: 'expire' }
  | { readonly kind: 'complete' }
  | { readonly kind: 'send'; readonly stepIndex: number; readonly step: DripStep }
  | { readonly kind: 'wait' };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Decide the tick's action for one enrollment.
 *
 * Order matters and encodes §11.2's contract:
 * - Expiry wins over everything, including an overdue step. "90 days then
 *   expire" means day 91 sends nothing, even if the day-90 step never went
 *   out (a lead the gate deferred for a week has not renewed its welcome).
 * - All steps sent → complete. The tick heals rows a crash left behind:
 *   completion is derived from state, not remembered from the send.
 */
export function dripTickDecision(
  enrollment: DripEnrollmentFacts,
  steps: readonly DripStep[],
  now: Date,
): DripTickDecision {
  if (now.getTime() >= enrollment.expiresAt.getTime()) return { kind: 'expire' };
  if (enrollment.currentStep >= steps.length) return { kind: 'complete' };

  const step = steps[enrollment.currentStep]!;
  const dueAt = enrollment.enrolledAt.getTime() + step.day * DAY_MS;
  if (now.getTime() >= dueAt) {
    return { kind: 'send', stepIndex: enrollment.currentStep, step };
  }
  return { kind: 'wait' };
}

/** §12's documented drip variables — the exact vocabulary, nothing invented. */
export interface DripMergeFields {
  readonly first_name?: string | null;
  readonly last_name?: string | null;
  readonly vehicle?: string | null;
  readonly salesperson?: string | null;
  readonly store_name?: string | null;
  readonly store_phone?: string | null;
}

const KNOWN_TOKEN = /\{\{\s*(first_name|last_name|vehicle|salesperson|store_name|store_phone)\s*\}\}/g;
/** Anything else in braces is a typo — it must never reach a customer raw. */
const UNKNOWN_TOKEN = /\{\{?[a-zA-Z_ ]*\}?\}/g;

/**
 * Render a step body: substitute §12 merge fields (a missing field — or a
 * token this code does not know — vanishes rather than shipping "{{frist_name}}"
 * in a customer's SMS), tidy the whitespace removal leaves, then guarantee
 * the two CASL structural requirements: the sender is IDENTIFIED (the store
 * name is appended when the body does not already carry it) and the opt-out
 * mechanism is taught.
 *
 * The opt-out check is by WHOLE WORD on the accent-folded body — substring
 * matching read 'financement' as teaching FIN and 'weekend' as teaching END,
 * and skipped the footer on messages that taught nothing.
 */
export function renderDripBody(
  step: Pick<DripStep, 'body_fr' | 'body_en'>,
  fields: DripMergeFields,
  language: 'fr' | 'en',
): string {
  const template = language === 'fr' ? step.body_fr : step.body_en;
  const rendered = template
    .replace(KNOWN_TOKEN, (_m, key: string) => {
      const value = fields[key as keyof DripMergeFields];
      return typeof value === 'string' ? value.trim() : '';
    })
    .replace(UNKNOWN_TOKEN, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ ([,.!?;:])/g, '$1')
    .trim();

  const store = fields.store_name?.trim();
  const identified =
    !store || foldForKeywordMatch(rendered).includes(foldForKeywordMatch(store));
  const withSender = identified ? rendered : `${rendered} — ${store}`;

  const words = new Set(foldForKeywordMatch(withSender).split(/[^A-Z0-9]+/));
  const optOutWords: readonly string[] = language === 'fr' ? OPT_OUT_FR : OPT_OUT_EN;
  const teachesOptOut = optOutWords.some((w) => words.has(w));
  if (teachesOptOut) return withSender;

  return language === 'fr'
    ? `${withSender} (Répondez ARRÊT pour vous désabonner)`
    : `${withSender} (Reply STOP to opt out)`;
}

/**
 * Does a sequence's trigger condition accept this loss? The only condition
 * key today is lost_reason, matched case-insensitively against the tenant's
 * reason NAME (either language — the condition author may think in French).
 * An empty condition matches every loss.
 */
export function lostConditionMatches(
  condition: { readonly lost_reason?: string },
  reason: { readonly name: string; readonly name_fr: string },
): boolean {
  const want = condition.lost_reason?.trim().toLowerCase();
  if (!want) return true;
  return reason.name.trim().toLowerCase() === want || reason.name_fr.trim().toLowerCase() === want;
}
