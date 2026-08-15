import type { PoolClient } from '@dealpilot/db';
import { AppError } from './errors.js';

/**
 * The deal's parties (FR-CON-005) and the merge (FR-CON-003).
 *
 * A deal has had a lead and a vehicle but never a person. `deal_parties` is the
 * authoritative buyer/cosigner link; `deals.contact_id` is a copy of the buyer
 * maintained by a database trigger and by nothing else, so the two cannot drift
 * apart no matter what a caller does.
 *
 * Matching is by phone, and only by phone. Names collide — a rooftop selling to
 * three Tremblays is a Tuesday — and a merge is easy to perform but impossible
 * to undo, so the rule is deliberately narrow: an exact phone match, in this
 * organisation, or a new record. Two records for one person is a nuisance
 * somebody can fix. One record for two people is a customer reading another
 * customer's purchase history, and there is no unmerge.
 */

interface LeadSeed {
  phone: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  preferred_language: string;
}

/**
 * Resolve the buyer for a new deal and record them as a party.
 *
 * Returns the contact id, or null when the deal carries nothing to match on —
 * a cash deal with no lead and no explicit contact has no phone number, and
 * inventing a blank customer record to satisfy a foreign key would put a row in
 * the customer master that represents nobody.
 */
export async function linkPrimaryBuyer(
  c: PoolClient,
  args: {
    organizationId: string;
    storeId: string;
    dealId: string;
    leadId?: string | null;
    contactId?: string | null;
  },
): Promise<string | null> {
  const contactId = args.contactId
    ? await requireContactInOrg(c, args.contactId)
    : await contactFromLead(c, args);

  if (!contactId) return null;

  await c.query(
    `INSERT INTO deal_parties (organization_id, deal_id, contact_id, role)
     VALUES ($1, $2, $3, 'buyer')`,
    [args.organizationId, args.dealId, contactId],
  );

  /**
   * The first deal is what makes somebody a customer.
   *
   * COALESCE rather than a plain assignment: this runs on every deal, and a
   * repeat buyer's "customer since" is the date of their FIRST purchase. Writing
   * it unconditionally would quietly reset a ten-year relationship to today on
   * every subsequent sale — a wrong answer that looks perfectly reasonable on
   * the screen.
   */
  await c.query(
    `UPDATE contacts SET customer_since = COALESCE(customer_since, now())
      WHERE id = $1 AND organization_id = $2`,
    [contactId, args.organizationId],
  );

  /**
   * The enquiry now knows who made it.
   *
   * Also COALESCE: if this lead was already tied to somebody, a second deal must
   * not silently re-point it. That would be a merge performed by accident, by a
   * route whose job is creating a deal.
   */
  if (args.leadId) {
    await c.query(
      `UPDATE leads SET contact_id = COALESCE(contact_id, $1)
        WHERE id = $2 AND organization_id = $3`,
      [contactId, args.leadId, args.organizationId],
    );
  }

  return contactId;
}

async function requireContactInOrg(c: PoolClient, contactId: string): Promise<string> {
  // RLS already confines this to the tenant; the check is for the 422, so a bad
  // id comes back as a named refusal rather than a foreign-key error.
  const r = await c.query<{ id: string }>(
    `SELECT id FROM contacts WHERE id = $1 AND deleted_at IS NULL`,
    [contactId],
  );
  if (r.rows.length === 0) {
    throw new AppError(422, 'unknown_contact', 'That customer does not exist here.', [
      { path: 'contact_id', code: 'unknown_contact', message: 'No such customer in this organisation' },
    ]);
  }
  return r.rows[0]!.id;
}

async function contactFromLead(
  c: PoolClient,
  args: { organizationId: string; storeId: string; leadId?: string | null },
): Promise<string | null> {
  if (!args.leadId) return null;

  const lead = await c.query<LeadSeed>(
    `SELECT phone, first_name, last_name, email, preferred_language
       FROM leads WHERE id = $1 AND deleted_at IS NULL`,
    [args.leadId],
  );
  if (lead.rows.length === 0) return null;
  const seed = lead.rows[0]!;

  const existing = await c.query<{ id: string }>(
    `SELECT id FROM contacts
      WHERE organization_id = $1 AND phone = $2 AND deleted_at IS NULL
      ORDER BY created_at ASC LIMIT 1`,
    [args.organizationId, seed.phone],
  );
  if (existing.rows.length > 0) return existing.rows[0]!.id;

  const created = await c.query<{ id: string }>(
    `INSERT INTO contacts
       (organization_id, store_id, first_name, last_name, email, phone,
        preferred_language, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'deal')
     RETURNING id`,
    [
      args.organizationId, args.storeId,
      seed.first_name, seed.last_name, seed.email, seed.phone,
      seed.preferred_language,
    ],
  );
  return created.rows[0]!.id;
}

/**
 * Add a cosigner, or replace the buyer.
 *
 * Replacing the buyer deletes the old party rather than updating it, so the
 * one-buyer index and the sync trigger both see an ordinary pair of events
 * instead of a special case.
 */
