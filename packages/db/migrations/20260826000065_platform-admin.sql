-- 0065 — platform admin console, slice 1 (F-69; admin-console.md §2–§5.1, §12;
-- multi-tenancy.md §3/§6/§8; ADR-006/007/024).
--
-- What lands here and WHY it is one migration:
--   1. plans — the §5.1 catalogue, seeded with the reference tiers. Pricing is
--      data (ADR-024 amendment); the editor arrives with the billing slice.
--   2. organizations gains the §4.1 tenant columns. organizations IS the
--      tenant (multi-tenancy.md §3) — no 1:1 `tenants` table, because that
--      spec row presumes the Better Auth org plugin this repo rejected (D-025).
--   3. platform_staff — WHO is platform staff. Not a membership: memberships
--      hand out tenant RLS context (0003), which §2 forbids for staff, and the
--      roles CHECK (0001) admits only the ten tenant roles.
--   4. platform_audit_events — the immutable register for acts that have no
--      tenant to file under (staff grants). Tenant-scoped platform acts go to
--      activity_events like every other change to a tenant (§12 transparency).
--   5. activity_events.actor_type + restricted (§12).
--   6. The SECURITY DEFINER surface the console uses. Every function re-checks
--      the actor against platform_staff and writes its audit row in the SAME
--      transaction as the change (the F-10 discipline, 0014 header). The API
--      calls these on a bare pool connection — no app.org_id, no app.user_id —
--      which is what "platform staff never receive tenant RLS context" means
--      in practice: there is nothing on the connection for a policy to match.
--   7. The three cross-tenant scans learn the tenant lifecycle: intake
--      answers 410 for a suspended tenant, drips and task sweeps skip tenants
--      that are not operational.
--
-- RLS note: these functions read tenant tables as their OWNER. FORCE RLS
-- applies to owners; only a superuser or a BYPASSRLS role sees through it.
-- Locally the migration role `dealpilot` is a superuser (rls.test.ts). On RDS
-- the migration role MUST hold BYPASSRLS (docs/SECURITY.md). The same
-- dependency already carries intake_resolve, has_permission and
-- invitation_accept; packages/db/src/definer-owner.test.ts now asserts it.
-- Deliberately NOT worked around with set_config('app.org_id', …, true)
-- inside the functions: that setting is transaction-scoped, so it would
-- outlive the function and hand the API a tenant context it must never hold.

-- ---------------------------------------------------------------------------
-- 1. plans (admin-console.md §5.1)
-- ---------------------------------------------------------------------------
CREATE TABLE plans (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Canonical tier vocabulary = organizations.plan_tier CHECK (0001) = PlanTier.
  code                            text NOT NULL UNIQUE
                                  CHECK (code IN ('core','growth','scale','enterprise')),
  name                            text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 60),
  -- NULL = negotiated per contract (enterprise); the number lives in Stripe.
  monthly_price_cents_per_store   integer CHECK (monthly_price_cents_per_store IS NULL OR monthly_price_cents_per_store >= 0),
  -- NULL = unlimited (Scale, Enterprise).
  included_seats                  integer CHECK (included_seats IS NULL OR included_seats > 0),
  included_ai_minutes             integer NOT NULL DEFAULT 0 CHECK (included_ai_minutes >= 0),
  included_sms_segments           integer NOT NULL DEFAULT 0 CHECK (included_sms_segments >= 0),
  included_ai_conversations       integer NOT NULL DEFAULT 0 CHECK (included_ai_conversations >= 0),
  -- Not in the §5.1 reference table: NULL = unlimited, numbers are OWNER placeholders (O-3).
  included_storage_gb             integer CHECK (included_storage_gb IS NULL OR included_storage_gb >= 0),
  -- Boolean entitlements only (§5.3). Shape is enforced by the Zod schema;
  -- the plan editor slice adds a trigger when writes become possible.
  features                        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(features) = 'object'),
  -- The §5.1 "Overage" row: needed by ADR-011 layer 3 later, declared now so
  -- the seed is complete and the tier table has one source.
  overage                         text NOT NULL DEFAULT 'hard_stop' CHECK (overage IN ('hard_stop','metered')),
  active                          boolean NOT NULL DEFAULT true,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER plans_updated_at BEFORE UPDATE ON plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Reference data, no organization_id, so no tenant predicate exists to write
-- and rls-coverage does not (and should not) ask for one. SELECT only for the
-- app role: the plan_tier sync trigger below runs as the inserting role and
-- must read the catalogue; nothing the app connects as can reprice anything.
GRANT SELECT ON plans TO dealpilot_app;

INSERT INTO plans (code, name, monthly_price_cents_per_store, included_seats, included_ai_minutes,
                   included_sms_segments, included_ai_conversations, included_storage_gb, features, overage) VALUES
  ('core',       'Core',       30000, 10,   0,    2000,  200,  10,
   '{"custom_domain":false,"api_access":false,"wholesale_module":false,"ai_voice":false}', 'hard_stop'),
  ('growth',     'Growth',     50000, 25,   300,  7500,  750,  50,
   '{"custom_domain":true,"api_access":true,"wholesale_module":true,"ai_voice":true}',     'metered'),
  ('scale',      'Scale',      80000, NULL, 1000, 20000, 2000, 200,
   '{"custom_domain":true,"api_access":true,"wholesale_module":true,"ai_voice":true}',     'metered'),
  ('enterprise', 'Enterprise', NULL,  NULL, 1000, 20000, 2000, NULL,
   '{"custom_domain":true,"api_access":true,"wholesale_module":true,"ai_voice":true}',     'metered');

