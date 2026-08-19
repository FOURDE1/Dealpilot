-- 0047 — the index the assignment engine's capacity math stands on.
--
-- autoAssignLead (F-40) counts each active member's non-terminal leads with a
-- correlated subquery, and it runs on EVERY lead create — including the F-03
-- intake webhook, which holds a p99 < 1s ACK. leads had indexes on
-- (org, status), (org, store, created_at) and (org, created_at, id), but
-- nothing on assigned_to, so each count filtered without one: O(members ×
-- leads) on the money path. Found by the 2026-08-19 security audit as a
-- latency/DoS-adjacent gap, not by a slow query — the point is to never meet
-- the slow query.
--
-- Partial, matching the subquery's WHERE exactly, so the index stays small:
-- terminal and deleted leads are precisely the rows the count ignores.

CREATE INDEX idx_leads_assigned_active
  ON leads (organization_id, assigned_to)
  WHERE deleted_at IS NULL AND status NOT IN ('converted','lost','expired');
