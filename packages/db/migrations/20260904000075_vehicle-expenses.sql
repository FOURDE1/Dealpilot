-- 0075 — the vehicle expenses ledger (F-82; expenses-accounting.md §1–§5, §7,
-- §8; FR-ACC-002/003/004 P1 + FR-ACC-001's category half; D-084).
--
-- THE MONEY FENCE. A record and a report input, NEVER a desk input: nothing
-- in this file or in apps/api/src/f82-expense-routes.ts writes a vehicle cost
-- column (acquisition_cost_cents / transport_cost_cents / recon_cost_cents),
-- the deal's vehicle_cost_cents or fees_cents, any engine output, the funding
-- track or a commission. The derived vehicle total stays the three columns
-- summed at read in f07-vehicles-routes.ts; the car page ADDS this ledger's
-- approved sum beside it, captioned, and the worksheet copies the total —
-- never that figure. Pinned statically by apps/api/src/f82-money-fence.test.ts
-- (comments stripped, so this header may name the columns it fences) and
-- behaviourally by f82-expenses.test.ts T-F1/T-F2/T-F3.
--
-- THE LADDER is route-enforced (the CHECK below is the vocabulary only):
-- pending → approved | rejected | void; approved → paid | void; paid → void;
-- rejected and void are terminal. Every transition runs under the new
-- expense:approve verb (backfilled below); logging, editing while pending and
-- attaching a receipt run under vehicle:update. Amounts are immutable after
-- INSERT (D-084): a wrong amount is voided and logged again, so the approver
-- always approves the number that was logged and the activity trail carries
-- no money by construction.
--
-- Cut BY NAME (D-084 records each un-cut condition): deal_id / stock_number +
-- trigger (a deal's expenses are its vehicle's — deals.vehicle_id, 0010),
-- suppliers / supplier_id (free-text vendor_name — un-cut: FR-ACC-001's
-- registry slice), the purchase / transport codes (the vehicle columns own
-- those numbers — never), commission_sales / commission_fi (F-09 is the
-- ledger of pay), pack (a report line of FR-REP-004's per-unit P&L), is_cogs
-- (the P&L consumer), rejection_reason (un-cut: the owner asks why a line was
-- refused), created_by / approved_by / approved_at / paid_at / payment_method
-- / uploaded_by / receipt_uploaded_at (the created/updated events own
-- actorship and time — 0074's submitted_by precedent), notes, a status index
-- (no measured need), a DELETE grant/route (void is an UPDATE), any
-- notification (spec names no recipient).

CREATE TABLE vehicle_expenses (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES organizations(id),
  -- Copied from the vehicle at insert, inside the tenant transaction: the
  -- cost view (vehicle:read_costs, store-scoped by membership) keys on it.
  store_id               uuid NOT NULL,
  vehicle_id             uuid NOT NULL,

  category               text NOT NULL CHECK (category IN (
                           'safety_pdi','recon_mech','recon_body','detail','parts','sublet','keys',
                           'advertising','floorplan','warranty_cost','admin','other')),
  vendor_name            text NOT NULL CHECK (btrim(vendor_name) <> '' AND length(vendor_name) <= 120),
  amount_cents           integer NOT NULL CHECK (amount_cents >= 0),
  tax_cents              integer NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents            integer GENERATED ALWAYS AS (amount_cents + tax_cents) STORED,
  invoice_number         text CHECK (invoice_number IS NULL OR (btrim(invoice_number) <> '' AND length(invoice_number) <= 60)),
  -- A calendar day the form always sends. No CURRENT_DATE default (F-78's
  -- clock law: no server clock decides a business day).
  expense_date           date NOT NULL,
  description            text CHECK (description IS NULL OR length(description) <= 500),
  status                 text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','approved','paid','rejected','void')),

  -- 0026's shape under a receipt_ prefix: a receipt has all of its metadata
  -- or none of it. The key is server-built and content-addressed
  -- (apps/api/src/storage.ts receiptKey) and never travels on the wire.
  receipt_storage_key    text,
  receipt_content_sha256 text CHECK (receipt_content_sha256 IS NULL OR receipt_content_sha256 ~ '^[0-9a-f]{64}$'),
  receipt_content_type   text CHECK (receipt_content_type IS NULL OR receipt_content_type IN ('application/pdf','image/jpeg','image/png')),
  receipt_size_bytes     integer CHECK (receipt_size_bytes IS NULL OR receipt_size_bytes > 0),
  CONSTRAINT vehicle_expenses_receipt_complete CHECK (
    (receipt_storage_key IS NULL AND receipt_content_sha256 IS NULL
       AND receipt_content_type IS NULL AND receipt_size_bytes IS NULL)
    OR
    (receipt_storage_key IS NOT NULL AND receipt_content_sha256 IS NOT NULL
       AND receipt_content_type IS NOT NULL AND receipt_size_bytes IS NOT NULL)),

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  -- The F-80/F-81 law: composite FKs, so a cross-tenant vehicle/store id is
  -- refused by the schema itself behind the route checks (FK checks bypass
  -- RLS; the bare form would accept a rival's id). Targets: vehicles
  -- (0010 UNIQUE (organization_id, id)), stores (0001). No ON DELETE action:
  -- vehicles soft-delete and the app role holds no DELETE on either target.
  FOREIGN KEY (organization_id, vehicle_id) REFERENCES vehicles (organization_id, id),
  FOREIGN KEY (organization_id, store_id)   REFERENCES stores   (organization_id, id)
);

-- The list's order and the sums: one car's ledger, newest day first.
CREATE INDEX idx_vehicle_expenses_vehicle
  ON vehicle_expenses (vehicle_id, expense_date DESC, created_at DESC, id);

CREATE TRIGGER vehicle_expenses_updated_at BEFORE UPDATE ON vehicle_expenses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Ledger grants (0074's shape): log INSERTs; the ladder, field edits and
-- receipts UPDATE; no DELETE anywhere — void is an UPDATE and every row is
-- audit evidence. The exact grant shape is pinned by
-- packages/db/src/migration-0075-expenses.test.ts (P6b).
-- The mechanism behind « Immutable after insert »: the app role may UPDATE
-- only the six patchable columns (f82-expense-routes.ts PATCHABLE) and the
-- four receipt columns — never the amounts, the keys or the stamps. Proven
-- as dealpilot_app by migration-0075-expenses.test.ts P11 (42501).
GRANT SELECT, INSERT ON vehicle_expenses TO dealpilot_app;
GRANT UPDATE (status, category, vendor_name, invoice_number, expense_date, description,
              receipt_storage_key, receipt_content_sha256, receipt_content_type, receipt_size_bytes)
  ON vehicle_expenses TO dealpilot_app;

ALTER TABLE vehicle_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_expenses FORCE  ROW LEVEL SECURITY;

-- One org-keyed policy, 0073/0074's exact shape. NO bare user-keyed policy
-- and no member_read policy: routes resolve the org first (vehicleOrg for the
-- vehicle-addressed list/create; the expenseOrg walk (f80's lenderOrg shape) for id-addressed
-- writes and the receipt) and run under withTenant — the isolation policy is
-- the only door.
CREATE POLICY vehicle_expenses_isolation ON vehicle_expenses
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

COMMENT ON TABLE vehicle_expenses IS
  'Per-vehicle expense ledger (expenses-accounting.md §2): logged under vehicle:update, approved/rejected/paid/voided under expense:approve, receipts on the document storage driver. A record and a report input only: it never feeds the derived vehicle total, the desk or pay. No DELETE — void is an UPDATE.';
COMMENT ON COLUMN vehicle_expenses.total_cents IS
  'GENERATED amount_cents + tax_cents. Summed into the vehicle page''s « Dépenses ajoutées » for approved + paid rows only; never written into any vehicle or deal column.';
COMMENT ON COLUMN vehicle_expenses.amount_cents IS
  'Immutable after insert (D-084): a wrong amount is voided and logged again, so the approver always approves the number that was logged and the activity trail carries no money. Enforced by the column-level UPDATE grant: dealpilot_app cannot SET this column (P11).';

-- The activity vocabulary learns the entity (0072/0074 precedent: DROP +
-- re-ADD, the LIVE lists from 0074:149-165 verbatim + 'vehicle_expense'; no
-- new verb — log is 'created', every later change 'updated'; parent =
-- vehicle).
ALTER TABLE activity_events DROP CONSTRAINT activity_events_entity_type_check;
ALTER TABLE activity_events ADD CONSTRAINT activity_events_entity_type_check
  CHECK (entity_type IN ('deal','lead','vehicle','membership','pay_plan',
                         'checklist_item','checklist_template','intake_key',
                         'invitation','dispatch_assignment','deal_document',
                         'deal_fi_product','tenant_branding','consent','suppression',
                         'internal_dnc','conversation','appointment','contact',
                         'organization','store','task','impersonation_session',
                         'commission_clawback','deal_submission','vehicle_expense'));
ALTER TABLE activity_events DROP CONSTRAINT activity_events_parent_entity_type_check;
ALTER TABLE activity_events ADD CONSTRAINT activity_events_parent_entity_type_check
  CHECK (parent_entity_type IS NULL OR parent_entity_type IN
         ('deal','lead','vehicle','membership','pay_plan',
          'checklist_item','checklist_template','intake_key',
          'invitation','dispatch_assignment','deal_document',
          'deal_fi_product','tenant_branding','consent','suppression',
          'internal_dnc','conversation','appointment','contact',
          'organization','store','task','impersonation_session',
          'commission_clawback','deal_submission','vehicle_expense'));

-- expense:approve joins the catalogue for EXISTING orgs (0057/0072/0073
-- shape). New orgs get it from DEFAULT_ROLE_PERMISSIONS at both births (f01
-- seedPermissions and the provisioning definer, which reads p_seeds built
-- from the same constant — apps/api/src/org-seeds.ts). Defaults per D-084:
-- owner, gm, used_car_manager — rows written for all three so the backfill
-- equals the TS default. Spelled for migration-0075-backfill.test.ts'
-- extraction regex (0073's).
INSERT INTO role_permissions (organization_id, role, permission)
SELECT o.id, d.role, d.permission
FROM organizations o
CROSS JOIN (VALUES
  ('owner',            'expense:approve'),
  ('gm',               'expense:approve'),
  ('used_car_manager', 'expense:approve')
) AS d(role, permission)
ON CONFLICT DO NOTHING;
