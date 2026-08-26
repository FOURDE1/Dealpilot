import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withTenant, withUser, type Pool, type PoolClient } from '@dealpilot/db';
import { CreateIntakeKeyInput, Email, IntakeLeadPayload, StoreListQuery, Uuid } from '@dealpilot/schemas';
import { AppError, notFound, parseOrThrow } from './errors.js';
import { requirePermission } from './permissions.js';
import { recordEvent } from './activity.js';
import { notify } from './notifications.js';
import { recalculateLeadScore } from './f39-scoring-routes.js';
import { AdfParseError, distributionPlatformOf, findConnector, normalizeLead, normalizePhone, parseAdf, type AdfLead } from '@dealpilot/core';
import { scoreOnCreate } from './f39-scoring-routes.js';
import { autoAssignLead } from './f40-assignment-routes.js';
import { callerOrgIds, idParam, keysetPage, requireMember, sessionUser } from './f01-routes.js';
import type { ReassignQueue } from './reassign-queue.js';
import type { DeferredSendQueue } from './deferred-queue.js';
import type { RateLimiter } from './rate-limit.js';
import { distributeLead } from './f45-distribution-routes.js';
import { connectorKeyExists, resolveConnector } from './f49-connector-routes.js';
import { detectDuplicatesFor } from './f54-duplicate-routes.js';
import { reactivateLeadEnrollments } from './f61-drip-routes.js';

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

// F-44: the shared token bucket (Redis in prod, memory in dev) — same 30/min
// budget the fixed window enforced, now burst-tolerant and instance-agnostic.
const INTAKE_RATE = { ratePerMinute: 30, burst: 30 };

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
      if (input.store_id !== null) await requireLiveStore(c, input.store_id);
      // F-49: the key must point at a REAL connector — a built-in preset or
      // one of this tenant's active rows. A ghost key would mint a webhook
      // whose every lead silently wears website_form's mapping.
      if (!(await connectorKeyExists(c, input.organization_id, input.connector_key))) {
        throw new AppError(422, 'validation_failed', 'Unknown connector', [
          { path: 'connector_key', code: 'unknown_connector', message: input.connector_key },
        ]);
      }
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
  /** F-69: the tenant's lifecycle status, for the 410 below. */
  organization_status: string;
}

/**
 * F-69 (admin-console.md §4.2): a suspended or closing tenant's intake
 * answers 410 — AFTER the signature verifies, so a suspended tenant cannot
 * be enumerated by an unsigned probe. read_only keeps receiving leads (O-4):
 * the provider is not the tenant, and losing the customer's message is worse.
 */
const GONE_STATUSES = new Set(['suspended', 'offboarding', 'purged']);

/**
 * An ADF document, flattened by @dealpilot/core, shaped for IntakeLeadPayload.
 *
 * Salvage over refusal for every field EXCEPT phone: a malformed email or an
 * over-long vehicle string should cost that field, not the lead. The phone is
 * different — leads.phone is NOT NULL by core schema (SMS-first product), so a
 * document with no usable NANP number fails IntakeLeadPayload downstream and
 * the provider sees which field, and why, in the 422. Whether email-only ADF
 * leads should be accepted at all is an owner decision (OWNER-ACTIONS).
 */
function adfToCandidate(adf: AdfLead): Record<string, unknown> {
  const email = adf.email && Email.safeParse(adf.email).success ? adf.email : undefined;
  return {
    phone: normalizePhone(adf.phone) ?? undefined,
    first_name: adf.first_name?.slice(0, 100) || undefined,
    last_name: adf.last_name?.slice(0, 100) || undefined,
    email,
    vehicle_interest: adf.vehicle_interest?.slice(0, 200) || undefined,
    message: adf.comments?.slice(0, 4000) || undefined,
  };
}

