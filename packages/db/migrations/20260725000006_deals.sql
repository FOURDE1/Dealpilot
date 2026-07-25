-- 0006 deals (F-05): the desking record — a worked deal attached to a lead.
-- Every money column is INTEGER CENTS (ADR-009). The stored *_cents outputs
-- are the engine's answer at save time (@dealpilot/core, A-06); recomputing is
-- always allowed, but a saved deal must reproduce exactly what the customer
-- was shown. Conventions per 0001/0004: soft delete, updated_at trigger, RLS
-- ENABLED+FORCED on app.org_id, member SELECT via app.user_id, same-org
-- composite FK to stores.

CREATE TABLE deals (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL,
  store_id             uuid NOT NULL,
  lead_id              uuid REFERENCES leads(id),
  status               text NOT NULL DEFAULT 'working'
                       CHECK (status IN ('working','submitted','approved','funded','delivered','lost')),
  deal_type            text NOT NULL DEFAULT 'finance' CHECK (deal_type IN ('finance','lease','cash')),
  province             text NOT NULL
                       CHECK (province IN ('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT')),

  -- inputs (what the desk manager typed)
  sale_price_cents     integer NOT NULL CHECK (sale_price_cents >= 0),
  msrp_cents           integer CHECK (msrp_cents >= 0),
  vehicle_cost_cents   integer NOT NULL DEFAULT 0 CHECK (vehicle_cost_cents >= 0),
  cash_down_cents      integer NOT NULL DEFAULT 0 CHECK (cash_down_cents >= 0),
  trade_allowance_cents integer NOT NULL DEFAULT 0 CHECK (trade_allowance_cents >= 0),
  trade_acv_cents      integer NOT NULL DEFAULT 0 CHECK (trade_acv_cents >= 0),
  trade_lien_cents     integer NOT NULL DEFAULT 0 CHECK (trade_lien_cents >= 0),
  rebate_cents         integer NOT NULL DEFAULT 0 CHECK (rebate_cents >= 0),
  fees_cents           integer NOT NULL DEFAULT 0 CHECK (fees_cents >= 0),
  fees_taxable         boolean NOT NULL DEFAULT false,
  fi_price_cents       integer NOT NULL DEFAULT 0 CHECK (fi_price_cents >= 0),
  fi_cost_cents        integer NOT NULL DEFAULT 0 CHECK (fi_cost_cents >= 0),
  interest_rate_bps    integer NOT NULL DEFAULT 0 CHECK (interest_rate_bps BETWEEN 0 AND 10000),
  term_months          integer NOT NULL DEFAULT 60 CHECK (term_months BETWEEN 1 AND 120),
  tax_exempt           boolean NOT NULL DEFAULT false,

  -- engine outputs, split per tax component (never a blended recompute)
  gst_cents            integer NOT NULL DEFAULT 0,
  pst_cents            integer NOT NULL DEFAULT 0,
  hst_cents            integer NOT NULL DEFAULT 0,
  tax_total_cents      integer NOT NULL DEFAULT 0,
  amount_financed_cents integer NOT NULL DEFAULT 0,
  monthly_payment_cents integer NOT NULL DEFAULT 0,
  front_gross_cents    integer NOT NULL DEFAULT 0,
  total_gross_cents    integer NOT NULL DEFAULT 0,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz,
  FOREIGN KEY (organization_id, store_id) REFERENCES stores (organization_id, id)
);

CREATE INDEX idx_deals_org_status ON deals (organization_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_deals_org_keyset ON deals (organization_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_deals_lead ON deals (lead_id) WHERE deleted_at IS NULL;

CREATE TRIGGER deals_updated_at BEFORE UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE ON deals TO dealpilot_app;

ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals FORCE ROW LEVEL SECURITY;

CREATE POLICY deal_isolation ON deals
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

CREATE POLICY deal_member_read ON deals FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = deals.organization_id
      AND m.status = 'active'
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  ));
