import type { FastifyInstance } from 'fastify';
import { withTenant, withUser, type Pool, type PoolClient } from '@dealpilot/db';
import {
  CalculateDealInput,
  CreateDealInput,
  DealListQuery,
  UpdateDealInput,
  type DeskingInputsT,
} from '@dealpilot/schemas';
import { AppError, notFound, parseOrThrow } from './errors.js';
import { conflictFrom, idParam, keysetPage, sessionUser } from './f01-routes.js';
import { writeCommissionsForFundedDeal } from './f09-commissions-routes.js';
import { checklistReadiness, DELIVERY_STAGES, ensureDealItems } from './checklist.js';
import { diff, recordEvent } from './activity.js';
import { generateDocuments } from './f13-document-routes.js';
import { computeOutputs, INPUT_COLUMNS, OUTPUT_COLUMNS } from './deal-outputs.js';
import { linkPrimaryBuyer } from './f36-deal-parties.js';

/** From Signed onward a deal has committed paperwork (documents.md §3). */
const SIGNED_ONWARD = new Set<string>([
  'signed', 'sourcing', 'pending_delivery', 'scheduled', 'delivered', 'complete',
]);

/** Editing any of these changes WHICH documents the deal needs. */
const DOC_SHAPE_FIELDS: readonly string[] = [
  'deal_type', 'province', 'trade_lien_cents', 'vehicle_id', 'sold_as_is',
];
import { requirePermission } from './permissions.js';

/**
 * F-05 desking (apiV1.deals) — the A-06 money engine behind the API.
 * `POST /deals/calculate` is a pure preview (nothing stored) so the worksheet
 * can recompute on every keystroke; create/update PERSIST the engine's answer
 * alongside the inputs, because a saved deal must reproduce exactly what the
 * customer was shown. Outputs are engine-owned: the schemas never accept them.
 *
 * Same tenancy model as F-02/F-04: reads under withUser, writes under
 * withTenant behind the membership gate. Any active member may desk a deal
 * (that is the sales floor's job); status moves are free within the vocabulary
 * until the approval workflow slice lands.
 */

