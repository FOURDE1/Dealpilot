-- 0039 — who the deal is actually with (FR-CON-005).
--
-- A deal has had a lead and a vehicle but never a person. The buyer's name lived
-- on the lead, which is an enquiry, not a customer — so a repeat buyer was two
-- unrelated deals and "how many cars has this family bought from us?" had no
-- answer. Cosigners had nowhere to exist at all, which for a finance office is
-- not a missing nicety: the cosigner is a party to the contract.
--
-- `deal_parties` is authoritative. `deals.contact_id` is a denormalised copy of
-- the buyer, kept because the deal list renders a customer name on every row and
-- would otherwise join for it.
--
-- A denormalised column that can disagree with its source is exactly the drift
-- this codebase keeps paying for, so it is not maintained by the application.
-- The trigger below is the ONLY writer. Callers insert a party; the copy
-- follows. There is no code path where a caller sets one and forgets the other,
-- because setting it is not something a caller can do.

-- Tenant-safe foreign keys need this: without it, `deal_parties` could only
-- reference deals by bare id, and a row could point at another organisation's
-- deal. `id` is already the primary key, so this constrains nothing new — it
-- only makes the composite reference expressible.
ALTER TABLE deals ADD CONSTRAINT deals_org_id_unique UNIQUE (organization_id, id);

ALTER TABLE deals ADD COLUMN contact_id uuid;
ALTER TABLE deals ADD CONSTRAINT deals_contact_fk
  FOREIGN KEY (organization_id, contact_id) REFERENCES contacts (organization_id, id);

COMMENT ON COLUMN deals.contact_id IS
  'Denormalised primary buyer, maintained ONLY by sync_deal_primary_buyer(). Write deal_parties instead; deal-party-drift.test.ts fails the build if application code writes this column directly.';

CREATE TABLE deal_parties (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  deal_id         uuid NOT NULL,
  contact_id      uuid NOT NULL,

  /**
   * buyer or cosigner.
   *
   * Not a free-text "relationship": these two have different legal weight, and
   * a vocabulary that grows by typing is how `timezone_source` ended up
   * permitting a value nothing emitted and refusing the one everything did.
   */
  role            text NOT NULL CHECK (role IN ('buyer','cosigner')),

  created_at      timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (organization_id, deal_id) REFERENCES deals (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, contact_id) REFERENCES contacts (organization_id, id),

  -- One person cannot be two parties to the same contract.
  UNIQUE (deal_id, contact_id)
);

/**
 * At most one buyer per deal.
 *
 * Enforced by the database rather than by the route, because the denormalised
 * `deals.contact_id` has room for exactly one answer. Two buyer rows would make
 * "the primary buyer" a question with two correct answers and a copy that picks
 * whichever the planner returned first.
 */
CREATE UNIQUE INDEX idx_deal_parties_one_buyer ON deal_parties (deal_id) WHERE role = 'buyer';

-- "Every deal this customer is on", which is the contact detail screen's
-- associated-deals column and the merge's move list.
CREATE INDEX idx_deal_parties_contact ON deal_parties (organization_id, contact_id);

/**
 * Keeps `deals.contact_id` equal to the buyer party, always.
 *
 * INVOKER rights on purpose. A SECURITY DEFINER trigger would run with the
 * table owner's privileges and bypass row-level security, so a caller who
 * somehow reached another tenant's deal_parties row would get a cross-tenant
 * write executed on their behalf. Running as the invoker means the UPDATE is
 * subject to deal_isolation like every other write.
 *
 * Recomputed from the table rather than copied from NEW, so DELETE and role
 * changes are handled by the same three lines that handle INSERT: the answer is
 * always "whatever the buyer row says now", including when there isn't one.
 */
CREATE FUNCTION sync_deal_primary_buyer() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target uuid := COALESCE(NEW.deal_id, OLD.deal_id);
BEGIN
  UPDATE deals d
     SET contact_id = (
           SELECT p.contact_id
             FROM deal_parties p
            WHERE p.deal_id = target
              AND p.role = 'buyer'
            LIMIT 1
         )
   WHERE d.id = target;
  RETURN NULL;
END;
$$;

CREATE TRIGGER deal_parties_sync_buyer
  AFTER INSERT OR UPDATE OR DELETE ON deal_parties
  FOR EACH ROW EXECUTE FUNCTION sync_deal_primary_buyer();

GRANT SELECT, INSERT, UPDATE, DELETE ON deal_parties TO dealpilot_app;

ALTER TABLE deal_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_parties FORCE  ROW LEVEL SECURITY;

CREATE POLICY deal_parties_isolation ON deal_parties
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

COMMENT ON TABLE deal_parties IS
  'Authoritative buyer/cosigner link between a deal and the customer master (FR-CON-005). deals.contact_id is a derived copy of the buyer.';
