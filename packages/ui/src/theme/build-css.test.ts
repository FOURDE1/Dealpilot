import { describe, expect, it } from 'vitest';
import { buildTokensCss } from './build-css.js';
import { semanticLight } from './tokens.js';

describe('buildTokensCss', () => {
  const css = buildTokensCss();

  it('emits all three layers with light and dark themes', () => {
    expect(css).toContain('--blue-600: #2563EB;');
    expect(css).toContain('--primary: #2563EB;');
    expect(css).toContain('[data-theme="dark"]');
    expect(css).toContain('--sidebar-width: 240px;');
    expect(css).toContain('[data-density="compact"]');
  });

  it('maps every semantic token into @theme inline for Tailwind', () => {
    for (const name of Object.keys(semanticLight)) {
      expect(css).toContain(`--color-${name}: var(--${name});`);
    }
  });

  it('emits the dark variant, self-@source, and duration utilities', () => {
    expect(css).toContain('@custom-variant dark');
    expect(css).toContain("@source './';");
    expect(css).toContain('--transition-duration-fast: 150ms;');
    expect(css).toContain('--transition-duration-normal: 250ms;');
    expect(css).toContain('--transition-duration-slow: 350ms;');
  });

  it('never emits an undefined value', () => {
    expect(css).not.toContain('undefined');
  });

  /**
   * F-75 (D-076): the role-split tokens and the density reader's variable.
   * Each block is located by its selector so a value cannot satisfy the
   * assertion from the wrong theme.
   */
  const between = (start: string, end: string) => {
    const from = css.indexOf(start);
    const to = css.indexOf(end, from + start.length);
    expect(from, `${start} present`).toBeGreaterThanOrEqual(0);
    return to === -1 ? css.slice(from) : css.slice(from, to);
  };
  const rootBlock = between(':root {', '[data-theme="dark"]');
  const darkBlock = between('[data-theme="dark"] {', '[data-density="compact"]');
  const compactBlock = between('[data-density="compact"] {', '@theme inline');

  it('emits primary-text and the two hover foregrounds in both theme blocks', () => {
    for (const name of ['primary-text', 'primary-hover-foreground', 'destructive-hover-foreground']) {
      expect(rootBlock).toMatch(new RegExp(`--${name}: #[0-9A-F]{6};`));
      expect(darkBlock).toMatch(new RegExp(`--${name}: #[0-9A-F]{6};`));
    }
    expect(rootBlock).toContain('--primary-text: #2563EB;');
    expect(darkBlock).toContain('--primary-text: #60A5FA;');
  });

  it('emits --input-h at 40px comfortable and 34px under [data-density="compact"]', () => {
    expect(rootBlock).toContain('--input-h: 40px;');
    expect(compactBlock).toContain('--input-h: 34px;');
    expect(compactBlock).toContain('--row-h: 34px;');
    expect(compactBlock).toContain('--cell-py: 6px;');
  });

  it('declares the dark variant BrandMark consumes (dark:hidden / hidden dark:block)', () => {
    expect(css).toContain('@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));');
  });
});
