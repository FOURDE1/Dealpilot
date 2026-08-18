import type { FastifyInstance } from 'fastify';
import { withTenant, withUser, type Pool, type PoolClient } from '@dealpilot/db';
import { calculateScore, scoreBand, type ScorableLead, type ScoringRule } from '@dealpilot/core';
import {
  CreateScoringRuleInput,
  ScoringRuleListQuery,
  UpdateScoringRuleInput,
} from '@dealpilot/schemas';
import { AppError, notFound, parseOrThrow } from './errors.js';
import { idParam, keysetPage, sessionUser } from './f01-routes.js';
import { requirePermission } from './permissions.js';
import { recordEvent } from './activity.js';

/**
 * F-39 — the lead scoring rules engine's API (leads.md §6).
 *
 * Rule CRUD sits behind `organization:update` — FR-AUTH-004 calls managing
 * automation rules an owner/GM power, and that permission is the one the
 * matrix already scopes that way. Recalculation sits behind `lead:update`,
 * because refreshing a number the rules already imply is lead work.
 */

const RULE_COLUMNS =
  'organization_id, store_id, name, field, operator, value, score, priority';

/**
 * Score one lead under an open tenant transaction: load its effective rules
 * (its store's + global), run the pure engine, upsert the cache, and sync
 * `leads.score` when it changed. Returns null when the lead does not exist.
 *
 * Exported for the two lead-create paths (F-02 route, F-03 intake webhook) —
 * §6.2 lists "lead create (all paths)" as a trigger, and an engine that only
 * runs when a button is pressed scores nothing the assistant ever sees.
 */
export async function recalculateLeadScore(
  c: PoolClient,
  organizationId: string,
  leadId: string,
): Promise<{ lead_id: string; score: number; band: 'hot' | 'warm' | 'cold'; breakdown: unknown[]; scored_at: string } | null> {
  const leadRow = await c.query<ScorableLead & { id: string; store_id: string }>(
    `SELECT id, store_id, first_name, last_name, email, phone, source, source_platform,
            status, preferred_language, vehicle_interest, trade_in_status, assigned_to,
            monthly_budget_cents, total_budget_cents, created_at
       FROM leads WHERE id = $1 AND deleted_at IS NULL`,
    [leadId],
  );
  if (leadRow.rows.length === 0) return null;
  const lead = leadRow.rows[0]!;

  const rules = await c.query<ScoringRule>(
    `SELECT id, name, field, operator, value, score, priority
       FROM lead_scoring_rules
      WHERE organization_id = $1 AND is_active
        AND (store_id IS NULL OR store_id = $2)`,
    [organizationId, lead.store_id],
  );

  const result = calculateScore(lead, rules.rows);

  const upserted = await c.query<{ scored_at: string }>(
    `INSERT INTO lead_scores (lead_id, organization_id, score, breakdown, scored_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (lead_id) DO UPDATE
        SET score = EXCLUDED.score, breakdown = EXCLUDED.breakdown, scored_at = now()
     RETURNING scored_at::text`,
    [leadId, organizationId, result.score, JSON.stringify(result.breakdown)],
  );
  // Synced, not duplicated logic: every list that already selects * from leads
  // gets the number for free, and this UPDATE is a no-op when unchanged.
  await c.query(
    `UPDATE leads SET score = $2 WHERE id = $1 AND score IS DISTINCT FROM $2`,
    [leadId, result.score],
  );

  return {
    lead_id: leadId,
    score: result.score,
    band: scoreBand(result.score),
    breakdown: result.breakdown,
    scored_at: upserted.rows[0]!.scored_at,
  };
}

/**
 * The create-path wrapper (§6.2's trigger list: "lead create, all paths",
 * fallback 10 on engine error).
 *
 * The catch is deliberate and narrow, and it is not error-masking: a lead must
 * never fail to CREATE because a scoring rule was malformed — intake holds a
 * p99 < 1s ACK and the lead is the money path. The spec'd degradation is
 * written, not swallowed: score 10 with an EMPTY breakdown is itself the tell
 * (a score with no why is the fallback), and the engine is pure and total, so
 * this path exists for the rule set nobody has imagined yet, not for a known
 * failure.
 */
