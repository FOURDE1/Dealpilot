-- Duplicate Lead Detection
-- Run in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS lead_duplicates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  duplicate_of    UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  match_type      TEXT NOT NULL CHECK (match_type IN ('phone','email','name','phone_email','phone_name','email_name','phone_email_name')),
  confidence      INTEGER NOT NULL DEFAULT 100,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','merged','dismissed')),
  merged_by       UUID REFERENCES users(id),
  merged_at       TIMESTAMPTZ,
  resolved_by     UUID REFERENCES users(id),
  resolved_at     TIMESTAMPTZ,
  store_id        UUID REFERENCES stores(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(lead_id, duplicate_of)
);

CREATE INDEX IF NOT EXISTS idx_lead_duplicates_store_status
  ON lead_duplicates (store_id, status);

CREATE INDEX IF NOT EXISTS idx_lead_duplicates_lead_id
  ON lead_duplicates (lead_id);

CREATE INDEX IF NOT EXISTS idx_lead_duplicates_duplicate_of
  ON lead_duplicates (duplicate_of);

ALTER TABLE lead_duplicates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on lead_duplicates" ON lead_duplicates
  FOR ALL USING (true) WITH CHECK (true);
