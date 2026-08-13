-- 0030 — the cross-organisation stop list (compliance-and-quality.md §5, effect 5).
--
-- Somebody who texts STOP to one dealership has not agreed to hear from its
-- sister dealership tomorrow. §5 requires a "platform_suppression row (phone
-- hash only, no tenant data) so cross-org network routing never re-markets a
-- suppressed number through a sister organization."
--
-- This is the ONE table in the system that is deliberately NOT tenant-scoped,
-- and it carries no tenant data at all — which is the point twice over:
--
--  * a suppression that stopped at the organisation boundary would be no
--    protection in a group that owns four rooftops under three legal entities;
--  * storing the raw number here would build a cross-tenant directory of every
--    customer who ever opted out, readable by whoever could reach the table. A
--    hash answers the only question anyone may ask of it — "is THIS number on
--    it?" — and answers nothing else.
--
-- There is no RLS, because there is nothing here to isolate: no organisation
-- owns these rows and none can learn anything from them without already knowing
-- the number.

CREATE TABLE platform_suppression (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SHA-256 of the E.164 string, unsalted ON PURPOSE. A salted hash could not
  -- be probed for membership at all, which would make the table useless for the
  -- one check it exists to serve. The number space is small enough that this is
  -- not privacy through obscurity — it is a lookup key that is not a directory.
  phone_sha256  bytea NOT NULL,
  channel       text NOT NULL CHECK (channel IN ('sms','mms','voice','email')),
  -- No organisation, no lead, no message id. Whoever reads this table learns
  -- only that SOME number opted out somewhere, which is the minimum that makes
  -- the check work.
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_platform_suppression_lookup
  ON platform_suppression (phone_sha256, channel);

-- SELECT and INSERT only. There is deliberately no UPDATE and no DELETE grant:
-- §7 keeps suppression entries even through a deletion request, because they
-- are the proof that contact must NOT be made. Removing one is not an operation
-- the application is allowed to have.
GRANT SELECT, INSERT ON platform_suppression TO dealpilot_app;

COMMENT ON TABLE platform_suppression IS
  'Cross-organisation stop list, hashed. Not tenant-scoped by design: an opt-out at one rooftop must hold at its sister rooftops (compliance-and-quality.md §5).';
