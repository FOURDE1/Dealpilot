import type { FastifyInstance } from 'fastify';
import { withTenant, withUser, type Pool, type PoolClient } from '@dealpilot/db';
import {
  consentExpiryFor,
  evaluateSend,
  fanOutGrant,
  GATE_VERSION,
  type ComplianceFacts,
  type ConsentRow,
  type SendRequest,
} from '@dealpilot/core';
import {
  ComplianceCheckQuery,
  CreateInternalDncInput,
  CreateSuppressionInput,
  RecordConsentInput,
  RevokeConsentInput,
  UpdateCommsConfigInput,
} from '@dealpilot/schemas';
import { AppError, notFound, parseOrThrow } from './errors.js';
import { idParam, requireMember, sessionUser } from './f01-routes.js';
import { requirePermission } from './permissions.js';
import { recordEvent } from './activity.js';
import { killSwitches } from './platform-settings.js';

/**
 * F-15 compliance (compliance-and-quality.md).
 *
 * Every rule lives in packages/core. This module reads facts, calls
 * `evaluateSend` once, and writes rows — it decides nothing. That separation is
 * the point: the moment a route adds "…unless" to a compliance rule, the rule
 * has two homes and one of them is wrong.
 */

/** Rows in the shape the pure gate wants, straight from the ledger. */
async function consentRowsFor(
  c: PoolClient,
  orgId: string,
  lead: { id: string | null; phone: string | null; email: string | null },
): Promise<ConsentRow[]> {
  const r = await c.query<{
    id: string; channel: string; scope: string; consent_type: string;
    granted_at: Date; expires_at: Date | null; revoked_at: Date | null;
  }>(
    `SELECT id, channel, scope, consent_type, granted_at, expires_at, revoked_at
     FROM consent_ledger
     WHERE organization_id = $1
       AND (lead_id = $2 OR ($3::text IS NOT NULL AND phone_e164 = $3)
            OR ($4::text IS NOT NULL AND email = $4))`,
    [orgId, lead.id, lead.phone, lead.email],
  );
  return r.rows.map((x) => ({
    id: x.id,
    channel: x.channel as ConsentRow['channel'],
    scope: x.scope as ConsentRow['scope'],
    consentType: x.consent_type as ConsentRow['consentType'],
    grantedAt: x.granted_at,
    expiresAt: x.expires_at,
    revokedAt: x.revoked_at,
  }));
}

/**
 * The platform's own SMS window. A tenant may narrow it; nobody may widen it.
 * §3 gives 09:00–21:00 as the platform default and permits per-tenant
 * configuration — configuration that could only ever be stricter.
 */
const PLATFORM_SMS_START = '09:00';
const PLATFORM_SMS_END = '21:00';

