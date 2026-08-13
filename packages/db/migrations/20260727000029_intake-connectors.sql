-- 0029 — intake keys name a CONNECTOR (ADR-005, amended 2026-07-23).
--
-- The amendment is the whole point: "all known lead sources ship as connector
-- definitions, and any new source — JSON webhook, ADF/XML email, or API polling
-- — is added by CONFIGURATION, not code."
--
-- Lead sources are the part of this product that changes without warning. A
-- dealership signs up with a new listing site on Tuesday and wants the leads
-- flowing on Wednesday. If that needs a deployment it does not happen, and the
-- leads go to a competitor who could take them.
--
-- So a key says which connector reads its payloads, and the connector says where
-- the fields live and what that form's consent box actually granted.

ALTER TABLE intake_keys
  ADD COLUMN connector_key text NOT NULL DEFAULT 'website_form'
    CHECK (btrim(connector_key) <> '');

COMMENT ON COLUMN intake_keys.connector_key IS
  'Which connector definition reads this source''s payloads (packages/core/src/intake-connector.ts). Adding a source is a definition, not a deployment.';

-- The resolver is a SECURITY DEFINER function called with no tenant context, so
-- it has to hand back everything the public endpoint needs in one round trip.
-- Forward-only: 0005 created it and is applied, so it is replaced rather than
-- edited.
-- The predicates below are carried over from 0005 VERBATIM and are load-bearing:
-- the key must be active and unrevoked, and its store and organisation must both
-- still be live, so a webhook can never place a lead into a closed store or a
-- deleted organisation. Replacing a function is an easy way to quietly drop a
-- join nobody notices until leads appear somewhere they should not.
--
-- The return type gains a column, so the old signature is dropped first —
-- CREATE OR REPLACE cannot change a function's OUT parameters.
DROP FUNCTION intake_resolve(text);

CREATE FUNCTION intake_resolve(p_token text)
RETURNS TABLE (organization_id uuid, store_id uuid, default_source text, secret text, connector_key text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT k.organization_id, k.store_id, k.default_source, k.secret, k.connector_key
  FROM intake_keys k
  JOIN stores s ON s.id = k.store_id AND s.deleted_at IS NULL AND s.status <> 'closed'
  JOIN organizations o ON o.id = k.organization_id AND o.deleted_at IS NULL
  WHERE k.token = p_token AND k.active = true AND k.revoked_at IS NULL;
$$;
