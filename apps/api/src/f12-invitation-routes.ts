import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { withTenant, withUser, type Pool, type PoolClient } from '@dealpilot/db';
import { CreateInvitationInput, InvitationListQuery } from '@dealpilot/schemas';
import { AppError, notFound, parseOrThrow } from './errors.js';
import type { RateLimiter } from './rate-limit.js';
import { callerOrgIds, idParam, keysetPage, requireMember, sessionUser } from './f01-routes.js';
import { assertGrantable } from './f04-members-routes.js';
import { recordEvent } from './activity.js';
import { requirePermission } from './permissions.js';
import type { Mailer } from './email.js';
import { invitationMessage } from './email.js';

/**
 * F-12 invitations (D-035).
 *
 * Before this, adding a member wrote a roster row against an INVENTED user id
 * and sent nothing. The person could never log in, and if they signed up on
 * their own they got an unrelated identity. The roster said "Active" about
 * someone who did not exist.
 *
 * Now: an invitation is the roster entry until a real person accepts it. The
 * link carries a token we never store — only its SHA-256 — so a database read
 * cannot be turned back into a working invitation. Accepting requires being
 * signed in AS THAT EMAIL, which is what ties the identity to the seat.
 */

const INVITE_TTL_DAYS = 7;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** 32 bytes: guessing one is not a thing anyone does twice. */
const newToken = () => randomBytes(32).toString('base64url');

/** The token arrives in the body so it never reaches an access log. */
function tokenFromBody(body: unknown): string {
  const parsed = z.strictObject({ token: z.string().min(20).max(200) }).safeParse(body);
  if (!parsed.success) throw new AppError(422, 'validation_failed', 'A token is required');
  return parsed.data.token;
}

function acceptUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/$/, '')}/invitations/${token}`;
}

export function registerF12Routes(app: FastifyInstance, pool: Pool, mailer: Mailer, appUrl: string, limiter: RateLimiter): void {
  /** Invite someone. Owner/GM/admin_office, and never above your own ceiling. */
  app.post('/api/v1/invitations', async (request, reply) => {
    const input = parseOrThrow(CreateInvitationInput, request.body);
    const actor = sessionUser(request);
    const token = newToken();

    const invitation = await withTenant(pool, input.organization_id, async (c) => {
      await requirePermission(c, actor.id, 'member:invite');
      const actorRoles = await requireMember(c, actor.id);
      // The privilege ceiling from F-04: you cannot invite someone to a role you
      // do not hold yourself, or the invite becomes an escalation route around
      // the member-update rules.
      assertGrantable(actorRoles, input.roles);
      if (input.store_id) await assertStoreInOrg(c, input.store_id);
      await assertNotAlreadyMember(c, input.email);

      // Re-inviting replaces the open invitation rather than leaving two live
      // links to one seat (the partial unique index enforces this).
      await c.query(
        `UPDATE invitations SET revoked_at = now()
         WHERE organization_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL`,
        [input.organization_id, input.email],
      );

      const r = await c.query<Record<string, unknown>>(
        `INSERT INTO invitations (organization_id, store_id, email, name, roles, token_hash, invited_by, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now() + ($8 || ' days')::interval)
         RETURNING *`,
        [
          input.organization_id, input.store_id ?? null, input.email, input.name ?? null,
          input.roles, hashToken(token), actor.id, String(INVITE_TTL_DAYS),
        ],
      );
      await recordEvent(c, {
        organizationId: input.organization_id,
        storeId: input.store_id ?? null,
        actorUserId: actor.id,
        entityType: 'invitation',
        entityId: String(r.rows[0]!['id']),
        action: 'created',
        changes: { email: input.email, roles: { from: null, to: input.roles } },
      });
      return r.rows[0]!;
    });

    const url = acceptUrl(appUrl, token);
    const sent = await mailer.send(invitationMessage(String(invitation['email']), url));
    // Hand the link back whenever the invitee will NOT receive one: the send
    // failed, or the transport does not actually reach anybody (the dev log
    // mailer writes to pino, which the person being invited cannot read).
    // Without this the owner is told an email is on its way that never was —
    // CR-05, and it would have failed his very first invitation test.
    // Returned HERE and nowhere else, ever.
    const reachesInvitee = sent && mailer.deliversToRecipient;
    return reply.status(201).send(reachesInvitee ? invitation : { ...invitation, accept_url: url });
  });

  /**
   * What the accept screen may show before anyone is signed in. Deliberately
   * thin: the organization's name, the invited email, the roles. A wrong or
   * expired token is a 404 — indistinguishable from a forged one.
   *
   * POST for a read, on purpose: the token travels in the BODY, never in a URL.
   * A token in a path lands in access logs, browser history and Referer headers,
   * and this one grants a seat in someone's business. The invite LINK still
   * carries it — but that link points at the web app, not at this API.
   */
  app.post('/api/v1/invitations/preview', async (request, reply) => {
    // F-44: the ONE public endpoint that resolves a secret to a fact — the
    // exact shape token-enumeration wants. Per-IP bucket, deliberately tight.
    const gate = await limiter.take(`preview:${request.ip}`, { ratePerMinute: 30, burst: 30 });
    if (!gate.allowed) {
      throw new AppError(429, 'rate_limited', 'Too many requests', [
        { path: 'token', code: 'rate_limited', message: `Retry in ${gate.retryAfterS}s` },
      ]);
    }
    const token = tokenFromBody(request.body);
    const r = await pool.query<{ org_name: string; email: string; roles: string[] }>(
      `SELECT org_name, email, roles FROM invitation_resolve($1)`,
      [hashToken(token)],
    );
    if (r.rows.length === 0) throw notFound();
    return reply.send({
      organization_name: r.rows[0]!.org_name,
      email: r.rows[0]!.email,
      roles: r.rows[0]!.roles,
    });
  });

  /**
   * Accept. Requires a session, and that session's email must BE the invited
   * one — that match is the whole security model: it is what stops a forwarded
   * link from handing someone else's seat to whoever opened it.
   */
  app.post('/api/v1/invitations/accept', async (request, reply) => {
    const token = tokenFromBody(request.body);
    const user = sessionUser(request);
    const hash = hashToken(token);

    const found = await pool.query<{ id: string; organization_id: string; store_id: string | null; email: string; roles: string[] }>(
      `SELECT id, organization_id, store_id, email, roles FROM invitation_resolve($1)`,
      [hash],
    );
    if (found.rows.length === 0) throw notFound();
    const inv = found.rows[0]!;

    if (inv.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new AppError(403, 'wrong_account', 'This invitation was sent to a different email address', [
        { path: 'email', code: 'wrong_account', message: 'Sign in as the invited address to accept' },
      ]);
    }

    // Claiming the seat and creating the domain user row are one call: the
    // accepting person has no membership yet, so RLS would hide the rows they
    // are about to own. SECURITY DEFINER, and atomic — two clicks cannot make
    // two memberships.
    const claimed = await pool.query<{ invitation_accept: string | null }>(
      `SELECT invitation_accept($1, $2, $3, $4)`,
      [hash, user.id, user.email.toLowerCase(), user.name],
    );
    const membershipId = claimed.rows[0]?.invitation_accept ?? null;
    // Lost the race against a second click, or it expired in the last
    // millisecond. Either way there is nothing to accept now.
    if (!membershipId) throw notFound();

    await withTenant(pool, inv.organization_id, async (c) => {
      await recordEvent(c, {
        organizationId: inv.organization_id,
        storeId: inv.store_id,
        actorUserId: user.id,
        entityType: 'membership',
        entityId: membershipId,
        action: 'created',
        changes: { roles: { from: null, to: inv.roles }, via: 'invitation' },
      });
    });

    return reply.status(201).send({ organization_id: inv.organization_id, membership_id: membershipId });
  });

  app.get('/api/v1/invitations', async (request, reply) => {
    const query = parseOrThrow(InvitationListQuery, request.query);
    const user = sessionUser(request);
    const orgId = await resolveOrg(pool, user.id, query.organization_id);
    const page = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'member:invite');
      return keysetPage(
        c,
        `SELECT * FROM invitations WHERE organization_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL`,
        [orgId],
        query,
      );
    });
    return reply.send(page);
  });

  app.delete('/api/v1/invitations/:id', async (request, reply) => {
    const invitationId = idParam(request);
    const user = sessionUser(request);
    const orgId = await invitationOrg(pool, user.id, invitationId);
    await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'member:invite');
      const gone = await c.query(
        `UPDATE invitations SET revoked_at = now()
         WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id`,
        [invitationId],
      );
      if (gone.rows.length === 0) throw notFound();
      await recordEvent(c, {
        organizationId: orgId,
        actorUserId: user.id,
        entityType: 'invitation',
        entityId: invitationId,
        action: 'revoked',
      });
    });
    return reply.status(204).send();
  });
}

async function assertStoreInOrg(client: PoolClient, storeId: string): Promise<void> {
  const r = await client.query(`SELECT 1 FROM stores WHERE id = $1 AND deleted_at IS NULL`, [storeId]);
  if (r.rows.length === 0) {
    throw new AppError(422, 'validation_failed', 'Unknown store for this organization', [
      { path: 'store_id', code: 'invalid_reference', message: 'Store not found in this organization' },
    ]);
  }
}

/** Inviting someone who is already on the team is a mistake, not a second seat. */
async function assertNotAlreadyMember(client: PoolClient, email: string): Promise<void> {
  // An active membership whose user row has no sign-in identity behind it is a
  // STRANDED row, not a colleague — nobody can be logged in as them. Treating it
  // as "already a member" is what turned CR-14 into a dead end: the one path
  // that could repair the person was refused by the thing that broke them.
  const r = await client.query(
    `SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE lower(u.email) = lower($1) AND m.status = 'active'
       AND EXISTS (SELECT 1 FROM "user" a WHERE a.id = u.id::text)`,
    [email],
  );
  if (r.rows.length > 0) {
    throw new AppError(409, 'already_member', 'That person is already on this team', [
      { path: 'email', code: 'already_member', message: 'Already an active member' },
    ]);
  }
}

async function resolveOrg(pool: Pool, userId: string, selector?: string): Promise<string> {
  if (selector) return selector;
  const orgs = await withUser(pool, userId, (c) => callerOrgIds(c));
  if (orgs.length === 0) throw notFound();
  if (orgs.length > 1) {
    throw new AppError(400, 'organization_required', 'Pass organization_id — you belong to several organizations');
  }
  return orgs[0]!;
}

async function invitationOrg(pool: Pool, userId: string, invitationId: string): Promise<string> {
  const orgs = await withUser(pool, userId, (c) => callerOrgIds(c));
  for (const orgId of orgs) {
    const found = await withTenant(pool, orgId, async (c) => {
      const r = await c.query('SELECT 1 FROM invitations WHERE id = $1', [invitationId]);
      return r.rows.length > 0;
    });
    if (found) return orgId;
  }
  throw notFound();
}
