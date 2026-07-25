-- 0011 commissions (F-09): pay plans per team member, and the commission lines
-- a funded deal produces. The MATH already exists and is golden-tested
-- (packages/core, A-06) — this is the data it runs on (commissions-clawbacks.md §11).
--
-- Two audited legacy defects are structurally impossible here:
--   * the "$1,500 pad became $15" split-brain — every money column is INTEGER
--     CENTS (ADR-009), pad included;
--   * "overrides never pay" — an override is a row on the RECEIVER's plan
--     (`override_on_user_id`), so paying them never depends on the seller's
--     own record (the legacy bug was reading the wrong side of that link).

CREATE TABLE pay_plans (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL,
  -- One plan per person per org; store_id NULL = applies at every store.
  user_id               uuid NOT NULL REFERENCES users(id),
  store_id              uuid,

  commission_rate       numeric(5,4) NOT NULL CHECK (commission_rate BETWEEN 0 AND 1),
  has_pad               boolean NOT NULL DEFAULT false,
  pad_cents             integer NOT NULL DEFAULT 0 CHECK (pad_cents >= 0),

  has_tiered_rate       boolean NOT NULL DEFAULT false,
  tier_threshold_cents  integer CHECK (tier_threshold_cents >= 0),
  tier_rate             numeric(5,4) CHECK (tier_rate BETWEEN 0 AND 1),

  -- Override: THIS person earns `override_rate` on that person's funded deals.
  override_on_user_id   uuid REFERENCES users(id),
  override_rate         numeric(5,4) CHECK (override_rate BETWEEN 0 AND 1),

  active                boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  UNIQUE NULLS NOT DISTINCT (organization_id, user_id, store_id),
  FOREIGN KEY (organization_id, store_id) REFERENCES stores (organization_id, id),
  -- A tier is meaningless without both of its numbers.
  CHECK (NOT has_tiered_rate OR (tier_threshold_cents IS NOT NULL AND tier_rate IS NOT NULL)),
  -- An override needs both the person and the rate.
  CHECK ((override_on_user_id IS NULL) = (override_rate IS NULL))
);

CREATE INDEX idx_pay_plans_org_user ON pay_plans (organization_id, user_id) WHERE active;
CREATE INDEX idx_pay_plans_override ON pay_plans (organization_id, override_on_user_id) WHERE active AND override_on_user_id IS NOT NULL;

CREATE TRIGGER pay_plans_updated_at BEFORE UPDATE ON pay_plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One line per person paid on a deal: the seller, plus a line for each
-- overrider. Immutable once written; corrections are new (negative) lines.
CREATE TABLE commissions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL,
  deal_id               uuid NOT NULL REFERENCES deals(id),
  user_id               uuid NOT NULL REFERENCES users(id),
  kind                  text NOT NULL CHECK (kind IN ('sale', 'override', 'clawback')),

  -- The inputs the amount came from, kept so a statement can be explained
  -- years later without re-deriving it from a deal that may have moved on.
  total_gross_cents     integer NOT NULL,
  gross_for_commission_cents integer NOT NULL,
  applied_rate          numeric(5,4) NOT NULL,
  amount_cents          integer NOT NULL,

  /** The pay period this line belongs to — always the deal's funded_at. */
  funded_at             timestamptz NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),

  -- Exactly one line per person per kind per deal: the funding trigger is
  -- idempotent, so re-running it can never double-pay.
  UNIQUE (deal_id, user_id, kind)
);

CREATE INDEX idx_commissions_org_user_period ON commissions (organization_id, user_id, funded_at DESC);
CREATE INDEX idx_commissions_deal ON commissions (deal_id);

GRANT SELECT, INSERT, UPDATE ON pay_plans TO dealpilot_app;
GRANT SELECT, INSERT ON commissions TO dealpilot_app;
-- Commission lines are never edited or deleted: corrections are new rows.

ALTER TABLE pay_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE pay_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE commissions FORCE ROW LEVEL SECURITY;

CREATE POLICY pay_plan_isolation ON pay_plans
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

CREATE POLICY commission_isolation ON commissions
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- Pay is personal: a member reads their OWN lines under user scope; managers
-- read the whole org through tenant scope (the isolation policy above).
CREATE POLICY commission_self_read ON commissions FOR SELECT
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

CREATE POLICY pay_plan_self_read ON pay_plans FOR SELECT
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- Who sold it. Nullable: a deal can be desked before it is credited.
ALTER TABLE deals
  ADD COLUMN salesperson_id uuid REFERENCES users(id),
  ADD COLUMN fi_reserve_cents integer NOT NULL DEFAULT 0 CHECK (fi_reserve_cents >= 0);

CREATE INDEX idx_deals_salesperson ON deals (salesperson_id) WHERE deleted_at IS NULL;
