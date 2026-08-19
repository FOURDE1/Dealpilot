import type { FastifyInstance } from 'fastify';
import { withTenant, withUser, type Pool, type PoolClient } from '@dealpilot/db';
import {
  CreateStaffScheduleInput,
  StaffScheduleListQuery,
  UpdateStaffScheduleInput,
} from '@dealpilot/schemas';
import { cascadeAssign, CASCADE_STRATEGY, type CascadeCandidate, type CascadeDecision } from '@dealpilot/core';
import { AppError, notFound, parseOrThrow } from './errors.js';
import { requirePermission } from './permissions.js';
import { recordEvent } from './activity.js';
import { callerOrgIds, idParam, keysetPage, requireMember, sessionUser } from './f01-routes.js';
import type { ReassignQueue } from './reassign-queue.js';
import type { PresenceStore } from './presence.js';
import { notify } from './notifications.js';
import { NO_EMITTER, type Emitter } from '@dealpilot/contracts';

/**
 * F-42 — the §7.3 assignment cascade and the staff-schedule grid it reads
 * (FR-LEAD-009 / FR-LEAD-015, D-045).
 *
 * The funnel's math is golden-tested in @dealpilot/core (13 cases); what this
 * file owns is the WIRING: the candidate query (languages, capacity, and the
 * store-timezone schedule verdict), the escalation ladder query, persistence
 * (lead row + history + activity), and the schedule CRUD that feeds step 3.
 *
 * Presence (step 2) is wired as NULL for every candidate until FR-LEAD-014
 * ships a presence source — the engine's tri-state contract (D-045 #1) makes
 * that an explicit "unknown", not a lie.
 */

const TERMINAL_STATUSES = "('converted','lost','expired')";

interface CandidateRow {
  user_id: string;
  languages: string[];
  max_active_leads: number;
  active_count: number;
  scheduled_now: boolean | null;
}

/**
 * Run the funnel for one lead and persist the outcome. Exported so the AI
 * pipeline can become a caller: f20's handOff still RECEIVES assignedAgentId
 * from its (future) caller — wiring this function into that path lands with
 * the conversation-engine slice, and until then the POST route below is the
 * only caller. Refusals come back as values; `already_assigned` mirrors
 * §7.2's rule — the auto path never takes a lead off somebody.
 */
export type CascadeAssignOutcome =
  | (CascadeDecision & { attempt?: number })
  | { outcome: 'already_assigned'; lead_id: string };

