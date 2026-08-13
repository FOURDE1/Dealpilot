-- 0035 — the analysis panel needs a deterministic order.
--
-- 0033 ordered `conversation_analysis` by `created_at DESC, id DESC`. Both
-- columns lie about order: `now()` is the TRANSACTION's timestamp, so several
-- rows written together are identical to the microsecond, and the tiebreak then
-- falls to a random uuid. The silent monitor (§9) writes an analysis per
-- message — so the panel would have shown the assistant's newest read wherever
-- a random id happened to sort it, which is the kind of wrong that looks like
-- nothing at all.
--
-- Same fix as activity_events (0014), for the same reason and in the same
-- shape: GENERATED ALWAYS AS IDENTITY rather than bigserial, so the implicit
-- sequence belongs to the column and cannot be written by hand.

ALTER TABLE conversation_analysis
  ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY;

CREATE INDEX idx_conversation_analysis_seq
  ON conversation_analysis (organization_id, conversation_id, seq DESC);

COMMENT ON COLUMN conversation_analysis.seq IS
  'Insertion order. created_at cannot carry it: rows written in one transaction share now() to the microsecond.';
