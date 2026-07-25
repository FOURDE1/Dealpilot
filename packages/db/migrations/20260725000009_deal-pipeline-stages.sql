-- 0009 canonical deal pipeline (F-06): replace the ad-hoc status vocabulary
-- shipped with F-05 with the SPEC's two independent tracks
-- (deals-pipeline.md §2 and §3):
--   pipeline_stage : new → submitted → approved → signed → sourcing →
--                    pending_delivery → scheduled → delivered → complete, + lost
--   funding_status : not_submitted → submitted → stips_required → funded
-- The pipeline stage says where the CAR is; funding says where the MONEY is.
-- F-05 collapsed both into one column ('working/funded/...'), which cannot
-- express "delivered but not yet funded" — the state a dealership cares about
-- most. Corrected now, while only development data exists.

ALTER TABLE deals RENAME COLUMN status TO pipeline_stage;
ALTER TABLE deals ALTER COLUMN pipeline_stage DROP DEFAULT;
ALTER TABLE deals DROP CONSTRAINT deals_status_check;

-- Map the interim vocabulary onto the canonical one.
UPDATE deals SET pipeline_stage = CASE pipeline_stage
  WHEN 'working'   THEN 'new'
  WHEN 'funded'    THEN 'complete'
  ELSE pipeline_stage           -- submitted / approved / delivered / lost carry over
END;

ALTER TABLE deals
  ALTER COLUMN pipeline_stage SET DEFAULT 'new',
  ADD CONSTRAINT deals_pipeline_stage_check CHECK (pipeline_stage IN (
    'new','submitted','approved','signed','sourcing',
    'pending_delivery','scheduled','delivered','complete','lost'
  ));

ALTER TABLE deals
  ADD COLUMN funding_status text NOT NULL DEFAULT 'not_submitted'
    CHECK (funding_status IN ('not_submitted','submitted','stips_required','funded')),
  -- Set when the money actually arrives; the commission engine (A-06) keys its
  -- monthly tier on this timestamp, never on the stage.
  ADD COLUMN funded_at timestamptz,
  ADD COLUMN delivered_at timestamptz;

DROP INDEX IF EXISTS idx_deals_org_status;
CREATE INDEX idx_deals_org_stage ON deals (organization_id, pipeline_stage) WHERE deleted_at IS NULL;
CREATE INDEX idx_deals_org_funding ON deals (organization_id, funding_status) WHERE deleted_at IS NULL;
