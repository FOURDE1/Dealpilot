import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findRoleViolations, isExempt, TENANT_FILLS } from './token-roles.js';

/**
 * F-75 (D-076) — the role guard, two ways.
 *
 * First the matcher itself, one executable case per mutation the rule must
 * catch or must ignore (a rule that lives only in a regex run once dies at
 * the first refactor). Then the real tree: every page and component the app
 * ships, scanned with the same function, so a `text-primary` planted in any
 * page turns this file red with the file, line and rule in the message.
 */

/** A class string as it appears in a JSX attribute — the shape the tree holds. */
const inClassName = (classes: string) => findRoleViolations(`<div className="${classes}" />`);
const count = (classes: string) => inClassName(classes).length;

describe('findRoleViolations — the matcher, case by case', () => {
  it.each([
    // rule 1: the text tone
    ['text-primary', 1],
    ['hover:text-primary', 1],
    ['text-primary-text', 0],
    ['text-primary-foreground', 0],
    // rule 2: other utilities take the tone; destructive is not a border
    ['border-primary', 1],
    ['accent-primary', 1],
    ['border-destructive', 1],
    ['border-danger-border', 0],
    ['border-primary-text', 0],
    // rule 2: a side, an axis or an offset is the same utility; the tone and the fill itself are not rule 2's
    ['border-l-4 border-l-primary', 1],
    ['border-t-primary', 1],
    ['ring-offset-primary', 1],
    ['inset-ring-primary', 1],
    ['data-[state=open]:border-primary', 1],
    ['border-l-destructive', 1],
    ['border-l-primary-text', 0],
    ['bg-primary-text', 0],
    // rule 5: the escape hatches, for every tenant fill, with or without a fallback
    ['accent-[var(--primary)]', 1],
    ['text-(--primary)', 1],
    ['[color:var(--primary)]', 1],
    ['border-l-[var(--success,x)]', 1],
    ['text-[var(--success)]', 1],
    ['[color:var(--sidebar-accent)]', 1],
    ['var(--primary-hover)', 1],
    // …but a declaration, the text tone and a platform token are not reads of a fill
    ['--primary-text:oklch(0.5 0.1 90)', 0],
    ['--success:oklch(0.5 0.1 160)', 0],
    ['var(--primary-text)', 0],
    ['var(--success-text)', 0],
    ['border-l-[var(--warning,x)]', 0],
    // rule 3: a fill carries its label in the same literal
    ['bg-primary px-3', 1],
    ['bg-primary text-primary-foreground', 0],
    ['bg-success px-2', 1],
    ['bg-success text-success-foreground', 0],
    ['hover:bg-primary-hover', 1],
    ['hover:bg-primary-hover hover:text-primary-hover-foreground', 0],
    ['hover:bg-sidebar-accent', 1],
    ['bg-sidebar-accent text-sidebar-accent-foreground', 0],
    ['text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground', 0],
    ['bg-destructive text-destructive-foreground hover:bg-destructive-hover', 1],
    // rule 4: no opacity on a foreground
    ['text-primary-foreground/75', 1],
    ['bg-primary text-primary-foreground/75', 2],
    // rule 6: no opacity on a tenant fill, the -hover fills included; a tint's opacity is fine
    ['bg-success/60 text-success-foreground', 1],
    ['hover:bg-primary-hover/90 hover:text-primary-hover-foreground', 1],
    ['hover:bg-destructive-hover/80 hover:text-destructive-hover-foreground', 1],
    ['bg-success-bg/40 text-success-text', 0],
    // rule 7: the tone never sits inside a status tint
    ['bg-danger-bg text-primary-text', 1],
    ['bg-danger-bg text-danger-text', 0],
  ] as const)('%s → %i violation(s)', (classes, expected) => {
    expect(inClassName(classes).map((v) => v.rule)).toHaveLength(expected);
  });

  it('a violation inside a comment is not a violation — and line numbers survive stripping', () => {
    expect(findRoleViolations('// text-primary is the old name')).toEqual([]);
    expect(findRoleViolations('/* bg-primary alone\n  text-primary */')).toEqual([]);
    expect(findRoleViolations('{/* text-primary */}')).toEqual([]);
    const withBlock = '/* a\n b\n c */\nconst x = "text-primary";';
    expect(findRoleViolations(withBlock).map((v) => v.line)).toEqual([4]);
  });

  it('reports the line and the rule for each occurrence', () => {
    const src = ['const a = "bg-card";', 'const b = "text-primary";', 'const c = "bg-primary px-2";'].join('\n');
    const found = findRoleViolations(src);
    expect(found.map((v) => v.line)).toEqual([2, 3]);
    expect(found[0]?.rule).toMatch(/^rule 1/);
    expect(found[1]?.rule).toMatch(/^rule 3/);
  });

  it('French prose apostrophes in JSX do not open a string literal', () => {
    // « l'équipe » … « d'un » — an apostrophe after a letter is not a quote,
    // so the class literal between them is still read on its own.
    const src = "<p>l'équipe</p><div className=\"bg-primary text-primary-foreground\" /><p>d'un</p>";
    expect(findRoleViolations(src)).toEqual([]);
  });

  it('rule 5 is exempt only for the brand consumer that writes --primary', () => {
    expect(isExempt('apps/web/src/features/branding/brand-style.tsx')).toBe(true);
    expect(isExempt('C:\\repo\\apps\\web\\src\\features\\branding\\brand-style.tsx')).toBe(true);
    expect(isExempt('apps/web/src/features/branding/brand-style.test.tsx')).toBe(false);
    expect(isExempt('apps/web/src/features/leads/leads-page.tsx')).toBe(false);
    expect(isExempt('')).toBe(false);
    const hatch = 'const css = `--primary:${p}; color: var(--primary)`;';
    expect(findRoleViolations(hatch, 'apps/web/src/features/branding/brand-style.tsx')).toEqual([]);
    expect(findRoleViolations(hatch, 'apps/web/src/features/leads/leads-page.tsx')).toHaveLength(1);
    // The exemption covers rule 5 only.
    expect(findRoleViolations('"text-primary"', 'apps/web/src/features/branding/brand-style.tsx')).toHaveLength(1);
  });

  it('TENANT_FILLS names every fill rule 3 and rule 6 are built from', () => {
    expect([...TENANT_FILLS]).toEqual(['primary', 'destructive', 'success', 'sidebar-accent']);
    for (const fill of TENANT_FILLS) {
      expect(count(`bg-${fill} px-2`), `${fill} needs its label`).toBe(1);
      expect(count(`bg-${fill} text-${fill}-foreground`), `${fill} with its label`).toBe(0);
      expect(count(`bg-${fill}/50 text-${fill}-foreground`), `${fill} with opacity`).toBe(1);
      expect(count(`text-[var(--${fill})]`), `${fill} read by hand`).toBe(1);
    }
    // The -hover fills are tenant fills too (rules 3, 5 and 6).
    for (const fill of ['primary-hover', 'destructive-hover']) {
      expect(count(`hover:bg-${fill}`), `${fill} needs its label`).toBe(1);
      expect(count(`hover:bg-${fill}/50 hover:text-${fill}-foreground`), `${fill} with opacity`).toBe(1);
      expect(count(`[color:var(--${fill})]`), `${fill} read by hand`).toBe(1);
    }
  });
});

/** The repo root, from packages/ui/src/theme. */
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

const SCAN_DIRS = ['apps/web/src', 'packages/ui/src/components', 'packages/ui/src/demo'];
const SKIP_DIRS = new Set(['dist', 'node_modules']);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      // Token NAMES are declared in the theme folder, not used.
      if (relative(repoRoot, full).split(sep).join('/') === 'packages/ui/src/theme') continue;
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('the tree holds the role split', () => {
  const files = SCAN_DIRS.flatMap((d) => sourceFiles(join(repoRoot, d)));

  it('scans the real tree, not an emptied glob', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('no page or component reads a tenant fill as text, border, accent or alpha', () => {
    const report: string[] = [];
    for (const file of files) {
      const rel = relative(repoRoot, file).split(sep).join('/');
      for (const v of findRoleViolations(readFileSync(file, 'utf8'), rel)) {
        report.push(`${rel}:${v.line} — ${v.rule}: ${v.text}`);
      }
    }
    expect(report.join('\n')).toBe('');
  });
});
