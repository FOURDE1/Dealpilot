import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PermissionT } from '@dealpilot/schemas';
import { frCA } from '@dealpilot/i18n';
import { SETTINGS_SECTIONS, sectionHref, visibleSections } from './sections.js';

/**
 * F-76 (R9 graft from zero-vocabulary §7.1) — the settings index against the
 * router and the pages it points at.
 *
 * The first block reads apps/web/src/app/router.tsx as TEXT, strips comments,
 * takes the children of the `path: '/'` shell (the /admin block sits outside
 * it) and asserts every section `to` matches exactly one non-catch-all route.
 * `/admin/tenants` is the CONTROL: a real route that lives outside the shell
 * and must be rejected, proving the parser does not accept any string that
 * appears in the file.
 *
 * Mutations run before landing (both restored):
 *   - add `{ id: 'x', to: '/settings/nothing', … }` to SETTINGS_SECTIONS → red
 *     ("matches exactly one route" fails with 0 for /settings/nothing);
 *   - rename `leads/scoring` in router.tsx to `leads/scoring-rules` → red
 *     (the scoring section now matches 0 routes).
 *
 * Gating (R4/A10): only branding carries `requires`, because only the
 * branding editor hides itself today — permissions-page.tsx:53 reads `can`
 * for `canEdit` alone and stays visible; lost-reasons-page.tsx:33 gates its
 * write controls only. A `requires` on any other section is a claim the
 * target page does not make, and the last block pins the count.
 */

const ROUTER = new URL('../../app/router.tsx', import.meta.url);

function shellRoutes(): string[] {
  const source = readFileSync(ROUTER, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const shellAt = source.indexOf("path: '/',");
  expect(shellAt, "router.tsx declares the `path: '/'` shell").toBeGreaterThan(-1);
  const childrenAt = source.indexOf('children: [', shellAt);
  expect(childrenAt).toBeGreaterThan(shellAt);
  // Bracket-match the children array so the parse stops at the shell's end.
  let depth = 0;
  let end = -1;
  for (let i = childrenAt + 'children: '.length; i < source.length; i++) {
    const ch = source[i];
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  expect(end).toBeGreaterThan(childrenAt);
  const block = source.slice(childrenAt, end);
  return [...block.matchAll(/path:\s*'([^']*)'/g)].map((m) => m[1] ?? '').filter((p) => p !== '*');
}

const matches = (routes: string[], to: string) => routes.filter((r) => r === to.replace(/^\//, '')).length;

describe('settings index — every link is a route under the `/` shell', () => {
  const routes = shellRoutes();

  it('parses a non-trivial shell', () => {
    expect(routes.length).toBeGreaterThan(20);
    expect(routes).toContain('leads/scoring');
    expect(routes).not.toContain('tenants');
  });

  it.each(SETTINGS_SECTIONS.map((s) => [s.id, s.to] as const))('%s → %s matches exactly one route', (_id, to) => {
    expect(matches(routes, to)).toBe(1);
  });

  it('CONTROL: /admin/tenants is a real route outside the shell and is rejected', () => {
    expect(readFileSync(ROUTER, 'utf8')).toContain("path: 'tenants'");
    expect(matches(routes, '/admin/tenants')).toBe(0);
    expect(matches(routes, '/settings/nothing')).toBe(0);
  });
});

describe('settings index — labels are the target pages\' own titles (A9, verbatim)', () => {
  const label = (key: string) => {
    const [ns, k] = key.split(':') as [keyof typeof frCA, string];
    return (frCA[ns] as Record<string, string>)[k];
  };

  it('resolves through fr-CA to the exact strings the e2e asserts', () => {
    expect(SETTINGS_SECTIONS.map((s) => label(s.labelKey))).toEqual([
      'Succursales',
      'Automatisations',
      'Image de marque',
      'Règles de pointage',
      'Règles d’assignation',
      'Raisons de perte',
      'Connecteurs de prospects',
      'Horaires de travail',
      'Rôles et permissions',
      'Sécurité du compte',
    ]);
  });

  it('every desc key exists in fr-CA settings', () => {
    for (const s of SETTINGS_SECTIONS) {
      expect((frCA.settings as Record<string, string>)[s.descKey], s.descKey).toBeTruthy();
    }
  });
});

describe('settings index — visibleSections mirrors the target pages', () => {
  const ORG = '22222222-2222-4222-8222-222222222222';
  const ids = (mine: Set<PermissionT> | undefined, orgId: string | undefined) => visibleSections(mine, orgId).map((s) => s.id);

  it('an empty permission set sees nine sections — everything but branding, in render order', () => {
    expect(ids(new Set(), ORG)).toEqual([
      'stores',
      'automations',
      'scoring',
      'assignment',
      'lost_reasons',
      'connectors',
      'schedules',
      'permissions',
      'security',
    ]);
    expect(ids(undefined, ORG)).toHaveLength(9);
  });

  it('organization:update alone adds branding (ten), with the org id in its href', () => {
    const visible = visibleSections(new Set<PermissionT>(['organization:update']), ORG);
    expect(visible.map((s) => s.id)).toHaveLength(10);
    const branding = visible.find((s) => s.id === 'branding');
    expect(branding && sectionHref(branding, ORG)).toBe(`/organizations/${ORG}/branding`);
  });

  it('no orgId drops branding even for a holder — the link needs a record to hang on', () => {
    expect(ids(new Set<PermissionT>(['organization:update']), undefined)).not.toContain('branding');
    expect(ids(new Set<PermissionT>(['organization:update']), undefined)).toHaveLength(9);
  });

  it('only branding is gated (a gate on a page that does not hide itself is a false claim)', () => {
    expect(SETTINGS_SECTIONS.filter((s) => s.requires !== undefined).map((s) => s.id)).toEqual(['branding']);
  });
});
