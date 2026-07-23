-- Lead Source ROI — Ad spend tracking per source/month
-- Run in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS source_costs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source      TEXT NOT NULL,
  month       DATE NOT NULL,
  spend       DECIMAL(12,2) NOT NULL DEFAULT 0,
  notes       TEXT,
  store_id    UUID REFERENCES stores(id) ON DELETE SET NULL,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(source, month, store_id)
);

CREATE INDEX IF NOT EXISTS idx_source_costs_store_month
  ON source_costs (store_id, month);

CREATE INDEX IF NOT EXISTS idx_source_costs_source_month
  ON source_costs (source, month);

ALTER TABLE source_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on source_costs" ON source_costs
  FOR ALL USING (true) WITH CHECK (true);

-- Seed sample spend
INSERT INTO source_costs (source, month, spend, notes, store_id, created_by) VALUES
  ('facebook',       '2026-04-01', 800.00, 'April Facebook Ads',    '4edcf6fb-d93e-4fe7-8d0f-9440dd60c907', 'ea422f90-7d91-427a-a811-49d4715aca4f'),
  ('meta_lead_form', '2026-04-01', 500.00, 'April Meta Lead Forms', '4edcf6fb-d93e-4fe7-8d0f-9440dd60c907', 'ea422f90-7d91-427a-a811-49d4715aca4f'),
  ('website',        '2026-04-01', 200.00, 'April SEO/Website',     '4edcf6fb-d93e-4fe7-8d0f-9440dd60c907', 'ea422f90-7d91-427a-a811-49d4715aca4f'),
  ('google_ads',     '2026-04-01', 600.00, 'April Google Ads',      '4edcf6fb-d93e-4fe7-8d0f-9440dd60c907', 'ea422f90-7d91-427a-a811-49d4715aca4f')
ON CONFLICT (source, month, store_id) DO NOTHING;
