/**
 * F-75 (D-076) — WCAG 2.2 contrast over the colour strings a Playwright spec
 * can actually read: `getComputedStyle(el).color`, a root
 * `getPropertyValue('--ring')`, a published palette cell. Accepts
 * `rgb()/rgba()`, `#hex` (3, 6 or 8 digits), `oklch(L C H)` and
 * `color(srgb r g b)`; a channel outside the gamut — a signed or > 1
 * `color(srgb)` / `oklch()` channel included — is clamped, and an alpha
 * component, where the grammar allows one, is ignored. Anything else
 * (`hsl()`, a named colour, `color()` in another space) throws, so a spec
 * cannot pass a floor on a value it did not parse. contrast.test.ts pins
 * every number in this header to what the code computes.
 *
 * DUPLICATED, on purpose, from packages/core/src/branding.ts — the OKLCH →
 * linear-sRGB path (Björn Ottosson's matrices) and the WCAG luminance/ratio.
 * No spec imports a workspace package (`grep -rln "from '@dealpilot" apps/web/e2e`
 * → 0) and Playwright's loader is unverified for one; support/totp.ts is the
 * same kind of copy for the same reason. The count of copies is
 * `grep -rn 'function oklchToLinearRgb' apps packages`, not this sentence.
 *
 * Convention (the one core uses): a ratio is proven on the SPECIFIED colour
 * under gamut CLIPPING — every linear channel clamped to 0–1 (core's
 * `clamp01`) — not on the rendered pixel. Measured 2026-08-31 against the
 * core dist and the suite's Chrome (channel `chrome`, 151.0.7922.175): the
 * #FDE047 text tone core ships, `oklch(0.5413 0.1657 98.11)`, is out of the
 * sRGB gamut (`rgb(from … r g b)` → `color(srgb 0.538601 0.425769 -0.235407)`)
 * and measures, with this file, 4.616:1 on the page (#F5F7FA), 4.502:1 on
 * muted (#F3F4F6) and 4.954:1 on card (#FFFFFF). Chrome serialises the
 * computed colour as `oklch(…)` and, when it paints, CLIPS each channel and
 * quantises to 8 bits — the canvas pixel and the screenshot both read
 * rgb(137, 109, 0) — which this file measures at 4.603 / 4.489 / 4.940:
 * slightly BELOW the clipped ratios, with muted under 4.5. That is why the
 * floors asserted with this file are the server's proof on the value it
 * stored, not a claim about the pixel (D-076). Equality assertions in the
 * specs do NOT use this file: they compare two strings after one browser
 * serialisation (`canon()`).
 */

type LinearRgb = readonly [r: number, g: number, b: number];

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function num(raw: string, what: string, css: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`contrast: ${what} "${raw}" is not a number in "${css}"`);
  return n;
}

/** OKLCH → linear sRGB, channels clipped to the gamut (core's convention). */
function oklchToLinearRgb(l: number, c: number, hDeg: number): LinearRgb {
  const hRad = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const L = l_ * l_ * l_;
  const M = m_ * m_ * m_;
  const S = s_ * s_ * s_;

  return [
    clamp01(4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S),
    clamp01(-1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S),
    clamp01(-0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S),
  ];
}

const RGB_RE = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*[\d.%]+)?\s*\)$/i;
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const OKLCH_RE = /^oklch\(\s*(-?[\d.]+%?)\s+(-?[\d.]+)\s+(-?[\d.]+)(?:deg)?(?:\s*\/\s*[\d.%]+)?\s*\)$/i;
const SRGB_RE = /^color\(\s*srgb\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)(?:\s*\/\s*[\d.%]+)?\s*\)$/i;

/** The colour as linear-light sRGB, or a thrown error naming the string. */
function linearRgbOf(css: string): LinearRgb {
  const s = css.trim();
  const rgb = RGB_RE.exec(s);
  if (rgb) {
    return [
      srgbToLinear(clamp01(num(rgb[1] ?? '', 'r', s) / 255)),
      srgbToLinear(clamp01(num(rgb[2] ?? '', 'g', s) / 255)),
      srgbToLinear(clamp01(num(rgb[3] ?? '', 'b', s) / 255)),
    ];
  }
  const hex = HEX_RE.exec(s);
  if (hex) {
    const digits = hex[1] ?? '';
    const full = digits.length === 3 ? digits.split('').map((ch) => ch + ch).join('') : digits.slice(0, 6);
    const channel = (i: number) => srgbToLinear(parseInt(full.slice(i, i + 2), 16) / 255);
    return [channel(0), channel(2), channel(4)];
  }
  const oklch = OKLCH_RE.exec(s);
  if (oklch) {
    const rawL = oklch[1] ?? '';
    const l = clamp01(rawL.endsWith('%') ? num(rawL.slice(0, -1), 'L', s) / 100 : num(rawL, 'L', s));
    const c = Math.max(0, num(oklch[2] ?? '', 'C', s));
    const h = ((num(oklch[3] ?? '', 'H', s) % 360) + 360) % 360;
    return oklchToLinearRgb(l, c, h);
  }
  const srgb = SRGB_RE.exec(s);
  if (srgb) {
    return [
      srgbToLinear(clamp01(num(srgb[1] ?? '', 'r', s))),
      srgbToLinear(clamp01(num(srgb[2] ?? '', 'g', s))),
      srgbToLinear(clamp01(num(srgb[3] ?? '', 'b', s))),
    ];
  }
  throw new Error(`contrast: cannot parse colour "${css}" (rgb()/rgba(), #hex, oklch(), color(srgb) only)`);
}

/** WCAG relative luminance, from LINEAR sRGB — never from OKLCH's L. */
function relativeLuminance(css: string): number {
  const [r, g, b] = linearRgbOf(css);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.2 contrast ratio, 1–21; the argument order does not matter. */
export function wcagRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
