/**
 * F-75 (D-076) — the role guard behind the tenant brand paint.
 *
 * A tenant's `--primary` is a FILL: it carries its own label
 * (`--primary-foreground`) and is proven only against that label. The
 * on-surface TONE — links, emphasis, the checkbox accent, the active-tab
 * border, unlabeled bars — is `--primary-text`, proven against the darkest
 * light / lightest dark surface the app paints. Nothing in the token wiring
 * stops a page from reading the fill as text (`@theme inline` maps every
 * semantic token to every utility), so the rule is enforced here, on the
 * source, and the test runs it over the whole tree.
 *
 * Pure: `findRoleViolations(source, path)` takes a file's text and returns the
 * offending lines. The rules are regular expressions on COMMENT-STRIPPED
 * source, so prose that names a class (this header does) is never a hit and a
 * violation hidden in a comment is never counted. (A `//` inside a string or
 * JSX text on the same line as a class literal blanks the rest of that line —
 * the bootstrap-guard shape, kept as ruled; the tree holds no such line.)
 *
 * Rules:
 *  1. `text-primary` → `text-primary-text` (any variant prefix).
 *  2. Any other utility ending in `-primary` (`border-`, `border-l-`,
 *     `ring-`, `ring-offset-`, `accent-`, `inset-ring-`, `divide-x-`, …,
 *     everything but `bg-primary` itself) → `<utility>-primary-text`; and
 *     `border-destructive` on any side → `border-danger-border` (a tenant fill
 *     is not a border; use the proven border token).
 *  3. A fill literal must carry its label in the SAME class literal:
 *     `bg-<fill>` with `text-<fill>-foreground`, `hover:bg-<fill>` with
 *     `hover:text-<fill>-foreground`, for every fill in `TENANT_FILLS` (and the
 *     `-hover` fills of primary/destructive).
 *  4. No opacity modifier on any `*-foreground` — the pairs are AA-thin.
 *  5. No hand read of a tenant fill's variable — `var(--<fill>)`,
 *     `var(--<fill>, fallback)`, `text-(--<fill>)`, `[color:var(--<fill>)]`
 *     for every fill in `FILL_TOKENS` — outside
 *     `features/branding/brand-style.tsx` (`isExempt`), the one file that
 *     writes them.
 *  6. No opacity modifier on a tenant fill, `-hover` fills included
 *     (`bg-success/60`, `hover:bg-primary-hover/90`): an alpha over an unknown
 *     surface is a colour nobody proved.
 *  7. `text-primary-text` never sits inside a status tint (`bg-*-bg`): the tone
 *     is proven on page surfaces only (measured 4.05–4.45 on the light tints).
 */

export interface RoleViolation {
  /** 1-based line in the source as given (comment stripping keeps line numbers). */
  readonly line: number;
  readonly rule: string;
  /** The matched text, for the failure message. */
  readonly text: string;
}

/**
 * The semantic fills a tenant palette can paint (brand-style.tsx's BRAND_PAINT
 * units); the consumer guard asserts every painted unit is listed here, so a
 * new tenant fill cannot arrive without the fill-carries-its-label rule.
 */
export const TENANT_FILLS = ['primary', 'destructive', 'success', 'sidebar-accent'] as const;

/** The fills that also have a distinct `-hover` fill token. */
const HOVER_FILLS = ['primary', 'destructive'] as const;

/** Every tenant-painted fill token, `-hover` fills included — rules 3, 5 and 6 are built from it. */
const FILL_TOKENS: readonly string[] = [
  ...TENANT_FILLS,
  ...HOVER_FILLS.map((fill) => `${fill}-hover`),
];

const VARIANT = String.raw`(?:[\w-]+:)*`;
const NOT_BEFORE = String.raw`(?<![\w-])`;
const NOT_AFTER = String.raw`(?![\w-])`;

/** Tailwind's side / axis / offset segment (`border-l-`, `border-x-`, `ring-offset-`). */
const SIDE = String.raw`(?:-(?:[trblsexy]|offset))?`;

