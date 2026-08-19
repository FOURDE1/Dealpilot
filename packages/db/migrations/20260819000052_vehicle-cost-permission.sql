-- 0052 — vehicle:read_costs joins the catalogue (FR-TEN-006, D-052).
--
-- Cost visibility stopped being a hardcoded role list the day the A-13 drift
-- guard refused it: who may see the cost build-up is now the matrix's answer,
-- editable per organization like every other authority. The STORE scoping
-- stays in the vehicle serializer — a permission says WHO, the membership
-- that carries it says WHERE.

INSERT INTO role_permissions (organization_id, role, permission)
SELECT o.id, d.role, d.permission
FROM organizations o
CROSS JOIN (VALUES
  ('owner','vehicle:read_costs'),
  ('gm','vehicle:read_costs'),
  ('used_car_manager','vehicle:read_costs'),
  ('wholesale_manager','vehicle:read_costs')
) AS d(role, permission)
ON CONFLICT DO NOTHING;
