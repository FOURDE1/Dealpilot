-- 0059 — the first-touch stamp (F-59, overview.md §5 job table).
--
-- `chatbot_engaged_at` is the moment the assistant's first message actually
-- went out — the numerator of the "AI first touch < 60s" SLA. Distinct from
-- first_contacted_at (any outbound, trigger-stamped) because a human could
-- conceivably beat the bot, and the SLA measures the BOT.
ALTER TABLE leads ADD COLUMN chatbot_engaged_at timestamptz;
