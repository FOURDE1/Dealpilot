import type { FastifyInstance } from 'fastify';
import { withTenant, withUser, type Pool, type PoolClient } from '@dealpilot/db';
import { assignLead, type AssignmentRule } from '@dealpilot/core';
import {
  AssignmentRuleListQuery,
  CreateAssignmentRuleInput,
  UpdateAssignmentRuleInput,
  type AssignLeadResultT,
} from '@dealpilot/schemas';
import { AppError, notFound, parseOrThrow } from './errors.js';
import { idParam, keysetPage, sessionUser } from './f01-routes.js';
import { requirePermission } from './permissions.js';
import { recordEvent } from './activity.js';

/**
 * F-40 — the assignment engine's API (leads.md §7).
 *
 * Rule CRUD mirrors scoring's shape and permission (organization:update —
 * FR-AUTH-004's automation-rules power). The assign endpoint sits behind
 * `lead:assign`, the permission the manual assign already uses: choosing by
 * hand and letting the engine choose are the same authority.
 */

/** A lead is off somebody's plate only when its story is over. */
const TERMINAL_STATUSES = "('converted','lost','expired')";

/**
 * Run §7.2 for one lead inside an open tenant transaction.
 *
 * Exported for the create paths — the legacy flow assigns at creation, and an
 * engine that only runs when a button is pressed routes nothing. Every outcome
 * is a VALUE, including the refusals: no rules configured means the lead stays
 * unassigned exactly as it does today, so switching this on changes nothing
 * until an owner writes a rule.
 */
