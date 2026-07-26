-- 0021 — accepting an invitation must work for someone who was on the team before.
--
-- REPORTED BY THE OWNER, 2026-07-26: he invited Marc, Marc accepted, he removed
-- Marc, then invited him again. The second acceptance failed with "The operation
-- failed. Please try again." — and the invitation was burned, because the claim
-- had already been marked accepted before the failure.
--
-- Cause: revoking a member does not delete the membership row, it sets
-- status='revoked' (deliberately — the roster must be able to show and reinstate
-- them). `memberships` is UNIQUE NULLS NOT DISTINCT (user_id, organization_id,
-- store_id), so the second accept's plain INSERT hit a duplicate key.
--
-- His diagnosis was right: "i think those problems are happing because of the
-- removed members listed after deleting".
--
-- Rejoining is a normal thing in a dealership — people leave and come back — so
-- accepting now reactivates the existing membership with the roles the new
-- invitation grants, and only inserts when there is nothing to reactivate.

CREATE OR REPLACE FUNCTION invitation_accept(p_hash text, p_user_id uuid, p_email text, p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inv invitations%ROWTYPE;
  v_membership_id uuid;
BEGIN
  -- The domain user row first: invitations.accepted_user_id references it.
  INSERT INTO users (id, email, name, status)
  VALUES (p_user_id, lower(p_email), p_name, 'active')
  ON CONFLICT (id) DO UPDATE SET status = 'active';

  -- THE claim. Single statement, so two clicks race here and exactly one wins.
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

  -- Rejoining: reactivate what is already there rather than colliding with it.
  -- The roles come from the NEW invitation, because that is the decision the
  -- person who re-invited them just made.
  UPDATE memberships
     SET status = 'active', roles = v_inv.roles
   WHERE user_id = p_user_id
     AND organization_id = v_inv.organization_id
     AND store_id IS NOT DISTINCT FROM v_inv.store_id
  RETURNING id INTO v_membership_id;

  IF v_membership_id IS NULL THEN
    INSERT INTO memberships (user_id, organization_id, store_id, roles, status)
    VALUES (p_user_id, v_inv.organization_id, v_inv.store_id, v_inv.roles, 'active')
    RETURNING id INTO v_membership_id;
  END IF;

  RETURN v_membership_id;
END;
$$;

REVOKE ALL ON FUNCTION invitation_accept(text, uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION invitation_accept(text, uuid, text, text) TO dealpilot_app;
