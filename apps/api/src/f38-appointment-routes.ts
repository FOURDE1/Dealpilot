import type { FastifyInstance } from 'fastify';
import { withTenant, withUser, type Pool } from '@dealpilot/db';
import {
  AppointmentListQuery,
  CancelAppointmentInput,
  CreateAppointmentInput,
  UpdateAppointmentInput,
} from '@dealpilot/schemas';
import { AppError, notFound, parseOrThrow } from './errors.js';
import { idParam, sessionUser } from './f01-routes.js';
import { requirePermission } from './permissions.js';
import { recordEvent } from './activity.js';

/**
 * F-38 — the appointments console (conversation-engine.md §4).
 *
 * The assistant has booked appointments since F-33; these routes are how a
 * PERSON sees the board, takes one, and cancels one. Reuses `lead:*`
 * permissions on the F-35 precedent: an appointment is lead work, and a
 * separate `appointment:*` permission would be a screen the owner has to
 * configure to express a distinction that does not exist.
 *
 * Cancelling is its own endpoint, not a status value on PATCH. The 0037 CHECK
 * requires a cancellation to say when AND why; a separate endpoint makes the
 * reason unskippable by construction instead of by validation.
 */

/**
 * The board's hard ceiling. Bounded rather than cursor-paginated on purpose:
 * the upcoming window IS the bound (a rooftop with 300 future appointments has
 * a different problem), and a cursor over `starts_at` would paginate a list
 * whose whole point is being seen at once. The pipeline board set this
 * precedent — bounded, with an explicit truncated flag, never silently cut.
 */
const BOARD_LIMIT = 200;

