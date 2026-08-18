-- 0043 — deal_parties readable under withUser (FR-CON-006).
--
-- The deals list gains a contact_id filter ("every deal this customer is a
-- party to"), and that route runs under `withUser` — app.user_id set,
-- app.org_id deliberately not. `deal_parties` shipped in 0039 with only the
-- org-keyed isolation policy, so under withUser its EXISTS subquery sees zero
-- rows for EVERYONE and the filter silently returns no deals for any customer.
--
-- This is exactly the failure D-046 documents on contacts — GET/PATCH 404ing
-- for everybody because contacts_isolation keys on a GUC that withUser does not
-- set — caught this time BEFORE the route shipped, because the decision log
-- exists. leads, deals and contacts all carry this second SELECT policy;
-- deal_parties was created without one.
--
-- Permissive policies OR together: this widens SELECT only. Writes still go
-- through deal_parties_isolation under withTenant.

CREATE POLICY deal_parties_member_read ON deal_parties FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = deal_parties.organization_id
      AND m.status = 'active'
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  ));

COMMENT ON POLICY deal_parties_member_read ON deal_parties IS
  'Lets an active member resolve parties under withUser, the way lead/deal/contact member_read already do. Without it the deals contact_id filter returns nothing for everybody (D-046 class).';