COMMENT ON TABLE plans IS
  'Plan catalogue (admin-console.md §5.1). Pricing is data, not code (ADR-024 amendment); Stripe sync and the editor are the billing slice. Seed numbers absent from §5.1 are owner placeholders (docs/OWNER-DECISIONS-PENDING.md).';

-- ---------------------------------------------------------------------------
-- 2. organizations = the tenant (admin-console.md §4.1)
-- ---------------------------------------------------------------------------
ALTER TABLE organizations
  ADD COLUMN plan_id               uuid REFERENCES plans(id),
  -- Invoices, PDFs, consent records. Nullable: self-serve orgs (F-01) never
  -- supplied one, and defaulting it to the display name would assert a legal
  -- fact nobody stated.
  ADD COLUMN legal_name            text CHECK (legal_name IS NULL OR (btrim(legal_name) <> '' AND length(legal_name) <= 200)),
  -- Same 13 codes as stores.province (0001) so ProvinceCA has a superset home.
  ADD COLUMN province              text CHECK (province IS NULL OR province IN ('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT')),
  -- Law 25 privacy officer (localization-and-legal.md).
  ADD COLUMN privacy_officer_name  text CHECK (privacy_officer_name IS NULL OR (btrim(privacy_officer_name) <> '' AND length(privacy_officer_name) <= 120)),
  ADD COLUMN privacy_officer_email text CHECK (privacy_officer_email IS NULL OR (privacy_officer_email = lower(btrim(privacy_officer_email)) AND position('@' IN privacy_officer_email) > 1 AND length(privacy_officer_email) <= 254)),
  -- Stamped by the lifecycle: first entry into 'active', last entry into 'suspended'.
  ADD COLUMN activated_at          timestamptz,
  ADD COLUMN suspended_at          timestamptz;

COMMENT ON COLUMN organizations.name IS
  'Display name (admin-console.md §4.1 display_name). tenant_branding may override what the tenant surface paints; this is what the platform and invitations use.';
COMMENT ON COLUMN organizations.status IS
  'Lifecycle (admin-console.md §4.2 on multi-tenancy.md §3 vocabulary): the spec''s prospect arrives with provisioning (slice 2); churned = offboarding then purged.';

-- Backfill from the tier column every existing reader already uses.
UPDATE organizations o SET plan_id = p.id FROM plans p WHERE p.code = o.plan_tier AND o.plan_id IS NULL;
ALTER TABLE organizations ALTER COLUMN plan_id SET NOT NULL;
UPDATE organizations SET activated_at = created_at WHERE status = 'active' AND activated_at IS NULL;
UPDATE organizations SET suspended_at = updated_at WHERE status = 'suspended' AND suspended_at IS NULL;

ALTER TABLE organizations
  ADD CONSTRAINT organizations_suspended_stamp CHECK (status <> 'suspended' OR suspended_at IS NOT NULL);

-- plan_id is the truth; plan_tier stays as a TRIGGER-MAINTAINED cache of
-- plans.code because ~60 readers (schemas, web labels, tests) use it and
-- §5.1 says the two vocabularies are one. F-01's self-serve INSERT sets
-- neither (DB defaults), so INSERT derives plan_id from plan_tier's default.
-- The trigger runs as the inserting role — hence the SELECT grant on plans.
CREATE FUNCTION organizations_sync_plan() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.plan_id IS NULL THEN
      SELECT id INTO NEW.plan_id FROM plans WHERE code = COALESCE(NEW.plan_tier, 'core');
    END IF;
    -- "First entry into active": an organization BORN active (the self-serve
    -- default, 0001) enters it at creation (review) — otherwise every tenant
    -- created after 0065 would read "Activated: never".
    IF NEW.status = 'active' AND NEW.activated_at IS NULL THEN
      NEW.activated_at := now();
    END IF;
  ELSIF NEW.plan_id IS DISTINCT FROM OLD.plan_id THEN
    NULL; -- plan_id moved: plan_tier follows below
  ELSIF NEW.plan_tier IS DISTINCT FROM OLD.plan_tier THEN
    SELECT id INTO NEW.plan_id FROM plans WHERE code = NEW.plan_tier;
  END IF;
  SELECT code INTO NEW.plan_tier FROM plans WHERE id = NEW.plan_id;
  IF NEW.plan_tier IS NULL THEN
    RAISE EXCEPTION 'organizations.plan_id % names no plan', NEW.plan_id USING ERRCODE = 'PA007';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER organizations_sync_plan BEFORE INSERT OR UPDATE OF plan_id, plan_tier ON organizations
  FOR EACH ROW EXECUTE FUNCTION organizations_sync_plan();

-- The directory's keyset (created_at, id) DESC with the status filter in front.
CREATE INDEX idx_organizations_directory ON organizations (status, created_at DESC, id DESC);

