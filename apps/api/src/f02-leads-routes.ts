import type { FastifyInstance } from 'fastify';
import { withTenant, withUser, type Pool, type PoolClient } from '@dealpilot/db';
import { CreateLeadInput, LeadListQuery, UpdateLeadInput } from '@dealpilot/schemas';
import { AppError, notFound, parseOrThrow } from './errors.js';
import {
  STORE_WRITE_ROLES,
  callerOrgIds,
  conflictFrom,
  idParam,
  keysetPage,
  requireMember,
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
  'organization_id, store_id, first_name, last_name, email, phone, source, source_platform, preferred_language, budget_cents, vehicle_interest';

export function registerF02Routes(app: FastifyInstance, pool: Pool): void {
  app.post('/api/v1/leads', async (request, reply) => {
    const input = parseOrThrow(CreateLeadInput, request.body);
    const user = sessionUser(request);
    try {
      const lead = await withTenant(pool, input.organization_id, async (c) => {
        await requireMember(c, user.id);
        await requireLiveStore(c, input.store_id);
        const r = await c.query(
          `INSERT INTO leads (${LEAD_COLUMNS})
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [
            input.organization_id, input.store_id, input.first_name ?? null,
            input.last_name ?? null, input.email ?? null, input.phone,
            input.source, input.source_platform ?? null, input.preferred_language,
            input.budget_cents ?? null, input.vehicle_interest ?? null,
          ],
        );
        return r.rows[0];
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
        await requireMember(c, user.id);
        if (input.store_id) await requireLiveStore(c, input.store_id);
        if (input.assigned_to) await requireAssignableMember(c, input.assigned_to);
        const fields = Object.entries(input);
        if (fields.length === 0) {
          const r = await c.query(`SELECT * FROM leads WHERE id = $1 AND deleted_at IS NULL`, [leadId]);
          if (r.rows.length === 0) throw notFound();
          return r.rows[0];
        }
        const sets = fields.map(([k], i) => `${k} = $${i + 2}`).join(', ');
        const r = await c.query(
          `UPDATE leads SET ${sets} WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
          [leadId, ...fields.map(([, v]) => v)],
        );
        if (r.rows.length === 0) throw notFound();
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
      await requireMember(c, user.id, STORE_WRITE_ROLES);
      await c.query(`UPDATE leads SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, [leadId]);
    });
    return reply.status(204).send();
  });
}