export async function cascadeAssignLead(
  c: PoolClient,
  organizationId: string,
  leadId: string,
  actorUserId: string | null,
  /**
   * method: FR-LEAD-010's re-run stamps 'reassignment' instead of the funnel
   * method. presence: F-43's store — absent means step 2 reads unknown.
   */
  opts: { method?: 'reassignment'; presence?: PresenceStore } = {},
): Promise<CascadeAssignOutcome> {
  const leadRow = await c.query<{
    preferred_language: string;
    assigned_to: string | null;
    source: string;
    previous_agents: unknown;
    assignment_attempts: number;
    first_name: string | null;
    last_name: string | null;
    phone: string;
  }>(
    `SELECT preferred_language, assigned_to, source, previous_agents, assignment_attempts,
            first_name, last_name, phone
     FROM leads WHERE id = $1 AND deleted_at IS NULL`,
    [leadId],
  );
  if (leadRow.rows.length === 0) throw notFound();
  const lead = leadRow.rows[0]!;
  if (lead.assigned_to !== null) return { outcome: 'already_assigned', lead_id: leadId };

  // FR-LEAD-010's ledger: [{user_id, ...}]. Tolerant read — the column is
  // jsonb with no CHECK, and a malformed entry must not crash assignment.
  const previousAgents = Array.isArray(lead.previous_agents)
    ? lead.previous_agents
        .map((e) => (typeof e === 'object' && e !== null ? String((e as Record<string, unknown>)['user_id'] ?? '') : ''))
        .filter((id) => id !== '')
    : [];

  // Roster order is the pool order, and it must be DETERMINISTIC — first-min
  // breaks the step-4 tie by position (same rule as §7.2). The schedule
  // verdict is tri-state: no active rows at all → NULL (always available,
  // D-045 #8); otherwise "is any window open right now, in that window's own
  // store timezone". Start inclusive, end exclusive.
  // One candidate per PERSON: a multi-store member holds several membership
  // rows (UNIQUE (user, org, store)); DISTINCT ON keeps the OLDEST row's
  // profile — and the f04 PATCH writes the profile across all of a user's
  // rows in the org, so the rows agree anyway.
  const roster = await c.query<CandidateRow>(
    `SELECT r.user_id, r.languages, r.max_active_leads, r.active_count, r.scheduled_now
     FROM (
       SELECT DISTINCT ON (m.user_id)
              m.user_id,
              m.preferred_languages AS languages,
              m.max_active_leads,
              m.created_at AS joined_at,
              (SELECT count(*)::int FROM leads l
                WHERE l.assigned_to = m.user_id AND l.deleted_at IS NULL
                  AND l.status NOT IN ${TERMINAL_STATUSES}) AS active_count,
              CASE
                WHEN NOT EXISTS (SELECT 1 FROM staff_schedules s
                                  WHERE s.user_id = m.user_id AND s.active) THEN NULL
                ELSE EXISTS (
                  SELECT 1 FROM staff_schedules s
                  JOIN stores st ON st.id = s.store_id
                  WHERE s.user_id = m.user_id AND s.active
                    AND s.day_of_week = EXTRACT(DOW FROM (now() AT TIME ZONE st.timezone))::int
                    AND (now() AT TIME ZONE st.timezone)::time >= s.start_time
                    AND (now() AT TIME ZONE st.timezone)::time <  s.end_time
                )
              END AS scheduled_now
       FROM memberships m
       WHERE m.organization_id = $1 AND m.status = 'active'
       ORDER BY m.user_id, m.created_at
     ) r
     ORDER BY r.joined_at, r.user_id`,
    [organizationId],
  );

  // F-43: tri-state per D-047 — null when this org has never produced
  // presence data (filter skipped), real booleans once it has.
  const online = opts.presence ? await opts.presence.onlineIn(organizationId) : null;
  const candidates: CascadeCandidate[] = roster.rows.map((r) => ({
    user_id: r.user_id,
    languages: r.languages,
    online: online === null ? null : online.has(r.user_id),
    scheduled_now: r.scheduled_now,
    active_count: r.active_count,
    max_active_leads: r.max_active_leads,
  }));

  // The escalation ladder (D-045 #4): sales_manager first, then gm, then
  // owner — somebody must own the lead. Membership age breaks ties.
  const managers = await escalationLadder(c, organizationId);

  const decision = cascadeAssign(
    { preferred_language: lead.preferred_language },
    candidates,
    previousAgents,
    managers,
  );
  if (decision.outcome === 'no_one') return decision;

  // Persist. Status bumps to 'assigned' only from the pre-human states —
  // a qualified lead re-entering the funnel keeps the truth it had. The
  // `assigned_to IS NULL` re-check closes the race two concurrent cascades
  // (or a cascade against a manual PATCH) would otherwise lose silently:
  // whoever commits second must NOT steal, and must not write history.
  const method = decision.outcome === 'assigned' ? (opts.method ?? decision.method) : decision.method;
  const won = await c.query(
    `UPDATE leads
     SET assigned_to = $2, assigned_at = now(), assignment_method = $3,
         status = CASE WHEN status IN ('new','chatbot_engaged') THEN 'assigned' ELSE status END
     WHERE id = $1 AND assigned_to IS NULL`,
    [leadId, decision.user_id, method],
  );
  if (won.rowCount === 0) return { outcome: 'already_assigned', lead_id: leadId };
  await c.query(
    `INSERT INTO lead_assignment_history
       (organization_id, lead_id, assigned_to, rule_id, rule_name, strategy, lead_source)
     VALUES ($1, $2, $3, NULL, $4, $5, $6)`,
    [
      organizationId, leadId, decision.user_id,
      decision.outcome === 'escalated' ? `escalation: ${decision.reason}` : `funnel: ${method}`,
      CASCADE_STRATEGY, lead.source,
    ],
  );
  await recordEvent(c, {
    organizationId,
    actorUserId,
    entityType: 'lead',
    entityId: leadId,
    action: 'assigned',
    changes: {
      assigned_to: { from: null, to: decision.user_id },
      assignment_method: method,
      via: 'cascade',
      ...(decision.outcome === 'escalated' ? { escalation_reason: decision.reason } : {}),
    },
  });
  // F-47: ring the new holder's bell — M9 for a routine assignment, HIGH for
  // an escalation (the manager needs to know WHY it landed on them). Never
  // self-notify: a person who assigned themself already knows.
  if (decision.user_id !== actorUserId) {
    const leadLabel = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.phone;
    await notify(c, {
      organizationId,
      userId: decision.user_id,
      urgency: decision.outcome === 'escalated' ? 'high' : 'medium',
      titleKey: decision.outcome === 'escalated' ? 'notif_lead_escalated' : 'notif_lead_assigned',
      params: decision.outcome === 'escalated'
        ? { lead: leadLabel, reason: decision.reason }
        : { lead: leadLabel },
      link: `/leads/${leadId}`,
      entityType: 'lead',
      entityId: leadId,
    });
  }
  return { ...decision, attempt: lead.assignment_attempts };
}

