-- 0040 — the lead's link to the customer master (FR-CON-003).
--
-- A separate migration from 0039 rather than an edit to it, because 0039 is
-- already applied. Editing an applied migration is the one database rule this
-- project does not bend: CI rebuilds from zero and would never notice, while
-- every database that already has the history refuses to upgrade.
--
-- Merge (FR-CON-003) has to move a customer's leads to the surviving record,
-- and until now there was nothing to move — a lead carried a phone number and a
-- name but no reference to the person. The enquiry and the customer were
-- unrelated rows that happened to share a phone number.

ALTER TABLE leads ADD COLUMN contact_id uuid;

-- Tenant-safe: without the composite key a lead could reference a contact in
-- another organisation, which is the shape of every cross-tenant leak this
-- schema is built to make impossible.
ALTER TABLE leads ADD CONSTRAINT leads_contact_fk
  FOREIGN KEY (organization_id, contact_id) REFERENCES contacts (organization_id, id);

-- "Every enquiry this customer has ever made" — the contact detail timeline,
-- and the merge's move list.
CREATE INDEX idx_leads_contact ON leads (organization_id, contact_id)
  WHERE contact_id IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN leads.contact_id IS
  'The person behind the enquiry. Set when a deal links a buyer (F-36); null for leads that never became deals. Re-pointed by contact merge.';

/**
 * The activity vocabulary gains 'merged'.
 *
 * Without this the merge route writes an action the CHECK refuses, and the
 * whole transaction rolls back — the merge appears to fail for reasons that
 * have nothing to do with merging. This is the `timezone_source` mistake again,
 * where a constraint permitted a value nothing emitted and refused the one
 * everything did; `enum-vocabulary.test.ts` exists because of it.
 *
 * Forward-only, like every other change to this constraint (0038 last set it).
 */
ALTER TABLE activity_events DROP CONSTRAINT activity_events_action_check;
ALTER TABLE activity_events ADD CONSTRAINT activity_events_action_check
  CHECK (action IN ('created','updated','deleted','stage_changed','funding_changed',
                    'delivered','assigned','unassigned','checklist_completed',
                    'checklist_uncompleted','checklist_waived','checklist_unwaived',
                    'roles_changed','revoked','reinstated','merged'));
