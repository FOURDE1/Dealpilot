-- 0046 — lead assignment (F-40, leads.md §7).
--
-- Scoring (0045) decides how WARM a lead is; this decides WHO answers it.
-- Three tables because they have three different truths: rules are config,
-- state is one cursor per round-robin rule, and history is an append-only
-- audit of every automatic decision — who got the lead, under which rule,
-- which strategy, so "why did Marc get this one" is a query, not a shrug.

CREATE TABLE lead_assignment_rules (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id),
  name               text NOT NULL CHECK (btrim(name) <> ''),
  strategy           text NOT NULL DEFAULT 'round_robin'
                     CHECK (strategy IN ('round_robin','load_balanced','source_based')),
  is_active          boolean NOT NULL DEFAULT true,
  /** ASCENDING — lower number checked first (§7.1). The OPPOSITE of scoring. */
  priority           integer NOT NULL DEFAULT 1 CHECK (priority BETWEEN 0 AND 1000),
  /** Empty = catch-all. */
  sources            text[] NOT NULL DEFAULT '{}',
  /** Empty = every active member. */
  included_users     uuid[] NOT NULL DEFAULT '{}',
  excluded_users     uuid[] NOT NULL DEFAULT '{}',
  /** {source: user_id} for source_based. */
  source_mappings    jsonb NOT NULL DEFAULT '{}',
  /** 0 = unlimited. Cap on ACTIVE (non-terminal) assigned leads. */
  max_leads_per_user integer NOT NULL DEFAULT 0 CHECK (max_leads_per_user BETWEEN 0 AND 1000),

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_assignment_rules_org
  ON lead_assignment_rules (organization_id, priority) WHERE is_active;

CREATE TRIGGER lead_assignment_rules_updated_at BEFORE UPDATE ON lead_assignment_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Config, like scoring rules: hard DELETE granted, soft-off is is_active.
GRANT SELECT, INSERT, UPDATE, DELETE ON lead_assignment_rules TO dealpilot_app;

ALTER TABLE lead_assignment_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_assignment_rules FORCE  ROW LEVEL SECURITY;

CREATE POLICY assignment_rules_isolation ON lead_assignment_rules
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

CREATE POLICY assignment_rules_member_read ON lead_assignment_rules FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = lead_assignment_rules.organization_id
      AND m.status = 'active'
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  ));

/**
 * One cursor per round-robin rule (§7.1), seeded −1 so the first pick is
 * index 0. Deleted with its rule — a cursor without a rule points at nothing.
 */
CREATE TABLE lead_assignment_state (
  rule_id             uuid PRIMARY KEY REFERENCES lead_assignment_rules(id) ON DELETE CASCADE,
  organization_id     uuid NOT NULL REFERENCES organizations(id),
  last_assigned_index integer NOT NULL DEFAULT -1
);

GRANT SELECT, INSERT, UPDATE ON lead_assignment_state TO dealpilot_app;

ALTER TABLE lead_assignment_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_assignment_state FORCE  ROW LEVEL SECURITY;

CREATE POLICY assignment_state_isolation ON lead_assignment_state
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

/**
 * Append-only: INSERT and SELECT, no UPDATE, no DELETE — the same grant shape
 * as activity_events, for the same reason. An assignment audit that can be
 * rewritten is not an audit.
 */
CREATE TABLE lead_assignment_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  lead_id         uuid NOT NULL,
  assigned_to     uuid NOT NULL REFERENCES users(id),
  rule_id         uuid,
  rule_name       text NOT NULL,
  strategy        text NOT NULL CHECK (strategy IN ('round_robin','load_balanced','source_based')),
  lead_source     text NOT NULL,
  assigned_at     timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (organization_id, lead_id) REFERENCES leads (organization_id, id)
);

CREATE INDEX idx_assignment_history_lead
  ON lead_assignment_history (organization_id, lead_id, assigned_at DESC);

GRANT SELECT, INSERT ON lead_assignment_history TO dealpilot_app;

ALTER TABLE lead_assignment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_assignment_history FORCE  ROW LEVEL SECURITY;

CREATE POLICY assignment_history_isolation ON lead_assignment_history
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

CREATE POLICY assignment_history_member_read ON lead_assignment_history FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = lead_assignment_history.organization_id
      AND m.status = 'active'
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  ));

COMMENT ON TABLE lead_assignment_rules IS
  'Who answers a new lead (F-40, leads.md §7). One rule wins (priority ASC, first source match); the engine in @dealpilot/core owns the algorithm.';
COMMENT ON TABLE lead_assignment_history IS
  'Append-only audit of automatic assignments — "why did Marc get this one" is a query, not a shrug.';
