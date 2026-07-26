-- 0014 activity events (F-10) — the append-only audit trail ADR-009 has
-- required since day one and nine features have shipped without.
--
-- Every state change writes a row here IN THE SAME TRANSACTION as the change
-- itself, the same discipline F-09 uses for commissions on funding: if the
-- change rolls back so does its record, and a committed change can never lack
-- one. An audit trail written afterwards, or by a trigger that a later
-- migration could quietly drop, is one that disagrees with reality eventually.
--
-- This is what F-08 was missing twice over: "nothing keeps history" is why a
-- delivered deal's checklist had to be frozen outright rather than corrected
-- with a reason (D-034), and why un-waiving could erase a manager's decision
-- with nothing left behind.

CREATE TABLE activity_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  -- Not every event belongs to a store (an org-level role change does not).
  store_id         uuid,

  -- Who. NULL means the system acted: an intake webhook, a scheduled job.
  -- Deliberately NOT NOT-NULL — pretending a job was a person would be worse
  -- than admitting nobody was there.
  -- ON DELETE SET NULL, deliberately: a Law 25 / PIPEDA erasure request must be
  -- satisfiable without destroying the record that something happened, and
  -- without the request simply failing on a foreign key. The act survives; the
  -- person's identity does not have to.
  actor_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,

  entity_type      text NOT NULL
                   CHECK (entity_type IN ('deal','lead','vehicle','membership',
                                          'pay_plan','checklist_item','checklist_template',
                                          'intake_key','organization','store')),
  entity_id        uuid NOT NULL,

  -- Verb, past tense, stable vocabulary. New verbs need a migration, which is
  -- the point: an audit vocabulary that anyone can extend at runtime cannot be
  -- reported on.
  action           text NOT NULL
                   CHECK (action IN ('created','updated','deleted',
                                     'stage_changed','funding_changed','delivered',
                                     'assigned','unassigned',
                                     'checklist_completed','checklist_uncompleted',
                                     'checklist_waived','checklist_unwaived',
                                     'roles_changed','revoked','reinstated')),

  -- What actually changed: {"field": {"from": x, "to": y}}. Small and typed at
  -- the write site rather than a free-text sentence, so it stays translatable
  -- and queryable. NOT a dump of the whole row — this table outlives the rows
  -- it describes and must not become a second copy of the database.
  changes          jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The human reason, when the action carried one (a waiver, an override).
  reason           text CHECK (reason IS NULL OR btrim(reason) <> ''),

  created_at       timestamptz NOT NULL DEFAULT now(),
  -- now() is TRANSACTION-start time: every event from one request carries an
  -- identical created_at, and a random uuid is no tiebreak. Without this the
  -- feed could not say whether the stage moved before or after the money did.
  -- GENERATED ALWAYS AS IDENTITY, not bigserial: the implicit sequence is then
  -- reachable through the table's own INSERT privilege (bigserial needs a
  -- separate GRANT USAGE, which is exactly the kind of thing that is forgotten),
  -- and ALWAYS means no caller can supply its own ordering.
  seq              bigint GENERATED ALWAYS AS IDENTITY
);

-- The two ways this is read: one entity's history, and the org's recent activity.
CREATE INDEX idx_activity_entity ON activity_events (organization_id, entity_type, entity_id, seq DESC);
CREATE INDEX idx_activity_org_recent ON activity_events (organization_id, seq DESC);
CREATE INDEX idx_activity_actor ON activity_events (organization_id, actor_user_id, seq DESC)
  WHERE actor_user_id IS NOT NULL;

-- Append-only, enforced by the grant: no UPDATE, no DELETE, for anyone the
-- application connects as. A correction is a new row.
GRANT SELECT, INSERT ON activity_events TO dealpilot_app;

ALTER TABLE activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_events FORCE ROW LEVEL SECURITY;

CREATE POLICY activity_isolation ON activity_events
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- Deliberately no user-keyed policy: reads run under withTenant, and a
-- permissive policy keyed on the caller alone would OR with isolation and hand
-- a dual-context caller their activity from every organization they belong to
-- (the defect removed in 0013). packages/db/src/rls-coverage.test.ts fails if
-- one appears here without a registered reason.
