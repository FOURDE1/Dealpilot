import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AA_TEXT,
  AA_UI,
  contrastRatio,
  formatOklch,
  hexToOklch,
  parseColor,
  readableOn,
  ringFor,
  validateBrandingContrast,
  type BrandingInput,
} from '@dealpilot/core';
import { routes } from '../../shared/api/client.js';
import { assetUrl, brandingGateOpen, type PublishedBrandingT } from './api.js';
import { BRAND_PAINT, brandCss, SAFE_COLOR, worstCaseSurfaces } from './brand-style.js';
import { BrandMark } from './brand-mark.js';

/**
 * F-75 (D-076) — the consumer's own proof, on the values it would paint.
 *
 * Fixtures come from the producer (`validateBrandingContrast`), never from
 * pasted OKLCH strings, so a core change moves the fixtures with it; the
 * "stale" cases overwrite one cell with the value a pre-F-75 publish stored
 * (proven against white / the dark page) and assert the precondition — that
 * the stale value really fails on today's surface — before asserting the gate.
 */
const ORG = '11111111-1111-4111-8111-111111111111';
const STORE = '22222222-2222-4222-8222-222222222222';
const FULL_INPUT: BrandingInput = {
  primary: '#2563EB',
  accent: '#0F766E',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  info: '#6366F1',
};

type Palette = Record<string, Record<string, string>>;

function paletteOf(input: BrandingInput): { palette: Palette; adjustments: readonly { token: string }[] } {
  const v = validateBrandingContrast(input);
  return {
    palette: {
      fills: { ...v.fills },
      text: { ...v.text },
      foregrounds: { ...v.foregrounds },
      dark: { ...v.dark },
      hover: { ...v.hover },
      ring: { ...v.ring },
    },
    adjustments: v.adjustments,
  };
}

function published(palette: Palette, over: Partial<PublishedBrandingT> = {}): PublishedBrandingT {
  return {
    organization_id: ORG,
    store_id: null,
    display_name: 'Marque',
    logo_light_key: null,
    logo_dark_key: null,
    favicon_key: null,
    font_family: 'inter',
    radius: 'md',
    density: 'comfortable',
    dark_mode: 'derived',
    palette: structuredClone(palette),
    version: 3,
    ...over,
  };
}

const LIGHT_SELECTOR = ':root:not([data-theme="dark"])';

/** The three blocks brandCss emits: the plain `:root{}` (theme-independent), the light colour half, the dark colour half. */
function blocks(css: string): { root: string; light: string; dark: string } {
  const root = /(?:^|\}):root\{([^}]*)\}/.exec(css);
  const light = /:root:not\(\[data-theme="dark"\]\)\{([^}]*)\}/.exec(css);
  const dark = /:root\[data-theme="dark"\]\{([^}]*)\}/.exec(css);
  return { root: root?.[1] ?? '', light: light?.[1] ?? '', dark: dark?.[1] ?? '' };
}

const worst = worstCaseSurfaces();
const LIGHT_SURFACE = hexToOklch(worst.light);
const DARK_SURFACE = hexToOklch(worst.dark);

