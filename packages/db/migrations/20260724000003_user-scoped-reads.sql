-- 0003 user-scoped reads (F-01): a signed-in user — transaction-local GUC
-- `app.user_id`, set by @dealpilot/db withUser — can READ the organizations,
-- stores, and memberships they belong to. Needed to list/pick an organization
-- before tenant context exists ("my organizations"). READS ONLY: the 0001
-- WITH CHECK clauses still require app.org_id for every write. Policies are
-- OR-ed with 0001's; with neither GUC set every comparison is NULL -> no rows
-- (fail closed). USING(true) stays banned (docs/SECURITY.md, D-022).
--
-- The membership subqueries are themselves RLS-checked against memberships —
-- membership_self_read below is exactly what makes the caller's own rows
-- visible inside them (same proven pattern as 0001's user_read).

CREATE POLICY membership_self_read ON memberships FOR SELECT
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- A user always sees their OWN users row. Also load-bearing for the create-org
-- upsert: INSERT ... ON CONFLICT additionally requires the NEW row to satisfy
-- the table's SELECT policies (proven live 2026-07-24 — 0001's user_read needs
-- a membership that cannot exist yet for a fresh signup).
CREATE POLICY user_self_read ON users FOR SELECT
  USING (id = NULLIF(current_setting('app.user_id', true), '')::uuid);

CREATE POLICY org_member_read ON organizations FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = organizations.id
      AND m.status = 'active'
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  ));

CREATE POLICY store_member_read ON stores FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = stores.organization_id
      AND m.status = 'active'
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  ));
