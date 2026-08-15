-- 0042 — where a merged customer record went (FR-CON-003).
--
-- FR-CON-003 says a merge "moves activity" to the surviving record. The first
-- implementation took that literally and ran
-- `UPDATE activity_events SET entity_id = ...`, which failed — `dealpilot_app`
-- holds INSERT and SELECT on that table and nothing else.
--
-- The grant is right and the requirement's wording is what should bend. An
-- audit trail that can be rewritten is not an audit trail, and "who may merge
-- customers" is a permission several roles have. Re-pointing history would mean
-- anybody able to merge could also silently re-attribute past events to a
-- different person, which is precisely the capability an audit log exists to
-- deny.
--
-- So nothing moves. The retired record keeps its own history, and this column
-- records where it went, so the survivor's timeline can read both without a
-- single row being rewritten. Same result on screen, opposite guarantee
-- underneath.

ALTER TABLE contacts ADD COLUMN merged_into_contact_id uuid;

ALTER TABLE contacts ADD CONSTRAINT contacts_merged_into_fk
  FOREIGN KEY (organization_id, merged_into_contact_id) REFERENCES contacts (organization_id, id);

-- A record cannot be merged into itself; that is a cycle of length one and the
-- timeline walk would never terminate.
ALTER TABLE contacts ADD CONSTRAINT contacts_merged_into_not_self
  CHECK (merged_into_contact_id IS NULL OR merged_into_contact_id <> id);

-- Only a retired record points anywhere. A live contact with a forwarding
-- address is a merge that half happened.
ALTER TABLE contacts ADD CONSTRAINT contacts_merged_into_implies_deleted
  CHECK (merged_into_contact_id IS NULL OR deleted_at IS NOT NULL);

-- "Everything that was folded into this customer" — the timeline's second leg.
CREATE INDEX idx_contacts_merged_into ON contacts (organization_id, merged_into_contact_id)
  WHERE merged_into_contact_id IS NOT NULL;

COMMENT ON COLUMN contacts.merged_into_contact_id IS
  'Set when this record was folded into another (FR-CON-003). Its activity_events stay attached to THIS id — the trail is append-only — and the survivor reads them by following this pointer.';
