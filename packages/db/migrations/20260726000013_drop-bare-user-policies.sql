-- 0013 — remove two permissive policies that grant pay rows on the CALLER alone.
--
-- `commission_self_read` and `pay_plan_self_read` say `user_id = app.user_id`
-- with no organization anywhere in the expression. Permissive policies OR
-- together, so under dual context (both GUCs set — the pattern F-04 already
-- uses for the members list) they return the caller's rows from EVERY
-- organization they belong to, whatever tenant the request was scoped to.
--
-- Nothing reads them: every commissions and pay-plan query runs under
-- withTenant, where `app.user_id` is unset and these evaluate to NULL. They are
-- latent risk with no current benefit — the same defect removed from F-08's
-- migration before it merged, kept consistent here.
--
-- Personal pay stays personal through the ROUTE, which is where it belongs:
-- /api/v1/commissions forces `user_id = <caller>` unless the caller holds a
-- PAY_READ_ROLE. That is a decision about people, not about rows, and it is
-- tested.
--
-- If a genuine "my pay across all my organizations" endpoint is ever wanted, do
-- NOT restore a bare user-keyed policy: query the caller's organizations first
-- and iterate them under withTenant, exactly as planOrg() already does.
-- `packages/db/src/rls-coverage.test.ts` fails if a bare user-keyed policy
-- reappears without being registered with a reason.

DROP POLICY IF EXISTS commission_self_read ON commissions;
DROP POLICY IF EXISTS pay_plan_self_read ON pay_plans;
