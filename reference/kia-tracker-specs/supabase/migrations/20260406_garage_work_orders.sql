-- ============================================
-- GARAGE / WORK ORDERS
-- Core Module Story M-003
-- ============================================

-- 1. Garages table
CREATE TABLE IF NOT EXISTS garages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id) NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  contact_name TEXT,
  address TEXT,
  province TEXT,
  services JSONB DEFAULT '[]', -- ['safety_inspection', 'mechanical', 'body_work', 'detailing']
  does_ontario_safety BOOLEAN DEFAULT false,
  does_quebec_safety BOOLEAN DEFAULT false,
  is_internal BOOLEAN DEFAULT false,
  standard_rates JSONB DEFAULT '{}',
  avg_turnaround_days INTEGER DEFAULT 3,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER garages_updated_at
  BEFORE UPDATE ON garages FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 2. Work orders table
CREATE TABLE IF NOT EXISTS work_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id) NOT NULL,
  inventory_id UUID REFERENCES inventory(id) ON DELETE CASCADE,
  garage_id UUID REFERENCES garages(id),

  -- Type and status
  type TEXT NOT NULL CHECK (type IN ('safety_inspection', 'mechanical', 'body_work', 'detailing', 'general_maintenance')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'received', 'in_progress', 'completed', 'invoiced')),

  -- Details
  description TEXT,
  line_items JSONB DEFAULT '[]', -- [{description, estimated_cost, actual_cost}]
  estimated_cost INTEGER DEFAULT 0, -- cents
  actual_cost INTEGER DEFAULT 0, -- cents
  notes TEXT,

  -- Safety-specific
  safety_result TEXT CHECK (safety_result IN ('passed', 'failed', NULL)),
  safety_province TEXT CHECK (safety_province IN ('ontario', 'quebec', NULL)),

  -- Tracking
  sent_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  invoiced_at TIMESTAMPTZ,

  -- People
  created_by UUID REFERENCES users(id),
  assigned_to UUID REFERENCES users(id), -- internal staff managing this WO

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TRIGGER work_orders_updated_at
  BEFORE UPDATE ON work_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Indexes
CREATE INDEX idx_garages_store ON garages(store_id);
CREATE INDEX idx_work_orders_store ON work_orders(store_id);
CREATE INDEX idx_work_orders_inventory ON work_orders(inventory_id);
CREATE INDEX idx_work_orders_garage ON work_orders(garage_id);
CREATE INDEX idx_work_orders_status ON work_orders(status);
CREATE INDEX idx_work_orders_type ON work_orders(type);
CREATE INDEX idx_work_orders_deleted ON work_orders(deleted_at);

-- RLS
ALTER TABLE garages ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Garages viewable by all" ON garages FOR SELECT USING (true);
CREATE POLICY "Garages manageable by all" ON garages FOR INSERT WITH CHECK (true);
CREATE POLICY "Garages updatable by all" ON garages FOR UPDATE USING (true);

CREATE POLICY "Work orders viewable by all" ON work_orders FOR SELECT USING (true);
CREATE POLICY "Work orders insertable by all" ON work_orders FOR INSERT WITH CHECK (true);
CREATE POLICY "Work orders updatable by all" ON work_orders FOR UPDATE USING (true);
CREATE POLICY "Work orders deletable by all" ON work_orders FOR DELETE USING (true);
