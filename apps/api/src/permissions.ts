import type { PoolClient } from '@dealpilot/db';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, type PermissionT } from '@dealpilot/schemas';
import { AppError, notFound } from './errors.js';
import { refuseByStatus } from './tenant-status.js';

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
  const r = await client.query<{ status: string }>(
    `SELECT o.status FROM memberships m
     JOIN organizations o ON o.id = m.organization_id AND o.deleted_at IS NULL
     WHERE m.user_id = $1
       AND m.organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid
       AND m.status = 'active'`,
    [userId],
  );
  if (r.rows.length === 0) throw notFound();
  // F-69: the tenant's lifecycle decides before the permission does — a
  // suspended owner hears "suspended", not "forbidden" or an MFA nag.
  refuseByStatus(r.rows[0]!.status);
}

/**
 * Permissions whose EXERCISE demands an enrolled second factor when the
 * caller's roles require one (F-41 slice 2, FR-AUTH-006). The set is the
 * blast-radius list: change who can do what, change the org itself, mint a
 * standing credential. Everyday lead/deal work is deliberately absent — the
 * policy binds the powers that could remove the policy.
 */
let MFA_ENFORCED = false;

/**
 * Flipped once at boot from env.REQUIRE_MFA (buildApp). A module switch rather
 * than threading env through every requirePermission call site — the value is
 * process-constant, and fifty signatures changing for one boolean is the
 * wrong trade.
 */
export function setMfaEnforcement(on: boolean): void {
  MFA_ENFORCED = on;
}

// Typed against the catalogue: a misspelled entry here is a COMPILE error, not
// a permission that silently gates nothing (the dead-vocabulary pattern).
const MFA_BOUND_PERMISSIONS: ReadonlySet<PermissionT> = new Set<PermissionT>([
  'organization:update',
  'organization:delete',
  'member:update_roles',
  'member:revoke',
  'intake_key:manage',
]);

/**
 * The gate. 404 when the caller has no business here at all, 403 when they are
 * a real colleague who simply may not do this — the distinction matters,
 * because the second is a conversation with their manager and the first is not
 * a conversation at all.
 *
 * A third refusal since F-41: 403 `mfa_enrolment_required` when the caller
 * HOLDS the permission but their role requires a second factor they have not
 * enrolled. Without this, "required" was a banner — an owner could ignore the
 * nag forever and keep wielding every privileged power. The remedy is named:
 * enrol at /security, and the door opens.
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
  if (MFA_ENFORCED && MFA_BOUND_PERMISSIONS.has(permission)) {
    const mfa = await client.query<{ required: boolean; enabled: boolean | null }>(
      // $1 feeds both memberships.user_id (uuid) and Better Auth "user".id
      // (text) — cast BOTH uses or the parameter's inferred type collides
      // (42883 text = uuid; this test suite found it).
      `SELECT
         EXISTS (
           SELECT 1 FROM memberships
            WHERE user_id = $1::uuid AND status = 'active'
              AND roles && ARRAY['owner','gm','admin_office']::text[]
         ) AS required,
         (SELECT "twoFactorEnabled" FROM "user" WHERE id = $1::text) AS enabled`,
      [userId],
    );
    if (mfa.rows[0]?.required === true && mfa.rows[0].enabled !== true) {
      throw new AppError(403, 'mfa_enrolment_required', 'Enable two-factor authentication first', [
        { path: 'permission', code: 'mfa_enrolment_required', message: 'Your role requires a second factor before this action — enrol at /security' },
      ]);
    }
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

/**
 * The whole matrix, plus a version per role.
 *
 * The version is the newest `updated_at` in that role's rows. Saving a role
 * rewrites all of them, so any change moves it — which is exactly what a second
 * admin's stale save needs to collide with (CR-10).
 */
export async function readMatrix(client: PoolClient, orgId: string) {
  const r = await client.query<{ role: string; permission: string; v: string }>(
    `SELECT role, permission, updated_at::text AS v FROM role_permissions
     WHERE organization_id = $1 AND allowed ORDER BY role, permission`,
    [orgId],
  );
  const matrix: Record<string, string[]> = {};
  const versions: Record<string, string> = {};
  for (const row of r.rows) {
    (matrix[row.role] ??= []).push(row.permission);
    if (!versions[row.role] || row.v > versions[row.role]!) versions[row.role] = row.v;
  }
  // A role with nothing granted still needs a version to save against.
  for (const role of Object.keys(DEFAULT_ROLE_PERMISSIONS)) versions[role] ??= 'empty';
  return {
    permissions: [...PERMISSIONS],
    roles: Object.keys(DEFAULT_ROLE_PERMISSIONS),
    matrix,
    versions,
  };
}

/** The current version of one role, for the compare-and-swap on save. */
export async function roleVersion(client: PoolClient, orgId: string, role: string): Promise<string> {
  const r = await client.query<{ v: string | null }>(
    `SELECT max(updated_at)::text AS v FROM role_permissions
     WHERE organization_id = $1 AND role = $2 AND allowed`,
    [orgId, role],
  );
  return r.rows[0]?.v ?? 'empty';
}
