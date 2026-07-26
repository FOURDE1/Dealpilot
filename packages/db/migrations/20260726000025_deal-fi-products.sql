-- 0025 — per-product F&I, so three document types stop being unreachable.
--
-- documents.md §3 says a deal carries one agreement per F&I product: a warranty
-- agreement, a GAP agreement, one aftermarket agreement per aftermarket item.
-- `requiredDocuments()` implements that and has golden tests for it. But the
-- only F&I the system stored was ONE aggregate pair on the deal —
-- `fi_price_cents` / `fi_cost_cents` — with no product names, so the generator
-- had nothing to name an agreement after and passed no products at all.
--
-- The result: `warranty_agreement`, `gap_agreement` and `aftermarket_agreement`
-- were in the type CHECK, in the catalogue, and in the tests, and could not be
-- produced by any real deal. Three of thirteen document types were dead
-- vocabulary — the same shape as `sold_as_is` (CR-12), where a field existed
-- everywhere except on the path that would have made it matter.
--
-- Products are the detail; the deal's aggregate stays as their maintained sum,
-- so desking, commissions and every report keep reading the column they already
-- read. A deal with no product rows is untouched and behaves exactly as before,
-- which is why there is no backfill: inventing a product named "F&I" for every
-- historical deal would put a fabricated agreement in a real customer's file.

CREATE TABLE deal_fi_products (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  store_id         uuid NOT NULL,
  deal_id          uuid NOT NULL,

  kind             text NOT NULL CHECK (kind IN ('warranty','gap','aftermarket')),
  -- The clerk has to tell two aftermarket agreements apart in a folder, so the
  -- name is the document's name and may not be blank.
  name             text NOT NULL CHECK (btrim(name) <> ''),
  provider         text,

  price_cents      integer NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  cost_cents       integer NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
  term_months      integer CHECK (term_months IS NULL OR term_months > 0),

  sort_order       integer NOT NULL DEFAULT 0,

  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (organization_id, deal_id) REFERENCES deals (organization_id, id),
  FOREIGN KEY (organization_id, store_id) REFERENCES stores (organization_id, id)
);

-- Mirrors idx_deal_documents_one_per_type exactly, and must: a second warranty
-- product would generate a second `warranty_agreement`, the document's unique
-- index would swallow it via ON CONFLICT DO NOTHING, and the deal would carry a
-- product with no agreement in the file. Aftermarket is the deliberate
-- exception on both sides.
CREATE UNIQUE INDEX idx_deal_fi_products_one_per_kind
  ON deal_fi_products (deal_id, kind)
  WHERE deleted_at IS NULL AND kind <> 'aftermarket';

CREATE INDEX idx_deal_fi_products_deal ON deal_fi_products (deal_id, sort_order)
  WHERE deleted_at IS NULL;

CREATE TRIGGER deal_fi_products_updated_at BEFORE UPDATE ON deal_fi_products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

/**
 * Keep deals.fi_price_cents / fi_cost_cents equal to the sum of the deal's live
 * products.
 *
 * In a trigger rather than the route because these two columns are money that
 * desking, commissionable gross and every F&I report read. A route that forgot
 * to re-sum would not fail — it would quietly pay someone the wrong commission,
 * which is the failure mode this project keeps finding after the fact.
 *
 * Adding the first product to a deal that had a hand-entered aggregate REPLACES
 * that aggregate. The itemised list is the better record, and the route records
 * an activity event when the total moves so the change is never silent.
 */
CREATE FUNCTION sync_deal_fi_totals()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_deal uuid := COALESCE(NEW.deal_id, OLD.deal_id);
BEGIN
  UPDATE deals d
  SET fi_price_cents = t.price, fi_cost_cents = t.cost
  FROM (
    SELECT COALESCE(sum(price_cents), 0)::integer AS price,
           COALESCE(sum(cost_cents), 0)::integer  AS cost
    FROM deal_fi_products
    WHERE deal_id = v_deal AND deleted_at IS NULL
  ) t
  WHERE d.id = v_deal
    AND (d.fi_price_cents, d.fi_cost_cents) IS DISTINCT FROM (t.price, t.cost);
  RETURN NULL;
END;
$$;

CREATE TRIGGER deal_fi_products_sync
  AFTER INSERT OR UPDATE OR DELETE ON deal_fi_products
  FOR EACH ROW EXECUTE FUNCTION sync_deal_fi_totals();

-- Documents are regenerated on every read, and `aftermarket_agreement` is
-- deliberately excluded from idx_deal_documents_one_per_type — so with nothing
-- else to conflict on, ON CONFLICT DO NOTHING would insert a fresh copy of every
-- aftermarket agreement on every load. Its identity is its NAME (that is the
-- whole point of naming them), so that is what must be unique.
CREATE UNIQUE INDEX idx_deal_documents_one_per_named_type
  ON deal_documents (deal_id, document_type, document_name)
  WHERE deleted_at IS NULL;

GRANT SELECT, INSERT, UPDATE ON deal_fi_products TO dealpilot_app;

ALTER TABLE deal_fi_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_fi_products FORCE ROW LEVEL SECURITY;

CREATE POLICY deal_fi_product_isolation ON deal_fi_products
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- The activity vocabulary gains this entity (forward-only; 0023 last set it).
ALTER TABLE activity_events DROP CONSTRAINT activity_events_entity_type_check;
ALTER TABLE activity_events ADD CONSTRAINT activity_events_entity_type_check
  CHECK (entity_type IN ('deal','lead','vehicle','membership','pay_plan',
                         'checklist_item','checklist_template','intake_key',
                         'invitation','dispatch_assignment','deal_document',
                         'deal_fi_product','organization','store'));

-- NO per-product `taxable` column, deliberately. Desking taxes F&I from the
-- deal's single aggregate, so a product marked non-taxable would be taxed
-- anyway — a money error the API would report as success. Credit life and
-- disability insurance are genuinely exempt, so this is a real gap, but closing
-- it means the tax base stops being derivable from the deal's own columns.
-- Filed as D-037 for the owner: does the group sell insurance-type F&I products?
COMMENT ON TABLE deal_fi_products IS
  'Itemised F&I. deals.fi_price_cents/fi_cost_cents are the maintained sum of these rows (trigger deal_fi_products_sync); a deal with no rows keeps its own aggregate.';

ALTER TABLE activity_events DROP CONSTRAINT activity_events_parent_entity_type_check;
ALTER TABLE activity_events ADD CONSTRAINT activity_events_parent_entity_type_check
  CHECK (parent_entity_type IS NULL OR parent_entity_type IN
         ('deal','lead','vehicle','membership','pay_plan',
          'checklist_item','checklist_template','intake_key',
          'invitation','dispatch_assignment','deal_document',
          'deal_fi_product','organization','store'));
