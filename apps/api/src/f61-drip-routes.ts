import type { FastifyInstance } from 'fastify';
import { withTenant, withUser, type Pool, type PoolClient } from '@dealpilot/db';
import {
  CreateDripSequenceInput,
  ListDripEnrollmentsQuery,
  ListDripSequencesQuery,
  UpdateDripSequenceInput,
  DripTriggerCondition,
} from '@dealpilot/schemas';
import { lostConditionMatches } from '@dealpilot/core';
import { AppError, notFound, parseOrThrow } from './errors.js';
import { requirePermission } from './permissions.js';
import { idParam, requireMember, sessionUser } from './f01-routes.js';
import { recordEvent } from './activity.js';

/**
 * F-61 — drip sequences (automation-notifications.md §11, D-062).
 *
 * Tenant config, same family as lost reasons: members read, organization:update
 * manages. The engine that ACTS on this config is the hourly tick in
 * apps/workers/src/drip-tick.ts; the enrollment WRITE for the lead.lost
 * trigger lives here (`enrollLeadInDrips`) because it must run inside the
 * same transaction as the status flip in f02 — a lost lead with a matching
 * sequence is enrolled or the loss doesn't commit, never half of it.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface LostEnrollmentFacts {
  readonly organizationId: string;
  readonly leadId: string;
  readonly lostReasonId: string;
  readonly nowUtc?: Date;
}

/**
 * Enroll a freshly-lost lead in every active lead.lost sequence whose
 * condition accepts its lost reason. Idempotent per (sequence, lead): the
 * partial unique index turns a re-loss while a ride is live into a no-op,
 * while a lead lost again AFTER a completed ride starts a new one — §11.2's
 * re-engagement is per loss, not once per lifetime.
 */
