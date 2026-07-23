-- ============================================
-- WHOLESALE MANAGER
-- Core Module Story M-009
-- ============================================

CREATE TABLE IF NOT EXISTS wholesale_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id UUID NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id),
  auction_house TEXT,
  auction_date DATE,
  reserve_price INTEGER DEFAULT 0, -- cents
  final_price INTEGER, -- cents
  result TEXT CHECK (result IN ('pending', 'sold', 'no_sale', 'withdrawn', NULL)),
  buyer_name TEXT,
  buyer_contact TEXT,
  profit_loss INTEGER, -- cents (can be negative)
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TRIGGER wholesale_listings_updated_at
  BEFORE UPDATE ON wholesale_listings FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_wholesale_inventory ON wholesale_listings(inventory_id);
CREATE INDEX idx_wholesale_store ON wholesale_listings(store_id);
CREATE INDEX idx_wholesale_result ON wholesale_listings(result);

ALTER TABLE wholesale_listings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Wholesale viewable" ON wholesale_listings FOR SELECT USING (true);
CREATE POLICY "Wholesale insertable" ON wholesale_listings FOR INSERT WITH CHECK (true);
CREATE POLICY "Wholesale updatable" ON wholesale_listings FOR UPDATE USING (true);
CREATE POLICY "Wholesale deletable" ON wholesale_listings FOR DELETE USING (true);
