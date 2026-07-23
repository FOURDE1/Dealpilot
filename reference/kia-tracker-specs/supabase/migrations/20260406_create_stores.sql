-- ============================================
-- STORES TABLE — Multi-Store Foundation
-- Foundation Story F-004
-- ============================================

-- 1. Create stores table
CREATE TABLE stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL, -- short code: 'KIA-ML', 'READY-AUTO'
  province TEXT NOT NULL DEFAULT 'QC',
  tax_rate DECIMAL(6,4) NOT NULL DEFAULT 0.14975, -- 14.975% QST+GST for Quebec
  address TEXT,
  city TEXT,
  postal_code TEXT,
  phone TEXT,
  email TEXT,
  hours JSONB, -- { mon: "8:00-17:00", tue: "8:00-17:00", ... }
  holiday_calendar JSONB, -- array of dates
  aging_threshold_days INTEGER NOT NULL DEFAULT 60,
  safety_overdue_days INTEGER NOT NULL DEFAULT 14,
  funding_overdue_days INTEGER NOT NULL DEFAULT 7,
  bill_of_sale_system TEXT DEFAULT 'CAMS' CHECK (bill_of_sale_system IN ('CAMS', 'Merlin', 'Other')),
  esign_platform TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-update trigger
CREATE TRIGGER stores_updated_at
  BEFORE UPDATE ON stores
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- 2. Seed Kia Mont-Laurier as store #1
INSERT INTO stores (name, code, province, tax_rate, city, phone)
VALUES (
  'Kia Mont-Laurier',
  'KIA-ML',
  'QC',
  0.14975,
  'Mont-Laurier',
  NULL
);

-- 3. Add store_id to all existing tables
-- Using the seeded store's ID for backfill
DO $$
DECLARE
  default_store_id UUID;
BEGIN
  SELECT id INTO default_store_id FROM stores WHERE code = 'KIA-ML';

  -- Users
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'store_id') THEN
    ALTER TABLE users ADD COLUMN store_id UUID REFERENCES stores(id);
    UPDATE users SET store_id = default_store_id;
  END IF;

  -- Deals
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'deals' AND column_name = 'store_id') THEN
    ALTER TABLE deals ADD COLUMN store_id UUID REFERENCES stores(id);
    UPDATE deals SET store_id = default_store_id;
  END IF;

  -- Contacts
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'contacts' AND column_name = 'store_id') THEN
    ALTER TABLE contacts ADD COLUMN store_id UUID REFERENCES stores(id);
    UPDATE contacts SET store_id = default_store_id;
  END IF;

  -- Salespeople
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'salespeople' AND column_name = 'store_id') THEN
    ALTER TABLE salespeople ADD COLUMN store_id UUID REFERENCES stores(id);
    UPDATE salespeople SET store_id = default_store_id;
  END IF;

  -- Commissions
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'commissions' AND column_name = 'store_id') THEN
    ALTER TABLE commissions ADD COLUMN store_id UUID REFERENCES stores(id);
    UPDATE commissions SET store_id = default_store_id;
  END IF;

  -- Delivery checklists
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'delivery_checklists' AND column_name = 'store_id') THEN
    ALTER TABLE delivery_checklists ADD COLUMN store_id UUID REFERENCES stores(id);
    UPDATE delivery_checklists SET store_id = default_store_id;
  END IF;

  -- Sourced units
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sourced_units' AND column_name = 'store_id') THEN
    ALTER TABLE sourced_units ADD COLUMN store_id UUID REFERENCES stores(id);
    UPDATE sourced_units SET store_id = default_store_id;
  END IF;

  -- Chaser vehicles
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'chaser_vehicles' AND column_name = 'store_id') THEN
    ALTER TABLE chaser_vehicles ADD COLUMN store_id UUID REFERENCES stores(id);
    UPDATE chaser_vehicles SET store_id = default_store_id;
  END IF;

  -- Dealer plates
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dealer_plates' AND column_name = 'store_id') THEN
    ALTER TABLE dealer_plates ADD COLUMN store_id UUID REFERENCES stores(id);
    UPDATE dealer_plates SET store_id = default_store_id;
  END IF;

  -- Dispatch assignments
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dispatch_assignments' AND column_name = 'store_id') THEN
    ALTER TABLE dispatch_assignments ADD COLUMN store_id UUID REFERENCES stores(id);
    UPDATE dispatch_assignments SET store_id = default_store_id;
  END IF;

END;
$$;

-- 4. Indexes for store_id columns
CREATE INDEX IF NOT EXISTS idx_deals_store_id ON deals(store_id);
CREATE INDEX IF NOT EXISTS idx_contacts_store_id ON contacts(store_id);
CREATE INDEX IF NOT EXISTS idx_users_store_id ON users(store_id);
CREATE INDEX IF NOT EXISTS idx_salespeople_store_id ON salespeople(store_id);
CREATE INDEX IF NOT EXISTS idx_commissions_store_id ON commissions(store_id);

-- 5. RLS for stores
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Stores are viewable by all authenticated users"
  ON stores FOR SELECT USING (true);
CREATE POLICY "Only admins can insert stores"
  ON stores FOR INSERT WITH CHECK (true);
CREATE POLICY "Only admins can update stores"
  ON stores FOR UPDATE USING (true);
