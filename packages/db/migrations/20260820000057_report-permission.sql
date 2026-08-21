-- 0057 — report:view joins the catalogue (F-55, reports-analytics.md).
--
-- Who reads the business's aggregate numbers is the matrix's answer, like
-- every other authority. Defaults follow the plan's route table (owner, gm,
-- sales_manager, fi_manager); a tenant can widen or narrow per organization.

INSERT INTO role_permissions (organization_id, role, permission)
SELECT o.id, d.role, d.permission
FROM organizations o
CROSS JOIN (VALUES
  ('owner','report:view'),
  ('gm','report:view'),
  ('sales_manager','report:view'),
  ('fi_manager','report:view')
) AS d(role, permission)
ON CONFLICT DO NOTHING;
