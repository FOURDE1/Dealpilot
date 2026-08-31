import { describe, expect, it } from 'vitest';
import { wcagRatio } from './contrast.js';

/**
 * F-75 (D-076) — the numbers contrast.ts's header states are the numbers the
 * helper computes (a claim in a comment is a claim in the product), and the
 * parser accepts exactly what the header says it accepts.
 */
describe('e2e/support/contrast.ts', () => {
  const r3 = (a: string, b: string) => wcagRatio(a, b).toFixed(3);

  it('the #FDE047 text tone core ships, oklch(0.5413 0.1657 98.11), under clipping: 4.616 page / 4.502 muted / 4.954 card', () => {
    const tone = 'oklch(0.5413 0.1657 98.11)';
    expect(r3(tone, '#F5F7FA')).toBe('4.616');
    expect(r3(tone, '#F3F4F6')).toBe('4.502');
    expect(r3(tone, '#FFFFFF')).toBe('4.954');
    expect(wcagRatio(tone, '#F3F4F6')).toBeGreaterThanOrEqual(4.5);
  });

  it('rgb(137, 109, 0) — the pixel Chrome 151 painted for that tone (per-channel clip + 8-bit quantisation) — reads 4.603 / 4.489 / 4.940, muted under 4.5', () => {
    const pixel = 'rgb(137, 109, 0)';
    expect(r3(pixel, '#F5F7FA')).toBe('4.603');
    expect(r3(pixel, '#F3F4F6')).toBe('4.489');
    expect(r3(pixel, '#FFFFFF')).toBe('4.940');
    expect(wcagRatio(pixel, '#F3F4F6')).toBeLessThan(4.5);
  });

  it('one white four ways agrees, black on white is 21, the argument order does not matter', () => {
    const tone = 'oklch(0.5413 0.1657 98.11)';
    const onWhite = wcagRatio(tone, '#FFFFFF');
    expect(wcagRatio(tone, 'rgb(255, 255, 255)')).toBe(onWhite);
    expect(wcagRatio(tone, 'rgba(255, 255, 255, 1)')).toBe(onWhite);
    expect(wcagRatio(tone, '#fff')).toBe(onWhite);
    expect(wcagRatio(tone, 'color(srgb 1 1 1)')).toBe(onWhite);
    expect(wcagRatio('#FFFFFF', tone)).toBe(onWhite);
    expect(r3('#000000', '#FFFFFF')).toBe('21.000');
    expect(r3('oklch(54.13% 0.1657 98.11)', '#F5F7FA')).toBe('4.616');
  });

  it('color(srgb) accepts a signed channel and clamps it — the relative-colour form Chrome serialises for an out-of-gamut tone', () => {
    const signed = 'color(srgb 0.538601 0.425769 -0.235407)';
    expect(wcagRatio(signed, '#F3F4F6')).toBe(wcagRatio('color(srgb 0.538601 0.425769 0)', '#F3F4F6'));
    expect(wcagRatio('color(srgb 1.2 0 0)', '#000000')).toBe(wcagRatio('color(srgb 1 0 0)', '#000000'));
    expect(wcagRatio('color(srgb -0.1 -0.1 -0.1)', '#FFFFFF')).toBe(21);
  });

  it('anything else throws, naming the string', () => {
    for (const bad of ['hsl(0 0% 0%)', 'red', 'color(display-p3 1 0 0)', '']) {
      expect(() => wcagRatio(bad, '#FFFFFF')).toThrow(/cannot parse colour/);
    }
  });
});
