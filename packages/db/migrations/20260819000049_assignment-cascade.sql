-- 0049 — assignment cascade data (F-42, FR-LEAD-009, leads.md §7.3, D-045).
--
-- Four changes with one purpose: give the post-handoff funnel something to
-- read. Agents get languages and a cap, staff get working hours, leads get an
-- assignment paper trail, and the history table learns the funnel's name.

/**
 * The agent profile — what they can SPEAK and how many leads they can carry —
 * lives on MEMBERSHIPS, not users, deliberately overriding the spec's
 * users-level directive (leads.md:263; D-045 #7 records why): the columns are
 * routing inputs, and a routing input on the global user row would let one
 * organization's admin silently reshape ANOTHER organization's assignment for
 * a shared agent (proven by live RLS probe in the 2026-08-19 F-42 review).
 * Org-scoped rows keep the write under the org that answers for it, in that
 * org's audit trail. A multi-store member has one row per store; the API
 * writes the profile across all of the user's rows in the org, so the value
 * is org-level in practice.
 *
 * Language default is fr-CA (Quebec-first — the spec's '{en}' loses to the
 * platform's own posture), backfilled from the user's own language_pref so
 * every existing agent starts able to serve leads in their own language.
 */
ALTER TABLE memberships
  ADD COLUMN preferred_languages text[] NOT NULL DEFAULT '{fr-CA}'
    CHECK (cardinality(preferred_languages) >= 1
           AND preferred_languages <@ ARRAY['fr-CA','en-CA']::text[]),
  /** §7.3 step 4 cap. 1–1000: zero would mean "assign nothing", and that job
      belongs to membership revocation, not a capacity knob. */
  ADD COLUMN max_active_leads integer NOT NULL DEFAULT 10
    CHECK (max_active_leads BETWEEN 1 AND 1000);

UPDATE memberships m SET preferred_languages = ARRAY[u.language_pref]
FROM users u WHERE u.id = m.user_id;

/**
 * The lead's assignment paper trail (schema-design.md:335, Target vocabulary
 * leads.md:41). assignment_method is NULLABLE on purpose: the §7.1 rules
 * engine has no name in the Target vocabulary and inventing one would be
 * vocabulary drift (D-045 #5). previous_agents is READ by the cascade now
 * (exclusion) and WRITTEN by the FR-LEAD-010 timer slice.
 */
ALTER TABLE leads
  ADD COLUMN assignment_method text
    CHECK (assignment_method IN
      ('auto_language','auto_availability','manual','escalation','reassignment')),
  ADD COLUMN assignment_attempts integer NOT NULL DEFAULT 0
    CHECK (assignment_attempts >= 0),
  ADD COLUMN previous_agents jsonb NOT NULL DEFAULT '[]';

/**
 * Weekly working hours (FR-LEAD-015, schema-design.md §staff_schedules),
 * feeding §7.3 step 3. Rows anchor to a STORE because a TIME means nothing
 * without that store's timezone. Same-day windows only (end > start); a split
 * shift is two rows; a user with no active rows is always-available — the
 * grid is opt-in until its UI ships (D-045 #8).
 */
CREATE TABLE staff_schedules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  store_id        uuid NOT NULL,
  user_id         uuid NOT NULL REFERENCES users(id),
  /** 0 = Sunday … 6 = Saturday, matching EXTRACT(DOW). */
  day_of_week     integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time      time NOT NULL,
  end_time        time NOT NULL,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CHECK (end_time > start_time),
  /** Same-org store, enforced by the composite target (foundation.sql). */
  FOREIGN KEY (organization_id, store_id) REFERENCES stores (organization_id, id)
);

CREATE TRIGGER staff_schedules_updated_at BEFORE UPDATE ON staff_schedules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_staff_schedules_user
  ON staff_schedules (organization_id, user_id, day_of_week) WHERE active;

-- Config-shape grants: hard DELETE is fine, soft-off is `active`.
GRANT SELECT, INSERT, UPDATE, DELETE ON staff_schedules TO dealpilot_app;

ALTER TABLE staff_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_schedules FORCE  ROW LEVEL SECURITY;

CREATE POLICY staff_schedules_isolation ON staff_schedules
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

/** The grid is for everyone on the team to see — who works when is not a secret. */
CREATE POLICY staff_schedules_member_read ON staff_schedules FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = staff_schedules.organization_id
      AND m.status = 'active'
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  ));

/**
 * The history table learns the funnel's name. The RULES check is deliberately
 * untouched — a rule cannot BE the cascade (D-045 #9); only history rows may
 * say 'cascade'.
 */
ALTER TABLE lead_assignment_history
  DROP CONSTRAINT lead_assignment_history_strategy_check,
  ADD CONSTRAINT lead_assignment_history_strategy_check
    CHECK (strategy IN ('round_robin','load_balanced','source_based','cascade'));

/**
 * One new permission: schedule:manage (owner, gm, sales_manager,
 * admin_office). New organizations get it from the catalogue defaults at
 * creation; this seeds every organization that already exists — the same
 * shape as 0022's original seed.
 */
INSERT INTO role_permissions (organization_id, role, permission)
SELECT o.id, d.role, d.permission
FROM organizations o
CROSS JOIN (VALUES
  ('owner','schedule:manage'),
  ('gm','schedule:manage'),
  ('sales_manager','schedule:manage'),
  ('admin_office','schedule:manage')
) AS d(role, permission)
ON CONFLICT DO NOTHING;

COMMENT ON TABLE staff_schedules IS
  'Weekly working hours per user per store (FR-LEAD-015), read by the §7.3 cascade in @dealpilot/core. Times are in the store''s timezone.';
