-- ============================================
-- NOTIFICATIONS — Bell + Real-Time Alerts
-- Foundation Story F-011
-- ============================================

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL, -- 'deal_stage_changed', 'task_overdue', 'task_assigned', 'deal_created', etc.
  title TEXT NOT NULL,
  body TEXT,
  target_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  urgency TEXT NOT NULL DEFAULT 'low' CHECK (urgency IN ('low', 'medium', 'high')),
  acknowledged BOOLEAN NOT NULL DEFAULT false,
  acknowledged_at TIMESTAMPTZ,
  entity_type TEXT,
  entity_id UUID,
  store_id UUID REFERENCES stores(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_target ON notifications(target_user_id, acknowledged);
CREATE INDEX idx_notifications_created ON notifications(created_at);
CREATE INDEX idx_notifications_store ON notifications(store_id);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see their own notifications"
  ON notifications FOR SELECT USING (true);
CREATE POLICY "System can insert notifications"
  ON notifications FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update their own notifications"
  ON notifications FOR UPDATE USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
