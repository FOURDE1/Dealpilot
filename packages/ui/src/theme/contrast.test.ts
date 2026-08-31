import { describe, expect, it } from 'vitest';
import { contrastRatio, relativeLuminance } from './contrast.js';
import { semanticDark, semanticLight, type SemanticToken } from './tokens.js';

describe('contrastRatio', () => {
  it('computes the canonical extremes', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('is order-independent', () => {
    expect(contrastRatio('#2563EB', '#FFFFFF')).toBeCloseTo(contrastRatio('#FFFFFF', '#2563EB'), 10);
  });

  it('rejects malformed colors', () => {
    expect(() => relativeLuminance('blue')).toThrow(/hex/);
    expect(() => relativeLuminance('#FFF')).toThrow(/hex/);
  });
});

/**
 * The D-024 WCAG gate: every text-bearing token pairing must hold AA (≥4.5:1)
 * in BOTH themes; interactive/UI fills must hold ≥3:1. If a token edit breaks
 * a pairing, this fails the build — the CLAUDE.md "both themes ≥4.5:1"
 * non-negotiable as a test.
 */
const AA_TEXT = 4.5;
const AA_UI = 3.0;

const textPairs: [SemanticToken, SemanticToken][] = [
  ['foreground', 'background'],
  ['foreground', 'card'],
  ['card-foreground', 'card'],
  ['popover-foreground', 'popover'],
  ['primary-foreground', 'primary'],
  ['secondary-foreground', 'secondary'],
  ['muted-foreground', 'muted'],
  ['muted-foreground', 'background'],
  ['accent-foreground', 'accent'],
  ['destructive-foreground', 'destructive'],
  ['success-foreground', 'success'],
  ['warning-foreground', 'warning'],
  ['info-foreground', 'info'],
  ['sidebar-foreground', 'sidebar'],
  ['sidebar-accent-foreground', 'sidebar-accent'],
  ['sidebar-primary-foreground', 'sidebar-primary'],
  /**
   * F-75 (D-076) split `primary` into the self-labelled FILL (`primary`) and
   * the on-surface TONE (`primary-text`). The tone is what links, emphasis,
   * the checkbox accent, the active-tab border and the unlabeled usage bars
   * read, so it is held to AA against every light surface it can sit on —
   * `accent` and `sidebar-accent` included, because `--accent-foreground` and
   * `--sidebar-accent-foreground` take the tenant's `text.primary` tone.
   */
  ['primary-text', 'background'],
  ['primary-text', 'card'],
  ['primary-text', 'muted'],
  ['primary-text', 'popover'],
  ['primary-text', 'accent'],
  ['primary-text', 'sidebar-accent'],
  // hover states are text-bearing too (WCAG 1.4.3 applies to all states);
  // a hover fill carries its OWN label token.
  ['primary-hover-foreground', 'primary-hover'],
  ['destructive-hover-foreground', 'destructive-hover'],
  /**
   * Kept: platform-only guarantee — a tenant fill is not held to these
   * (D-076). The platform palette still satisfies them and removing a passing
   * pair is a weakening; under a brand the pairs that matter are the
   * `primary-text` rows above and the `*-hover-foreground` rows, which is why
   * those tokens exist.
   */
  ['primary', 'background'], // platform-only guarantee
  ['primary', 'card'], // platform-only guarantee
  ['primary-foreground', 'primary-hover'], // platform-only guarantee
  ['destructive-foreground', 'destructive-hover'], // platform-only guarantee
  // D-024 status-as-text variants
  ['success-text', 'background'],
  ['success-text', 'card'],
  ['warning-text', 'background'],
  ['warning-text', 'card'],
  ['success-text', 'success-bg'],
  ['warning-text', 'warning-bg'],
  ['danger-text', 'danger-bg'],
  ['muted-foreground', 'card'],
  ['muted-foreground', 'background'],
  ['danger-text', 'background'],
  ['danger-text', 'card'],
  ['info-text', 'background'],
  ['info-text', 'card'],
  /**
   * Two pairings that ship and were never gated. `caution-text` on
   * `caution-bg` is the be-back urgency ramp (D-054), rendered by three
   * pages; `foreground` on `muted` is the neutral status row, rendered by
   * five, and is what F-72 gives `info` and `marketing` announcements. Both
   * measure well clear of AA in both themes — they were simply missing from
   * the list, which is the kind of gap that stops being harmless the first
   * time somebody adjusts the yellow.
   */
  ['caution-text', 'caution-bg'],
  ['foreground', 'muted'],
];

/**
 * Non-text pairs held to WCAG 1.4.11 (3:1). Border-on-background is
 * deliberately NOT here: decorative borders and dividers are exempt from
 * 1.4.11, and the locked neutral ramp keeps them intentionally subtle —
 * input affordance comes from fill + label + the focus ring tested below.
 */
const uiPairs: [SemanticToken, SemanticToken][] = [
  ['ring', 'background'],
  ['destructive', 'card'],
  /**
   * F-75 (D-076). The fill's own 1.4.11 obligation on the platform —
   * platform-only guarantee: a tenant fill is not held to 1.4.11 against
   * surfaces (measured #FDE047 on card 1.318:1); under a brand only fill↔label,
   * `primary-text`, `ring` and `danger-border` are proven.
   */
  ['primary', 'background'], // platform-only guarantee
  ['primary', 'card'], // platform-only guarantee
  /**
   * `danger-border` becomes a tenant-fed token (← `ring.danger`) painted on the
   * `border-danger-border` inputs whose surface is `input-bg`, and on the error
   * boxes on `card`; the platform floor is stated for the surfaces it sits on.
   */
  ['danger-border', 'input-bg'],
  ['danger-border', 'card'],
];

describe.each([
  ['light', semanticLight],
  ['dark', semanticDark],
] as const)('%s theme', (_name, theme) => {
  it.each(textPairs)('text pair %s on %s meets AA (>= 4.5:1)', (fg, bg) => {
    expect(contrastRatio(theme[fg], theme[bg])).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(uiPairs)('UI pair %s on %s meets >= 3:1', (fg, bg) => {
    expect(contrastRatio(theme[fg], theme[bg])).toBeGreaterThanOrEqual(AA_UI);
  });
});

describe('D-024 forbidden pairings stay forbidden', () => {
  it('white on blue-500 fails AA (why primary is blue-600 in light)', () => {
    expect(contrastRatio('#FFFFFF', '#3B82F6')).toBeLessThan(AA_TEXT);
  });
  it('white on blue-400 fails AA (why dark primary uses a near-black foreground)', () => {
    expect(contrastRatio('#FFFFFF', '#60A5FA')).toBeLessThan(AA_UI);
  });
});
