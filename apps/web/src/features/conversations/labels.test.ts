import { describe, expect, it } from 'vitest';
import { enCA, frCA } from '@dealpilot/i18n';
import { BLOCKED_REASONS } from '@dealpilot/core';
import { VIOLATION_KINDS } from '@dealpilot/ai';
import {
  BotScore, ConversationAnalysisRecord, ConversationStatusEnum, MessageSenderType,
} from '@dealpilot/schemas';
import { SCORE_CLASS } from './labels.js';

/**
 * Every word the console prints has a word in both languages.
 *
 * The console renders enum values through `t('reason_' + reason)`, which is a
 * lookup that CANNOT fail loudly: a missing key renders as the key. So the
 * failure mode is a French-speaking BDC agent reading
 * `reason_adad_no_express_consent` at the exact moment they need a sentence
 * they can act on, and nobody finding out — the screen looks like it works.
 *
 * This is the same dead-vocabulary shape that keeps turning up in the database,
 * one layer higher: a value declared somewhere, reachable, and unhandled at the
 * one place it becomes visible. It is checkable only because the vocabularies
 * are arrays rather than bare union types.
 */

const en = enCA.conversations as Record<string, string>;
const fr = frCA.conversations as Record<string, string>;

function missing(prefix: string, values: readonly string[]): string[] {
  const gaps: string[] = [];
  for (const v of values) {
    const key = `${prefix}${v}`;
    if (!en[key]?.trim()) gaps.push(`en-CA: ${key}`);
    if (!fr[key]?.trim()) gaps.push(`fr-CA: ${key}`);
  }
  return gaps;
}

describe('the console can name everything it shows', () => {
  it('every conversation status', () => {
    expect(missing('status_', ConversationStatusEnum.options)).toEqual([]);
  });

  it('every kind of sender', () => {
    expect(missing('sender_', MessageSenderType.options)).toEqual([]);
  });

  it('every score and sentiment the assistant can report', () => {
    expect(missing('score_', BotScore.options)).toEqual([]);
    const sentiment = ConversationAnalysisRecord.shape.sentiment.options;
    expect(missing('sentiment_', sentiment)).toEqual([]);
  });

  it('every reason a send can be refused', () => {
    // The one an agent reads at the worst possible moment.
    expect(missing('reason_', BLOCKED_REASONS)).toEqual([]);
  });

  it('every way the outbound guard can reject a draft', () => {
    expect(missing('violation_', VIOLATION_KINDS)).toEqual([]);
  });
});

describe('the score badge', () => {
  it('has a colour for every score, so none renders unstyled', () => {
    // `Record<string, string>` would let a new score fall through to '' and
    // paint white-on-white; this is the runtime half of that check.
    for (const score of BotScore.options) {
      expect(SCORE_CLASS[score], score).toBeTruthy();
    }
  });

  it('uses the AA-gated surface/text pairs, not opacity-derived colours', () => {
    // CR-15 shipped a 2.76:1 foreground by pairing a tinted background with a
    // brand colour. The *-bg / *-text pairs are the ones packages/ui gates for
    // contrast in BOTH themes; anything else is unmeasured.
    for (const [score, cls] of Object.entries(SCORE_CLASS)) {
      expect(cls, score).not.toMatch(/\/\d+/);
    }
  });
});
