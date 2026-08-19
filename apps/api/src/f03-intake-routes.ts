import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withTenant, withUser, type Pool, type PoolClient } from '@dealpilot/db';
import { CreateIntakeKeyInput, IntakeLeadPayload, StoreListQuery, Uuid } from '@dealpilot/schemas';
import { AppError, notFound, parseOrThrow } from './errors.js';
import { requirePermission } from './permissions.js';
import { recordEvent } from './activity.js';
import { findConnector, normalizeLead } from '@dealpilot/core';
import { scoreOnCreate } from './f39-scoring-routes.js';
import { autoAssignLead } from './f40-assignment-routes.js';
import { callerOrgIds, idParam, keysetPage, requireMember, sessionUser } from './f01-routes.js';

/**
 * F-03 lead intake (leads.md §10). Two surfaces:
 *  - Management (session-authed, owner/gm): create/list/revoke per-store keys.
 *    The raw `secret` is returned ONCE on creation; the token is the public URL
 *    segment.
 *  - Public webhook (NO session; HMAC-signed): POST /in/v1/leads/:token with
 *    `X-Intake-Timestamp` + `X-Intake-Signature: v1=<hex>` (HMAC-SHA256 of
 *    `${ts}.${rawBody}`, ±5 min). A verified payload places a lead synchronously.
 *
 * DEV-SLICE SCOPE (deferred to later units, noted for the reviewer): the spec's
 * dedicated `apps/intake` service + minimal `app_intake` DB role, the
 * spool→BullMQ enqueue (this inserts synchronously), ADF/XML + provider-specific
 * signature schemes, and ElastiCache-backed rate limiting (this uses an
 * in-memory window). The security envelope — signature, size, revocation,
 * SECURITY DEFINER resolution — is real now.
 */

const SIGNATURE_WINDOW_SECONDS = 5 * 60;
const INTAKE_BODY_LIMIT = 256 * 1024;

/** Same shape as StoreListQuery + an optional store filter. */
const IntakeKeyListQuery = StoreListQuery.extend({ store_id: Uuid.optional() });

