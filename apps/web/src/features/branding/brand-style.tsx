import { createContext } from 'react';
import { AA_TEXT, AA_UI, contrastRatio, hexToOklch, parseColor, relativeLuminance as oklchLuminance, type Oklch } from '@dealpilot/core';
import { relativeLuminance, semanticDark, semanticLight, type SemanticToken } from '@dealpilot/ui';
import type { PublishedBrandingT } from './api.js';

/**
 * F-75 (D-076) — the brand paint: the tenant's PUBLISHED palette becomes CSS
 * variables, proven again on the way in.
 *
 * Two roles, never mixed. A FILL (`--primary`, `--destructive`, `--success`,
 * `--sidebar-accent`) carries its own label and is proven only against that
 * label, so it is emitted with its foreground AS A UNIT or not at all. An
 * on-surface TONE (`--primary-text`, `--accent-foreground`, the focus ring,
 * `--danger-border`) is proven here against the darkest light / lightest dark
 * surface the app paints (`worstCaseSurfaces`, pinned to the token source by
 * surfaces-lockstep.test.ts). The re-proof exists because a snapshot is frozen
 * at publish: every brand published before this slice was proven against white
 * (72 on the dev database, measured), and the SPA must not paint a 4.19:1 link
 * because a JSON said so. A value that fails is simply not emitted — the
 * platform value from tokens.css applies — and D-076 says "publish again".
 *
 * The table IS the code: `brandCss` iterates BRAND_PAINT, and PALETTE_READS is
 * derived from it, so brand-consumers.test.ts can hold the palette keys the
 * producer emits to "consumed here XOR listed in UNCONSUMED_PALETTE with a
 * reason". The SPA never derives a colour: what reaches the stylesheet is the
 * server's ADJUSTED value or nothing, and SAFE_COLOR is the last line of
 * defence against a CSS breakout from a network payload.
 */

const RADIUS_REM: Record<PublishedBrandingT['radius'], string> = {
  none: '0px',
  sm: '0.25rem',
  md: '0.5rem',
  lg: '0.75rem',
};

/** `font_family: 'system'` → the OS stack; `inter` = the platform stack from tokens.css, nothing emitted. */
const SYSTEM_FONT_STACK = 'ui-sans-serif,system-ui,sans-serif';

/** Only well-formed colours reach the stylesheet — a guard against CSS breakout
 * from a network payload, even one the server computes. */
