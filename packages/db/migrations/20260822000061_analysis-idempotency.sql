-- 0061 — silent-monitoring bookkeeping (F-62 review, D-063).
--
-- Three findings, one shape. (1) The live-update INSERT had no per-message
-- idempotency: BullMQ is at-least-once, and a worker killed between commit
-- and ack replayed the job — a second model spend and a duplicate row in an
-- append-only log. `message_id` + the partial unique index make the replay
-- a no-op, the same defence lead_extractions already carries. (2) §13
-- meters every model call; the analysis pass discarded its token counts.
-- (3) Knowing WHICH message an analysis judged is also the freshness guard:
-- a stale job that lost the race to a fresher one can now see it lost.
--
-- Plain uuid, no FK: messages carries no (organization_id, id) unique key,
-- and this column is bookkeeping about a moment, not a relation the row's
-- meaning depends on. NULL on handoff_summary rows — a handoff is triggered
-- by a decision, not one message.

ALTER TABLE conversation_analysis ADD COLUMN message_id uuid;
ALTER TABLE conversation_analysis ADD COLUMN model text;
ALTER TABLE conversation_analysis ADD COLUMN input_tokens integer;
ALTER TABLE conversation_analysis ADD COLUMN output_tokens integer;

CREATE UNIQUE INDEX uq_conversation_analysis_message
  ON conversation_analysis (message_id) WHERE message_id IS NOT NULL;

COMMENT ON COLUMN conversation_analysis.message_id IS
  'The message this live_update judged — idempotency key and freshness anchor (F-62). NULL for handoff_summary rows.';
