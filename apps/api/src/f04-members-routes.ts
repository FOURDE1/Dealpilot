import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { withContext, withTenant, withUser, type Pool, type PoolClient } from '@dealpilot/db';
import { AddMemberInput, MemberListQuery, UpdateMemberInput } from '@dealpilot/schemas';
import { AppError, notFound, parseOrThrow } from './errors.js';
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
  const r = await client.query<{ remaining: string }>(
    `SELECT count(*)::int AS remaining FROM memberships
     WHERE status = 'active' AND 'owner' = ANY(roles) AND id <> $1`,
    [membershipId],
  );
  if (Number(r.rows[0]?.remaining ?? 0) === 0) {
    throw new AppError(422, 'last_owner', 'An organization must keep at least one active owner', [
      { path: 'roles', code: 'last_owner', message: 'Promote another owner first' },
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
      return keysetPage(
        c,
        `SELECT ${MEMBER_COLUMNS} FROM memberships m
         JOIN users u ON u.id = m.user_id
         WHERE m.organization_id = $1 AND m.status <> 'revoked'`,
        [orgId],
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
        await requireMember(c, actor.id, MEMBER_WRITE_ROLES);
        if (input.store_id) await assertStoreInOrg(c, input.store_id);
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
    const member = await withTenant(pool, orgId, async (c) => {
      await requireMember(c, actor.id, MEMBER_WRITE_ROLES);
      if (input.store_id) await assertStoreInOrg(c, input.store_id);

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

      // Read the identity BEFORE mutating: revoking removes the membership
      // that makes this user visible, so a post-update join would find nobody.
      const before = await c.query<{ email: string; name: string }>(
        `SELECT u.email, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.id = $1`,
        [membershipId],
      );
      if (before.rows.length === 0) throw notFound();
      const identity = before.rows[0]!;

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
      return { ...r.rows[0], ...identity };
    });
    return reply.send(member);
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