export async function setParty(
  c: PoolClient,
  args: {
    organizationId: string;
    dealId: string;
    contactId: string;
    role: 'buyer' | 'cosigner';
  },
): Promise<void> {
  await requireContactInOrg(c, args.contactId);

  if (args.role === 'buyer') {
    await c.query(
      `DELETE FROM deal_parties WHERE deal_id = $1 AND role = 'buyer'`,
      [args.dealId],
    );
  }
  await c.query(
    `INSERT INTO deal_parties (organization_id, deal_id, contact_id, role)
     VALUES ($1, $2, $3, $4)`,
    [args.organizationId, args.dealId, args.contactId, args.role],
  );
}

export interface MergeResult {
  keep_id: string;
  merged_id: string;
  moved: { deals: number; parties: number; leads: number; activity: number };
  customer_since: string | null;
}

/**
 * Fold one contact into another (FR-CON-003).
 *
 * Everything that pointed at the loser now points at the keeper, and the loser
 * is soft-deleted rather than removed: a merge is a judgement call made by a
 * salesperson under time pressure, and the row is the only evidence of what was
 * folded in. Deleting it would make a mistaken merge unexaminable as well as
 * unreversible.
 *
 * `customer_since` keeps the OLDER of the two, because the question it answers
 * is "how long have we known this family" — and the whole reason the records
 * were duplicated is that somebody was here before the system noticed.
 */
export async function mergeContacts(
  c: PoolClient,
  args: { organizationId: string; keepId: string; mergeId: string },
): Promise<MergeResult> {
  if (args.keepId === args.mergeId) {
    throw new AppError(422, 'same_contact', 'A customer cannot be merged into themselves.', [
      { path: 'merge_id', code: 'same_contact', message: 'keep_id and merge_id are the same record' },
    ]);
  }

  const both = await c.query<{ id: string; customer_since: string | null }>(
    `SELECT id, customer_since FROM contacts
      WHERE id = ANY($1::uuid[]) AND organization_id = $2 AND deleted_at IS NULL
      FOR UPDATE`,
    [[args.keepId, args.mergeId], args.organizationId],
  );
  if (both.rows.length !== 2) {
    throw new AppError(422, 'unknown_contact', 'Both customers must exist here.', [
      { path: 'merge_id', code: 'unknown_contact', message: 'One or both customers are missing or already deleted' },
    ]);
  }

  /**
   * Deals the loser is a party to and the keeper already is too.
   *
   * These have to go before the re-point, or the UPDATE below violates
   * UNIQUE (deal_id, contact_id) — one person cannot be two parties to one
   * contract, which is exactly what a merge of two parties on the same deal
   * would produce. The keeper's row is the one that survives, so the loser's is
   * simply dropped.
   */
  await c.query(
    `DELETE FROM deal_parties losing
      WHERE losing.contact_id = $1
        AND EXISTS (
          SELECT 1 FROM deal_parties keeping
           WHERE keeping.deal_id = losing.deal_id
             AND keeping.contact_id = $2
        )`,
    [args.mergeId, args.keepId],
  );

  const parties = await c.query(
    `UPDATE deal_parties SET contact_id = $2 WHERE contact_id = $1`,
    [args.mergeId, args.keepId],
  );

  // deals.contact_id is trigger-maintained, so re-pointing the parties above
  // has already moved the denormalised copy for every deal that had a buyer
  // party. This catches deals whose contact_id was set before parties existed.
  const deals = await c.query(
    `UPDATE deals SET contact_id = $2 WHERE contact_id = $1`,
    [args.mergeId, args.keepId],
  );

  const leads = await c.query(
    `UPDATE leads SET contact_id = $2 WHERE contact_id = $1`,
    [args.mergeId, args.keepId],
  );

  /**
   * The history does NOT move, and that is deliberate.
   *
   * `activity_events` grants the app role INSERT and SELECT only. Re-pointing
   * `entity_id` would mean anybody permitted to merge customers could also
   * silently re-attribute past events to a different person — exactly the
   * capability an audit trail exists to deny. So the retired record keeps its
   * own events, `merged_into_contact_id` (0042) records where it went, and the
   * survivor's timeline reads both. Same result on screen, opposite guarantee
   * underneath.
   *
   * Counted, not moved: the number tells the caller how much history just
   * became reachable from the keeper.
   */
  const activity = await c.query(
    `SELECT 1 FROM activity_events WHERE entity_type = 'contact' AND entity_id = $1`,
    [args.mergeId],
  );

  const merged = await c.query<{ customer_since: string | null }>(
    `UPDATE contacts keeper
        SET customer_since = LEAST(
              keeper.customer_since,
              (SELECT loser.customer_since FROM contacts loser WHERE loser.id = $2)
            )
      WHERE keeper.id = $1
      RETURNING customer_since`,
    [args.keepId, args.mergeId],
  );

  // Retired and forwarded in one statement: the CHECK added in 0042 refuses a
  // forwarding address on a live record, so these two facts cannot be written
  // apart from each other.
  await c.query(
    `UPDATE contacts SET deleted_at = now(), merged_into_contact_id = $2 WHERE id = $1`,
    [args.mergeId, args.keepId],
  );

  return {
    keep_id: args.keepId,
    merged_id: args.mergeId,
    moved: {
      deals: deals.rowCount ?? 0,
      parties: parties.rowCount ?? 0,
      leads: leads.rowCount ?? 0,
      // Reachable from the keeper now, not rewritten. See above.
      activity: activity.rowCount ?? 0,
    },
    customer_since: merged.rows[0]?.customer_since ?? null,
  };
}
