import type { FastifyInstance } from 'fastify';
import { withTenant, type Pool, type PoolClient } from '@dealpilot/db';
import { DistributionQuery, PutDistributionConfigInput } from '@dealpilot/schemas';
import { pickStore, type DistributionDecision, type DistributionPlatform, type StoreTally } from '@dealpilot/core';
import { AppError, parseOrThrow } from './errors.js';
import { requirePermission } from './permissions.js';
import { recordEvent } from './activity.js';
import { sessionUser } from './f01-routes.js';

/**
 * F-45 — weighted store distribution (FR-LEAD-007, leads.md §3, D-049).
 *
 * The tally's math is golden-tested in @dealpilot/core (10 cases, including
 * the spec's 60/40 sequence); what this file owns is the WIRING: the config
 * ledger (owner/GM surface — organization:update both ways, because ad spend
 * per store is money data and the spec calls the dashboard an Owner screen),
 * and `distributeLead`, which the intake webhook calls inside the same
 * transaction that created a store-less lead.
 */

/**
 * Deal one queued lead. FOR UPDATE serializes concurrent webhooks on the
 * month's rows — two leads arriving together must see each other's tally or
 * the running total drifts from the split it exists to honour.
 */
export async function distributeLead(
  c: PoolClient,
  organizationId: string,
  leadId: string,
  platform: DistributionPlatform,
): Promise<DistributionDecision> {
  const month = await c.query<{ month: string }>(
    `SELECT date_trunc('month', now())::date::text AS month`,
  );
  const rows = await c.query<StoreTally & { id: string }>(
    `SELECT id, store_id, contribution_amount_cents, leads_received
     FROM lead_distribution_config
     WHERE organization_id = $1 AND platform = $2 AND month = $3
     ORDER BY store_id
     FOR UPDATE`,
    [organizationId, platform, month.rows[0]!.month],
  );
  const decision = pickStore(rows.rows);
  if (decision.outcome !== 'assigned') return decision;

  await c.query(`UPDATE leads SET store_id = $2 WHERE id = $1 AND store_id IS NULL`, [
    leadId,
    decision.store_id,
  ]);
  // The winner's count first, then every row's actual share against the new
  // denominator. Two statements on purpose: a data-modifying CTE whose outer
  // statement writes the SAME row is undefined behavior in Postgres. (Careful
  // wording: the dead-column scanner reads the write verbs in COMMENTS too —
  // the first draft of this note stole the statement's own attribution.)
  await c.query(
    `UPDATE lead_distribution_config SET leads_received = leads_received + 1
     WHERE organization_id = $1 AND platform = $2 AND month = $3 AND store_id = $4`,
    [organizationId, platform, month.rows[0]!.month, decision.store_id],
  );
  await c.query(
    `UPDATE lead_distribution_config d
     SET actual_percentage = round(d.leads_received * 100.0 / totals.total, 2)
     FROM (SELECT sum(leads_received) AS total FROM lead_distribution_config
           WHERE organization_id = $1 AND platform = $2 AND month = $3) totals
     WHERE d.organization_id = $1 AND d.platform = $2 AND d.month = $3`,
    [organizationId, platform, month.rows[0]!.month],
  );
  await recordEvent(c, {
    organizationId,
    storeId: decision.store_id,
    actorUserId: null,
    entityType: 'lead',
    entityId: leadId,
    action: 'updated',
    changes: { store_id: { from: null, to: decision.store_id }, via: 'distribution', platform },
  });
  return decision;
}

