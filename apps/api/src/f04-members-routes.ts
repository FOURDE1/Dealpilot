import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { withContext, withTenant, withUser, type Pool, type PoolClient } from '@dealpilot/db';
import { AddMemberInput, MemberListQuery, UpdateMemberInput } from '@dealpilot/schemas';
import { AppError, notFound, parseOrThrow } from './errors.js';
import { recordEvent } from './activity.js';
import { callerOrgIds, conflictFrom, idParam, keysetPage, requireMember, sessionUser } from './f01-routes.js';

/**
 * F-04 team members (apiV1.members): the membership record joined to its user,
 * which is what a team screen needs. Same tenancy model as F-01/F-02: reads
 * under withUser, writes under withTenant behind the membership+role gate.
 *
 * Who may manage the team: `owner`, `gm`, `admin_office` — the spec's
 * `users:invite` holders (authentication-authorization.md §6).
 *
 * DEFERRED (recorded, not hidden): a person who already exists in ANOTHER
 * organization cannot be added here yet — RLS deliberately hides users you
 * share no org with, so the insert surfaces as a 409. Cross-org linking needs
 * an audited SECURITY DEFINER lookup, and that lookup is an email-existence
 * oracle, so it lands with the invite flow (token to the address) rather than
 * a bare email probe. Also deferred: real invitation email + acceptance
 * (members are created active); the A-11 mailer is ready for it.
 */

const MEMBER_WRITE_ROLES = ['owner', 'gm', 'admin_office'] as const;

/** membership + user, the shape the API returns. */
const MEMBER_COLUMNS = `
  m.id, m.user_id, m.organization_id, m.store_id, m.roles, m.status,
  u.email, u.name, m.created_at, m.updated_at`;

/**
 * An organization must always keep one active owner, or nobody can administer
 * it again (the org has no platform-side rescue path yet).
 */
async function assertNotLastOwner(client: PoolClient, membershipId: string): Promise<void> {
  // FOR UPDATE: two concurrent demotions must not both observe "another owner
  // exists" and leave the org with none (read-committed, review 2026-07-25).
  // The org predicate is explicit rather than relying on ambient RLS scope.
  const r = await client.query(
    `SELECT id FROM memberships
     WHERE status = 'active' AND 'owner' = ANY(roles) AND id <> $1
       AND organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid
     FOR UPDATE`,
    [membershipId],
  );
  if (r.rows.length === 0) {
    throw new AppError(422, 'last_owner', 'An organization must keep at least one active owner', [
      { path: 'roles', code: 'last_owner', message: 'Promote another owner first' },
    ]);
  }
}

/**
 * An inviter can never grant a role they do not hold themselves
 * (authentication-authorization.md §Invites). Owners may grant anything;
 * everyone else is capped by their own role set — otherwise a gm or
 * admin_office could simply mint themselves an owner.
 */
function assertGrantable(actorRoles: readonly string[], requested: readonly string[]): void {
  if (actorRoles.includes('owner')) return;
  const tooHigh = requested.filter((r) => !actorRoles.includes(r));
  if (tooHigh.length > 0) {
    throw new AppError(403, 'forbidden', 'You cannot grant a role you do not hold', [
      { path: 'roles', code: 'role_not_grantable', message: tooHigh.join(', ') },
    ]);
  }
}

/**
 * Resolve a membership's org. The user-scoped policy only exposes the CALLER's
 * own membership rows (a colleague's row is invisible), so this walks the
 * caller's own organizations and looks the id up inside each tenant context —
 * where membership_isolation exposes the whole org. Not found anywhere the
 * caller belongs → 404, never a leak.
 */
async function membershipOrg(pool: Pool, userId: string, membershipId: string): Promise<string> {
  const orgs = await withUser(pool, userId, (c) => callerOrgIds(c));
  for (const orgId of orgs) {
    const found = await withTenant(pool, orgId, async (c) => {
      const r = await c.query('SELECT 1 FROM memberships WHERE id = $1', [membershipId]);
      return r.rows.length > 0;
    });
    if (found) return orgId;
  }
  throw notFound();
}

/** The org this request targets: an explicit selector, or the caller's only org. */
async function resolveOrg(pool: Pool, userId: string, selector?: string): Promise<string> {
  if (selector) return selector;
  const orgs = await withUser(pool, userId, (c) => callerOrgIds(c));
  if (orgs.length === 0) throw notFound();
  if (orgs.length > 1) {
    throw new AppError(400, 'organization_required', 'Pass organization_id — you belong to several organizations');
  }
  return orgs[0]!;
}