describe('brandCss — the token contract on a full brand', () => {
  const full = paletteOf(FULL_INPUT);

  it('#1 FULL: every BRAND_PAINT row lands in its theme block, nothing is gated, and info was fill-adjusted at publish', () => {
    const { css, gated } = brandCss(published(full.palette));
    const { root, light, dark } = blocks(css);
    expect(gated).toEqual([]);
    expect(full.adjustments.map((a) => a.token)).toContain('fills.info');
    for (const row of BRAND_PAINT) {
      const lightValue = full.palette[row.light[0]]?.[row.light[1]];
      const darkValue = full.palette[row.dark[0]]?.[row.dark[1]];
      expect(lightValue, row.light.join('.')).toBeDefined();
      expect(darkValue, row.dark.join('.')).toBeDefined();
      if (row.when === 'no-accent-unit') {
        // The accent unit is present, so the sidebar foreground is the unit's label, not the text tone.
        expect(light).not.toContain(`--${row.css}:${lightValue};`);
        expect(dark).not.toContain(`--${row.css}:${darkValue};`);
      } else {
        expect(light, `--${row.css} light`).toContain(`--${row.css}:${lightValue};`);
        expect(dark, `--${row.css} dark`).toContain(`--${row.css}:${darkValue};`);
      }
    }
    // The radius is theme-independent: in the plain block, in neither colour half.
    expect(root).toContain('--radius:0.5rem;');
    expect(light).not.toContain('--radius');
    expect(dark).not.toContain('--radius');
  });

  it('#1b without an accent, the sidebar foreground falls back to the brand text tone and no accent fill is emitted', () => {
    const rest: BrandingInput = { ...FULL_INPUT };
    delete rest.accent;
    const noAccent = paletteOf(rest);
    const { css, gated } = brandCss(published(noAccent.palette));
    const { light, dark } = blocks(css);
    expect(gated).toEqual([]);
    expect(light).not.toContain('--sidebar-accent:');
    expect(light).toContain(`--sidebar-accent-foreground:${noAccent.palette['text']?.['primary']};`);
    expect(dark).toContain(`--sidebar-accent-foreground:${noAccent.palette['text']?.['primary_dark']};`);
    // --accent-foreground takes the text tone whether or not an accent unit exists (A5).
    expect(light).toContain(`--accent-foreground:${noAccent.palette['text']?.['primary']};`);
    expect(blocks(brandCss(published(full.palette)).css).light).toContain(
      `--accent-foreground:${full.palette['text']?.['primary']};`,
    );
  });

  it('#2 pale #FDE047: the fill is raw yellow under a near-black label; the text tone is a different, proven colour', () => {
    const pale = paletteOf({ primary: '#FDE047' });
    const { css, gated } = brandCss(published(pale.palette));
    const { light } = blocks(css);
    const fill = pale.palette['fills']?.['primary'] ?? '';
    const label = pale.palette['foregrounds']?.['primary'] ?? '';
    const tone = pale.palette['text']?.['primary'] ?? '';
    expect(gated).toEqual([]);
    expect(light).toContain(`--primary:${fill};`);
    expect(parseColor(fill).l).toBeGreaterThan(0.85);
    expect(light).toContain(`--primary-foreground:${label};`);
    expect(parseColor(label).l).toBeLessThan(0.2);
    expect(light).toContain(`--primary-text:${tone};`);
    expect(tone).not.toBe(fill);
    expect(contrastRatio(parseColor(tone), hexToOklch('#F3F4F6'))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it('#3 stale text.primary (white-proven oklch(0.5643 0.1657 98.11)) gates the whole text.primary proof; the fill unit still paints', () => {
    const pale = paletteOf({ primary: '#FDE047' });
    const stale = structuredClone(pale.palette);
    const staleTone = 'oklch(0.5643 0.1657 98.11)';
    stale['text'] = { ...stale['text'], primary: staleTone };
    // Precondition: the stored tone really fails on today's darkest light surface.
    expect(contrastRatio(parseColor(staleTone), LIGHT_SURFACE)).toBeLessThan(AA_TEXT);
    const { css, gated } = brandCss(published(stale));
    const { light, dark } = blocks(css);
    expect(gated).toContain('text.primary');
    expect(light).not.toContain('--primary-text:');
    expect(light).not.toContain('--accent-foreground:');
    expect(light).not.toContain(`--sidebar-accent-foreground:`);
    expect(light).toContain(`--primary:${stale['fills']?.['primary']};`);
    expect(light).toContain(`--primary-foreground:${stale['foregrounds']?.['primary']};`);
    // The dark half was not stale, so the dark block keeps its tone.
    expect(dark).toContain(`--primary-text:${stale['text']?.['primary_dark']};`);
  });

  it('#4 a fill without its label is not painted (neither half of the unit)', () => {
    const full2 = paletteOf(FULL_INPUT);
    const broken = structuredClone(full2.palette);
    const fg = { ...broken['foregrounds'] };
    delete fg['primary'];
    broken['foregrounds'] = fg;
    const { css, gated } = brandCss(published(broken));
    const { light, dark } = blocks(css);
    expect(gated).toContain('fills.primary');
    expect(light).not.toContain('--primary:');
    expect(light).not.toContain('--primary-foreground:');
    // Only the light half was broken.
    expect(dark).toContain(`--primary:${broken['dark']?.['primary']};`);
  });

  it('#5 a hover unit is never painted when its base unit is gated (a platform button must not turn brand-red on hover)', () => {
    const rose = paletteOf({ primary: '#E11D48' });
    const broken = structuredClone(rose.palette);
    const fill = broken['fills']?.['primary'] ?? '';
    // Hand-break the base pair: label = the fill itself (1:1). The hover pair is untouched and passes on its own.
    broken['foregrounds'] = { ...broken['foregrounds'], primary: fill };
    const hoverPair = contrastRatio(
      parseColor(broken['hover']?.['primary'] ?? ''),
      parseColor(broken['foregrounds']?.['primary_hover'] ?? ''),
    );
    expect(hoverPair).toBeGreaterThanOrEqual(AA_TEXT);
    const { css, gated } = brandCss(published(broken));
    const { light } = blocks(css);
    expect(gated).toContain('fills.primary');
    expect(gated).toContain('hover.primary');
    expect(light).not.toContain('--primary:');
    expect(light).not.toContain('--primary-hover:');
    expect(light).not.toContain('--primary-hover-foreground:');
  });

  it('#6 a gated dark half leaves the dark block without --primary-text, and the light block is scoped so tokens.css wins in dark', () => {
    const navy = paletteOf({ primary: '#1E3A8A' });
    const stale = structuredClone(navy.palette);
    // The pre-F-75 dark tone: proven against the dark PAGE (#0F1117), not today's lightest dark surface.
    const staleDark = formatOklch(readableOn(parseColor(stale['dark']?.['primary'] ?? ''), hexToOklch('#0F1117')));
    stale['text'] = { ...stale['text'], primary_dark: staleDark };
    expect(contrastRatio(parseColor(staleDark), DARK_SURFACE)).toBeLessThan(AA_TEXT);
    const { css, gated } = brandCss(published(stale));
    const { light, dark } = blocks(css);
    expect(gated).toContain('text.primary_dark');
    expect(dark).not.toContain('--primary-text:');
    expect(light).toContain(`--primary-text:${stale['text']?.['primary']};`);
    // The light COLOUR half is scoped (so tokens.css's [data-theme="dark"] wins
    // for the gated dark half); the plain `:root{}` block carries only the
    // theme-independent declarations — never a colour.
    expect(css).toContain(`${LIGHT_SELECTOR}{`);
    const { root } = blocks(css);
    expect(root).toBe('--radius:0.5rem;');
    for (const row of BRAND_PAINT) expect(root, `--${row.css} in the unscoped block`).not.toContain(`--${row.css}:`);
  });

  it('#7 a stale ring.danger (white-proven) is not painted as --danger-border', () => {
    const pale = paletteOf({ primary: '#2563EB', danger: '#FCA5A5' });
    const stale = structuredClone(pale.palette);
    const staleRing = formatOklch(ringFor(parseColor(stale['fills']?.['danger'] ?? ''), hexToOklch('#FFFFFF')));
    stale['ring'] = { ...stale['ring'], danger: staleRing };
    expect(contrastRatio(parseColor(staleRing), hexToOklch('#FFFFFF'))).toBeGreaterThanOrEqual(AA_UI);
    expect(contrastRatio(parseColor(staleRing), LIGHT_SURFACE)).toBeLessThan(AA_UI);
    const { css, gated } = brandCss(published(stale));
    const { light, dark } = blocks(css);
    expect(gated).toContain('ring.danger');
    expect(light).not.toContain('--danger-border:');
    expect(dark).toContain(`--danger-border:${stale['ring']?.['danger_dark']};`);
    // The fresh value would have been painted.
    const fresh = brandCss(published(pale.palette));
    expect(fresh.gated).toEqual([]);
    expect(blocks(fresh.css).light).toContain(`--danger-border:${pale.palette['ring']?.['danger']};`);
  });

  it('#8 a primary-only brand invents no semantic token', () => {
    const purple = paletteOf({ primary: '#7C3AED' });
    const { css, gated } = brandCss(published(purple.palette));
    expect(gated).toEqual([]);
    for (const name of ['--success', '--success-foreground', '--destructive', '--destructive-hover', '--sidebar-accent', '--danger-border']) {
      expect(css).not.toContain(`${name}:`);
    }
    expect(css).toContain(`--sidebar-accent-foreground:${purple.palette['text']?.['primary']};`);
  });

  it('#9 hostile palette values never reach the stylesheet', () => {
    expect(SAFE_COLOR.test('red;}body{display:none')).toBe(false);
    expect(SAFE_COLOR.test('oklch(0.5 0.2 262) url(x)')).toBe(false);
    expect(SAFE_COLOR.test('oklch(0.5 0.2 262)')).toBe(true);
    expect(SAFE_COLOR.test('#2563EB')).toBe(true);
    const full3 = paletteOf(FULL_INPUT);
    const hostile = structuredClone(full3.palette);
    hostile['fills'] = { ...hostile['fills'], primary: 'red;}body{display:none' };
    hostile['text'] = { ...hostile['text'], primary: 'oklch(0.5 0.2 262) url(x)' };
    const { css, gated } = brandCss(published(hostile));
    expect(css).not.toContain('body{');
    expect(css).not.toContain('url(');
    expect(gated).toContain('fills.primary');
    expect(gated).toContain('text.primary');
    expect(blocks(css).light).not.toContain('--primary:');
    expect(blocks(css).light).not.toContain('--primary-foreground:');
  });

  it('#10 font_family system → the OS stack in the plain :root{} block (both themes); inter → nothing; the radius likewise', () => {
    const purple = paletteOf({ primary: '#7C3AED' });
    const system = blocks(brandCss(published(purple.palette, { font_family: 'system' })).css);
    expect(system.root).toContain('--font-sans:ui-sans-serif,system-ui,sans-serif;');
    expect(system.light).not.toContain('--font-sans');
    expect(system.dark).not.toContain('--font-sans');
    const inter = brandCss(published(purple.palette, { font_family: 'inter' })).css;
    expect(inter).not.toContain('--font-sans');
    const sm = blocks(brandCss(published(purple.palette, { radius: 'sm' })).css);
    expect(sm.root).toContain('--radius:0.25rem;');
    expect(sm.light).not.toContain('--radius');
    expect(sm.dark).not.toContain('--radius');
  });
});

describe('brandCss — a unit is also held to the invariant of its consumer', () => {
  it('#14 a pale success (#ECFDF5) is gated in light — the heatmap scale would invert — and painted in dark, where the fill sits beyond the tint', () => {
    const pale = paletteOf({ primary: '#2563EB', success: '#ECFDF5' });
    const { css, gated } = brandCss(published(pale.palette));
    const { light, dark } = blocks(css);
    const fill = pale.palette['fills']?.['success'] ?? '';
    const label = pale.palette['foregrounds']?.['success'] ?? '';
    // The pair itself is fine (a near-black label on a pale fill) — the gate is the ORDER, not the pair.
    expect(contrastRatio(parseColor(fill), parseColor(label))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(light).not.toContain('--success:');
    expect(light).not.toContain('--success-foreground:');
    expect(gated).toContain('fills.success');
    expect(dark).toContain('--success:');
    expect(gated).not.toContain('dark.success');
  });
});
describe('brandingGateOpen — the shell holds the skeleton only while the brand has never answered and is fetching', () => {
  it('#13 pending+fetching opens; an errored query (idle or fetching), a successful query (idle or refetching) and an idle pending one do not', () => {
    expect(brandingGateOpen({ status: 'pending', fetchStatus: 'fetching' })).toBe(true);
    expect(brandingGateOpen({ status: 'error', fetchStatus: 'idle' })).toBe(false);
    expect(brandingGateOpen({ status: 'error', fetchStatus: 'fetching' })).toBe(false);
    expect(brandingGateOpen({ status: 'success', fetchStatus: 'idle' })).toBe(false);
    expect(brandingGateOpen({ status: 'success', fetchStatus: 'fetching' })).toBe(false);
    expect(brandingGateOpen({ status: 'pending', fetchStatus: 'idle' })).toBe(false);
    expect(brandingGateOpen({ status: 'pending', fetchStatus: 'paused' })).toBe(false);
  });
});

describe('assetUrl — the contract path with the parameters the route needs', () => {
  const b = published({}, { version: 7 });

  it('#11 builds from routes.branding.asset.path with organization_id and v, and store_id when scoped', () => {
    const expectedPath = routes.branding.asset.path.replace(':slot', 'logo_light');
    expect(assetUrl(b, 'logo_light')).toBe(`${expectedPath}?organization_id=${ORG}&v=7`);
    expect(assetUrl(b, 'logo_light')).toBe(`/api/v1/branding/assets/logo_light?organization_id=${ORG}&v=7`);
    expect(assetUrl(b, 'logo_light')).toMatch(/^\/api\/v1\/branding\/assets\/logo_light\?organization_id=[0-9a-f-]{36}&v=\d+$/);
    expect(assetUrl({ ...b, store_id: STORE }, 'favicon')).toBe(
      `/api/v1/branding/assets/favicon?organization_id=${ORG}&store_id=${STORE}&v=7`,
    );
    expect(assetUrl(b, 'logo_dark')).toContain('/logo_dark?');
  });

  it('#11b api.ts hand-writes no API path', () => {
    const source = readFileSync(fileURLToPath(new URL('./api.ts', import.meta.url)), 'utf8');
    expect(source).not.toContain("'/api/v1");
    expect(source).not.toContain('`/api/v1');
  });
});

describe('BrandMark — <img src> or the wordmark, never inline SVG', () => {
  const markup = (over: Partial<PublishedBrandingT> | null) =>
    renderToStaticMarkup(createElement(BrandMark, { branding: over ? published({}, over) : null, name: 'Marque', className: 'h-8' }));

  it('#12 a light logo renders one <img alt="Marque"> from the sandboxed route, without a theme class', () => {
    const html = markup({ logo_light_key: 'org/x/branding/logo_light/abc.svg' });
    expect(html.match(/<img /g)?.length).toBe(1);
    expect(html).toContain('alt="Marque"');
    expect(html).toContain(`src="/api/v1/branding/assets/logo_light?organization_id=${ORG}&amp;v=3"`);
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('dark:');
  });

  it('#12b no logo → the wordmark; no branding at all → the platform name given', () => {
    expect(markup({})).toBe('<span>Marque</span>');
    expect(markup(null)).toBe('<span>Marque</span>');
  });

  it('#12c a dark logo pairs the two images under the dark: variant', () => {
    const html = markup({ logo_light_key: 'k/light.png', logo_dark_key: 'k/dark.png' });
    expect(html.match(/<img /g)?.length).toBe(2);
    expect(html).toContain('class="h-8 dark:hidden"');
    expect(html).toContain('class="h-8 hidden dark:block"');
    expect(html).toContain('/assets/logo_light?');
    expect(html).toContain('/assets/logo_dark?');
  });

  it('#12d the image pair is KEYED on its URLs: a new published version remounts it, so a stale onError fallback resets', () => {
    // BrandMark holds no state, so it can be called as a function and its element inspected.
    const pair = { logo_light_key: 'k/light.png', logo_dark_key: 'k/dark.png' };
    const v3 = BrandMark({ branding: published({}, pair), name: 'Marque' });
    const v4 = BrandMark({ branding: published({}, { ...pair, version: 4 }), name: 'Marque' });
    expect(v3.key).toBe(
      `/api/v1/branding/assets/logo_light?organization_id=${ORG}&v=3|/api/v1/branding/assets/logo_dark?organization_id=${ORG}&v=3`,
    );
    expect(v4.key).not.toBe(v3.key);
    expect(v4.key).toContain('v=4');
    // A light-only mark keys on the light URL alone; no logo at all → the wordmark, unkeyed.
    expect(BrandMark({ branding: published({}, { logo_light_key: 'k/light.png' }), name: 'Marque' }).key).toBe(
      `/api/v1/branding/assets/logo_light?organization_id=${ORG}&v=3|`,
    );
    expect(BrandMark({ branding: null, name: 'Marque' }).key).toBeNull();
  });
});
