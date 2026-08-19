import type { FastifyInstance } from 'fastify';
import { withTenant, withUser, type Pool, type PoolClient } from '@dealpilot/db';
import { CreateLeadInput, LeadListQuery, UpdateLeadInput } from '@dealpilot/schemas';
import { AppError, notFound, parseOrThrow } from './errors.js';
import { requirePermission } from './permissions.js';
import { diff, recordEvent } from './activity.js';
import { inquiryConsentRows } from '@dealpilot/core';
import { scoreOnCreate } from './f39-scoring-routes.js';
import { autoAssignLead } from './f40-assignment-routes.js';
import {
  callerOrgIds,
  conflictFrom,
  idParam,
  keysetPage,
  sessionUser,
} from './f01-routes.js';

/**
 * F-02: lead pipeline routes (apiV1.leads). Same tenancy model as F-01:
 * reads under withUser (lead_member_read, org-alive joins), writes under
 * withTenant after the membership gate. Role model: ANY active member may
 * create/update leads (operational data — bdc/salespeople live here);
 * delete stays owner/gm. Status transitions are free within the vocabulary
 * for now — the rules-engine state machine lands with the AI slice.
 * `score`/`assigned_to` are engine-owned: score is never client-writable
 * (schema-level), assigned_to must reference an ACTIVE member of the org.
 */

/** Store must exist, be live, and belong to the current tenant txn's org. */
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

/** assigned_to must be an ACTIVE member of the current org. */
async function requireAssignableMember(client: PoolClient, userId: string): Promise<void> {
  const r = await client.query(
    `SELECT 1 FROM memberships
     WHERE user_id = $1 AND status = 'active'
       AND organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid
     LIMIT 1`,
    [userId],
  );
  if (r.rows.length === 0) {
    throw new AppError(422, 'validation_failed', 'Assignee is not a member of this organization', [
      { path: 'assigned_to', code: 'invalid_reference', message: 'Not an active member' },
    ]);
  }
}

/** Resolve a lead's LIVE org through the caller's own visibility (404 if unseen). */
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

const LEAD_COLUMNS =
  'organization_id, store_id, first_name, last_name, email, phone, source, source_platform, preferred_language, total_budget_cents, monthly_budget_cents, vehicle_interest, trade_in_status';

