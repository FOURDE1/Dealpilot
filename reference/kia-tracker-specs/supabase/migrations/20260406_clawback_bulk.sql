-- ============================================
-- COMMISSION CLAWBACK + BULK OPERATIONS
-- Foundation Story F-012
-- ============================================

-- 1. Add clawback status to deals
ALTER TABLE deals ADD COLUMN IF NOT EXISTS clawback_status TEXT
  DEFAULT 'none' CHECK (clawback_status IN ('none', 'flagged', 'reversed'));

-- 2. Create clawback log table
CREATE TABLE IF NOT EXISTS clawback_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  commission_id UUID,
  salesperson_name TEXT,
  original_amount INTEGER NOT NULL DEFAULT 0, -- cents
  reversed_amount INTEGER NOT NULL DEFAULT 0, -- cents
  reason TEXT NOT NULL,
  initiated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  store_id UUID REFERENCES stores(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_clawback_log_deal ON clawback_log(deal_id);
CREATE INDEX idx_clawback_log_store ON clawback_log(store_id);

ALTER TABLE clawback_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clawback logs viewable by all authenticated users"
  ON clawback_log FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert clawback logs"
  ON clawback_log FOR INSERT WITH CHECK (true);
