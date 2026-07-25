import type { FastifyInstance } from 'fastify';
import { withTenant, withUser, type Pool, type PoolClient } from '@dealpilot/db';
import { canTransition, driverRequirement, releasesResources } from '@dealpilot/core';
import {
  CreateChaserInput,
  CreateDispatchInput,
  CreatePlateInput,
  DispatchListQuery,
  FleetListQuery,
  UpdateChaserInput,
  UpdateDispatchInput,
  UpdatePlateInput,
} from '@dealpilot/schemas';
import { AppError, notFound, parseOrThrow } from './errors.js';
import { conflictFrom, idParam, keysetPage, requireMember, sessionUser } from './f01-routes.js';
import { recordEvent } from './activity.js';

/**
 * F-11 dispatch (dispatch-transport.md). Who drives the car to the customer,
 * on which plate, followed by which chaser, and whether any of that collides
 * with another delivery the same afternoon.
 *
 * The rules live in packages/core and are golden-tested there; this module is
 * the data and the transactions around them. Two things it is careful about:
 *
 *  - a conflict NEVER blocks a booking. It flags it and leaves the resources on
 *    the board, because a dispatcher looking at a flagged run can fix it, while
 *    a plate silently marked in-use by a double-booking cannot be found;
 *  - resources are released in the SAME transaction that ends the run, so a
 *    plate can never be stuck in-use by a half-finished completion.
 */

/** Who may touch the fleet and the board. */
const DISPATCH_ROLES = ['owner', 'gm', 'logistics'] as const;

