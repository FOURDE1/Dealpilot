-- 0022 RBAC (A-13, owner decision D-033).
--
-- "There should be an RBAC controlling roles, and for each role what it can do
-- of actions." Until now every route carried its own small list of roles, so
-- the answer to "what can a BDC agent do?" existed only as a pattern spread
-- across thirty call sites. Nobody could read it and no screen could show it.
--
-- The matrix lives here, per organization, so a dealer group can decide that
-- ITS salespeople may waive a checklist item without that becoming true for
-- every tenant on the platform. Seeded from the defaults in
-- packages/schemas/src/permissions.ts, which stay the single source of truth
-- for what a permission IS.

CREATE TABLE role_permissions (
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  role             text NOT NULL,
  permission       text NOT NULL,
  allowed          boolean NOT NULL DEFAULT true,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, role, permission)
);

-- "Marc can also do X" — every dealership has these. An override can DENY as
-- well as grant: taking one capability away from one person is otherwise only
-- possible by changing their whole role, which changes it for everyone in it.
CREATE TABLE user_permissions (
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  user_id          uuid NOT NULL REFERENCES users(id),
  permission       text NOT NULL,
  allowed          boolean NOT NULL,
  -- Why this person is an exception. An unexplained exception is the kind of
  -- thing nobody dares remove three years later.
  reason           text CHECK (reason IS NULL OR btrim(reason) <> ''),
  granted_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id, permission)
);

CREATE INDEX idx_role_permissions_lookup ON role_permissions (organization_id, role) WHERE allowed;
CREATE INDEX idx_user_permissions_lookup ON user_permissions (organization_id, user_id);

CREATE TRIGGER role_permissions_updated_at BEFORE UPDATE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER user_permissions_updated_at BEFORE UPDATE ON user_permissions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON role_permissions TO dealpilot_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_permissions TO dealpilot_app;

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE user_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_permissions FORCE ROW LEVEL SECURITY;

CREATE POLICY role_permission_isolation ON role_permissions
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

CREATE POLICY user_permission_isolation ON user_permissions
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

/**
 * Does this person hold this permission in this organization?
 *
 * Order, and why:
 *   1. a per-user override wins outright — it is the most specific statement
 *      anyone has made about this person, and it can DENY;
 *   2. otherwise any of their roles granting it is enough (memberships are
 *      additive: a used-car manager who also sells keeps both sets);
 *   3. otherwise no. Deny by default — an unseeded organization grants nothing
 *      rather than everything, which is the safe direction to fail.
 *
 * SECURITY DEFINER so the check itself cannot be dodged by RLS context, and
 * STABLE so Postgres may cache it within a statement.
 */
