import type { FastifyInstance } from 'fastify';
import { withTenant, withUser, type Pool } from '@dealpilot/db';
import { ChecklistCode, UpdateChecklistItemInput, UpdateChecklistTemplateInput } from '@dealpilot/schemas';
import { AppError, notFound, parseOrThrow } from './errors.js';
import { checklistReadiness, ensureDealItems, ensureTemplate, type ItemRow } from './checklist.js';
import { idParam, requireMember, sessionUser, STORE_WRITE_ROLES } from './f01-routes.js';

/**
 * F-08 delivery checklist (delivery.md §2) — the gate between Signed and
 * Delivered, so "delivered" is auditable rather than a claim.
 *
 * A deal's items are copied from its store's template when the DEAL is created,
 * and each item SNAPSHOTS `required`/`overridable`: changing store policy
 * tomorrow must never rewrite what a deal in flight was allowed to deliver on.
 *
 * Waiving is possible for the nine soft items — with a reason, an author and a
 * timestamp, never silently. The safety inspection is a HARD block: it is a
 * legal obligation, so no role can waive it.
 */

export function registerF08Routes(app: FastifyInstance, pool: Pool): void {
  app.get('/api/v1/deals/:id/checklist', async (request, reply) => {
    const dealId = idParam(request);
    const user = sessionUser(request);
    const orgId = await dealOrg(pool, user.id, dealId);
    const result = await withTenant(pool, orgId, async (c) => {
      await requireMember(c, user.id);
      const items = await c.query(
        `SELECT * FROM deal_checklist_items WHERE deal_id = $1 ORDER BY sort_order`,
        [dealId],
      );
      return { items: items.rows, readiness: await checklistReadiness(c, dealId) };
    });
    return reply.send(result);
  });

  app.patch('/api/v1/deals/:id/checklist/:code', async (request, reply) => {
    const dealId = idParam(request);
    const code = checklistCode(request);
    const input = parseOrThrow(UpdateChecklistItemInput, request.body);
    const user = sessionUser(request);
    const orgId = await dealOrg(pool, user.id, dealId);

    const item = await withTenant(pool, orgId, async (c) => {
      const roles = await requireMember(c, user.id);
      const isManager = roles.some((r) => STORE_WRITE_ROLES.includes(r as (typeof STORE_WRITE_ROLES)[number]));

      // Lock the DEAL first, THEN touch its items — the same order F-05 takes,
      // so the two paths can never deadlock by grabbing the deal row and its
      // child rows in opposite sequences. (Inserting items first would take a
      // KEY SHARE lock on this row and then upgrade it, which is the classic
      // inversion.) The lock also serializes the whole edit against a move to
      // 'delivered', so a requirement cannot be unticked mid-gate.
      const deal = await c.query<{ delivered_at: Date | null }>(
        `SELECT delivered_at FROM deals WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [dealId],
      );
      if (deal.rows.length === 0) throw notFound();

      // Once the car has been delivered, the checklist is the EVIDENCE that it
      // was allowed to be, and nothing keeps history. This keys on delivered_at,
      // NOT on the current stage: stage moves are unrestricted, so anyone could
      // otherwise walk the deal back one stage, untick everything, and walk it
      // forward again — stripping the proof while the gate stayed satisfied.
      if (deal.rows[0]!.delivered_at !== null) {
        throw new AppError(409, 'deal_delivered', 'This deal is delivered — its checklist is now the record', [
          { path: 'deal_id', code: 'deal_delivered', message: 'A delivered deal’s checklist cannot be changed' },
        ]);
      }

      await ensureDealItems(c, orgId, dealId);

      const current = await c.query<ItemRow>(
        `SELECT code, required, overridable, completed_at, overridden_at
         FROM deal_checklist_items WHERE deal_id = $1 AND code = $2`,
        [dealId, code],
      );
      if (current.rows.length === 0) throw notFound();
      const target = current.rows[0]!;

      const sets: string[] = [];
      const params: unknown[] = [dealId, code];
      if (input.completed !== undefined) {
        // A non-overridable item is the legally required one. Ticking it is a
        // sworn statement that the inspection happened, so it carries the same
        // authority as waiving a soft item — otherwise "cannot be waived" would
        // just mean "type `completed` instead of `overridden`".
        if (!target.overridable && !isManager) {
          throw new AppError(403, 'forbidden', 'Only an owner or GM can sign off the safety inspection');
        }
        sets.push(`completed_at = ${input.completed ? 'now()' : 'NULL'}`);
        params.push(input.completed ? user.id : null);
        sets.push(`completed_by = $${params.length}`);
      }
      if (input.overridden !== undefined) {
        // Deny by default, and BEFORE any business check: a caller who may not
        // waive learns nothing about which items are waivable.
        if (!isManager) {
          throw new AppError(403, 'forbidden', 'Only an owner or GM can waive a checklist item');
        }
        if (input.overridden) {
          // The safety inspection is a legal obligation — no role waives it.
          if (!target.overridable) {
            throw new AppError(422, 'hard_block', 'This item cannot be waived', [
              { path: 'overridden', code: 'hard_block', message: 'A safety inspection is required by law' },
            ]);
          }
          params.push(user.id, input.override_reason);
          sets.push(`overridden_at = now()`, `overridden_by = $${params.length - 1}`, `override_reason = $${params.length}`);
        } else {
          // Clearing a waiver erases a manager's recorded reason, and nothing
          // keeps history — so it is a manager's decision to undo (above).
          sets.push('overridden_at = NULL', 'overridden_by = NULL', 'override_reason = NULL');
        }
      }
      if (sets.length === 0) {
        const r = await c.query(`SELECT * FROM deal_checklist_items WHERE deal_id = $1 AND code = $2`, [dealId, code]);
        return r.rows[0];
      }
      const r = await c.query(
        `UPDATE deal_checklist_items SET ${sets.join(', ')} WHERE deal_id = $1 AND code = $2 RETURNING *`,
        params,
      );
      return r.rows[0];
    });
    return reply.send(item);
  });

  app.get('/api/v1/stores/:id/checklist-template', async (request, reply) => {
    const storeId = idParam(request);
    const user = sessionUser(request);
    const orgId = await storeOrgFor(pool, user.id, storeId);
    const rows = await withTenant(pool, orgId, async (c) => {
      await requireMember(c, user.id);
      const r = await c.query(
        `SELECT * FROM checklist_templates WHERE store_id = $1 ORDER BY sort_order`,
        [storeId],
      );
      return r.rows;
    });
    return reply.send({ items: rows });
  });

  app.patch('/api/v1/stores/:id/checklist-template/:code', async (request, reply) => {
    const storeId = idParam(request);
    const code = checklistCode(request);
    const input = parseOrThrow(UpdateChecklistTemplateInput, request.body);
    const user = sessionUser(request);
    const orgId = await storeOrgFor(pool, user.id, storeId);
    const row = await withTenant(pool, orgId, async (c) => {
      await requireMember(c, user.id, STORE_WRITE_ROLES);
      await ensureTemplate(c, orgId, storeId);
      // Safety is required by law: a store cannot configure it away.
      if (code === 'safety' && (input.required === false || input.active === false)) {
        throw new AppError(422, 'hard_block', 'The safety inspection cannot be switched off', [
          { path: 'required', code: 'hard_block', message: 'Required by law' },
        ]);
      }
      const fields = Object.entries(input).filter(([k]) => TEMPLATE_COLUMNS.has(k));
      if (fields.length === 0) {
        const r = await c.query(`SELECT * FROM checklist_templates WHERE store_id = $1 AND code = $2`, [storeId, code]);
        if (r.rows.length === 0) throw notFound();
        return r.rows[0];
      }
      const sets = fields.map(([k], i) => `${k} = $${i + 3}`).join(', ');
      const r = await c.query(
        `UPDATE checklist_templates SET ${sets} WHERE store_id = $1 AND code = $2 RETURNING *`,
        [storeId, code, ...fields.map(([, v]) => v)],
      );
      if (r.rows.length === 0) throw notFound();
      return r.rows[0];
    });
    return reply.send(row);
  });
}

/**
 * Column names are spliced into the SET clause, so they come from THIS list —
 * not from whatever keys the request happened to carry. The Zod schema is
 * strict and would already reject an unknown key; this makes the SQL safe on
 * its own terms, so editing a schema in another package can never open an
 * injection here.
 */
const TEMPLATE_COLUMNS = new Set(['label_fr', 'label_en', 'required', 'sort_order', 'active']);

/** A code is part of a closed set — anything else is simply not a thing. */
function checklistCode(request: { params: unknown }): string {
  const parsed = ChecklistCode.safeParse((request.params as { code?: unknown }).code);
  if (!parsed.success) throw notFound();
  return parsed.data;
}

async function dealOrg(pool: Pool, userId: string, dealId: string): Promise<string> {
  return withUser(pool, userId, async (c) => {
    const r = await c.query<{ organization_id: string }>(
      `SELECT d.organization_id FROM deals d
       JOIN organizations o ON o.id = d.organization_id AND o.deleted_at IS NULL
       WHERE d.id = $1 AND d.deleted_at IS NULL`,
      [dealId],
    );
    if (r.rows.length === 0) throw notFound();
    return r.rows[0]!.organization_id;
  });
}

async function storeOrgFor(pool: Pool, userId: string, storeId: string): Promise<string> {
  return withUser(pool, userId, async (c) => {
    const r = await c.query<{ organization_id: string }>(
      `SELECT s.organization_id FROM stores s
       JOIN organizations o ON o.id = s.organization_id AND o.deleted_at IS NULL
       WHERE s.id = $1 AND s.deleted_at IS NULL`,
      [storeId],
    );
    if (r.rows.length === 0) throw notFound();
    return r.rows[0]!.organization_id;
  });
}
