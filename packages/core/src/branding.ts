/**
 * F-14 white-label colour engine (white-labeling.md §2, §5, §12; ADR-018).
 *
 * Tenants pick their own brand colours, and those colours end up behind real
 * text that real people have to read. A dealership picking a pale yellow for
 * "primary" must not produce a button whose label nobody can see — so contrast
 * is computed here, server-side, and unreadable combinations are AUTO-FIXED
 * rather than rejected. The spec is explicit that publishing is never blocked
 * by a fixable contrast problem: a tenant who cannot publish their brand will
 * simply be given a worse product, whereas a tenant whose text is quietly
 * nudged to a readable shade gets a working one.
 *
 * Colours are OKLCH because lightness in OKLCH is perceptual: shifting L by a
 * fixed amount looks like the same step at every hue, which is what makes the
 * derived dark palette (§5) and the readability fixes below predictable. HSL
 * would make yellow and blue behave completely differently at the same L.
 *
 * Everything here is pure. No I/O, no dates, no randomness — the same brand in
 * gives the same palette out, forever, which is what lets the golden tests
 * below be worth anything.
 */

export interface Oklch {
  /** Perceptual lightness, 0–1. */
  readonly l: number;
  /** Chroma, 0–~0.4 in sRGB. */
  readonly c: number;
  /** Hue in degrees, 0–360. */
  readonly h: number;
}

/** WCAG 2.2 AA: normal text and meaningful graphics. */
export const AA_TEXT = 4.5;
/** WCAG 2.2 AA: UI components and focus indicators. */
export const AA_UI = 3;

/** shadcn's near-white and near-black — the two foregrounds a fill may use. */
export const FG_LIGHT: Oklch = { l: 0.985, c: 0, h: 0 };
export const FG_DARK: Oklch = { l: 0.145, c: 0, h: 0 };

// ---------------------------------------------------------------------------
// OKLCH ⇄ sRGB. Björn Ottosson's matrices; the inverse is the exact transpose
// of the forward path, which is what makes the round-trip test meaningful.
// ---------------------------------------------------------------------------