async function appointmentOrg(pool: Pool, userId: string, id: string): Promise<string> {
  return withUser(pool, userId, async (c) => {
    // Visible under withUser via appointments_member_read (0044) — written
    // BEFORE this route existed, because contacts (D-046) and deal_parties
    // both shipped without it and read as broken for everybody.
    const r = await c.query<{ organization_id: string }>(
      `SELECT organization_id FROM appointments WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (r.rows.length === 0) throw notFound();
    return r.rows[0]!.organization_id;
  });
}

export function registerF38Routes(app: FastifyInstance, pool: Pool): void {
  app.get('/api/v1/appointments', async (request, reply) => {
    const query = parseOrThrow(AppointmentListQuery, request.query);
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
        if (r.rows.length === 0) return { items: [], truncated: false };
        if (r.rows.length > 1) {
          throw new AppError(400, 'organization_required', 'Pass organization_id — you belong to several organizations');
        }
        orgId = r.rows[0]!.organization_id;
      }

      let sql = `SELECT * FROM appointments WHERE organization_id = $1 AND deleted_at IS NULL`;
      const params: unknown[] = [orgId];
      for (const [key, value] of [
        ['store_id', query.store_id],
        ['lead_id', query.lead_id],
        ['status', query.status],
      ] as const) {
        if (value) {
          params.push(value);
          sql += ` AND ${key} = $${params.length}`;
        }
      }
      if (query.upcoming) {
        // The board shows what still needs somebody: future, not yet resolved.
        sql += ` AND ends_at > now()`;
        if (!query.status) sql += ` AND status IN ('booked','confirmed')`;
      }
      params.push(BOARD_LIMIT + 1);
      sql += ` ORDER BY starts_at ${query.upcoming ? 'ASC' : 'DESC'}, id LIMIT $${params.length}`;

      const r = await c.query<Record<string, unknown>>(sql, params);
      const truncated = r.rows.length > BOARD_LIMIT;
      return { items: truncated ? r.rows.slice(0, BOARD_LIMIT) : r.rows, truncated };
    });
    return reply.send(page);
  });

  app.post('/api/v1/appointments', async (request, reply) => {
    const input = parseOrThrow(CreateAppointmentInput, request.body);
    const user = sessionUser(request);
    const appointment = await withTenant(pool, input.organization_id, async (c) => {
      await requirePermission(c, user.id, 'lead:update');
      const store = await c.query(
        `SELECT 1 FROM stores WHERE id = $1 AND deleted_at IS NULL AND status <> 'closed'`,
        [input.store_id],
      );
      if (store.rows.length === 0) {
        throw new AppError(422, 'validation_failed', 'Unknown store for this organization', [
          { path: 'store_id', code: 'invalid_reference', message: 'Store not found in this organization (or closed)' },
        ]);
      }
      if (input.lead_id) {
        const lead = await c.query(`SELECT 1 FROM leads WHERE id = $1 AND deleted_at IS NULL`, [input.lead_id]);
        if (lead.rows.length === 0) {
          throw new AppError(422, 'validation_failed', 'Unknown lead for this organization', [
            { path: 'lead_id', code: 'invalid_reference', message: 'Lead not found in this organization' },
          ]);
        }
      }
      const r = await c.query<Record<string, unknown>>(
        `INSERT INTO appointments
           (organization_id, store_id, lead_id, kind, starts_at, ends_at,
            vehicle_stock_number, notes, booked_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'agent')
         RETURNING *`,
        [
          input.organization_id, input.store_id, input.lead_id ?? null, input.kind,
          input.starts_at, input.ends_at, input.vehicle_stock_number ?? null, input.notes ?? null,
        ],
      );
      await recordEvent(c, {
        organizationId: input.organization_id,
        storeId: input.store_id,
        actorUserId: user.id,
        entityType: 'appointment',
        entityId: String(r.rows[0]!['id']),
        action: 'created',
      });
      return r.rows[0]!;
    });
    return reply.status(201).send(appointment);
  });

  app.patch('/api/v1/appointments/:id', async (request, reply) => {
    const id = idParam(request);
    const input = parseOrThrow(UpdateAppointmentInput, request.body);
    const user = sessionUser(request);
    const orgId = await appointmentOrg(pool, user.id, id);

    const appointment = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'lead:update');
      const prior = await c.query<Record<string, unknown>>(
        `SELECT * FROM appointments WHERE id = $1 AND deleted_at IS NULL`, [id],
      );
      if (prior.rows.length === 0) throw notFound();
      if (prior.rows[0]!['status'] === 'cancelled') {
        // A cancelled appointment is a record, not a slot. Reviving one would
        // erase the cancellation the 0037 CHECK exists to preserve — book a
        // new one instead.
        throw new AppError(422, 'appointment_cancelled', 'This appointment was cancelled — book a new one.', [
          { path: 'status', code: 'appointment_cancelled', message: 'Cancelled appointments cannot be edited' },
        ]);
      }

      if (input.assigned_agent_id) {
        const member = await c.query(
          `SELECT 1 FROM memberships
            WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`,
          [orgId, input.assigned_agent_id],
        );
        if (member.rows.length === 0) {
          throw new AppError(422, 'unknown_agent', 'That person is not an active member here.', [
            { path: 'assigned_agent_id', code: 'unknown_agent', message: 'Assignee must be an active member of this organization' },
          ]);
        }
      }

      const sets: string[] = [];
      const params: unknown[] = [id];
      for (const [key, value] of Object.entries(input)) {
        if (value === undefined) continue;
        params.push(value);
        sets.push(`${key} = $${params.length}`);
      }
      const r = await c.query<Record<string, unknown>>(
        `UPDATE appointments SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
        params,
      );

      const wasAssigned = prior.rows[0]!['assigned_agent_id'];
      const nowAssigned = r.rows[0]!['assigned_agent_id'];
      await recordEvent(c, {
        organizationId: orgId,
        storeId: String(r.rows[0]!['store_id']),
        actorUserId: user.id,
        entityType: 'appointment',
        entityId: id,
        action: wasAssigned !== nowAssigned ? (nowAssigned ? 'assigned' : 'unassigned') : 'updated',
        changes: Object.fromEntries(
          Object.entries(input).filter(([, v]) => v !== undefined).map(([k, v]) => [k, { to: v }]),
        ),
      });
      return r.rows[0]!;
    });
    return reply.send(appointment);
  });

  app.post('/api/v1/appointments/:id/cancel', async (request, reply) => {
    const id = idParam(request);
    const input = parseOrThrow(CancelAppointmentInput, request.body);
    const user = sessionUser(request);
    const orgId = await appointmentOrg(pool, user.id, id);

    const appointment = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'lead:update');
      // One statement sets all three cancellation facts, so the 0037 CHECKs
      // can never see a half-cancelled row; the status guard in the WHERE makes
      // a double-cancel a clean 422 instead of overwriting the first reason.
      const r = await c.query<Record<string, unknown>>(
        `UPDATE appointments
            SET status = 'cancelled', cancelled_at = now(), cancelled_reason = $2
          WHERE id = $1 AND deleted_at IS NULL AND status <> 'cancelled'
          RETURNING *`,
        [id, input.reason],
      );
      if (r.rows.length === 0) {
        const exists = await c.query(`SELECT 1 FROM appointments WHERE id = $1 AND deleted_at IS NULL`, [id]);
        if (exists.rows.length === 0) throw notFound();
        throw new AppError(422, 'already_cancelled', 'This appointment is already cancelled.', [
          { path: 'reason', code: 'already_cancelled', message: 'The first cancellation and its reason stand' },
        ]);
      }
      await recordEvent(c, {
        organizationId: orgId,
        storeId: String(r.rows[0]!['store_id']),
        actorUserId: user.id,
        entityType: 'appointment',
        entityId: id,
        action: 'updated',
        changes: { status: { to: 'cancelled' }, cancelled_reason: { to: input.reason } },
      });
      return r.rows[0]!;
    });
    return reply.send(appointment);
  });
}
