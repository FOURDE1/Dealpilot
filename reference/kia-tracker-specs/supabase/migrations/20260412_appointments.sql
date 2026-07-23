-- Appointment Scheduling
-- Test drives, showroom visits, follow-ups, phone calls.
-- Run in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS appointments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id        UUID REFERENCES leads(id) ON DELETE CASCADE,
  assigned_to    UUID REFERENCES users(id) ON DELETE SET NULL,
  type           TEXT NOT NULL CHECK (type IN ('test_drive','showroom_visit','follow_up','phone_call')),
  title          TEXT NOT NULL,
  description    TEXT,
  start_time     TIMESTAMPTZ NOT NULL,
  end_time       TIMESTAMPTZ NOT NULL,
  location       TEXT,
  status         TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','confirmed','completed','cancelled','no_show')),
  reminder_sent  BOOLEAN NOT NULL DEFAULT FALSE,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT end_after_start CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_appointments_lead_id
  ON appointments (lead_id);

CREATE INDEX IF NOT EXISTS idx_appointments_assigned_to_start
  ON appointments (assigned_to, start_time);

CREATE INDEX IF NOT EXISTS idx_appointments_start_time
  ON appointments (start_time);

CREATE INDEX IF NOT EXISTS idx_appointments_status
  ON appointments (status);