-- ---------------------------------------------------------------------------
-- 3. platform_staff (admin-console.md §3)
-- ---------------------------------------------------------------------------
-- Privilege-only table: dealpilot_app holds NO grant, so the definers below
-- are the only door. No RLS on purpose — identity must not depend on the
-- owner's RLS bypass, and there is no tenant predicate to write anyway.
CREATE TABLE platform_staff (
  user_id     uuid PRIMARY KEY REFERENCES users(id),
  role        text NOT NULL CHECK (role IN ('platform_super_admin','platform_support','platform_billing')),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  note        text CHECK (note IS NULL OR (btrim(note) <> '' AND length(note) <= 500)),
  granted_by  uuid REFERENCES users(id) ON DELETE SET NULL,   -- NULL = CLI bootstrap
  granted_at  timestamptz NOT NULL DEFAULT now(),
  revoked_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);

CREATE TRIGGER platform_staff_updated_at BEFORE UPDATE ON platform_staff
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_platform_staff_active ON platform_staff (role) WHERE status = 'active';

COMMENT ON TABLE platform_staff IS
  'ReadyLoans platform staff (admin-console.md §3). Identity = a Better Auth account (users.id 1:1, D-025); authority = this row; never a tenant membership. Written only by platform_staff_grant()/platform_staff_revoke().';

-- ---------------------------------------------------------------------------
-- 4. platform_audit_events (§12 for acts with no tenant)
-- ---------------------------------------------------------------------------
CREATE TABLE platform_audit_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq             bigint GENERATED ALWAYS AS IDENTITY,
  actor_user_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_type      text NOT NULL CHECK (actor_type IN ('platform','system')),
  event           text NOT NULL CHECK (event IN ('staff.granted','staff.role_changed','staff.reinstated','staff.revoked')),
  target_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  changes         jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason          text CHECK (reason IS NULL OR btrim(reason) <> ''),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((actor_type = 'platform') = (actor_user_id IS NOT NULL))
);

CREATE INDEX idx_platform_audit_target ON platform_audit_events (target_user_id, seq DESC);

-- Append-only by trigger AND by grant (the app role has none): the register
-- of who was made platform staff must survive the person who could edit it.
CREATE FUNCTION platform_audit_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'platform_audit_events is append-only' USING ERRCODE = 'PA000';
END $$;

CREATE TRIGGER platform_audit_no_rewrite BEFORE UPDATE OR DELETE ON platform_audit_events
  FOR EACH ROW EXECUTE FUNCTION platform_audit_immutable();

-- ---------------------------------------------------------------------------
-- 5. activity_events: actor_type + restricted (§12)
-- ---------------------------------------------------------------------------
-- 'ai' is deliberately absent until its first producer exists (the
-- dead-vocabulary rule); adding it is a one-line forward CHECK swap then.
ALTER TABLE activity_events
  ADD COLUMN actor_type text CHECK (actor_type IN ('tenant','platform','system')),
  -- §12: a suspended-investigation event the tenant must not see. Every
  -- tenant-facing reader of this table filters NOT restricted (today: the
  -- F-10 list route). A second reader must do the same — see the COMMENT.
  ADD COLUMN restricted boolean NOT NULL DEFAULT false;

-- Owner-run relabel of existing rows from a fact they already carry
-- (actor_user_id NULL = the system acted, 0014). No fact is rewritten; the
-- app role still holds no UPDATE (0014).
UPDATE activity_events SET actor_type = CASE WHEN actor_user_id IS NULL THEN 'system' ELSE 'tenant' END;
ALTER TABLE activity_events ALTER COLUMN actor_type SET NOT NULL;

-- A platform act always names its staffer; a system act never names anyone.
ALTER TABLE activity_events
  ADD CONSTRAINT activity_events_actor_consistency
  CHECK ((actor_type = 'system') = (actor_user_id IS NULL));

-- Safety net for any INSERT that predates the column (recordEvent passes it
-- explicitly; this covers a future writer that forgets).
CREATE FUNCTION activity_events_default_actor_type() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.actor_type IS NULL THEN
    NEW.actor_type := CASE WHEN NEW.actor_user_id IS NULL THEN 'system' ELSE 'tenant' END;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER activity_events_default_actor_type BEFORE INSERT ON activity_events
  FOR EACH ROW EXECUTE FUNCTION activity_events_default_actor_type();

CREATE INDEX idx_activity_platform ON activity_events (organization_id, seq DESC) WHERE actor_type = 'platform';

COMMENT ON COLUMN activity_events.restricted IS
  'admin-console.md §12: hidden from every tenant-facing reader (GET /api/v1/activity filters NOT restricted). Only platform reads see it.';

-- ---------------------------------------------------------------------------
-- 6. The definer surface. Shape = has_permission (0022) / invitation_accept
--    (0015): SECURITY DEFINER, search_path pinned, REVOKE from PUBLIC, GRANT
--    EXECUTE to dealpilot_app only where the API calls it.
--    Error contract (SQLSTATE → HTTP in apps/api/src/platform.ts):
--      PA001 not platform staff        → 404 not_found
--      PA002 tenant not found          → 404 not_found
--      PA003 last super admin          → 409 last_super_admin
--      PA004 illegal transition        → 409 invalid_transition
--      PA005 stale status (CAS)        → 409 stale_status
--      PA006 cannot revoke self        → 422 cannot_revoke_self
--      PA007 unknown/inactive plan     → 422 unknown_plan
--      PA008 no account for that email → 422 needs_account
--      PA009 role lacks the capability → 403 forbidden
--      PA010 bootstrap closed          → CLI only
-- ---------------------------------------------------------------------------

