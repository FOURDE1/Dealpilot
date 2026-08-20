-- 0054 — store business hours + holidays (F-51, FR-AI-011's config half,
-- automation-notifications.md §13.3 "stores additions").
--
-- Pure configuration this slice: the CONSUMER — the assistant's after-hours
-- "an agent will reach out next business morning" behaviour — arrives with
-- the AI engine (Anthropic-key-gated). Shipping the columns now means the
-- owner can fill them in while that clock runs, and the schedules screen's
-- store anchor and this table finally speak the same timezone.

ALTER TABLE stores
  /**
   * { "mon": {"open":"09:00","close":"18:00"}, ... } — a missing day is a
   * closed day. Times are in the STORE's timezone, like staff_schedules.
   */
  ADD COLUMN business_hours jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN holiday_dates date[] NOT NULL DEFAULT '{}';
