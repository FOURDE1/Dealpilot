-- 0050 — weighted store distribution (F-45, FR-LEAD-007, leads.md §3, D-049).
--
-- The central queue and its ledger. Webhook leads may now arrive without a
-- store: an ORG-LEVEL intake key (store_id NULL — the dealer group's Meta or
-- Google lead forms) lands them in the central queue, and the running-tally
-- algorithm in @dealpilot/core deals them to the store furthest below its
-- ad-spend target. Google and Meta run separate splits, month by month.

/**
 * One row per (store, platform, month): what the store paid in, and what it
 * has received. contribution_percentage is derived from the platform total
 * whenever spend changes; actual_percentage whenever a lead is dealt — both
 * stored so the dashboard reads a ledger, not a formula.
 */
CREATE TABLE lead_distribution_config (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES organizations(id),
  store_id                uuid NOT NULL,
  platform                text NOT NULL CHECK (platform IN ('google','meta')),
  /** First of month, always — the CHECK makes a mid-month date unstorable. */
  month                   date NOT NULL CHECK (month = date_trunc('month', month)::date),
  contribution_amount_cents integer NOT NULL CHECK (contribution_amount_cents >= 0),
  contribution_percentage numeric(5,2) NOT NULL DEFAULT 0,
  leads_received          integer NOT NULL DEFAULT 0 CHECK (leads_received >= 0),
  actual_percentage       numeric(5,2) NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  UNIQUE (store_id, platform, month),
  /** Same-org store, enforced by the composite target (foundation.sql). */
  FOREIGN KEY (organization_id, store_id) REFERENCES stores (organization_id, id)
);

CREATE TRIGGER lead_distribution_config_updated_at BEFORE UPDATE ON lead_distribution_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_distribution_org_platform
  ON lead_distribution_config (organization_id, platform, month);

-- Config-shape grants: hard DELETE is fine (a wrong month's row is config,
-- not history — history lives in the leads the tally already dealt).
GRANT SELECT, INSERT, UPDATE, DELETE ON lead_distribution_config TO dealpilot_app;

ALTER TABLE lead_distribution_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_distribution_config FORCE  ROW LEVEL SECURITY;

CREATE POLICY distribution_isolation ON lead_distribution_config
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

/**
 * NO member_read, deliberately: the spec makes the distribution dashboard an
 * OWNER surface (leads.md:164), and ad spend per store is money data. Reads
 * go through the organization:update-gated routes (D-049).
 */

/** The central queue: a webhook lead may exist before any store owns it. */
ALTER TABLE leads ALTER COLUMN store_id DROP NOT NULL;

/** An org-level key is the dealer group's ad-platform front door. */
ALTER TABLE intake_keys ALTER COLUMN store_id DROP NOT NULL;

/**
 * intake_resolve learns about org-level keys: the store liveness check now
 * applies only WHEN the key names a store. Same SECURITY DEFINER shape as
 * 0029 (which this replaces), same audited path.
 */
DROP FUNCTION intake_resolve(text);

CREATE FUNCTION intake_resolve(p_token text)
RETURNS TABLE (organization_id uuid, store_id uuid, default_source text, secret text, connector_key text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT k.organization_id, k.store_id, k.default_source, k.secret, k.connector_key
  FROM intake_keys k
  JOIN organizations o ON o.id = k.organization_id AND o.deleted_at IS NULL
  LEFT JOIN stores s ON s.id = k.store_id
  WHERE k.token = p_token AND k.active = true AND k.revoked_at IS NULL
    AND (k.store_id IS NULL OR (s.id IS NOT NULL AND s.deleted_at IS NULL AND s.status <> 'closed'));
$$;

GRANT EXECUTE ON FUNCTION intake_resolve(text) TO dealpilot_app;

COMMENT ON TABLE lead_distribution_config IS
  'Monthly ad-spend split per store per platform (FR-LEAD-007). The running-tally engine in @dealpilot/core owns the algorithm; the intake route deals the lead inside the same transaction that created it.';
