-- ============================================
-- TASKS — Follow-ups and Reminders
-- Foundation Story F-010
-- ============================================

CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  assignee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  due_date TIMESTAMPTZ,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  type TEXT NOT NULL DEFAULT 'follow_up' CHECK (type IN ('call', 'email', 'meeting', 'follow_up', 'delivery', 'other')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  entity_type TEXT, -- 'deal', 'contact', null
  entity_id UUID,
  recurring_interval TEXT CHECK (recurring_interval IN ('daily', 'weekly', 'biweekly', 'monthly', NULL)),
  store_id UUID REFERENCES stores(id),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE INDEX idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX idx_tasks_due_date ON tasks(due_date);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_entity ON tasks(entity_type, entity_id);
CREATE INDEX idx_tasks_store ON tasks(store_id);
CREATE INDEX idx_tasks_deleted_at ON tasks(deleted_at);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tasks viewable by all authenticated users"
  ON tasks FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert tasks"
  ON tasks FOR INSERT WITH CHECK (true);
CREATE POLICY "Authenticated users can update tasks"
  ON tasks FOR UPDATE USING (true);
CREATE POLICY "Authenticated users can delete tasks"
  ON tasks FOR DELETE USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE tasks;
