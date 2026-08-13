-- 0034 — a member may find a conversation before its tenant is resolved.
--
-- Every detail route works the same way: resolve which organisation owns the id
-- under the CALLER's context, then do the work under the tenant's. 0031 gave
-- conversations only the org-keyed policy, so step one returned nothing — under
-- `withUser` there is no `app.org_id` yet, and the policy evaluates against
-- NULL. The console 404'd on its own conversations, and the cross-tenant test
-- passed for the wrong reason: everything 404'd for everybody.
--
-- Same shape as `lead_member_read` (0004), and the same reason it is safe: the
-- predicate correlates the membership to the ROW's organisation, so it can only
-- ever return rows of organisations the caller actually belongs to. What is
-- dangerous — and what the RLS coverage guard rejects — is `user_id =
-- app.user_id` with no organisation anywhere in the expression, which ignores
-- which tenant the request is scoped to.
--
-- SELECT only. Finding a conversation is not permission to change one; every
-- write still runs under `withTenant` behind `conversation:reply`.

CREATE POLICY conversation_member_read ON conversations FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = conversations.organization_id
      AND m.status = 'active'
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  ));
