import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateBrandingContrast, type BrandingInput } from '@dealpilot/core';
import { PublishedBranding } from '@dealpilot/schemas';
import { TENANT_FILLS, semanticLight } from '@dealpilot/ui';
import { BRAND_PAINT, PALETTE_READS, UNCONSUMED_PALETTE, brandCss } from './brand-style.js';
import type { PublishedBrandingT } from './api.js';

/**
 * F-75 (D-076) — the published-snapshot consumer guard.
 *
 * The dead-vocabulary law for a frozen payload: every cell the producer emits
 * is either painted here or listed as unconsumed WITH a reason — never both,
 * never neither, and the unconsumed list cannot rot (a stale entry is red, and
 * a hand-read of an "unconsumed" key is red). Every top-level key of the
 * snapshot is read by one of the consumer modules, matched as an ACCESS
 * PATTERN in comment-stripped source — an exported list of key names would
 * satisfy its own scan.
 */
const FULL: BrandingInput = {
  primary: '#2563EB',
  accent: '#0F766E',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  info: '#6366F1',
};

/** The bootstrap-guard shape: block comments become blank (line numbers survive), line comments go. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, '')).replace(/\/\/[^\n]*/g, '');
}

const CONSUMER_FILES = ['brand-style.tsx', 'brand-mark.tsx', 'brand-document.tsx', '../../shared/use-page-title.ts', 'api.ts'] as const;

function consumerSource(file: (typeof CONSUMER_FILES)[number]): string {
  return stripComments(readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), 'utf8'));
}

const validated = validateBrandingContrast(FULL);
const palette: Record<string, Record<string, string>> = {
  fills: { ...validated.fills },
  text: { ...validated.text },
  foregrounds: { ...validated.foregrounds },
  dark: { ...validated.dark },
  hover: { ...validated.hover },
  ring: { ...validated.ring },
};
const producerKeys = Object.entries(palette).flatMap(([group, cells]) => Object.keys(cells).map((key) => `${group}.${key}`));
const reads = PALETTE_READS.map((path) => path.join('.'));
const unconsumed = Object.keys(UNCONSUMED_PALETTE);

const snapshot: PublishedBrandingT = {
  organization_id: '11111111-1111-4111-8111-111111111111',
  store_id: null,
  display_name: 'Marque',
  logo_light_key: null,
  logo_dark_key: null,
  favicon_key: null,
  font_family: 'inter',
  radius: 'md',
  density: 'comfortable',
  dark_mode: 'derived',
  palette,
  version: 1,
};

