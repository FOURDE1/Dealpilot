import { describe, expect, it } from 'vitest';
import { contrastRatio, relativeLuminance, semanticDark, semanticLight } from '@dealpilot/ui';
import { HEATMAP_STEPS } from './heatmap-page.js';

/**
 * F-75 (D-076) — the heatmap ramp under a tenant brand.
 *
 * The old ramp put `bg-success/60` and `/80` under `text-success-foreground`:
 * fine for the platform green, and measured 2.45:1 / 3.57:1 once `--success`
 * is a tenant's #0F766E (sRGB alpha over white, label = the fill's own
 * foreground). Now the translucent steps use the PLATFORM tint
 * (`success-bg`, never injected) with the platform status text, so they can
 * be proven once, here; the solid tenant fill appears only as a whole unit
 * (`bg-success text-success-foreground`), which the contrast gate and the
 * publish-time pair proof cover.
 *
 * The composite is sRGB alpha blending over `card`, the surface the grid
 * sits on — the same arithmetic the browser applies to `bg-success-bg/40`.
 */

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`Not a 6-digit hex colour: ${hex}`);
  return [parseInt(m[1] ?? '00', 16), parseInt(m[2] ?? '00', 16), parseInt(m[3] ?? '00', 16)];
}

/** `over` at `alpha` composited onto `under`, in sRGB — what the browser paints. */
function composite(over: string, alpha: number, under: string): string {
  const o = hexToRgb(over);
  const u = hexToRgb(under);
  const mix = o.map((c, i) => Math.round(c * alpha + (u[i] ?? 0) * (1 - alpha)));
  return `#${mix.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

describe('the heatmap ramp is readable at every step', () => {
  it('composites correctly (a colour at alpha 1 is itself; at 0 it is the surface)', () => {
    expect(composite('#D1FAE5', 1, '#FFFFFF')).toBe('#d1fae5');
    expect(composite('#D1FAE5', 0, '#FFFFFF')).toBe('#ffffff');
    expect(composite('#000000', 0.5, '#FFFFFF')).toBe('#808080');
  });

  describe.each([
    ['light', semanticLight],
    ['dark', semanticDark],
  ] as const)('%s theme', (_name, theme) => {
    it.each([0.4, 0.7])('success-text on success-bg at %s over card meets AA (>= 4.5:1)', (alpha) => {
      const mix = composite(theme['success-bg'], alpha, theme.card);
      expect(contrastRatio(theme['success-text'], mix)).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe.each([
    ['light', semanticLight, 'decreasing'],
    ['dark', semanticDark, 'increasing'],
  ] as const)('%s theme — the steps are a SCALE', (_name, theme, direction) => {
    it(`luminance is strictly ${direction} from step 1 to step 4 (the platform success fill sits beyond the tint)`, () => {
      // Steps 1–3 are the tint at 40 % / 70 % / 100 % over card; step 4 is the
      // platform `success` fill — the same ordering brand-style.tsx demands of a
      // tenant fill before it may replace it (UNIT_INVARIANTS.success).
      const steps = [
        composite(theme['success-bg'], 0.4, theme.card),
        composite(theme['success-bg'], 0.7, theme.card),
        theme['success-bg'],
        theme.success,
      ].map((hex) => relativeLuminance(hex));
      for (let i = 1; i < steps.length; i++) {
        const [prev, next] = [steps[i - 1] ?? 0, steps[i] ?? 0];
        if (direction === 'decreasing') expect(next).toBeLessThan(prev);
        else expect(next).toBeGreaterThan(prev);
      }
    });
  });

  it('has six steps, the top two carry the tenant unit, and no step puts an alpha on the tenant fill', () => {
    expect(HEATMAP_STEPS).toHaveLength(6);
    expect(HEATMAP_STEPS[0]).toBe('bg-muted text-muted-foreground');
    for (const step of HEATMAP_STEPS.slice(1, 4)) {
      expect(step).toMatch(/(?<![\w-])bg-success-bg(?:\/\d+)?(?![\w-])/);
      expect(step).toContain('text-success-text');
    }
    for (const step of HEATMAP_STEPS.slice(4)) {
      expect(step).toContain('bg-success text-success-foreground');
    }
    for (const step of HEATMAP_STEPS) {
      expect(step).not.toMatch(/(?<![\w-])bg-success\/\d/);
    }
    // The translucent steps use exactly the alphas proven above.
    expect(HEATMAP_STEPS[1]).toContain('bg-success-bg/40');
    expect(HEATMAP_STEPS[2]).toContain('bg-success-bg/70');
    expect(HEATMAP_STEPS[3]).toContain('bg-success-bg ');
  });
});