export function registerF02Routes(app: FastifyInstance, pool: Pool): void {
  app.post('/api/v1/leads', async (request, reply) => {
    const input = parseOrThrow(CreateLeadInput, request.body);
    const user = sessionUser(request);
    try {
      const lead = await withTenant(pool, input.organization_id, async (c) => {
        await requirePermission(c, user.id, 'lead:create');
        await requireLiveStore(c, input.store_id);
        const r = await c.query(
          `INSERT INTO leads (${LEAD_COLUMNS})
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
          [
            input.organization_id, input.store_id, input.first_name ?? null,
            input.last_name ?? null, input.email ?? null, input.phone,
            input.source, input.source_platform ?? null, input.preferred_language,
            input.total_budget_cents ?? null, input.monthly_budget_cents ?? null,
            input.vehicle_interest ?? null,
            // 'unknown' is the truthful default: nobody has asked yet.
            input.trade_in_status ?? 'unknown',
          ],
        );
        const leadId = String(r.rows[0]!['id']);

        // D-042 #1 (owner, 2026-07-27): somebody who walks in or telephones and
        // gives you their number has enquired, and CASL treats an enquiry as
        // implied consent to reply about it for six months. Written in the SAME
        // transaction as the lead, so a lead can never exist without the basis
        // it was created with — and never the other way round either.
        //
        // Conversational only, and only for sources the customer initiated
        // themselves. A referral is a third party handing over somebody else's
        // number, which is not that person asking us anything.
        const inquiry = inquiryConsentRows({
          source: input.source,
          phoneE164: input.phone,
          email: input.email ?? null,
          at: new Date(),
          recordedByUserId: user.id,
        });
        if (inquiry.length > 0) {
          const grant = await c.query<{ id: string }>(`SELECT gen_random_uuid() AS id`);
          for (const row of inquiry) {
            await c.query(
              `INSERT INTO consent_ledger
                 (organization_id, store_id, grant_id, lead_id, phone_e164, email,
                  channel, scope, consent_type, source, evidence, granted_at, expires_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
              [
                input.organization_id, input.store_id, grant.rows[0]!.id, leadId,
                row.channel === 'email' ? null : input.phone,
                row.channel === 'email' ? (input.email ?? null) : null,
                row.channel, row.scope, row.consentType, row.source,
                JSON.stringify(row.evidence), row.grantedAt, row.expiresAt,
              ],
            );
          }
          await recordEvent(c, {
            organizationId: input.organization_id,
            storeId: input.store_id,
            actorUserId: user.id,
            entityType: 'consent',
            entityId: grant.rows[0]!.id,
            action: 'created',
            parentEntityType: 'lead',
            parentEntityId: leadId,
            changes: {
              consent_type: 'implied_inquiry',
              basis: 'self_initiated_inquiry',
              lead_source: input.source,
              expires_at: inquiry[0]!.expiresAt?.toISOString() ?? null,
            },
          });
        }

        await recordEvent(c, {
          organizationId: input.organization_id,
          storeId: input.store_id,
          actorUserId: user.id,
          entityType: 'lead',
          entityId: leadId,
          action: 'created',
          changes: { score: (await scoreOnCreate(c, input.organization_id, leadId, (o, m) => request.log.warn(o, m))).score, source: input.source },
        });
        // F-40: routed at birth too (§7.2). Every refusal is a value — with no
        // rules configured this is a no-op and the lead stays unassigned,
        // exactly as before the engine existed.
        await autoAssignLead(c, input.organization_id, leadId, user.id);
        // Re-read: scoring synced leads.score and assignment may have set
        // assigned_to/status after the INSERT's RETURNING row was captured.
        const fresh = await c.query(`SELECT * FROM leads WHERE id = $1`, [leadId]);
        return fresh.rows[0];
      });
      return await reply.status(201).send(lead);
    } catch (err) {
      throw conflictFrom(err) ?? err;
    }
  });

  app.get('/api/v1/leads', async (request, reply) => {
    const query = parseOrThrow(LeadListQuery, request.query);
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
        if (orgs.length > 1) {
          throw new AppError(400, 'organization_required', 'Pass organization_id — you belong to several organizations');
        }
        orgId = orgs[0]!;
      }
      let sql = `SELECT * FROM leads WHERE organization_id = $1 AND deleted_at IS NULL`;
      const params: unknown[] = [orgId];
      if (query.store_id) {
        params.push(query.store_id);
        sql += ` AND store_id = $${params.length}`;
      }
      if (query.status) {
        params.push(query.status);
        sql += ` AND status = $${params.length}`;
      }
      if (query.assigned_to) {
        params.push(query.assigned_to);
        sql += ` AND assigned_to = $${params.length}`;
      }
      return keysetPage(c, sql, params, query);
    });
    return reply.send(page);
  });

  app.get('/api/v1/leads/:id', async (request, reply) => {
    const leadId = idParam(request);
    const user = sessionUser(request);
    const lead = await withUser(pool, user.id, async (c) => {
      const r = await c.query(
        `SELECT l.* FROM leads l
         JOIN organizations o ON o.id = l.organization_id AND o.deleted_at IS NULL
         WHERE l.id = $1 AND l.deleted_at IS NULL`,
        [leadId],
      );
      if (r.rows.length === 0) throw notFound();
      return r.rows[0];
    });
    return reply.send(lead);
  });

  app.patch('/api/v1/leads/:id', async (request, reply) => {
    const leadId = idParam(request);
    const input = parseOrThrow(UpdateLeadInput, request.body);
    const user = sessionUser(request);
    const orgId = await leadOrg(pool, user.id, leadId);
    try {
      const lead = await withTenant(pool, orgId, async (c) => {
        // Assigning is a different power from editing: a BDC agent routes
        // leads all day but does not own the rest of the record.
        await requirePermission(c, user.id, input.assigned_to === undefined ? 'lead:update' : 'lead:assign');
        if (input.store_id) await requireLiveStore(c, input.store_id);
        if (input.assigned_to) await requireAssignableMember(c, input.assigned_to);
        const beforeRow = await c.query<Record<string, unknown>>(
          `SELECT * FROM leads WHERE id = $1 AND deleted_at IS NULL`,
          [leadId],
        );
        if (beforeRow.rows.length === 0) throw notFound();
        const prior = beforeRow.rows[0]!;

        const fields = Object.entries(input);
        if (fields.length === 0) return prior;
        const sets = fields.map(([k], i) => `${k} = $${i + 2}`);
        // §5.2's ten-minute reassignment ladder counts from the moment somebody
        // became responsible, not from when the lead arrived. Stamped here
        // because this is where responsibility changes hands; cleared on
        // unassignment, since a null owner has no clock.
        if (input.assigned_to !== undefined && input.assigned_to !== prior['assigned_to']) {
          sets.push(input.assigned_to === null ? 'assigned_at = NULL' : 'assigned_at = now()');
          // F-42 paper trail (D-045 #5): a person choosing a person is 'manual';
          // an unassignment has no method, only a missing owner.
          sets.push(input.assigned_to === null ? 'assignment_method = NULL' : "assignment_method = 'manual'");
        }
        const r = await c.query(
          `UPDATE leads SET ${sets.join(', ')} WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
          [leadId, ...fields.map(([, v]) => v)],
        );
        if (r.rows.length === 0) throw notFound();

        const evt = { organizationId: orgId, actorUserId: user.id, entityType: 'lead' as const, entityId: leadId };
        if ('assigned_to' in input && input.assigned_to !== prior['assigned_to']) {
          await recordEvent(c, {
            ...evt,
            action: input.assigned_to ? 'assigned' : 'unassigned',
            changes: { assigned_to: { from: prior['assigned_to'] ?? null, to: input.assigned_to ?? null } },
          });
        }
        // Everything a lead PATCH can write, minus assignment which has its own
        // verb above.
        const changed = diff(prior, input as Record<string, unknown>, [
          'first_name', 'last_name', 'email', 'phone', 'status', 'source',
          'source_platform', 'preferred_language', 'total_budget_cents', 'monthly_budget_cents',
          'vehicle_interest',
          'trade_in_status', 'store_id',
        ]);
        if (Object.keys(changed).length > 0) {
          await recordEvent(c, { ...evt, action: 'updated', changes: changed });
        }
        return r.rows[0];
      });
      return await reply.send(lead);
    } catch (err) {
      throw conflictFrom(err) ?? err;
    }
  });

  app.delete('/api/v1/leads/:id', async (request, reply) => {
    const leadId = idParam(request);
    const user = sessionUser(request);
    const orgId = await leadOrg(pool, user.id, leadId);
    await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'lead:delete');
      const gone = await c.query(
        `UPDATE leads SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
        [leadId],
      );
      // Only when a row actually moved: a second DELETE deletes nothing and
      // should not claim otherwise.
      if (gone.rows.length > 0) {
        await recordEvent(c, {
          organizationId: orgId, actorUserId: user.id,
          entityType: 'lead', entityId: leadId, action: 'deleted',
        });
      }
    });
    return reply.status(204).send();
  });
}
