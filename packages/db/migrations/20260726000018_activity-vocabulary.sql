-- 0018 — extend the activity vocabulary for invitations and dispatch.
--
-- WHY THIS EXISTS, and it is a correction of my own mistake: F-12 and F-11 each
-- needed a new `entity_type`, and I added them by EDITING migration 0014, which
-- had already been merged and applied. CI never noticed because it rebuilds the
-- database from zero on every run — the one environment where an immutable
-- migration cannot be caught. Every environment that had already applied 0014
-- (a developer's local database, and later staging and production) would refuse
-- to migrate with "checksum mismatch". My own dev database is what found it.
--
-- 0014 and 0016 are back to exactly what they were when merged. The vocabulary
-- they were edited to add lives here instead, where it belongs: forward-only.

ALTER TABLE activity_events DROP CONSTRAINT activity_events_entity_type_check;
ALTER TABLE activity_events ADD CONSTRAINT activity_events_entity_type_check
  CHECK (entity_type IN ('deal','lead','vehicle','membership','pay_plan',
                         'checklist_item','checklist_template','intake_key',
                         'invitation','dispatch_assignment',
                         'organization','store'));

ALTER TABLE activity_events DROP CONSTRAINT activity_events_parent_entity_type_check;
ALTER TABLE activity_events ADD CONSTRAINT activity_events_parent_entity_type_check
  CHECK (parent_entity_type IS NULL OR parent_entity_type IN
         ('deal','lead','vehicle','membership','pay_plan',
          'checklist_item','checklist_template','intake_key',
          'invitation','dispatch_assignment',
          'organization','store'));
