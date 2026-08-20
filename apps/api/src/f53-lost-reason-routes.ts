import type { FastifyInstance } from 'fastify';
import { withTenant, withUser, type Pool } from '@dealpilot/db';
import { CreateLostReasonInput, LostReasonListQuery, UpdateLostReasonInput } from '@dealpilot/schemas';
import { AppError, notFound, parseOrThrow } from './errors.js';
import { requirePermission } from './permissions.js';
import { idParam, requireMember, sessionUser } from './f01-routes.js';

/**
 * F-53 — lost reasons (leads.md §11, D-055).
 *
 * A tenant vocabulary, same family as the other config tables: members read
 * it (the pick-list in the lost modal), organization:update manages it. The
 * RULE the vocabulary serves — no lead goes lost without a reason — lives on
 * the lead PATCH in f02, because that is the door it guards.
 */

async function reasonOrg(pool: Pool, userId: string, id: string): Promise<string> {
  return withUser(pool, userId, async (c) => {
    const r = await c.query<{ organization_id: string }>(
      `SELECT organization_id FROM lost_reasons WHERE id = $1`,
      [id],
    );
    if (r.rows.length === 0) throw notFound();
    return r.rows[0]!.organization_id;
  });
}

export function registerF53Routes(app: FastifyInstance, pool: Pool): void {
  app.get('/api/v1/lost-reasons', async (request, reply) => {
    const query = parseOrThrow(LostReasonListQuery, request.query);
    const user = sessionUser(request);
    const orgId = query.organization_id;
    if (!orgId) throw new AppError(400, 'organization_required', 'Pass organization_id', []);
    const page = await withTenant(pool, orgId, async (c) => {
      await requireMember(c, user.id);
      // A pick-list, not a feed: ordered by display_order, bounded by the
      // limit — a tenant vocabulary never outgrows one page, so no cursor.
      let sql = `SELECT * FROM lost_reasons WHERE organization_id = $1`;
      const params: unknown[] = [orgId];
      if (!query.include_inactive) sql += ` AND is_active`;
      // The spec's narrowing: a store's pick-list is the org-wide reasons
      // plus that store's own — never another store's.
      if (query.store_id) {
        params.push(query.store_id);
        sql += ` AND (store_id IS NULL OR store_id = $${params.length})`;
      }
      params.push(query.limit);
      const r = await c.query(`${sql} ORDER BY display_order, name LIMIT $${params.length}`, params);
      return { items: r.rows, next_cursor: null };
    });
    return reply.send(page);
  });

  app.post('/api/v1/lost-reasons', async (request, reply) => {
    const input = parseOrThrow(CreateLostReasonInput, request.body);
    const user = sessionUser(request);
    const row = await withTenant(pool, input.organization_id, async (c) => {
      await requirePermission(c, user.id, 'organization:update');
      // A store reference must be THIS org's live store (the composite FK
      // backs this up at the constraint level; here it gets a 422, not a 500).
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
          `INSERT INTO lost_reasons (organization_id, store_id, name, name_fr, icon, display_order)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [input.organization_id, input.store_id ?? null, input.name, input.name_fr, input.icon, input.display_order],
        );
        return r.rows[0]!;
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new AppError(409, 'duplicate_name', 'A lost reason with that name already exists', [
            { path: 'name', code: 'duplicate_name', message: input.name },
          ]);
        }
        throw err;
      }
    });
    return reply.status(201).send(row);
  });

  app.patch('/api/v1/lost-reasons/:id', async (request, reply) => {
    const id = idParam(request);
    const input = parseOrThrow(UpdateLostReasonInput, request.body);
    const user = sessionUser(request);
    const orgId = await reasonOrg(pool, user.id, id);
    const row = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'organization:update');
      // Belt-and-braces at the SINK (house pattern): schema-bounded keys,
      // re-bounded where they reach identifier position.
      const PATCHABLE = new Set(['name', 'name_fr', 'icon', 'display_order', 'is_active']);
      const sets: string[] = [];
      const params: unknown[] = [id];
      for (const [key, value] of Object.entries(input)) {
        if (value === undefined) continue;
        if (!PATCHABLE.has(key)) throw new Error(`unpatchable column reached the SQL sink: ${key}`);
        params.push(value);
        sets.push(`${key} = $${params.length}`);
      }
      try {
        const r = await c.query<Record<string, unknown>>(
          `UPDATE lost_reasons SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
          params,
        );
        if (r.rows.length === 0) throw notFound();
        return r.rows[0]!;
      } catch (err) {
        // Renaming onto an existing name is the same collision POST maps.
        if ((err as { code?: string }).code === '23505') {
          throw new AppError(409, 'duplicate_name', 'A lost reason with that name already exists', [
            { path: 'name', code: 'duplicate_name', message: String(input.name ?? '') },
          ]);
        }
        throw err;
      }
    });
    return reply.send(row);
  });

  app.delete('/api/v1/lost-reasons/:id', async (request, reply) => {
    const id = idParam(request);
    const user = sessionUser(request);
    const orgId = await reasonOrg(pool, user.id, id);
    await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'organization:update');
      try {
        const r = await c.query(`DELETE FROM lost_reasons WHERE id = $1`, [id]);
        if (r.rowCount === 0) throw notFound();
      } catch (err) {
        // A reason leads already point at is HISTORY — deactivate instead.
        if ((err as { code?: string }).code === '23503') {
          throw new AppError(409, 'reason_in_use', 'Leads reference this reason — deactivate it instead', [
            { path: 'id', code: 'reason_in_use', message: 'Set is_active to false to retire it' },
          ]);
        }
        throw err;
      }
    });
    return reply.status(204).send();
  });
}
