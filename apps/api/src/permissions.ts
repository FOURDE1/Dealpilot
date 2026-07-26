import type { PoolClient } from '@dealpilot/db';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, type PermissionT } from '@dealpilot/schemas';
import { AppError, notFound } from './errors.js';

/**
 * A-13 / D-033 — enforcement.
 *
 * One question, asked one way: may this person do this thing here? The answer
 * comes from the org's matrix (seeded from the catalogue's defaults, editable
 * per organization) with a per-user override on top.
 *
 * Routes call `requirePermission`. They do not carry role lists — the drift
 * test fails the build if one starts to.
 */

/**
 * Membership gate, kept from `requireMember`: the caller must hold an ACTIVE
 * membership in a LIVE organization. A cross-tenant or revoked caller gets 404
 * and learns nothing about whether the thing exists.
 */
async function assertLiveMember(client: PoolClient, userId: string): Promise<void> {
  const r = await client.query(
    `SELECT 1 FROM memberships m
     JOIN organizations o ON o.id = m.organization_id AND o.deleted_at IS NULL
     WHERE m.user_id = $1
       AND m.organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid
       AND m.status = 'active'`,
    [userId],
  );
  if (r.rows.length === 0) throw notFound();
}

/**
 * The gate. 404 when the caller has no business here at all, 403 when they are
 * a real colleague who simply may not do this — the distinction matters,
 * because the second is a conversation with their manager and the first is not
 * a conversation at all.
 */
export async function requirePermission(
  client: PoolClient,
  userId: string,
  permission: PermissionT,
): Promise<void> {
  await assertLiveMember(client, userId);
  const r = await client.query<{ ok: boolean }>(
    `SELECT has_permission(
       NULLIF(current_setting('app.org_id', true), '')::uuid, $1, $2) AS ok`,
    [userId, permission],
  );
  if (!r.rows[0]?.ok) {
    throw new AppError(403, 'forbidden', 'Your role does not allow this', [
      { path: 'permission', code: 'forbidden', message: permission },
    ]);
  }
}

/** Same question, without throwing — for deciding how much of a list to show. */
export async function hasPermission(
  client: PoolClient,
  userId: string,
  permission: PermissionT,
): Promise<boolean> {
  const r = await client.query<{ ok: boolean }>(
    `SELECT has_permission(
       NULLIF(current_setting('app.org_id', true), '')::uuid, $1, $2) AS ok`,
    [userId, permission],
  );
  return r.rows[0]?.ok === true;
}

/**
 * Seed a brand-new organization's matrix from the catalogue defaults. Called in
 * the same transaction that creates the org, so there is never a moment where
 * an organization exists with nobody able to do anything.
 */
export async function seedPermissions(client: PoolClient, orgId: string): Promise<void> {
  const rows: string[] = [];
  const params: unknown[] = [orgId];
  for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    for (const p of perms) {
      params.push(role, p);
      rows.push(`($1, $${params.length - 1}, $${params.length})`);
    }
  }
  await client.query(
    `INSERT INTO role_permissions (organization_id, role, permission)
     VALUES ${rows.join(', ')}
     ON CONFLICT DO NOTHING`,
    params,
  );
}

/** The whole matrix, for the settings screen. */
export async function readMatrix(client: PoolClient, orgId: string) {
  const r = await client.query<{ role: string; permission: string }>(
    `SELECT role, permission FROM role_permissions
     WHERE organization_id = $1 AND allowed ORDER BY role, permission`,
    [orgId],
  );
  const matrix: Record<string, string[]> = {};
  for (const row of r.rows) (matrix[row.role] ??= []).push(row.permission);
  return { permissions: [...PERMISSIONS], roles: Object.keys(DEFAULT_ROLE_PERMISSIONS), matrix };
}