describe('published-snapshot consumer guard', () => {
  it('(a) every palette cell the producer emits is painted XOR unconsumed-with-a-reason; nothing stale', () => {
    expect(producerKeys.length).toBeGreaterThan(0);
    for (const key of producerKeys) {
      const isRead = reads.includes(key);
      const isUnconsumed = unconsumed.includes(key);
      expect(isRead !== isUnconsumed, `${key}: read=${isRead} unconsumed=${isUnconsumed}`).toBe(true);
    }
    for (const key of [...reads, ...unconsumed]) {
      expect(producerKeys, `${key} is not produced by validateBrandingContrast`).toContain(key);
    }
    for (const [key, reason] of Object.entries(UNCONSUMED_PALETTE)) {
      expect(reason.trim().length, `${key} needs a reason`).toBeGreaterThan(20);
    }
  });

  it('(b) every BRAND_PAINT tuple exists in the producer output, light and dark', () => {
    for (const row of BRAND_PAINT) {
      expect(palette[row.light[0]]?.[row.light[1]], `--${row.css} light ← ${row.light.join('.')}`).toBeDefined();
      expect(palette[row.dark[0]]?.[row.dark[1]], `--${row.css} dark ← ${row.dark.join('.')}`).toBeDefined();
    }
  });

  it('(c) every emitted CSS variable other than --radius/--font-sans is a semantic token of tokens.css', () => {
    const { css } = brandCss({ ...snapshot, font_family: 'system' });
    const emitted = [...css.matchAll(/--([a-z0-9-]+):/g)].map((m) => m[1] ?? '');
    expect(emitted.length).toBeGreaterThan(10);
    const tokens = Object.keys(semanticLight);
    for (const name of emitted) {
      if (name === 'radius' || name === 'font-sans') continue;
      expect(tokens, `--${name} is not a semantic token`).toContain(name);
    }
    // And the table itself names only real tokens (compile-time typed; asserted at runtime too).
    for (const row of BRAND_PAINT) expect(tokens).toContain(row.css);
  });

  it('(d) brandCss(FULL) paints every table row in the right theme block', () => {
    const { css, gated } = brandCss(snapshot);
    expect(gated).toEqual([]);
    const light = /:root:not\(\[data-theme="dark"\]\)\{([^}]*)\}/.exec(css)?.[1] ?? '';
    const dark = /:root\[data-theme="dark"\]\{([^}]*)\}/.exec(css)?.[1] ?? '';
    for (const row of BRAND_PAINT) {
      if (row.when === 'no-accent-unit') continue; // the accent unit is present in FULL
      expect(light, `--${row.css} light`).toContain(`--${row.css}:${palette[row.light[0]]?.[row.light[1]]};`);
      expect(dark, `--${row.css} dark`).toContain(`--${row.css}:${palette[row.dark[0]]?.[row.dark[1]]};`);
    }
    // The fallback row lands when the accent unit is absent.
    const rest: BrandingInput = { ...FULL };
    delete rest.accent;
    const v = validateBrandingContrast(rest);
    const noAccent = brandCss({ ...snapshot, palette: { fills: v.fills, text: v.text, foregrounds: v.foregrounds, dark: v.dark, hover: v.hover, ring: v.ring } });
    expect(noAccent.css).toContain(`--sidebar-accent-foreground:${v.text['primary']};`);
  });

  it('(e) no unconsumed cell is read by the consumer code', () => {
    const sources = CONSUMER_FILES.map(consumerSource).join('\n');
    for (const key of unconsumed) {
      const [group, cell] = key.split('.');
      const patterns = [
        new RegExp(`['"]${group}['"]\\s*,\\s*['"]${cell}['"]`),
        new RegExp(`\\.${group}\\??\\.${cell}\\b`),
        new RegExp(`\\[['"]${group}['"]\\]\\??\\.?\\[['"]${cell}['"]\\]`),
      ];
      for (const re of patterns) expect(sources, `${key} is read: ${re}`).not.toMatch(re);
    }
    // The patterns do see a real read (sanity: a consumed cell matches).
    expect(sources).toMatch(/['"]text['"]\s*,\s*['"]primary['"]/);
  });

  it('(f) every top-level key of PublishedBranding is read by a consumer module (access pattern, comments stripped)', () => {
    const keys = Object.keys(PublishedBranding.shape);
    expect(keys.length).toBe(12);
    const sources = CONSUMER_FILES.map(consumerSource).join('\n');
    for (const key of keys) {
      const re = new RegExp(`[.?]${key}\\b|\\['${key}'\\]`);
      expect(sources, `snapshot key "${key}" has no reader`).toMatch(re);
    }
  });

  it('(g) every BRAND_PAINT unit fill is a TENANT_FILLS entry (the fill-carries-its-label rule covers it)', () => {
    const units = [...new Set(BRAND_PAINT.flatMap((row) => (row.unit ? [row.unit] : [])))];
    expect(units.length).toBeGreaterThan(0);
    for (const unit of units) {
      const fillRow = BRAND_PAINT.find((row) => row.unit === unit && !row.css.endsWith('-foreground'));
      const labelRow = BRAND_PAINT.find((row) => row.unit === unit && row.css.endsWith('-foreground'));
      expect(fillRow, `unit ${unit} has a fill`).toBeDefined();
      expect(labelRow?.css, `unit ${unit} has its label`).toBe(`${fillRow?.css}-foreground`);
      const base = (fillRow?.css ?? '').replace(/-hover$/, '');
      expect(TENANT_FILLS as readonly string[], `--${fillRow?.css} is not a TENANT_FILLS fill`).toContain(base);
      if (fillRow?.requires !== undefined) expect(fillRow.css).toBe(`${fillRow.requires}-hover`);
    }
  });
});
