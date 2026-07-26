import type { FastifyInstance } from 'fastify';
import { withTenant, withUser, type Pool, type PoolClient } from '@dealpilot/db';
import { canAdvanceDocument, requiredDocuments, type DealShape } from '@dealpilot/core';
import {
  CreateFiProductInput,
  DocumentListQuery,
  UpdateDocumentInput,
  UpdateFiProductInput,
} from '@dealpilot/schemas';
import { AppError, notFound, parseOrThrow } from './errors.js';
import { idParam, keysetPage, requireMember, sessionUser } from './f01-routes.js';
import { requirePermission } from './permissions.js';
import { recordEvent } from './activity.js';

/**
 * F-13 deal documents (documents.md).
 *
 * Which papers a deal needs is derived from the deal itself — a lease needs a
 * lease agreement, Ontario needs an OMVIC disclosure, a trade with a lien needs
 * a payoff authorization. The rule lives in packages/core with golden tests;
 * this module is the data and the transactions.
 *
 * The point of it: F-08's `wet_ink_file` checklist item and F-11b's dispatch
 * gate are both a manual tick today — a person asserting the file is complete.
 * With this table the question has a real answer.
 */

/** Build the checklist for a deal, once, from the deal's own shape. */
export async function generateDocuments(
  client: PoolClient,
  orgId: string,
  dealId: string,
): Promise<number> {
  // Lock the deal so two concurrent generations cannot both decide the list is
  // empty and each insert one.
  await client.query(`SELECT 1 FROM deals WHERE id = $1 FOR UPDATE`, [dealId]);

  const r = await client.query<{
    store_id: string; deal_type: string; province: string;
    trade_lien_cents: number; sold_as_is: boolean;
    vehicle_type: string | null; bill_of_sale_system: string;
  }>(
    `SELECT d.store_id, d.deal_type, d.province, d.trade_lien_cents, d.sold_as_is,
            v.vehicle_type, s.bill_of_sale_system
     FROM deals d
     JOIN stores s ON s.id = d.store_id
     LEFT JOIN vehicles v ON v.id = d.vehicle_id
     WHERE d.id = $1 AND d.deleted_at IS NULL`,
    [dealId],
  );
  if (r.rows.length === 0) throw notFound();
  const d = r.rows[0]!;

  // F-13b: the per-product agreements are named after these rows. Before they
  // existed the deal carried one aggregate F&I number with no names, so
  // warranty, GAP and aftermarket agreements could not be produced at all —
  // three of the thirteen types were unreachable.
  const products = await client.query<{ kind: 'warranty' | 'gap' | 'aftermarket'; name: string }>(
    `SELECT kind, name FROM deal_fi_products
     WHERE deal_id = $1 AND deleted_at IS NULL ORDER BY sort_order, created_at`,
    [dealId],
  );

  const shape: DealShape = {
    dealType: d.deal_type as DealShape['dealType'],
    province: d.province,
    tradeLienCents: d.trade_lien_cents ?? 0,
    soldAsIs: d.sold_as_is,
    vehicleType: (d.vehicle_type as 'new' | 'used' | null) ?? undefined,
    billOfSaleSystem: d.bill_of_sale_system as DealShape['billOfSaleSystem'],
    fiProducts: products.rows.map((x) => ({ kind: x.kind, name: x.name })),
  };

  const docs = requiredDocuments(shape);
  let added = 0;
  for (const doc of docs) {
    const r = await client.query(
      `INSERT INTO deal_documents
         (organization_id, store_id, deal_id, document_type, document_name,
          source_system, requires_signature, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [orgId, d.store_id, dealId, doc.type, doc.name, doc.source, doc.requiresSignature, doc.sortOrder],
    );
    added += r.rows.length;
  }

  // The set is RE-derived, not derived once: editing a QC cash deal into an
  // Ontario financed one has to add the bank contract and the OMVIC disclosure.
  // Before this it kept the original four and reported a complete file.
  //
  // Documents no longer required are removed only while untouched — once someone
  // has printed or signed it, it is part of the record and stays.
  //
  // Keyed by the (type, name) PAIR, not type alone: a deal can carry two aftermarket
  // agreements, so dropping one of the two products has to remove that one's
  // agreement and leave the other's. Comparing types only left an orphan
  // agreement in the file for a product nobody sold.
  const wantedTypes = docs.map((x) => x.type);
  const wantedNames = docs.map((x) => x.name);
  await client.query(
    `UPDATE deal_documents SET deleted_at = now()
     WHERE deal_id = $1 AND deleted_at IS NULL
       AND status IN ('not_ready','generated')
       AND (document_type, document_name) NOT IN (
             SELECT * FROM unnest($2::text[], $3::text[]))`,
    [dealId, wantedTypes, wantedNames],
  );
  return added;
}

export function registerF13Routes(app: FastifyInstance, pool: Pool): void {
  /**
   * The deal's file. Generated on first read if the deal has none — the same
   * shape as F-08's checklist, and for the same reason: a list that only exists
   * once somebody clicks a button is a list people forget to make.
   */
  app.get('/api/v1/deals/:id/documents', async (request, reply) => {
    const dealId = idParam(request);
    const user = sessionUser(request);
    const orgId = await dealOrg(pool, user.id, dealId);
    const result = await withTenant(pool, orgId, async (c) => {
      await requireMember(c, user.id);
      await generateDocuments(c, orgId, dealId);
      const items = await c.query(
        `SELECT * FROM deal_documents WHERE deal_id = $1 AND deleted_at IS NULL ORDER BY sort_order`,
        [dealId],
      );
      const state = await c.query<{ prepared: boolean | null; complete: boolean | null }>(
        `SELECT wet_ink_prepared($1) AS prepared, wet_ink_complete($1) AS complete`,
        [dealId],
      );
      return {
        items: items.rows,
        // PREPARED is the one dispatch gates on: printed and ready to travel.
        // COMPLETE is the after-delivery question.
        wet_ink_prepared: state.rows[0]?.prepared ?? null,
        wet_ink_complete: state.rows[0]?.complete ?? null,
      };
    });
    return reply.send(result);
  });

  /** Move a document along its lifecycle, or record its e-sign details. */
  app.patch('/api/v1/documents/:id', async (request, reply) => {
    const documentId = idParam(request);
    const input = parseOrThrow(UpdateDocumentInput, request.body);
    const user = sessionUser(request);
    const orgId = await rowOrg(pool, user.id, documentId);

    const updated = await withTenant(pool, orgId, async (c) => {
      // Graded, because these are not the same act. Printing and assembling is
      // day-to-day admin work; recording that a customer SIGNED a legal
      // document is the evidence a delivery rests on. `checklist:complete` —
      // which eight of ten roles hold — was the wrong authority for the second.
      const signing = input.status === 'signed' || input.status === 'filed' || input.status === 'e_signed';
      await requirePermission(c, user.id, signing ? 'document:sign' : 'document:prepare');

      const before = await c.query<Record<string, unknown>>(
        `SELECT * FROM deal_documents WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [documentId],
      );
      if (before.rows.length === 0) throw notFound();
      const prior = before.rows[0]!;
      const from = String(prior['status']);

      const requiresSignature = prior['requires_signature'] === true;
      if (
        input.status && input.status !== from &&
        !canAdvanceDocument(from, input.status, requiresSignature)
      ) {
        throw new AppError(422, 'invalid_transition', `A document cannot go from ${from} to ${input.status}`, [
          { path: 'status', code: 'invalid_transition', message: `${from} → ${input.status}` },
        ]);
      }

      const sets: string[] = [];
      const params: unknown[] = [documentId];
      for (const [k, v] of Object.entries(input)) {
        if (!DOCUMENT_COLUMNS.has(k)) continue;
        params.push(v);
        sets.push(`${k} = $${params.length}`);
      }
      // The server stamps when each step actually happened — these timestamps
      // are what an audit reads. Only on a real CHANGE: re-sending `filed` on an
      // already-filed document used to silently reassign filed_by to whoever
      // sent it, with the event suppressed. That is the exact bug F-08 fixed and
      // this reintroduced.
      const moved = input.status !== undefined && input.status !== from;
      if (moved && input.status === 'printed') {
        params.push(user.id);
        sets.push('printed_at = now()', `printed_by = $${params.length}`);
      }
      if (moved && input.status === 'signed') sets.push('signed_at_delivery = now()');
      if (moved && input.status === 'e_signed') sets.push('esign_signed_at = now()');
      if (moved && input.status === 'filed') {
        params.push(user.id);
        sets.push('filed_at = now()', `filed_by = $${params.length}`);
      }
      if (sets.length === 0) return prior;

      const r = await c.query<Record<string, unknown>>(
        `UPDATE deal_documents SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
        params,
      );

      if (input.status && input.status !== from) {
        await recordEvent(c, {
          organizationId: orgId,
          storeId: String(prior['store_id']),
          actorUserId: user.id,
          entityType: 'deal_document',
          entityId: documentId,
          action: 'stage_changed',
          parentEntityType: 'deal',
          parentEntityId: String(prior['deal_id']),
          changes: {
            document_type: prior['document_type'],
            status: { from, to: input.status },
          },
        });
      }
      return r.rows[0]!;
    });
    return reply.send(updated);
  });

  /**
   * F-13b itemised F&I. Products are the detail behind the deal's aggregate
   * F&I price and cost, and the agreements in the file are named after them.
   */
  app.get('/api/v1/deals/:id/fi-products', async (request, reply) => {
    const dealId = idParam(request);
    const user = sessionUser(request);
    const orgId = await dealOrg(pool, user.id, dealId);
    const rows = await withTenant(pool, orgId, async (c) => {
      await requireMember(c, user.id);
      const r = await c.query(
        `SELECT * FROM deal_fi_products WHERE deal_id = $1 AND deleted_at IS NULL
         ORDER BY sort_order, created_at`,
        [dealId],
      );
      return r.rows;
    });
    return reply.send(rows);
  });

  app.post('/api/v1/deals/:id/fi-products', async (request, reply) => {
    const dealId = idParam(request);
    const input = parseOrThrow(CreateFiProductInput, request.body);
    const user = sessionUser(request);
    const orgId = await dealOrg(pool, user.id, dealId);

    const created = await withTenant(pool, orgId, async (c) => {
      // F&I price and cost are deal money — the same authority that edits the
      // deal, not a new permission nobody has been granted.
      await requirePermission(c, user.id, 'deal:update');
      const deal = await c.query<{ store_id: string; fi_price_cents: number }>(
        `SELECT store_id, fi_price_cents FROM deals
         WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [dealId],
      );
      if (deal.rows.length === 0) throw notFound();
      const priorTotal = deal.rows[0]!.fi_price_cents;

      let row: Record<string, unknown>;
      try {
        const r = await c.query<Record<string, unknown>>(
          `INSERT INTO deal_fi_products
             (organization_id, store_id, deal_id, kind, name, provider,
              price_cents, cost_cents, term_months, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING *`,
          [
            orgId, deal.rows[0]!.store_id, dealId, input.kind, input.name,
            input.provider ?? null, input.price_cents ?? 0, input.cost_cents ?? 0,
            input.term_months ?? null, input.sort_order ?? 0,
          ],
        );
        row = r.rows[0]!;
      } catch (err) {
        // One warranty and one GAP per deal, mirroring the document file — a
        // second of either would generate an agreement the unique index then
        // swallows, leaving a product with no paperwork.
        if ((err as { code?: string }).code === '23505') {
          throw new AppError(409, 'product_exists', `This deal already has a ${input.kind} product`, [
            { path: 'kind', code: 'product_exists', message: input.kind },
          ]);
        }
        throw err;
      }

      // The trigger has just replaced the deal's aggregate with the sum of its
      // products. That is the better record, but it is someone's money moving
      // without them asking — so it is recorded, never silent.
      const after = await c.query<{ fi_price_cents: number }>(
        `SELECT fi_price_cents FROM deals WHERE id = $1`,
        [dealId],
      );
      await recordEvent(c, {
        organizationId: orgId,
        storeId: String(row['store_id']),
        actorUserId: user.id,
        entityType: 'deal_fi_product',
        entityId: String(row['id']),
        action: 'created',
        parentEntityType: 'deal',
        parentEntityId: dealId,
        changes: {
          kind: input.kind,
          name: input.name,
          ...(after.rows[0]!.fi_price_cents !== priorTotal
            ? { fi_price_cents: { from: priorTotal, to: after.rows[0]!.fi_price_cents } }
            : {}),
        },
      });
      // The file follows the products: a warranty sold means a warranty
      // agreement in the folder, without anyone remembering to ask for it.
      await generateDocuments(c, orgId, dealId);
      return row;
    });
    return reply.code(201).send(created);
  });

  app.patch('/api/v1/fi-products/:id', async (request, reply) => {
    const productId = idParam(request);
    const input = parseOrThrow(UpdateFiProductInput, request.body);
    const user = sessionUser(request);
    const orgId = await rowOrg(pool, user.id, productId, 'deal_fi_products');

    const updated = await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'deal:update');
      const before = await c.query<Record<string, unknown>>(
        `SELECT * FROM deal_fi_products WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [productId],
      );
      if (before.rows.length === 0) throw notFound();
      const prior = before.rows[0]!;

      // Cost above price stays refused on the way through, not only on the way
      // in: PATCHing the price down under an untouched cost is the same loss
      // the create path rejects.
      const price = (input.price_cents ?? prior['price_cents']) as number;
      const cost = (input.cost_cents ?? prior['cost_cents']) as number;
      if (cost > price) {
        throw new AppError(422, 'cost_above_price', 'Cost is higher than price', [
          { path: 'cost_cents', code: 'cost_above_price', message: `${cost} > ${price}` },
        ]);
      }

      const sets: string[] = [];
      const params: unknown[] = [productId];
      for (const [k, v] of Object.entries(input)) {
        if (!FI_PRODUCT_COLUMNS.has(k)) continue;
        params.push(v);
        sets.push(`${k} = $${params.length}`);
      }
      if (sets.length === 0) return prior;

      const r = await c.query<Record<string, unknown>>(
        `UPDATE deal_fi_products SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
        params,
      );
      const changes = Object.fromEntries(
        Object.entries(input)
          .filter(([k, v]) => FI_PRODUCT_COLUMNS.has(k) && v !== prior[k])
          .map(([k, v]) => [k, { from: prior[k], to: v }]),
      );
      if (Object.keys(changes).length > 0) {
        await recordEvent(c, {
          organizationId: orgId,
          storeId: String(prior['store_id']),
          actorUserId: user.id,
          entityType: 'deal_fi_product',
          entityId: productId,
          action: 'updated',
          parentEntityType: 'deal',
          parentEntityId: String(prior['deal_id']),
          changes,
        });
      }
      // A renamed product renames its agreement — while that agreement is still
      // untouched. Once printed it is part of the record and stays as printed.
      await generateDocuments(c, orgId, String(prior['deal_id']));
      return r.rows[0]!;
    });
    return reply.send(updated);
  });

  app.delete('/api/v1/fi-products/:id', async (request, reply) => {
    const productId = idParam(request);
    const user = sessionUser(request);
    const orgId = await rowOrg(pool, user.id, productId, 'deal_fi_products');

    await withTenant(pool, orgId, async (c) => {
      await requirePermission(c, user.id, 'deal:update');
      const before = await c.query<Record<string, unknown>>(
        `SELECT * FROM deal_fi_products WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [productId],
      );
      if (before.rows.length === 0) throw notFound();
      const prior = before.rows[0]!;

      await c.query(`UPDATE deal_fi_products SET deleted_at = now() WHERE id = $1`, [productId]);
      await recordEvent(c, {
        organizationId: orgId,
        storeId: String(prior['store_id']),
        actorUserId: user.id,
        entityType: 'deal_fi_product',
        entityId: productId,
        action: 'deleted',
        parentEntityType: 'deal',
        parentEntityId: String(prior['deal_id']),
        changes: { kind: prior['kind'], name: prior['name'], price_cents: prior['price_cents'] },
      });
      // Removing the product removes its unprinted agreement; the deal's F&I
      // total drops by the trigger in the same transaction.
      await generateDocuments(c, orgId, String(prior['deal_id']));
    });
    return reply.code(204).send();
  });

  /** Everything outstanding across the org — the filing clerk's worklist. */
  app.get('/api/v1/documents', async (request, reply) => {
    const query = parseOrThrow(DocumentListQuery, request.query);
    const user = sessionUser(request);
    const orgId = await resolveOrg(pool, user.id, query.organization_id);
    const page = await withTenant(pool, orgId, async (c) => {
      await requireMember(c, user.id);
      const params: unknown[] = [orgId];
      let where = 'organization_id = $1 AND deleted_at IS NULL';
      for (const [col, val] of [
        ['deal_id', query.deal_id],
        ['status', query.status],
        ['document_type', query.document_type],
      ] as const) {
        if (val) {
          params.push(val);
          where += ` AND ${col} = $${params.length}`;
        }
      }
      return keysetPage(c, `SELECT * FROM deal_documents WHERE ${where}`, params, query);
    });
    return reply.send(page);
  });
}

const FI_PRODUCT_COLUMNS = new Set([
  'name', 'provider', 'price_cents', 'cost_cents', 'term_months', 'sort_order',
]);

const DOCUMENT_COLUMNS = new Set([
  'status', 'notes', 'esign_platform', 'esign_envelope_id',
  'unsigned_file_url', 'signed_file_url',
]);

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

async function callerOrgs(pool: Pool, userId: string): Promise<string[]> {
  return withUser(pool, userId, async (c) => {
    const r = await c.query<{ organization_id: string }>(
      `SELECT DISTINCT m.organization_id FROM memberships m
       JOIN organizations o ON o.id = m.organization_id AND o.deleted_at IS NULL
       WHERE m.status = 'active'`,
    );
    return r.rows.map((x) => x.organization_id);
  });
}

async function resolveOrg(pool: Pool, userId: string, selector?: string): Promise<string> {
  const orgs = await callerOrgs(pool, userId);
  if (selector) {
    // A cross-tenant id must not confirm that it exists.
    if (!orgs.includes(selector)) throw notFound();
    return selector;
  }
  if (orgs.length === 0) throw notFound();
  if (orgs.length > 1) {
    throw new AppError(400, 'organization_required', 'Pass organization_id — you belong to several organizations');
  }
  return orgs[0]!;
}

/**
 * Which of the caller's orgs owns this row — 404 for everyone else, so a
 * stranger's id and an id that never existed are indistinguishable (ADR-021).
 *
 * `table` is a union of two literals rather than a string: the value reaches
 * SQL by interpolation, and only a closed set may ever do that.
 */
async function rowOrg(
  pool: Pool,
  userId: string,
  rowId: string,
  table: 'deal_documents' | 'deal_fi_products' = 'deal_documents',
): Promise<string> {
  for (const orgId of await callerOrgs(pool, userId)) {
    const found = await withTenant(pool, orgId, async (c) => {
      const r = await c.query(`SELECT 1 FROM ${table} WHERE id = $1`, [rowId]);
      return r.rows.length > 0;
    });
    if (found) return orgId;
  }
  throw notFound();
}