export function registerF11Routes(app: FastifyInstance, pool: Pool): void {
  // ---- fleet: chasers -----------------------------------------------------
  app.post('/api/v1/chasers', async (request, reply) => {
    const input = parseOrThrow(CreateChaserInput, request.body);
    const user = sessionUser(request);
    try {
      const row = await withTenant(pool, input.organization_id, async (c) => {
        await requireMember(c, user.id, DISPATCH_ROLES);
        await requireLiveStore(c, input.store_id);
        const r = await c.query<Record<string, unknown>>(
          `INSERT INTO chaser_vehicles (organization_id, store_id, name) VALUES ($1,$2,$3) RETURNING *`,
          [input.organization_id, input.store_id, input.name],
        );
        return r.rows[0]!;
      });
      return await reply.status(201).send(row);
    } catch (err) {
      throw conflictFrom(err) ?? err;
    }
  });

  app.get('/api/v1/chasers', async (request, reply) => {
    const query = parseOrThrow(FleetListQuery, request.query);
    const user = sessionUser(request);
    const orgId = await resolveOrg(pool, user.id, query.organization_id);
    const page = await withTenant(pool, orgId, async (c) => {
      await requireMember(c, user.id);
      const params: unknown[] = [orgId];
      let where = 'organization_id = $1 AND deleted_at IS NULL';
      for (const [col, val] of [['store_id', query.store_id], ['status', query.status]] as const) {
        if (val) {
          params.push(val);
          where += ` AND ${col} = $${params.length}`;
        }
      }
      return keysetPage(c, `SELECT * FROM chaser_vehicles WHERE ${where}`, params, query);
    });
    return reply.send(page);
  });

  app.patch('/api/v1/chasers/:id', async (request, reply) => {
    const id = idParam(request);
    const input = parseOrThrow(UpdateChaserInput, request.body);
    const user = sessionUser(request);
    const orgId = await rowOrg(pool, user.id, 'chaser_vehicles', id);
    const row = await withTenant(pool, orgId, async (c) => {
      await requireMember(c, user.id, DISPATCH_ROLES);
      return updateRow(c, 'chaser_vehicles', id, input);
    });
    return reply.send(row);
  });

  // ---- fleet: dealer plates ----------------------------------------------
  app.post('/api/v1/plates', async (request, reply) => {
    const input = parseOrThrow(CreatePlateInput, request.body);
    const user = sessionUser(request);
    try {
      const row = await withTenant(pool, input.organization_id, async (c) => {
        await requireMember(c, user.id, DISPATCH_ROLES);
        await requireLiveStore(c, input.store_id);
        const r = await c.query<Record<string, unknown>>(
          `INSERT INTO dealer_plates (organization_id, store_id, plate_number) VALUES ($1,$2,$3) RETURNING *`,
          [input.organization_id, input.store_id, input.plate_number],
        );
        return r.rows[0]!;
      });
      return await reply.status(201).send(row);
    } catch (err) {
      throw conflictFrom(err) ?? err;
    }
  });

  app.get('/api/v1/plates', async (request, reply) => {
    const query = parseOrThrow(FleetListQuery, request.query);
    const user = sessionUser(request);
    const orgId = await resolveOrg(pool, user.id, query.organization_id);
    const page = await withTenant(pool, orgId, async (c) => {
      await requireMember(c, user.id);
      const params: unknown[] = [orgId];
      let where = 'organization_id = $1 AND deleted_at IS NULL';
      for (const [col, val] of [['store_id', query.store_id], ['status', query.status]] as const) {
        if (val) {
          params.push(val);
          where += ` AND ${col} = $${params.length}`;
        }
      }
      return keysetPage(c, `SELECT * FROM dealer_plates WHERE ${where}`, params, query);
    });
    return reply.send(page);
  });

  app.patch('/api/v1/plates/:id', async (request, reply) => {
    const id = idParam(request);
    const input = parseOrThrow(UpdatePlateInput, request.body);
    const user = sessionUser(request);
    const orgId = await rowOrg(pool, user.id, 'dealer_plates', id);
    const row = await withTenant(pool, orgId, async (c) => {
      await requireMember(c, user.id, DISPATCH_ROLES);
      return updateRow(c, 'dealer_plates', id, input);
    });
    return reply.send(row);
  });

  // ---- the board ----------------------------------------------------------
  /**
   * Book a run. The server picks the plate and chaser: the caller does not get
   * to choose, because choosing is where double-bookings come from.
   */
  app.post('/api/v1/dispatch', async (request, reply) => {
    const input = parseOrThrow(CreateDispatchInput, request.body);
    const user = sessionUser(request);
    const orgId = await rowOrg(pool, user.id, 'deals', input.deal_id);

    const assignment = await withTenant(pool, orgId, async (c) => {
      await requireMember(c, user.id, DISPATCH_ROLES);

      const deal = await c.query<{
        store_id: string; trade_allowance_cents: number; trade_acv_cents: number;
        trade_lien_cents: number; booked_delivery_at: Date | null; window_hours: number;
      }>(
        `SELECT d.store_id, d.trade_allowance_cents, d.trade_acv_cents, d.trade_lien_cents,
                d.booked_delivery_at,
                s.dispatch_conflict_window_hours AS window_hours
         FROM deals d JOIN stores s ON s.id = d.store_id
         WHERE d.id = $1 AND d.deleted_at IS NULL`,
        [input.deal_id],
      );
      if (deal.rows.length === 0) throw notFound();
      const d = deal.rows[0]!;

      const bookedAt = input.booked_delivery_at ? new Date(input.booked_delivery_at) : d.booked_delivery_at;
      if (!bookedAt) {
        // Without a delivery time there is nothing to schedule against and no
        // conflict can be computed — booking blind is worse than refusing.
        throw new AppError(422, 'validation_failed', 'This deal has no booked delivery time', [
          { path: 'booked_delivery_at', code: 'required', message: 'Set a delivery time first' },
        ]);
      }
      if (input.booked_delivery_at) {
        await c.query(`UPDATE deals SET booked_delivery_at = $2 WHERE id = $1`, [input.deal_id, bookedAt]);
      }

      // §4: the rule, from packages/core.
      // The SAME definition the money engine uses (f05 toEngineInput): a
      // lien-only trade is still a car the driver drives back. Getting this
      // wrong books a chaser and a second driver for a run that needs neither.
      const hasTradeIn =
        (d.trade_allowance_cents ?? 0) > 0 ||
        (d.trade_acv_cents ?? 0) > 0 ||
        (d.trade_lien_cents ?? 0) > 0;
      const { numDrivers, needsChaser } = driverRequirement(hasTradeIn);

      const plate = await pickResource(c, 'dealer_plates', d.store_id, input.deal_id, bookedAt, d.window_hours);
      if (!plate) {
        // The store owns no plates at all — a setup problem, not a scheduling one.
        throw new AppError(409, 'no_plate_available', 'This store has no dealer plates', [
          { path: 'dealer_plate_id', code: 'no_plate_available', message: 'Add a dealer plate first' },
        ]);
      }
      const chaser = needsChaser
        ? await pickResource(c, 'chaser_vehicles', d.store_id, input.deal_id, bookedAt, d.window_hours)
        : null;
      if (needsChaser && !chaser) {
        throw new AppError(409, 'no_chaser_available', 'This store has no chaser vehicles', [
          { path: 'chaser_vehicle_id', code: 'no_chaser_available', message: 'Add a chaser vehicle first' },
        ]);
      }

      // §6, fixed twice over: the window compares BOOKED DELIVERY TIMES rather
      // than booking timestamps, and it is now REACHABLE — the picker offers a
      // colliding resource instead of hiding it behind "in use".
      const clashes: string[] = [];
      if (plate.conflictWith) {
        clashes.push(
          `Dealer plate ${plate.resource.label} is already booked for deal ${plate.conflictWith} within ${d.window_hours} hours`,
        );
      }
      if (chaser?.conflictWith) {
        clashes.push(
          `Chaser ${chaser.resource.label} is already booked for deal ${chaser.conflictWith} within ${d.window_hours} hours`,
        );
      }
      const conflict = { flag: clashes.length > 0, reason: clashes.length > 0 ? clashes.join('; ') : null };

      const r = await c.query<Record<string, unknown>>(
        `INSERT INTO dispatch_assignments
           (organization_id, store_id, deal_id, chaser_vehicle_id, dealer_plate_id,
            has_trade_in, num_drivers_needed, dispatch_company, status,
            conflict_flag, conflict_reason, assigned_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'assigned',$9,$10, now())
         RETURNING *`,
        [
          orgId, d.store_id, input.deal_id, chaser?.resource.id ?? null, plate.resource.id,
          hasTradeIn, numDrivers, input.dispatch_company ?? null,
          conflict.flag, conflict.reason,
        ],
      );

      // Booking does NOT take a resource off the board: it reserves a TIME. The
      // status flips when the run actually departs, which is when the plate is
      // physically gone. Pairing the plate to the chaser carrying it (§2).
      if (chaser) {
        await c.query(`UPDATE dealer_plates SET assigned_chaser_id = $2 WHERE id = $1`, [
          plate.resource.id,
          chaser.resource.id,
        ]);
      }

      await recordEvent(c, {
        organizationId: orgId,
        storeId: d.store_id,
        actorUserId: user.id,
        entityType: 'dispatch_assignment',
        entityId: String(r.rows[0]!['id']),
        action: 'created',
        parentEntityType: 'deal',
        parentEntityId: input.deal_id,
        changes: { drivers: numDrivers, chaser: needsChaser, conflict: conflict.flag },
        reason: conflict.reason,
      });
      return r.rows[0]!;
    }).catch((err: unknown) => {
      // One live run per deal (partial unique index). Without this it surfaced
      // as a 500 — the only create route in the repo that lacked the mapping.
      const mapped = conflictFrom(err);
      if (mapped) throw mapped;
      throw err;
    });
    return reply.status(201).send(assignment);
  });

  app.get('/api/v1/dispatch', async (request, reply) => {
    const query = parseOrThrow(DispatchListQuery, request.query);
    const user = sessionUser(request);
    const orgId = await resolveOrg(pool, user.id, query.organization_id);
    const page = await withTenant(pool, orgId, async (c) => {
      // The board carries driver names and phone numbers, so it is not a
      // general read: spec §11 scopes dispatch to logistics/gm/owner.
      await requireMember(c, user.id, DISPATCH_ROLES);
      const params: unknown[] = [orgId];
      let where = 'organization_id = $1 AND deleted_at IS NULL';
      for (const [col, val] of [['store_id', query.store_id], ['status', query.status]] as const) {
        if (val) {
          params.push(val);
          where += ` AND ${col} = $${params.length}`;
        }
      }
      // The logistics dashboard's one job: what needs a human today.
      if (query.conflicts_only) where += ` AND conflict_flag = true`;
      return keysetPage(c, `SELECT * FROM dispatch_assignments WHERE ${where}`, params, query);
    });
    return reply.send(page);
  });

  /**
   * Move a run along, or record the driver and ETAs. Ending it — completed or
   * cancelled — puts the plate and chaser back in the SAME transaction.
   */
  app.patch('/api/v1/dispatch/:id', async (request, reply) => {
    const id = idParam(request);
    const input = parseOrThrow(UpdateDispatchInput, request.body);
    const user = sessionUser(request);
    const orgId = await rowOrg(pool, user.id, 'dispatch_assignments', id);

    const updated = await withTenant(pool, orgId, async (c) => {
      await requireMember(c, user.id, DISPATCH_ROLES);
      const before = await c.query<Record<string, unknown>>(
        `SELECT * FROM dispatch_assignments WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [id],
      );
      if (before.rows.length === 0) throw notFound();
      const prior = before.rows[0]!;
      const from = String(prior['status']);

      // An ended run is history. Letting a driver name or an ETA be edited
      // after the fact would quietly rewrite what the customer was told.
      if ((from === 'completed' || from === 'cancelled')) {
        throw new AppError(409, 'run_ended', 'This dispatch run has ended', [
          { path: 'status', code: 'run_ended', message: `Already ${from}` },
        ]);
      }
      if (input.status && input.status !== from && !canTransition(from, input.status)) {
        throw new AppError(422, 'invalid_transition', `A run cannot go from ${from} to ${input.status}`, [
          { path: 'status', code: 'invalid_transition', message: `${from} → ${input.status}` },
        ]);
      }

      const sets: string[] = [];
      const params: unknown[] = [id];
      for (const [k, v] of Object.entries(input)) {
        if (!DISPATCH_COLUMNS.has(k)) continue;
        params.push(v);
        sets.push(`${k} = $${params.length}`);
      }
      // The board tells a customer where their car is, so the timestamps are
      // stamped by the server when the step actually happens.
      if (input.status === 'departed') sets.push('actual_departure = now()');
      if (input.status === 'arrived') sets.push('actual_arrival = now()');
      if (input.status && releasesResources(input.status)) sets.push('completed_at = now()');
      if (sets.length === 0) return prior;

      const r = await c.query<Record<string, unknown>>(
        `UPDATE dispatch_assignments SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
        params,
      );

      // Departing is when the plate and chaser physically leave the lot.
      if (input.status === 'departed' && from !== 'departed') {
        if (prior['dealer_plate_id']) {
          await c.query(`UPDATE dealer_plates SET status = 'in_use' WHERE id = $1`, [prior['dealer_plate_id']]);
        }
        if (prior['chaser_vehicle_id']) {
          await c.query(`UPDATE chaser_vehicles SET status = 'in_use' WHERE id = $1`, [prior['chaser_vehicle_id']]);
        }
      }

      if (input.status && releasesResources(input.status) && !releasesResources(from)) {
        // Same transaction as the status change: a plate can never be left
        // in-use by a completion that half-happened.
        if (prior['dealer_plate_id']) {
          await c.query(
            `UPDATE dealer_plates SET status = 'available', assigned_chaser_id = NULL WHERE id = $1`,
            [prior['dealer_plate_id']],
          );
        }
        if (prior['chaser_vehicle_id']) {
          await c.query(`UPDATE chaser_vehicles SET status = 'available' WHERE id = $1`, [prior['chaser_vehicle_id']]);
        }
      }

      if (input.status && input.status !== from) {
        await recordEvent(c, {
          organizationId: orgId,
          storeId: String(prior['store_id']),
          actorUserId: user.id,
          entityType: 'dispatch_assignment',
          entityId: id,
          action: 'stage_changed',
          parentEntityType: 'deal',
          parentEntityId: String(prior['deal_id']),
          changes: { status: { from, to: input.status } },
        });
      }
      return r.rows[0]!;
    });
    return reply.send(updated);
  });
}

