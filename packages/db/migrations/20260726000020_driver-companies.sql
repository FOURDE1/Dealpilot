-- 0020 driver companies + the dispatch request (F-11b, dispatch-transport.md §9).
--
-- Replaces the hardcoded `('supreme','denises_guys')` enum with a roster the
-- store manages, and gives a dispatch run the fields a driver actually needs
-- before they can be sent anywhere: where to collect, where to deliver, what
-- money to bring back, and anything unusual about the job.

CREATE TABLE driver_companies (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  -- NULL means every store in the group may use them (spec §9).
  store_id         uuid,
  name             text NOT NULL CHECK (btrim(name) <> ''),
  -- Dispatch requests go here, so it is the one field that cannot be blank.
  email            text NOT NULL CHECK (btrim(email) <> '' AND email = lower(email)),
  phone            text,
  contact_name     text,
  service_area     text,
  rate_info        text,
  active           boolean NOT NULL DEFAULT true,
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, store_id) REFERENCES stores (organization_id, id)
);

CREATE INDEX idx_driver_companies_org ON driver_companies (organization_id) WHERE deleted_at IS NULL AND active;

CREATE TRIGGER driver_companies_updated_at BEFORE UPDATE ON driver_companies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE dispatch_assignments
  ADD COLUMN driver_company_id uuid,
  -- A run is not always a delivery: sourced units get picked up, and stores
  -- move cars between each other.
  ADD COLUMN dispatch_type text NOT NULL DEFAULT 'delivery'
    CHECK (dispatch_type IN ('delivery','pickup','transfer')),
  ADD COLUMN pickup_address text,
  ADD COLUMN delivery_address text,
  -- INTEGER CENTS (ADR-009). The legacy field was a float, and this is money a
  -- driver physically carries.
  ADD COLUMN cash_to_collect_cents integer NOT NULL DEFAULT 0 CHECK (cash_to_collect_cents >= 0),
  ADD COLUMN special_instructions text,
  ADD COLUMN email_sent_at timestamptz,
  ADD CONSTRAINT dispatch_driver_company_fk
    FOREIGN KEY (organization_id, driver_company_id) REFERENCES driver_companies (organization_id, id);

GRANT SELECT, INSERT, UPDATE ON driver_companies TO dealpilot_app;

ALTER TABLE driver_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_companies FORCE ROW LEVEL SECURITY;

CREATE POLICY driver_company_isolation ON driver_companies
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- NOTE on the wet-ink booking gate (§9): the spec reaches for a
-- `deals.wet_ink_file_status` column. It does not need one — F-08 already
-- models exactly this as the `wet_ink_file` item on the deal's delivery
-- checklist, complete with who signed it off and when, and with the waiver path
-- for the cases a manager judges acceptable. Dispatch reads that rather than a
-- second, parallel truth about the same paperwork.
