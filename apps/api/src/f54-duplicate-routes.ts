import type { FastifyInstance } from 'fastify';
import { withTenant, withUser, type Pool, type PoolClient } from '@dealpilot/db';
import { DuplicateListQuery, DuplicateScanInput } from '@dealpilot/schemas';
import {
  MERGED_DUPLICATE_REASON,
  confidenceOf,
  matchTypeOf,
  orientPair,
  type MatchField,
} from '@dealpilot/core';
import { AppError, notFound, parseOrThrow } from './errors.js';
import { requirePermission } from './permissions.js';
import { recordEvent } from './activity.js';
import { recalculateLeadScore } from './f39-scoring-routes.js';
import { idParam, keysetPage, requireMember, sessionUser } from './f01-routes.js';

/**
 * F-54 — duplicate detection & merge (leads.md §8, D-056).
 *
 * Detection writes PAIRS, never touches leads: the newer lead is `lead_id`,
 * the older is `duplicate_of`, and the older is always the canonical
 * keeper. Merge is one transaction (withTenant already IS one): backfill
 * empty keeper fields, re-point the operational children, retire the
 * source as lost under the seeded 'Merged duplicate' reason, dismiss every
 * other pending pair the source sat in. consent_ledger deliberately stays
 * put — it is append-only by trigger, and consent keys on phone/email, so
 * the keeper (same person, same phone) inherits by identity.
 */

/** SQL forms of the §8.1 normalizations — MUST mirror @dealpilot/core
 * lead-duplicates.ts (the expression indexes in 0056 use the same text). */
const SQL_PHONE = (a: string) => `right(regexp_replace(${a}.phone, '\\D', '', 'g'), 10)`;
const SQL_NAME = (a: string) =>
  `regexp_replace(lower(btrim(coalesce(${a}.first_name,'') || ' ' || coalesce(${a}.last_name,''))), '\\s+', ' ', 'g')`;

interface CandidateRow {
  id: string;
  created_at: string;
  store_id: string | null;
  m_phone: boolean;
  m_email: boolean;
  m_name: boolean;
}

/**
 * Compare one lead against the tenant's others and record any new pairs.
 * Returns how many pairs were created (existing ones are never duplicated).
 * Exposed for the create paths (f02 manual, f03 intake) — a duplicate is
 * detected the moment it arrives, not when somebody remembers to scan.
 */
export async function detectDuplicatesFor(
  c: PoolClient,
  organizationId: string,
  leadId: string,
): Promise<number> {
  const target = await c.query<{ id: string; created_at: string; store_id: string | null }>(
    `SELECT id, created_at::text AS created_at, store_id FROM leads
     WHERE id = $1 AND deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM lead_duplicates md
                       WHERE md.lead_id = leads.id AND md.status = 'merged')`,
    [leadId],
  );
  const lead = target.rows[0];
  if (lead === undefined) return 0;

  const candidates = await c.query<CandidateRow>(
    `SELECT c.id, c.created_at::text AS created_at, c.store_id,
            (length(regexp_replace(l.phone, '\\D', '', 'g')) >= 7
              AND ${SQL_PHONE('c')} = ${SQL_PHONE('l')})                        AS m_phone,
            (l.email IS NOT NULL AND c.email IS NOT NULL
              AND lower(c.email) = lower(l.email))                              AS m_email,
            (length(${SQL_NAME('l')}) > 1
              AND ${SQL_NAME('c')} = ${SQL_NAME('l')})                          AS m_name
     FROM leads l
     JOIN leads c ON c.organization_id = l.organization_id
      AND c.id <> l.id AND c.deleted_at IS NULL
      AND (l.store_id IS NULL OR c.store_id IS NULL OR c.store_id = l.store_id)
      -- A merged-away source is a ghost: it must never re-enter the queue,
      -- least of all as a "keeper" whose merge would strip a live lead.
      AND NOT EXISTS (SELECT 1 FROM lead_duplicates md
                      WHERE md.lead_id = c.id AND md.status = 'merged')
     WHERE l.id = $1
       AND ((length(regexp_replace(l.phone, '\\D', '', 'g')) >= 7 AND ${SQL_PHONE('c')} = ${SQL_PHONE('l')})
         OR (l.email IS NOT NULL AND c.email IS NOT NULL AND lower(c.email) = lower(l.email))
         OR (length(${SQL_NAME('l')}) > 1 AND ${SQL_NAME('c')} = ${SQL_NAME('l')}))
     LIMIT 50`,
    [leadId],
  );

  let created = 0;
  for (const cand of candidates.rows) {
    const fields: MatchField[] = [];
    if (cand.m_phone) fields.push('phone');
    if (cand.m_email) fields.push('email');
    if (cand.m_name) fields.push('name');
    const matchType = matchTypeOf(fields);
    if (matchType === null) continue;
    const pair = orientPair(
      { id: lead.id, created_at: lead.created_at },
      { id: cand.id, created_at: cand.created_at },
    );
    const r = await c.query(
      `INSERT INTO lead_duplicates (organization_id, store_id, lead_id, duplicate_of, match_type, confidence)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (lead_id, duplicate_of) DO NOTHING`,
      [
        organizationId,
        // The pair's scope is a fact about BOTH sides: only a same-store
        // comparison is store-scoped; anything else was an org-wide match.
        lead.store_id !== null && cand.store_id === lead.store_id ? lead.store_id : null,
        pair.lead_id, pair.duplicate_of, matchType, confidenceOf(fields),
      ],
    );
    created += r.rowCount ?? 0;
  }
  return created;
}

