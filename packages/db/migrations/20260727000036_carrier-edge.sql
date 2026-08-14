-- 0036 — the carrier edge (F-30).
--
-- Two things the inbound webhook needs and does not have: a way to know which
-- dealership a phone number belongs to, and a way to survive being delivered
-- twice.

-- The store's SMS number.
--
-- Distinct from `stores.phone`, which is the number on the door that a customer
-- rings. This is the number the carrier sends from and delivers to, and one
-- number belongs to exactly ONE store across the whole platform — hence a
-- global unique index rather than a per-organisation one. Two dealerships
-- sharing a number would make an inbound message unroutable, and the failure
-- would be a customer's reply landing at a rival.
ALTER TABLE stores ADD COLUMN sms_number text
  CHECK (sms_number ~ '^\+1[0-9]{10}$');

CREATE UNIQUE INDEX idx_stores_sms_number ON stores (sms_number)
  WHERE sms_number IS NOT NULL AND deleted_at IS NULL;

/**
 * Which store owns this number?
 *
 * The webhook arrives with no session and no tenant context — it cannot, since
 * discovering the tenant is the whole question. Same shape and same reasoning
 * as `intake_resolve` (0005, 0029): an audited SECURITY DEFINER function with
 * the liveness joins written INTO it, so a message can never be routed into a
 * closed store or a deleted organisation.
 *
 * Returning nothing is the correct answer for an unknown number, and the caller
 * must treat it as a refusal rather than an error — an unrecognised number is
 * what a scanner hitting the endpoint looks like.
 */
CREATE FUNCTION carrier_resolve_number(p_number text)
RETURNS TABLE (organization_id uuid, store_id uuid, timezone text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.organization_id, s.id, s.timezone
  FROM stores s
  JOIN organizations o ON o.id = s.organization_id AND o.deleted_at IS NULL
  WHERE s.sms_number = p_number
    AND s.deleted_at IS NULL
    AND s.status <> 'closed';
$$;

REVOKE ALL ON FUNCTION carrier_resolve_number(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION carrier_resolve_number(text) TO dealpilot_app;

-- Delivered twice is the normal case, not the exception.
--
-- Carriers retry on any non-2xx and on a timeout, and the same message arriving
-- again must not create a second row — a duplicated inbound is a duplicated
-- customer message, which the assistant would answer twice, and a duplicated
-- STOP is harmless but a duplicated ordinary reply is not.
--
-- Scoped per organisation because `provider_ref` is the carrier's id and two
-- tenants on different carrier accounts could theoretically collide.
CREATE UNIQUE INDEX idx_messages_provider_ref
  ON messages (organization_id, provider_ref)
  WHERE provider_ref IS NOT NULL;

-- Why a message that exists was never delivered.
--
-- The ordering at the outbound edge has two failure modes and they are not
-- equally bad. A message SENT with no row is unrecoverable: a CASL inquiry asks
-- what was sent, to whom, on what basis, and the answer would be missing. A row
-- with nothing sent is merely wrong on a screen, and fixable.
--
-- So the row is written and committed FIRST, the carrier is called after, and
-- this column records the refusal when there is one. `provider_ref IS NULL AND
-- carrier_error IS NULL` is the third state: in flight.
ALTER TABLE messages ADD COLUMN carrier_error text;

COMMENT ON COLUMN messages.carrier_error IS
  'The carrier''s refusal, verbatim. Null when accepted or still in flight — provider_ref distinguishes those.';

COMMENT ON COLUMN stores.sms_number IS
  'The carrier number for this store. Globally unique: one number, one store, or an inbound message is unroutable.';
