-- ============================================
-- NOTIFICATIONS & AUTOMATION — Rules Engine
-- Core Module Story M-010
-- ============================================

CREATE TABLE IF NOT EXISTS automation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id),
  name TEXT NOT NULL,
  description TEXT,
  trigger_event TEXT NOT NULL, -- 'deal_stage_changed', 'task_overdue', 'vehicle_aging', 'safety_overdue', 'funding_overdue'
  trigger_condition JSONB DEFAULT '{}', -- e.g., { "from_stage": "approved", "to_stage": "signed" }
  action_type TEXT NOT NULL, -- 'notify', 'email', 'create_task'
  action_config JSONB DEFAULT '{}', -- e.g., { "target_role": "gm", "urgency": "high", "template": "..." }
  escalation_minutes INTEGER, -- if not acknowledged, escalate after N minutes
  escalation_target_role TEXT, -- role to escalate to
  active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER automation_rules_updated_at
  BEFORE UPDATE ON automation_rules FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_automation_rules_store ON automation_rules(store_id);
CREATE INDEX idx_automation_rules_trigger ON automation_rules(trigger_event);

ALTER TABLE automation_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Rules viewable" ON automation_rules FOR SELECT USING (true);
CREATE POLICY "Rules insertable" ON automation_rules FOR INSERT WITH CHECK (true);
CREATE POLICY "Rules updatable" ON automation_rules FOR UPDATE USING (true);
CREATE POLICY "Rules deletable" ON automation_rules FOR DELETE USING (true);

-- Seed built-in rules
INSERT INTO automation_rules (name, trigger_event, trigger_condition, action_type, action_config, escalation_minutes, escalation_target_role) VALUES
  ('Safety Overdue Alert', 'safety_overdue', '{"days_overdue": 14}', 'notify', '{"target_role": "used_car_manager", "urgency": "high"}', 30, 'gm'),
  ('Funding Overdue Alert', 'funding_overdue', '{"days_overdue": 7}', 'notify', '{"target_role": "fi_manager", "urgency": "high"}', 60, 'gm'),
  ('Vehicle Aging Alert', 'vehicle_aging', '{"days_threshold": 60}', 'notify', '{"target_role": "used_car_manager", "urgency": "medium"}', NULL, NULL),
  ('Deal Stage Change', 'deal_stage_changed', '{}', 'notify', '{"target_role": "salesperson", "urgency": "low"}', NULL, NULL),
  ('Task Overdue', 'task_overdue', '{}', 'notify', '{"target_role": "sales_manager", "urgency": "medium"}', 10, 'gm');
