import type { FastifyInstance } from 'fastify';
import { withTenant, withUser, type Pool } from '@dealpilot/db';
import {
  UpdateRolePermissionsInput,
  UpdateUserPermissionInput,
  type PermissionT,
} from '@dealpilot/schemas';
import { AppError, notFound, parseOrThrow } from './errors.js';
import { requireMember, sessionUser } from './f01-routes.js';
import { readMatrix, requirePermission } from './permissions.js';
import { recordEvent } from './activity.js';

/**
 * A-13 — the matrix, as an API (owner decision D-033).
 *
 * "For each role what it can do of actions" needs to be something the owner can
 * SEE and CHANGE, not something only the code knows. This is what Hussein's
 * settings screen reads and writes.
 *
 * Changing who can do what is itself one of the most consequential actions in
 * the product, so it is owner/GM only and every change lands in the audit trail.
 */
export function registerA13Routes(app: FastifyInstance, pool: Pool): void {
  /**
   * The whole matrix in one call: every permission, every role, and what each
   * role currently holds. Readable by any member — knowing the rules is not the
   * same as being able to change them, and a salesperson who cannot see why
   * something is refused just files a support ticket.
   */
  app.get('/api/v1/permissions', async (request, reply) => {
    const user = sessionUser(request);
    const orgId = await resolveOrg(pool, user.id, (request.query as { organization_id?: string }).organization_id);
    const matrix = await withTenant(pool, orgId, async (c) => {
      await requireMember(c, user.id);
      return readMatrix(c, orgId);
    });
    return reply.send(matrix);
  });

  /** Replace one role's permissions. The list is complete: absent = revoked. */
  app.put('/api/v1/permissions/role', async (request, reply) => {
    const input = parseOrThrow(UpdateRolePermissionsInput, request.body);
    const user = sessionUser(request);

    const result = await withTenant(pool, input.organization_id, async (c) => {
      // Changing who can do what is the most consequential edit in the product.
      await requirePermission(c, user.id, 'member:update_roles');

      // An owner who can no longer change permissions cannot undo a mistake —
      // there would be no way back without a database console.
      if (input.role === 'owner' && !input.permissions.includes('member:update_roles')) {
        throw new AppError(422, 'would_lock_out', 'The owner role must keep the ability to change permissions', [
          {
            path: 'permissions',
            code: 'would_lock_out',
            message: 'Removing member:update_roles from owner would leave nobody able to undo it',
          },
        ]);
      }

      const before = await c.query<{ permission: string }>(
        `SELECT permission FROM role_permissions
         WHERE organization_id = $1 AND role = $2 AND allowed`,
        [input.organization_id, input.role],
      );
      const had = new Set(before.rows.map((r) => r.permission));
      const now = new Set<string>(input.permissions);

      await c.query(
        `DELETE FROM role_permissions WHERE organization_id = $1 AND role = $2`,
        [input.organization_id, input.role],
      );
      if (input.permissions.length > 0) {
        const values = input.permissions.map((_, i) => `($1, $2, $${i + 3})`).join(', ');
        await c.query(
          `INSERT INTO role_permissions (organization_id, role, permission) VALUES ${values}`,
          [input.organization_id, input.role, ...input.permissions],
        );
      }

      const granted = [...now].filter((p) => !had.has(p));
      const revoked = [...had].filter((p) => !now.has(p));
      if (granted.length > 0 || revoked.length > 0) {
        await recordEvent(c, {
          organizationId: input.organization_id,
          actorUserId: user.id,
          entityType: 'membership',
          entityId: input.organization_id,
          action: 'roles_changed',
          changes: { role: input.role, granted, revoked },
        });
      }
      return readMatrix(c, input.organization_id);
    });
    return reply.send(result);
  });

  /**
   * "Marc can also do X." Per person, and it can DENY as well as grant —
   * removing one capability from one person is otherwise only possible by
   * changing their whole role, which changes it for everyone in that role.
   */
  app.put('/api/v1/permissions/user', async (request, reply) => {
    const input = parseOrThrow(UpdateUserPermissionInput, request.body);
    const user = sessionUser(request);

    await withTenant(pool, input.organization_id, async (c) => {
      await requirePermission(c, user.id, 'member:update_roles');
      const target = await c.query(
        `SELECT 1 FROM memberships WHERE user_id = $1 AND organization_id = $2`,
        [input.user_id, input.organization_id],
      );
      if (target.rows.length === 0) throw notFound();

      if (input.allowed === null) {
        await c.query(
          `DELETE FROM user_permissions
           WHERE organization_id = $1 AND user_id = $2 AND permission = $3`,
          [input.organization_id, input.user_id, input.permission],
        );
      } else {
        await c.query(
          `INSERT INTO user_permissions
             (organization_id, user_id, permission, allowed, reason, granted_by)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (organization_id, user_id, permission)
           DO UPDATE SET allowed = EXCLUDED.allowed, reason = EXCLUDED.reason,
                         granted_by = EXCLUDED.granted_by`,
          [input.organization_id, input.user_id, input.permission, input.allowed,
           input.reason ?? null, user.id],
        );
      }

      await recordEvent(c, {
        organizationId: input.organization_id,
        actorUserId: user.id,
        entityType: 'membership',
        entityId: input.user_id,
        action: 'roles_changed',
        changes: {
          permission: input.permission,
          override: { from: null, to: input.allowed },
        },
        reason: input.reason ?? null,
      });
    });
    return reply.status(204).send();
  });

  /** What the SIGNED-IN person may do — so the UI can hide what would 403. */
  app.get('/api/v1/permissions/mine', async (request, reply) => {
    const user = sessionUser(request);
    const orgId = await resolveOrg(pool, user.id, (request.query as { organization_id?: string }).organization_id);
    const mine = await withTenant(pool, orgId, async (c) => {
      await requireMember(c, user.id);
      const r = await c.query<{ permission: string }>(
        `SELECT DISTINCT rp.permission
         FROM memberships m
         JOIN role_permissions rp
           ON rp.organization_id = m.organization_id
          AND rp.role = ANY(m.roles) AND rp.allowed
         WHERE m.organization_id = $1 AND m.user_id = $2 AND m.status = 'active'
         UNION
         SELECT permission FROM user_permissions
         WHERE organization_id = $1 AND user_id = $2 AND allowed
         EXCEPT
         SELECT permission FROM user_permissions
         WHERE organization_id = $1 AND user_id = $2 AND NOT allowed`,
        [orgId, user.id],
      );
      return r.rows.map((x) => x.permission as PermissionT);
    });
    return reply.send({ permissions: mine });
  });
}

async function resolveOrg(pool: Pool, userId: string, selector?: string): Promise<string> {
  const orgs = await withUser(pool, userId, async (c) => {
    const r = await c.query<{ organization_id: string }>(
      `SELECT DISTINCT m.organization_id FROM memberships m
       JOIN organizations o ON o.id = m.organization_id AND o.deleted_at IS NULL
       WHERE m.status = 'active'`,
    );
    return r.rows.map((x) => x.organization_id);
  });
  if (selector) {
    // A cross-tenant id must not confirm that it exists.
    if (!orgs.includes(selector)) throw notFound();
    return selector;
  }
  if (orgs.length === 0) throw notFound();
  if (orgs.length > 1) {
    throw new AppError(400, 'organization_required', 'Pass organization_id — you belong to several organizations');
  }
  return orgs[0]!;
}
