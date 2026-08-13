/**
 * Opt-out and re-opt-in keyword matching (compliance-and-quality.md §5).
 *
 * This is the smallest module in the compliance engine and the one with the
 * least room for cleverness. A customer who types STOP has withdrawn consent,
 * and the only acceptable failure direction is to over-honour it: treating an
 * ambiguous message as an opt-out costs a conversation, while missing a real one
 * costs a CASL violation.
 *
 * §5 requires the match to be "case/accents-insensitive, exact word match after
 * trim". Word match, not whole-body equality — somebody typing "actually STOP
 * please" has said stop, and a whole-body comparison would sail straight past
 * them and keep messaging.
 */

/** Fold to the form the keyword lists are written in: no accents, no case, no padding. */
export function foldForKeywordMatch(body: string): string {
  return body
    .normalize('NFD')
    // Strip combining marks so ARRÊT, ARRÊT and ARRET are one word. Doing this
    // BEFORE uppercasing matters: some locales uppercase accented characters
    // into forms that no longer decompose.
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** English opt-out words (§5). */
export const OPT_OUT_EN = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'] as const;
/** French opt-out words, folded — ARRÊT is reached through ARRET. */
export const OPT_OUT_FR = ['ARRET', 'ANNULER', 'DESABONNER', 'FIN'] as const;

/** Re-subscribe words that stand alone (§5). */
export const RE_OPT_IN_EN = ['START', 'UNSTOP'] as const;
export const RE_OPT_IN_FR = ['RECOMMENCER'] as const;

export interface KeywordMatch {
  readonly keyword: string;
  readonly language: 'en' | 'fr';
}

/**
 * Split on anything that is not a letter or digit.
 *
 * Punctuation is separator, not content: "STOP." and "STOP!" and "(stop)" are
 * all somebody saying stop, and a customer should not have to punctuate
 * correctly to be left alone.
 */
function tokens(body: string): string[] {
  return foldForKeywordMatch(body).split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 0);
}

/** Did this message ask us to stop? Returns the word that matched, for the file. */
export function matchOptOutKeyword(body: string): KeywordMatch | null {
  const found = tokens(body);
  for (const token of found) {
    if ((OPT_OUT_EN as readonly string[]).includes(token)) return { keyword: token, language: 'en' };
    if ((OPT_OUT_FR as readonly string[]).includes(token)) return { keyword: token, language: 'fr' };
  }
  return null;
}

/**
 * Did this message ask to start again?
 *
 * YES / OUI count ONLY when we have just asked (§5: "after a re-opt-in prompt
 * only"). Otherwise every "yes" in an ordinary conversation would silently
 * resubscribe somebody who had opted out — consent by accident, which is the
 * thing CASL exists to prevent.
 */
export function matchReOptInKeyword(body: string, awaitingReOptInPrompt: boolean): KeywordMatch | null {
  const found = tokens(body);
  for (const token of found) {
    if ((RE_OPT_IN_EN as readonly string[]).includes(token)) return { keyword: token, language: 'en' };
    if ((RE_OPT_IN_FR as readonly string[]).includes(token)) return { keyword: token, language: 'fr' };
    if (awaitingReOptInPrompt && token === 'YES') return { keyword: 'YES', language: 'en' };
    if (awaitingReOptInPrompt && token === 'OUI') return { keyword: 'OUI', language: 'fr' };
  }
  return null;
}

/**
 * The server-side affirmative check for express consent capture.
 *
 * Takes the body AS RE-READ FROM THE DATABASE, never a string a model produced.
 * The distinction is the whole point: a model that can report "the customer said
 * yes" is a model that can be talked into reporting it, and express consent for
 * an automated call must rest on what the customer actually sent.
 */
export function isAffirmative(bodyFromDatabase: string): { matched: 'YES' | 'OUI' } | null {
  const found = tokens(bodyFromDatabase);
  if (found.includes('YES')) return { matched: 'YES' };
  if (found.includes('OUI')) return { matched: 'OUI' };
  return null;
}
