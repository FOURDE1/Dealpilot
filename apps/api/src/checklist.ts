import type { PoolClient } from '@dealpilot/db';
import { notFound } from './errors.js';

/**
 * F-08 delivery checklist — the domain helpers, kept apart from the routes so
 * store creation (F-01) and deal creation/delivery (F-05) can use them without
 * importing a route module back the other way.
 */

const CANONICAL = [
  { code: 'insurance', label_fr: 'Assurance du client', label_en: 'Client insurance', overridable: true, sort_order: 1 },
  { code: 'void_cheque', label_fr: 'Chèque annulé', label_en: 'Void cheque', overridable: true, sort_order: 2 },
  { code: 'funding', label_fr: 'Financement approuvé', label_en: 'Funding approved', overridable: true, sort_order: 3 },
  { code: 'idv', label_fr: "Vérification d'identité", label_en: 'Identity verification', overridable: true, sort_order: 4 },
  { code: 'safety', label_fr: 'Inspection de sécurité', label_en: 'Safety inspection', overridable: false, sort_order: 5 },
  { code: 'vehicle_ready', label_fr: 'Véhicule prêt', label_en: 'Vehicle ready', overridable: true, sort_order: 6 },
  { code: 'wet_ink_file', label_fr: 'Dossier signé (original)', label_en: 'Wet-ink file', overridable: true, sort_order: 7 },
  { code: 'delivery_date', label_fr: 'Date de livraison', label_en: 'Delivery date', overridable: true, sort_order: 8 },
  { code: 'drivers_booked', label_fr: 'Chauffeurs réservés', label_en: 'Drivers booked', overridable: true, sort_order: 9 },
  { code: 'registration', label_fr: 'Immatriculation', label_en: 'Registration', overridable: true, sort_order: 10 },
] as const;

/** F-70: the same list, for the provisioning seeds (org-seeds.ts) — never a second copy. */
export { CANONICAL as CHECKLIST_CANONICAL };

/**
 * Give a store its template. Called when a store is CREATED, so reads never
 * have to write. One statement, idempotent, safe to call again.
 */
export async function ensureTemplate(client: PoolClient, orgId: string, storeId: string): Promise<void> {
  // ON CONFLICT makes this idempotent, so it also REPAIRS a store that is
  // missing a code — an early-exit on "has any row" would leave such a store
  // permanently short one requirement.
  // Five bound values per row (code, both labels, overridable, sort order);
  // organization and store are $1/$2 and shared by every row.
  const values = CANONICAL.map((_, i) => {
    const b = i * 5;
    return `($1, $2, $${b + 3}, $${b + 4}, $${b + 5}, true, $${b + 6}, $${b + 7})`;
  }).join(', ');
  await client.query(
    `INSERT INTO checklist_templates
       (organization_id, store_id, code, label_fr, label_en, required, overridable, sort_order)
     VALUES ${values}
     ON CONFLICT (organization_id, store_id, code) DO NOTHING`,
    [orgId, storeId, ...CANONICAL.flatMap((i) => [i.code, i.label_fr, i.label_en, i.overridable, i.sort_order])],
  );
}

/**
 * Attach the store's template to a deal, once. Called when the DEAL is created:
 * that is the moment the snapshot is meant to be taken, so a template edited
 * later cannot change what an in-flight deal was required to do.
 *
 * It stays callable elsewhere as a backstop for deals that predate F-08 — those
 * have no snapshot to preserve, so taking one late is the best answer available.
 */
export async function ensureDealItems(client: PoolClient, orgId: string, dealId: string): Promise<void> {
  const existing = await client.query(`SELECT 1 FROM deal_checklist_items WHERE deal_id = $1 LIMIT 1`, [dealId]);
  if (existing.rows.length > 0) return;

  const deal = await client.query<{ store_id: string }>(
    `SELECT store_id FROM deals WHERE id = $1 AND deleted_at IS NULL`,
    [dealId],
  );
  if (deal.rows.length === 0) throw notFound();
  await ensureTemplate(client, orgId, deal.rows[0]!.store_id);

  await client.query(
    `INSERT INTO deal_checklist_items
       (organization_id, deal_id, code, label_fr, label_en, required, overridable, sort_order)
     SELECT $1, $2, code, label_fr, label_en, required, overridable, sort_order
     FROM checklist_templates
     WHERE organization_id = $1 AND store_id = $3 AND active
     -- Stable insert order: two concurrent attaches queue instead of deadlocking.
     ORDER BY code
     ON CONFLICT (deal_id, code) DO NOTHING`,
    [orgId, dealId, deal.rows[0]!.store_id],
  );
}

/**
 * The stages that mean the customer has the car. Shared by the F-05 delivery
 * gate and the F-08 checklist freeze so the two can never drift apart.
 */
export const DELIVERY_STAGES = new Set(['delivered', 'complete']);

export interface ItemRow {
  code: string;
  required: boolean;
  overridable: boolean;
  completed_at: Date | null;
  overridden_at: Date | null;
}

/** An item is satisfied when it is done, or waived with a reason. */
const satisfied = (i: ItemRow) => i.completed_at !== null || i.overridden_at !== null;

export async function checklistReadiness(client: PoolClient, dealId: string) {
  const r = await client.query<ItemRow>(
    `SELECT code, required, overridable, completed_at, overridden_at
     FROM deal_checklist_items WHERE deal_id = $1 ORDER BY sort_order`,
    [dealId],
  );
  const outstanding = r.rows.filter((i) => i.required && !satisfied(i));
  // A deal with NO items has not satisfied its checklist — it hasn't got one.
  // That is the honest state for a deal predating F-08, and it still fails
  // CLOSED so a broken attach can never open the gate. It does not invent an
  // outstanding item: naming one the deal never had would be a different lie.
  if (r.rows.length === 0) {
    return { deal_id: dealId, ready_for_delivery: false, outstanding: [], hard_blocked: false };
  }
  return {
    deal_id: dealId,
    ready_for_delivery: outstanding.length === 0,
    outstanding: outstanding.map((i) => i.code),
    // The safety item can never be waived, so it blocks on its own terms.
    hard_blocked: outstanding.some((i) => !i.overridable),
  };
}
