-- 0055 — lost reasons (F-53, leads.md §11, ADR-026).
--
-- Losing a lead is a fact worth a WHY: the reason drives win/loss analytics
-- and, later, the lost-reason-specific re-engagement drip (§10.3). Reasons
-- are tenant CONFIG — nine bilingual defaults every organization starts
-- from (Bill 96: name_fr is NOT NULL here, not the legacy's nullable
-- afterthought), org-wide when store_id is NULL, extendable per tenant.

CREATE TABLE lost_reasons (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  /** NULL = org-wide; a store row narrows the pick-list for that store. */
  store_id        uuid,
  name            text NOT NULL CHECK (btrim(name) <> ''),
  name_fr         text NOT NULL CHECK (btrim(name_fr) <> ''),
  icon            text NOT NULL DEFAULT '📝' CHECK (char_length(icon) BETWEEN 1 AND 8),
  display_order   integer NOT NULL DEFAULT 0 CHECK (display_order BETWEEN 0 AND 999),
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, name),
  -- House composite FK: a store reference can only name a store of the SAME
  -- organization (FK checks bypass RLS, so the bare form would accept a
  -- rival's store id).
  FOREIGN KEY (organization_id, store_id) REFERENCES stores (organization_id, id)
);

CREATE TRIGGER lost_reasons_updated_at BEFORE UPDATE ON lost_reasons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_lost_reasons_org
  ON lost_reasons (organization_id, display_order) WHERE is_active;

-- Config-shape grants: hard DELETE allowed while unreferenced, soft-off is is_active.
GRANT SELECT, INSERT, UPDATE, DELETE ON lost_reasons TO dealpilot_app;

ALTER TABLE lost_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE lost_reasons FORCE  ROW LEVEL SECURITY;

CREATE POLICY lost_reasons_isolation ON lost_reasons
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

/** Same accepted-risk family as the other config vocabularies: member-readable. */
CREATE POLICY lost_reasons_member_read ON lost_reasons FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = lost_reasons.organization_id
      AND m.status = 'active'
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  ));

-- The lead carries its loss: WHY (FK) and, optionally, in whose words.
ALTER TABLE leads
  ADD COLUMN lost_reason_id   uuid REFERENCES lost_reasons(id),
  ADD COLUMN lost_reason_note text CHECK (lost_reason_note IS NULL OR char_length(lost_reason_note) <= 500);

CREATE INDEX idx_leads_lost_reason ON leads (lost_reason_id) WHERE lost_reason_id IS NOT NULL;

-- Backfill: organizations created BEFORE this migration get the nine
-- defaults here; organizations created after get them at creation (F-01
-- provisioning, canonical list in @dealpilot/core). This copy is frozen
-- history — divergence from the code list after today is expected.
INSERT INTO lost_reasons (organization_id, name, name_fr, icon, display_order)
SELECT o.id, d.name, d.name_fr, d.icon, d.ord
FROM organizations o
CROSS JOIN (VALUES
  ('Price too high',   'Prix trop élevé',        '💰', 1),
  ('Chose competitor', 'A choisi un concurrent', '🏪', 2),
  ('Bad timing',       'Mauvais moment',         '⏰', 3),
  ('No response',      'Aucune réponse',         '📵', 4),
  ('Changed mind',     'A changé d''avis',       '🔄', 5),
  ('Found elsewhere',  'Trouvé ailleurs',        '🔍', 6),
  ('Financing denied', 'Financement refusé',     '🏦', 7),
  ('Just browsing',    'Juste en exploration',   '👀', 8),
  ('Other',            'Autre',                  '📝', 9)
) AS d(name, name_fr, icon, ord);

COMMENT ON TABLE lost_reasons IS
  'Tenant lost-reason vocabulary (leads.md §11): nine bilingual defaults provisioned per organization, extendable; marking a lead lost requires one.';
