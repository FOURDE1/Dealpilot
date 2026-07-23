-- ============================================
-- LEAD MANAGER
-- Advanced Module Story A-001
-- ============================================

-- 1. Leads table
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id),

  -- Source tracking
  source TEXT NOT NULL CHECK (source IN ('fluent_form', 'meta_lead_form', 'manual', 'chatbot', 'website')),
  source_platform TEXT, -- 'google', 'meta'
  source_campaign TEXT,
  source_url TEXT,
  source_form_data JSONB,

  -- Client info
  contact_id UUID REFERENCES contacts(id),
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT NOT NULL,
  preferred_language TEXT DEFAULT 'fr',
  date_of_birth DATE,

  -- Credit application fields (Fluent Form)
  vehicle_interest TEXT,
  monthly_budget TEXT,
  current_vehicle TEXT,
  employment_status TEXT,
  monthly_income INTEGER, -- cents
  income_timeframe TEXT,
  job_title TEXT,
  address TEXT,
  housing_status TEXT CHECK (housing_status IN ('rent', 'own', NULL)),
  monthly_housing INTEGER, -- cents
  address_length TEXT,

  -- Meta form fields
  income_threshold BOOLEAN,

  -- Scoring
  score INTEGER DEFAULT 0, -- 0-100
  score_factors JSONB DEFAULT '{}',

  -- Chatbot
  chatbot_engaged BOOLEAN DEFAULT false,
  chatbot_engaged_at TIMESTAMPTZ,
  chatbot_summary TEXT,
  chatbot_handoff_at TIMESTAMPTZ,

  -- Status
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'chatbot_engaged', 'assigned', 'contacted', 'qualified', 'converted', 'unresponsive', 'nurture', 'expired', 'lost')),

  -- Assignment
  assigned_to UUID REFERENCES users(id),
  assigned_at TIMESTAMPTZ,
  assignment_method TEXT,
  assignment_attempts INTEGER DEFAULT 0,
  previous_agents JSONB DEFAULT '[]',

  -- Contact tracking
  contact_attempts INTEGER DEFAULT 0,
  first_contacted_at TIMESTAMPTZ,
  last_contacted_at TIMESTAMPTZ,
  response_time_seconds INTEGER,

  -- Conversion
  converted_deal_id UUID REFERENCES deals(id),
  converted_at TIMESTAMPTZ,

  -- Lost
  lost_reason TEXT,
  lost_at TIMESTAMPTZ,

  -- Nurture
  nurture_drip_status TEXT DEFAULT 'none' CHECK (nurture_drip_status IN ('none', 'active', 'paused', 'opted_out', 'expired')),
  nurture_started_at TIMESTAMPTZ,
  nurture_expires_at TIMESTAMPTZ,
  nurture_last_sent_at TIMESTAMPTZ,

  -- Duplicate
  is_duplicate BOOLEAN DEFAULT false,
  duplicate_of UUID REFERENCES leads(id),

  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 2. Lead distribution config
CREATE TABLE IF NOT EXISTS lead_distribution_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id),
  platform TEXT NOT NULL, -- 'google', 'meta'
  contribution_amount INTEGER NOT NULL DEFAULT 0, -- cents
  contribution_percentage DECIMAL(5,2),
  month DATE NOT NULL,
  leads_received INTEGER DEFAULT 0,
  actual_percentage DECIMAL(5,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(store_id, platform, month)
);

-- 3. Staff schedules (for lead assignment)
CREATE TABLE IF NOT EXISTS staff_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Indexes
CREATE INDEX idx_leads_store ON leads(store_id);
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_assigned ON leads(assigned_to);
CREATE INDEX idx_leads_phone ON leads(phone);
CREATE INDEX idx_leads_source ON leads(source);
CREATE INDEX idx_leads_source_platform ON leads(source_platform);
CREATE INDEX idx_leads_deleted ON leads(deleted_at);
CREATE INDEX idx_lead_dist_store_month ON lead_distribution_config(store_id, platform, month);
CREATE INDEX idx_staff_schedules_user ON staff_schedules(user_id);

-- 5. RLS
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_distribution_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Leads viewable" ON leads FOR SELECT USING (true);
CREATE POLICY "Leads insertable" ON leads FOR INSERT WITH CHECK (true);
CREATE POLICY "Leads updatable" ON leads FOR UPDATE USING (true);
CREATE POLICY "Leads deletable" ON leads FOR DELETE USING (true);

CREATE POLICY "Lead dist viewable" ON lead_distribution_config FOR SELECT USING (true);
CREATE POLICY "Lead dist insertable" ON lead_distribution_config FOR INSERT WITH CHECK (true);
CREATE POLICY "Lead dist updatable" ON lead_distribution_config FOR UPDATE USING (true);

CREATE POLICY "Schedules viewable" ON staff_schedules FOR SELECT USING (true);
CREATE POLICY "Schedules insertable" ON staff_schedules FOR INSERT WITH CHECK (true);
CREATE POLICY "Schedules updatable" ON staff_schedules FOR UPDATE USING (true);
CREATE POLICY "Schedules deletable" ON staff_schedules FOR DELETE USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE leads;
