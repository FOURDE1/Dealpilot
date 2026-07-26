import { describe, expect, it } from 'vitest';
import {
  AA_TEXT,
  AA_UI,
  contrastRatio,
  deriveDark,
  foregroundFor,
  formatOklch,
  hexToOklch,
  oklchToHex,
  parseColor,
  readableOn,
  relativeLuminance,
  SURFACE_DARK,
  SURFACE_LIGHT,
  validateBrandingContrast,
} from './branding.js';

/**
 * F-14 colour engine. Accessibility maths, so the tests are anchored to values
 * that are true independently of this implementation — WCAG's own worked
 * examples and exact colour identities — rather than to whatever the code
 * happens to produce.
 */

const hex = (h: string) => hexToOklch(h);

describe('WCAG contrast, against values the standard fixes', () => {
  it('black on white is 21:1 — the maximum the formula can produce', () => {
    expect(contrastRatio(hex('#000000'), hex('#ffffff'))).toBeCloseTo(21, 4);
  });

  it('a colour against itself is 1:1', () => {
    expect(contrastRatio(hex('#3b82f6'), hex('#3b82f6'))).toBeCloseTo(1, 6);
  });

  it('#767676 on white is the canonical 4.5:1 boundary', () => {
    // The greyscale value WCAG references as the lightest grey that still
    // passes AA for normal text on white. One step lighter fails.
    expect(contrastRatio(hex('#767676'), hex('#ffffff'))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(hex('#777777'), hex('#ffffff'))).toBeLessThan(4.5);
  });

  it('is symmetric — which colour is named first cannot change the answer', () => {
    const a = hex('#e53935');
    const b = hex('#ffffff');
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 12);
  });

  it('uses WCAG luminance, not OKLCH lightness', () => {
    // The trap this guards: OKLCH L for #808080 is ~0.6, its WCAG relative
    // luminance is ~0.216. Substituting one for the other produces contrast
    // numbers that look reasonable and fail a real audit.
    const grey = hex('#808080');
    expect(relativeLuminance(grey)).toBeCloseTo(0.2159, 3);
    expect(grey.l).toBeGreaterThan(0.5);
    expect(relativeLuminance(hex('#ffffff'))).toBeCloseTo(1, 6);
    expect(relativeLuminance(hex('#000000'))).toBeCloseTo(0, 6);
  });
});

