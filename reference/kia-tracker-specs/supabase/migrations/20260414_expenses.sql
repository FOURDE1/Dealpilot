-- =============================================================================
-- Expense tracking + suppliers + accounting reconciliation foundation.
-- Per-vehicle + per-deal expenses with manager-approval workflow.
-- =============================================================================

-- ---------------------------- SUPPLIERS --------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  category      TEXT,                  -- e.g. 'mechanical', 'detail', 'transport', 'parts', 'advertising'
  contact_name  TEXT,
  phone         TEXT,
  email         TEXT,
  address       TEXT,
  tax_number    TEXT,                  -- GST/HST/BN
  payment_terms TEXT,                  -- 'net30', 'cod', etc
  notes         TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_suppliers_active ON suppliers(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON suppliers(LOWER(name));

-- ---------------------------- EXPENSE CATEGORIES -----------------------------
CREATE TABLE IF NOT EXISTS expense_categories (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code         TEXT NOT NULL UNIQUE,   -- 'recon_mech', 'detail', 'transport', etc
  label        TEXT NOT NULL,
  description  TEXT,
  is_cogs      BOOLEAN NOT NULL DEFAULT TRUE,  -- counts toward cost of goods sold
  display_order INTEGER NOT NULL DEFAULT 100,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO expense_categories (code, label, is_cogs, display_order) VALUES
  ('purchase',        'Purchase Cost',          TRUE,  10),
  ('transport',       'Transport / Freight',    TRUE,  20),
  ('safety_pdi',      'Safety / PDI',           TRUE,  30),
  ('recon_mech',      'Reconditioning — Mechanical', TRUE, 40),
  ('recon_body',      'Reconditioning — Body',  TRUE,  50),
  ('detail',          'Detailing',              TRUE,  60),
  ('parts',           'Parts',                  TRUE,  70),
  ('sublet',          'Sublet / Outside Work',  TRUE,  80),
  ('keys',            'Keys / Fobs',            TRUE,  90),
  ('advertising',     'Advertising / Marketing', FALSE, 100),
  ('pack',            'Pack / Dealer Fee',      TRUE,  110),
  ('floorplan',       'Floorplan Interest',     TRUE,  120),
  ('commission_sales','Sales Commission',       FALSE, 130),
  ('commission_fi',   'F&I Commission',         FALSE, 140),
  ('warranty_cost',   'Warranty Product Cost',  TRUE,  150),
  ('admin',           'Admin / Office',         FALSE, 160),
  ('other',           'Other',                  FALSE, 900)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------- EXPENSES ---------------------------------------
CREATE TABLE IF NOT EXISTS expenses (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       UUID REFERENCES stores(id),

  -- Linkage: at minimum one of inventory_id OR deal_id must be set.
  inventory_id   UUID REFERENCES inventory(id) ON DELETE SET NULL,
  deal_id        UUID REFERENCES deals(id) ON DELETE SET NULL,
  stock_number   TEXT,                 -- denormalized for fast lookup / reports

  category_code  TEXT NOT NULL REFERENCES expense_categories(code),
  supplier_id    UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name  TEXT,                 -- fallback if no supplier record

  amount_cents   INTEGER NOT NULL CHECK (amount_cents >= 0),
  tax_cents      INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents    INTEGER GENERATED ALWAYS AS (amount_cents + tax_cents) STORED,

  invoice_number TEXT,
  expense_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  description    TEXT,
  notes          TEXT,
  receipt_url    TEXT,                 -- Supabase Storage path

  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','approved','paid','rejected','void')),
  approved_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at    TIMESTAMPTZ,
  paid_at        TIMESTAMPTZ,
  payment_method TEXT,                 -- 'cash', 'cheque', 'etransfer', 'credit', 'ap'

  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT expense_must_link CHECK (inventory_id IS NOT NULL OR deal_id IS NOT NULL OR stock_number IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_expenses_inventory ON expenses(inventory_id) WHERE inventory_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_deal ON expenses(deal_id) WHERE deal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_stock ON expenses(stock_number) WHERE stock_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_supplier ON expenses(supplier_id);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category_code);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses(status);

-- Auto-populate stock_number from inventory when linked.
CREATE OR REPLACE FUNCTION expenses_fill_stock() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.stock_number IS NULL AND NEW.inventory_id IS NOT NULL THEN
    SELECT stock_number INTO NEW.stock_number FROM inventory WHERE id = NEW.inventory_id;
  END IF;
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_expenses_fill_stock ON expenses;
CREATE TRIGGER trg_expenses_fill_stock
  BEFORE INSERT OR UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION expenses_fill_stock();

-- ---------------------------- VIEW: per-vehicle cost summary ------------------
-- Aggregates all approved+paid expenses per inventory unit.
CREATE OR REPLACE VIEW vehicle_expense_summary AS
SELECT
  i.id                   AS inventory_id,
  i.stock_number,
  i.vin,
  i.year, i.make, i.model,
  COUNT(e.id)            AS expense_count,
  COALESCE(SUM(CASE WHEN e.status IN ('approved','paid') THEN e.total_cents ELSE 0 END), 0) AS total_cents,
  COALESCE(SUM(CASE WHEN e.status = 'pending' THEN e.total_cents ELSE 0 END), 0)            AS pending_cents,
  COALESCE(SUM(CASE WHEN e.status = 'paid' THEN e.total_cents ELSE 0 END), 0)               AS paid_cents
FROM inventory i
LEFT JOIN expenses e ON e.inventory_id = i.id
GROUP BY i.id;
