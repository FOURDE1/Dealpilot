-- 0045 — lead scoring (F-39, leads.md §6).
--
-- `leads.score` has been declared since the leads table existed, shown by
-- nothing, written by nothing — the longest-standing dead-vocabulary exemption
-- in the codebase. This is the storage for the rules engine that finally owns
-- it: configurable rules per organisation (global or per-store), a cached
-- score with its breakdown, and the leads column kept in sync so every list
-- that already selects * gets the number for free.

CREATE TABLE lead_scoring_rules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  /** NULL = global rule; a store's effective set is (store rules + global). */
  store_id         uuid,
  name             text NOT NULL CHECK (btrim(name) <> ''),

  -- The engine's vocabulary, mirrored from @dealpilot/core lead-scoring.ts and
  -- @dealpilot/schemas scoring.ts; scoring-vocabulary.test.ts holds the three
  -- in lockstep. Restricted to fields OUR leads table actually has (ADR-026
  -- divergence from the legacy list): a rule against a column nothing
  -- populates is a rule that silently never matches.
  field            text NOT NULL CHECK (field IN (
                     'source','source_platform','status','preferred_language','vehicle_interest',
                     'first_name','last_name','phone','email','trade_in_status','assigned_to',
                     'budget','has_phone','has_email','has_trade_in','created_days_ago')),
  operator         text NOT NULL CHECK (operator IN (
                     'gt','gte','lt','lte','eq','neq',
                     'contains','not_contains','exists','not_exists','in','not_in')),
  value            text,
  /** Signed: a rule may punish (going cold, unassigned). */
  score            integer NOT NULL CHECK (score BETWEEN -100 AND 100),
  is_active        boolean NOT NULL DEFAULT true,
  priority         integer NOT NULL DEFAULT 100 CHECK (priority BETWEEN 0 AND 1000),

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (organization_id, store_id) REFERENCES stores (organization_id, id),

  -- The engine fails closed on a comparison with no value, so storing one
  -- would be storing a rule that never fires. Refuse it at the door too.
  CHECK (operator IN ('exists','not_exists') OR value IS NOT NULL)
);

CREATE INDEX idx_scoring_rules_org
  ON lead_scoring_rules (organization_id, priority DESC) WHERE is_active;

CREATE TRIGGER lead_scoring_rules_updated_at BEFORE UPDATE ON lead_scoring_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Hard DELETE is granted here, unlike most tables: a scoring rule is CONFIG,
-- not a record of something that happened. Soft-off is is_active=false.
GRANT SELECT, INSERT, UPDATE, DELETE ON lead_scoring_rules TO dealpilot_app;

ALTER TABLE lead_scoring_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_scoring_rules FORCE  ROW LEVEL SECURITY;

CREATE POLICY scoring_rules_isolation ON lead_scoring_rules
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- Written on day one, not after the 404s: the D-046 class (0041/0043/0044).
CREATE POLICY scoring_rules_member_read ON lead_scoring_rules FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = lead_scoring_rules.organization_id
      AND m.status = 'active'
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  ));

/**
 * The score cache (§6.2 step 6): the number leads.score carries, plus the WHY
 * — every rule that moved it, so a screen can answer "why is this lead hot"
 * instead of asserting it.
 */
CREATE TABLE lead_scores (
  lead_id          uuid PRIMARY KEY,
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  score            integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  breakdown        jsonb NOT NULL DEFAULT '[]',
  scored_at        timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (organization_id, lead_id) REFERENCES leads (organization_id, id) ON DELETE CASCADE
);

GRANT SELECT, INSERT, UPDATE ON lead_scores TO dealpilot_app;

ALTER TABLE lead_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_scores FORCE  ROW LEVEL SECURITY;

CREATE POLICY lead_scores_isolation ON lead_scores
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

CREATE POLICY lead_scores_member_read ON lead_scores FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = lead_scores.organization_id
      AND m.status = 'active'
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  ));

COMMENT ON TABLE lead_scoring_rules IS
  'Configurable lead scoring (F-39, leads.md §6). Additive: every matching rule contributes; the engine clamps the sum to [0,100].';
COMMENT ON TABLE lead_scores IS
  'Score cache with breakdown. leads.score is synced from here so SELECT * lists get the number for free; this table answers WHY.';
