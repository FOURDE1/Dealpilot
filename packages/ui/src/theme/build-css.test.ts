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
});