async function pairOrg(pool: Pool, userId: string, id: string): Promise<string> {
  return withUser(pool, userId, async (c) => {
    const r = await c.query<{ organization_id: string }>(
      `SELECT organization_id FROM lead_duplicates WHERE id = $1`,
      [id],
    );
    if (r.rows.length === 0) throw notFound();
    return r.rows[0]!.organization_id;
  });
}

const SUMMARY = (a: string) => `jsonb_build_object(
  'id', ${a}.id, 'first_name', ${a}.first_name, 'last_name', ${a}.last_name,
  'phone', ${a}.phone, 'email', ${a}.email, 'vehicle_interest', ${a}.vehicle_interest,
  'status', ${a}.status, 'source', ${a}.source, 'created_at', ${a}.created_at)`;

export function registerF54Routes(app: FastifyInstance, pool: Pool): void {
  app.get('/api/v1/duplicates', async (request, reply) => {
    const query = parseOrThrow(DuplicateListQuery, request.query);
    const user = sessionUser(request);
    const orgId = query.organization_id;
    if (!orgId) throw new AppError(400, 'organization_required', 'Pass organization_id', []);
    const page = await withTenant(pool, orgId, async (c) => {
      await requireMember(c, user.id);
      let sql = `SELECT d.*, ${SUMMARY('n')} AS newer, ${SUMMARY('o')} AS older
        FROM lead_duplicates d
        JOIN leads n ON n.id = d.lead_id
        JOIN leads o ON o.id = d.duplicate_of
        WHERE d.organization_id = $1
          AND (d.status <> 'pending' OR (n.deleted_at IS NULL AND o.deleted_at IS NULL))`;
      const params: unknown[] = [orgId];
      if (query.status) {
        params.push(query.status);
        sql += ` AND d.status = $${params.length}`;
      }
      if (query.lead_id) {
        params.push(query.lead_id);
        sql += ` AND (d.lead_id = $${params.length} OR d.duplicate_of = $${params.length})`;
      }
      return keysetPage(c, sql, params, query, 'd');
    });
    return reply.send(page);
  });

  app.post('/api/v1/leads/:id/duplicate-scan', async (request, reply) => {
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
    const created = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'lead:update');
      return detectDuplicatesFor(c, orgId, leadId);
    });
    return reply.send({ created });
  });

  app.post('/api/v1/duplicates/scan', async (request, reply) => {
    const input = parseOrThrow(DuplicateScanInput, request.body);
    const user = sessionUser(request);
    const created = await withTenant(pool, input.organization_id, async (c) => {
      await requirePermission(c, user.id, 'organization:update');
      // The full sweep: every matching pair in one self-join, oriented in
      // SQL (older = keeper). Bounded for real: NOT EXISTS skips pairs any
      // earlier run already recorded, so LIMIT 500 is a resumable batch —
      // run again and the next 500 NEW pairs land.
      const params: unknown[] = [input.organization_id];
      let storeCond = `(a.store_id IS NULL OR b.store_id IS NULL OR a.store_id = b.store_id)`;
      if (input.store_id) {
        params.push(input.store_id);
        storeCond = `a.store_id = $${params.length} AND b.store_id = $${params.length}`;
      }
      const r = await c.query(
        `INSERT INTO lead_duplicates (organization_id, store_id, lead_id, duplicate_of, match_type, confidence)
         SELECT $1,
                CASE WHEN p.a_store = p.b_store THEN p.a_store ELSE NULL END,
                CASE WHEN (p.a_created, p.a_id) > (p.b_created, p.b_id) THEN p.a_id ELSE p.b_id END,
                CASE WHEN (p.a_created, p.a_id) > (p.b_created, p.b_id) THEN p.b_id ELSE p.a_id END,
                concat_ws('_',
                  CASE WHEN p.m_phone THEN 'phone' END,
                  CASE WHEN p.m_email THEN 'email' END,
                  CASE WHEN p.m_name  THEN 'name'  END),
                CASE WHEN p.m_phone OR p.m_email THEN 100 ELSE 90 END
         FROM (
           SELECT a.id AS a_id, a.created_at AS a_created, a.store_id AS a_store,
                  b.id AS b_id, b.created_at AS b_created, b.store_id AS b_store,
                  (length(regexp_replace(a.phone, '\\D', '', 'g')) >= 7
                    AND ${SQL_PHONE('a')} = ${SQL_PHONE('b')})                   AS m_phone,
                  (a.email IS NOT NULL AND b.email IS NOT NULL
                    AND lower(a.email) = lower(b.email))                         AS m_email,
                  (length(${SQL_NAME('a')}) > 1
                    AND ${SQL_NAME('a')} = ${SQL_NAME('b')})                     AS m_name
           FROM leads a
           JOIN leads b ON b.organization_id = a.organization_id AND b.id < a.id
            AND b.deleted_at IS NULL AND ${storeCond}
            AND NOT EXISTS (SELECT 1 FROM lead_duplicates md
                            WHERE md.lead_id = b.id AND md.status = 'merged')
           WHERE a.organization_id = $1 AND a.deleted_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM lead_duplicates md
                             WHERE md.lead_id = a.id AND md.status = 'merged')
         ) p
         WHERE (p.m_phone OR p.m_email OR p.m_name)
           AND NOT EXISTS (SELECT 1 FROM lead_duplicates d
                           WHERE (d.lead_id = p.a_id AND d.duplicate_of = p.b_id)
                              OR (d.lead_id = p.b_id AND d.duplicate_of = p.a_id))
         LIMIT 500
         ON CONFLICT (lead_id, duplicate_of) DO NOTHING`,
        params,
      );
      return r.rowCount ?? 0;
    });
    return reply.send({ created });
  });

  app.post('/api/v1/duplicates/:id/merge', async (request, reply) => {
    const id = idParam(request);
    const user = sessionUser(request);
    const orgId = await pairOrg(pool, user.id, id);
    const row = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'lead:update');
      // Two merges sharing a lead would deadlock on pair-vs-lead lock order;
      // merges are rare human verbs, so one at a time per org is the simple
      // shape that cannot deadlock (transaction-scoped advisory lock).
      await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 54))`, [orgId]);
      const pairRow = await c.query<{ lead_id: string; duplicate_of: string; status: string }>(
        `SELECT lead_id, duplicate_of, status FROM lead_duplicates WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const pair = pairRow.rows[0];
      if (pair === undefined) throw notFound();
      if (pair.status !== 'pending') {
        throw new AppError(409, 'already_resolved', 'This pair has already been resolved', []);
      }
      const source = pair.lead_id;
      const keeper = pair.duplicate_of;
      const both = await c.query<{ id: string; first_name: string | null; last_name: string | null; phone: string }>(
        `SELECT id, first_name, last_name, phone FROM leads
         WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL ORDER BY id FOR UPDATE`,
        [[source, keeper]],
      );
      if (both.rows.length !== 2) {
        throw new AppError(409, 'lead_gone', 'One side of this pair no longer exists', []);
      }
      const keeperRow = both.rows.find((r) => r.id === keeper)!;
      const keeperName =
        [keeperRow.first_name, keeperRow.last_name].filter(Boolean).join(' ') || keeperRow.phone;

      // §8.2 #1 — backfill: keeper data always wins; only its EMPTY fields
      // take the source's values.
      await c.query(
        `UPDATE leads k SET
           first_name = COALESCE(k.first_name, s.first_name),
           last_name  = COALESCE(k.last_name,  s.last_name),
           email      = COALESCE(k.email,      s.email),
           vehicle_interest     = COALESCE(k.vehicle_interest,     s.vehicle_interest),
           total_budget_cents   = COALESCE(k.total_budget_cents,   s.total_budget_cents),
           monthly_budget_cents = COALESCE(k.monthly_budget_cents, s.monthly_budget_cents),
           source_platform      = COALESCE(k.source_platform,      s.source_platform)
         FROM leads s WHERE k.id = $1 AND s.id = $2`,
        [keeper, source],
      );

      // §8.2 #2 — re-point the operational children in the same transaction.
      // consent_ledger stays (append-only; keys on phone/email identity).
      // lead_assignment_history and conversation_analysis stay too — both
      // are append-only historical snapshots OF the source (D-056).
      for (const table of ['deals', 'conversations', 'appointments']) {
        await c.query(`UPDATE ${table} SET lead_id = $1 WHERE lead_id = $2`, [keeper, source]);
      }

      // §8.2 #3 — the source's score row goes, and leads.score goes with it
      // (F-39: synced, not duplicated — a score with no breakdown is a lie).
      await c.query(`DELETE FROM lead_scores WHERE lead_id = $1`, [source]);

      // §8.2 #7 — the keeper just gained scorable facts (email, budget…):
      // recalculate best-effort, SAVEPOINT-guarded like scoreOnCreate so a
      // scoring failure cannot poison the merge transaction.
      await c.query('SAVEPOINT merge_rescore');
      try {
        await recalculateLeadScore(c, orgId, keeper);
        await c.query('RELEASE SAVEPOINT merge_rescore');
      } catch {
        await c.query('ROLLBACK TO SAVEPOINT merge_rescore');
      }

      // §8.2 #4 — retire the source as lost under the seeded system reason
      // (re-seeded if a tenant deleted it while unreferenced — D-056).
      const reason = await c.query<{ id: string }>(
        `INSERT INTO lost_reasons (organization_id, name, name_fr, icon, display_order)
         VALUES ($1, $2, 'Doublon fusionné', '🔗', 10)
         ON CONFLICT (organization_id, name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [orgId, MERGED_DUPLICATE_REASON],
      );
      await c.query(
        `UPDATE leads SET status = 'lost', lost_reason_id = $2, lost_reason_note = $3, score = NULL
         WHERE id = $1`,
        [source, reason.rows[0]!.id, `Fusionné avec ${keeperName}`.slice(0, 500)],
      );

      // §8.2 #5/#6 — this pair merged; every OTHER pending pair the source
      // sits in (either side) is now moot.
      const merged = await c.query<Record<string, unknown>>(
        `UPDATE lead_duplicates
         SET status = 'merged', merged_by = $2, merged_at = now(), resolved_by = $2, resolved_at = now()
         WHERE id = $1 RETURNING *`,
        [id, user.id],
      );
      await c.query(
        `UPDATE lead_duplicates
         SET status = 'dismissed', resolved_by = $2, resolved_at = now()
         WHERE status = 'pending' AND (lead_id = $1 OR duplicate_of = $1)`,
        [source, user.id],
      );

      await recordEvent(c, {
        organizationId: orgId, actorUserId: user.id,
        entityType: 'lead', entityId: keeper, action: 'updated',
        changes: { merged_from: { from: null, to: source } },
      });
      await recordEvent(c, {
        organizationId: orgId, actorUserId: user.id,
        entityType: 'lead', entityId: source, action: 'updated',
        changes: { merged_into: { from: null, to: keeper } },
      });
      return merged.rows[0]!;
    });
    return reply.send(row);
  });

  app.post('/api/v1/duplicates/:id/dismiss', async (request, reply) => {
    const id = idParam(request);
    const user = sessionUser(request);
    const orgId = await pairOrg(pool, user.id, id);
    const row = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'lead:update');
      const r = await c.query<Record<string, unknown>>(
        `UPDATE lead_duplicates
         SET status = 'dismissed', resolved_by = $2, resolved_at = now()
         WHERE id = $1 AND status = 'pending' RETURNING *`,
        [id, user.id],
      );
      if (r.rows.length === 0) {
        const exists = await c.query(`SELECT status FROM lead_duplicates WHERE id = $1`, [id]);
        if (exists.rows.length === 0) throw notFound();
        throw new AppError(409, 'already_resolved', 'This pair has already been resolved', []);
      }
      return r.rows[0]!;
    });
    return reply.send(row);
  });
}
