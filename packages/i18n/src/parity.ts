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

/** ICU argument names referenced by a message ({name}, {n, plural, …}). */
export function icuArgs(message: string): Set<string> {
  const args = new Set<string>();
  for (const match of message.matchAll(/\{\s*([A-Za-z0-9_]+)/g)) {
    if (match[1] !== undefined) args.add(match[1]);
  }
  return args;
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
