import type { FastifyInstance } from 'fastify';
import { withTenant, withUser, type Pool, type PoolClient } from '@dealpilot/db';
import { CreateVehicleInput, UpdateVehicleInput, VehicleListQuery } from '@dealpilot/schemas';
import { AppError, notFound, parseOrThrow } from './errors.js';
import { diff, recordEvent } from './activity.js';
import { conflictFrom, idParam, keysetPage, requireMember, sessionUser, STORE_WRITE_ROLES } from './f01-routes.js';

/**
 * F-07 inventory (apiV1.vehicles). Same tenancy model as the other slices:
 * reads under withUser, writes under withTenant behind the membership gate.
 * Any active member may stock and update a car (that is lot work); removing
 * one from inventory stays owner/gm, like every other soft delete.
 *
 * `total_cost_cents` is DERIVED (acquisition + transport + recon) and never
 * stored: a stored copy would drift the moment a recon invoice lands, and the
 * desking gross depends on it being right.
 */

const VEHICLE_COLUMNS = [
  'organization_id', 'store_id', 'stock_number', 'vin', 'year', 'make', 'model', 'trim',
  'exterior_color', 'mileage_km', 'vehicle_type', 'acquisition_type', 'acquisition_date',
  'acquisition_cost_cents', 'transport_cost_cents', 'recon_cost_cents', 'list_price_cents',
  'location_status', 'location_details',
] as const;

