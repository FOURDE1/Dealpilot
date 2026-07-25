-- 0007 member visibility (F-04 review fix): a colleague's user row must stay
-- visible to their own organization even when the membership is not ACTIVE.
--
-- 0001's user_read requires an ACTIVE membership in app.org_id, which made
-- revocation a one-way door: once revoked, the row disappeared from the team
-- screen and the reinstate path 404'd before it could run (an admin could
-- neither see nor undo their own action). `invited` members were dropped the
-- same way. Same-org membership — whatever its status — is a legitimate
-- relationship, so admins may read the identity; WRITES are unchanged and
-- still require tenant context plus the role gate.

CREATE POLICY user_org_read ON users FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.user_id = users.id
      AND m.organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  ));
