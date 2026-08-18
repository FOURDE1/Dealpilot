-- 0044 — appointments readable under withUser (F-38).
--
-- The console's list route runs under `withUser` — app.user_id set, app.org_id
-- deliberately not — and 0037 gave appointments only the org-keyed isolation
-- policy. Without this, the appointments board would render empty for every
-- member of every organisation, always: the third instance of the D-046 class
-- (contacts in 0041, deal_parties in 0043), and the second one written BEFORE
-- the route instead of after the 404s.
--
-- Permissive policies OR together: SELECT only. Writes still go through
-- appointments_isolation under withTenant.

CREATE POLICY appointments_member_read ON appointments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = appointments.organization_id
      AND m.status = 'active'
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  ));

COMMENT ON POLICY appointments_member_read ON appointments IS
  'Lets an active member read the board under withUser, the way lead/deal/contact/deal_parties member_read already do (D-046 class).';
