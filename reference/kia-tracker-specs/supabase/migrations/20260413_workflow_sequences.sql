-- Workflow Sequences: automated multi-step lead nurturing flows
-- Run in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS workflow_sequences (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  description    TEXT,
  trigger_on     TEXT NOT NULL DEFAULT 'lead_status_change'
                 CHECK (trigger_on IN (
                   'lead_status_change','lead_created','lead_assigned',
                   'deal_created','no_response'
                 )),
  trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active      BOOLEAN NOT NULL DEFAULT FALSE,
  created_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_sequences_active
  ON workflow_sequences (is_active) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_workflow_sequences_trigger
  ON workflow_sequences (trigger_on);

CREATE TABLE IF NOT EXISTS workflow_steps (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id    UUID NOT NULL REFERENCES workflow_sequences(id) ON DELETE CASCADE,
  step_order     INTEGER NOT NULL,
  delay_minutes  INTEGER NOT NULL DEFAULT 0,
  action_type    TEXT NOT NULL
                 CHECK (action_type IN (
                   'email','sms','call_reminder','task','notification','wait'
                 )),
  template_id    UUID REFERENCES message_templates(id) ON DELETE SET NULL,
  custom_subject TEXT,
  custom_body    TEXT,
  config         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workflow_id, step_order)
);

CREATE INDEX IF NOT EXISTS idx_workflow_steps_workflow
  ON workflow_steps (workflow_id, step_order);

CREATE TABLE IF NOT EXISTS workflow_enrollments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id     UUID NOT NULL REFERENCES workflow_sequences(id) ON DELETE CASCADE,
  lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','completed','cancelled','failed')),
  current_step    INTEGER NOT NULL DEFAULT 0,
  next_run_at     TIMESTAMPTZ,
  enrolled_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  last_error      TEXT,
  UNIQUE (workflow_id, lead_id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_enrollments_lead
  ON workflow_enrollments (lead_id);

CREATE INDEX IF NOT EXISTS idx_workflow_enrollments_due
  ON workflow_enrollments (next_run_at)
  WHERE status = 'active' AND next_run_at IS NOT NULL;
