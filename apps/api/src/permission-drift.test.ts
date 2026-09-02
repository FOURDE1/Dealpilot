import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, ROLES } from '@dealpilot/schemas';

/**
 * A-13 drift guard (owner decision D-033).
 *
 * The point of the catalogue is that "what can a BDC agent do?" has ONE answer,
 * readable in one place and editable on a screen. That holds only while routes
 * ask the catalogue instead of carrying their own role lists — which is exactly
 * what they all did before, spread across thirty call sites.
 *
 * This fails the build the moment one starts again.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

/**
 * Two places legitimately reason about roles as DATA rather than using them to
 * decide access. Each is registered with why, so adding a third is a deliberate
 * act and not a slide back to the old world.
 */
const ROLE_LOGIC_ALLOWED: Record<string, string> = {
  'f04-members-routes.ts:assertGrantable':
    'The privilege ceiling: you cannot grant a role you do not hold yourself. That is a rule ABOUT roles — a permission cannot express it, and without it a gm could mint themselves an owner.',
  'f04-members-routes.ts:last-owner':
    'An organization must keep one active owner. Inherently about the owner role, not about what anyone may do.',
};

async function routeSources(): Promise<{ file: string; text: string }[]> {
  const files = (await readdir(SRC)).filter((f) => /^f\d+.*routes\.ts$/.test(f));
  return Promise.all(files.map(async (f) => ({ file: f, text: await readFile(join(SRC, f), 'utf8') })));
}

describe('permission drift', () => {
  it('no route decides access from a role name', async () => {
    const offenders: string[] = [];
    for (const { file, text } of await routeSources()) {
      text.split('\n').forEach((line, i) => {
        // `requireMember(c, id)` proves membership and is fine — it is the
        // ROLE-carrying form that puts an access rule back in a route file.
        if (/requireMember\([^)]*,[^)]*,/.test(line)) {
          offenders.push(`${file}:${i + 1} — requireMember with a role list`);
        }
        // Or a bare role literal used in a decision — unless this is one of the
        // two registered places that reason about roles as data.
        const registered =
          file === 'f04-members-routes.ts' &&
          (/actorRoles\.includes\('owner'\)/.test(line) || /input\.roles.*includes\('owner'\)/.test(line));
        if (registered) return;
        for (const role of ROLES) {
          if (new RegExp(`'${role}'`).test(line) && /includes|some\(|===|ROLES/.test(line)) {
            offenders.push(`${file}:${i + 1} — decides on the role '${role}'`);
          }
        }
      });
    }
    void ROLE_LOGIC_ALLOWED;
    expect(
      offenders,
      `These decide access from a role instead of a permission, so the matrix stops being the truth and no screen can show what a role can do. Use requirePermission(c, userId, '<permission>'):\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('every permission the routes ask for exists in the catalogue', async () => {
    const used = new Set<string>();
    for (const { text } of await routeSources()) {
      for (const line of text.split(String.fromCharCode(10))) {
        if (!/(?:requirePermission|hasPermission)\(/.test(line)) continue;
        // A ternary third argument is still a call site: `? 'a' : 'b'`.
        for (const m of line.matchAll(/'([a-z_]+:[a-z_]+)'/g)) used.add(m[1]!);
      }
    }
    const unknown = [...used].filter((p) => !(PERMISSIONS as readonly string[]).includes(p));
    expect(unknown, `asked for but not in the catalogue: ${unknown.join(', ')}`).toEqual([]);
    // And the catalogue is not a wish list: it must be doing work.
    expect(used.size).toBeGreaterThan(15);
  });

  it('every catalogued permission is actually enforced somewhere', async () => {
    const used = new Set<string>();
    for (const { text } of await routeSources()) {
      for (const line of text.split(String.fromCharCode(10))) {
        // Enforcement wears two shapes: the gate functions, and a JOIN
        // against the matrix itself (rp.permission = '…' — FR-TEN-006's
        // store-scoped cost view was real enforcement this detector missed).
        const gate = /(?:requirePermission|hasPermission)\(/.test(line);
        const matrixJoin = /rp\.permission = '/.test(line);
        if (!gate && !matrixJoin) continue;
        for (const m of line.matchAll(/'([a-z_]+:[a-z_]+)'/g)) used.add(m[1]!);
      }
    }
    // A permission nothing checks is a promise on the settings screen that the
    // server does not keep — an owner would switch it off and change nothing.
    const dead = PERMISSIONS.filter((p) => !used.has(p) && p !== 'member:read');
    expect(dead, `in the catalogue but never enforced: ${dead.join(', ')}`).toEqual([]);
  });

  it('every role has defaults, and only the owner has everything', async () => {
    for (const role of ROLES) {
      expect(DEFAULT_ROLE_PERMISSIONS[role], `${role} has no defaults`).toBeDefined();
    }
    expect(DEFAULT_ROLE_PERMISSIONS['owner']).toHaveLength(PERMISSIONS.length);
    // If a second role quietly held everything, the matrix would be decoration.
    const others = ROLES.filter((r) => r !== 'owner' && DEFAULT_ROLE_PERMISSIONS[r]?.length === PERMISSIONS.length);
    expect(others, `these roles default to EVERY permission: ${others.join(', ')}`).toEqual([]);
  });

  it('the dangerous permissions are not handed out by default', async () => {
    // The ones that move money, change authority, or erase a tenant.
    const dangerous = [
      'organization:delete', 'pay_plan:write', 'commission:read_all',
      // F-79: confirming a clawback writes a money line against someone's pay.
      'commission:clawback',
      'member:update_roles', 'checklist:sign_safety', 'checklist:correct_delivered',
      'intake_key:manage', 'document:sign',
    ] as const;
    const floorRoles = ['salesperson', 'bdc_agent', 'logistics', 'wholesale_manager'] as const;
    for (const role of floorRoles) {
      for (const p of dangerous) {
        expect(
          DEFAULT_ROLE_PERMISSIONS[role]?.includes(p),
          `${role} must not default to ${p}`,
        ).toBeFalsy();
      }
    }
  });
});
