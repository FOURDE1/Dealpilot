-- ============================================
-- LEAD ASSIGNMENT RULES
-- Rules engine + round-robin state + history audit log
-- ============================================

-- 1. Rules catalog
CREATE TABLE IF NOT EXISTS lead_assignment_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  strategy TEXT NOT NULL DEFAULT 'round_robin' CHECK (strategy IN ('round_robin', 'load_balanced', 'source_based')),
  active BOOLEAN NOT NULL DEFAULT true,
  priority INTEGER NOT NULL DEFAULT 1,
  sources TEXT[] NOT NULL DEFAULT '{}',
  included_users UUID[] NOT NULL DEFAULT '{}',
  excluded_users UUID[] NOT NULL DEFAULT '{}',
  source_mappings JSONB NOT NULL DEFAULT '{}',
  max_leads_per_user INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Round-robin pointer state (one row per rule)
CREATE TABLE IF NOT EXISTS lead_assignment_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES lead_assignment_rules(id) ON DELETE CASCADE,
  last_assigned_index INTEGER NOT NULL DEFAULT -1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(rule_id)
);

-- 3. Assignment history (audit log)
CREATE TABLE IF NOT EXISTS lead_assignment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  rule_id UUID REFERENCES lead_assignment_rules(id) ON DELETE SET NULL,
  rule_name TEXT,
  strategy TEXT,
  lead_source TEXT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_assignment_rules_active_priority ON lead_assignment_rules(active, priority);
CREATE INDEX IF NOT EXISTS idx_assignment_state_rule ON lead_assignment_state(rule_id);
CREATE INDEX IF NOT EXISTS idx_assignment_history_lead ON lead_assignment_history(lead_id);
CREATE INDEX IF NOT EXISTS idx_assignment_history_assigned_to ON lead_assignment_history(assigned_to);
CREATE INDEX IF NOT EXISTS idx_assignment_history_assigned_at ON lead_assignment_history(assigned_at DESC);

-- 5. RLS
ALTER TABLE lead_assignment_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_assignment_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_assignment_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Assignment rules viewable" ON lead_assignment_rules FOR SELECT USING (true);
CREATE POLICY "Assignment rules insertable" ON lead_assignment_rules FOR INSERT WITH CHECK (true);
CREATE POLICY "Assignment rules updatable" ON lead_assignment_rules FOR UPDATE USING (true);
CREATE POLICY "Assignment rules deletable" ON lead_assignment_rules FOR DELETE USING (true);

CREATE POLICY "Assignment state viewable" ON lead_assignment_state FOR SELECT USING (true);
CREATE POLICY "Assignment state insertable" ON lead_assignment_state FOR INSERT WITH CHECK (true);
CREATE POLICY "Assignment state updatable" ON lead_assignment_state FOR UPDATE USING (true);
CREATE POLICY "Assignment state deletable" ON lead_assignment_state FOR DELETE USING (true);

CREATE POLICY "Assignment history viewable" ON lead_assignment_history FOR SELECT USING (true);
CREATE POLICY "Assignment history insertable" ON lead_assignment_history FOR INSERT WITH CHECK (true);