/** Stored outputs + the derived payment frequencies the contract promises. */
function withDerived(row: Record<string, unknown>): Record<string, unknown> {
  const monthly = Number(row['monthly_payment_cents'] ?? 0);
  return {
    ...row,
    biweekly_payment_cents: Math.round((monthly * 12) / 26),
    weekly_payment_cents: Math.round((monthly * 12) / 52),
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

/** The car must live in the SAME tenant (RLS makes a foreign one invisible). */
async function requireVehicleInOrg(client: PoolClient, vehicleId: string): Promise<void> {
  const r = await client.query(`SELECT 1 FROM vehicles WHERE id = $1 AND deleted_at IS NULL`, [vehicleId]);
  if (r.rows.length === 0) {
    throw new AppError(422, 'validation_failed', 'Unknown vehicle for this organization', [
      { path: 'vehicle_id', code: 'invalid_reference', message: 'Vehicle not found in this organization' },
    ]);
  }
}

/** The lead must live in the SAME tenant (RLS makes a foreign one invisible). */
async function requireLeadInOrg(client: PoolClient, leadId: string): Promise<void> {
  const r = await client.query(`SELECT 1 FROM leads WHERE id = $1 AND deleted_at IS NULL`, [leadId]);
  if (r.rows.length === 0) {
    throw new AppError(422, 'validation_failed', 'Unknown lead for this organization', [
      { path: 'lead_id', code: 'invalid_reference', message: 'Lead not found in this organization' },
    ]);
  }
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


/**
 * A salesperson on a deal must be an ACTIVE MEMBER here (F-66 review): the
 * column is a bare FK to users, which Postgres checks past RLS, so any user
 * id in the system used to be attachable — and the leaderboard would then
 * rank, and name, a stranger from another dealer group.
 */
async function requireSalespersonMember(c: PoolClient, userId: string): Promise<void> {
  const r = await c.query(
    `SELECT 1 FROM memberships WHERE user_id = $1 AND status = 'active' LIMIT 1`,
    [userId],
  );
  if (r.rows.length === 0) {
    throw new AppError(422, 'validation_failed', 'Salesperson is not an active member here', [
      { path: 'salesperson_id', code: 'not_a_member', message: userId },
    ]);
  }
}

export function registerF05Routes(app: FastifyInstance, pool: Pool): void {
  app.post('/api/v1/deals/calculate', async (request, reply) => {
    // Pure: no tenant context, no writes — just the engine.
    const input = parseOrThrow(CalculateDealInput, request.body);
    return reply.send(computeOutputs(input));
  });

  app.post('/api/v1/deals', async (request, reply) => {
    const input = parseOrThrow(CreateDealInput, request.body);
    const user = sessionUser(request);
    const outputs = computeOutputs(input);
    try {
      const deal = await withTenant(pool, input.organization_id, async (c) => {
        await requirePermission(c, user.id, 'deal:create');
        await requireLiveStore(c, input.store_id);
        if (input.lead_id) await requireLeadInOrg(c, input.lead_id);
        if (input.vehicle_id) await requireVehicleInOrg(c, input.vehicle_id);
        if (input.salesperson_id) await requireSalespersonMember(c, input.salesperson_id);
        const cols = ['organization_id', 'store_id', 'lead_id', 'vehicle_id', 'salesperson_id',
          'fi_reserve_cents', 'sold_as_is', ...INPUT_COLUMNS, ...OUTPUT_COLUMNS];
        const values: unknown[] = [
          input.organization_id,
          input.store_id,
          input.lead_id ?? null,
          input.vehicle_id ?? null,
          input.salesperson_id ?? null,
          input.fi_reserve_cents ?? 0,
          input.sold_as_is ?? false,
          ...INPUT_COLUMNS.map((k) => (input as Record<string, unknown>)[k] ?? null),
          ...OUTPUT_COLUMNS.map((k) => (outputs as unknown as Record<string, number>)[k]),
        ];
        const r = await c.query<Record<string, unknown>>(
          `INSERT INTO deals (${cols.join(', ')})
           VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
          values,
        );
        // F-36 / FR-CON-005: the deal gets a person. In the SAME transaction,
        // because a deal that exists with no buyer is a contract with nobody on
        // it, and a customer record created for a deal that then failed to
        // insert is a stranger in the customer master.
        const buyerId = await linkPrimaryBuyer(c, {
          organizationId: input.organization_id,
          storeId: input.store_id,
          dealId: String(r.rows[0]!['id']),
          leadId: input.lead_id ?? null,
          contactId: input.contact_id ?? null,
        });
        // The trigger wrote deals.contact_id after the INSERT ... RETURNING
        // above had already produced its row, so the in-memory copy is stale.
        if (buyerId) r.rows[0]!['contact_id'] = buyerId;

        // leads.md §12 step 4: a deal born from a lead IS the conversion —
        // the lead's status says so in the same transaction. A lost lead
        // getting a deal was won after all; its lost_reason stays as history
        // (D-055 #1).
        if (input.lead_id) {
          // CTE reads the pre-statement row, so the audit event can say what
          // the lead WAS — a lost→converted flip is exactly the transition
          // the trail must show (D-055 #1 keeps the loss readable).
          const converted = await c.query<{ prior_status: string }>(
            `WITH prior AS (SELECT status FROM leads WHERE id = $1 FOR UPDATE)
             UPDATE leads SET status = 'converted'
             WHERE id = $1 AND deleted_at IS NULL AND status <> 'converted'
             RETURNING (SELECT status FROM prior) AS prior_status`,
            [input.lead_id],
          );
          const prior = converted.rows[0]?.prior_status;
          if (prior !== undefined) {
            await recordEvent(c, {
              organizationId: input.organization_id,
              storeId: input.store_id,
              actorUserId: user.id,
              entityType: 'lead',
              entityId: input.lead_id,
              action: 'updated',
              changes: { status: { from: prior, to: 'converted' }, via: 'deal_created' },
            });
          }
        }

        // F-08: take the checklist snapshot NOW, in the same transaction that
        // creates the deal. This is the moment store policy applies to it; a
        // template edited next week must not change what this deal owes.
        await ensureDealItems(c, input.organization_id, String(r.rows[0]!['id']));
        await recordEvent(c, {
          organizationId: input.organization_id,
          storeId: input.store_id,
          actorUserId: user.id,
          entityType: 'deal',
          entityId: String(r.rows[0]!['id']),
          action: 'created',
        });
        return r.rows[0]!;
      });
      return await reply.status(201).send(withDerived(deal));
    } catch (err) {
      throw conflictFrom(err) ?? err;
    }
  });

  app.get('/api/v1/deals/:id', async (request, reply) => {
    const dealId = idParam(request);
    const user = sessionUser(request);
    const deal = await withUser(pool, user.id, async (c) => {
      const r = await c.query<Record<string, unknown>>(
        `SELECT d.* FROM deals d
         JOIN organizations o ON o.id = d.organization_id AND o.deleted_at IS NULL
         WHERE d.id = $1 AND d.deleted_at IS NULL`,
        [dealId],
      );
      if (r.rows.length === 0) throw notFound();
      return r.rows[0]!;
    });
    return reply.send(withDerived(deal));
  });

  app.get('/api/v1/deals', async (request, reply) => {
    const query = parseOrThrow(DealListQuery, request.query);
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
      let sql = `SELECT * FROM deals WHERE organization_id = $1 AND deleted_at IS NULL`;
      const params: unknown[] = [orgId];
      for (const [key, value] of [
        ['store_id', query.store_id],
        ['lead_id', query.lead_id],
        ['pipeline_stage', query.pipeline_stage],
        ['funding_status', query.funding_status],
      ] as const) {
        if (value) {
          params.push(value);
          sql += ` AND ${key} = $${params.length}`;
        }
      }
      if (query.contact_id) {
        // Through deal_parties, not deals.contact_id: a cosigned deal is this
        // customer's deal too, and the denormalised column only knows the buyer.
        params.push(query.contact_id);
        sql += ` AND EXISTS (SELECT 1 FROM deal_parties p
                  WHERE p.deal_id = deals.id AND p.contact_id = $${params.length})`;
      }
      return keysetPage<Record<string, unknown> & { id: string }>(c, sql, params, query);
    });
    return reply.send({ ...page, items: page.items.map(withDerived) });
  });

  app.patch('/api/v1/deals/:id', async (request, reply) => {
    const dealId = idParam(request);
    const input = parseOrThrow(UpdateDealInput, request.body);
    const user = sessionUser(request);
    const orgId = await dealOrg(pool, user.id, dealId);
    const deal = await withTenant(pool, orgId, async (c) => {
      // Three different powers on one endpoint: moving the car, recording that
      // the money arrived, and editing the numbers. A salesperson may do the
      // first and third; only F&I records funding.
      if (input.pipeline_stage) await requirePermission(c, user.id, 'deal:change_stage');
      if (input.funding_status) await requirePermission(c, user.id, 'deal:change_funding');
      await requirePermission(c, user.id, 'deal:update');
      if (input.lead_id) await requireLeadInOrg(c, input.lead_id);
      if (input.vehicle_id) await requireVehicleInOrg(c, input.vehicle_id);
      if (input.salesperson_id) await requireSalespersonMember(c, input.salesperson_id);

      // FOR UPDATE: the checklist PATCH locks this same row, so a required item
      // cannot be unticked in the window between the readiness check below and
      // the stage write at the end of this transaction.
      const current = await c.query<Record<string, unknown>>(
        `SELECT * FROM deals WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [dealId],
      );
      if (current.rows.length === 0) throw notFound();

      // Once a deal has itemised F&I, its aggregate is DERIVED (F-13b's
      // trigger). Letting this route write it too would leave two sources of
      // truth for the same money, disagreeing until the next product write
      // silently overwrote whatever was typed here. Refused rather than
      // accepted-and-discarded, which is the CR-12 mistake in reverse.
      if (input.fi_price_cents !== undefined || input.fi_cost_cents !== undefined) {
        const itemised = await c.query(
          `SELECT 1 FROM deal_fi_products WHERE deal_id = $1 AND deleted_at IS NULL LIMIT 1`,
          [dealId],
        );
        if (itemised.rows.length > 0) {
          throw new AppError(422, 'fi_is_itemised', 'This deal’s F&I comes from its products', [
            {
              path: 'fi_price_cents',
              code: 'fi_is_itemised',
              message: 'Edit the F&I products instead — the deal total is their sum',
            },
          ]);
        }
      }

      // F-08: 'delivered' is a claim about the real world, so it has to be
      // earned — every REQUIRED checklist item done or waived-with-a-reason
      // first. A store that requires nothing passes trivially; the safety
      // inspection can never be waived (delivery.md §2).
      //
      // The gate covers EVERY stage at or past delivery, not just 'delivered':
      // 'complete' sits after it, so gating only the one stage would leave the
      // next one along as an open door.
      const wasDelivered = DELIVERY_STAGES.has(String(current.rows[0]!['pipeline_stage']));
      if (input.pipeline_stage && DELIVERY_STAGES.has(input.pipeline_stage) && !wasDelivered) {
        // Materialize the checklist here rather than trusting that someone
        // opened the panel first — a gate that only exists once you look at it
        // is not a gate.
        await ensureDealItems(c, orgId, dealId);
        const readiness = await checklistReadiness(c, dealId);
        if (!readiness.ready_for_delivery) {
          // ONE detail per outstanding item, each carrying the item's own code.
          // A single joined string would force the client to split on a comma
          // before it could translate anything — the A-10 lesson: the code is
          // the vocabulary, the message is only a fallback.
          throw new AppError(
            422,
            readiness.hard_blocked ? 'checklist_hard_blocked' : 'checklist_incomplete',
            'The delivery checklist is not complete',
            readiness.outstanding.length > 0
              ? readiness.outstanding.map((code) => ({
                  path: 'pipeline_stage',
                  code,
                  message: `Outstanding: ${code}`,
                }))
              : [{ path: 'pipeline_stage', code: 'checklist_missing', message: 'This deal has no checklist' }],
          );
        }
      }

      // F-13 §3: the document file is built when the deal reaches Signed, and
      // RE-built whenever the deal's shape changes afterwards. Generating it
      // lazily on a screen nobody had built meant the wet-ink gate had no rows
      // to check and passed everything — the gate existed and did nothing.
      if (input.pipeline_stage && SIGNED_ONWARD.has(input.pipeline_stage)) {
        await generateDocuments(c, orgId, dealId);
      } else if (DOC_SHAPE_FIELDS.some((f) => f in input)) {
        const has = await c.query(
          `SELECT 1 FROM deal_documents WHERE deal_id = $1 AND deleted_at IS NULL LIMIT 1`,
          [dealId],
        );
        if (has.rows.length > 0) await generateDocuments(c, orgId, dealId);
      }

      // Inputs changed ⇒ the engine speaks again: stored outputs must never
      // drift from the inputs beside them.
      const merged = { ...current.rows[0]!, ...input } as unknown as DeskingInputsT;
      const outputs = computeOutputs(merged);

      const setEntries: [string, unknown][] = [
        ...Object.entries(input),
        ...OUTPUT_COLUMNS.map((k) => [k, (outputs as unknown as Record<string, number>)[k]] as [string, unknown]),
      ];
      // The two tracks stamp their own moments: the commission engine keys its
      // monthly tier on funded_at, never on the stage (commissions §11).
      if (input.funding_status === 'funded' && !current.rows[0]!['funded_at']) {
        setEntries.push(['funded_at', new Date().toISOString()]);
      }
      if (input.pipeline_stage && DELIVERY_STAGES.has(input.pipeline_stage) && !current.rows[0]!['delivered_at']) {
        setEntries.push(['delivered_at', new Date().toISOString()]);
      }
      const sets = setEntries.map(([k], i) => `${k} = $${i + 2}`).join(', ');
      const r = await c.query<Record<string, unknown>>(
        `UPDATE deals SET ${sets} WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
        [dealId, ...setEntries.map(([, v]) => v)],
      );
      if (r.rows.length === 0) throw notFound();
      const updated = r.rows[0]!;

      // F-10 (ADR-009): recorded in THIS transaction, so a deal that moved and
      // a trail that says it moved cannot come apart. The stage and the money
      // get their own verbs — "updated" would bury the two changes anyone ever
      // actually goes looking for.
      const evt = {
        organizationId: orgId,
        storeId: String(updated['store_id']),
        actorUserId: user.id,
        entityType: 'deal' as const,
        entityId: dealId,
      };
      const before = current.rows[0]!;
      if (input.pipeline_stage && input.pipeline_stage !== before['pipeline_stage']) {
        await recordEvent(c, {
          ...evt,
          action: DELIVERY_STAGES.has(input.pipeline_stage) ? 'delivered' : 'stage_changed',
          changes: { pipeline_stage: { from: before['pipeline_stage'], to: input.pipeline_stage } },
        });
      }
      if (input.funding_status && input.funding_status !== before['funding_status']) {
        await recordEvent(c, {
          ...evt,
          action: 'funding_changed',
          changes: { funding_status: { from: before['funding_status'], to: input.funding_status } },
        });
      }
      // EVERY writable field, derived from the columns the UPDATE actually
      // writes — not a hand-picked nine. Changing `province` alone recomputes
      // both taxes, the amount financed, the payment and the gross that F-09
      // pays commission on; recording nothing for it made the trail worse than
      // useless, because it looked complete.
      const otherChanges = diff(before, input as Record<string, unknown>, [
        ...INPUT_COLUMNS,
        'salesperson_id', 'vehicle_id', 'lead_id', 'fi_reserve_cents',
      ]);
      if (Object.keys(otherChanges).length > 0) {
        await recordEvent(c, { ...evt, action: 'updated', changes: otherChanges });
      }

      // F-09: pay is written in the SAME transaction that records the money
      // arriving, so a funded deal and its commission can never disagree.
      // The engine (A-06) owns the math; the unique index makes it idempotent.
      if (input.funding_status === 'funded' && updated['funded_at']) {
        await writeCommissionsForFundedDeal(c, {
          id: String(updated['id']),
          organization_id: String(updated['organization_id']),
          salesperson_id: (updated['salesperson_id'] as string | null) ?? null,
          sale_price_cents: Number(updated['sale_price_cents']),
          vehicle_cost_cents: Number(updated['vehicle_cost_cents']),
          fi_reserve_cents: Number(updated['fi_reserve_cents'] ?? 0),
          funded_at: new Date(updated['funded_at'] as string | Date).toISOString(),
        });
      }
      return updated;
    });
    return reply.send(withDerived(deal));
  });
}