function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(v: number): number {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

/** Linear-light sRGB, each channel 0–1, clipped to the gamut. */
export function oklchToLinearRgb(color: Oklch): [number, number, number] {
  const hRad = (color.h * Math.PI) / 180;
  const a = color.c * Math.cos(hRad);
  const b = color.c * Math.sin(hRad);

  const l_ = color.l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = color.l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = color.l - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return [
    clamp01(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp01(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp01(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

export function oklchToHex(color: Oklch): string {
  const [r, g, b] = oklchToLinearRgb(color);
  const to255 = (v: number) => Math.round(clamp01(linearToSrgb(v)) * 255);
  return `#${[to255(r), to255(g), to255(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function hexToOklch(hex: string): Oklch {
  const parsed = parseHex(hex);
  if (!parsed) throw new Error(`Not a hex colour: ${hex}`);
  const [r, g, b] = parsed.map(srgbToLinear) as [number, number, number];

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const c = Math.sqrt(A * A + B * B);
  // Achromatic colours have no meaningful hue; atan2(0,0) is 0 but the angle is
  // noise at tiny chroma, so it is pinned rather than left to float.
  const h = c < 1e-6 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return null;
  const raw = m[1]!.length === 3 ? m[1]!.split('').map((ch) => ch + ch).join('') : m[1]!;
  return [
    parseInt(raw.slice(0, 2), 16) / 255,
    parseInt(raw.slice(2, 4), 16) / 255,
    parseInt(raw.slice(4, 6), 16) / 255,
  ];
}

// Signs allowed on each component: `oklch(0.5 0.1 -10)` is valid CSS (hue is
// an angle), and a negative L or C is nonsense that gets clamped rather than
// rejected — refusing to parse it would turn a typo into a 500.
const OKLCH_RE = /^oklch\(\s*(-?[0-9.]+%?)\s+(-?[0-9.]+)\s+(-?[0-9.]+)\s*\)$/i;

/** Accepts the stored `oklch(L C H)` form, or a hex the editor has not converted. */
export function parseColor(value: string): Oklch {
  const m = OKLCH_RE.exec(value.trim());
  if (m) {
    const rawL = m[1]!;
    return {
      l: clamp01(rawL.endsWith('%') ? Number(rawL.slice(0, -1)) / 100 : Number(rawL)),
      c: Math.max(0, Number(m[2]!)),
      h: ((Number(m[3]!) % 360) + 360) % 360,
    };
  }
  if (parseHex(value)) return hexToOklch(value);
  throw new Error(`Not a colour this system understands: ${value}`);
}

export function formatOklch(color: Oklch): string {
  const r = (n: number, places: number) => Number(n.toFixed(places));
  return `oklch(${r(color.l, 4)} ${r(color.c, 4)} ${r(color.h, 2)})`;
}

// ---------------------------------------------------------------------------
// WCAG 2.2 contrast
// ---------------------------------------------------------------------------

/**
 * WCAG relative luminance, from LINEAR sRGB.
 *
 * Not from OKLCH's L. They are different quantities: OKLCH L is perceptual
 * lightness, WCAG luminance is a physical light measure, and using one where
 * the standard names the other gives a number that looks plausible and fails a
 * real audit.
 */
export function relativeLuminance(color: Oklch): number {
  const [r, g, b] = oklchToLinearRgb(color);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.2 contrast ratio, 1–21. Order of arguments does not matter. */
export function contrastRatio(a: Oklch, b: Oklch): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// ---------------------------------------------------------------------------
// The fixes (§12)
// ---------------------------------------------------------------------------

/** Whichever of near-white / near-black is more readable ON this fill. */
export function foregroundFor(fill: Oklch): Oklch {
  return contrastRatio(fill, FG_LIGHT) >= contrastRatio(fill, FG_DARK) ? FG_LIGHT : FG_DARK;
}

/**
 * The same brand colour, made readable AS TEXT on `background`.
 *
 * Hue and chroma are preserved and only lightness moves, so the result still
 * reads as the tenant's brand rather than as a different colour — this is why
 * the work is done in OKLCH. Components use this for text and the raw brand
 * colour for fills, which is the distinction §12 draws: a brand blue that is
 * perfect on a button can be unreadable as a link on white.
 *
 * Returns the input untouched when it already passes, so a tenant whose colours
 * are fine sees no adjustment at all.
 */
export function readableOn(color: Oklch, background: Oklch, target = AA_TEXT): Oklch {
  if (contrastRatio(color, background) >= target) return color;

  // Move away from the background: darker text on light surfaces, lighter on
  // dark ones. Binary search over L — contrast is monotonic in L once the
  // direction is fixed, and 24 halvings settle far below one 8-bit step.
  const towardDark = relativeLuminance(background) > relativeLuminance({ l: 0.5, c: 0, h: 0 });
  let lo = towardDark ? 0 : color.l;
  let hi = towardDark ? color.l : 1;
  let best: Oklch = { ...color, l: towardDark ? 0 : 1 };

  if (contrastRatio(best, background) < target) return best; // even the extreme cannot reach it
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const candidate: Oklch = { ...color, l: mid };
    if (contrastRatio(candidate, background) >= target) {
      // Readable: keep it, and try to stay closer to the original lightness.
      best = candidate;
      if (towardDark) lo = mid;
      else hi = mid;
    } else if (towardDark) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  // Snap to the precision the value is STORED at, in the safe direction.
  //
  // Without this the search settles a hair above 4.5, `formatOklch` rounds L to
  // four places, and the colour that actually ships lands at 4.4999 — passing
  // here and failing the audit that matters. The check has to hold for the
  // value that reaches the browser, not the one that briefly existed in a float.
  const q = 1e4;
  const snapped = towardDark ? Math.floor(best.l * q) / q : Math.ceil(best.l * q) / q;
  const quantized: Oklch = { ...best, l: clamp01(snapped) };
  return contrastRatio(quantized, background) >= target ? quantized : best;
}

/**
 * §5 derived dark palette: lighter and slightly desaturated on dark surfaces.
 * `oklch(clamp(L + 0.17, 0.60, 0.85), C × 0.85, H)` — the spec's formula, which
 * mirrors what the legacy palette did by hand.
 */
export function deriveDark(color: Oklch): Oklch {
  return {
    l: Math.min(0.85, Math.max(0.6, color.l + 0.17)),
    c: color.c * 0.85,
    h: color.h,
  };
}

/**
 * The same fill, visibly different under the cursor — and still legible.
 *
 * A hover state is a FILL paired with a label, not a text tone. Handing the app
 * a text tone for `--primary-hover` makes hover identical to the base colour for
 * any brand that was already readable on white, so the button gives no feedback
 * at all (CR-15, Hussein).
 *
 * Direction is chosen for LEGIBILITY, not convention. The conventional nudge is
 * tried first — darker for a light fill, lighter for a dark one — but a mid-tone
 * fill sits in a dead zone where neither near-white nor near-black reaches
 * 4.5:1, and nudging further into it produces a hover state with no readable
 * label. #7C3AED lightened by the conventional step lands at 4.46:1, which the
 * whole-palette invariant caught the first time it ran. So candidates are tried
 * in order and the first one that both DIFFERS from the base and carries a
 * readable label wins.
 */
export function hoverFill(fill: Oklch): Oklch {
  const delta = 0.06;
  const conventionalIsLighter = relativeLuminance(fill) < 0.18;
  const steps = conventionalIsLighter
    ? [delta, -delta, 2 * delta, -2 * delta]
    : [-delta, delta, -2 * delta, 2 * delta];

  const candidates = steps
    .map((step) => ({ ...fill, l: clamp01(fill.l + step) }))
    .filter((candidate) => candidate.l !== fill.l);

  const legible = candidates.find(
    (candidate) => contrastRatio(candidate, foregroundFor(candidate)) >= AA_TEXT,
  );
  if (legible) return legible;

  // Nothing clears AA — a fill sitting deep in the dead zone. Take the most
  // legible option rather than the prettiest, and never return the base.
  return (
    candidates.sort(
      (a, b) => contrastRatio(b, foregroundFor(b)) - contrastRatio(a, foregroundFor(a)),
    )[0] ?? { ...fill, l: clamp01(fill.l + delta) }
  );
}

/**
 * A focus ring that can be SEEN against the surface behind it (§12: ≥ 3:1).
 *
 * 3:1 rather than 4.5:1 because a ring is a UI component, not text — WCAG 2.2
 * holds those to different floors, and demanding 4.5 here would push every
 * ring toward black and lose the brand for no accessibility gain.
 */
export function ringFor(color: Oklch, surface: Oklch): Oklch {
  return readableOn(color, surface, AA_UI);
}

export interface BrandingInput {
  primary: string;
  accent?: string | null;
  success?: string | null;
  warning?: string | null;
  danger?: string | null;
  info?: string | null;
}

export interface ContrastAdjustment {
  /** Which colour was adjusted, in the tenant's own vocabulary. */
  readonly token: string;
  readonly from: string;
  readonly to: string;
  readonly ratioBefore: number;
  readonly ratioAfter: number;
  /** Plain enough to show a dealership owner in a publish dialog. */
  readonly reason: string;
}

export interface ValidatedBranding {
  /** Fills — the tenant's colours, untouched. */
  readonly fills: Record<string, string>;
  /** Text variants, adjusted where the raw colour was unreadable. */
  readonly text: Record<string, string>;
  /**
   * The foreground each fill must use for a label on top of it.
   *
   * Keyed per fill, including the DARK ones: `primary` is the label for
   * `fills.primary`, `primary_dark` the label for `dark.primary`. They are
   * usually different and sometimes opposite — the dark palette lightens a
   * brand colour, so a medium-dark brand takes a white label in light mode and
   * a near-black one in dark mode. Reusing the light value put a near-white
   * label on a light fill at 2.5:1 (CR-15).
   */
  readonly foregrounds: Record<string, string>;
  /** The §5 dark-mode palette. */
  readonly dark: Record<string, string>;
  /** Hover fills, light and dark, each with its own foreground above. */
  readonly hover: Record<string, string>;
  /** Focus rings that meet 3:1 against the surface they sit on. */
  readonly ring: Record<string, string>;
  /** Everything that was changed, for the publish confirmation. */
  readonly adjustments: readonly ContrastAdjustment[];
}

/** The light and dark page surfaces the platform owns (§5 — not tenant-set). */
export const SURFACE_LIGHT: Oklch = { l: 1, c: 0, h: 0 };
export const SURFACE_DARK: Oklch = hexToOklch('#0F1117');

/**
 * Validate and auto-fix a tenant's palette (§12).
 *
 * Never throws on a bad-looking colour and never refuses to publish: it returns
 * a palette that meets AA plus the list of what it had to change, so the editor
 * can say "contrast 2.9:1 — adjusted to meet WCAG AA" instead of "invalid".
 */
export function validateBrandingContrast(input: BrandingInput): ValidatedBranding {
  const adjustments: ContrastAdjustment[] = [];
  const fills: Record<string, string> = {};
  const text: Record<string, string> = {};
  const foregrounds: Record<string, string> = {};
  const dark: Record<string, string> = {};
  const hover: Record<string, string> = {};
  const ring: Record<string, string> = {};

  const tokens: [string, string | null | undefined, number][] = [
    ['primary', input.primary, AA_TEXT],
    ['accent', input.accent, AA_TEXT],
    // Semantic colours carry meaning as UI (a red border, a green dot) as well
    // as text, so they are held to the text threshold where they are text.
    ['success', input.success, AA_TEXT],
    ['warning', input.warning, AA_TEXT],
    ['danger', input.danger, AA_TEXT],
    ['info', input.info, AA_TEXT],
  ];

  for (const [token, raw, target] of tokens) {
    if (raw == null || raw === '') continue;
    const color = parseColor(raw);
    fills[token] = formatOklch(color);

    // Every fill this palette exposes gets its own foreground, in the same
    // pass that creates it — the two are one decision, and splitting them is
    // how `dark.primary` ended up with no label of its own.
    const darkFill = deriveDark(color);
    const hoverLight = hoverFill(color);
    const hoverDark = hoverFill(darkFill);

    foregrounds[token] = formatOklch(foregroundFor(color));
    foregrounds[`${token}_dark`] = formatOklch(foregroundFor(darkFill));
    foregrounds[`${token}_hover`] = formatOklch(foregroundFor(hoverLight));
    foregrounds[`${token}_hover_dark`] = formatOklch(foregroundFor(hoverDark));

    dark[token] = formatOklch(darkFill);
    hover[token] = formatOklch(hoverLight);
    hover[`${token}_dark`] = formatOklch(hoverDark);

    ring[token] = formatOklch(ringFor(color, SURFACE_LIGHT));
    ring[`${token}_dark`] = formatOklch(ringFor(darkFill, SURFACE_DARK));

    // As text on the light page. The dark palette gets the same treatment
    // against the dark surface, because a colour readable on white is often
    // invisible on near-black and vice versa.
    const asText = readableOn(color, SURFACE_LIGHT, target);
    text[token] = formatOklch(asText);
    if (asText.l !== color.l) {
      adjustments.push({
        token,
        from: formatOklch(color),
        to: formatOklch(asText),
        ratioBefore: round2(contrastRatio(color, SURFACE_LIGHT)),
        ratioAfter: round2(contrastRatio(asText, SURFACE_LIGHT)),
        reason: `${token} was not readable as text on a light background`,
      });
    }

    const darkColor = darkFill;
    const darkText = readableOn(darkColor, SURFACE_DARK, target);
    text[`${token}_dark`] = formatOklch(darkText);
    if (darkText.l !== darkColor.l) {
      adjustments.push({
        token: `${token}_dark`,
        from: formatOklch(darkColor),
        to: formatOklch(darkText),
        ratioBefore: round2(contrastRatio(darkColor, SURFACE_DARK)),
        ratioAfter: round2(contrastRatio(darkText, SURFACE_DARK)),
        reason: `${token} was not readable as text in dark mode`,
      });
    }
  }

  return { fills, text, foregrounds, dark, hover, ring, adjustments };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
