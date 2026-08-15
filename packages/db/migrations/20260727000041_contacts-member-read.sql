-- 0041 — contacts were unreadable by the people who own them.
--
-- `GET /api/v1/contacts/:id` and `PATCH /api/v1/contacts/:id` have returned 404
-- to EVERYONE since F-35, including the owner of the record. Not slow, not
-- occasionally — always.
--
-- Both routes resolve the contact's organisation first, under `withUser`, which
-- sets `app.user_id` and deliberately does NOT set `app.org_id` (the whole point
-- is to discover which org the row belongs to before trusting a caller-supplied
-- one). `contacts_isolation` keys on `app.org_id`, so under withUser its USING
-- clause evaluates `organization_id = NULL` — NULL, never true. No contact is
-- visible, the lookup throws not-found, and the route 404s.
--
-- `leads` and `deals` both carry a second SELECT policy for exactly this
-- traversal. `contacts` was created without one.
--
-- WHY THE TESTS WERE GREEN: the only F-35 cases exercising those two routes
-- assert that a RIVAL gets a 404. They passed for the wrong reason — the rival
-- got 404 because nobody can read a contact by id, which is also what the
-- legitimate owner got. An assertion that something is forbidden cannot tell
-- "correctly denied" from "broken for everyone"; it needs the positive case
-- beside it, which f36-deal-parties.test.ts now supplies.
--
-- Policies are permissive and OR together, so this widens SELECT only: writes
-- still go through contacts_isolation under withTenant.

CREATE POLICY contacts_member_read ON contacts FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = contacts.organization_id
      AND m.status = 'active'
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  ));

COMMENT ON POLICY contacts_member_read ON contacts IS
  'Lets an active member resolve a contact under withUser, the way lead_member_read and deal_member_read already do. Without it every read-by-id 404s.';
