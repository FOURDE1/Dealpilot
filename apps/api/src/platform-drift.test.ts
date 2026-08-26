import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool, ensureTestDatabase, reset, testAdminUrl, type Pool } from '@dealpilot/db';
import {
  ActivityActorType,
  PLATFORM_CAPABILITY_NAMES,
  PLATFORM_ROLES,
  PlanTier,
  ROLES,
} from '@dealpilot/schemas';
import { apiV1 as contract } from '@dealpilot/contracts';

/**
 * F-69 — the platform console's lockstep guards (the dead-vocabulary rule,
 * applied to the platform side):
 *  - every admin endpoint starts with a capability check, never a role;
 *  - every declared capability is enforced somewhere;
 *  - the route file never opens tenant context;
 *  - the SQL vocabularies (platform roles, actor types, plan codes) equal
 *    the Zod ones.
 */

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', '..', '..', 'packages', 'db', 'migrations');
const ADMIN_URL = testAdminUrl();
/** Every route file that serves /api/v1/admin/ — this guard owns the list (F-70). */
const ADMIN_ROUTE_FILES = ['f69-admin-routes.ts', 'f70-provisioning-routes.ts'];
const source = ADMIN_ROUTE_FILES.map((f) => readFileSync(join(here, f), 'utf8')).join('\n');

let admin: Pool;
let dbUp = false;

function adminPaths(node: unknown, found: Set<string> = new Set()): Set<string> {
  if (!node || typeof node !== 'object') return found;
  const record = node as Record<string, unknown>;
  if (typeof record['path'] === 'string' && typeof record['method'] === 'string') {
    found.add(`${String(record['method'])} ${String(record['path'])}`);
    return found;
  }
  for (const value of Object.values(record)) adminPaths(value, found);
  return found;
}

async function checkValues(table: string, column: string): Promise<string[]> {
  const r = await admin.query<{ def: string }>(
    `SELECT pg_get_constraintdef(con.oid) AS def
     FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
     WHERE c.relname = $1 AND con.contype = 'c' AND pg_get_constraintdef(con.oid) LIKE '%' || $2 || '%'`,
    [table, column],
  );
  const def = r.rows.map((x) => x.def).find((d) => d.includes('ANY')) ?? '';
  return [...def.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]!).sort();
}

beforeAll(async () => {
  await ensureTestDatabase();
  admin = createPool({ connectionString: ADMIN_URL, max: 2 });
  try {
    await admin.query('SELECT 1');
    dbUp = true;
  } catch {
    if (process.env['RLS_REQUIRED']) throw new Error('RLS_REQUIRED set but database unreachable');
    return;
  }
  await reset(admin, migrationsDir, ADMIN_URL);
});

afterAll(async () => {
  await admin?.end();
});

describe('platform drift (F-69)', () => {
  it('every admin endpoint except /me asks for a capability, and every capability is asked for', () => {
    const handlers = source.match(/app\.(get|post|patch|delete)\('\/api\/v1\/admin\//g) ?? [];
    const checks = [...source.matchAll(/requirePlatform\(request, '([a-z_]+:[a-z_]+)'\)/g)].map((m) => m[1]!);
    // /me reads what the gate already established; every other handler checks.
    expect(checks.length).toBeGreaterThanOrEqual(handlers.length - 1);
    for (const cap of PLATFORM_CAPABILITY_NAMES) {
      expect(checks, `capability nothing enforces: ${cap}`).toContain(cap);
    }
    for (const cap of new Set(checks)) {
      expect(PLATFORM_CAPABILITY_NAMES as readonly string[], `asked for but undeclared: ${cap}`).toContain(cap);
    }
    // The contract and the file agree on the surface.
    const declared = [...adminPaths(contract.admin)].length;
    expect(handlers.length).toBe(declared);
  });

  it('every route file that serves an admin path is on this guard’s list', () => {
    // A new admin route file that silently escaped the guard would be the
    // worse blind spot: the list is asserted, not trusted.
    const escaped = readdirSync(here)
      .filter((f) => /^f\d+.*routes\.ts$/.test(f) && readFileSync(join(here, f), 'utf8').includes("'/api/v1/admin/"))
      .filter((f) => !ADMIN_ROUTE_FILES.includes(f));
    expect(escaped, 'admin route files the drift guard does not scan').toEqual([]);
    for (const f of ADMIN_ROUTE_FILES) expect(readFileSync(join(here, f), 'utf8')).toContain("'/api/v1/admin/");
  });

  it('the route file never opens tenant context and never names a tenant role', () => {
    expect(source).not.toMatch(/withTenant|withUser|withContext|requirePermission\(|hasPermission\(/);
    for (const role of ROLES) expect(source, `tenant role literal '${role}' in the admin routes`).not.toContain(`'${role}'`);
  });

  it('SQL and Zod agree on the platform vocabularies', async (ctx) => {
    if (!dbUp) return ctx.skip();
    expect(await checkValues('platform_staff', 'role')).toEqual([...PLATFORM_ROLES].sort());
    expect(await checkValues('activity_events', 'actor_type')).toEqual([...ActivityActorType.options].sort());
    const seeded = await admin.query<{ code: string }>('SELECT code FROM plans ORDER BY code');
    expect(seeded.rows.map((r) => r.code)).toEqual([...PlanTier.options].sort());
  });

  it('the app role holds no grant on the privilege tables and cannot reprice a plan', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const grants = await admin.query<{ table_name: string; privilege_type: string }>(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
       WHERE grantee = 'dealpilot_app' AND table_name IN ('platform_staff','platform_audit_events','plans')`,
    );
    expect(grants.rows.filter((g) => g.table_name !== 'plans')).toEqual([]);
    expect(grants.rows.filter((g) => g.table_name === 'plans').map((g) => g.privilege_type)).toEqual(['SELECT']);
    // The actor check is internal: the app role cannot even call it.
    const exec = await admin.query<{ ok: boolean }>(
      `SELECT has_function_privilege('dealpilot_app', 'platform_assert_actor(uuid, text[])', 'EXECUTE') AS ok`,
    );
    expect(exec.rows[0]!.ok).toBe(false);
  });
});