describe('OKLCH ⇄ sRGB', () => {
  it('white and black are exact', () => {
    expect(oklchToHex({ l: 1, c: 0, h: 0 })).toBe('#ffffff');
    expect(oklchToHex({ l: 0, c: 0, h: 0 })).toBe('#000000');
  });

  it('round-trips every channel of a spread of real colours', () => {
    // Independent of any reference table: converting out and back has to land
    // on the same bytes, which only holds if the forward and inverse matrices
    // actually invert each other.
    for (const h of [
      '#e53935', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#6366f1',
      '#0f1117', '#ffffff', '#000000', '#7f7f7f', '#123456', '#fedcba',
    ]) {
      expect(oklchToHex(hexToOklch(h)), `round trip ${h}`).toBe(h);
    }
  });

  it('reads the stored oklch() form, hex, and percentage lightness', () => {
    const fromOklch = parseColor('oklch(0.55 0.2 262)');
    expect(fromOklch.l).toBeCloseTo(0.55, 6);
    expect(fromOklch.c).toBeCloseTo(0.2, 6);
    expect(fromOklch.h).toBeCloseTo(262, 6);
    expect(parseColor('oklch(55% 0.2 262)').l).toBeCloseTo(0.55, 6);
    expect(oklchToHex(parseColor('#3b82f6'))).toBe('#3b82f6');
    expect(oklchToHex(parseColor('#39f'))).toBe('#3399ff');
  });

  it('refuses a value it does not understand rather than guessing', () => {
    // A silently-defaulted colour is a brand nobody chose.
    expect(() => parseColor('cornflowerblue')).toThrow();
    expect(() => parseColor('rgb(1,2,3)')).toThrow();
    expect(() => parseColor('')).toThrow();
  });

  it('normalises hue and clamps out-of-range input', () => {
    expect(parseColor('oklch(0.5 0.1 400)').h).toBeCloseTo(40, 6);
    expect(parseColor('oklch(0.5 0.1 -10)').h).toBeCloseTo(350, 6);
    expect(parseColor('oklch(1.4 0.1 0)').l).toBe(1);
  });

  it('clips out-of-gamut colours instead of producing impossible bytes', () => {
    // oklch(0.7 0.4 150) is well outside sRGB; every channel must still land
    // in 00–ff rather than wrapping into a different colour.
    const clipped = oklchToHex({ l: 0.7, c: 0.4, h: 150 });
    expect(clipped).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('making a brand colour readable (§12)', () => {
  it('picks the foreground that is actually more readable on the fill', () => {
    // A pale brand needs dark text; a deep one needs light text. Getting this
    // backwards is how a button ends up unreadable in the tenant's own colours.
    expect(formatOklch(foregroundFor(hex('#fde047')))).toBe(formatOklch({ l: 0.145, c: 0, h: 0 }));
    expect(formatOklch(foregroundFor(hex('#1e3a8a')))).toBe(formatOklch({ l: 0.985, c: 0, h: 0 }));
  });

  it('the chosen foreground always meets AA on the fill', () => {
    for (const h of ['#e53935', '#3b82f6', '#10b981', '#fde047', '#1e3a8a', '#7f7f7f', '#ffffff', '#000000']) {
      const fill = hex(h);
      expect(contrastRatio(fill, foregroundFor(fill)), `foreground on ${h}`).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it('leaves a colour alone when it is already readable', () => {
    // A tenant whose colours are fine must see no adjustment at all.
    const deep = hex('#1e3a8a');
    expect(readableOn(deep, SURFACE_LIGHT)).toEqual(deep);
  });

  it('darkens an unreadable colour on white until it passes, keeping the brand', () => {
    const pale = hex('#fde047'); // yellow: ~1.1:1 on white, hopeless as text
    expect(contrastRatio(pale, SURFACE_LIGHT)).toBeLessThan(2);

    const fixed = readableOn(pale, SURFACE_LIGHT);
    expect(contrastRatio(fixed, SURFACE_LIGHT)).toBeGreaterThanOrEqual(AA_TEXT);
    // Still the same colour, just darker: hue and chroma untouched is what
    // keeps it recognisably the tenant's yellow rather than a brown we chose.
    expect(fixed.h).toBeCloseTo(pale.h, 6);
    expect(fixed.c).toBeCloseTo(pale.c, 6);
    expect(fixed.l).toBeLessThan(pale.l);
  });

  it('lightens an unreadable colour on the dark surface', () => {
    const deep = hex('#1e3a8a'); // invisible on near-black
    expect(contrastRatio(deep, SURFACE_DARK)).toBeLessThan(AA_TEXT);
    const fixed = readableOn(deep, SURFACE_DARK);
    expect(contrastRatio(fixed, SURFACE_DARK)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(fixed.l).toBeGreaterThan(deep.l);
  });

  it('stays as close to the original lightness as the threshold allows', () => {
    // It should not snap to black the moment a colour fails — the fix has to be
    // the smallest one that works, or every brand converges on the same colour.
    const pale = hex('#fde047');
    const fixed = readableOn(pale, SURFACE_LIGHT);
    const oneStepLighter = { ...fixed, l: fixed.l + 0.02 };
    expect(contrastRatio(oneStepLighter, SURFACE_LIGHT)).toBeLessThan(AA_TEXT);
  });

  it('handles a colour no lightness can rescue without looping forever', () => {
    // Against a mid-grey surface, some hues cannot reach 4.5:1 at any L. The
    // function must return the best available rather than hang or throw.
    const surface = hex('#7f7f7f');
    const fixed = readableOn(hex('#808080'), surface);
    expect(Number.isFinite(fixed.l)).toBe(true);
    expect(contrastRatio(fixed, surface)).toBeGreaterThan(1);
  });
});

describe('the derived dark palette (§5)', () => {
  it('is lighter and less saturated, at the same hue', () => {
    const brand = hex('#3b82f6');
    const dark = deriveDark(brand);
    expect(dark.l).toBeGreaterThan(brand.l);
    expect(dark.c).toBeCloseTo(brand.c * 0.85, 6);
    expect(dark.h).toBeCloseTo(brand.h, 6);
  });

  it('clamps into the 0.60–0.85 band the spec fixes', () => {
    expect(deriveDark({ l: 0.05, c: 0.1, h: 200 }).l).toBe(0.6);
    expect(deriveDark({ l: 0.95, c: 0.1, h: 200 }).l).toBe(0.85);
  });
});

describe('validating a whole brand', () => {
  it('returns fills untouched, with readable text variants beside them', () => {
    const result = validateBrandingContrast({ primary: '#fde047' });
    // The FILL is the tenant's colour, exactly as chosen — their button stays
    // their yellow.
    expect(oklchToHex(parseColor(result.fills['primary']!))).toBe('#fde047');
    // The TEXT variant is the readable one. Two different tokens, which is the
    // whole point of §12: a colour can be perfect as a fill and unusable as a link.
    expect(contrastRatio(parseColor(result.text['primary']!), SURFACE_LIGHT))
      .toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(parseColor(result.foregrounds['primary']!), parseColor(result.fills['primary']!)))
      .toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('reports every adjustment in words a dealership owner can read', () => {
    const result = validateBrandingContrast({ primary: '#fde047' });
    const adjusted = result.adjustments.find((a) => a.token === 'primary');
    expect(adjusted).toBeDefined();
    expect(adjusted!.ratioBefore).toBeLessThan(AA_TEXT);
    expect(adjusted!.ratioAfter).toBeGreaterThanOrEqual(AA_TEXT);
    expect(adjusted!.reason).toContain('readable');
  });

  it('adjusts nothing when the brand is already accessible', () => {
    const result = validateBrandingContrast({ primary: '#1e3a8a' });
    expect(result.adjustments.filter((a) => a.token === 'primary')).toEqual([]);
  });

  it('covers dark mode too — a colour can pass on white and fail on black', () => {
    const result = validateBrandingContrast({ primary: '#1e3a8a' });
    expect(contrastRatio(parseColor(result.text['primary_dark']!), SURFACE_DARK))
      .toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('validates every semantic colour a tenant overrides, and skips the rest', () => {
    const result = validateBrandingContrast({
      primary: '#3b82f6', success: '#10b981', warning: '#f59e0b',
      danger: '#ef4444', info: '#6366f1',
    });
    for (const token of ['primary', 'success', 'warning', 'danger', 'info']) {
      expect(contrastRatio(parseColor(result.text[token]!), SURFACE_LIGHT), token)
        .toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrastRatio(parseColor(result.text[`${token}_dark`]!), SURFACE_DARK), `${token} dark`)
        .toBeGreaterThanOrEqual(AA_TEXT);
    }
    // accent was not supplied — it must not appear as an invented token.
    expect(result.fills['accent']).toBeUndefined();
  });

  it('never blocks a publish, whatever the tenant picks', () => {
    // The spec is explicit: publishing is never blocked by a fixable contrast
    // problem. A tenant who cannot publish gets a worse product than one whose
    // text was quietly nudged to a readable shade.
    for (const awful of ['#ffffff', '#000000', '#fefefe', '#010101', '#ffff00']) {
      const result = validateBrandingContrast({ primary: awful });
      expect(contrastRatio(parseColor(result.text['primary']!), SURFACE_LIGHT), awful)
        .toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});

describe('every fill the palette exposes has a legible label (CR-15)', () => {
  const SURFACES: Record<string, typeof SURFACE_LIGHT> = {
    light: SURFACE_LIGHT,
    dark: SURFACE_DARK,
  };

  /**
   * The generic invariant, not a list of named tokens.
   *
   * My original suite asserted `foregrounds.primary` against `fills.primary`
   * and stopped there — so `dark.primary`, which the app actually paints in
   * dark mode, had no assertion at all and shipped with the LIGHT foreground on
   * it. Hussein proved it numerically while wiring the injection: a near-white
   * label on a lightened fill, around 2.5:1.
   *
   * Walking every fill in the payload means the next fill added is covered on
   * the day it is added, rather than the day someone checks.
   */
  function everyFillWithItsForeground(brand: string) {
    const p = validateBrandingContrast({ primary: brand });
    const pairs: { name: string; fill: string; fg: string }[] = [];
    for (const [token, fill] of Object.entries(p.fills)) {
      pairs.push({ name: token, fill, fg: p.foregrounds[token]! });
    }
    for (const [token, fill] of Object.entries(p.dark)) {
      pairs.push({ name: `dark.${token}`, fill, fg: p.foregrounds[`${token}_dark`]! });
    }
    for (const [token, fill] of Object.entries(p.hover)) {
      const key = token.endsWith('_dark')
        ? `${token.replace(/_dark$/, '')}_hover_dark`
        : `${token}_hover`;
      pairs.push({ name: `hover.${token}`, fill, fg: p.foregrounds[key]! });
    }
    return pairs;
  }

  // The three Hussein measured, plus the pale case that started all of this.
  for (const brand of ['#7C3AED', '#2563EB', '#DC2626', '#fde047', '#1e3a8a', '#10b981']) {
    it(`${brand}: every fill, light and dark, carries a readable label`, () => {
      for (const { name, fill, fg } of everyFillWithItsForeground(brand)) {
        expect(fg, `${brand} ${name} has no foreground at all`).toBeDefined();
        expect(
          contrastRatio(parseColor(fill), parseColor(fg)),
          `${brand} ${name}: label on fill`,
        ).toBeGreaterThanOrEqual(AA_TEXT);
      }
    });
  }

  it('a hover fill is visibly different from the fill it replaces', () => {
    // Mapping a text tone onto --primary-hover made hover identical to the base
    // for any brand already readable on white: a button with no feedback.
    for (const brand of ['#7C3AED', '#2563EB', '#DC2626', '#000000', '#ffffff']) {
      const p = validateBrandingContrast({ primary: brand });
      expect(p.hover['primary'], brand).not.toBe(p.fills['primary']);
      expect(p.hover['primary_dark'], `${brand} dark`).not.toBe(p.dark['primary']);
    }
  });

  it('a focus ring can be seen against the surface behind it (3:1, not 4.5:1)', () => {
    for (const brand of ['#7C3AED', '#fde047', '#1e3a8a']) {
      const p = validateBrandingContrast({ primary: brand });
      for (const [key, surface] of Object.entries(SURFACES)) {
        const ring = p.ring[key === 'light' ? 'primary' : 'primary_dark']!;
        expect(
          contrastRatio(parseColor(ring), surface),
          `${brand} ring on ${key}`,
        ).toBeGreaterThanOrEqual(AA_UI);
      }
    }
  });

  it('the dark-mode label is often the OPPOSITE of the light-mode one', () => {
    // The heart of CR-15: the dark palette LIGHTENS a brand colour, so a
    // medium-dark brand takes a white label in light mode and a near-black one
    // in dark mode. Reusing one for the other is not a small error.
    const p = validateBrandingContrast({ primary: '#2563EB' });
    expect(p.foregrounds['primary']).not.toBe(p.foregrounds['primary_dark']);
  });
});