function withTotalCost(row: Record<string, unknown>): Record<string, unknown> {
  const n = (k: string) => Number(row[k] ?? 0);
  const acquired = row['acquisition_date'];
  return {
    ...row,
    // pg maps `date` to a JS Date, which JSON-serializes to a full timestamp;
    // an acquisition DATE has no time of day, so send it as YYYY-MM-DD.
    acquisition_date:
      acquired instanceof Date ? acquired.toISOString().slice(0, 10) : acquired,
    total_cost_cents: n('acquisition_cost_cents') + n('transport_cost_cents') + n('recon_cost_cents'),
  };
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

async function vehicleOrg(pool: Pool, userId: string, vehicleId: string): Promise<string> {
  return withUser(pool, userId, async (c) => {
    const r = await c.query<{ organization_id: string }>(
      `SELECT v.organization_id FROM vehicles v
       JOIN organizations o ON o.id = v.organization_id AND o.deleted_at IS NULL
       WHERE v.id = $1 AND v.deleted_at IS NULL`,
      [vehicleId],
    );
    if (r.rows.length === 0) throw notFound();
    return r.rows[0]!.organization_id;
  });
}

export function registerF07Routes(app: FastifyInstance, pool: Pool): void {
  app.post('/api/v1/vehicles', async (request, reply) => {
    const input = parseOrThrow(CreateVehicleInput, request.body);
    const user = sessionUser(request);
    try {
      const vehicle = await withTenant(pool, input.organization_id, async (c) => {
        await requireMember(c, user.id);
        await requireLiveStore(c, input.store_id);
        // Only columns the caller actually provided: sending NULL for an
        // omitted field would override the table's own default (acquisition_date
        // is NOT NULL DEFAULT CURRENT_DATE).
        const present = VEHICLE_COLUMNS.filter(
          (k) => (input as Record<string, unknown>)[k] !== undefined,
        );
        const r = await c.query<Record<string, unknown>>(
          `INSERT INTO vehicles (${present.join(', ')})
           VALUES (${present.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
          present.map((k) => (input as Record<string, unknown>)[k]),
        );
        await recordEvent(c, {
          organizationId: input.organization_id,
          storeId: input.store_id,
          actorUserId: user.id,
          entityType: 'vehicle',
          entityId: String(r.rows[0]!['id']),
          action: 'created',
          changes: { stock_number: input.stock_number },
        });
        return r.rows[0]!;
      });
      return await reply.status(201).send(withTotalCost(vehicle));
    } catch (err) {
      throw conflictFrom(err) ?? err;
    }
  });

  app.get('/api/v1/vehicles/:id', async (request, reply) => {
    const vehicleId = idParam(request);
    const user = sessionUser(request);
    const vehicle = await withUser(pool, user.id, async (c) => {
      const r = await c.query<Record<string, unknown>>(
        `SELECT v.* FROM vehicles v
         JOIN organizations o ON o.id = v.organization_id AND o.deleted_at IS NULL
         WHERE v.id = $1 AND v.deleted_at IS NULL`,
        [vehicleId],
      );
      if (r.rows.length === 0) throw notFound();
      return r.rows[0]!;
    });
    return reply.send(withTotalCost(vehicle));
  });

  app.get('/api/v1/vehicles', async (request, reply) => {
    const query = parseOrThrow(VehicleListQuery, request.query);
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
        const r = await c.query<{ organization_id: string }>(
          `SELECT DISTINCT m.organization_id FROM memberships m
           JOIN organizations o ON o.id = m.organization_id AND o.deleted_at IS NULL
           WHERE m.status = 'active'`,
        );
        if (r.rows.length === 0) return { items: [], next_cursor: null };
        if (r.rows.length > 1) {
          throw new AppError(400, 'organization_required', 'Pass organization_id — you belong to several organizations');
        }
        orgId = r.rows[0]!.organization_id;
      }
      let sql = `SELECT * FROM vehicles WHERE organization_id = $1 AND deleted_at IS NULL`;
      const params: unknown[] = [orgId];
      for (const [key, value] of [
        ['store_id', query.store_id],
        ['deal_status', query.deal_status],
        ['location_status', query.location_status],
      ] as const) {
        if (value) {
          params.push(value);
          sql += ` AND ${key} = $${params.length}`;
        }
      }
      return keysetPage<Record<string, unknown> & { id: string }>(c, sql, params, query);
    });
    return reply.send({ ...page, items: page.items.map(withTotalCost) });
  });

  app.patch('/api/v1/vehicles/:id', async (request, reply) => {
    const vehicleId = idParam(request);
    const input = parseOrThrow(UpdateVehicleInput, request.body);
    const user = sessionUser(request);
    const orgId = await vehicleOrg(pool, user.id, vehicleId);
    try {
      const vehicle = await withTenant(pool, orgId, async (c) => {
        await requireMember(c, user.id);
        const beforeRow = await c.query<Record<string, unknown>>(
          `SELECT * FROM vehicles WHERE id = $1 AND deleted_at IS NULL`,
          [vehicleId],
        );
        if (beforeRow.rows.length === 0) throw notFound();
        const prior = beforeRow.rows[0]!;

        const fields = Object.entries(input);
        if (fields.length === 0) return prior;
        const sets = fields.map(([k], i) => `${k} = $${i + 2}`).join(', ');
        const r = await c.query<Record<string, unknown>>(
          `UPDATE vehicles SET ${sets} WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
          [vehicleId, ...fields.map(([, v]) => v)],
        );
        if (r.rows.length === 0) throw notFound();
        const changed = diff(prior, input as Record<string, unknown>, Object.keys(input));
        if (Object.keys(changed).length > 0) {
          await recordEvent(c, {
            organizationId: orgId,
            storeId: String(prior['store_id']),
            actorUserId: user.id,
            entityType: 'vehicle',
            entityId: vehicleId,
            action: 'updated',
            changes: changed,
          });
        }
        return r.rows[0]!;
      });
      return await reply.send(withTotalCost(vehicle));
    } catch (err) {
      throw conflictFrom(err) ?? err;
    }
  });

  app.delete('/api/v1/vehicles/:id', async (request, reply) => {
    const vehicleId = idParam(request);
    const user = sessionUser(request);
    const orgId = await vehicleOrg(pool, user.id, vehicleId);
    await withTenant(pool, orgId, async (c) => {
      await requireMember(c, user.id, STORE_WRITE_ROLES);
      // A car that is spoken for must not vanish from under its deal.
      const r = await c.query<{ deal_status: string }>(
        `SELECT deal_status FROM vehicles WHERE id = $1 AND deleted_at IS NULL`,
        [vehicleId],
      );
      if (r.rows.length === 0) throw notFound();
      if (['reserved', 'sold_pending'].includes(r.rows[0]!.deal_status)) {
        throw new AppError(409, 'conflict', 'This vehicle is committed to a deal', [
          { path: 'deal_status', code: 'vehicle_committed', message: 'Release it from the deal first' },
        ]);
      }
      const gone = await c.query(
        `UPDATE vehicles SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
        [vehicleId],
      );
      // Only when a row actually moved — a second DELETE deletes nothing.
      if (gone.rows.length > 0) {
        await recordEvent(c, {
          organizationId: orgId, actorUserId: user.id,
          entityType: 'vehicle', entityId: vehicleId, action: 'deleted',
        });
      }
    });
    return reply.status(204).send();
  });
}