// -- in-memory fixed-window rate limit (dev; prod = ElastiCache token bucket) --
const RATE_MAX = 30;
const RATE_WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(token: string, now: number): boolean {
  const b = buckets.get(token);
  if (!b || now >= b.resetAt) {
    if (buckets.size > 10_000) for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k);
    buckets.set(token, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  b.count += 1;
  return b.count > RATE_MAX;
}

function newToken(): string {
  return randomBytes(16).toString('base64url'); // 22 chars, matches the CHECK
}
function newSecret(): string {
  return randomBytes(32).toString('hex'); // 64 chars
}

/** Constant-time compare of two hex signatures. */
function signaturesMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// -- management routes (session-authed) ---------------------------------------

export function registerIntakeKeyRoutes(app: FastifyInstance, pool: Pool, apiBaseUrl: string): void {
  app.post('/api/v1/intake-keys', async (request, reply) => {
    const input = parseOrThrow(CreateIntakeKeyInput, request.body);
    const user = sessionUser(request);
    const token = newToken();
    const secret = newSecret();
    const key = await withTenant(pool, input.organization_id, async (c) => {
      await requirePermission(c, user.id, 'intake_key:manage');
      await requireLiveStore(c, input.store_id);
      const r = await c.query(
        `INSERT INTO intake_keys (organization_id, store_id, label, provider, default_source,
                                  connector_key, token, secret)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          input.organization_id, input.store_id, input.label, input.provider,
          input.default_source, input.connector_key, token, secret,
        ],
      );
      // A webhook credential is a standing key to the front door. Minting one is
      // recorded; the secret itself never is.
      await recordEvent(c, {
        organizationId: input.organization_id,
        storeId: input.store_id,
        actorUserId: user.id,
        entityType: 'intake_key',
        entityId: String((r.rows[0] as Record<string, unknown>)['id']),
        action: 'created',
        changes: { label: input.label, provider: input.provider },
      });
      return r.rows[0] as Record<string, unknown>;
    });
    // The secret leaves the server exactly here, once.
    return reply.status(201).send({
      ...key,
      secret,
      webhook_url: `${apiBaseUrl}/in/v1/leads/${token}`,
    });
  });

  app.get('/api/v1/intake-keys', async (request, reply) => {
    const query = parseOrThrow(IntakeKeyListQuery, request.query);
    const user = sessionUser(request);
    const page = await withUser(pool, user.id, async (c) => {
      let orgId = query.organization_id;
      if (orgId) {
        const member = await c.query(
          `SELECT 1 FROM memberships m
           JOIN organizations o ON o.id = m.organization_id AND o.deleted_at IS NULL
           WHERE m.organization_id = $1 AND m.status = 'active' LIMIT 1`,
          [orgId],
        );
        if (member.rows.length === 0) throw notFound();
      } else {
        const orgs = await callerOrgIds(c);
        if (orgs.length === 0) return { items: [], next_cursor: null };
        if (orgs.length > 1) throw new AppError(400, 'organization_required', 'Pass organization_id — you belong to several organizations');
        orgId = orgs[0]!;
      }
      // `secret` is never selected — it must not reach the client after creation.
      const cols = 'id, organization_id, store_id, label, provider, default_source, connector_key, token, active, last_used_at, created_at, updated_at, revoked_at';
      let sql = `SELECT ${cols} FROM intake_keys WHERE organization_id = $1 AND revoked_at IS NULL`;
      const params: unknown[] = [orgId];
      if (query.store_id) {
        params.push(query.store_id);
        sql += ` AND store_id = $${params.length}`;
      }
      return keysetPage(c, sql, params, query);
    });
    return reply.send(page);
  });

  app.delete('/api/v1/intake-keys/:id', async (request, reply) => {
    const keyId = idParam(request);
    const user = sessionUser(request);
    const orgId = await keyOrg(pool, user.id, keyId);
    await withTenant(pool, orgId, async (c) => {
      await requireMember(c, user.id);
      const revoked = await c.query(
        `UPDATE intake_keys SET active = false, revoked_at = now()
         WHERE id = $1 AND revoked_at IS NULL RETURNING id`,
        [keyId],
      );
      if (revoked.rows.length > 0) {
        await recordEvent(c, {
          organizationId: orgId, actorUserId: user.id,
          entityType: 'intake_key', entityId: keyId, action: 'revoked',
        });
      }
    });
    return reply.status(204).send();
  });
}

async function requireLiveStore(client: PoolClient, storeId: string): Promise<void> {
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

async function keyOrg(pool: Pool, userId: string, keyId: string): Promise<string> {
  return withUser(pool, userId, async (c) => {
    const r = await c.query<{ organization_id: string }>(
      `SELECT organization_id FROM intake_keys WHERE id = $1 AND revoked_at IS NULL`,
      [keyId],
    );
    if (r.rows.length === 0) throw notFound();
    return r.rows[0]!.organization_id;
  });
}

// -- public webhook (no session; HMAC) ----------------------------------------

interface ResolvedKey {
  connector_key: string;
  organization_id: string;
  store_id: string;
  default_source: string;
  secret: string;
}

export function registerPublicIntakeRoutes(app: FastifyInstance, pool: Pool): void {
  app.route({
    method: 'POST',
    url: '/in/v1/leads/:token',
    bodyLimit: INTAKE_BODY_LIMIT,
    handler: async (request, reply) => {
      const token = (request.params as { token: string }).token;
      const now = Date.now();

      if (rateLimited(token, now)) {
        return reply.status(429).header('retry-after', '60').send(
          envelopePublic('rate_limited', 'Too many requests'),
        );
      }

      // Resolve via the audited SECURITY DEFINER function (no tenant context).
      const resolved = await pool
        .query<ResolvedKey>('SELECT * FROM intake_resolve($1)', [token])
        .then((r) => r.rows[0]);
      // Uniform 401 (never distinguish unknown token from bad signature).
      if (!resolved) return reply.status(401).send(envelopePublic('unauthenticated', 'Invalid or missing signature'));

      // Signature: HMAC-SHA256 of `${ts}.${rawBody}`, ±5 min (api-design §10).
      const ts = header(request, 'x-intake-timestamp');
      const sig = header(request, 'x-intake-signature');
      const raw = (request as { rawBody?: string }).rawBody ?? '';
      const tsNum = Number(ts);
      if (!ts || !sig || !Number.isFinite(tsNum) || Math.abs(now / 1000 - tsNum) > SIGNATURE_WINDOW_SECONDS) {
        return reply.status(401).send(envelopePublic('unauthenticated', 'Invalid or missing signature'));
      }
      const expected = `v1=${createHmac('sha256', resolved.secret).update(`${ts}.${raw}`).digest('hex')}`;
      if (!signaturesMatch(sig, expected)) {
        return reply.status(401).send(envelopePublic('unauthenticated', 'Invalid or missing signature'));
      }

      // Verified. Validate the payload and place the lead synchronously.
      const payload = parseOrThrow(IntakeLeadPayload, request.body ?? {});
      // Generated app-side so the lead and its consent share one grant without
      // a second round trip inside the transaction.
      const grantId = randomUUID();
      const leadId = await withTenant(pool, resolved.organization_id, async (c) => {
        const r = await c.query<{ id: string }>(
          `INSERT INTO leads (organization_id, store_id, phone, source, first_name, last_name, email,
                              preferred_language, vehicle_interest)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [
            resolved.organization_id, resolved.store_id, payload.phone, resolved.default_source,
            payload.first_name ?? null, payload.last_name ?? null, payload.email ?? null,
            payload.preferred_language ?? 'fr-CA', payload.vehicle_interest ?? null,
          ],
        );
        // actor_user_id NULL: a provider's webhook did this, not a person. This
        // is the call site the nullable column exists for — pretending a job was
        // someone would be worse than admitting nobody was there.
        await recordEvent(c, {
          organizationId: resolved.organization_id,
          storeId: resolved.store_id,
          actorUserId: null,
          entityType: 'lead',
          entityId: r.rows[0]!.id,
          action: 'created',
          changes: { source: resolved.default_source, via: 'intake' },
        });
        // F-39: scored at birth, all create paths (§6.2) — the assistant reads
        // the band before any human does, so a webhook lead must not wait for
        // somebody to press a button. In-process pure math; the ACK budget is
        // untouched.
        await scoreOnCreate(c, resolved.organization_id, r.rows[0]!.id);
        // F-40: routed at birth (§7.2). Actor NULL — a webhook assigned this,
        // not a person, and the history row names the rule that decided.
        await autoAssignLead(c, resolved.organization_id, r.rows[0]!.id, null);
        // ADR-005: what this form's consent box granted is a fact about THAT
        // form, so it comes from the connector definition rather than from an
        // assumption here. Written in the same transaction as the lead — an
        // enquiry that arrives with permission and stores only half of it is a
        // lead nobody may contact.
        const connector = findConnector(resolved.connector_key) ?? findConnector('website_form');
        if (connector) {
          const normalized = normalizeLead(request.body ?? {}, connector, new Date());
          for (const row of normalized.consent) {
            await c.query(
              `INSERT INTO consent_ledger
                 (organization_id, store_id, grant_id, lead_id, phone_e164, email,
                  channel, scope, consent_type, source, evidence, granted_at, expires_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
              [
                resolved.organization_id, resolved.store_id, grantId, r.rows[0]!.id,
                row.channel === 'email' ? null : payload.phone,
                row.channel === 'email' ? (payload.email ?? null) : null,
                row.channel, row.scope, row.consentType, row.source,
                JSON.stringify(row.evidence), row.grantedAt, row.expiresAt,
              ],
            );
          }
          if (normalized.consent.length > 0) {
            await recordEvent(c, {
              organizationId: resolved.organization_id,
              storeId: resolved.store_id,
              actorUserId: null,
              entityType: 'consent',
              entityId: grantId,
              action: 'created',
              parentEntityType: 'lead',
              parentEntityId: r.rows[0]!.id,
              changes: {
                connector: connector.key,
                consent_type: normalized.consent[0]!.consentType,
                channels: normalized.consent.map((x) => x.channel),
              },
            });
          }
        }
        await c.query(`UPDATE intake_keys SET last_used_at = now() WHERE token = $1`, [token]);
        return r.rows[0]!.id;
      });

      return reply.status(202).send({ received: true, lead_id: leadId });
    },
  });
}

function header(request: FastifyRequest, name: string): string | undefined {
  const v = request.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function envelopePublic(code: string, message: string) {
  return { error: { code, message } };
}
