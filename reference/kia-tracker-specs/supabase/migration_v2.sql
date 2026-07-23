-- Kia Mont-Laurier Deal Tracker — Migration V2
-- Delivery Management, Sourced Units & AI Dispatch
-- Run this in your Supabase SQL Editor

-- ============================================
-- ADD COLUMNS TO DEALS TABLE
-- ============================================
ALTER TABLE deals ADD COLUMN IF NOT EXISTS tentative_delivery_date DATE;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS is_sourced_unit BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_deals_tentative_delivery ON deals(tentative_delivery_date);
CREATE INDEX IF NOT EXISTS idx_deals_is_sourced_unit ON deals(is_sourced_unit);

-- ============================================
-- DELIVERY CHECKLISTS TABLE (1:1 with deals)
-- ============================================
CREATE TABLE IF NOT EXISTS delivery_checklists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,

  -- 4 Critical Pre-Delivery Items
  client_insurance_uploaded BOOLEAN DEFAULT false,
  client_insurance_file_url TEXT,
  deal_funded BOOLEAN DEFAULT false,
  deal_funded_proof_url TEXT,
  safety_done BOOLEAN DEFAULT false,
  registration_done BOOLEAN DEFAULT false,

  -- Delivery Booking
  drivers_booked BOOLEAN DEFAULT false,
  driver_names TEXT,
  booking_company TEXT CHECK (booking_company IN ('supreme', 'denises_guys')),
  booked_delivery_time TIMESTAMPTZ,
  chaser_car_required BOOLEAN DEFAULT false,
  chaser_car_booked BOOLEAN DEFAULT false,
  dealer_plate_required BOOLEAN DEFAULT false,
  dealer_plate_assigned TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(deal_id)
);

CREATE TRIGGER delivery_checklists_updated_at
  BEFORE UPDATE ON delivery_checklists
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE delivery_checklists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "delivery_checklists_select" ON delivery_checklists FOR SELECT USING (true);
CREATE POLICY "delivery_checklists_insert" ON delivery_checklists FOR INSERT WITH CHECK (true);
CREATE POLICY "delivery_checklists_update" ON delivery_checklists FOR UPDATE USING (true);
CREATE POLICY "delivery_checklists_delete" ON delivery_checklists FOR DELETE USING (true);
ALTER PUBLICATION supabase_realtime ADD TABLE delivery_checklists;

-- ============================================
-- SOURCED UNITS TABLE (1:1 with deals)
-- ============================================
CREATE TABLE IF NOT EXISTS sourced_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,

  seller_name TEXT,
  seller_location TEXT,
  pickup_date DATE,
  picked_up_delivered BOOLEAN DEFAULT false,
  vehicle_paid BOOLEAN DEFAULT false,
  bill_of_sale_received BOOLEAN DEFAULT false,
  bill_of_sale_file_url TEXT,
  deposit_premium_paid BOOLEAN DEFAULT false,
  deposit_amount DECIMAL(10,2) DEFAULT 0,
  payment_method TEXT CHECK (payment_method IN ('wire', 'etransfer', 'cc')),
  proof_of_payment_url TEXT,
  drivers_booked_for_pickup BOOLEAN DEFAULT false,
  pickup_driver_names TEXT,
  pickup_company TEXT,
  pickup_datetime TIMESTAMPTZ,
  comes_with_safety BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(deal_id)
);

CREATE TRIGGER sourced_units_updated_at
  BEFORE UPDATE ON sourced_units
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE sourced_units ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sourced_units_select" ON sourced_units FOR SELECT USING (true);
CREATE POLICY "sourced_units_insert" ON sourced_units FOR INSERT WITH CHECK (true);
CREATE POLICY "sourced_units_update" ON sourced_units FOR UPDATE USING (true);
CREATE POLICY "sourced_units_delete" ON sourced_units FOR DELETE USING (true);
ALTER PUBLICATION supabase_realtime ADD TABLE sourced_units;

-- ============================================
-- CHASER VEHICLES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS chaser_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'in_use')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER chaser_vehicles_updated_at
  BEFORE UPDATE ON chaser_vehicles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE chaser_vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chaser_vehicles_select" ON chaser_vehicles FOR SELECT USING (true);
CREATE POLICY "chaser_vehicles_insert" ON chaser_vehicles FOR INSERT WITH CHECK (true);
CREATE POLICY "chaser_vehicles_update" ON chaser_vehicles FOR UPDATE USING (true);
CREATE POLICY "chaser_vehicles_delete" ON chaser_vehicles FOR DELETE USING (true);
ALTER PUBLICATION supabase_realtime ADD TABLE chaser_vehicles;

-- ============================================
-- DEALER PLATES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS dealer_plates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plate_number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'in_use')),
  assigned_chaser_id UUID REFERENCES chaser_vehicles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER dealer_plates_updated_at
  BEFORE UPDATE ON dealer_plates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE dealer_plates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dealer_plates_select" ON dealer_plates FOR SELECT USING (true);
CREATE POLICY "dealer_plates_insert" ON dealer_plates FOR INSERT WITH CHECK (true);
CREATE POLICY "dealer_plates_update" ON dealer_plates FOR UPDATE USING (true);
CREATE POLICY "dealer_plates_delete" ON dealer_plates FOR DELETE USING (true);
ALTER PUBLICATION supabase_realtime ADD TABLE dealer_plates;

-- ============================================
-- DISPATCH ASSIGNMENTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS dispatch_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  chaser_vehicle_id UUID REFERENCES chaser_vehicles(id) ON DELETE SET NULL,
  dealer_plate_id UUID REFERENCES dealer_plates(id) ON DELETE SET NULL,
  num_drivers_needed INTEGER NOT NULL DEFAULT 1,
  dispatch_company TEXT CHECK (dispatch_company IN ('supreme', 'denises_guys')),
  has_trade_in BOOLEAN DEFAULT false,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'assigned', 'in_transit', 'completed')),
  conflict_flag BOOLEAN DEFAULT false,
  conflict_reason TEXT,
  assigned_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(deal_id)
);

CREATE TRIGGER dispatch_assignments_updated_at
  BEFORE UPDATE ON dispatch_assignments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE dispatch_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dispatch_assignments_select" ON dispatch_assignments FOR SELECT USING (true);
CREATE POLICY "dispatch_assignments_insert" ON dispatch_assignments FOR INSERT WITH CHECK (true);
CREATE POLICY "dispatch_assignments_update" ON dispatch_assignments FOR UPDATE USING (true);
CREATE POLICY "dispatch_assignments_delete" ON dispatch_assignments FOR DELETE USING (true);
ALTER PUBLICATION supabase_realtime ADD TABLE dispatch_assignments;

-- ============================================
-- STORAGE BUCKET FOR FILE UPLOADS
-- ============================================
INSERT INTO storage.buckets (id, name, public) VALUES ('deal-files', 'deal-files', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: allow all authenticated access (matches team-shared model)
CREATE POLICY "deal_files_select" ON storage.objects FOR SELECT USING (bucket_id = 'deal-files');
CREATE POLICY "deal_files_insert" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'deal-files');
CREATE POLICY "deal_files_update" ON storage.objects FOR UPDATE USING (bucket_id = 'deal-files');
CREATE POLICY "deal_files_delete" ON storage.objects FOR DELETE USING (bucket_id = 'deal-files');
