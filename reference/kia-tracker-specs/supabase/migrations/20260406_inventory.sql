-- ============================================
-- INVENTORY COMMAND CENTER
-- Core Module Story M-002
-- ============================================

CREATE TABLE IF NOT EXISTS inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id) NOT NULL,

  -- Vehicle identification
  vin TEXT,
  stock_number TEXT NOT NULL,
  year INTEGER NOT NULL,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  trim TEXT,
  body_type TEXT,
  engine TEXT,
  drive_type TEXT,
  fuel_type TEXT,
  doors INTEGER,
  exterior_color TEXT,
  interior_color TEXT,
  mileage INTEGER,
  country_of_origin TEXT,

  -- Classification
  vehicle_type TEXT DEFAULT 'used' CHECK (vehicle_type IN ('new', 'used')),
  acquisition_type TEXT NOT NULL CHECK (acquisition_type IN ('auction', 'dealer_trade', 'trade_in', 'internal_wholesale', 'consignment')),
  acquisition_date DATE NOT NULL DEFAULT CURRENT_DATE,
  acquisition_cost INTEGER NOT NULL DEFAULT 0, -- cents
  transport_cost INTEGER DEFAULT 0, -- cents
  recon_cost INTEGER DEFAULT 0, -- cents
  list_price INTEGER, -- cents

  -- Location
  location_status TEXT DEFAULT 'on_lot' CHECK (location_status IN ('at_source', 'in_transit', 'on_lot', 'at_garage', 'delivered', 'wholesale')),
  location_details TEXT,

  -- Safety
  safety_status TEXT DEFAULT 'not_started' CHECK (safety_status IN ('not_required', 'not_started', 'sent_to_garage', 'in_progress', 'passed', 'failed')),
  safety_sent_at TIMESTAMPTZ,
  safety_completed_at TIMESTAMPTZ,
  safety_province TEXT,
  safety_notes TEXT,

  -- Recon
  recon_status TEXT DEFAULT 'needs_assessment' CHECK (recon_status IN ('not_needed', 'needs_assessment', 'assessed', 'recon_approved', 'in_progress', 'complete')),
  recon_items JSONB DEFAULT '[]',
  recon_estimated_total INTEGER DEFAULT 0, -- cents
  recon_approval_required BOOLEAN DEFAULT false,
  recon_approved_by UUID REFERENCES users(id),
  recon_approved_at TIMESTAMPTZ,

  -- Photos
  photo_count INTEGER DEFAULT 0,
  photo_complete BOOLEAN DEFAULT false,
  photos_front BOOLEAN DEFAULT false,
  photos_back BOOLEAN DEFAULT false,
  photos_driver_side BOOLEAN DEFAULT false,
  photos_passenger_side BOOLEAN DEFAULT false,
  photos_interior BOOLEAN DEFAULT false,
  photos_odometer BOOLEAN DEFAULT false,

  -- Deal linkage
  deal_id UUID REFERENCES deals(id),
  deal_status TEXT DEFAULT 'available' CHECK (deal_status IN ('available', 'reserved', 'sold_pending', 'delivered', 'wholesale')),
  source_deal_id UUID REFERENCES deals(id),

  -- Aging
  days_on_lot INTEGER DEFAULT 0,
  lot_arrival_date DATE,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TRIGGER inventory_updated_at
  BEFORE UPDATE ON inventory
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Vehicle photos table
CREATE TABLE IF NOT EXISTS vehicle_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id UUID NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
  angle_type TEXT NOT NULL CHECK (angle_type IN ('front', 'back', 'driver_side', 'passenger_side', 'interior', 'odometer', 'additional')),
  storage_path TEXT NOT NULL,
  file_name TEXT,
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_vehicle_photos_inventory ON vehicle_photos(inventory_id);

-- Indexes
CREATE INDEX idx_inventory_store ON inventory(store_id);
CREATE INDEX idx_inventory_vin ON inventory(vin);
CREATE INDEX idx_inventory_stock ON inventory(stock_number);
CREATE INDEX idx_inventory_location ON inventory(location_status);
CREATE INDEX idx_inventory_deal_status ON inventory(deal_status);
CREATE INDEX idx_inventory_deleted ON inventory(deleted_at);

-- RLS
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Inventory viewable by all" ON inventory FOR SELECT USING (true);
CREATE POLICY "Inventory insertable by all" ON inventory FOR INSERT WITH CHECK (true);
CREATE POLICY "Inventory updatable by all" ON inventory FOR UPDATE USING (true);
CREATE POLICY "Inventory deletable by all" ON inventory FOR DELETE USING (true);

CREATE POLICY "Photos viewable by all" ON vehicle_photos FOR SELECT USING (true);
CREATE POLICY "Photos insertable by all" ON vehicle_photos FOR INSERT WITH CHECK (true);
CREATE POLICY "Photos deletable by all" ON vehicle_photos FOR DELETE USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE inventory;
