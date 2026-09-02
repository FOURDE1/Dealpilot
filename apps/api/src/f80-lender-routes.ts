import type { FastifyInstance } from 'fastify';
import { withTenant, withUser, type Pool } from '@dealpilot/db';
import { CreateLenderInput, LENDER_CATEGORIES, LenderListQuery, UpdateLenderInput } from '@dealpilot/schemas';
import { AppError, notFound, parseOrThrow } from './errors.js';
import { requirePermission } from './permissions.js';
import { idParam, requireMember, sessionUser } from './f01-routes.js';

/**
 * F-80 — the lender registry (lenders-billofsale.md §1.1–§1.2, D-081).
 *
 * A config vocabulary, f53's family: members READ it (the desking Select and
 * the pipeline/lead render sites need names), `lender:manage` WRITES it.
 * Deactivation is PATCH {active:false} through the one update route — no
 * dedicated endpoint, no DELETE anywhere (contract, route, grant): deals
 * FK-reference lenders from day one, and a lender with history deactivates
 * (the dripSequences rule). Old deals keep their lender's name on every
 * screen; only NEW picks refuse an inactive lender — enforced in f05's
 * requireLenderInOrg, stated here.
 */

/** clawbackOrg's shape (f09): iterate the caller's orgs under withTenant; a
 * rival's (or unknown) lender id is a 404. No new RLS policy — the one
 * org-keyed isolation policy is the only door. */
async function lenderOrg(pool: Pool, userId: string, lenderId: string): Promise<string> {
  const orgs = await withUser(pool, userId, async (c) => {
    const r = await c.query<{ organization_id: string }>(
      `SELECT DISTINCT organization_id FROM memberships WHERE status = 'active'`,
    );
    return r.rows.map((x) => x.organization_id);
  });
  for (const orgId of orgs) {
    const found = await withTenant(pool, orgId, async (c) => {
      const r = await c.query('SELECT 1 FROM lenders WHERE id = $1', [lenderId]);
      return r.rows.length > 0;
    });
    if (found) return orgId;
  }
  throw notFound();
}

export function registerF80Routes(app: FastifyInstance, pool: Pool): void {
  app.get('/api/v1/lenders', async (request, reply) => {
    const query = parseOrThrow(LenderListQuery, request.query);
    const user = sessionUser(request);
    const orgId = query.organization_id;
    if (!orgId) throw new AppError(400, 'organization_required', 'Pass organization_id', []);
    const page = await withTenant(pool, orgId, async (c) => {
      await requireMember(c, user.id);
      // A pick-list, not a feed: category in the spec's display order, then
      // name, bounded by the limit — a tenant vocabulary never outgrows one
      // page, so no cursor (f53's comment).
      let sql = `SELECT * FROM lenders WHERE organization_id = $1`;
      const params: unknown[] = [orgId];
      if (!query.include_inactive) sql += ` AND active`;
      params.push(query.limit);
      const r = await c.query(
        `${sql} ORDER BY array_position(ARRAY[${LENDER_CATEGORIES.map((cat) => `'${cat}'`).join(',')}], category), name
         LIMIT $${params.length}`,
        params,
      );
      return { items: r.rows, next_cursor: null };
    });
    return reply.send(page);
  });

  app.post('/api/v1/lenders', async (request, reply) => {
    const input = parseOrThrow(CreateLenderInput, request.body);
    const user = sessionUser(request);
    const row = await withTenant(pool, input.organization_id, async (c) => {
      await requirePermission(c, user.id, 'lender:manage');
      try {
        const r = await c.query<Record<string, unknown>>(
          `INSERT INTO lenders (organization_id, name, short_name, category, contact_name, contact_email, contact_phone, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [
            input.organization_id, input.name, input.short_name ?? null, input.category,
            input.contact_name ?? null, input.contact_email ?? null, input.contact_phone ?? null,
            input.notes ?? null,
          ],
        );
        return r.rows[0]!;
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new AppError(409, 'duplicate_name', 'A lender with that name already exists', [
            { path: 'name', code: 'duplicate_name', message: input.name },
          ]);
        }
        throw err;
      }
    });
    return reply.status(201).send(row);
  });

  app.patch('/api/v1/lenders/:id', async (request, reply) => {
    const id = idParam(request);
    const input = parseOrThrow(UpdateLenderInput, request.body);
    const user = sessionUser(request);
    const orgId = await lenderOrg(pool, user.id, id);
    const row = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'lender:manage');
      // Belt-and-braces at the SINK (house pattern, f53): schema-bounded keys,
      // re-bounded where they reach identifier position.
      const PATCHABLE = new Set([
        'name', 'short_name', 'category', 'contact_name', 'contact_email',
        'contact_phone', 'notes', 'active',
      ]);
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
          `UPDATE lenders SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
          params,
        );
        if (r.rows.length === 0) throw notFound();
        return r.rows[0]!;
      } catch (err) {
        // Renaming onto an existing name is the same collision POST maps.
        if ((err as { code?: string }).code === '23505') {
          throw new AppError(409, 'duplicate_name', 'A lender with that name already exists', [
            { path: 'name', code: 'duplicate_name', message: String(input.name ?? '') },
          ]);
        }
        throw err;
      }
    });
    return reply.send(row);
  });
}
