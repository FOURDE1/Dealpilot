-- ============================================
-- ACTIVITY EVENTS — Audit Trail
-- Foundation Story F-008
-- ============================================

CREATE TABLE activity_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL, -- 'deal', 'contact', 'salesperson', etc.
  entity_id UUID NOT NULL,
  action TEXT NOT NULL, -- 'created', 'updated', 'deleted', 'restored', 'stage_changed', etc.
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  old_value JSONB,
  new_value JSONB,
  metadata JSONB, -- extra context (e.g., { field: 'deal_status', from: 'open', to: 'complete' })
  store_id UUID REFERENCES stores(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_activity_events_entity ON activity_events(entity_type, entity_id);
CREATE INDEX idx_activity_events_actor ON activity_events(actor_id);
CREATE INDEX idx_activity_events_store ON activity_events(store_id);
CREATE INDEX idx_activity_events_created_at ON activity_events(created_at);

ALTER TABLE activity_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Activity events are viewable by all authenticated users"
  ON activity_events FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert activity events"
  ON activity_events FOR INSERT WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE activity_events;
