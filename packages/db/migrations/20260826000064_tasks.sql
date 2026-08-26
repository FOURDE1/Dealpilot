-- 0064 — the unified task system (F-68, appointments-tasks-communications.md §3.3).
--
-- The legacy ran TWO task tables with different field names and enums
-- (`lead_tasks.assigned_to` vs `tasks.assignee_id`, three priorities vs
-- four) — defect #11 of the server audit, #6 of the gap table. The Target
-- is ONE table with a polymorphic subject; this is it. `inventory` in the
-- spec's subject list is spelled `vehicle` here, the word every other
-- vocabulary in this schema already uses for that row (activity_events,
-- permissions), so the trail and the task agree on what they point at.
--
-- No FK on the subject — a polymorphic column cannot carry one — so the
-- route validates the subject exists in THIS tenant before insert, and
-- store_id is copied from the subject at creation so the F-55 store-scope
-- discipline works on tasks without a join per row.

CREATE TABLE tasks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id),
  store_id            uuid NOT NULL,

  subject_type        text NOT NULL CHECK (subject_type IN ('lead','deal','contact','vehicle')),
  subject_id          uuid NOT NULL,

  title               text NOT NULL CHECK (btrim(title) <> '' AND length(title) <= 200),
  description         text CHECK (description IS NULL OR length(description) <= 2000),
  task_type           text NOT NULL DEFAULT 'follow_up'
                      CHECK (task_type IN ('follow_up','call','email','meeting','test_drive',
                                           'appointment','delivery','other')),
  priority            text NOT NULL DEFAULT 'medium'
                      CHECK (priority IN ('low','medium','high','urgent')),
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','in_progress','completed','cancelled')),
  /** Who or what created it — a person, or one of the automations. */
  source              text NOT NULL DEFAULT 'manual'
                      CHECK (source IN ('manual','appointment_no_show','appointment_showed_no_deal',
                                        'workflow_step','ai_suggested')),

  due_at              timestamptz,
  assigned_to         uuid REFERENCES users(id) ON DELETE SET NULL,
  /** The appointment an automation (§2.4) made this task for. */
  appointment_id      uuid REFERENCES appointments(id) ON DELETE SET NULL,
  completed_at        timestamptz,

  /**
   * The overdue sweep's bookkeeping (§3.3: task overdue → sales manager,
   * escalate to GM after 10 minutes unacknowledged). Stamped by the WORKER
   * so a task is nagged about once per overdue episode, not every fifteen
   * minutes forever; the API clears both when the task is rescheduled or
   * reopened, so a task that becomes overdue AGAIN is alerted again.
   */
  overdue_notified_at timestamptz,
  escalated_at        timestamptz,

  created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,

  FOREIGN KEY (organization_id, store_id) REFERENCES stores (organization_id, id),

  -- completed_at IS the completion fact; the status is its label. Setting
  -- one without the other is the kind of half-write the legacy's
  -- "PATCH completed:true auto-sets completed_at" rule was papering over.
  CHECK ((completed_at IS NOT NULL) = (status = 'completed')),
  -- Escalation presupposes the first alert went out.
  CHECK (escalated_at IS NULL OR overdue_notified_at IS NOT NULL)
);

CREATE TRIGGER tasks_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

/** "What does this person still have to do" — the board's exact shape. */
CREATE INDEX idx_tasks_open_by_assignee
  ON tasks (organization_id, assigned_to, due_at)
  WHERE status IN ('pending','in_progress') AND deleted_at IS NULL;
/** A record's own task list (the lead page's panel). */
CREATE INDEX idx_tasks_subject
  ON tasks (organization_id, subject_type, subject_id, created_at DESC)
  WHERE deleted_at IS NULL;
/** The sweep: every open task past due, across tenants, by due time. */
CREATE INDEX idx_tasks_open_due
  ON tasks (due_at)
  WHERE status IN ('pending','in_progress') AND deleted_at IS NULL AND due_at IS NOT NULL;

/* Soft delete only — no DELETE grant, like the other records with a trail. */
GRANT SELECT, INSERT, UPDATE ON tasks TO dealpilot_app;

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks FORCE  ROW LEVEL SECURITY;

CREATE POLICY tasks_isolation ON tasks
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
/** The withUser traversal (D-046): a route must find the org before it can set it. */
CREATE POLICY tasks_member_read ON tasks FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = tasks.organization_id
      AND m.status = 'active'
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  ));