export function registerF45Routes(app: FastifyInstance, pool: Pool): void {
  app.put('/api/v1/distribution/config', async (request, reply) => {
    const input = parseOrThrow(PutDistributionConfigInput, request.body);
    const user = sessionUser(request);
    const rows = await withTenant(pool, input.organization_id, async (c) => {
      await requirePermission(c, user.id, 'organization:update');
      // Every named store must be a live store of THIS org (the composite FK
      // is the backstop; a 422 with the store named is the front door).
      for (const e of input.entries) {
        const live = await c.query(
          `SELECT 1 FROM stores WHERE id = $1 AND deleted_at IS NULL AND status <> 'closed'`,
          [e.store_id],
        );
        if (live.rows.length === 0) {
          throw new AppError(422, 'validation_failed', 'That store is closed or does not exist', [
            { path: 'entries', code: 'unknown_store', message: e.store_id },
          ]);
        }
      }
      for (const e of input.entries) {
        await c.query(
          `INSERT INTO lead_distribution_config
             (organization_id, store_id, platform, month, contribution_amount_cents)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (store_id, platform, month)
           DO UPDATE SET contribution_amount_cents = EXCLUDED.contribution_amount_cents`,
          [input.organization_id, e.store_id, input.platform, input.month, e.contribution_amount_cents],
        );
      }
      // leads.md:164: a spend change recalculates EVERY store's target share.
      await c.query(
        `UPDATE lead_distribution_config d
         SET contribution_percentage = CASE
           WHEN totals.total = 0 THEN 0
           ELSE round(d.contribution_amount_cents * 100.0 / totals.total, 2)
         END
         FROM (SELECT sum(contribution_amount_cents) AS total
               FROM lead_distribution_config
               WHERE organization_id = $1 AND platform = $2 AND month = $3) totals
         WHERE d.organization_id = $1 AND d.platform = $2 AND d.month = $3`,
        [input.organization_id, input.platform, input.month],
      );
      await recordEvent(c, {
        organizationId: input.organization_id,
        actorUserId: user.id,
        entityType: 'organization',
        entityId: input.organization_id,
        action: 'updated',
        changes: {
          distribution: { platform: input.platform, month: input.month },
          stores: input.entries.length,
        },
      });
      const r = await c.query(
        `SELECT * FROM lead_distribution_config
         WHERE organization_id = $1 AND platform = $2 AND month = $3
         ORDER BY store_id`,
        [input.organization_id, input.platform, input.month],
      );
      return r.rows;
    });
    return reply.send({ items: rows });
  });

  /** Target vs actual + deviation, current month by default (the dashboard). */
  app.get('/api/v1/distribution', async (request, reply) => {
    const query = parseOrThrow(DistributionQuery, request.query);
    const user = sessionUser(request);
    const rows = await withTenant(pool, query.organization_id, async (c) => {
      await requirePermission(c, user.id, 'organization:update');
      const params: unknown[] = [query.organization_id];
      let sql = `SELECT *,
                        round(actual_percentage - contribution_percentage, 2) AS deviation
                 FROM lead_distribution_config
                 WHERE organization_id = $1`;
      params.push(query.month ?? null);
      sql += ` AND month = COALESCE($${params.length}::date, date_trunc('month', now())::date)`;
      if (query.platform) {
        params.push(query.platform);
        sql += ` AND platform = $${params.length}`;
      }
      sql += ` ORDER BY platform, store_id`;
      const r = await c.query(sql, params);
      return r.rows;
    });
    return reply.send({ items: rows });
  });

  /** The spec's 3-month history, newest first. */
  app.get('/api/v1/distribution/history', async (request, reply) => {
    const query = parseOrThrow(DistributionQuery.omit({ month: true }), request.query);
    const user = sessionUser(request);
    const rows = await withTenant(pool, query.organization_id, async (c) => {
      await requirePermission(c, user.id, 'organization:update');
      const params: unknown[] = [query.organization_id];
      let sql = `SELECT *,
                        round(actual_percentage - contribution_percentage, 2) AS deviation
                 FROM lead_distribution_config
                 WHERE organization_id = $1
                   AND month >= (date_trunc('month', now()) - interval '2 months')::date`;
      if (query.platform) {
        params.push(query.platform);
        sql += ` AND platform = $${params.length}`;
      }
      sql += ` ORDER BY month DESC, platform, store_id`;
      const r = await c.query(sql, params);
      return r.rows;
    });
    return reply.send({ items: rows });
  });
}
