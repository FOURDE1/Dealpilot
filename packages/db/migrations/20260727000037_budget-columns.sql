-- 0037 — D-043: a budget column that says which budget it is.
--
-- `leads.budget_cents` committed to neither meaning, and conversation-engine.md
-- §5 extracts `monthly_budget_cents` alongside a `budget_type: monthly|total`
-- discriminator. Putting a $450 monthly figure into a column a desking screen
-- reads as $45,000 is wrong in a way that looks plausible on every screen it
-- touches — the numbers are the right shape, the currency is right, and nothing
-- errors.
--
-- Two explicitly named columns rather than one column plus a flag. A flag means
-- every reader must remember to check it, and the failure mode of forgetting is
-- silent; a name cannot be forgotten, because you cannot accidentally read
-- `monthly_budget_cents` as a total.
--
-- Safe to rename today: nothing computes with this column, it is only stored
-- and echoed back. That stops being true the moment desking reads it, which is
-- why it happens now.

ALTER TABLE leads RENAME COLUMN budget_cents TO total_budget_cents;

ALTER TABLE leads ADD COLUMN monthly_budget_cents integer
  CHECK (monthly_budget_cents IS NULL OR monthly_budget_cents >= 0);

COMMENT ON COLUMN leads.total_budget_cents IS
  'What they will spend on the vehicle, in cents. Never a payment.';
COMMENT ON COLUMN leads.monthly_budget_cents IS
  'What they can pay per month, in cents. Never a price. D-043.';
