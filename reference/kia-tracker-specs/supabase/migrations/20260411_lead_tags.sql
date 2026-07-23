-- ============================================
-- LEAD TAGS
-- Global tag catalog + lead assignment junction
-- ============================================

-- 1. Tags catalog table (global, no store scoping)
CREATE TABLE IF NOT EXISTS tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(50) NOT NULL UNIQUE,
  color VARCHAR(7) NOT NULL DEFAULT '#3B82F6',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Lead-tag junction table
CREATE TABLE IF NOT EXISTS lead_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(lead_id, tag_id)
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_lead_tags_lead_id ON lead_tags(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_tags_tag_id ON lead_tags(tag_id);

-- 4. RLS
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tags viewable" ON tags FOR SELECT USING (true);
CREATE POLICY "Tags insertable" ON tags FOR INSERT WITH CHECK (true);
CREATE POLICY "Tags updatable" ON tags FOR UPDATE USING (true);
CREATE POLICY "Tags deletable" ON tags FOR DELETE USING (true);

CREATE POLICY "Lead tags viewable" ON lead_tags FOR SELECT USING (true);
CREATE POLICY "Lead tags insertable" ON lead_tags FOR INSERT WITH CHECK (true);
CREATE POLICY "Lead tags deletable" ON lead_tags FOR DELETE USING (true);
