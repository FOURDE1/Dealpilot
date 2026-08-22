-- 0063 — the marketing spend ledger (F-65, expenses-accounting.md §10).
--
-- One row per (source, month, store): what the tenant paid that month to
-- make that source ring. INTEGER CENTS — the legacy stored dollars here and
-- its own gap table calls the resulting unit-mixing a hazard (§11 #8);
-- ADR-009 is cents everywhere and this table is no exception. Store NULL =
-- org-wide spend; NULLS NOT DISTINCT so "org-wide May facebook" is as
-- unique as any store's row.

CREATE TABLE source_costs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  store_id         uuid,
  source           text NOT NULL CHECK (btrim(source) <> ''),
  /** First-of-month, always — the CHECK makes 'May' a value, not a range. */
  month            date NOT NULL CHECK (month = date_trunc('month', month)::date),
  spend_cents      integer NOT NULL DEFAULT 0 CHECK (spend_cents >= 0),
  notes            text,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (organization_id, store_id) REFERENCES stores (organization_id, id),
  UNIQUE NULLS NOT DISTINCT (organization_id, source, month, store_id)
);

CREATE TRIGGER source_costs_updated_at BEFORE UPDATE ON source_costs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_source_costs_org_month ON source_costs (organization_id, month DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON source_costs TO dealpilot_app;

ALTER TABLE source_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_costs FORCE  ROW LEVEL SECURITY;

CREATE POLICY source_costs_isolation ON source_costs
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
CREATE POLICY source_costs_member_read ON source_costs FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = source_costs.organization_id
      AND m.status = 'active'
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  ));

COMMENT ON TABLE source_costs IS
  'Monthly marketing spend per source (expenses-accounting.md §10) — integer cents (ADR-009), the input side of source ROI.';
