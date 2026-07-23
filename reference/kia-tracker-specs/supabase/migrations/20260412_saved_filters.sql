-- Advanced Filters & Saved Filter Views
-- Run in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS saved_filters (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  filters     JSONB NOT NULL,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  is_shared   BOOLEAN NOT NULL DEFAULT FALSE,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  store_id    UUID REFERENCES stores(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_filters_store_user
  ON saved_filters (store_id, created_by);

CREATE INDEX IF NOT EXISTS idx_saved_filters_default_user
  ON saved_filters (is_default, created_by);

ALTER TABLE saved_filters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on saved_filters" ON saved_filters
  FOR ALL USING (true) WITH CHECK (true);
