-- 0008 lease residual (HO-05 fix): a lease payment depends on the residual as
-- much as on rate and term, and the deal row had nowhere to keep it — so every
-- saved lease silently used the engine's 55% default while the customer may
-- have been quoted something else. Percent of MSRP, matching the engine.

ALTER TABLE deals
  ADD COLUMN residual_percent integer NOT NULL DEFAULT 55
  CHECK (residual_percent BETWEEN 0 AND 100);