export const SAFE_COLOR = /^(oklch\([0-9.\s%-]+\)|#[0-9a-fA-F]{3,8})$/;

/** A palette cell: `palette[group][key]`. */
export type PalettePath = readonly [group: string, key: string];

/** A shared on-surface proof: every row under one proof is emitted or omitted together, per theme. */
export type PaintProof = 'text.primary' | 'ring.primary' | 'ring.danger';

export interface PaintRow {
  /** The semantic token the value paints — a real token of tokens.css, never a phantom variable. */
  readonly css: SemanticToken;
  readonly light: PalettePath;
  readonly dark: PalettePath;
  /**
   * Fill unit: the fill row and its `-foreground` row share a name and are
   * gated together on `contrast(fill, label) ≥ AA_TEXT`.
   */
  readonly unit?: string;
  /** A hover unit is emitted only when its base unit was emitted in the SAME theme block. */
  readonly requires?: string;
  /** On-surface proof against `worstCaseSurfaces()` (AA_TEXT for a text tone, AA_UI for a ring/border). */
  readonly proof?: PaintProof;
  /** The sidebar foreground falls back to the brand text tone only when no accent unit was emitted. */
  readonly when?: 'no-accent-unit';
}

/**
 * The token contract (D-076). Semantic brand colours paint fills + labels
 * (+ the destructive hover pair + `--danger-border`) only. `--warning*` and
 * `--info*` stay platform (UNCONSUMED_PALETTE): no app component paints the
 * solid warning/info fill with its label — the only app read of `--warning`
 * is the `border-warning` region border in organizations/intake-sources.tsx,
 * which keeps the platform amber, and nothing reads `--info` (grep of
 * apps/web/src, 2026-08-31). `--accent-foreground` takes the brand text tone
 * unconditionally (the accent TINT itself is never injected, so the proof
 * holds: tint luminance 0.9148 > muted 0.9041 light; dark accent = the dark
 * proof surface).
 */
export const BRAND_PAINT: readonly PaintRow[] = [
  { css: 'primary', light: ['fills', 'primary'], dark: ['dark', 'primary'], unit: 'primary' },
  { css: 'primary-foreground', light: ['foregrounds', 'primary'], dark: ['foregrounds', 'primary_dark'], unit: 'primary' },
  { css: 'primary-hover', light: ['hover', 'primary'], dark: ['hover', 'primary_dark'], unit: 'primary-hover', requires: 'primary' },
  {
    css: 'primary-hover-foreground',
    light: ['foregrounds', 'primary_hover'],
    dark: ['foregrounds', 'primary_hover_dark'],
    unit: 'primary-hover',
    requires: 'primary',
  },
  { css: 'destructive', light: ['fills', 'danger'], dark: ['dark', 'danger'], unit: 'destructive' },
  { css: 'destructive-foreground', light: ['foregrounds', 'danger'], dark: ['foregrounds', 'danger_dark'], unit: 'destructive' },
  { css: 'destructive-hover', light: ['hover', 'danger'], dark: ['hover', 'danger_dark'], unit: 'destructive-hover', requires: 'destructive' },
  {
    css: 'destructive-hover-foreground',
    light: ['foregrounds', 'danger_hover'],
    dark: ['foregrounds', 'danger_hover_dark'],
    unit: 'destructive-hover',
    requires: 'destructive',
  },
  { css: 'success', light: ['fills', 'success'], dark: ['dark', 'success'], unit: 'success' },
  { css: 'success-foreground', light: ['foregrounds', 'success'], dark: ['foregrounds', 'success_dark'], unit: 'success' },
  { css: 'sidebar-accent', light: ['fills', 'accent'], dark: ['dark', 'accent'], unit: 'accent' },
  { css: 'sidebar-accent-foreground', light: ['foregrounds', 'accent'], dark: ['foregrounds', 'accent_dark'], unit: 'accent' },
  { css: 'primary-text', light: ['text', 'primary'], dark: ['text', 'primary_dark'], proof: 'text.primary' },
  { css: 'accent-foreground', light: ['text', 'primary'], dark: ['text', 'primary_dark'], proof: 'text.primary' },
  {
    css: 'sidebar-accent-foreground',
    light: ['text', 'primary'],
    dark: ['text', 'primary_dark'],
    proof: 'text.primary',
    when: 'no-accent-unit',
  },
  { css: 'ring', light: ['ring', 'primary'], dark: ['ring', 'primary_dark'], proof: 'ring.primary' },
  { css: 'sidebar-ring', light: ['ring', 'primary'], dark: ['ring', 'primary_dark'], proof: 'ring.primary' },
  { css: 'danger-border', light: ['ring', 'danger'], dark: ['ring', 'danger_dark'], proof: 'ring.danger' },
];

/** Every palette cell the table reads — derived, never a second list. */
export const PALETTE_READS: readonly PalettePath[] = (() => {
  const seen = new Map<string, PalettePath>();
  for (const row of BRAND_PAINT) {
    for (const path of [row.light, row.dark]) seen.set(path.join('.'), path);
  }
  return [...seen.values()];
})();

/**
 * Palette cells the producer emits that NOTHING here reads, each with the
 * reason and (where one exists) the un-cut condition. brand-consumers.test.ts
 * holds this list to the producer's real output: a stale entry, a missing
 * entry and an entry that is also read are all red.
 */
export const UNCONSUMED_PALETTE: Readonly<Record<string, string>> = (() => {
  const statusText =
    'the status text tones (success/danger *-text) stay platform-owned — the *-bg tints they are gated against are not in the palette — and no accent-text token exists; un-cut condition: the palette carries tints proven against them';
  const noHover =
    'no component hovers this fill (only the default and destructive Button variants have a hover fill — the primary-hover and destructive-hover tokens, 2 sites each, nothing else)';
  const oneRing =
    'both focus-ring tokens (--ring, --sidebar-ring) follow ring.primary and nothing paints a per-status ring; ring.danger is consumed as --danger-border';
  const warningInfo =
    'no app component paints the solid warning/info fill (grep at 730053e: 0 bg-warning, 0 bg-info in apps/web/src; the two sites are packages/ui/src/demo/render.tsx:33,35, a build-script page the app never imports); un-cut condition: a component that paints the solid fill with its label';
  const out: Record<string, string> = {};
  for (const tone of ['accent', 'success', 'danger']) {
    out[`text.${tone}`] = statusText;
    out[`text.${tone}_dark`] = statusText;
  }
  for (const tone of ['accent', 'success']) {
    out[`hover.${tone}`] = noHover;
    out[`hover.${tone}_dark`] = noHover;
    out[`foregrounds.${tone}_hover`] = noHover;
    out[`foregrounds.${tone}_hover_dark`] = noHover;
    out[`ring.${tone}`] = oneRing;
    out[`ring.${tone}_dark`] = oneRing;
  }
  for (const tone of ['warning', 'info']) {
    for (const group of ['fills', 'dark']) out[`${group}.${tone}`] = warningInfo;
    out[`hover.${tone}`] = warningInfo;
    out[`hover.${tone}_dark`] = warningInfo;
    out[`ring.${tone}`] = warningInfo;
    out[`ring.${tone}_dark`] = warningInfo;
    out[`text.${tone}`] = warningInfo;
    out[`text.${tone}_dark`] = warningInfo;
    for (const suffix of ['', '_dark', '_hover', '_hover_dark']) out[`foregrounds.${tone}${suffix}`] = warningInfo;
  }
  return out;
})();

/**
 * The surfaces the platform paints text on (D-024 tokens). The on-surface
 * proofs run against the darkest light one and the lightest dark one; a tone
 * readable there is readable on every surface the app owns.
 */
export const SURFACES = [
  'background',
  'card',
  'popover',
  'muted',
  'secondary',
  'input-bg',
  'sidebar',
  'accent',
  'sidebar-accent',
] as const satisfies readonly SemanticToken[];

/** Min-luminance light surface and max-luminance dark surface, as token hex. */
export function worstCaseSurfaces(): { light: string; dark: string } {
  let light: string = semanticLight[SURFACES[0]];
  let dark: string = semanticDark[SURFACES[0]];
  for (const name of SURFACES) {
    if (relativeLuminance(semanticLight[name]) < relativeLuminance(light)) light = semanticLight[name];
    if (relativeLuminance(semanticDark[name]) > relativeLuminance(dark)) dark = semanticDark[name];
  }
  return { light, dark };
}

/** The published display name, trimmed, or null when the brand carries none. */
export function brandDisplayName(b: PublishedBrandingT | null | undefined): string | null {
  const name = b?.display_name?.trim();
  return name ? name : null;
}

/**
 * The brand name for `<title>` (F-75, A11): provided by the tenant shell only,
 * so the platform console and the public routes cannot carry a brand in the
 * tab by construction. `null` = no brand → `common:appName`.
 */
export const BrandNameContext = createContext<string | null>(null);

/** The raw palette cell, or undefined when the key is absent. */
function rawAt(b: PublishedBrandingT, [group, key]: PalettePath): unknown {
  return b.palette[group]?.[key];
}

/** The palette cell only if present and well-formed. */
function safeAt(b: PublishedBrandingT, path: PalettePath): string | undefined {
  const v = rawAt(b, path);
  return typeof v === 'string' && SAFE_COLOR.test(v) ? v : undefined;
}

type Theme = 'light' | 'dark';

function pathOf(row: PaintRow, theme: Theme): PalettePath {
  return theme === 'light' ? row.light : row.dark;
}

/**
 * A unit's CONSUMER invariant, beyond the fill/label pair. The heatmap is the
 * only reader of the `success` unit (heatmap-page.tsx): its two hottest steps
 * paint the tenant fill above three steps of the platform tint `success-bg`,
 * so the scale stays a scale only while the fill sits beyond the tint in the
 * theme's direction — darker than the tint on light, lighter on dark. A pale
 * success (#ECFDF5 → luminance 0.947, lighter than the tint at 0.876 and
 * indistinguishable from an empty cell) is therefore gated: the platform
 * fill applies and `gated` names `fills.success`. heatmap-ramp.test.ts holds
 * the same ordering for the platform palette.
 */
const UNIT_INVARIANTS: Readonly<Record<string, (fill: Oklch, theme: Theme) => boolean>> = {
  success: (fill, theme) =>
    theme === 'light'
      ? oklchLuminance(fill) < oklchLuminance(hexToOklch(semanticLight['success-bg']))
      : oklchLuminance(fill) > oklchLuminance(hexToOklch(semanticDark['success-bg'])),
};

/** One theme block: which units and proofs pass, then the declarations in table order. */
function paintBlock(b: PublishedBrandingT, theme: Theme, surface: Oklch): { decls: string[]; gated: string[] } {
  const gated: string[] = [];
  const emittedUnits = new Set<string>();
  const passedProofs = new Set<PaintProof>();

  // Units in table order — a `requires` unit always follows its base.
  const unitNames = [...new Set(BRAND_PAINT.flatMap((row) => (row.unit ? [row.unit] : [])))];
  for (const unit of unitNames) {
    const rows = BRAND_PAINT.filter((row) => row.unit === unit);
    const fillRow = rows.find((row) => !row.css.endsWith('-foreground'));
    const labelRow = rows.find((row) => row.css.endsWith('-foreground'));
    if (!fillRow || !labelRow) throw new Error(`BRAND_PAINT unit ${unit} is not a fill + label pair`);
    // Nothing published for this unit (an optional semantic colour left blank): not applicable, not gated.
    if (rows.every((row) => rawAt(b, pathOf(row, theme)) === undefined)) continue;
    const fill = safeAt(b, pathOf(fillRow, theme));
    const label = safeAt(b, pathOf(labelRow, theme));
    const baseOk = fillRow.requires === undefined || emittedUnits.has(fillRow.requires);
    const pairOk = fill !== undefined && label !== undefined && contrastRatio(parseColor(fill), parseColor(label)) >= AA_TEXT;
    const invariant = UNIT_INVARIANTS[unit];
    const orderOk = fill === undefined || invariant === undefined || invariant(parseColor(fill), theme);
    if (baseOk && pairOk && orderOk) emittedUnits.add(unit);
    else gated.push(pathOf(fillRow, theme).join('.'));
  }

  // Shared proofs: one source path each, gated once, all dependents together.
  const proofs = [...new Set(BRAND_PAINT.flatMap((row) => (row.proof ? [row.proof] : [])))];
  for (const proof of proofs) {
    const rows = BRAND_PAINT.filter((row) => row.proof === proof);
    const first = rows[0];
    if (!first) continue;
    const source = pathOf(first, theme);
    if (rows.some((row) => pathOf(row, theme).join('.') !== source.join('.'))) {
      throw new Error(`BRAND_PAINT proof ${proof} reads more than one palette cell`);
    }
    if (rawAt(b, source) === undefined) continue;
    const value = safeAt(b, source);
    const floor = proof.startsWith('ring.') ? AA_UI : AA_TEXT;
    if (value !== undefined && contrastRatio(parseColor(value), surface) >= floor) passedProofs.add(proof);
    else gated.push(source.join('.'));
  }

  const decls: string[] = [];
  for (const row of BRAND_PAINT) {
    const approved = row.unit ? emittedUnits.has(row.unit) : row.proof ? passedProofs.has(row.proof) : false;
    if (!approved) continue;
    if (row.when === 'no-accent-unit' && emittedUnits.has('accent')) continue;
    const value = safeAt(b, pathOf(row, theme));
    if (value === undefined) throw new Error(`approved row --${row.css} has no value`);
    decls.push(`--${row.css}:${value};`);
  }
  return { decls, gated };
}

/**
 * The stylesheet for a published brand, pure (no DOM). `gated` names every
 * palette cell that was present but not painted, in the palette's own
 * vocabulary (`text.primary`, `fills.primary`, `hover.primary_dark`, …).
 *
 * Three blocks. A plain `:root{}` carries the theme-INDEPENDENT declarations
 * (`--radius`, and `--font-sans` for the system font): tokens.css defines them
 * on `:root` and never redefines them under `[data-theme="dark"]`, so this
 * later declaration wins in both themes. The two COLOUR halves are
 * theme-scoped, and the light one is `:root:not([data-theme="dark"])`, not
 * `:root`: this <style> sits in <body> after tokens.css, and a plain `:root{}`
 * (0,1,0, later) would beat tokens.css's `[data-theme="dark"]{}` (0,1,0)
 * whenever a variable's light half is emitted and its dark half is gated — the
 * dark theme would read the LIGHT brand tone (measured: #1E3A8A stale
 * text.primary_dark 3.70 on #232738 while its light tone 9.41 is emitted).
 * `initTheme()` always stamps `data-theme`, so the `:not()` form is exact. A
 * colour never enters the plain block (brand-style.test.ts #6).
 */
export function brandCss(b: PublishedBrandingT): { css: string; gated: string[] } {
  const worst = worstCaseSurfaces();
  const light = paintBlock(b, 'light', hexToOklch(worst.light));
  const dark = paintBlock(b, 'dark', hexToOklch(worst.dark));

  const shared = [`--radius:${RADIUS_REM[b.radius]};`];
  if (b.font_family === 'system') shared.push(`--font-sans:${SYSTEM_FONT_STACK};`);

  const blocks = [`:root{${shared.join('')}}`];
  if (light.decls.length > 0) blocks.push(`:root:not([data-theme="dark"]){${light.decls.join('')}}`);
  if (dark.decls.length > 0) blocks.push(`:root[data-theme="dark"]{${dark.decls.join('')}}`);
  return { css: blocks.join(''), gated: [...light.gated, ...dark.gated] };
}

/**
 * Inject the proven brand tokens for the branding the shell already holds — a
 * PROP, never a query of its own: AppLayout is the branding query's only
 * observer, because an observer mounting under AppLayout's skeleton gate
 * refetches an errored, data-less entry on every mount and loops the gate
 * (F-75 review, C3/C8). `null` (never published, or the query errored) leaves
 * the platform theme intact. Rendered inside the authenticated shell — the
 * endpoint needs a member. `data-brand-gated` is a DIAGNOSTIC surface for
 * tests only (the unit tests read the pure `gated` array; the e2e asserts the
 * attribute is absent for a fresh publish); no product code reads it.
 */
export function BrandStyle({ branding }: { branding: PublishedBrandingT | null }) {
  if (!branding) return null;
  const { css, gated } = brandCss(branding);
  return (
    <style
      data-brand-version={branding.version}
      data-brand-gated={gated.length > 0 ? gated.join(' ') : undefined}
      data-testid="brand-style"
    >
      {css}
    </style>
  );
}
