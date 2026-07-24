-- 0004 leads (F-02): the lead pipeline table. Vocabularies EXACTLY mirror
-- @dealpilot/schemas lead.ts (leads.md §2.1/§4). Conventions per 0001:
-- integer cents, soft delete, updated_at trigger, RLS ENABLED+FORCED keyed on
-- app.org_id, user-scoped member SELECT via app.user_id (0003 pattern),
-- same-org composite FK to stores (cross-org store poisoning impossible).

CREATE TABLE leads (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id),
  store_id           uuid NOT NULL,
  status             text NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new','chatbot_engaged','assigned','contacted','qualified',
                                       'converted','unresponsive','nurture','expired','lost')),
  first_name         text CHECK (btrim(first_name) <> '' AND length(first_name) <= 100),
  last_name          text CHECK (btrim(last_name) <> '' AND length(last_name) <= 100),
  email              text CHECK (email = lower(btrim(email)) AND position('@' IN email) > 1),
  -- The one required contact field (leads.md §1).
  phone              text NOT NULL CHECK (phone ~ '^\+1[0-9]{10}$'),
  source             text NOT NULL
                     CHECK (source IN ('fluent_form','meta_lead_form','manual','chatbot','website',
                                       'walk_in','phone','referral','repeat','service','instagram',
                                       'marketplace','google_ads','autotrader','cargurus','kijiji',
                                       'oem','appointment_promotion','other')),
  source_platform    text CHECK (source_platform IN ('google','meta','organic','oem','other')),
  preferred_language text NOT NULL DEFAULT 'fr-CA' CHECK (preferred_language IN ('fr-CA','en-CA')),
  assigned_to        uuid REFERENCES users(id),
  -- Rules-engine-owned (leads.md §6); the API never accepts it from clients.
  score              integer CHECK (score BETWEEN 0 AND 100),
  -- integer, not bigint: node-postgres returns int8 as a STRING (review 2026-07-24).
  budget_cents       integer CHECK (budget_cents >= 0),
  vehicle_interest   text CHECK (btrim(vehicle_interest) <> '' AND length(vehicle_interest) <= 200),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  FOREIGN KEY (organization_id, store_id) REFERENCES stores (organization_id, id)
);

CREATE INDEX idx_leads_org_status ON leads (organization_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_leads_org_store ON leads (organization_id, store_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_leads_org_keyset ON leads (organization_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;

CREATE TRIGGER leads_updated_at BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE ON leads TO dealpilot_app;
-- No DELETE grant: soft deletes only (ADR-009).

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads FORCE ROW LEVEL SECURITY;

CREATE POLICY lead_isolation ON leads
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

CREATE POLICY lead_member_read ON leads FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = leads.organization_id
      AND m.status = 'active'
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  ));