export function registerPublicIntakeRoutes(app: FastifyInstance, pool: Pool, reassign: ReassignQueue, limiter: RateLimiter, deferred: DeferredSendQueue): void {
  app.route({
    method: 'POST',
    url: '/in/v1/leads/:token',
    bodyLimit: INTAKE_BODY_LIMIT,
    handler: async (request, reply) => {
      const token = (request.params as { token: string }).token;
      const now = Date.now();

      const gate = await limiter.take(`intake:${token}`, INTAKE_RATE);
      if (!gate.allowed) {
        return reply.status(429).header('retry-after', String(gate.retryAfterS)).send(
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
      if (GONE_STATUSES.has(resolved.organization_status)) {
        return reply.status(410).send(envelopePublic('tenant_gone', 'This intake endpoint is no longer accepting leads'));
      }

      // Verified. Validate the payload and place the lead synchronously.
      // FR-LEAD-004: ADF/XML arrives as a string body; flatten it in core
      // (defensive parser: entities off, 256KB cap) before the same schema
      // every JSON lead passes. One validation gate, two wire formats.
      const isXml = String(request.headers['content-type'] ?? '').includes('xml');
      let adfFlat: AdfLead | null = null;
      if (isXml) {
        try {
          adfFlat = parseAdf(raw);
        } catch (e) {
          if (e instanceof AdfParseError) {
            return reply.status(422).send(envelopePublic('validation_failed', 'Not a parseable ADF document'));
          }
          throw e;
        }
      }
      const payload = parseOrThrow(IntakeLeadPayload, adfFlat ? adfToCandidate(adfFlat) : (request.body ?? {}));
      // Generated app-side so the lead and its consent share one grant without
      // a second round trip inside the transaction.
      const grantId = randomUUID();
      // F-45: which ad split this lead belongs to, from its SOURCE — written
      // on every lead so the dashboard and the tally read the same fact.
      const platform = distributionPlatformOf(resolved.default_source);
      const leadId = await withTenant(pool, resolved.organization_id, async (c) => {
        const r = await c.query<{ id: string }>(
          `INSERT INTO leads (organization_id, store_id, phone, source, source_platform,
                              first_name, last_name, email, preferred_language, vehicle_interest)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [
            resolved.organization_id, resolved.store_id, payload.phone, resolved.default_source,
            platform, payload.first_name ?? null, payload.last_name ?? null, payload.email ?? null,
            payload.preferred_language ?? 'fr-CA', payload.vehicle_interest ?? null,
          ],
        );
        // A store-less lead (org-level key) is dealt by the running tally
        // BEFORE scoring and assignment, in the same transaction — the spec's
        // central queue empties at arrival when the month has a config. A
        // refusal is a value: the lead stays queued, visible, ownable.
        if (resolved.store_id === null && platform !== null) {
          await distributeLead(c, resolved.organization_id, r.rows[0]!.id, platform);
        }
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
        await scoreOnCreate(c, resolved.organization_id, r.rows[0]!.id, (o, m) => request.log.warn(o, m));
        // F-54 (§8.1): webhook arrivals are checked too — a duplicate
        // submission is a signal somebody is still shopping.
        await detectDuplicatesFor(c, resolved.organization_id, r.rows[0]!.id);

        // F-63 (§8.3, D-064): a CERTAIN resubmission (confidence 100) is a
        // high-intent signal about the KEEPER, and the whole reaction is
        // atomic with the intake. Runs BEFORE assignment on purpose: the
        // duplicate record itself must never hold an agent or arm the
        // ten-minute ladder — it exists as pair-evidence for the human merge
        // (D-056), and a cascade over it is three notifications about a
        // record nobody will ever work (review finding).
        let touch: { kind: 'first_touch' } | { kind: 'dup_confirm'; keeperId: string } | { kind: 'none' } =
          { kind: 'first_touch' };
        // The CANONICAL keeper: oldest first (a third submission pairs with
        // both the original and yesterday's duplicate — the original wins),
        // phone matches preferred over email-only.
        const pair = await c.query<{ duplicate_of: string; match_type: string }>(
          `SELECT ld.duplicate_of, ld.match_type
           FROM lead_duplicates ld
           JOIN leads k ON k.id = ld.duplicate_of AND k.deleted_at IS NULL
           WHERE ld.lead_id = $1 AND ld.status = 'pending' AND ld.confidence = 100
           ORDER BY (ld.match_type LIKE 'phone%') DESC, k.created_at ASC, k.id ASC
           LIMIT 1`,
          [r.rows[0]!.id],
        );
        if (pair.rows[0]) {
          const keeperId = pair.rows[0].duplicate_of;
          const phoneMatch = pair.rows[0].match_type.startsWith('phone');
          // NOWAIT under a SAVEPOINT: the F-54 human merge may hold this row
          // for its whole transaction, and the webhook ACK (p99 < 1s) must
          // not queue behind it — a keeper being merged right now simply
          // gets no automated reaction this once.
          await c.query('SAVEPOINT dup_claim');
          let keeper:
            | { id: string; status: string; assigned_to: string | null; first_name: string | null; last_name: string | null; phone: string }
            | undefined;
          try {
            keeper = (
              await c.query<{ id: string; status: string; assigned_to: string | null; first_name: string | null; last_name: string | null; phone: string }>(
                `SELECT id, status, assigned_to, first_name, last_name, phone
                 FROM leads WHERE id = $1 AND deleted_at IS NULL FOR UPDATE NOWAIT`,
                [keeperId],
              )
            ).rows[0];
            await c.query('RELEASE SAVEPOINT dup_claim');
          } catch {
            await c.query('ROLLBACK TO SAVEPOINT dup_claim');
          }
          if (keeper) {
            // "Merge new submission data into the existing lead": the
            // keeper's EMPTY fields take the submission's values — the same
            // backfill shape as the human merge (§8.2 #1) — and the keeper
            // rescores (SAVEPOINT-guarded: a scoring bug must not eat an
            // intake).
            await c.query(
              `UPDATE leads k SET
                 first_name = COALESCE(k.first_name, s.first_name),
                 last_name  = COALESCE(k.last_name,  s.last_name),
                 email      = COALESCE(k.email,      s.email),
                 vehicle_interest     = COALESCE(k.vehicle_interest,     s.vehicle_interest),
                 total_budget_cents   = COALESCE(k.total_budget_cents,   s.total_budget_cents),
                 monthly_budget_cents = COALESCE(k.monthly_budget_cents, s.monthly_budget_cents),
                 source_platform      = COALESCE(k.source_platform,      s.source_platform),
                 updated_at = now()
               FROM leads s WHERE k.id = $1 AND s.id = $2`,
              [keeperId, r.rows[0]!.id],
            );
            await c.query('SAVEPOINT dup_rescore');
            try {
              await recalculateLeadScore(c, resolved.organization_id, keeperId);
              await c.query('RELEASE SAVEPOINT dup_rescore');
            } catch {
              await c.query('ROLLBACK TO SAVEPOINT dup_rescore');
            }

            const activeDeal = await c.query(
              `SELECT 1 FROM deals WHERE lead_id = $1 AND deleted_at IS NULL
                 AND pipeline_stage NOT IN ('delivered','complete','lost') LIMIT 1`,
              [keeperId],
            );
            let reaction: string;
            if (activeDeal.rows.length > 0) {
              // §8.3: already mid-deal — the machine steps aside and the
              // PERSON hears about it.
              touch = { kind: 'none' };
              reaction = 'salesperson_alerted';
              if (keeper.assigned_to) {
                const label =
                  [keeper.first_name, keeper.last_name].filter(Boolean).join(' ') || keeper.phone;
                await notify(c, {
                  organizationId: resolved.organization_id,
                  userId: keeper.assigned_to,
                  urgency: 'high',
                  titleKey: 'notif_duplicate_resubmission',
                  params: { lead: label },
                  link: `/leads/${keeperId}`,
                  entityType: 'lead',
                  entityId: keeperId,
                });
              }
            } else {
              // Phone match: the confirmation rides the KEEPER's thread.
              // Email-only: the person gave a NEW number — the new record's
              // own first touch opens with the confirming variant (F-59's
              // pending-pair wording), so first_touch stands.
              touch = phoneMatch ? { kind: 'dup_confirm', keeperId } : { kind: 'first_touch' };
              reaction = phoneMatch ? 'confirmation_to_keeper' : 'confirmation_via_new_number';
              // §11.3 discipline: the person just re-engaged themselves —
              // whatever nurture ride was running is over.
              await reactivateLeadEnrollments(c, keeperId);
              // §8.3 reactivation, on F-48's dormant set — but only a keeper
              // WITH an agent flips here. An orphan stays dormant on purpose:
              // its REPLY to the confirmation routes through f23, whose
              // comeback cascades it — cascading at intake would spend the
              // ACK budget and mark interest nobody confirmed yet.
              if (
                keeper.assigned_to !== null &&
                ['nurture', 'expired', 'lost', 'unresponsive'].includes(keeper.status)
              ) {
                await c.query(
                  `UPDATE leads
                   SET status = 'assigned', previous_agents = '[]'::jsonb,
                       assignment_attempts = 0, updated_at = now()
                   WHERE id = $1`,
                  [keeperId],
                );
                await recordEvent(c, {
                  organizationId: resolved.organization_id,
                  storeId: resolved.store_id,
                  actorUserId: null,
                  entityType: 'lead',
                  entityId: keeperId,
                  action: 'updated',
                  changes: {
                    status: { from: keeper.status, to: 'assigned' },
                    via: 'duplicate_resubmission',
                  },
                });
              }
            }
            // The §8.3 paper trail: every branch says what the machine did
            // with the signal (review: two of three branches were silent).
            await recordEvent(c, {
              organizationId: resolved.organization_id,
              storeId: resolved.store_id,
              actorUserId: null,
              entityType: 'lead',
              entityId: keeperId,
              action: 'updated',
              changes: { via: 'duplicate_resubmission', reaction, resubmission: r.rows[0]!.id },
            });
          }
        }

        // F-40: routed at birth (§7.2) — but never for a record §8.3 just
        // sidelined: the duplicate is pair-evidence, not workable inventory,
        // and an agent assigned to it inherits an undischargeable ladder.
        const assignDecision =
          touch.kind === 'first_touch'
            ? await autoAssignLead(c, resolved.organization_id, r.rows[0]!.id, null)
            : ({ outcome: 'unassigned' } as const);
        // ADR-005: what this form's consent box granted is a fact about THAT
        // form, so it comes from the connector definition rather than from an
        // assumption here. Written in the same transaction as the lead — an
        // enquiry that arrives with permission and stores only half of it is a
        // lead nobody may contact.
        // F-49: a tenant's ACTIVE connector wins over the built-in of the
        // same key; unknown keys keep the historical website_form fallback.
        const connector =
          (await resolveConnector(c, resolved.organization_id, resolved.connector_key)) ??
          findConnector('website_form');
        if (connector) {
          const normalized = normalizeLead(adfFlat ?? request.body ?? {}, connector, new Date());
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
        return { id: r.rows[0]!.id, assignDecision, touch };
      });
      // D-046 #2: a machine assignment arms the ten-minute timer. Post-commit,
      // and NOT counted against the sub-second ACK budget when there is no
      // queue (the no-op just logs).
      if (leadId.assignDecision.outcome === 'assigned') {
        await reassign.arm({
          organization_id: resolved.organization_id,
          lead_id: leadId.id,
          assigned_to: leadId.assignDecision.assigned_to,
          attempt: 0,
        });
      }

      // F-59 (overview.md §5): the 60-second clock starts at this ACK — the
      // first-touch job goes on the queue the moment the lead is committed.
      // The job id is deterministic PER LEAD (a BullMQ retry of this enqueue
      // cannot double-greet); provider-level intake idempotency is the
      // spool's job when the Flow pipeline lands. And the ACK never waits on
      // a sick Redis: p99 < 1s is a promise to the provider, so a lost
      // enqueue is a loud log, not a hung webhook (D-059).
      await Promise.race([
        leadId.touch.kind === 'none'
          ? Promise.resolve()
          : deferred.enqueueFirstTouch({
              organization_id: resolved.organization_id,
              lead_id: leadId.id,
              // F-63 (§8.3): a high-confidence resubmission sends the
              // confirming re-engagement to the KEEPER's thread instead of
              // greeting the new record — one person, one message.
              ...(leadId.touch.kind === 'dup_confirm' ? { duplicate_of: leadId.touch.keeperId } : {}),
            }),
        new Promise<void>((resolve) => setTimeout(resolve, 1500)),
      ]).catch((err: unknown) => {
        request.log.warn(
          { lead_id: leadId.id, err: err instanceof Error ? err.message : String(err) },
          'first-touch enqueue failed — the lead is committed but ungreeted',
        );
      });

      return reply.status(202).send({ received: true, lead_id: leadId.id });
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
