import { afterAll, beforeAll, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, type Pool } from './index.js';

/**
 * F-69 — every SECURITY DEFINER function reads tenant tables as its OWNER,
 * and FORCE RLS applies to owners: only a superuser or a BYPASSRLS role sees
 * through it. Locally the migration role is a superuser; on RDS it MUST hold
 * BYPASSRLS (docs/SECURITY.md). This guard makes the dependency visible
 * wherever the suite runs, instead of failing silently as "zero rows" in
 * production.
 */

const ADMIN_URL = testAdminUrl();
const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');

let admin: Pool;
let dbUp = false;

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

it('every SECURITY DEFINER function is owned by a role that can see through FORCE RLS', async (ctx) => {
  if (!dbUp) return ctx.skip();
  const r = await admin.query<{ name: string; owner: string; rolsuper: boolean; rolbypassrls: boolean }>(
    `SELECT p.proname AS name, r.rolname AS owner, r.rolsuper, r.rolbypassrls
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     JOIN pg_roles r ON r.oid = p.proowner
     WHERE n.nspname = 'public' AND p.prosecdef`,
  );
  expect(r.rows.length, 'no SECURITY DEFINER functions parsed — the query has drifted').toBeGreaterThan(5);
  const blind = r.rows.filter((f) => !f.rolsuper && !f.rolbypassrls);
  expect(
    blind.map((f) => `${f.name} (owner ${f.owner})`),
    'these definers would see ZERO tenant rows under FORCE RLS — grant BYPASSRLS to the migration role',
  ).toEqual([]);
});

it('the platform register is append-only even for its owner', async (ctx) => {
  if (!dbUp) return ctx.skip();
  await admin.query(`INSERT INTO platform_audit_events (actor_user_id, actor_type, event, changes) VALUES (NULL, 'system', 'staff.granted', '{}')`);
  await expect(admin.query(`UPDATE platform_audit_events SET reason = 'x'`)).rejects.toMatchObject({ code: 'PA000' });
  await expect(admin.query(`DELETE FROM platform_audit_events`)).rejects.toMatchObject({ code: 'PA000' });
});