export async function scoreOnCreate(
  c: PoolClient,
  organizationId: string,
  leadId: string,
): Promise<{ score: number }> {
  try {
    const r = await recalculateLeadScore(c, organizationId, leadId);
    return { score: r?.score ?? 0 };
  } catch {
    await c.query(
      `INSERT INTO lead_scores (lead_id, organization_id, score, breakdown)
       VALUES ($1, $2, 10, '[]')
       ON CONFLICT (lead_id) DO UPDATE SET score = 10, breakdown = '[]', scored_at = now()`,
      [leadId, organizationId],
    );
    await c.query(`UPDATE leads SET score = 10 WHERE id = $1`, [leadId]);
    return { score: 10 };
  }
}

async function ruleOrg(pool: Pool, userId: string, ruleId: string): Promise<string> {
  return withUser(pool, userId, async (c) => {
    const r = await c.query<{ organization_id: string }>(
      `SELECT organization_id FROM lead_scoring_rules WHERE id = $1`,
      [ruleId],
    );
    if (r.rows.length === 0) throw notFound();
    return r.rows[0]!.organization_id;
  });
}

export function registerF39Routes(app: FastifyInstance, pool: Pool): void {
  app.get('/api/v1/scoring-rules', async (request, reply) => {
    const query = parseOrThrow(ScoringRuleListQuery, request.query);
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
      let sql = `SELECT * FROM lead_scoring_rules WHERE organization_id = $1`;
      const params: unknown[] = [orgId];
      if (query.store_id) {
        params.push(query.store_id);
        sql += ` AND (store_id = $${params.length} OR store_id IS NULL)`;
      }
      return keysetPage<Record<string, unknown> & { id: string }>(c, sql, params, query);
    });
    return reply.send(page);
  });

  app.post('/api/v1/scoring-rules', async (request, reply) => {
    const input = parseOrThrow(CreateScoringRuleInput, request.body);
    const user = sessionUser(request);
    const rule = await withTenant(pool, input.organization_id, async (c) => {
      await requirePermission(c, user.id, 'organization:update');
      if (input.store_id) {
        const store = await c.query(
          `SELECT 1 FROM stores WHERE id = $1 AND deleted_at IS NULL`, [input.store_id],
        );
        if (store.rows.length === 0) {
          throw new AppError(422, 'validation_failed', 'Unknown store for this organization', [
            { path: 'store_id', code: 'invalid_reference', message: 'Store not found in this organization' },
          ]);
        }
      }
      const r = await c.query<Record<string, unknown>>(
        `INSERT INTO lead_scoring_rules (${RULE_COLUMNS})
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          input.organization_id, input.store_id ?? null, input.name, input.field,
          input.operator, input.value ?? null, input.score, input.priority,
        ],
      );
      return r.rows[0]!;
    });
    return reply.status(201).send(rule);
  });

  app.patch('/api/v1/scoring-rules/:id', async (request, reply) => {
    const id = idParam(request);
    const input = parseOrThrow(UpdateScoringRuleInput, request.body);
    const user = sessionUser(request);
    const orgId = await ruleOrg(pool, user.id, id);
    const rule = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'organization:update');
      const sets: string[] = [];
      const params: unknown[] = [id];
      for (const [key, value] of Object.entries(input)) {
        if (value === undefined) continue;
        params.push(value);
        sets.push(`${key} = $${params.length}`);
      }
      const r = await c.query<Record<string, unknown>>(
        `UPDATE lead_scoring_rules SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
        params,
      );
      if (r.rows.length === 0) throw notFound();
      return r.rows[0]!;
    });
    return reply.send(rule);
  });

  app.delete('/api/v1/scoring-rules/:id', async (request, reply) => {
    const id = idParam(request);
    const user = sessionUser(request);
    const orgId = await ruleOrg(pool, user.id, id);
    await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'organization:update');
      // Hard delete: a rule is CONFIG, not a record of something that
      // happened. The soft option (is_active=false) is a PATCH.
      const r = await c.query(`DELETE FROM lead_scoring_rules WHERE id = $1`, [id]);
      if (r.rowCount === 0) throw notFound();
    });
    return reply.status(204).send();
  });

  app.post('/api/v1/leads/:id/score', async (request, reply) => {
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
      await requirePermission(c, user.id, 'lead:update');
      const scored = await recalculateLeadScore(c, orgId, leadId);
      if (scored === null) throw notFound();
      await recordEvent(c, {
        organizationId: orgId,
        storeId: null,
        actorUserId: user.id,
        entityType: 'lead',
        entityId: leadId,
        action: 'updated',
        changes: { score: { to: scored.score } },
      });
      return scored;
    });
    return reply.send(result);
  });
}
