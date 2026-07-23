-- ============================================
-- CONTACTS TABLE — Independent Customer Records
-- Foundation Story F-003
-- ============================================

-- 1. Create contacts table
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  phone_normalized TEXT, -- stripped digits only, for duplicate detection

  -- Address
  address TEXT,
  city TEXT,
  province TEXT,
  postal_code TEXT,

  -- Personal
  driver_license TEXT,
  employer TEXT,
  date_of_birth DATE,

  -- Compliance
  preferred_language TEXT NOT NULL DEFAULT 'fr' CHECK (preferred_language IN ('en', 'fr')),
  marketing_consent BOOLEAN DEFAULT false,
  consent_date TIMESTAMPTZ,

  -- Relationship tracking
  source TEXT CHECK (source IN ('walk_in', 'phone', 'web', 'referral', 'repeat', 'other')),
  customer_since TIMESTAMPTZ DEFAULT now(),
  lifetime_deals INTEGER DEFAULT 0,
  lifetime_value DECIMAL(12,2) DEFAULT 0,
  notes TEXT,

  -- Full-text search vector
  search_vector TSVECTOR,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- 2. Auto-update updated_at trigger
CREATE TRIGGER contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- 3. Auto-generate search_vector on insert/update
CREATE OR REPLACE FUNCTION contacts_search_vector_update()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', coalesce(NEW.first_name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.last_name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.email, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.phone, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.phone_normalized, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.city, '')), 'C') ||
    setweight(to_tsvector('simple', coalesce(NEW.employer, '')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contacts_search_vector
  BEFORE INSERT OR UPDATE ON contacts
  FOR EACH ROW
  EXECUTE FUNCTION contacts_search_vector_update();

-- 4. Auto-normalize phone on insert/update
CREATE OR REPLACE FUNCTION contacts_normalize_phone()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.phone IS NOT NULL THEN
    NEW.phone_normalized := regexp_replace(NEW.phone, '[^0-9]', '', 'g');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contacts_phone_normalize
  BEFORE INSERT OR UPDATE ON contacts
  FOR EACH ROW
  EXECUTE FUNCTION contacts_normalize_phone();

-- 5. Indexes
CREATE INDEX idx_contacts_search_vector ON contacts USING GIN (search_vector);
CREATE INDEX idx_contacts_phone_normalized ON contacts(phone_normalized);
CREATE INDEX idx_contacts_email ON contacts(email);
CREATE INDEX idx_contacts_name ON contacts(last_name, first_name);
CREATE INDEX idx_contacts_deleted_at ON contacts(deleted_at);

-- 6. Deal-Contact relationship (join table)
CREATE TABLE deal_parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('buyer', 'cosigner')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(deal_id, contact_id, role)
);

CREATE INDEX idx_deal_parties_deal_id ON deal_parties(deal_id);
CREATE INDEX idx_deal_parties_contact_id ON deal_parties(contact_id);

-- 7. Add contact_id FK to deals table
ALTER TABLE deals ADD COLUMN contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;
CREATE INDEX idx_deals_contact_id ON deals(contact_id);

-- 8. RLS for contacts
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_parties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Contacts are viewable by all authenticated users"
  ON contacts FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert contacts"
  ON contacts FOR INSERT WITH CHECK (true);
CREATE POLICY "Authenticated users can update contacts"
  ON contacts FOR UPDATE USING (true);
CREATE POLICY "Authenticated users can delete contacts"
  ON contacts FOR DELETE USING (true);

CREATE POLICY "Deal parties are viewable by all authenticated users"
  ON deal_parties FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert deal parties"
  ON deal_parties FOR INSERT WITH CHECK (true);
CREATE POLICY "Authenticated users can update deal parties"
  ON deal_parties FOR UPDATE USING (true);
CREATE POLICY "Authenticated users can delete deal parties"
  ON deal_parties FOR DELETE USING (true);

-- 9. Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE contacts;

-- 10. Data migration: parse existing customer_name into contacts
-- This creates a contact for each unique customer_name in deals
-- and links them via deal_parties + contact_id
DO $$
DECLARE
  deal_record RECORD;
  contact_record RECORD;
  first TEXT;
  last TEXT;
  name_parts TEXT[];
BEGIN
  FOR deal_record IN
    SELECT id, customer_name, customer_phone, customer_address,
           cosigner_name, has_cosigner
    FROM deals
    WHERE customer_name IS NOT NULL AND customer_name != ''
  LOOP
    -- Parse name: split on first space
    name_parts := string_to_array(trim(deal_record.customer_name), ' ');
    first := name_parts[1];
    last := CASE
      WHEN array_length(name_parts, 1) > 1
      THEN array_to_string(name_parts[2:], ' ')
      ELSE ''
    END;

    -- Check for existing contact by phone (if available) or name
    IF deal_record.customer_phone IS NOT NULL AND deal_record.customer_phone != '' THEN
      SELECT * INTO contact_record FROM contacts
        WHERE phone_normalized = regexp_replace(deal_record.customer_phone, '[^0-9]', '', 'g')
        LIMIT 1;
    END IF;

    IF contact_record IS NULL THEN
      SELECT * INTO contact_record FROM contacts
        WHERE first_name = first AND last_name = last
        LIMIT 1;
    END IF;

    -- Create contact if not found
    IF contact_record IS NULL THEN
      INSERT INTO contacts (first_name, last_name, phone, address)
      VALUES (first, last, deal_record.customer_phone, deal_record.customer_address)
      RETURNING * INTO contact_record;
    END IF;

    -- Link deal to contact
    UPDATE deals SET contact_id = contact_record.id WHERE id = deal_record.id;

    -- Create deal_party for buyer
    INSERT INTO deal_parties (deal_id, contact_id, role)
    VALUES (deal_record.id, contact_record.id, 'buyer')
    ON CONFLICT (deal_id, contact_id, role) DO NOTHING;

    -- Handle cosigner
    IF deal_record.has_cosigner AND deal_record.cosigner_name IS NOT NULL
       AND deal_record.cosigner_name != '' THEN
      DECLARE
        cosigner_parts TEXT[];
        cosigner_first TEXT;
        cosigner_last TEXT;
        cosigner_contact RECORD;
      BEGIN
        cosigner_parts := string_to_array(trim(deal_record.cosigner_name), ' ');
        cosigner_first := cosigner_parts[1];
        cosigner_last := CASE
          WHEN array_length(cosigner_parts, 1) > 1
          THEN array_to_string(cosigner_parts[2:], ' ')
          ELSE ''
        END;

        SELECT * INTO cosigner_contact FROM contacts
          WHERE first_name = cosigner_first AND last_name = cosigner_last
          LIMIT 1;

        IF cosigner_contact IS NULL THEN
          INSERT INTO contacts (first_name, last_name)
          VALUES (cosigner_first, cosigner_last)
          RETURNING * INTO cosigner_contact;
        END IF;

        INSERT INTO deal_parties (deal_id, contact_id, role)
        VALUES (deal_record.id, cosigner_contact.id, 'cosigner')
        ON CONFLICT (deal_id, contact_id, role) DO NOTHING;
      END;
    END IF;
  END LOOP;
END;
$$;
