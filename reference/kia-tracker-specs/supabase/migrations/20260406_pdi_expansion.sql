-- ============================================
-- PRE-DELIVERY CHECKLIST EXPANSION
-- Core Module Story M-004
-- ============================================

-- Expand delivery_checklists with full PDI fields
ALTER TABLE delivery_checklists ADD COLUMN IF NOT EXISTS section TEXT;
ALTER TABLE delivery_checklists ADD COLUMN IF NOT EXISTS checklist_items JSONB DEFAULT '[]';
-- Each item: {id, section, label, checked, photo_required, photo_url, notes}
ALTER TABLE delivery_checklists ADD COLUMN IF NOT EXISTS compliance_pct INTEGER DEFAULT 0;
ALTER TABLE delivery_checklists ADD COLUMN IF NOT EXISTS manager_signed BOOLEAN DEFAULT false;
ALTER TABLE delivery_checklists ADD COLUMN IF NOT EXISTS manager_signed_by UUID REFERENCES users(id);
ALTER TABLE delivery_checklists ADD COLUMN IF NOT EXISTS manager_signed_at TIMESTAMPTZ;

-- PDI template items table (configurable per store)
CREATE TABLE IF NOT EXISTS pdi_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id),
  section TEXT NOT NULL, -- 'exterior', 'interior', 'mechanical', 'documents', 'accessories'
  label TEXT NOT NULL,
  photo_required BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pdi_templates_store ON pdi_templates(store_id);

ALTER TABLE pdi_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "PDI templates viewable by all" ON pdi_templates FOR SELECT USING (true);
CREATE POLICY "PDI templates insertable by all" ON pdi_templates FOR INSERT WITH CHECK (true);
CREATE POLICY "PDI templates updatable by all" ON pdi_templates FOR UPDATE USING (true);

-- Seed default PDI items
INSERT INTO pdi_templates (section, label, photo_required, sort_order) VALUES
  -- Exterior
  ('exterior', 'Body condition (no dents/scratches)', true, 1),
  ('exterior', 'Paint condition', false, 2),
  ('exterior', 'All lights working', false, 3),
  ('exterior', 'Windshield condition', false, 4),
  ('exterior', 'Tire condition & pressure', false, 5),
  ('exterior', 'License plates installed', false, 6),
  -- Interior
  ('interior', 'Seats clean & undamaged', false, 7),
  ('interior', 'Dashboard & controls working', false, 8),
  ('interior', 'AC/Heat functional', false, 9),
  ('interior', 'Radio & speakers working', false, 10),
  ('interior', 'Floor mats installed', false, 11),
  -- Mechanical
  ('mechanical', 'Odometer reading recorded', true, 12),
  ('mechanical', 'Engine runs properly', false, 13),
  ('mechanical', 'Brakes tested', false, 14),
  ('mechanical', 'Fluid levels checked', false, 15),
  -- Documents
  ('documents', 'Bill of sale signed', false, 16),
  ('documents', 'Insurance verified', true, 17),
  ('documents', 'Registration complete', false, 18),
  ('documents', 'Financing docs signed', false, 19),
  -- Accessories
  ('accessories', 'Spare key provided', false, 20),
  ('accessories', 'Owner manual provided', false, 21),
  ('accessories', 'VIN plate photo', true, 22);
