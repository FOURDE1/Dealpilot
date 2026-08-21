-- 0060 — client-facing drip sequences (F-61, automation-notifications.md §11).
--
-- A sequence is tenant CONFIG (steps as data, like connectors); an
-- enrollment is one lead riding one sequence. ALL sends go through the
-- conversation layer and the full compliance gate — the engine here only
-- decides WHEN a step is due, never whether it may be sent.

CREATE TABLE drip_sequences (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id),
  /** NULL = org-wide; a store row narrows enrollment to that store's leads. */
  store_id          uuid,
  name              text NOT NULL CHECK (btrim(name) <> ''),
  /** lead.lost fires today (F-53's flow); the other two arrive with their
   * modules (unresponsive ladder, delivery §9) — declared, not dead: the
   * enum is the contract new triggers plug into. */
  trigger_event     text NOT NULL
                    CHECK (trigger_event IN ('lead.lost','lead.unresponsive','delivery.completed')),
  /** e.g. {"lost_reason": "Ghosted"} — matched against the trigger's facts. */
  trigger_condition jsonb NOT NULL DEFAULT '{}',
  /** [{day, body_fr, body_en}] — day counts from enrollment; bodies carry
   * §12 merge fields; FR/EN pair per ADR-019 (Bill 96, FR-first). The array
   * CHECK keeps a raw INSERT from feeding the scanner something
   * jsonb_array_elements would abort the whole cross-tenant tick on. */
  steps             jsonb NOT NULL CHECK (jsonb_typeof(steps) = 'array'),
  duration_days     integer NOT NULL CHECK (duration_days BETWEEN 1 AND 365),
  /** Which consent scope each send declares (§11.3 Target): conversational
   * check-ins ride an inquiry basis; marketing needs express consent. */
  scope             text NOT NULL DEFAULT 'conversational'
                    CHECK (scope IN ('conversational','marketing')),
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  UNIQUE (organization_id, name),
  FOREIGN KEY (organization_id, store_id) REFERENCES stores (organization_id, id)
);

CREATE TRIGGER drip_sequences_updated_at BEFORE UPDATE ON drip_sequences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE drip_enrollments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations(id),
  store_id              uuid,
  drip_sequence_id      uuid NOT NULL REFERENCES drip_sequences(id),
  lead_id               uuid NOT NULL,
  conversation_id       uuid,
  /** §11.1 lists a 'paused' status; its only trigger ("positive reply during
   * a drip") is what 'reactivated' records here — one event, one status, so
   * 'paused' would be vocabulary nothing can reach (D-062). */
  status                text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','completed','opted_out','expired','reactivated')),
  current_step          integer NOT NULL DEFAULT 0 CHECK (current_step >= 0),
  enrolled_at           timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz NOT NULL,
  last_message_sent_at  timestamptz,
  opted_out_at          timestamptz,
  reactivated_at        timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (organization_id, store_id)        REFERENCES stores        (organization_id, id),
  FOREIGN KEY (organization_id, lead_id)         REFERENCES leads         (organization_id, id),
  FOREIGN KEY (organization_id, conversation_id) REFERENCES conversations (organization_id, id)
);

CREATE TRIGGER drip_enrollments_updated_at BEFORE UPDATE ON drip_enrollments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- One LIVE ride per lead per sequence; history rows (completed/expired/…)
-- may accumulate.
CREATE UNIQUE INDEX uq_drip_enrollment_live
  ON drip_enrollments (drip_sequence_id, lead_id) WHERE status = 'active';
CREATE INDEX idx_drip_enrollments_due
  ON drip_enrollments (status, expires_at) WHERE status = 'active';

GRANT SELECT, INSERT, UPDATE, DELETE ON drip_sequences  TO dealpilot_app;
GRANT SELECT, INSERT, UPDATE           ON drip_enrollments TO dealpilot_app;

ALTER TABLE drip_sequences   ENABLE ROW LEVEL SECURITY;
ALTER TABLE drip_sequences   FORCE  ROW LEVEL SECURITY;
ALTER TABLE drip_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE drip_enrollments FORCE  ROW LEVEL SECURITY;

CREATE POLICY drip_sequences_isolation ON drip_sequences
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
CREATE POLICY drip_sequences_member_read ON drip_sequences FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = drip_sequences.organization_id
      AND m.status = 'active'
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  ));

CREATE POLICY drip_enrollments_isolation ON drip_enrollments
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
CREATE POLICY drip_enrollments_member_read ON drip_enrollments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = drip_enrollments.organization_id
      AND m.status = 'active'
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  ));

-- The hourly tick has no tenant context — finding WHICH tenants have work
-- IS its question. Same audited SECURITY DEFINER shape as
-- carrier_resolve_number (0036): returns ids only; every actual read and
-- write then happens under withTenant, fully inside RLS.
--
-- Accepted risk (documented in docs/SECURITY.md): dealpilot_app can invoke
-- this from any request context and see (organization_id, enrollment_id)
-- uuid pairs across tenants — opaque identifiers that RLS renders unusable
-- for any further read. The alternative (a dedicated worker role) is queued
-- for the deploy phase, when workers get their own credentials.
CREATE FUNCTION drip_due_enrollments(now_utc timestamptz)
RETURNS TABLE (organization_id uuid, enrollment_id uuid)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT e.organization_id, e.id
  FROM drip_enrollments e
  JOIN drip_sequences s ON s.id = e.drip_sequence_id
  WHERE e.status = 'active'
    AND (
      -- Expiry surfaces UNCONDITIONALLY — a deactivated sequence's rides
      -- must still age out, or they sit 'active' forever and block the
      -- one-live-ride index from ever enrolling that lead again.
      e.expires_at <= now_utc
      OR (
        s.active AND (
          -- All steps sent: surface it so the tick can close it as completed.
          e.current_step >= jsonb_array_length(s.steps)
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(s.steps) WITH ORDINALITY AS st(step, ord)
            WHERE ord = e.current_step + 1
              AND e.enrolled_at + ((st.step->>'day') || ' days')::interval <= now_utc
          )
        )
      )
    )
  LIMIT 500
$$;

REVOKE ALL ON FUNCTION drip_due_enrollments(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION drip_due_enrollments(timestamptz) TO dealpilot_app;

-- The activity vocabulary gains 'drip_enrolled' — the paper trail for a
-- machine enrolling a lost lead in a nurture ride. Forward-only, like every
-- other change to this constraint (0040 last set it).
ALTER TABLE activity_events DROP CONSTRAINT activity_events_action_check;
ALTER TABLE activity_events ADD CONSTRAINT activity_events_action_check
  CHECK (action IN ('created','updated','deleted','stage_changed','funding_changed',
                    'delivered','assigned','unassigned','checklist_completed',
                    'checklist_uncompleted','checklist_waived','checklist_unwaived',
                    'roles_changed','revoked','reinstated','merged','drip_enrolled'));

COMMENT ON TABLE drip_sequences IS
  'Client-facing drip sequences (automation-notifications.md §11): steps as tenant config; every send passes the full compliance gate.';
COMMENT ON TABLE drip_enrollments IS
  'One lead riding one sequence; a positive reply reactivates the lead and ends the ride (§11.3).';