CREATE FUNCTION has_permission(p_org uuid, p_user uuid, p_permission text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT COALESCE(
    (SELECT up.allowed FROM user_permissions up
      WHERE up.organization_id = p_org AND up.user_id = p_user
        AND up.permission = p_permission),
    EXISTS (
      SELECT 1
      FROM memberships m
      JOIN role_permissions rp
        ON rp.organization_id = m.organization_id
       AND rp.role = ANY(m.roles)
       AND rp.permission = p_permission
       AND rp.allowed
      WHERE m.organization_id = p_org
        AND m.user_id = p_user
        AND m.status = 'active'
    )
  );
$$;

REVOKE ALL ON FUNCTION has_permission(uuid, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION has_permission(uuid, uuid, text) TO dealpilot_app;

-- Seed every existing organization. New ones are seeded by the API when they
-- are created, from the same defaults.
INSERT INTO role_permissions (organization_id, role, permission)
SELECT o.id, d.role, d.permission
FROM organizations o
CROSS JOIN (VALUES
  ('owner','organization:update'),('owner','organization:delete'),
  ('owner','store:create'),('owner','store:update'),('owner','store:delete'),
  ('owner','store:configure_checklist'),
  ('owner','member:read'),('owner','member:invite'),('owner','member:update_roles'),('owner','member:revoke'),
  ('owner','lead:create'),('owner','lead:update'),('owner','lead:assign'),('owner','lead:delete'),
  ('owner','intake_key:manage'),
  ('owner','vehicle:create'),('owner','vehicle:update'),('owner','vehicle:delete'),
  ('owner','deal:create'),('owner','deal:update'),('owner','deal:change_stage'),('owner','deal:change_funding'),
  ('owner','checklist:complete'),('owner','checklist:waive'),('owner','checklist:sign_safety'),
  ('owner','checklist:correct_delivered'),
  ('owner','pay_plan:read'),('owner','pay_plan:write'),('owner','commission:read_all'),
  ('owner','dispatch:read'),('owner','dispatch:book'),('owner','dispatch:update'),('owner','fleet:manage'),
  ('owner','activity:read'),

  ('gm','organization:update'),
  ('gm','store:create'),('gm','store:update'),('gm','store:delete'),('gm','store:configure_checklist'),
  ('gm','member:read'),('gm','member:invite'),('gm','member:update_roles'),('gm','member:revoke'),
  ('gm','lead:create'),('gm','lead:update'),('gm','lead:assign'),('gm','lead:delete'),
  ('gm','intake_key:manage'),
  ('gm','vehicle:create'),('gm','vehicle:update'),('gm','vehicle:delete'),
  ('gm','deal:create'),('gm','deal:update'),('gm','deal:change_stage'),('gm','deal:change_funding'),
  ('gm','checklist:complete'),('gm','checklist:waive'),('gm','checklist:sign_safety'),
  ('gm','checklist:correct_delivered'),
  ('gm','pay_plan:read'),('gm','pay_plan:write'),('gm','commission:read_all'),
  ('gm','dispatch:read'),('gm','dispatch:book'),('gm','dispatch:update'),('gm','fleet:manage'),
  ('gm','activity:read'),

  ('sales_manager','member:read'),
  ('sales_manager','lead:create'),('sales_manager','lead:update'),('sales_manager','lead:assign'),('sales_manager','lead:delete'),
  ('sales_manager','vehicle:create'),('sales_manager','vehicle:update'),
  ('sales_manager','deal:create'),('sales_manager','deal:update'),('sales_manager','deal:change_stage'),
  ('sales_manager','checklist:complete'),('sales_manager','checklist:waive'),
  ('sales_manager','dispatch:read'),('sales_manager','dispatch:book'),
  ('sales_manager','activity:read'),

  ('used_car_manager','member:read'),
  ('used_car_manager','vehicle:create'),('used_car_manager','vehicle:update'),('used_car_manager','vehicle:delete'),
  ('used_car_manager','deal:update'),
  ('used_car_manager','checklist:complete'),
  ('used_car_manager','dispatch:read'),
  ('used_car_manager','activity:read'),

  ('fi_manager','member:read'),
  ('fi_manager','deal:update'),('fi_manager','deal:change_funding'),
  ('fi_manager','checklist:complete'),('fi_manager','checklist:waive'),
  ('fi_manager','pay_plan:read'),('fi_manager','commission:read_all'),
  ('fi_manager','activity:read'),

  ('salesperson','member:read'),
  ('salesperson','lead:create'),('salesperson','lead:update'),
  ('salesperson','deal:create'),('salesperson','deal:update'),('salesperson','deal:change_stage'),
  ('salesperson','checklist:complete'),
  ('salesperson','activity:read'),

  ('wholesale_manager','member:read'),
  ('wholesale_manager','vehicle:create'),('wholesale_manager','vehicle:update'),('wholesale_manager','vehicle:delete'),
  ('wholesale_manager','activity:read'),

  ('logistics','member:read'),
  ('logistics','dispatch:read'),('logistics','dispatch:book'),('logistics','dispatch:update'),('logistics','fleet:manage'),
  ('logistics','checklist:complete'),
  ('logistics','activity:read'),

  ('admin_office','member:read'),('admin_office','member:invite'),
  ('admin_office','member:update_roles'),('admin_office','member:revoke'),
  ('admin_office','lead:update'),
  ('admin_office','deal:update'),
  ('admin_office','checklist:complete'),
  ('admin_office','activity:read'),

  ('bdc_agent','member:read'),
  ('bdc_agent','lead:create'),('bdc_agent','lead:update'),('bdc_agent','lead:assign'),
  ('bdc_agent','activity:read')
) AS d(role, permission)
WHERE o.deleted_at IS NULL
ON CONFLICT DO NOTHING;
