-- 0005 intake keys (F-03): per-store webhook credentials for inbound leads.
-- A key = a public `token` (in the URL, unguessable) + a `secret` used to
-- verify the HMAC signature on each POST (leads.md §10, api-design.md §10 —
-- generic_json scheme). Conventions per 0001: soft revoke, updated_at trigger,
-- RLS ENABLED+FORCED (org isolation + member SELECT), same-org composite FK.
--
-- The secret is symmetric (HMAC needs it to verify) so it is stored, like every
-- webhook-signing secret (Stripe/GitHub). The RDS instance is KMS-encrypted at
-- rest (D-013); column-level envelope encryption is a later hardening item.

CREATE TABLE intake_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  store_id        uuid NOT NULL,
  label           text NOT NULL CHECK (btrim(label) <> '' AND length(label) <= 100),
  provider        text NOT NULL DEFAULT 'generic_json'
                  CHECK (provider IN ('generic_json','fluent_form','meta','adf_email','chat_widget')),
  -- Lead source attributed to leads arriving through this key.
  default_source  text NOT NULL DEFAULT 'website'
                  CHECK (default_source IN ('fluent_form','meta_lead_form','manual','chatbot','website',
                                            'walk_in','phone','referral','repeat','service','instagram',
                                            'marketplace','google_ads','autotrader','cargurus','kijiji',
                                            'oem','appointment_promotion','other')),
  token           text NOT NULL UNIQUE CHECK (token ~ '^[A-Za-z0-9_-]{16,64}$'),
  secret          text NOT NULL,
  active          boolean NOT NULL DEFAULT true,
  last_used_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  FOREIGN KEY (organization_id, store_id) REFERENCES stores (organization_id, id)
);

CREATE INDEX idx_intake_keys_org ON intake_keys (organization_id, store_id) WHERE revoked_at IS NULL;

CREATE TRIGGER intake_keys_updated_at BEFORE UPDATE ON intake_keys
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE ON intake_keys TO dealpilot_app;

ALTER TABLE intake_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE intake_keys FORCE ROW LEVEL SECURITY;

CREATE POLICY intake_key_isolation ON intake_keys
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

CREATE POLICY intake_key_member_read ON intake_keys FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = intake_keys.organization_id
      AND m.status = 'active'
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  ));

-- Public-endpoint resolution: the intake POST has NO session/tenant context, so
-- it cannot satisfy the RLS policies above. This audited SECURITY DEFINER
-- function (owned by the migration role, runs bypassing RLS) returns ONLY the
-- fields the endpoint needs to verify a signature and place the lead, keyed on
-- the exact unguessable token. It is the sole cross-context read path — the
-- table's RLS is never broadened (indexing-and-rls.md §5/§6, the app_intake
-- pattern collapsed into one function for the single-service dev slice).
CREATE FUNCTION intake_resolve(p_token text)
RETURNS TABLE (organization_id uuid, store_id uuid, default_source text, secret text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  -- Only resolve when the key AND its store AND its org are all live, so the
  -- webhook can never place a lead into a closed/deleted store — matching the
  -- authenticated create path (requireLiveStore + org-liveness).
  SELECT k.organization_id, k.store_id, k.default_source, k.secret
  FROM intake_keys k
  JOIN stores s ON s.id = k.store_id AND s.deleted_at IS NULL AND s.status <> 'closed'
  JOIN organizations o ON o.id = k.organization_id AND o.deleted_at IS NULL
  WHERE k.token = p_token AND k.active = true AND k.revoked_at IS NULL;
$$;

REVOKE ALL ON FUNCTION intake_resolve(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION intake_resolve(text) TO dealpilot_app;
