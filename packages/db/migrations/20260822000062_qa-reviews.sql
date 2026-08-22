-- 0062 — conversation QA reviews (F-64, compliance-and-quality.md §9).
--
-- Every closed conversation gets a model judge's score against the six-
-- dimension rubric; humans later review a sample under the same shape
-- (reviewer_type says whose judgement a row is). The judge WRITES ROWS and
-- raises alerts — it never touches the conversation, the lead, or the
-- send path: quality observation must not be able to change behaviour.

CREATE TABLE conversation_qa_reviews (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  store_id         uuid NOT NULL,
  conversation_id  uuid NOT NULL,
  reviewer_type    text NOT NULL CHECK (reviewer_type IN ('model','human')),
  /** {compliance, grounding, data_capture, craft, language, handoff} 1..5. */
  scores           jsonb NOT NULL CHECK (jsonb_typeof(scores) = 'object'),
  /** Weighted mean (§9 weights), 2dp; a compliance fail caps it at 1.00. */
  overall          numeric(3,2) NOT NULL CHECK (overall >= 1.00 AND overall <= 5.00),
  flags            text[] NOT NULL DEFAULT '{}',
  notes            text,
  /** §13 metering, same shape as the other model passes (0061). */
  model            text,
  input_tokens     integer,
  output_tokens    integer,
  created_at       timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (organization_id, store_id)        REFERENCES stores        (organization_id, id),
  FOREIGN KEY (organization_id, conversation_id) REFERENCES conversations (organization_id, id)
);

-- ONE model verdict per conversation — the nightly job's idempotency: an
-- at-least-once replay is a free conflict, not a second judge spend.
CREATE UNIQUE INDEX uq_qa_review_model
  ON conversation_qa_reviews (conversation_id) WHERE reviewer_type = 'model';
CREATE INDEX idx_qa_reviews_org_created
  ON conversation_qa_reviews (organization_id, created_at DESC);

GRANT SELECT, INSERT ON conversation_qa_reviews TO dealpilot_app;

ALTER TABLE conversation_qa_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_qa_reviews FORCE  ROW LEVEL SECURITY;

CREATE POLICY conversation_qa_reviews_isolation ON conversation_qa_reviews
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
CREATE POLICY conversation_qa_reviews_member_read ON conversation_qa_reviews FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = conversation_qa_reviews.organization_id
      AND m.status = 'active'
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  ));

-- The nightly scan, cross-tenant like the drip tick's (0060) and the same
-- audited SECURITY DEFINER shape: ids only, and only conversations no
-- model has judged yet. A seven-day window: '100% of the day' must survive
-- a busy Saturday AND a broken week of nights — a judged row leaves this
-- set, so the worker DRAINS it in LIMIT-sized rounds (oldest first: the
-- rows nearest to aging out go first) rather than sampling it once. Every
-- read and write then happens under withTenant, inside RLS.
CREATE FUNCTION qa_due_conversations(now_utc timestamptz)
RETURNS TABLE (organization_id uuid, conversation_id uuid)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT cv.organization_id, cv.id
  FROM conversations cv
  WHERE cv.status = 'closed'
    AND cv.deleted_at IS NULL
    AND cv.closed_at IS NOT NULL
    AND cv.closed_at >= now_utc - interval '7 days'
    AND cv.closed_at <= now_utc
    AND NOT EXISTS (
      SELECT 1 FROM conversation_qa_reviews r
      WHERE r.conversation_id = cv.id AND r.reviewer_type = 'model'
    )
  ORDER BY cv.closed_at ASC
  LIMIT 500
$$;

REVOKE ALL ON FUNCTION qa_due_conversations(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION qa_due_conversations(timestamptz) TO dealpilot_app;

COMMENT ON TABLE conversation_qa_reviews IS
  'Conversation QA rubric verdicts (compliance-and-quality.md §9): model judge nightly, humans on a sample; observation only, never behaviour.';
