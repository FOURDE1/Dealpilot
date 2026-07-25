-- 0015 invitations (F-12, owner decision D-035 answered by delegation).
--
-- The hole this closes: adding a team member created a roster row against an
-- INVENTED user id and sent them nothing. If that person later signed up with
-- the same email they got a brand-new identity with no connection to the row,
-- so an invited member could never actually log in — while the Team screen said
-- they were Active and let you assign them leads.
--
-- The fix keeps identities honest: no domain user row exists until a real
-- person accepts. Until then the invitation IS the roster entry, and the team
-- list shows them as invited. That means you cannot assign work to someone who
-- has not accepted — which is correct, and is the visible change the owner was
-- asked about (D-035 option A).

CREATE TABLE invitations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  store_id         uuid,
  email            text NOT NULL CHECK (btrim(email) <> '' AND email = lower(email)),
  name             text,
  roles            text[] NOT NULL CHECK (cardinality(roles) > 0),

  -- The token is NEVER stored. Only its SHA-256, so a database read — a backup,
  -- a support query, a leak — cannot be turned into a working invitation link.
  token_hash       text NOT NULL UNIQUE CHECK (length(token_hash) = 64),

  invited_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at       timestamptz NOT NULL,
  -- Single use: set once, on acceptance. NULL means still open.
  accepted_at      timestamptz,
  accepted_user_id uuid REFERENCES users(id),
  revoked_at       timestamptz,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (organization_id, store_id) REFERENCES stores (organization_id, id),
  -- An acceptance needs both halves, or neither.
  CHECK ((accepted_at IS NULL) = (accepted_user_id IS NULL))
);

-- One OPEN invitation per email per org. A second invite to the same person
-- replaces the first rather than leaving two live links to the same seat.
CREATE UNIQUE INDEX idx_invitations_open_per_email
  ON invitations (organization_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX idx_invitations_org ON invitations (organization_id, created_at DESC);

CREATE TRIGGER invitations_updated_at BEFORE UPDATE ON invitations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE ON invitations TO dealpilot_app;

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;

CREATE POLICY invitation_isolation ON invitations
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- No user-keyed policy (see 0013): reads run under withTenant. Redeeming a
-- token happens BEFORE any org context exists, so it goes through the SECURITY
-- DEFINER function below rather than through a policy — the same shape F-03
-- uses to resolve an intake key.

-- Look up an open invitation by token hash, with no tenant context set. Returns
-- nothing for an unknown, expired, revoked or already-accepted token, so the
-- caller cannot tell those cases apart from a forged one.
CREATE FUNCTION invitation_resolve(p_hash text)
RETURNS TABLE (id uuid, organization_id uuid, store_id uuid, email text, roles text[], org_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT i.id, i.organization_id, i.store_id, i.email, i.roles, o.name
  FROM invitations i
  JOIN organizations o ON o.id = i.organization_id AND o.deleted_at IS NULL
  WHERE i.token_hash = p_hash
    AND i.accepted_at IS NULL
    AND i.revoked_at IS NULL
    AND i.expires_at > now();
$$;

REVOKE ALL ON FUNCTION invitation_resolve(text) FROM public;
GRANT EXECUTE ON FUNCTION invitation_resolve(text) TO dealpilot_app;

-- Claim an invitation and create the membership, atomically. SECURITY DEFINER
-- because the accepting person has no membership yet, so RLS would hide the
-- very row they are redeeming. Written as one statement chain so two clicks on
-- the same link cannot produce two memberships: the UPDATE ... WHERE
-- accepted_at IS NULL is the lock.
CREATE FUNCTION invitation_accept(p_hash text, p_user_id uuid, p_email text, p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv invitations%ROWTYPE;
  v_membership_id uuid;
BEGIN
  -- The domain user row FIRST: `invitations.accepted_user_id` references it, so
  -- claiming before the person exists trips the foreign key. This is also the
  -- 1:1 identity link (D-025) the old add-member flow could never establish —
  -- it has to happen inside this function because the accepting person holds no
  -- membership yet, so the users policies would hide the row they will own.
  -- Harmless if the claim below then fails: the row describes someone who
  -- genuinely signed up, they simply belong to no organization.
  INSERT INTO users (id, email, name, status)
  VALUES (p_user_id, lower(p_email), p_name, 'active')
  ON CONFLICT (id) DO UPDATE SET status = 'active';

  -- THE claim. Single-statement, so two clicks race here and exactly one wins.
  UPDATE invitations
     SET accepted_at = now(), accepted_user_id = p_user_id
   WHERE token_hash = p_hash
     AND accepted_at IS NULL
     AND revoked_at IS NULL
     AND expires_at > now()
  RETURNING * INTO v_inv;

  IF NOT FOUND THEN
    RETURN NULL;  -- unknown, expired, revoked, or already used
  END IF;

  INSERT INTO memberships (user_id, organization_id, store_id, roles, status)
  VALUES (p_user_id, v_inv.organization_id, v_inv.store_id, v_inv.roles, 'active')
  RETURNING id INTO v_membership_id;

  RETURN v_membership_id;
END;
$$;

REVOKE ALL ON FUNCTION invitation_accept(text, uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION invitation_accept(text, uuid, text, text) TO dealpilot_app;
