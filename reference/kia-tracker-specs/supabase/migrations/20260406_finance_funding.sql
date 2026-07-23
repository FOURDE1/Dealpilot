-- ============================================
-- FINANCE DESK + FUNDING TRACKER
-- Core Modules M-007 + M-008
-- ============================================

-- Lenders table
CREATE TABLE IF NOT EXISTS lenders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  rate_sheet_url TEXT,
  avg_turnaround_days INTEGER DEFAULT 3,
  approval_criteria TEXT,
  active BOOLEAN DEFAULT true,
  store_id UUID REFERENCES stores(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER lenders_updated_at
  BEFORE UPDATE ON lenders FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Deal submissions to lenders
CREATE TABLE IF NOT EXISTS deal_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  lender_id UUID NOT NULL REFERENCES lenders(id),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'approved', 'declined', 'conditional', 'funded')),
  rate DECIMAL(5,2), -- interest rate %
  term INTEGER, -- months
  monthly_payment INTEGER, -- cents
  conditions TEXT, -- conditions for conditional approval
  submitted_at TIMESTAMPTZ DEFAULT now(),
  responded_at TIMESTAMPTZ,
  funded_at TIMESTAMPTZ,
  notes TEXT,
  store_id UUID REFERENCES stores(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER deal_submissions_updated_at
  BEFORE UPDATE ON deal_submissions FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Funding proof tracking (extends deals)
ALTER TABLE deals ADD COLUMN IF NOT EXISTS funding_proof_url TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS funding_proof_uploaded_at TIMESTAMPTZ;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS funding_submitted_to_bank_at TIMESTAMPTZ;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS funding_docs_sent_at TIMESTAMPTZ;

-- Indexes
CREATE INDEX idx_lenders_store ON lenders(store_id);
CREATE INDEX idx_deal_submissions_deal ON deal_submissions(deal_id);
CREATE INDEX idx_deal_submissions_lender ON deal_submissions(lender_id);
CREATE INDEX idx_deal_submissions_status ON deal_submissions(status);

-- RLS
ALTER TABLE lenders ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lenders viewable" ON lenders FOR SELECT USING (true);
CREATE POLICY "Lenders insertable" ON lenders FOR INSERT WITH CHECK (true);
CREATE POLICY "Lenders updatable" ON lenders FOR UPDATE USING (true);

CREATE POLICY "Submissions viewable" ON deal_submissions FOR SELECT USING (true);
CREATE POLICY "Submissions insertable" ON deal_submissions FOR INSERT WITH CHECK (true);
CREATE POLICY "Submissions updatable" ON deal_submissions FOR UPDATE USING (true);
