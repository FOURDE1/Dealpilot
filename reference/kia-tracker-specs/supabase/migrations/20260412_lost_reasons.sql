-- Lost Reason Tracking & Win/Loss Analysis
-- Run in Supabase SQL Editor.

-- ============================================
-- lost_reasons lookup table
-- ============================================
CREATE TABLE IF NOT EXISTS lost_reasons (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,
  name_fr       TEXT,
  icon          TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  store_id      UUID REFERENCES stores(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lost_reasons_store_active
  ON lost_reasons (store_id, is_active);

ALTER TABLE lost_reasons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on lost_reasons" ON lost_reasons
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- Add columns to leads table
-- ============================================
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lost_reason_id UUID REFERENCES lost_reasons(id);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lost_reason_note TEXT;
-- lost_at already exists on most setups; safe to add IF NOT EXISTS
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lost_at TIMESTAMPTZ;

-- ============================================
-- Seed lost reasons
-- ============================================
INSERT INTO lost_reasons (name, name_fr, icon, display_order, store_id) VALUES
  ('Price too high',     'Prix trop élevé',       '💰', 1, '4edcf6fb-d93e-4fe7-8d0f-9440dd60c907'),
  ('Chose competitor',   'A choisi un concurrent', '🏪', 2, '4edcf6fb-d93e-4fe7-8d0f-9440dd60c907'),
  ('Bad timing',         'Mauvais moment',         '⏰', 3, '4edcf6fb-d93e-4fe7-8d0f-9440dd60c907'),
  ('No response',        'Aucune réponse',         '📵', 4, '4edcf6fb-d93e-4fe7-8d0f-9440dd60c907'),
  ('Changed mind',       'A changé d''avis',       '🔄', 5, '4edcf6fb-d93e-4fe7-8d0f-9440dd60c907'),
  ('Found elsewhere',    'Trouvé ailleurs',        '🔍', 6, '4edcf6fb-d93e-4fe7-8d0f-9440dd60c907'),
  ('Financing denied',   'Financement refusé',     '🏦', 7, '4edcf6fb-d93e-4fe7-8d0f-9440dd60c907'),
  ('Just browsing',      'Juste en exploration',   '👀', 8, '4edcf6fb-d93e-4fe7-8d0f-9440dd60c907'),
  ('Other',              'Autre',                  '📝', 9, '4edcf6fb-d93e-4fe7-8d0f-9440dd60c907')
ON CONFLICT (name) DO NOTHING;