export function registerF15Routes(app: FastifyInstance, pool: Pool): void {
  /**
   * Record a basis for contacting somebody.
   *
   * The expiry is DERIVED from the consent type, never accepted from the
   * caller: six months for an inquiry, twenty-four for a purchase, never for an
   * express opt-in. Letting a client supply it would let anybody grant
   * themselves a longer window than the law allows, which is the one thing this
   * table exists to make impossible.
   */
  app.post('/api/v1/consent', async (request, reply) => {
    const input = parseOrThrow(RecordConsentInput, request.body);
    const user = sessionUser(request);

    const rows = await withTenant(pool, input.organization_id, async (c) => {
      await requirePermission(c, user.id, 'lead:update');
      if (input.lead_id) {
        const lead = await c.query(`SELECT 1 FROM leads WHERE id = $1 AND deleted_at IS NULL`, [input.lead_id]);
        if (lead.rows.length === 0) throw notFound();
      }

      const grantedAt = input.granted_at ? new Date(input.granted_at) : new Date();
      const fanned = fanOutGrant({
        consentType: input.consent_type,
        scopes: input.scopes,
        channels: input.channels,
        grantedAt,
        source: input.source,
        evidence: input.evidence,
      });

      // One grant_id for the whole act, so a single tick of a single box stays
      // auditable — and revocable — as the one act it was.
      const grantId = await c.query<{ id: string }>(`SELECT gen_random_uuid() AS id`);
      const written: Record<string, unknown>[] = [];
      for (const row of fanned) {
        const r = await c.query<Record<string, unknown>>(
          `INSERT INTO consent_ledger
             (organization_id, store_id, grant_id, lead_id, phone_e164, email,
              channel, scope, consent_type, source, evidence, granted_at, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           RETURNING *`,
          [
            input.organization_id, input.store_id ?? null, grantId.rows[0]!.id,
            input.lead_id ?? null, input.phone_e164 ?? null, input.email ?? null,
            row.channel, row.scope, row.consentType, row.source,
            JSON.stringify(row.evidence), row.grantedAt, row.expiresAt,
          ],
        );
        written.push(r.rows[0]!);
      }

      await recordEvent(c, {
        organizationId: input.organization_id,
        storeId: input.store_id ?? null,
        actorUserId: user.id,
        entityType: 'consent',
        entityId: grantId.rows[0]!.id,
        action: 'created',
        ...(input.lead_id ? { parentEntityType: 'lead' as const, parentEntityId: input.lead_id } : {}),
        changes: {
          consent_type: input.consent_type,
          channels: input.channels,
          scopes: input.scopes,
          source: input.source,
          expires_at: consentExpiryFor(input.consent_type, grantedAt)?.toISOString() ?? null,
        },
      });
      return written;
    });
    return reply.code(201).send(rows);
  });

  /** Everything this organisation may rely on for this lead, live or not. */
  app.get('/api/v1/leads/:id/consent', async (request, reply) => {
    const leadId = idParam(request);
    const user = sessionUser(request);
    const orgId = await leadOrg(pool, user.id, leadId);
    const rows = await withTenant(pool, orgId, async (c) => {
      await requireMember(c, user.id);
      const r = await c.query(
        `SELECT * FROM consent_ledger WHERE organization_id = $1 AND lead_id = $2
         ORDER BY granted_at DESC`,
        [orgId, leadId],
      );
      return r.rows;
    });
    return reply.send({ items: rows });
  });

  /**
   * Withdraw a consent.
   *
   * An UPDATE, not a DELETE, and the trigger on the table permits only these two
   * columns to move. The record of what somebody agreed to is the evidence; the
   * withdrawal is a second fact about it, not an erasure of the first.
   */
  app.post('/api/v1/consent/:id/revoke', async (request, reply) => {
    const consentId = idParam(request);
    const input = parseOrThrow(RevokeConsentInput, request.body);
    const user = sessionUser(request);
    const orgId = await rowOrg(pool, user.id, consentId);

    const row = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'lead:update');
      const before = await c.query<Record<string, unknown>>(
        `SELECT * FROM consent_ledger WHERE id = $1 FOR UPDATE`,
        [consentId],
      );
      if (before.rows.length === 0) throw notFound();
      if (before.rows[0]!['revoked_at'] !== null) {
        // Already withdrawn. Saying so beats silently rewriting the reason on a
        // record somebody may already have relied on.
        throw new AppError(409, 'already_revoked', 'That consent was already withdrawn', [
          { path: 'id', code: 'already_revoked', message: String(before.rows[0]!['revoked_at']) },
        ]);
      }
      const r = await c.query<Record<string, unknown>>(
        `UPDATE consent_ledger SET revoked_at = now(), revoked_reason = $2 WHERE id = $1 RETURNING *`,
        [consentId, input.reason],
      );
      await recordEvent(c, {
        organizationId: orgId,
        storeId: (before.rows[0]!['store_id'] as string | null) ?? null,
        actorUserId: user.id,
        entityType: 'consent',
        entityId: consentId,
        action: 'updated',
        changes: { revoked_reason: input.reason, ...(input.note ? { note: input.note } : {}) },
      });
      return r.rows[0]!;
    });
    return reply.send(row);
  });

  /**
   * Put a number on the stop list by hand.
   *
   * Organisation-wide with no store scope, because §5 says so and because a
   * customer who says stop has not said "stop, except from your other lot".
   */
  app.post('/api/v1/suppressions', async (request, reply) => {
    const input = parseOrThrow(CreateSuppressionInput, request.body);
    const user = sessionUser(request);

    const row = await withTenant(pool, input.organization_id, async (c) => {
      await requirePermission(c, user.id, 'lead:update');
      const r = await c.query<Record<string, unknown>>(
        `INSERT INTO suppression_list (organization_id, phone_e164, channel, source)
         VALUES ($1,$2,$3,'staff_manual')
         ON CONFLICT (organization_id, phone_e164, channel) WHERE cleared_at IS NULL
         DO UPDATE SET updated_at = now()
         RETURNING *`,
        [input.organization_id, input.phone_e164, input.channel],
      );
      await recordEvent(c, {
        organizationId: input.organization_id,
        storeId: null,
        actorUserId: user.id,
        entityType: 'suppression',
        entityId: String(r.rows[0]!['id']),
        action: 'created',
        changes: { phone_e164: input.phone_e164, channel: input.channel, ...(input.note ? { note: input.note } : {}) },
      });
      return r.rows[0]!;
    });
    return reply.code(201).send(row);
  });

  /**
   * "Never call this person again."
   *
   * There is no endpoint to undo it, deliberately. §4 says the internal
   * do-not-call list has no exemptions and provides no path back; a button that
   * reverses somebody's do-not-call request is a button that will get pressed.
   * Calling them again requires fresh express consent, which is a new row in the
   * ledger — not the erasure of this one.
   */
  app.post('/api/v1/internal-dnc', async (request, reply) => {
    const input = parseOrThrow(CreateInternalDncInput, request.body);
    const user = sessionUser(request);

    const row = await withTenant(pool, input.organization_id, async (c) => {
      await requirePermission(c, user.id, 'lead:update');
      const r = await c.query<Record<string, unknown>>(
        `INSERT INTO internal_dnc (organization_id, phone_e164, reason, source, added_by)
         VALUES ($1,$2,$3,'console',$4)
         ON CONFLICT (organization_id, phone_e164) DO UPDATE SET updated_at = now()
         RETURNING *`,
        [input.organization_id, input.phone_e164, input.reason, user.id],
      );
      await recordEvent(c, {
        organizationId: input.organization_id,
        storeId: null,
        actorUserId: user.id,
        entityType: 'internal_dnc',
        entityId: String(r.rows[0]!['id']),
        action: 'created',
        changes: {
          phone_e164: input.phone_e164,
          reason: input.reason,
          ...(input.note ? { note: input.note } : {}),
        },
      });
      return r.rows[0]!;
    });
    return reply.code(201).send(row);
  });

  /** The quiet-hours window this organisation operates under. */
  app.get('/api/v1/organizations/:id/comms-config', async (request, reply) => {
    const orgId = idParam(request);
    const user = sessionUser(request);
    const row = await withTenant(pool, orgId, async (c) => {
      await requireMember(c, user.id);
      const r = await c.query(
        `SELECT * FROM tenant_comms_config
         WHERE organization_id = $1 AND store_id IS NULL AND deleted_at IS NULL`,
        [orgId],
      );
      return r.rows[0] ?? null;
    });
    return reply.send(row);
  });

  /**
   * Narrow the window. Never widen it.
   *
   * The database CHECK keeps start before end; the platform ceiling is enforced
   * here, because a tenant who could set 06:00–23:00 would be configuring their
   * way out of the CRTC rule rather than into it. There is no voice equivalent
   * of this endpoint at all — §3's voice row reads "Exemptions: None", so no
   * column exists that could widen it.
   */
  app.put('/api/v1/organizations/:id/comms-config', async (request, reply) => {
    const orgId = idParam(request);
    const input = parseOrThrow(UpdateCommsConfigInput, request.body);
    const user = sessionUser(request);

    const row = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'organization:update');
      const existing = await c.query<Record<string, unknown>>(
        `SELECT * FROM tenant_comms_config
         WHERE organization_id = $1 AND store_id IS NULL AND deleted_at IS NULL FOR UPDATE`,
        [orgId],
      );
      const current = existing.rows[0];
      const start = (input.sms_quiet_start ?? current?.['sms_quiet_start'] ?? '09:00') as string;
      const end = (input.sms_quiet_end ?? current?.['sms_quiet_end'] ?? '21:00') as string;
      if (start < PLATFORM_SMS_START || end > PLATFORM_SMS_END) {
        throw new AppError(422, 'window_too_wide', 'That window is wider than the platform allows', [
          {
            path: 'sms_quiet_start',
            code: 'window_too_wide',
            message: `Messaging hours must sit inside ${PLATFORM_SMS_START}–${PLATFORM_SMS_END}; a narrower window is fine`,
          },
        ]);
      }

      const cols = [
        'sms_quiet_start', 'sms_quiet_end', 'first_touch_quiet_exempt',
        'ai_daily_contact_cap', 'bot_turn_cap',
      ].filter((k) => k in input);
      if (!current) {
        const insertCols = ['organization_id', ...cols];
        const r = await c.query<Record<string, unknown>>(
          `INSERT INTO tenant_comms_config (${insertCols.join(', ')})
           VALUES (${insertCols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
          [orgId, ...cols.map((k) => (input as Record<string, unknown>)[k])],
        );
        return r.rows[0]!;
      }
      const params: unknown[] = [current['id']];
      const sets = cols.map((k) => {
        params.push((input as Record<string, unknown>)[k]);
        return `${k} = $${params.length}`;
      });
      const r = await c.query<Record<string, unknown>>(
        `UPDATE tenant_comms_config SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
        params,
      );
      return r.rows[0]!;
    });
    return reply.send(row);
  });

  /**
   * May we contact this lead right now — and if not, what would fix it?
   *
   * The same function the send layer calls, with the same facts, so the answer
   * on the screen is the answer the machine will act on. A screen that says
   * "ready to send" while the gate refuses is worse than no screen.
   */
  app.get('/api/v1/leads/:id/compliance', async (request, reply) => {
    const leadId = idParam(request);
    const query = parseOrThrow(ComplianceCheckQuery, request.query);
    const user = sessionUser(request);
    const orgId = await leadOrg(pool, user.id, leadId);

    const decision = await withTenant(pool, orgId, async (c) => {
      await requireMember(c, user.id);
      const leadRow = await c.query<{
        id: string; store_id: string; phone: string; email: string | null; postal_code: string | null;
      }>(
        `SELECT l.id, l.store_id, l.phone, l.email, NULL::text AS postal_code
         FROM leads l WHERE l.id = $1 AND l.deleted_at IS NULL`,
        [leadId],
      );
      if (leadRow.rows.length === 0) throw notFound();
      const lead = leadRow.rows[0]!;

      const store = await c.query<{ timezone: string }>(
        `SELECT timezone FROM stores WHERE id = $1`, [lead.store_id],
      );
      const cfg = await c.query<{
        sms_quiet_start: string; sms_quiet_end: string;
        first_touch_quiet_exempt: boolean; ai_daily_contact_cap: number;
      }>(
        `SELECT sms_quiet_start::text, sms_quiet_end::text, first_touch_quiet_exempt, ai_daily_contact_cap
         FROM tenant_comms_config
         WHERE organization_id = $1 AND (store_id = $2 OR store_id IS NULL) AND deleted_at IS NULL
         ORDER BY store_id NULLS LAST LIMIT 1`,
        [orgId, lead.store_id],
      );
      const suppressed = await c.query<{ channel: string; createdAt: Date }>(
        `SELECT channel, created_at AS "createdAt" FROM suppression_list
         WHERE organization_id = $1 AND phone_e164 = $2 AND channel = $3 AND cleared_at IS NULL`,
        [orgId, lead.phone, query.channel],
      );
      const dnc = await c.query(
        `SELECT 1 FROM internal_dnc WHERE organization_id = $1 AND phone_e164 = $2`,
        [orgId, lead.phone],
      );
      const capUsed = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM send_decisions
         WHERE organization_id = $1 AND lead_id = $2 AND status = 'allowed'
           AND originator = 'ai' AND decided_at >= date_trunc('day', now())`,
        [orgId, leadId],
      );

      const rows = await consentRowsFor(c, orgId, { id: leadId, phone: lead.phone, email: lead.email });

      // No config row yet means the platform defaults, which are the strictest
      // thing a tenant is allowed to have.
      const conf = cfg.rows[0];
      // F-72: the preview reads the SAME switches as the real send. Left
      // hardcoded, this screen would tell a dealer a message is allowed that
      // sendMessage refuses — exactly what `aiSendsSuspended: false` does.
      const switches = await killSwitches(c);
      const facts: ComplianceFacts = {
        suppressed: suppressed.rows[0] ?? null,
        consentRows: rows,
        postalCode: lead.postal_code,
        storeTimezone: store.rows[0]?.timezone ?? 'America/Toronto',
        quietHours: {
          smsQuietStart: conf?.sms_quiet_start ?? '09:00',
          smsQuietEnd: conf?.sms_quiet_end ?? '21:00',
          firstTouchQuietExempt: conf?.first_touch_quiet_exempt ?? true,
        },
        onInternalDnc: dnc.rows.length > 0,
        // No national list has been loaded — the fail-closed default, which
        // blocks solicitation calls rather than assuming the number is clear.
        newestDnclDownloadedAt: null,
        phoneOnDnclList: false,
        aiInitiatedSoFarToday: Number(capUsed.rows[0]?.n ?? '0'),
        aiDailyContactCap: conf?.ai_daily_contact_cap ?? 3,
        aiSendsSuspended: false,
        platformSmsPaused: switches.sms_send_killswitch,
        platformAiPaused: switches.ai_outbound_killswitch,
      };

      const req: SendRequest = {
        organizationId: orgId,
        storeId: lead.store_id,
        leadId,
        phoneE164: lead.phone,
        email: lead.email,
        channel: query.channel,
        scope: query.scope,
        messageClass: query.message_class,
        originator: query.originator,
        isSolicitation: query.is_solicitation,
        nowUtc: new Date(),
        jitterMs: 0,
      };
      return evaluateSend(req, facts);
    });

    return reply.send({
      status: decision.status,
      reason: decision.status === 'allowed' ? null : decision.reason,
      remedy: decision.status === 'blocked' ? decision.remedy : decision.status === 'deferred' ? decision.remedy : null,
      detail: decision.status === 'blocked' ? decision.detail : null,
      deferred_until: decision.status === 'deferred' ? decision.runAt.toISOString() : null,
      timezone: decision.tz,
      timezone_source: decision.tzSource,
      recipient_local_time: decision.recipientLocalTime.toISOString(),
      window_applied:
        decision.status === 'allowed' || decision.status === 'deferred' ? decision.windowApplied : null,
      consent_record_id: decision.status === 'allowed' ? decision.consentLedgerId : null,
      gate_version: GATE_VERSION,
    });
  });
}

async function leadOrg(pool: Pool, userId: string, leadId: string): Promise<string> {
  return withUser(pool, userId, async (c) => {
    const r = await c.query<{ organization_id: string }>(
      `SELECT l.organization_id FROM leads l
       JOIN organizations o ON o.id = l.organization_id AND o.deleted_at IS NULL
       WHERE l.id = $1 AND l.deleted_at IS NULL`,
      [leadId],
    );
    if (r.rows.length === 0) throw notFound();
    return r.rows[0]!.organization_id;
  });
}

/** Which of the caller's organisations owns this consent row — 404 otherwise. */
async function rowOrg(pool: Pool, userId: string, consentId: string): Promise<string> {
  const orgs = await withUser(pool, userId, async (c) => {
    const r = await c.query<{ organization_id: string }>(
      `SELECT DISTINCT m.organization_id FROM memberships m
       JOIN organizations o ON o.id = m.organization_id AND o.deleted_at IS NULL
       WHERE m.status = 'active'`,
    );
    return r.rows.map((x) => x.organization_id);
  });
  for (const orgId of orgs) {
    const found = await withTenant(pool, orgId, async (c) => {
      const r = await c.query('SELECT 1 FROM consent_ledger WHERE id = $1', [consentId]);
      return r.rows.length > 0;
    });
    if (found) return orgId;
  }
  throw notFound();
}
