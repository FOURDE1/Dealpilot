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
  ['primary', 'background'], // links in body copy
  ['primary', 'card'],
  // hover states are text-bearing too (WCAG 1.4.3 applies to all states)
  ['primary-foreground', 'primary-hover'],
  ['destructive-foreground', 'destructive-hover'],
  // D-024 status-as-text variants
  ['success-text', 'background'],
  ['success-text', 'card'],
  ['warning-text', 'background'],
  ['warning-text', 'card'],
  ['danger-text', 'background'],
  ['danger-text', 'card'],
  ['info-text', 'background'],
  ['info-text', 'card'],
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
