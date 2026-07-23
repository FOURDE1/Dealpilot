-- Trade-In Vehicle & Current Vehicle structured fields
-- Run in Supabase SQL Editor.

-- Replace the single text current_vehicle with structured columns
ALTER TABLE leads ADD COLUMN IF NOT EXISTS trade_in_year        INTEGER;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS trade_in_make        TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS trade_in_model       TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS trade_in_trim        TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS trade_in_mileage     INTEGER;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS trade_in_condition   TEXT CHECK (trade_in_condition IN ('excellent','good','fair','poor'));
ALTER TABLE leads ADD COLUMN IF NOT EXISTS trade_in_value       INTEGER;     -- cents
ALTER TABLE leads ADD COLUMN IF NOT EXISTS trade_in_vin         TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS trade_in_color       TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS trade_in_notes       TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS has_trade_in         BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_leads_has_trade_in
  ON leads (has_trade_in) WHERE has_trade_in = TRUE;
