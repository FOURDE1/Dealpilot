-- Communication Timeline / Unified Inbox
-- Stores every interaction (call, sms, email, visit, note) on a lead so the
-- LeadDetail Activity tab can render a chronological feed.
--
-- Run in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS lead_communications (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id          UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  type             TEXT NOT NULL CHECK (type IN ('call','sms','email','visit','note')),
  direction        TEXT CHECK (direction IN ('inbound','outbound')),
  subject          TEXT,
  body             TEXT,
  duration_seconds INTEGER,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_communications_lead_id_created_at
  ON lead_communications (lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_communications_type
  ON lead_communications (type);

CREATE INDEX IF NOT EXISTS idx_lead_communications_created_by
  ON lead_communications (created_by);
