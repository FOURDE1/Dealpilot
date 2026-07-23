-- ============================================
-- DOCUMENT MANAGER
-- Core Module Story M-006
-- ============================================

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  inventory_id UUID REFERENCES inventory(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('bill_of_sale', 'credit_app', 'insurance', 'registration', 'trade_docs', 'safety_cert', 'financing', 'id_verification', 'other')),
  filename TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_size INTEGER, -- bytes
  mime_type TEXT,
  uploaded_by UUID REFERENCES users(id),
  store_id UUID REFERENCES stores(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_documents_deal ON documents(deal_id);
CREATE INDEX idx_documents_contact ON documents(contact_id);
CREATE INDEX idx_documents_inventory ON documents(inventory_id);
CREATE INDEX idx_documents_category ON documents(category);
CREATE INDEX idx_documents_store ON documents(store_id);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Documents viewable by all" ON documents FOR SELECT USING (true);
CREATE POLICY "Documents insertable by all" ON documents FOR INSERT WITH CHECK (true);
CREATE POLICY "Documents updatable by all" ON documents FOR UPDATE USING (true);
CREATE POLICY "Documents deletable by all" ON documents FOR DELETE USING (true);

-- Required documents per deal stage
CREATE TABLE IF NOT EXISTS required_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_stage TEXT NOT NULL,
  category TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

INSERT INTO required_documents (pipeline_stage, category, label, sort_order) VALUES
  ('signed', 'credit_app', 'Credit Application', 1),
  ('signed', 'id_verification', 'ID Verification', 2),
  ('signed', 'insurance', 'Proof of Insurance', 3),
  ('pending_delivery', 'bill_of_sale', 'Bill of Sale', 4),
  ('pending_delivery', 'financing', 'Financing Agreement', 5),
  ('pending_delivery', 'registration', 'Registration', 6),
  ('delivered', 'trade_docs', 'Trade-In Documents', 7);

ALTER TABLE required_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Required docs viewable" ON required_documents FOR SELECT USING (true);
