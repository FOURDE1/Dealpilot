-- 0038 — contacts, the customer master (FR-CON).
--
-- A dealership CRM has not had a customer record. Leads are enquiries and deals
-- are transactions; neither is the person. The same customer buying twice has
-- been two unrelated rows, and "have we sold to them before?" has been
-- unanswerable.
--
-- WHAT IS DELIBERATELY ABSENT: date of birth, driver's licence number, SIN,
-- income, and banking details. FR-CON-001 lists them and FR-CON-007 (P0) says
-- they must be AES-256-GCM envelope-encrypted with per-tenant KMS data keys and
-- blind HMAC indexes (ADR-015). No KMS key is provisioned — the owner has not
-- authorised paid AWS — so the honest options were to store the most sensitive
-- PII a dealership holds in plaintext, or to leave the columns out.
--
-- They are left out, and `contacts-pii.test.ts` fails the build if any of them
-- appears here before the encryption exists. "We will encrypt it later" is how
-- a plaintext SIN column reaches production.

CREATE TABLE contacts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id),
  /** Which rooftop owns the relationship. Nullable: a group-level customer. */
  store_id          uuid,

  first_name        text CHECK (first_name IS NULL OR btrim(first_name) <> ''),
  last_name         text CHECK (last_name IS NULL OR btrim(last_name) <> ''),
  email             text CHECK (email IS NULL OR position('@' in email) > 1),
  phone             text CHECK (phone ~ '^\+1[0-9]{10}$'),
  phone_alt         text CHECK (phone_alt IS NULL OR phone_alt ~ '^\+1[0-9]{10}$'),

  address_line1     text CHECK (length(address_line1) <= 200),
  city              text CHECK (length(city) <= 100),
  province          text CHECK (province IS NULL OR province IN
                      ('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT')),
  postal_code       text CHECK (postal_code IS NULL OR postal_code ~ '^[A-Z][0-9][A-Z] [0-9][A-Z][0-9]$'),

  employer          text CHECK (length(employer) <= 200),

  -- Bill 96 / ADR-019: French unless somebody says otherwise.
  preferred_language text NOT NULL DEFAULT 'fr-CA' CHECK (preferred_language IN ('fr-CA','en-CA')),
  preferred_contact  text NOT NULL DEFAULT 'text' CHECK (preferred_contact IN ('text','email','phone')),

  tags              text[] NOT NULL DEFAULT '{}',
  source            text CHECK (length(source) <= 60),
  referred_by_contact_id uuid,

  /**
   * PIPEDA marketing consent (FR-CON-002).
   *
   * Default FALSE and NOT NULL, because an absent answer is not a yes. Note
   * this is the CONTACT's marketing flag and is NOT the consent the send gate
   * reads — that lives in `consent_ledger`, per channel, per scope, with
   * evidence. Two records, deliberately: this one is what the customer told a
   * salesperson, and the ledger is what the platform can prove.
   */
  consent_marketing     boolean NOT NULL DEFAULT false,
  consent_marketing_at  timestamptz,

  /** The first time they did business here. Kept oldest on a merge. */
  customer_since    timestamptz,

  deleted_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (organization_id, store_id) REFERENCES stores (organization_id, id),
  FOREIGN KEY (organization_id, referred_by_contact_id) REFERENCES contacts (organization_id, id),
  UNIQUE (organization_id, id),

  -- A consent date without consent, or consent without a date, is a record
  -- nobody can rely on in an audit.
  CHECK (consent_marketing = (consent_marketing_at IS NOT NULL))
);

/**
 * Weighted search (FR-CON-004): name A, email and phone B, city C.
 *
 * Generated rather than trigger-maintained — a trigger is a second place the
 * vector can fall out of step with the row, and this codebase has already paid
 * for that class of bug more than once.
 */
ALTER TABLE contacts ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(first_name,'') || ' ' || coalesce(last_name,'')), 'A') ||
    setweight(to_tsvector('simple', coalesce(email,'') || ' ' || coalesce(phone,'')), 'B') ||
    setweight(to_tsvector('simple', coalesce(city,'')), 'C')
  ) STORED;

CREATE INDEX idx_contacts_search ON contacts USING GIN (search_vector);

-- Duplicate detection (FR-CON-003) reads these, so they are indexed rather
-- than scanned: a dealership with 40,000 contacts checks on every create.
CREATE INDEX idx_contacts_phone ON contacts (organization_id, phone) WHERE deleted_at IS NULL;
CREATE INDEX idx_contacts_email ON contacts (organization_id, lower(email)) WHERE deleted_at IS NULL;
CREATE INDEX idx_contacts_recent ON contacts (organization_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE TRIGGER contacts_updated_at BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE ON contacts TO dealpilot_app;

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts FORCE  ROW LEVEL SECURITY;

CREATE POLICY contacts_isolation ON contacts
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- The activity vocabulary gains it (forward-only; 0037 last set it).
ALTER TABLE activity_events DROP CONSTRAINT activity_events_entity_type_check;
ALTER TABLE activity_events ADD CONSTRAINT activity_events_entity_type_check
  CHECK (entity_type IN ('deal','lead','vehicle','membership','pay_plan',
                         'checklist_item','checklist_template','intake_key',
                         'invitation','dispatch_assignment','deal_document',
                         'deal_fi_product','tenant_branding','consent','suppression',
                         'internal_dnc','conversation','appointment','contact',
                         'organization','store'));

ALTER TABLE activity_events DROP CONSTRAINT activity_events_parent_entity_type_check;
ALTER TABLE activity_events ADD CONSTRAINT activity_events_parent_entity_type_check
  CHECK (parent_entity_type IS NULL OR parent_entity_type IN
         ('deal','lead','vehicle','membership','pay_plan',
          'checklist_item','checklist_template','intake_key',
          'invitation','dispatch_assignment','deal_document',
          'deal_fi_product','tenant_branding','consent','suppression',
          'internal_dnc','conversation','appointment','contact',
          'organization','store'));

COMMENT ON TABLE contacts IS
  'The customer master (FR-CON). High-sensitivity PII — DOB, licence, SIN, income, banking — is deliberately absent until ADR-015 field encryption exists; contacts-pii.test.ts enforces that.';
COMMENT ON COLUMN contacts.consent_marketing IS
  'What the customer told a salesperson. NOT what the send gate reads — that is consent_ledger, per channel, with evidence.';