const DISPATCH_COLUMNS = new Set([
  'status', 'dispatch_company', 'driver_name', 'driver_phone', 'driver_vehicle',
  'eta_departure', 'eta_arrival',
]);

interface Resource { id: string; label: string }

/**
 * Pick a resource for a delivery at `bookedAt`.
 *
 * A plate is booked for a TIME, not forever. The first cut marked it `in_use`
 * the moment a run was booked, which meant a plate booked for Friday was
 * unavailable on Tuesday — and, worse, that a genuine same-afternoon collision
 * could never be DETECTED, because the colliding plate was never offered a
 * second time. The feature's headline behaviour (conflicts flag, they never
 * block) was unreachable: a real double-booking surfaced as "no plate
 * available", the exact opposite of the rule.
 *
 * So availability is a question about the CALENDAR: a resource is free for this
 * delivery when none of its live runs falls inside the store's window. If every
 * candidate collides we still return the best one — flagged — because a
 * dispatcher can resolve a flagged run, and refusing to book leaves them
 * nothing to look at.
 *
 * `status` on the row now means what it says: physically out with a driver.
 */
async function pickResource(
  client: PoolClient,
  table: 'dealer_plates' | 'chaser_vehicles',
  storeId: string,
  dealId: string,
  bookedAt: Date,
  windowHours: number,
): Promise<{ resource: Resource; conflictWith: string | null } | null> {
  const labelCol = table === 'dealer_plates' ? 'plate_number' : 'name';
  const idCol = table === 'dealer_plates' ? 'dealer_plate_id' : 'chaser_vehicle_id';

  // Every candidate with the nearest colliding delivery, if it has one. The
  // window is applied in SQL, so a busy store does not drag every historical
  // assignment into memory. FOR UPDATE holds the rows to COMMIT, so two
  // concurrent bookings cannot both take the same conflict-free plate.
  const r = await client.query<{ id: string; label: string; clash_deal: string | null }>(
    `SELECT f.id, f.${labelCol} AS label,
            (SELECT a.deal_id
             FROM dispatch_assignments a
             JOIN deals d ON d.id = a.deal_id AND d.deleted_at IS NULL
             WHERE a.${idCol} = f.id
               AND a.deal_id <> $2
               AND a.deleted_at IS NULL
               AND a.status IN ('pending','assigned','departed','arrived')
               AND d.booked_delivery_at IS NOT NULL
               AND abs(extract(epoch FROM (d.booked_delivery_at - $3::timestamptz))) < $4 * 3600
             ORDER BY abs(extract(epoch FROM (d.booked_delivery_at - $3::timestamptz)))
             LIMIT 1) AS clash_deal
     FROM ${table} f
     WHERE f.store_id = $1 AND f.deleted_at IS NULL
     ORDER BY f.created_at
     FOR UPDATE OF f`,
    [storeId, dealId, bookedAt, windowHours],
  );
  if (r.rows.length === 0) return null;

  const free = r.rows.find((row) => row.clash_deal === null);
  if (free) return { resource: { id: free.id, label: free.label }, conflictWith: null };
  const first = r.rows[0]!;
  return { resource: { id: first.id, label: first.label }, conflictWith: first.clash_deal };
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

/** Column names come from this list, never from request keys. */
const FLEET_COLUMNS = new Set(['name', 'plate_number']);

async function updateRow(
  client: PoolClient,
  table: 'chaser_vehicles' | 'dealer_plates',
  id: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const fields = Object.entries(input).filter(([k]) => FLEET_COLUMNS.has(k));
  if (fields.length === 0) {
    const r = await client.query<Record<string, unknown>>(
      `SELECT * FROM ${table} WHERE id = $1 AND deleted_at IS NULL`, [id],
    );
    if (r.rows.length === 0) throw notFound();
    return r.rows[0]!;
  }
  const sets = fields.map(([k], n) => `${k} = $${n + 2}`).join(', ');
  const r = await client.query<Record<string, unknown>>(
    `UPDATE ${table} SET ${sets} WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    [id, ...fields.map(([, v]) => v)],
  );
  if (r.rows.length === 0) throw notFound();
  return r.rows[0]!;
}

async function resolveOrg(pool: Pool, userId: string, selector?: string): Promise<string> {
  const orgs = await withUser(pool, userId, async (c) => {
    const r = await c.query<{ organization_id: string }>(
      `SELECT DISTINCT m.organization_id FROM memberships m
       JOIN organizations o ON o.id = m.organization_id AND o.deleted_at IS NULL
       WHERE m.status = 'active'`,
    );
    return r.rows.map((x) => x.organization_id);
  });
  if (selector) {
    if (!orgs.includes(selector)) throw notFound();
    return selector;
  }
  if (orgs.length === 0) throw notFound();
  if (orgs.length > 1) {
    throw new AppError(400, 'organization_required', 'Pass organization_id — you belong to several organizations');
  }
  return orgs[0]!;
}

/** Which of the caller's organizations owns this row — 404 if none does. */
async function rowOrg(
  pool: Pool,
  userId: string,
  // A closed union, not a bare string: this is the one signature in the module
  // that would otherwise accept a variable table name without a type error.
  table: 'deals' | 'dealer_plates' | 'chaser_vehicles' | 'dispatch_assignments',
  id: string,
): Promise<string> {
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
      const r = await c.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id]);
      return r.rows.length > 0;
    });
    if (found) return orgId;
  }
  throw notFound();
}