-- Internal: the actor check every write shares. No grant to the app role —
-- callable only from inside the other definers (which run as the owner).
CREATE FUNCTION platform_assert_actor(p_actor uuid, p_roles text[]) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role text;
BEGIN
  SELECT role INTO v_role FROM platform_staff WHERE user_id = p_actor AND status = 'active';
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'not platform staff' USING ERRCODE = 'PA001';
  END IF;
  IF NOT (v_role = ANY (p_roles)) THEN
    RAISE EXCEPTION 'platform role % may not do this', v_role USING ERRCODE = 'PA009';
  END IF;
  RETURN v_role;
END $$;
REVOKE ALL ON FUNCTION platform_assert_actor(uuid, text[]) FROM PUBLIC;

-- The per-request identity read behind the /api/v1/admin/* gate: role, MFA
-- enrolment, and when THIS session was minted (the re-auth clock; Better Auth
-- refreshes expiresAt/updatedAt only — verified against 1.6.25).
CREATE FUNCTION platform_identity(p_user uuid, p_session_id text)
RETURNS TABLE (role text, mfa_enabled boolean, session_created_at timestamptz)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT ps.role, COALESCE(u."twoFactorEnabled", false), s."createdAt"
  FROM platform_staff ps
  JOIN "user" u ON u.id = ps.user_id::text
  LEFT JOIN "session" s ON s.id = p_session_id AND s."userId" = u.id
  WHERE ps.user_id = p_user AND ps.status = 'active';
$$;
REVOKE ALL ON FUNCTION platform_identity(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_identity(uuid, text) TO dealpilot_app;

-- §4.2 as a table-valued constant. The SQL copy of packages/core
-- TENANT_TRANSITIONS; apps/api/src/tenant-lifecycle-drift.test.ts diffs them.
CREATE FUNCTION tenant_transitions() RETURNS TABLE (from_status text, to_status text)
LANGUAGE sql IMMUTABLE AS $$
  VALUES
    ('trial',       'active'),      -- first payment (manual until Stripe)
    ('trial',       'suspended'),
    ('active',      'past_due'),    -- invoice.payment_failed (manual until Stripe)
    ('active',      'suspended'),
    ('past_due',    'active'),      -- payment recovered inside the grace window
    ('past_due',    'read_only'),   -- grace expired (manual until the dunning worker)
    ('past_due',    'suspended'),
    ('read_only',   'active'),      -- immediate restore
    ('read_only',   'suspended'),
    ('read_only',   'offboarding'), -- churn confirmed
    ('suspended',   'active'),      -- reinstatement (addition: wrongful suspension)
    ('suspended',   'offboarding'), -- churn confirmed
    ('offboarding', 'active')       -- reinstatement before purge (addition, O-7)
    -- offboarding → purged is the retention slice's purge job, never a console act (ADR-024).
$$;
REVOKE ALL ON FUNCTION tenant_transitions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_transitions() TO dealpilot_app;

-- Directory. Keyset (created_at, id) DESC; created_at_text is the cursor key
-- (microsecond-exact — the f01 lesson). Returns p_limit + 1 rows so the
-- route knows whether a next page exists. NEVER returns lead/contact/deal data.
CREATE FUNCTION admin_list_tenants(
  p_actor uuid, p_status text, p_plan_code text, p_q text,
  p_cursor_created timestamptz, p_cursor_id uuid, p_limit integer)
RETURNS TABLE (
  id uuid, name text, slug text, legal_name text, status text, plan_id uuid, plan_code text,
  province text, default_locale text, store_count integer, member_count integer,
  created_at timestamptz, created_at_text text, activated_at timestamptz, suspended_at timestamptz,
  deleted_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
DECLARE
  -- The search is TEXT, not a pattern (review): '%' and '_' in what the
  -- staffer typed match themselves, never everything.
  v_q text := CASE WHEN p_q IS NULL THEN NULL
              ELSE '%' || replace(replace(replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%' END;
BEGIN
  PERFORM platform_assert_actor(p_actor, ARRAY['platform_super_admin','platform_support','platform_billing']);
  RETURN QUERY
  SELECT o.id, o.name, o.slug, o.legal_name, o.status, o.plan_id, o.plan_tier,
         o.province, o.default_locale,
         (SELECT count(*)::integer FROM stores s WHERE s.organization_id = o.id AND s.deleted_at IS NULL),
         (SELECT count(*)::integer FROM memberships m WHERE m.organization_id = o.id AND m.status = 'active'),
         o.created_at, o.created_at::text, o.activated_at, o.suspended_at, o.deleted_at
  FROM organizations o
  WHERE (p_status IS NULL OR o.status = p_status)
    AND (p_plan_code IS NULL OR o.plan_tier = p_plan_code)
    AND (v_q IS NULL OR o.name ILIKE v_q ESCAPE '\' OR o.slug ILIKE v_q ESCAPE '\'
         OR o.legal_name ILIKE v_q ESCAPE '\')
    AND (p_cursor_created IS NULL OR (o.created_at, o.id) < (p_cursor_created, p_cursor_id))
  ORDER BY o.created_at DESC, o.id DESC
  LIMIT p_limit + 1;
END $$;
REVOKE ALL ON FUNCTION admin_list_tenants(uuid, text, text, text, timestamptz, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_list_tenants(uuid, text, text, text, timestamptz, uuid, integer) TO dealpilot_app;

-- One tenant, with what the detail page needs and nothing a rival would want.
CREATE FUNCTION admin_get_tenant(p_actor uuid, p_org uuid)
RETURNS TABLE (
  id uuid, name text, slug text, legal_name text, status text, plan_id uuid, plan_code text,
  province text, default_locale text, store_count integer, member_count integer,
  created_at timestamptz, created_at_text text, activated_at timestamptz, suspended_at timestamptz,
  deleted_at timestamptz,
  privacy_officer_name text, privacy_officer_email text, stripe_customer_id text,
  stores jsonb, owner_emails text[], last_activity_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM platform_assert_actor(p_actor, ARRAY['platform_super_admin','platform_support','platform_billing']);
  RETURN QUERY
  SELECT o.id, o.name, o.slug, o.legal_name, o.status, o.plan_id, o.plan_tier,
         o.province, o.default_locale,
         (SELECT count(*)::integer FROM stores s WHERE s.organization_id = o.id AND s.deleted_at IS NULL),
         (SELECT count(*)::integer FROM memberships m WHERE m.organization_id = o.id AND m.status = 'active'),
         o.created_at, o.created_at::text, o.activated_at, o.suspended_at, o.deleted_at,
         o.privacy_officer_name, o.privacy_officer_email, o.stripe_customer_id,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'code', s.code,
                                                        'province', s.province, 'status', s.status)
                                    ORDER BY s.code)
                   FROM stores s WHERE s.organization_id = o.id AND s.deleted_at IS NULL), '[]'::jsonb),
         COALESCE((SELECT array_agg(u.email ORDER BY u.email)
                   FROM memberships m JOIN users u ON u.id = m.user_id
                   WHERE m.organization_id = o.id AND m.status = 'active' AND 'owner' = ANY (m.roles)),
                  ARRAY[]::text[]),
         (SELECT max(a.created_at) FROM activity_events a WHERE a.organization_id = o.id)
  FROM organizations o
  WHERE o.id = p_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenant not found' USING ERRCODE = 'PA002';
  END IF;
END $$;
REVOKE ALL ON FUNCTION admin_get_tenant(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_get_tenant(uuid, uuid) TO dealpilot_app;

-- The organization's own events plus every platform act on it, restricted
-- rows included — the platform side sees the whole trail.
CREATE FUNCTION admin_tenant_events(p_actor uuid, p_org uuid, p_limit integer)
RETURNS TABLE (
  id uuid, organization_id uuid, store_id uuid, actor_user_id uuid, actor_type text, actor_email text,
  entity_type text, entity_id uuid, action text, changes jsonb, reason text,
  parent_entity_type text, parent_entity_id uuid, restricted boolean, created_at timestamptz, seq bigint)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM platform_assert_actor(p_actor, ARRAY['platform_super_admin','platform_support','platform_billing']);
  RETURN QUERY
  SELECT a.id, a.organization_id, a.store_id, a.actor_user_id, a.actor_type, u.email,
         a.entity_type, a.entity_id, a.action, a.changes, a.reason,
         a.parent_entity_type, a.parent_entity_id, a.restricted, a.created_at, a.seq
  FROM activity_events a
  LEFT JOIN users u ON u.id = a.actor_user_id
  WHERE a.organization_id = p_org
    AND (a.entity_type = 'organization' OR a.actor_type = 'platform')
  ORDER BY a.seq DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 200);
END $$;
REVOKE ALL ON FUNCTION admin_tenant_events(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_tenant_events(uuid, uuid, integer) TO dealpilot_app;

-- Profile edit. Whitelisted keys only; JSON null clears a nullable field;
-- absent = unchanged. plan_id needs super_admin OR billing (§3 "edit plans");
-- every other key needs super_admin. One activity row, only when something
-- actually changed (noise is what makes a trail stop being read).
CREATE FUNCTION admin_update_tenant(p_actor uuid, p_org uuid, p_patch jsonb, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_role text;
  v_old organizations%ROWTYPE;
  v_new organizations%ROWTYPE;
  v_changes jsonb := '{}'::jsonb;
  v_key text;
  v_allowed text[] := ARRAY['name','legal_name','province','privacy_officer_name','privacy_officer_email','default_locale','plan_id'];
BEGIN
  v_role := platform_assert_actor(p_actor, ARRAY['platform_super_admin','platform_billing']);
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN
      RAISE EXCEPTION 'unknown field %', v_key USING ERRCODE = '22023';
    END IF;
    IF v_key <> 'plan_id' AND v_role <> 'platform_super_admin' THEN
      RAISE EXCEPTION 'platform role % may only change plan_id', v_role USING ERRCODE = 'PA009';
    END IF;
  END LOOP;

  SELECT * INTO v_old FROM organizations WHERE id = p_org AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'tenant not found' USING ERRCODE = 'PA002'; END IF;

  IF p_patch ? 'plan_id' AND NOT EXISTS (
       SELECT 1 FROM plans WHERE id = (p_patch->>'plan_id')::uuid AND active) THEN
    RAISE EXCEPTION 'unknown or inactive plan' USING ERRCODE = 'PA007';
  END IF;

  UPDATE organizations SET
    name                  = CASE WHEN p_patch ? 'name'                  THEN p_patch->>'name'                  ELSE name END,
    legal_name            = CASE WHEN p_patch ? 'legal_name'            THEN p_patch->>'legal_name'            ELSE legal_name END,
    province              = CASE WHEN p_patch ? 'province'              THEN p_patch->>'province'              ELSE province END,
    privacy_officer_name  = CASE WHEN p_patch ? 'privacy_officer_name'  THEN p_patch->>'privacy_officer_name'  ELSE privacy_officer_name END,
    privacy_officer_email = CASE WHEN p_patch ? 'privacy_officer_email' THEN lower(btrim(p_patch->>'privacy_officer_email')) ELSE privacy_officer_email END,
    default_locale        = CASE WHEN p_patch ? 'default_locale'        THEN p_patch->>'default_locale'        ELSE default_locale END,
    plan_id               = CASE WHEN p_patch ? 'plan_id'               THEN (p_patch->>'plan_id')::uuid       ELSE plan_id END
  WHERE id = p_org
  RETURNING * INTO v_new;

  FOR v_key IN SELECT unnest(v_allowed) LOOP
    IF row_to_json(v_old)->>v_key IS DISTINCT FROM row_to_json(v_new)->>v_key THEN
      v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object(
        'from', row_to_json(v_old)->v_key, 'to', row_to_json(v_new)->v_key));
    END IF;
  END LOOP;
  -- plan_tier moved with plan_id (trigger); report the readable code too.
  IF v_old.plan_tier IS DISTINCT FROM v_new.plan_tier THEN
    v_changes := v_changes || jsonb_build_object('plan_tier', jsonb_build_object('from', v_old.plan_tier, 'to', v_new.plan_tier));
  END IF;

  IF v_changes <> '{}'::jsonb THEN
    INSERT INTO activity_events (organization_id, actor_user_id, actor_type, entity_type, entity_id, action, changes, reason, restricted)
    VALUES (p_org, p_actor, 'platform', 'organization', p_org, 'updated', v_changes, NULLIF(btrim(p_reason), ''), false);
  END IF;
END $$;
REVOKE ALL ON FUNCTION admin_update_tenant(uuid, uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_update_tenant(uuid, uuid, jsonb, text) TO dealpilot_app;

-- Lifecycle transition (§4.2). Legality is decided HERE against
-- tenant_transitions() — the API consults the same matrix for the UI, but a
-- direct caller of this function gets the same refusal. Compare-and-swap on
-- p_expected_from when given. Suspension and offboarding delete every active
-- member's Better Auth session in the same transaction (ADR-006 per-tenant
-- revocation; DB-backed sessions, no cookie cache → next request is 401).
CREATE FUNCTION admin_set_tenant_status(
  p_actor uuid, p_org uuid, p_to text, p_expected_from text, p_reason text, p_restricted boolean)
RETURNS TABLE (from_status text, to_status text, sessions_revoked integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_from text;
  v_count integer := 0;
BEGIN
  PERFORM platform_assert_actor(p_actor, ARRAY['platform_super_admin']);
  IF btrim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'reason required' USING ERRCODE = '23514';
  END IF;
  SELECT o.status INTO v_from FROM organizations o WHERE o.id = p_org AND o.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'tenant not found' USING ERRCODE = 'PA002'; END IF;
  IF p_expected_from IS NOT NULL AND p_expected_from <> v_from THEN
    RAISE EXCEPTION 'status is % not %', v_from, p_expected_from USING ERRCODE = 'PA005';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tenant_transitions() t WHERE t.from_status = v_from AND t.to_status = p_to) THEN
    RAISE EXCEPTION '%->%', v_from, p_to USING ERRCODE = 'PA004';
  END IF;

  UPDATE organizations SET
    status       = p_to,
    activated_at = CASE WHEN p_to = 'active'    THEN COALESCE(activated_at, now()) ELSE activated_at END,
    suspended_at = CASE WHEN p_to = 'suspended' THEN now() ELSE suspended_at END
  WHERE id = p_org;

  IF p_to IN ('suspended', 'offboarding') THEN
    DELETE FROM "session"
    WHERE "userId" IN (SELECT m.user_id::text FROM memberships m
                       WHERE m.organization_id = p_org AND m.status = 'active');
    GET DIAGNOSTICS v_count = ROW_COUNT;
  END IF;

  INSERT INTO activity_events (organization_id, actor_user_id, actor_type, entity_type, entity_id, action, changes, reason, restricted)
  VALUES (p_org, p_actor, 'platform', 'organization', p_org, 'updated',
          jsonb_build_object('status', jsonb_build_object('from', v_from, 'to', p_to)),
          btrim(p_reason), COALESCE(p_restricted, false) AND p_to = 'suspended');

  RETURN QUERY SELECT v_from, p_to, v_count;
END $$;
REVOKE ALL ON FUNCTION admin_set_tenant_status(uuid, uuid, text, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_set_tenant_status(uuid, uuid, text, text, text, boolean) TO dealpilot_app;

-- Staff roster (super_admin). Revoked rows included: a wrongly revoked
-- colleague must be visible to reinstate.
CREATE FUNCTION platform_staff_list(p_actor uuid)
RETURNS TABLE (user_id uuid, email text, name text, role text, status text, mfa_enabled boolean,
               granted_at timestamptz, revoked_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM platform_assert_actor(p_actor, ARRAY['platform_super_admin']);
  RETURN QUERY
  SELECT ps.user_id, u.email, u.name, ps.role, ps.status, COALESCE(u."twoFactorEnabled", false),
         ps.granted_at, ps.revoked_at
  FROM platform_staff ps
  JOIN "user" u ON u.id = ps.user_id::text
  ORDER BY ps.status, u.email;
END $$;
REVOKE ALL ON FUNCTION platform_staff_list(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_staff_list(uuid) TO dealpilot_app;

-- Grant / re-role / reinstate, one upsert. The person must already have a
-- Better Auth account (same rule as F-04's needs_invitation: staff sign up
-- like anyone, authority is granted afterwards). p_actor NULL is the CLI
-- bootstrap and is legal ONLY while no active super admin exists.
CREATE FUNCTION platform_staff_grant(p_actor uuid, p_email text, p_role text, p_note text)
RETURNS TABLE (user_id uuid, outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid;
  v_name text;
  v_email text := lower(btrim(p_email));
  v_old platform_staff%ROWTYPE;
  v_outcome text;
BEGIN
  IF p_actor IS NULL THEN
    IF EXISTS (SELECT 1 FROM platform_staff WHERE role = 'platform_super_admin' AND status = 'active') THEN
      RAISE EXCEPTION 'bootstrap closed: an active platform_super_admin already exists' USING ERRCODE = 'PA010';
    END IF;
  ELSE
    PERFORM platform_assert_actor(p_actor, ARRAY['platform_super_admin']);
  END IF;

  SELECT u.id::uuid, u.name INTO v_uid, v_name FROM "user" u WHERE lower(u.email) = v_email;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'no account for %', v_email USING ERRCODE = 'PA008';
  END IF;

  -- The domain users row (D-025 1:1 link) — the FK target for platform_staff
  -- and for activity_events.actor_user_id. Same upsert as invitation_accept.
  INSERT INTO users (id, email, name, status) VALUES (v_uid, v_email, v_name, 'active')
  ON CONFLICT (id) DO NOTHING;

  SELECT * INTO v_old FROM platform_staff WHERE platform_staff.user_id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO platform_staff (user_id, role, status, note, granted_by)
    VALUES (v_uid, p_role, 'active', NULLIF(btrim(p_note), ''), p_actor);
    v_outcome := 'granted';
  ELSIF v_old.status = 'revoked' THEN
    UPDATE platform_staff SET role = p_role, status = 'active', note = NULLIF(btrim(p_note), ''),
           granted_by = p_actor, granted_at = now(), revoked_by = NULL, revoked_at = NULL
    WHERE platform_staff.user_id = v_uid;
    v_outcome := 'reinstated';
  ELSIF v_old.role <> p_role THEN
    -- Demoting the LAST super admin locks the console and reopens the CLI
    -- bootstrap (review): the F-04 last-owner rule, with the surviving rows
    -- locked so two concurrent demotions cannot both see "another exists".
    IF v_old.role = 'platform_super_admin' AND p_role <> 'platform_super_admin' THEN
      PERFORM 1 FROM platform_staff
       WHERE role = 'platform_super_admin' AND status = 'active' AND platform_staff.user_id <> v_uid
       FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'last platform_super_admin' USING ERRCODE = 'PA003';
      END IF;
    END IF;
    UPDATE platform_staff SET role = p_role, note = COALESCE(NULLIF(btrim(p_note), ''), note),
           granted_by = p_actor, granted_at = now()
    WHERE platform_staff.user_id = v_uid;
    v_outcome := 'role_changed';
  ELSE
    v_outcome := 'unchanged';
  END IF;

  IF v_outcome <> 'unchanged' THEN
    INSERT INTO platform_audit_events (actor_user_id, actor_type, event, target_user_id, changes, reason)
    VALUES (p_actor, CASE WHEN p_actor IS NULL THEN 'system' ELSE 'platform' END,
            CASE v_outcome WHEN 'granted' THEN 'staff.granted' WHEN 'reinstated' THEN 'staff.reinstated' ELSE 'staff.role_changed' END,
            v_uid,
            jsonb_build_object('role', jsonb_build_object('from', v_old.role, 'to', p_role)),
            NULLIF(btrim(p_note), ''));
  END IF;
  RETURN QUERY SELECT v_uid, v_outcome;
END $$;
REVOKE ALL ON FUNCTION platform_staff_grant(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_staff_grant(uuid, text, text, text) TO dealpilot_app;

-- Revoke. Refuses self and the last active super admin (the F-04 last-owner
-- rule, applied to the platform). Kills the target's sessions so revocation
-- is immediate, not next-sign-in.
CREATE FUNCTION platform_staff_revoke(p_actor uuid, p_user uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_old platform_staff%ROWTYPE;
BEGIN
  PERFORM platform_assert_actor(p_actor, ARRAY['platform_super_admin']);
  IF p_user = p_actor THEN
    RAISE EXCEPTION 'cannot revoke yourself' USING ERRCODE = 'PA006';
  END IF;
  SELECT * INTO v_old FROM platform_staff WHERE user_id = p_user AND status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not active platform staff' USING ERRCODE = 'PA002'; END IF;
  IF v_old.role = 'platform_super_admin' THEN
    -- FOR UPDATE on the survivors: two concurrent revokes must not both
    -- observe that another super admin exists (the F-04 assertNotLastOwner
    -- discipline; review).
    PERFORM 1 FROM platform_staff
     WHERE role = 'platform_super_admin' AND status = 'active' AND user_id <> p_user
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'last platform_super_admin' USING ERRCODE = 'PA003';
    END IF;
  END IF;
  UPDATE platform_staff SET status = 'revoked', revoked_by = p_actor, revoked_at = now() WHERE user_id = p_user;
  DELETE FROM "session" WHERE "userId" = p_user::text;
  INSERT INTO platform_audit_events (actor_user_id, actor_type, event, target_user_id, changes, reason)
  VALUES (p_actor, 'platform', 'staff.revoked', p_user,
          jsonb_build_object('status', jsonb_build_object('from', 'active', 'to', 'revoked')),
          NULLIF(btrim(p_reason), ''));
END $$;
REVOKE ALL ON FUNCTION platform_staff_revoke(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_staff_revoke(uuid, uuid, text) TO dealpilot_app;

-- ---------------------------------------------------------------------------
-- 7. Existing cross-tenant scans learn the lifecycle
-- ---------------------------------------------------------------------------
-- intake_resolve: fourth replacement (0005, 0029, 0050). OUT params change, so
-- DROP first. Predicates carried verbatim from 0050 plus the org's status, so
-- the public route can answer 410 for a suspended tenant AFTER the signature
-- verifies (a suspended tenant must not be enumerable by an unsigned probe).
DROP FUNCTION intake_resolve(text);

CREATE FUNCTION intake_resolve(p_token text)
RETURNS TABLE (organization_id uuid, store_id uuid, default_source text, secret text, connector_key text, organization_status text)
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT k.organization_id, k.store_id, k.default_source, k.secret, k.connector_key, o.status
  FROM intake_keys k
  JOIN organizations o ON o.id = k.organization_id AND o.deleted_at IS NULL
  LEFT JOIN stores s ON s.id = k.store_id
  WHERE k.token = p_token AND k.active = true AND k.revoked_at IS NULL
    AND (k.store_id IS NULL OR (s.id IS NOT NULL AND s.deleted_at IS NULL AND s.status <> 'closed'));
$$;
REVOKE ALL ON FUNCTION intake_resolve(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION intake_resolve(text) TO dealpilot_app;

-- Drips pause for every non-operational tenant (multi-tenancy.md §8:
-- read_only pauses AI outbound). Body otherwise verbatim from 0060.
CREATE OR REPLACE FUNCTION drip_due_enrollments(now_utc timestamptz)
RETURNS TABLE (organization_id uuid, enrollment_id uuid)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT e.organization_id, e.id
  FROM drip_enrollments e
  JOIN drip_sequences s ON s.id = e.drip_sequence_id
  JOIN organizations o ON o.id = e.organization_id
   AND o.deleted_at IS NULL AND o.status IN ('active','trial','past_due')
  WHERE e.status = 'active'
    AND (
      e.expires_at <= now_utc
      OR (
        s.active AND (
          e.current_step >= jsonb_array_length(s.steps)
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(s.steps) WITH ORDINALITY AS st(step, ord)
            WHERE ord = e.current_step + 1
              AND e.enrolled_at + ((st.step->>'day') || ' days')::interval <= now_utc
          )
        )
      )
    )
  LIMIT 500
$$;

-- Task alerts stop for suspended/closing tenants; a read_only tenant still
-- gets its overdue reminders (reads and notifications remain available).
CREATE OR REPLACE FUNCTION tasks_needing_attention(now_utc timestamptz, escalate_after interval)
RETURNS TABLE (organization_id uuid, task_id uuid, kind text, since timestamptz)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT t.organization_id, t.id, 'overdue', t.due_at
  FROM tasks t
  JOIN organizations o ON o.id = t.organization_id
   AND o.deleted_at IS NULL AND o.status NOT IN ('suspended','offboarding','purged')
  WHERE t.status IN ('pending','in_progress') AND t.deleted_at IS NULL
    AND t.due_at IS NOT NULL AND t.due_at <= now_utc
    AND t.overdue_notified_at IS NULL
  UNION ALL
  SELECT t.organization_id, t.id, 'escalate', t.overdue_notified_at
  FROM tasks t
  JOIN organizations o ON o.id = t.organization_id
   AND o.deleted_at IS NULL AND o.status NOT IN ('suspended','offboarding','purged')
  WHERE t.status IN ('pending','in_progress') AND t.deleted_at IS NULL
    AND t.due_at IS NOT NULL AND t.due_at <= now_utc
    AND t.overdue_notified_at IS NOT NULL
    AND t.overdue_notified_at + escalate_after <= now_utc
    AND t.escalated_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM notifications n
      WHERE n.entity_type = 'task' AND n.entity_id = t.id
        AND n.title_key = 'notif_task_overdue' AND n.read_at IS NOT NULL
    )
  ORDER BY 4, 2
  LIMIT 500
$$;
