-- 0010 inventory (F-07): the vehicles a store actually owns, and the link from
-- a deal to the car being sold. Vocabularies are EXACT per inventory.md §4.
--
-- SCOPE: identity, acquisition, pricing and the two independent status tracks
-- (where the car IS vs whether it is SPOKEN FOR). The spec's safety/recon/photo
-- subsystems are deliberately NOT here — they belong to the garage/PDI module
-- and carry their own workflows; adding empty columns now would invite code
-- that pretends those workflows exist.
--
-- Money is INTEGER CENTS (ADR-009). Conventions per 0001/0004: soft delete,
-- updated_at trigger, RLS ENABLED+FORCED on app.org_id, member SELECT via
-- app.user_id, same-org composite FK to stores.

CREATE TABLE vehicles (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL,
  store_id              uuid NOT NULL,

  -- identity
  stock_number          text NOT NULL CHECK (btrim(stock_number) <> '' AND length(stock_number) <= 30),
  -- 17 chars, and never I/O/Q (they are excluded from the VIN alphabet).
  vin                   text CHECK (vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  year                  integer NOT NULL CHECK (year BETWEEN 1900 AND 2100),
  make                  text NOT NULL CHECK (btrim(make) <> '' AND length(make) <= 60),
  model                 text NOT NULL CHECK (btrim(model) <> '' AND length(model) <= 60),
  trim                  text CHECK (length(trim) <= 60),
  exterior_color        text CHECK (length(exterior_color) <= 40),
  mileage_km            integer CHECK (mileage_km >= 0),
  vehicle_type          text NOT NULL DEFAULT 'used' CHECK (vehicle_type IN ('new','used')),

  -- acquisition + cost build-up
  acquisition_type      text NOT NULL
                        CHECK (acquisition_type IN ('auction','dealer_trade','trade_in','internal_wholesale','consignment')),
  acquisition_date      date NOT NULL DEFAULT CURRENT_DATE,
  acquisition_cost_cents integer NOT NULL DEFAULT 0 CHECK (acquisition_cost_cents >= 0),
  transport_cost_cents  integer NOT NULL DEFAULT 0 CHECK (transport_cost_cents >= 0),
  recon_cost_cents      integer NOT NULL DEFAULT 0 CHECK (recon_cost_cents >= 0),
  list_price_cents      integer CHECK (list_price_cents >= 0),

  -- two independent tracks (inventory.md §4): where it IS, and whether it is SPOKEN FOR
  location_status       text NOT NULL DEFAULT 'on_lot'
                        CHECK (location_status IN ('at_source','in_transit','on_lot','at_garage','delivered','wholesale')),
  deal_status           text NOT NULL DEFAULT 'available'
                        CHECK (deal_status IN ('available','reserved','sold_pending','delivered','wholesale')),
  location_details      text CHECK (length(location_details) <= 200),

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,

  -- Stock numbers identify a car on the lot; they must not repeat per store.
  UNIQUE (organization_id, store_id, stock_number),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, store_id) REFERENCES stores (organization_id, id)
);

CREATE INDEX idx_vehicles_org_deal_status ON vehicles (organization_id, deal_status) WHERE deleted_at IS NULL;
CREATE INDEX idx_vehicles_org_keyset ON vehicles (organization_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_vehicles_org_vin ON vehicles (organization_id, vin) WHERE vin IS NOT NULL AND deleted_at IS NULL;

CREATE TRIGGER vehicles_updated_at BEFORE UPDATE ON vehicles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE ON vehicles TO dealpilot_app;

ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles FORCE ROW LEVEL SECURITY;

CREATE POLICY vehicle_isolation ON vehicles
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

CREATE POLICY vehicle_member_read ON vehicles FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = vehicles.organization_id
      AND m.status = 'active'
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  ));

-- The car being sold on a deal. Composite FK keeps it inside the same tenant.
ALTER TABLE deals
  ADD COLUMN vehicle_id uuid,
  ADD FOREIGN KEY (organization_id, vehicle_id) REFERENCES vehicles (organization_id, id);

CREATE INDEX idx_deals_vehicle ON deals (vehicle_id) WHERE deleted_at IS NULL;
