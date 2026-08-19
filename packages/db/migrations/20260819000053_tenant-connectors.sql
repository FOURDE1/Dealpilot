-- 0053 — tenant connectors (F-49, FR-LEAD-019, leads.md §2.3, D-053).
--
-- Connectors stop being code. A connector is a per-tenant CONFIG record —
-- what the provider calls its fields, what leads.source its arrivals wear,
-- and what that form's consent box actually granted — so adding a lead
-- provider is a row an admin writes, not a deploy. The built-in presets
-- (website_form, meta_lead_ads, adf_xml) remain as the floor every tenant
-- starts from; a tenant row with the same resolution key would be a trap,
-- so built-in keys are refused at the API.

CREATE TABLE tenant_connectors (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  /** The resolution key intake_keys.connector_key points at. */
  source_key      text NOT NULL CHECK (source_key ~ '^[a-z0-9_]{2,40}$'),
  label           text NOT NULL CHECK (btrim(label) <> ''),
  /** api_poll (the spec's third type) arrives with its first polling provider. */
  type            text NOT NULL CHECK (type IN ('json_webhook','adf_xml')),
  /** What leads.source becomes — same vocabulary as the leads CHECK. */
  default_source  text NOT NULL
                  CHECK (default_source IN ('fluent_form','meta_lead_form','manual','chatbot','website',
                                            'walk_in','phone','referral','repeat','service','instagram',
                                            'marketplace','google_ads','autotrader','cargurus','kijiji',
                                            'oem','appointment_promotion','other')),
  /** Canonical field → provider paths; first non-empty path wins. */
  field_map       jsonb NOT NULL DEFAULT '{}',
  /** The form's CASL basis: checkbox/wording paths + what a tick granted. */
  consent         jsonb,
  dedupe_fields   text[] NOT NULL DEFAULT '{phone,email}',
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, source_key)
);

CREATE TRIGGER tenant_connectors_updated_at BEFORE UPDATE ON tenant_connectors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_tenant_connectors_org
  ON tenant_connectors (organization_id, source_key) WHERE is_active;

-- Config-shape grants: hard DELETE is fine, soft-off is is_active.
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_connectors TO dealpilot_app;

ALTER TABLE tenant_connectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_connectors FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_connectors_isolation ON tenant_connectors
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

/** Same accepted-risk family as the assignment/scoring config: member-readable. */
CREATE POLICY tenant_connectors_member_read ON tenant_connectors FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = tenant_connectors.organization_id
      AND m.status = 'active'
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  ));

COMMENT ON TABLE tenant_connectors IS
  'Per-tenant intake connectors (FR-LEAD-019): configuration, not code. Resolution in the intake webhook prefers a tenant row over the built-in preset of the same key; built-in keys are reserved.';