/** Line rules 1, 2, 4, 5, 6 — matched per occurrence on each stripped line. */
const LINE_RULES: readonly { rule: string; re: RegExp; exemptible?: boolean }[] = [
  {
    rule: 'rule 1: text-primary → text-primary-text (the fill is not a text tone)',
    re: new RegExp(`${NOT_BEFORE}${VARIANT}text-primary${NOT_AFTER}`, 'g'),
  },
  {
    rule: 'rule 2: <utility>-primary → <utility>-primary-text (the fill is not an on-surface colour)',
    // Every utility that ends in `-primary` except the fill itself (`bg-primary`,
    // rule 3's business) and the text tone (`text-primary`, rule 1's).
    re: new RegExp(`${NOT_BEFORE}${VARIANT}(?!bg-primary${NOT_AFTER})(?!text-primary${NOT_AFTER})[a-z][a-z-]*-primary${NOT_AFTER}`, 'g'),
  },
  {
    rule: 'rule 2: border-destructive → border-danger-border (a tenant fill is not a border; use the proven border token)',
    re: new RegExp(`${NOT_BEFORE}${VARIANT}border${SIDE}-destructive${NOT_AFTER}`, 'g'),
  },
  {
    rule: 'rule 4: no opacity modifier on a *-foreground token (the pair is AA-thin)',
    re: new RegExp(`${NOT_BEFORE}${VARIANT}(?:text|bg)-[a-z-]+-foreground/\\d`, 'g'),
  },
  {
    rule: 'rule 5: var(--<fill>) / text-(--<fill>) / [color:var(--<fill>)] read a tenant fill directly — use a token class',
    // `(--primary)` and `(--primary,` — never `(--primary-text)` (the tone) and
    // never a declaration `--primary:` (brand-style.tsx's, exempt anyway).
    re: new RegExp(String.raw`\(--(?:${FILL_TOKENS.join('|')})[,)]`, 'g'),
    exemptible: true,
  },
  {
    rule: 'rule 6: no opacity modifier on a tenant fill (an alpha over an unknown surface is unproven)',
    re: new RegExp(`${NOT_BEFORE}${VARIANT}bg-(?:${FILL_TOKENS.join('|')})/\\d`, 'g'),
  },
];

const FILL_RE = new RegExp(`${NOT_BEFORE}(${VARIANT})bg-(${FILL_TOKENS.join('|')})${NOT_AFTER}`, 'g');
const LABEL_RE = new RegExp(`${NOT_BEFORE}(${VARIANT})text-(${FILL_TOKENS.join('|')})-foreground(?![\\w-/])`, 'g');
const TINT_RE = new RegExp(`${NOT_BEFORE}${VARIANT}bg-(?:success|warning|danger|info|caution)-bg${NOT_AFTER}`);
const TONE_RE = new RegExp(`${NOT_BEFORE}${VARIANT}text-primary-text${NOT_AFTER}`);

/**
 * String literals of the source: single-, double-quoted and template. An
 * opening single quote must not follow a letter, so the apostrophes of French
 * JSX prose (« l'équipe ») do not open a literal.
 */
const LITERAL_RE = /(?<![\p{L}\d_])'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/gu;

/** The bootstrap-guard shape, keeping line numbers: comments become blank. */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
    .replace(/\/\/[^\n]*/g, '');
}

/** Only the brand consumer may read a fill variable by hand: it is what writes them. */
export function isExempt(path: string): boolean {
  return /(?:^|[\\/])features[\\/]branding[\\/]brand-style\.tsx$/.test(path);
}

const variantSet = (prefix: string) =>
  prefix
    .split(':')
    .filter((v) => v.length > 0)
    .sort()
    .join(':');

export function findRoleViolations(source: string, path = ''): RoleViolation[] {
  const code = stripComments(source);
  const violations: RoleViolation[] = [];
  const exempt = isExempt(path);

  code.split('\n').forEach((lineText, index) => {
    for (const { rule, re, exemptible } of LINE_RULES) {
      if (exemptible && exempt) continue;
      for (const m of lineText.matchAll(re)) {
        violations.push({ line: index + 1, rule, text: m[0] });
      }
    }
  });

  for (const literal of code.matchAll(LITERAL_RE)) {
    const text = literal[0];
    const line = code.slice(0, literal.index).split('\n').length;
    const labels = new Set<string>();
    for (const m of text.matchAll(LABEL_RE)) {
      labels.add(`${variantSet(m[1] ?? '')}|${m[2]}`);
    }
    for (const m of text.matchAll(FILL_RE)) {
      const prefix = m[1] ?? '';
      const fill = m[2] ?? '';
      if (!labels.has(`${variantSet(prefix)}|${fill}`)) {
        violations.push({
          line,
          rule: `rule 3: ${prefix}bg-${fill} needs ${prefix}text-${fill}-foreground in the same class literal`,
          text: m[0],
        });
      }
    }
    if (TINT_RE.test(text) && TONE_RE.test(text)) {
      violations.push({
        line,
        rule: 'rule 7: text-primary-text is proven on page surfaces only — never inside a bg-*-bg tint',
        text,
      });
    }
  }

  return violations.sort((a, b) => a.line - b.line);
}