export function registerF04Routes(app: FastifyInstance, pool: Pool): void {
  app.get('/api/v1/members', async (request, reply) => {
    const query = parseOrThrow(MemberListQuery, request.query);
    const user = sessionUser(request);
    const orgId = await resolveOrg(pool, user.id, query.organization_id);
    // DUAL context: colleagues' user rows are visible only through the
    // org-keyed user_read policy (app.org_id); the user GUC alone shows just
    // yourself. requireMember re-proves membership inside this same
    // transaction, so setting the org key grants nothing on its own.
    const page = await withContext(pool, { orgId, userId: user.id }, async (c) => {
      await requireMember(c, user.id);
      const params: unknown[] = [orgId];
      let where = `m.organization_id = $1`;
      if (query.status) {
        params.push(query.status);
        where += ` AND m.status = $${params.length}`;
      } else {
        where += ` AND m.status <> 'revoked'`;
      }
      return keysetPage(
        c,
        `SELECT ${MEMBER_COLUMNS} FROM memberships m
         JOIN users u ON u.id = m.user_id
         WHERE ${where}`,
        params,
        query,
        'm',
      );
    });
    return reply.send(page);
  });

  app.post('/api/v1/members', async (request, reply) => {
    const input = parseOrThrow(AddMemberInput, request.body);
    const actor = sessionUser(request);
    const newUserId = randomUUID();
    try {
      const member = await withTenant(pool, input.organization_id, async (c) => {
        const actorRoles = await requireMember(c, actor.id, MEMBER_WRITE_ROLES);
        assertGrantable(actorRoles, input.roles);
        if (input.store_id) await assertStoreInOrg(c, input.store_id);
        // HO-06: adding someone who is ALREADY in this org (typically a
        // revoked colleague) reinstates them instead of colliding on the
        // platform-unique email — removing a person must never be a one-way
        // door. Same-org identities are visible at any status (migration 0007).
        const existing = await c.query<{ id: string; status: string; roles: string[] }>(
          `SELECT m.id, m.status, m.roles FROM memberships m JOIN users u ON u.id = m.user_id
           WHERE lower(u.email) = lower($1) AND m.store_id IS NOT DISTINCT FROM $2
           LIMIT 1`,
          [input.email, input.store_id ?? null],
        );
        if (existing.rows.length > 0) {
          const target = existing.rows[0]!;
          // SECURITY (HO-09): only a REVOKED/INVITED membership may be revived
          // this way. Matching an ACTIVE one used to rewrite it, so typing the
          // sole owner's address into the add form silently demoted them and
          // could leave the org with no owner at all.
          if (target.status === 'active') {
            throw new AppError(409, 'conflict', 'This person is already on the team', [
              { path: 'email', code: 'already_member', message: 'Change their roles from the team list instead' },
            ]);
          }
          // Reviving someone who outranks you is an escalation just like
          // granting the role directly.
          assertGrantable(actorRoles, target.roles);
          const reinstated = await c.query<Record<string, unknown>>(
            `UPDATE memberships SET status = 'active', roles = $2 WHERE id = $1 RETURNING *`,
            [target.id, input.roles],
          );
          // CR-01: the UI shows a distinct notice for a revive vs a new person.
          await recordEvent(c, {
            organizationId: input.organization_id,
            actorUserId: actor.id,
            entityType: 'membership',
            entityId: String(reinstated.rows[0]!['id']),
            action: 'reinstated',
            changes: {
              status: { from: target.status, to: 'active' },
              roles: { from: target.roles, to: input.roles },
            },
          });
          return { ...reinstated.rows[0], email: input.email, name: input.name, reinstated: true };
        }

        // App-generated id: INSERT..RETURNING on users cannot pass the SELECT
        // policy before the membership exists (proven in A-04/D-022).
        await c.query(
          `INSERT INTO users (id, email, name, status) VALUES ($1, $2, $3, 'active')`,
          [newUserId, input.email, input.name],
        );
        // Separate statement, then compose: within ONE statement the new
        // membership is not yet visible to the users SELECT policy (it keys on
        // an ACTIVE membership), so a CTE + JOIN users returns zero rows.
        const r = await c.query<Record<string, unknown>>(
          `INSERT INTO memberships (user_id, organization_id, store_id, roles, status)
           VALUES ($1, $2, $3, $4, 'active') RETURNING *`,
          [newUserId, input.organization_id, input.store_id ?? null, input.roles],
        );
        await recordEvent(c, {
          organizationId: input.organization_id,
          storeId: input.store_id ?? null,
          actorUserId: actor.id,
          entityType: 'membership',
          entityId: String(r.rows[0]!['id']),
          action: 'created',
          changes: { roles: { from: null, to: input.roles } },
        });
        return { ...r.rows[0], email: input.email, name: input.name };
      });
      return await reply.status(201).send(member);
    } catch (err) {
      throw conflictFrom(err) ?? err;
    }
  });

  app.patch('/api/v1/members/:id', async (request, reply) => {
    const membershipId = idParam(request);
    const input = parseOrThrow(UpdateMemberInput, request.body);
    const actor = sessionUser(request);
    const orgId = await membershipOrg(pool, actor.id, membershipId);
    try {
      const member = await withTenant(pool, orgId, async (c) => {
        const actorRoles = await requireMember(c, actor.id, MEMBER_WRITE_ROLES);
        if (input.roles) assertGrantable(actorRoles, input.roles);
        if (input.store_id) await assertStoreInOrg(c, input.store_id);

          // SECURITY (HO-09): re-activating someone is as powerful as granting
        // their roles — a gm must not be able to revive a revoked owner.
        if (input.status === 'active') {
          const target = await c.query<{ roles: string[] }>(
            `SELECT roles FROM memberships WHERE id = $1`,
            [membershipId],
          );
          if (target.rows[0]) assertGrantable(actorRoles, target.rows[0].roles);
        }

        // Losing owner rights or being revoked both risk orphaning the org.
        const losesOwner =
          (input.roles !== undefined && !input.roles.includes('owner')) ||
          (input.status !== undefined && input.status !== 'active');
        if (losesOwner) {
          const current = await c.query<{ is_owner: boolean }>(
            `SELECT 'owner' = ANY(roles) AND status = 'active' AS is_owner FROM memberships WHERE id = $1`,
            [membershipId],
          );
          if (current.rows[0]?.is_owner) await assertNotLastOwner(c, membershipId);
        }

        // Identity read (0007 keeps same-org users visible at any membership
        // status, so revoked members can still be listed and reinstated).
        const before = await c.query<{ email: string; name: string; roles: string[]; status: string; store_id: string | null }>(
          `SELECT u.email, u.name, m.roles, m.status, m.store_id
           FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.id = $1`,
          [membershipId],
        );
        if (before.rows.length === 0) throw notFound();
        const prior = before.rows[0]!;
        const identity = { email: prior.email, name: prior.name };

        const fields = Object.entries(input);
        if (fields.length === 0) {
          const r = await c.query<Record<string, unknown>>(`SELECT * FROM memberships WHERE id = $1`, [membershipId]);
        if (r.rows.length === 0) throw notFound();
        return { ...r.rows[0], ...identity };
      }
      const sets = fields.map(([k], i) => `${k} = $${i + 2}`).join(', ');
      const r = await c.query<Record<string, unknown>>(
        `UPDATE memberships SET ${sets} WHERE id = $1 RETURNING *`,
        [membershipId, ...fields.map(([, v]) => v)],
      );
        if (r.rows.length === 0) throw notFound();

        // Someone who is no longer on the team cannot own work: their leads
        // return to the pool rather than pointing at a person nobody can see
        // (review 2026-07-25). Same transaction, so no lead is ever left
        // assigned to a revoked member.
        if (input.status && input.status !== 'active') {
          const released = await c.query<{ id: string }>(
            `UPDATE leads
             SET assigned_to = NULL,
                 status = CASE WHEN status = 'assigned' THEN 'new' ELSE status END
             WHERE assigned_to = $1 AND deleted_at IS NULL
             RETURNING id`,
            [r.rows[0]!['user_id'] as string],
          );
          // Each lead really did change hands. One event per lead, so the trail
          // answers "why did this become unassigned?" at the lead, not only at
          // the membership — capped by however many that person held.
          for (const lead of released.rows) {
            await recordEvent(c, {
              organizationId: orgId,
              actorUserId: actor.id,
              entityType: 'lead',
              entityId: lead.id,
              action: 'unassigned',
              changes: { assigned_to: { from: r.rows[0]!['user_id'], to: null } },
              reason: 'Member revoked',
            });
          }
        }

        // F-10: who changed someone's authority, and when. A role grant is the
        // single most security-relevant edit in the product, so it is the last
        // one that should be reconstructable only from memory.
        if (input.roles && String(prior.roles) !== String(input.roles)) {
          await recordEvent(c, {
            organizationId: orgId,
            actorUserId: actor.id,
            entityType: 'membership',
            entityId: membershipId,
            action: 'roles_changed',
            changes: { roles: { from: prior.roles, to: input.roles } },
          });
        }
        if (input.store_id !== undefined && input.store_id !== prior.store_id) {
          await recordEvent(c, {
            organizationId: orgId,
            actorUserId: actor.id,
            entityType: 'membership',
            entityId: membershipId,
            action: 'updated',
            changes: { store_id: { from: prior.store_id ?? null, to: input.store_id ?? null } },
          });
        }
        if (input.status && input.status !== prior.status) {
          await recordEvent(c, {
            organizationId: orgId,
            actorUserId: actor.id,
            entityType: 'membership',
            entityId: membershipId,
            action: input.status === 'active' ? 'reinstated' : 'revoked',
            changes: { status: { from: prior.status, to: input.status } },
          });
        }
        return { ...r.rows[0], ...identity };
      });
      return await reply.send(member);
    } catch (err) {
      // A store change can collide with the (user, org, store) unique index —
      // that is a 409, not an unhandled 500 (review 2026-07-25).
      throw conflictFrom(err) ?? err;
    }
  });
}

async function assertStoreInOrg(client: PoolClient, storeId: string): Promise<void> {
  const r = await client.query(
    `SELECT 1 FROM stores WHERE id = $1 AND deleted_at IS NULL AND status <> 'closed'`,
    [storeId],
  );
  if (r.rows.length === 0) {
    throw new AppError(422, 'validation_failed', 'Unknown store for this organization', [
      { path: 'store_id', code: 'invalid_reference', message: 'Store not found in this organization (or closed)' },
    ]);
  }
}
