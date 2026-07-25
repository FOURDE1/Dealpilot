-- 0016 activity: an event can name the thing it happened UNDER (CR-04).
--
-- Hussein hit this building the deal timeline: a checklist event is keyed by
-- the ITEM, so "everything that happened to this deal" could not be fetched —
-- the web client was pulling the org's checklist events and filtering by
-- changes->>'deal_id' in the browser, which is imprecise past a few pages.
--
-- Filtering on a JSONB field would have worked for exactly this case. A parent
-- pair is the same cost and answers the general question, which the next child
-- entity (dispatch assignments, documents, work orders) will ask again.
ALTER TABLE activity_events
  ADD COLUMN parent_entity_type text
    CHECK (parent_entity_type IS NULL OR parent_entity_type IN
      ('deal','lead','vehicle','membership','pay_plan','checklist_item',
       'checklist_template','intake_key','invitation','organization','store')),
  ADD COLUMN parent_entity_id uuid,
  -- Both halves or neither: half a parent reference is a filter that silently
  -- misses rows.
  ADD CONSTRAINT activity_parent_complete
    CHECK ((parent_entity_type IS NULL) = (parent_entity_id IS NULL));

-- The deal-timeline query: everything under one parent, newest first.
CREATE INDEX idx_activity_parent
  ON activity_events (organization_id, parent_entity_id, seq DESC)
  WHERE parent_entity_id IS NOT NULL;
