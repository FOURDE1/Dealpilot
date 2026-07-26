import { describe, expect, it } from 'vitest';
import { PERMISSIONS } from '@dealpilot/schemas';
import { GROUPS } from './permissions-page.js';

/**
 * The matrix screen filters permissions by GROUP prefix — a permission whose
 * prefix matches no group silently disappears from the only screen that can
 * grant it. F-13 shipped `document:*` and proved this can happen; this guard
 * makes the next new vocabulary a test failure instead of an invisible hole.
 */
describe('permission group coverage', () => {
  it('every permission belongs to exactly one group', () => {
    for (const p of PERMISSIONS) {
      const homes = GROUPS.filter((g) => g.prefixes.some((pre) => p.startsWith(pre)));
      expect(homes.map((g) => g.key), `permission ${p} must appear in exactly one group`).toHaveLength(1);
    }
  });
});
