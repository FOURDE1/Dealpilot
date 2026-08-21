-- 0058 — structured extraction lands on the lead (F-57, conversation-engine.md §5).
--
-- The assistant's job is the conversation; a separate extraction pass owns
-- data capture, so a good chat and good data never trade off. These are the
-- §5 write-back targets that did not exist yet, plus the verbatim snapshot
-- table every extraction leaves behind for audit and eval material.

ALTER TABLE leads
  ADD COLUMN purchase_timeline text NOT NULL DEFAULT 'unknown'
    CHECK (purchase_timeline IN ('now','this_week','this_month','one_to_three_months','three_plus_months','unknown')),
  /** Self-reported and coarse (§5): mapped from soft statements, never from a
   * score — the assistant is forbidden to ask for one (RT-09). */
  ADD COLUMN credit_band text NOT NULL DEFAULT 'unknown'
    CHECK (credit_band IN ('prime','near_prime','subprime','deep_subprime','unknown')),
  ADD COLUMN trade_in_year integer CHECK (trade_in_year BETWEEN 1950 AND 2100),
  ADD COLUMN trade_in_make text,
  ADD COLUMN trade_in_model text,
  ADD COLUMN trade_in_mileage_km integer CHECK (trade_in_mileage_km >= 0),
  ADD COLUMN trade_in_condition text
    CHECK (trade_in_condition IS NULL OR trade_in_condition IN ('excellent','good','fair','poor'));

CREATE TABLE lead_extractions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  store_id        uuid,
  lead_id         uuid NOT NULL,
  conversation_id uuid,
  message_id      uuid,
  /** The model's output, verbatim — audit first, regression corpus second. */
  payload         jsonb NOT NULL,
  model           text NOT NULL,
  input_tokens    integer NOT NULL DEFAULT 0,
  output_tokens   integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (organization_id, lead_id)          REFERENCES leads         (organization_id, id),
  FOREIGN KEY (organization_id, store_id)         REFERENCES stores        (organization_id, id),
  FOREIGN KEY (organization_id, conversation_id)  REFERENCES conversations (organization_id, id)
);

-- One snapshot per triggering message: the worker retries after transient
-- model failures, and a retry that lands after a commit must converge, not
-- append.
CREATE UNIQUE INDEX uq_lead_extractions_message
  ON lead_extractions (message_id) WHERE message_id IS NOT NULL;

CREATE INDEX idx_lead_extractions_lead
  ON lead_extractions (organization_id, lead_id, created_at DESC);

-- Snapshots are append-only: SELECT + INSERT, nothing else.
GRANT SELECT, INSERT ON lead_extractions TO dealpilot_app;

ALTER TABLE lead_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_extractions FORCE  ROW LEVEL SECURITY;

CREATE POLICY lead_extractions_isolation ON lead_extractions
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

CREATE POLICY lead_extractions_member_read ON lead_extractions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = lead_extractions.organization_id
      AND m.status = 'active'
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  ));

COMMENT ON TABLE lead_extractions IS
  'Per-turn structured-extraction snapshots (conversation-engine.md §5): verbatim model output for audit and eval regression; write-back to leads happens in the extraction worker.';
