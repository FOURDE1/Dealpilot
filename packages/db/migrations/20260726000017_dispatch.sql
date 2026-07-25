-- 0017 dispatch / transport (F-11, dispatch-transport.md).
--
-- When a deal is delivered the store sends driver(s) with the car, a dealer
-- plate (the unit is not registered yet) and — when there is no trade-in to
-- drive back — a chaser vehicle to bring the drivers home.
--
-- Three deliberate departures from the legacy behaviour, all of them the
-- "Target" the spec itself asks for:
--
--  1. ONE status vocabulary (ADR-009). Legacy carried `status` AND
--     `dispatch_status` in parallel and they drifted. Here:
--     pending → assigned → departed → arrived → completed | cancelled.
--  2. Resources are TENANT- AND STORE-SCOPED (ADR-007). Legacy pools were
--     global, which in a multi-store group hands one store's plate to another.
--  3. Conflict detection compares BOOKED DELIVERY TIMES, not booking
--     timestamps — see the note on the index below.

-- When the customer is actually expecting the car. Distinct from delivered_at
-- (which is what happened) and from the checklist's delivery_date item (which
-- is only "has someone confirmed a date").
ALTER TABLE deals ADD COLUMN booked_delivery_at timestamptz;
CREATE INDEX idx_deals_booked_delivery ON deals (organization_id, booked_delivery_at)
  WHERE deleted_at IS NULL AND booked_delivery_at IS NOT NULL;

CREATE TABLE chaser_vehicles (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  store_id         uuid NOT NULL,
  name             text NOT NULL CHECK (btrim(name) <> ''),
  status           text NOT NULL DEFAULT 'available' CHECK (status IN ('available','in_use')),
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, store_id) REFERENCES stores (organization_id, id)
);

CREATE TABLE dealer_plates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL,
  store_id           uuid NOT NULL,
  plate_number       text NOT NULL CHECK (btrim(plate_number) <> ''),
  status             text NOT NULL DEFAULT 'available' CHECK (status IN ('available','in_use')),
  -- A plate can be paired to the chaser carrying it.
  assigned_chaser_id uuid,
  deleted_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, store_id) REFERENCES stores (organization_id, id),
  FOREIGN KEY (organization_id, assigned_chaser_id) REFERENCES chaser_vehicles (organization_id, id)
);

-- A plate number is unique per ORGANIZATION, not globally: two dealer groups
-- can legitimately hold plates issued in different provinces.
CREATE UNIQUE INDEX idx_plates_number_per_org ON dealer_plates (organization_id, upper(plate_number))
  WHERE deleted_at IS NULL;

CREATE TABLE dispatch_assignments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL,
  store_id           uuid NOT NULL,
  deal_id            uuid NOT NULL,

  chaser_vehicle_id  uuid,
  dealer_plate_id    uuid,

  -- Snapshot of the rule's inputs, so an assignment can be explained later even
  -- if the deal's trade-in is edited afterwards.
  has_trade_in       boolean NOT NULL,
  num_drivers_needed integer NOT NULL CHECK (num_drivers_needed BETWEEN 1 AND 4),

  dispatch_company   text CHECK (dispatch_company IN ('supreme','denises_guys')),

  -- ONE lifecycle (ADR-009). Legacy's parallel `dispatch_status` is not carried
  -- forward; legacy `in_transit` maps to `departed`.
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','assigned','departed','arrived','completed','cancelled')),

  -- A conflict never blocks the booking — it flags it for a human. Resources
  -- are NOT consumed while flagged, so a real double-booking cannot silently
  -- take a plate off the board.
  conflict_flag      boolean NOT NULL DEFAULT false,
  conflict_reason    text,

  driver_name        text,
  driver_phone       text,
  driver_vehicle     text,

  eta_departure      timestamptz,
  eta_arrival        timestamptz,
  actual_departure   timestamptz,
  actual_arrival     timestamptz,

  customer_notified_at timestamptz,

  assigned_at        timestamptz,
  completed_at       timestamptz,
  deleted_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- One live assignment per deal. Partial, so a cancelled run can be re-booked
  -- without deleting the record of the first attempt.
  FOREIGN KEY (organization_id, deal_id) REFERENCES deals (organization_id, id),
  FOREIGN KEY (organization_id, store_id) REFERENCES stores (organization_id, id),
  FOREIGN KEY (organization_id, chaser_vehicle_id) REFERENCES chaser_vehicles (organization_id, id),
  FOREIGN KEY (organization_id, dealer_plate_id) REFERENCES dealer_plates (organization_id, id),
  -- A flagged conflict must say why.
  CHECK (conflict_flag = false OR conflict_reason IS NOT NULL)
);

CREATE UNIQUE INDEX idx_dispatch_one_live_per_deal ON dispatch_assignments (deal_id)
  WHERE deleted_at IS NULL AND status <> 'cancelled';

CREATE INDEX idx_dispatch_org_status ON dispatch_assignments (organization_id, status)
  WHERE deleted_at IS NULL;
-- The conflict query: other live assignments holding this resource. Ordering on
-- the RESOLVED BOOKED TIME is why the legacy defect is fixed here — the legacy
-- window compared `assigned_at` (when the booking was MADE), so two deliveries
-- booked days apart for the same afternoon were never detected, and two booked
-- the same morning for different afternoons false-positived.
CREATE INDEX idx_dispatch_plate_live ON dispatch_assignments (dealer_plate_id)
  WHERE deleted_at IS NULL AND status IN ('pending','assigned','departed','arrived');
CREATE INDEX idx_dispatch_chaser_live ON dispatch_assignments (chaser_vehicle_id)
  WHERE deleted_at IS NULL AND status IN ('pending','assigned','departed','arrived');

CREATE TRIGGER chaser_vehicles_updated_at BEFORE UPDATE ON chaser_vehicles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER dealer_plates_updated_at BEFORE UPDATE ON dealer_plates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER dispatch_assignments_updated_at BEFORE UPDATE ON dispatch_assignments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Per-store conflict window. The 4 hours is the legacy constant, kept as the
-- default and made configurable because "4 hours" is a guess about geography.
ALTER TABLE stores ADD COLUMN dispatch_conflict_window_hours integer NOT NULL DEFAULT 4
  CHECK (dispatch_conflict_window_hours BETWEEN 1 AND 24);

GRANT SELECT, INSERT, UPDATE ON chaser_vehicles TO dealpilot_app;
GRANT SELECT, INSERT, UPDATE ON dealer_plates TO dealpilot_app;
GRANT SELECT, INSERT, UPDATE ON dispatch_assignments TO dealpilot_app;

ALTER TABLE chaser_vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE chaser_vehicles FORCE ROW LEVEL SECURITY;
ALTER TABLE dealer_plates ENABLE ROW LEVEL SECURITY;
ALTER TABLE dealer_plates FORCE ROW LEVEL SECURITY;
ALTER TABLE dispatch_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispatch_assignments FORCE ROW LEVEL SECURITY;

CREATE POLICY chaser_isolation ON chaser_vehicles
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

CREATE POLICY plate_isolation ON dealer_plates
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

CREATE POLICY dispatch_isolation ON dispatch_assignments
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