/**
 * The escalation ladder (D-045 #4): one user per PERSON, sales_manager first,
 * then gm, then owner, oldest membership breaking ties. Exported for the
 * FR-LEAD-010 worker's 3-strike direct assignment.
 */
export async function escalationLadder(c: PoolClient, organizationId: string): Promise<string[]> {
  const r = await c.query<{ user_id: string }>(
    `SELECT t.user_id FROM (
       SELECT m.user_id,
              bool_or('sales_manager' = ANY(m.roles)) AS is_sm,
              bool_or('gm' = ANY(m.roles)) AS is_gm,
              min(m.created_at) AS joined_at
       FROM memberships m
       WHERE m.organization_id = $1 AND m.status = 'active'
         AND m.roles && ARRAY['sales_manager','gm','owner']::text[]
       GROUP BY m.user_id
     ) t
     ORDER BY (CASE WHEN t.is_sm THEN 0 WHEN t.is_gm THEN 1 ELSE 2 END), t.joined_at, t.user_id`,
    [organizationId],
  );
  return r.rows.map((row) => row.user_id);
}

/**
 * FR-LEAD-010's 3-strike terminus: the lead goes STRAIGHT to the first rung
 * of the ladder, capacity notwithstanding, method 'escalation' — and the
 * ladder ends there (D-046 #3). Returns the manager's id, or null when the
 * organization has nobody to escalate to (the engine cannot invent people).
 */
export async function assignLeadToManager(
  c: PoolClient,
  organizationId: string,
  leadId: string,
  reason: string,
): Promise<string | null> {
  const ladder = await escalationLadder(c, organizationId);
  const target = ladder[0];
  if (target === undefined) return null;
  const won = await c.query(
    `UPDATE leads
     SET assigned_to = $2, assigned_at = now(), assignment_method = 'escalation',
         status = CASE WHEN status IN ('new','chatbot_engaged') THEN 'assigned' ELSE status END
     WHERE id = $1 AND assigned_to IS NULL AND deleted_at IS NULL`,
    [leadId, target],
  );
  if (won.rowCount === 0) return null;
  const src = await c.query<{ source: string }>(`SELECT source FROM leads WHERE id = $1`, [leadId]);
  await c.query(
    `INSERT INTO lead_assignment_history
       (organization_id, lead_id, assigned_to, rule_id, rule_name, strategy, lead_source)
     VALUES ($1, $2, $3, NULL, $4, $5, $6)`,
    [organizationId, leadId, target, `escalation: ${reason}`, CASCADE_STRATEGY, src.rows[0]?.source ?? 'other'],
  );
  await recordEvent(c, {
    organizationId,
    actorUserId: null,
    entityType: 'lead',
    entityId: leadId,
    action: 'assigned',
    changes: { assigned_to: { from: null, to: target }, assignment_method: 'escalation', via: 'cascade', escalation_reason: reason },
  });
  await notify(c, {
    organizationId,
    userId: target,
    urgency: 'high',
    titleKey: 'notif_lead_escalated',
    params: { lead: src.rows[0]?.source ?? 'lead', reason },
    link: `/leads/${leadId}`,
    entityType: 'lead',
    entityId: leadId,
  });
  return target;
}

/** The row's org, resolved under the caller's own visibility (member_read). */
async function scheduleOrg(pool: Pool, userId: string, id: string): Promise<string> {
  return withUser(pool, userId, async (c) => {
    const r = await c.query<{ organization_id: string }>(
      `SELECT organization_id FROM staff_schedules WHERE id = $1`,
      [id],
    );
    if (r.rows.length === 0) throw notFound();
    return r.rows[0]!.organization_id;
  });
}

/** The grid names real colleagues or nobody — same contract as f40's rules. */
async function assertActiveMember(c: PoolClient, userId: string): Promise<void> {
  const r = await c.query(
    `SELECT 1 FROM memberships WHERE user_id = $1 AND status = 'active'`,
    [userId],
  );
  if (r.rows.length === 0) {
    throw new AppError(422, 'validation_failed', 'That person is not an active member here', [
      { path: 'user_id', code: 'unknown_member', message: userId },
    ]);
  }
}

