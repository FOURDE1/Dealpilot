-- 0032 — the timezone_source vocabulary, corrected.
--
-- 0028 declared:
--     CHECK (timezone_source IN ('postal_code','store','fallback'))
--
-- The gate produces `postal_code | area_code | store` (compliance-and-quality.md
-- §3, `resolveRecipientTimezone`). So the constraint permitted a value nothing
-- has ever emitted, and refused the one most sends actually resolve to: a lead
-- who gave a phone number and no postal code — which is most of them — resolves
-- by area code, and 514, 450 and 438 are Montreal.
--
-- Every send from a Quebec phone number would have failed on INSERT. It stayed
-- invisible because the two things that touch this column never met: the CHECK
-- endpoint computes `area_code` and returns it as JSON without persisting a row,
-- and the only test that wrote a row hand-picked 'store' in its literal. The
-- column was never asked to hold the value the system produces until the send
-- layer (F-19) tried to write one.
--
-- Forward-only: 0028 is applied and is not edited.

ALTER TABLE send_decisions DROP CONSTRAINT send_decisions_timezone_source_check;
ALTER TABLE send_decisions ADD CONSTRAINT send_decisions_timezone_source_check
  CHECK (timezone_source IN ('postal_code','area_code','store'));

COMMENT ON COLUMN send_decisions.timezone_source IS
  'How the recipient timezone was resolved, in precedence order: postal_code, then area_code, then the store. Must stay equal to TzSource in packages/core — the vocabulary guard in packages/db/src/enum-vocabulary.test.ts enforces it.';
