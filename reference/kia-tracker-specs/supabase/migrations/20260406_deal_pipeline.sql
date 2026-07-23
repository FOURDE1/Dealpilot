-- ============================================
-- DEAL PIPELINE — Kanban Stages + Funding Track
-- Core Module Story M-001
-- ============================================

-- 1. Add pipeline columns to deals
ALTER TABLE deals ADD COLUMN IF NOT EXISTS pipeline_stage TEXT DEFAULT 'new';
ALTER TABLE deals ADD COLUMN IF NOT EXISTS funding_status TEXT DEFAULT 'not_submitted';
ALTER TABLE deals ADD COLUMN IF NOT EXISTS lost_reason TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS lost_reason_detail TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS lost_at TIMESTAMPTZ;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS stage_entered_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE deals ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS delivery_confirmed_by UUID REFERENCES users(id);
ALTER TABLE deals ADD COLUMN IF NOT EXISTS funded_at TIMESTAMPTZ;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS funding_confirmed_by UUID REFERENCES users(id);

-- 2. Migrate existing deals to pipeline stages based on current status
UPDATE deals SET pipeline_stage = CASE
  WHEN deal_status = 'complete' THEN 'complete'
  WHEN deal_status = 'cancelled' THEN 'lost'
  WHEN vehicle_status = 'delivered' THEN 'delivered'
  WHEN finance_status = 'funded' AND vehicle_status != 'delivered' THEN 'pending_delivery'
  WHEN finance_status = 'approved' THEN 'approved'
  ELSE 'new'
END
WHERE pipeline_stage = 'new' OR pipeline_stage IS NULL;

-- Migrate funding status
UPDATE deals SET funding_status = CASE
  WHEN finance_status = 'funded' THEN 'funded'
  WHEN finance_status = 'approved' THEN 'submitted'
  ELSE 'not_submitted'
END
WHERE funding_status = 'not_submitted' OR funding_status IS NULL;

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_deals_pipeline_stage ON deals(pipeline_stage);
CREATE INDEX IF NOT EXISTS idx_deals_funding_status ON deals(funding_status);
CREATE INDEX IF NOT EXISTS idx_deals_stage_entered ON deals(stage_entered_at);

-- 4. Stage history table
CREATE TABLE IF NOT EXISTS deal_stage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  changed_by UUID REFERENCES users(id),
  changed_at TIMESTAMPTZ DEFAULT now(),
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_deal_stage_history_deal ON deal_stage_history(deal_id);

ALTER TABLE deal_stage_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Stage history viewable by all" ON deal_stage_history FOR SELECT USING (true);
CREATE POLICY "Stage history insertable by all" ON deal_stage_history FOR INSERT WITH CHECK (true);