/**
 * The 15-minute sweep's scan (§3.3) — SECURITY DEFINER, ids only, on the
 * drip_due_enrollments precedent (0060): "which tenants have an overdue
 * task" is exactly the question a tenant-scoped connection cannot ask.
 * Everything that reads a title or writes a notification happens under
 * withTenant, per organization, inside RLS.
 *
 * `escalate` rows are tasks whose first alert is at least `escalate_after`
 * old and which NOBODY has acknowledged — no overdue notification for the
 * task has been read. Reading it is the acknowledgement; there is no
 * separate button to forget to press.
 */
CREATE FUNCTION tasks_needing_attention(now_utc timestamptz, escalate_after interval)
RETURNS TABLE (organization_id uuid, task_id uuid, kind text, since timestamptz)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT t.organization_id, t.id, 'overdue', t.due_at
  FROM tasks t
  WHERE t.status IN ('pending','in_progress') AND t.deleted_at IS NULL
    AND t.due_at IS NOT NULL AND t.due_at <= now_utc
    AND t.overdue_notified_at IS NULL
  UNION ALL
  SELECT t.organization_id, t.id, 'escalate', t.overdue_notified_at
  FROM tasks t
  WHERE t.status IN ('pending','in_progress') AND t.deleted_at IS NULL
    -- Still overdue NOW (review): a task rescheduled after its first alert
    -- is not escalated about a due date that no longer exists.
    AND t.due_at IS NOT NULL AND t.due_at <= now_utc
    AND t.overdue_notified_at IS NOT NULL
    AND t.overdue_notified_at + escalate_after <= now_utc
    AND t.escalated_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM notifications n
      WHERE n.entity_type = 'task' AND n.entity_id = t.id
        AND n.title_key = 'notif_task_overdue' AND n.read_at IS NOT NULL
    )
  -- Oldest debt first, ACROSS tenants (review): ordered by organization, a
  -- single tenant with 500 poison rows would fill every sweep and starve
  -- the rest forever.
  ORDER BY 4, 2
  LIMIT 500
$$;

REVOKE ALL ON FUNCTION tasks_needing_attention(timestamptz, interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tasks_needing_attention(timestamptz, interval) TO dealpilot_app;

-- The activity vocabulary gains the task as an entity (and as a parent, so
-- "everything that happened to this lead" includes its follow-ups) and
-- 'task_completed' as the action the legacy logged by that exact name.
-- Forward-only, like every change to these constraints (0038, 0060).
ALTER TABLE activity_events DROP CONSTRAINT activity_events_entity_type_check;
ALTER TABLE activity_events ADD CONSTRAINT activity_events_entity_type_check
  CHECK (entity_type IN ('deal','lead','vehicle','membership','pay_plan',
                         'checklist_item','checklist_template','intake_key',
                         'invitation','dispatch_assignment','deal_document',
                         'deal_fi_product','tenant_branding','consent','suppression',
                         'internal_dnc','conversation','appointment','contact',
                         'organization','store','task'));

ALTER TABLE activity_events DROP CONSTRAINT activity_events_parent_entity_type_check;
ALTER TABLE activity_events ADD CONSTRAINT activity_events_parent_entity_type_check
  CHECK (parent_entity_type IS NULL OR parent_entity_type IN
         ('deal','lead','vehicle','membership','pay_plan',
          'checklist_item','checklist_template','intake_key',
          'invitation','dispatch_assignment','deal_document',
          'deal_fi_product','tenant_branding','consent','suppression',
          'internal_dnc','conversation','appointment','contact',
          'organization','store','task'));

ALTER TABLE activity_events DROP CONSTRAINT activity_events_action_check;
ALTER TABLE activity_events ADD CONSTRAINT activity_events_action_check
  CHECK (action IN ('created','updated','deleted','stage_changed','funding_changed',
                    'delivered','assigned','unassigned','checklist_completed',
                    'checklist_uncompleted','checklist_waived','checklist_unwaived',
                    'roles_changed','revoked','reinstated','merged','drip_enrolled',
                    'task_completed'));

COMMENT ON TABLE tasks IS
  'Unified polymorphic tasks (appointments-tasks-communications.md §3.3): one table for lead follow-ups, deal, contact and vehicle work; the 15-minute overdue sweep stamps overdue_notified_at / escalated_at.';
