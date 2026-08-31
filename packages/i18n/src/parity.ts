/**
 * EN↔FR key-parity check (ADR-019: Bill 96 requires the French UI to be
 * EQUIVALENT — a key missing in either language fails the build).
 * Pure logic here; the CLI wrapper is scripts/check-parity.mjs and the same
 * comparison runs in the test suite.
 */

export interface ParityIssue {
  locale: string;
  kind: 'missing' | 'extra' | 'empty' | 'args-mismatch';
  key: string;
}

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      out.set(path, value);
    } else {
      for (const [k, v] of flatten(value, path)) out.set(k, v);
    }
  }
  return out;
}

/**
 * ICU argument names referenced by a message ({name}, {n, plural, …}).
 *
 * An ICU-aware walk: only the head of an argument is a name. The bodies of
 * plural / select / selectordinal branches are message text again, so a
 * nested `{name}` inside one counts and the branch's first word does not.
 * The earlier regex took the first word inside EVERY brace, so a plural
 * whose `=0` branch starts with a word instead of `#` — « Aucun connecteur
 * actif » against "No active connector" — reported a false args-mismatch
 * (F-77). Unbalanced braces are left to icu-syntax.test.ts.
 */
export function icuArgs(message: string): Set<string> {
  const args = new Set<string>();
  walkText(message, 0, message.length, args);
  return args;
}

const BRANCHED = new Set(['plural', 'select', 'selectordinal']);

/** Message text: every `{` opens an argument. */
function walkText(msg: string, from: number, to: number, args: Set<string>): void {
  let i = from;
  while (i < to) {
    if (msg[i] !== '{') {
      i++;
      continue;
    }
    const end = matchingBrace(msg, i, to);
    if (end < 0) return;
    readArgument(msg, i + 1, end, args);
    i = end + 1;
  }
}

/** `{name}`, `{name, type}` or `{name, plural|select|selectordinal, sel {body} …}`. */
function readArgument(msg: string, from: number, to: number, args: Set<string>): void {
  const m = /^\s*([A-Za-z0-9_]+)\s*(?:,\s*([A-Za-z]+)\s*(?:,([\s\S]*))?)?$/.exec(msg.slice(from, to));
  if (!m || m[1] === undefined) return;
  args.add(m[1]);
  const type = m[2];
  const rest = m[3];
  if (rest === undefined || type === undefined || !BRANCHED.has(type)) return;
  // Selector {body} pairs — each body is message text, so a nested `{name}` counts.
  let j = 0;
  while (j < rest.length) {
    if (rest[j] !== '{') {
      j++;
      continue;
    }
    const end = matchingBrace(rest, j, rest.length);
    if (end < 0) return;
    walkText(rest, j + 1, end, args);
    j = end + 1;
  }
}

function matchingBrace(msg: string, open: number, to: number): number {
  let depth = 0;
  for (let k = open; k < to; k++) {
    if (msg[k] === '{') depth++;
    else if (msg[k] === '}' && --depth === 0) return k;
  }
  return -1;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

/**
 * Compares every locale against the reference (fr-CA). Reports keys missing
 * from a locale, extra keys, empty translations — INCLUDING empty values in
 * the reference itself (an empty French string is the worst Bill 96 failure)
 * — and ICU argument sets that diverge between languages
 * (media-i18n-validation §2.3: variable sets must match across locales).
 */
export function checkParity(
  reference: Tree,
  locales: Record<string, Tree>,
  referenceName = 'fr-CA',
): ParityIssue[] {
  const refKeys = flatten(reference);
  const issues: ParityIssue[] = [];
  for (const [key, value] of refKeys) {
    if (value.trim() === '') issues.push({ locale: referenceName, kind: 'empty', key });
  }
  for (const [name, tree] of Object.entries(locales)) {
    const keys = flatten(tree);
    for (const key of refKeys.keys()) {
      if (!keys.has(key)) issues.push({ locale: name, kind: 'missing', key });
    }
    for (const [key, value] of keys) {
      const refValue = refKeys.get(key);
      if (refValue === undefined) {
        issues.push({ locale: name, kind: 'extra', key });
        continue;
      }
      if (value.trim() === '') issues.push({ locale: name, kind: 'empty', key });
      if (!sameSet(icuArgs(refValue), icuArgs(value))) {
        issues.push({ locale: name, kind: 'args-mismatch', key });
      }
    }
  }
  return issues;
}
