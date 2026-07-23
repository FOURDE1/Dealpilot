-- Configurable Lead Scoring Engine
-- Run in Supabase SQL Editor.

-- ============================================
-- lead_scoring_rules — rule definitions
-- ============================================
CREATE TABLE IF NOT EXISTS lead_scoring_rules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  field       TEXT NOT NULL,
  operator    TEXT NOT NULL CHECK (operator IN ('gt','gte','lt','lte','eq','neq','contains','not_contains','exists','not_exists','in','not_in')),
  value       TEXT,
  score       INTEGER NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  priority    INTEGER NOT NULL DEFAULT 0,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  store_id    UUID REFERENCES stores(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_scoring_rules_active
  ON lead_scoring_rules (is_active, priority DESC);

CREATE INDEX IF NOT EXISTS idx_lead_scoring_rules_store
  ON lead_scoring_rules (store_id);

-- ============================================
-- lead_scores — cached score + breakdown per lead
-- ============================================
CREATE TABLE IF NOT EXISTS lead_scores (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     UUID NOT NULL UNIQUE REFERENCES leads(id) ON DELETE CASCADE,
  score       INTEGER NOT NULL DEFAULT 0,
  breakdown   JSONB NOT NULL DEFAULT '[]'::jsonb,
  scored_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_scores_lead_id
  ON lead_scores (lead_id);

CREATE INDEX IF NOT EXISTS idx_lead_scores_score
  ON lead_scores (score DESC);

-- ============================================
-- RLS
-- ============================================
ALTER TABLE lead_scoring_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on lead_scoring_rules" ON lead_scoring_rules
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all on lead_scores" ON lead_scores
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- Seed rules
-- ============================================
INSERT INTO lead_scoring_rules (name, field, operator, value, score, priority, store_id, created_by) VALUES
  (
    'Has phone number',
    'has_phone', 'exists', NULL, 10, 100,
    '4edcf6fb-d93e-4fe7-8d0f-9440dd60c907',
    'ea422f90-7d91-427a-a811-49d4715aca4f'
  ),
  (
    'Has email',
    'has_email', 'exists', NULL, 10, 90,
    '4edcf6fb-d93e-4fe7-8d0f-9440dd60c907',
    'ea422f90-7d91-427a-a811-49d4715aca4f'
  ),
  (
    'Facebook lead source',
    'source', 'eq', 'facebook', 15, 80,
    '4edcf6fb-d93e-4fe7-8d0f-9440dd60c907',
    'ea422f90-7d91-427a-a811-49d4715aca4f'
  ),
  (
    'Lead going cold (7+ days)',
    'created_days_ago', 'gte', '7', -10, 70,
    '4edcf6fb-d93e-4fe7-8d0f-9440dd60c907',
    'ea422f90-7d91-427a-a811-49d4715aca4f'
  ),
  (
    'Has trade-in',
    'has_trade_in', 'eq', 'true', 20, 60,
    '4edcf6fb-d93e-4fe7-8d0f-9440dd60c907',
    'ea422f90-7d91-427a-a811-49d4715aca4f'
  ),
  (
    'No assignment',
    'assigned_to', 'not_exists', NULL, -15, 50,
    '4edcf6fb-d93e-4fe7-8d0f-9440dd60c907',
    'ea422f90-7d91-427a-a811-49d4715aca4f'
  );