async function requireLiveStore(c: PoolClient, storeId: string): Promise<void> {
  const r = await c.query(
    `SELECT 1 FROM stores WHERE id = $1 AND deleted_at IS NULL AND status <> 'closed'`,
    [storeId],
  );
  if (r.rows.length === 0) {
    throw new AppError(422, 'validation_failed', 'That store is closed or does not exist', [
      { path: 'store_id', code: 'unknown_store', message: storeId },
    ]);
  }
}

/** pg TIME serializes 'HH:MM:SS'; the API speaks 'HH:MM' (TimeOfDay). */
function trimTimes<T extends Record<string, unknown>>(row: T): T {
  return {
    ...row,
    start_time: String(row['start_time']).slice(0, 5),
    end_time: String(row['end_time']).slice(0, 5),
  };
}

export function registerF42Routes(app: FastifyInstance, pool: Pool, reassign: ReassignQueue, presence: PresenceStore, emitter: Emitter = NO_EMITTER): void {
  app.post('/api/v1/staff-schedules', async (request, reply) => {
    const input = parseOrThrow(CreateStaffScheduleInput, request.body);
    const user = sessionUser(request);
    const row = await withTenant(pool, input.organization_id, async (c) => {
      await requirePermission(c, user.id, 'schedule:manage');
      await assertActiveMember(c, input.user_id);
      await requireLiveStore(c, input.store_id);
      const r = await c.query<Record<string, unknown>>(
        `INSERT INTO staff_schedules
           (organization_id, store_id, user_id, day_of_week, start_time, end_time, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          input.organization_id, input.store_id, input.user_id,
          input.day_of_week, input.start_time, input.end_time, input.active,
        ],
      );
      return trimTimes(r.rows[0]!);
    });
    return reply.status(201).send(row);
  });

  app.get('/api/v1/staff-schedules', async (request, reply) => {
    const query = parseOrThrow(StaffScheduleListQuery, request.query);
    const user = sessionUser(request);
    const orgId = await resolveOrg(pool, user.id, query.organization_id);
    if (!orgId) return reply.send({ items: [], next_cursor: null });
    const page = await withTenant(pool, orgId, async (c) => {
      await requireMember(c, user.id);
      let sql = `SELECT * FROM staff_schedules WHERE organization_id = $1`;
      const params: unknown[] = [orgId];
      if (query.user_id) {
        params.push(query.user_id);
        sql += ` AND user_id = $${params.length}`;
      }
      if (query.store_id) {
        params.push(query.store_id);
        sql += ` AND store_id = $${params.length}`;
      }
      const p = await keysetPage<Record<string, unknown> & { id: string }>(c, sql, params, query);
      return { ...p, items: p.items.map(trimTimes) };
    });
    return reply.send(page);
  });

  app.patch('/api/v1/staff-schedules/:id', async (request, reply) => {
    const id = idParam(request);
    const input = parseOrThrow(UpdateStaffScheduleInput, request.body);
    const user = sessionUser(request);
    const orgId = await scheduleOrg(pool, user.id, id);
    const row = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'schedule:manage');
      // Belt-and-braces at the SINK (house pattern since the 2026-08-19
      // audit): schema-bounded keys, re-bounded where they reach SQL.
      const PATCHABLE = new Set(['day_of_week', 'start_time', 'end_time', 'active']);
      const sets: string[] = [];
      const params: unknown[] = [id];
      for (const [key, value] of Object.entries(input)) {
        if (value === undefined) continue;
        if (!PATCHABLE.has(key)) throw new Error(`unpatchable column reached the SQL sink: ${key}`);
        params.push(value);
        sets.push(`${key} = $${params.length}`);
      }
      const r = await c.query<Record<string, unknown>>(
        `UPDATE staff_schedules SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
        params,
      );
      if (r.rows.length === 0) throw notFound();
      // The DB CHECK (end > start) is the last line; surface it as a 422, not
      // a 500, when a partial PATCH crosses the window.
      return trimTimes(r.rows[0]!);
    }).catch((e: unknown) => {
      if ((e as { code?: string }).code === '23514') {
        throw new AppError(422, 'validation_failed', 'end_time must be after start_time', [
          { path: 'end_time', code: 'invalid_window', message: 'Same-day windows only' },
        ]);
      }
      throw e;
    });
    return reply.send(row);
  });

  app.delete('/api/v1/staff-schedules/:id', async (request, reply) => {
    const id = idParam(request);
    const user = sessionUser(request);
    const orgId = await scheduleOrg(pool, user.id, id);
    await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'schedule:manage');
      const r = await c.query(`DELETE FROM staff_schedules WHERE id = $1`, [id]);
      if (r.rowCount === 0) throw notFound();
    });
    return reply.status(204).send();
  });

  /**
   * Who is working right now (leads.md:264's GET /api/v1/schedules/today).
   * The same verdict the cascade uses, exposed so the board can show it.
   */
  app.get('/api/v1/schedules/today', async (request, reply) => {
    const query = parseOrThrow(StaffScheduleListQuery.pick({ organization_id: true }), request.query);
    const user = sessionUser(request);
    const orgId = await resolveOrg(pool, user.id, query.organization_id);
    if (!orgId) return reply.send({ items: [] });
    const rows = await withTenant(pool, orgId, async (c) => {
      await requireMember(c, user.id);
      // One item per PERSON (multi-store members hold several rows), times
      // trimmed to HH:MM — seconds are the database's business.
      const r = await c.query<{ user_id: string; working_now: boolean; windows: unknown }>(
        `SELECT p.user_id,
                COALESCE((
                  SELECT bool_or(
                    s.day_of_week = EXTRACT(DOW FROM (now() AT TIME ZONE st.timezone))::int
                    AND (now() AT TIME ZONE st.timezone)::time >= s.start_time
                    AND (now() AT TIME ZONE st.timezone)::time <  s.end_time)
                  FROM staff_schedules s JOIN stores st ON st.id = s.store_id
                  WHERE s.user_id = p.user_id AND s.active
                ), true) AS working_now,
                COALESCE((
                  SELECT json_agg(json_build_object(
                    'store_id', s.store_id,
                    'start_time', to_char(s.start_time, 'HH24:MI'),
                    'end_time', to_char(s.end_time, 'HH24:MI')))
                  FROM staff_schedules s JOIN stores st ON st.id = s.store_id
                  WHERE s.user_id = p.user_id AND s.active
                    AND s.day_of_week = EXTRACT(DOW FROM (now() AT TIME ZONE st.timezone))::int
                ), '[]'::json) AS windows
         FROM (
           SELECT m.user_id, min(m.created_at) AS joined_at
           FROM memberships m
           WHERE m.organization_id = $1 AND m.status = 'active'
           GROUP BY m.user_id
         ) p
         ORDER BY p.joined_at, p.user_id`,
        [orgId],
      );
      const online = await presence.onlineIn(orgId);
      return r.rows.map((row) => ({
        ...row,
        // Tri-state flattened for the board: unknown reads as null.
        online: online === null ? null : online.has(row.user_id),
      }));
    });
    return reply.send({ items: rows });
  });

  /** Run the §7.3 funnel on demand. The AI pipeline calls the same function. */
  app.post('/api/v1/leads/:id/cascade-assign', async (request, reply) => {
    const leadId = idParam(request);
    const user = sessionUser(request);
    const orgId = await withUser(pool, user.id, async (c) => {
      const r = await c.query<{ organization_id: string }>(
        `SELECT organization_id FROM leads WHERE id = $1 AND deleted_at IS NULL`,
        [leadId],
      );
      if (r.rows.length === 0) throw notFound();
      return r.rows[0]!.organization_id;
    });
    const result = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'lead:assign');
      return cascadeAssignLead(c, orgId, leadId, user.id, { presence });
    });
    // D-046 #2: every machine assignment arms the ten-minute timer —
    // escalation included (leads.md:374 runs the ladder after escalating).
    // Armed AFTER the transaction committed; a job for a rolled-back
    // assignment would only no-op, but why enqueue a lie.
    if (result.outcome === 'assigned' || result.outcome === 'escalated') {
      await reassign.arm({
        organization_id: orgId,
        lead_id: leadId,
        assigned_to: result.user_id,
        attempt: result.attempt ?? 0,
      });
      // Post-commit refresh hint; the recipient's bell refetches on sight.
      emitter.emit(
        { kind: 'notifications', organizationId: orgId, userId: result.user_id },
        { type: 'notification.created', organization_id: orgId, user_id: result.user_id },
      );
    }
    return reply.send(result);
  });
}

/** The f35 shape: named org verified, sole org inferred, several orgs = 400. */
async function resolveOrg(pool: Pool, userId: string, requested: string | undefined): Promise<string | null> {
  return withUser(pool, userId, async (c) => {
    if (requested) {
      const member = await c.query(
        `SELECT 1 FROM memberships m
         JOIN organizations o ON o.id = m.organization_id AND o.deleted_at IS NULL
         WHERE m.organization_id = $1 AND m.status = 'active' LIMIT 1`,
        [requested],
      );
      if (member.rows.length === 0) throw notFound();
      return requested;
    }
    const orgs = await callerOrgIds(c);
    if (orgs.length === 0) return null;
    if (orgs.length > 1) {
      throw new AppError(400, 'organization_required', 'Pass organization_id — you belong to several organizations');
    }
    return orgs[0]!;
  });
}
