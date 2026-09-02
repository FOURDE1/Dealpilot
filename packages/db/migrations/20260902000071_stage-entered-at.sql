-- 0071 stage_entered_at (F-78): when the deal ENTERED its current pipeline
-- stage. Producer: the f05 stage-transition UPDATE (the ONLY writer of
-- pipeline_stage) stamps it in the same statement that moves the stage;
-- INSERT gets it at now() because a new deal enters 'new' at creation.
-- Consumer: the GM dashboard's « En souffrance » table (rotting > 7 days in
-- stage, reports-analytics.md §14.1). NEVER derived from activity_events: an
-- audit log as a metric source makes a deleted or edited event a silent
-- metric change, and a deal whose stage was set at INSERT has no event at all.
ALTER TABLE deals ADD COLUMN stage_entered_at timestamptz;

-- Backfill honesty (the O-40 floor pattern): updated_at is the LAST write,
-- which is AT or AFTER the true entry moment, so age-in-stage computed from
-- it UNDERSTATES — a pre-0071 deal can be missed by "rotting > 7 days" but
-- never falsely accused. The caption on the consuming table says so.
--
-- The 0006 deals_updated_at BEFORE UPDATE trigger sets NEW.updated_at :=
-- now() unconditionally, so the plain backfill would rewrite EVERY deal's
-- updated_at to migration time — falsifying the very signal this backfill
-- reads as its floor (and updated_at is a wire field on Deal). Disable that
-- one trigger for the backfill only; NEVER session_replication_role, which
-- would also disable FK triggers.
ALTER TABLE deals DISABLE TRIGGER deals_updated_at;
UPDATE deals SET stage_entered_at = updated_at;
ALTER TABLE deals ENABLE TRIGGER deals_updated_at;

ALTER TABLE deals ALTER COLUMN stage_entered_at SET DEFAULT now();
ALTER TABLE deals ALTER COLUMN stage_entered_at SET NOT NULL;

COMMENT ON COLUMN deals.stage_entered_at IS
  'Entered-current-stage moment; stamped by the f05 stage PATCH. Rows predating 0071 carry their then-updated_at: a FLOOR on age-in-stage (understates, never overstates).';

-- No index here, deliberately: the whole GM report EXPLAINed at 16.5 ms on
-- the biggest dev org over existing indexes (measure before optimizing).
-- Un-cut condition: a measured seq scan on this predicate for a >50k-deal
-- org earns a partial (organization_id, stage_entered_at) WHERE deleted_at
-- IS NULL index — in a NEW migration, never by editing this one.