export async function autoAssignLead(
  c: PoolClient,
  organizationId: string,
  leadId: string,
  actorUserId: string | null,
): Promise<AssignLeadResultT> {
  const leadRow = await c.query<{ source: string; assigned_to: string | null; status: string }>(
    `SELECT source, assigned_to, status FROM leads WHERE id = $1 AND deleted_at IS NULL`,
    [leadId],
  );
  if (leadRow.rows.length === 0) throw notFound();
  const lead = leadRow.rows[0]!;
  // §7.2: the auto path NEVER reassigns. Taking a lead off somebody is a
  // human act with a human's name on it, not a rule's.
  if (lead.assigned_to !== null) return { outcome: 'already_assigned', lead_id: leadId };

  const rules = await c.query<AssignmentRule & { max_leads_per_user: number }>(
    `SELECT id, name, strategy, priority, sources, included_users, excluded_users,
            source_mappings, max_leads_per_user
       FROM lead_assignment_rules
      WHERE organization_id = $1 AND is_active`,
    [organizationId],
  );
  if (rules.rows.length === 0) return { outcome: 'no_rule', lead_id: leadId };

  // Roster order is the pool order, and it must be DETERMINISTIC — round_robin
  // walks an index into this list, and first-min breaks load ties by position.
  const candidates = await c.query<{ user_id: string; active_count: number }>(
    `SELECT m.user_id,
            (SELECT count(*)::int FROM leads l
              WHERE l.assigned_to = m.user_id AND l.deleted_at IS NULL
                AND l.status NOT IN ${TERMINAL_STATUSES}) AS active_count
       FROM memberships m
      WHERE m.organization_id = $1 AND m.status = 'active'
      ORDER BY m.created_at, m.user_id`,
    [organizationId],
  );

  const state = await c.query<{ rule_id: string; last_assigned_index: number }>(
    `SELECT rule_id, last_assigned_index FROM lead_assignment_state
      WHERE organization_id = $1`,
    [organizationId],
  );
  const cursors = new Map(state.rows.map((r) => [r.rule_id, r.last_assigned_index]));

  const decision = assignLead(
    lead,
    rules.rows,
    candidates.rows,
    (ruleId) => cursors.get(ruleId) ?? -1,
  );
  if (decision.outcome !== 'assigned') return { outcome: decision.outcome, lead_id: leadId };

  if (decision.next_index !== null) {
    await c.query(
      `INSERT INTO lead_assignment_state (rule_id, organization_id, last_assigned_index)
       VALUES ($1, $2, $3)
       ON CONFLICT (rule_id) DO UPDATE SET last_assigned_index = EXCLUDED.last_assigned_index`,
      [decision.rule_id, organizationId, decision.next_index],
    );
  }

  // Status bumps new → assigned ONLY (§7.2): a contacted lead that was merely
  // unassigned keeps the truer status.
  await c.query(
    `UPDATE leads
        SET assigned_to = $2, assigned_at = now(),
            status = CASE WHEN status = 'new' THEN 'assigned' ELSE status END
      WHERE id = $1`,
    [leadId, decision.user_id],
  );
  await c.query(
    `INSERT INTO lead_assignment_history
       (organization_id, lead_id, assigned_to, rule_id, rule_name, strategy, lead_source)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [organizationId, leadId, decision.user_id, decision.rule_id, decision.rule_name, decision.strategy, lead.source],
  );
  await recordEvent(c, {
    organizationId,
    storeId: null,
    actorUserId,
    entityType: 'lead',
    entityId: leadId,
    action: 'assigned',
    changes: { assigned_to: { to: decision.user_id }, rule: { to: decision.rule_name } },
  });

  return {
    outcome: 'assigned',
    lead_id: leadId,
    assigned_to: decision.user_id,
    rule_id: decision.rule_id,
    rule_name: decision.rule_name,
    strategy: decision.strategy,
  };
}

async function ruleOrg(pool: Pool, userId: string, ruleId: string): Promise<string> {
  return withUser(pool, userId, async (c) => {
    const r = await c.query<{ organization_id: string }>(
      `SELECT organization_id FROM lead_assignment_rules WHERE id = $1`,
      [ruleId],
    );
    if (r.rows.length === 0) throw notFound();
    return r.rows[0]!.organization_id;
  });
}

const RULE_COLUMNS =
  'organization_id, name, strategy, priority, sources, included_users, excluded_users, source_mappings, max_leads_per_user';

export function registerF40Routes(app: FastifyInstance, pool: Pool): void {
  app.get('/api/v1/assignment-rules', async (request, reply) => {
    const query = parseOrThrow(AssignmentRuleListQuery, request.query);
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
      return keysetPage<Record<string, unknown> & { id: string }>(
        c,
        `SELECT * FROM lead_assignment_rules WHERE organization_id = $1`,
        [orgId],
        query,
      );
    });
    return reply.send(page);
  });

  app.post('/api/v1/assignment-rules', async (request, reply) => {
    const input = parseOrThrow(CreateAssignmentRuleInput, request.body);
    const user = sessionUser(request);
    const rule = await withTenant(pool, input.organization_id, async (c) => {
      await requirePermission(c, user.id, 'organization:update');
      const r = await c.query<Record<string, unknown>>(
        `INSERT INTO lead_assignment_rules (${RULE_COLUMNS})
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          input.organization_id, input.name, input.strategy, input.priority,
          input.sources, input.included_users, input.excluded_users,
          JSON.stringify(input.source_mappings), input.max_leads_per_user,
        ],
      );
      return r.rows[0]!;
    });
    return reply.status(201).send(rule);
  });

  app.patch('/api/v1/assignment-rules/:id', async (request, reply) => {
    const id = idParam(request);
    const input = parseOrThrow(UpdateAssignmentRuleInput, request.body);
    const user = sessionUser(request);
    const orgId = await ruleOrg(pool, user.id, id);
    const rule = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'organization:update');
      const sets: string[] = [];
      const params: unknown[] = [id];
      for (const [key, value] of Object.entries(input)) {
        if (value === undefined) continue;
        params.push(key === 'source_mappings' ? JSON.stringify(value) : value);
        sets.push(`${key} = $${params.length}`);
      }
      const r = await c.query<Record<string, unknown>>(
        `UPDATE lead_assignment_rules SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
        params,
      );
      if (r.rows.length === 0) throw notFound();
      return r.rows[0]!;
    });
    return reply.send(rule);
  });

  app.delete('/api/v1/assignment-rules/:id', async (request, reply) => {
    const id = idParam(request);
    const user = sessionUser(request);
    const orgId = await ruleOrg(pool, user.id, id);
    await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'organization:update');
      const r = await c.query(`DELETE FROM lead_assignment_rules WHERE id = $1`, [id]);
      if (r.rowCount === 0) throw notFound();
    });
    return reply.status(204).send();
  });

  app.post('/api/v1/leads/:id/assign', async (request, reply) => {
    const leadId = idParam(request);
    const user = sessionUser(request);
    const orgId = await withUser(pool, user.id, async (c) => {
      const r = await c.query<{ organization_id: string }>(
        `SELECT organization_id FROM leads WHERE id = $1 AND deleted_at IS NULL`, [leadId],
      );
      if (r.rows.length === 0) throw notFound();
      return r.rows[0]!.organization_id;
    });
    const result = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'lead:assign');
      return autoAssignLead(c, orgId, leadId, user.id);
    });
    return reply.send(result);
  });
}