export async function enrollLeadInDrips(c: PoolClient, facts: LostEnrollmentFacts): Promise<number> {
  const lead = await c.query<{
    store_id: string; phone: string; status: string;
  }>(
    `SELECT store_id, phone, status FROM leads WHERE id = $1`,
    [facts.leadId],
  );
  if (lead.rows.length === 0) return 0;
  const { store_id } = lead.rows[0]!;

  const reason = await c.query<{ name: string; name_fr: string }>(
    `SELECT name, name_fr FROM lost_reasons WHERE id = $1`,
    [facts.lostReasonId],
  );
  if (reason.rows.length === 0) return 0;

  const sequences = await c.query<{
    id: string; trigger_condition: unknown; duration_days: number;
  }>(
    `SELECT id, trigger_condition, duration_days
     FROM drip_sequences
     WHERE organization_id = $1 AND active AND trigger_event = 'lead.lost'
       AND (store_id IS NULL OR store_id = $2)`,
    [facts.organizationId, store_id],
  );

  // The lead's conversation, if it has one — drips continue the thread the
  // customer already knows (§11.3 "single thread per client"); a lead who
  // never texted gets one created at first send, not here.
  const conv = await c.query<{ id: string }>(
    `SELECT id FROM conversations
     WHERE lead_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [facts.leadId],
  );
  const conversationId = conv.rows[0]?.id ?? null;

  let enrolled = 0;
  const now = facts.nowUtc ?? new Date();
  for (const seq of sequences.rows) {
    const condition = DripTriggerCondition.safeParse(seq.trigger_condition);
    // A condition this code no longer understands matches nothing — a drip
    // that fires on the wrong audience is worse than one that doesn't fire.
    if (!condition.success) continue;
    if (!lostConditionMatches(condition.data, reason.rows[0]!)) continue;

    const expiresAt = new Date(now.getTime() + seq.duration_days * DAY_MS);
    const r = await c.query(
      `INSERT INTO drip_enrollments
         (organization_id, store_id, drip_sequence_id, lead_id, conversation_id, enrolled_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (drip_sequence_id, lead_id) WHERE status = 'active' DO NOTHING
       RETURNING id`,
      [facts.organizationId, store_id, seq.id, facts.leadId, conversationId, now, expiresAt],
    );
    if (r.rowCount === 1) {
      enrolled += 1;
      await recordEvent(c, {
        organizationId: facts.organizationId,
        actorUserId: null,
        entityType: 'lead',
        entityId: facts.leadId,
        action: 'drip_enrolled',
        changes: { drip_sequence_id: { from: null, to: seq.id } },
      });
    }
  }
  return enrolled;
}

/** End every live ride for a lead who just proved they're alive (§11.3). */
export async function reactivateLeadEnrollments(c: PoolClient, leadId: string): Promise<void> {
  await c.query(
    `UPDATE drip_enrollments
     SET status = 'reactivated', reactivated_at = now()
     WHERE lead_id = $1 AND status = 'active'`,
    [leadId],
  );
}

async function sequenceOrg(pool: Pool, userId: string, id: string): Promise<string> {
  return withUser(pool, userId, async (c) => {
    const r = await c.query<{ organization_id: string }>(
      `SELECT organization_id FROM drip_sequences WHERE id = $1`,
      [id],
    );
    if (r.rows.length === 0) throw notFound();
    return r.rows[0]!.organization_id;
  });
}

export function registerF61Routes(app: FastifyInstance, pool: Pool): void {
  app.get('/api/v1/drip-sequences', async (request, reply) => {
    const query = parseOrThrow(ListDripSequencesQuery, request.query);
    const user = sessionUser(request);
    const orgId = query.organization_id;
    if (!orgId) throw new AppError(400, 'organization_required', 'Pass organization_id', []);
    const page = await withTenant(pool, orgId, async (c) => {
      await requireMember(c, user.id);
      // Tenant config, not a feed: a rooftop authors a handful of sequences,
      // so a bounded page with no cursor is the honest shape (f53 precedent).
      let sql = `SELECT * FROM drip_sequences WHERE organization_id = $1`;
      const params: unknown[] = [orgId];
      if (!query.include_inactive) sql += ` AND active`;
      if (query.store_id) {
        params.push(query.store_id);
        sql += ` AND (store_id IS NULL OR store_id = $${params.length})`;
      }
      params.push(query.limit);
      const r = await c.query(`${sql} ORDER BY name LIMIT $${params.length}`, params);
      return { items: r.rows, next_cursor: null };
    });
    return reply.send(page);
  });

  app.post('/api/v1/drip-sequences', async (request, reply) => {
    const input = parseOrThrow(CreateDripSequenceInput, request.body);
    const user = sessionUser(request);
    const row = await withTenant(pool, input.organization_id, async (c) => {
      await requirePermission(c, user.id, 'organization:update');
      if (input.store_id) {
        const store = await c.query(`SELECT 1 FROM stores WHERE id = $1 AND deleted_at IS NULL`, [input.store_id]);
        if (store.rows.length === 0) {
          throw new AppError(422, 'validation_failed', 'Unknown store', [
            { path: 'store_id', code: 'unknown_store', message: input.store_id },
          ]);
        }
      }
      try {
        const r = await c.query<Record<string, unknown>>(
          `INSERT INTO drip_sequences
             (organization_id, store_id, name, trigger_event, trigger_condition, steps, duration_days, scope)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [
            input.organization_id, input.store_id ?? null, input.name, input.trigger_event,
            // Arrays must be stringified for a jsonb column — node-pg would
            // otherwise encode a JS array as a Postgres ARRAY literal.
            JSON.stringify(input.trigger_condition), JSON.stringify(input.steps),
            input.duration_days, input.scope,
          ],
        );
        return r.rows[0]!;
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new AppError(409, 'duplicate_name', 'A drip sequence with that name already exists', [
            { path: 'name', code: 'duplicate_name', message: input.name },
          ]);
        }
        throw err;
      }
    });
    return reply.status(201).send(row);
  });

  app.patch('/api/v1/drip-sequences/:id', async (request, reply) => {
    const id = idParam(request);
    const input = parseOrThrow(UpdateDripSequenceInput, request.body);
    const user = sessionUser(request);
    const orgId = await sequenceOrg(pool, user.id, id);
    const row = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'organization:update');
      // Belt-and-braces at the SINK (house pattern): schema-bounded keys,
      // re-bounded where they reach identifier position.
      const PATCHABLE = new Set(['name', 'trigger_condition', 'steps', 'duration_days', 'scope', 'active']);
      const JSONB = new Set(['trigger_condition', 'steps']);
      const sets: string[] = [];
      const params: unknown[] = [id];
      for (const [key, value] of Object.entries(input)) {
        if (value === undefined) continue;
        if (!PATCHABLE.has(key)) throw new Error(`unpatchable column reached the SQL sink: ${key}`);
        params.push(JSONB.has(key) ? JSON.stringify(value) : value);
        sets.push(`${key} = $${params.length}`);
      }
      try {
        const r = await c.query<Record<string, unknown>>(
          `UPDATE drip_sequences SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
          params,
        );
        if (r.rows.length === 0) throw notFound();
        return r.rows[0]!;
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new AppError(409, 'duplicate_name', 'A drip sequence with that name already exists', [
            { path: 'name', code: 'duplicate_name', message: String(input.name ?? '') },
          ]);
        }
        throw err;
      }
    });
    return reply.send(row);
  });

  app.get('/api/v1/drip-enrollments', async (request, reply) => {
    const query = parseOrThrow(ListDripEnrollmentsQuery, request.query);
    const user = sessionUser(request);
    const orgId = query.organization_id;
    if (!orgId) throw new AppError(400, 'organization_required', 'Pass organization_id', []);
    const page = await withTenant(pool, orgId, async (c) => {
      await requireMember(c, user.id);
      let sql = `SELECT * FROM drip_enrollments WHERE organization_id = $1`;
      const params: unknown[] = [orgId];
      if (query.lead_id) {
        params.push(query.lead_id);
        sql += ` AND lead_id = $${params.length}`;
      }
      if (query.status) {
        params.push(query.status);
        sql += ` AND status = $${params.length}`;
      }
      params.push(query.limit);
      const r = await c.query(`${sql} ORDER BY enrolled_at DESC, id LIMIT $${params.length}`, params);
      return { items: r.rows, next_cursor: null };
    });
    return reply.send(page);
  });
}
