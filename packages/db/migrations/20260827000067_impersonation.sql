-- 0067 — impersonation with audit (F-71; admin-console.md §3, §7, §11, §12;
-- authentication-authorization.md §3/§12; multi-tenancy.md §6; ADR-006/007/009;
-- D-070, D-072).
--
-- What an impersonation IS here: a row in impersonation_sessions bound to the
-- STAFFER's own Better Auth "session".id. No session is minted for the target,
-- no cookie changes hands, the Better Auth admin plugin is not used (D-072).
-- The API resolves the row on every request (impersonation_identity) and runs
-- the tenant request as the target; the database keeps the session inside ONE
-- organization through app.impersonation_org (impersonation_scope_ok).
--
-- Error contract additions (SQLSTATE → HTTP, apps/api/src/platform.ts):
--   PA015 target holds no active membership in that tenant → 404 not_found
--   PA016 target is active platform staff                  → 403 cannot_impersonate_staff
--   PA017 tenant deleted / not impersonable by status      → 409 tenant_not_impersonable
--   PA018 this staffer session already impersonates        → 409 impersonation_active
--   PA019 session already ended                            → 409 impersonation_ended
--   PA020 not the owning staffer and not a super admin     → 403 forbidden
--
-- RLS note: as 0065/0066, the definers act as their OWNER (superuser locally,
-- BYPASSRLS on RDS — definer-owner.test.ts). The tenant reads its own register
-- rows through the ordinary org-keyed policy (SELECT grant only).

-- ---------------------------------------------------------------------------
-- 1. The scope helper — runs inside policies as the app role: plain, STABLE.
--    TRUE when no session is scoped (every request outside an impersonation,
--    every worker); otherwise only the session's organization passes.
-- ---------------------------------------------------------------------------
CREATE FUNCTION impersonation_scope_ok(p_org uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT NULLIF(current_setting('app.impersonation_org', true), '') IS NULL
      OR p_org = NULLIF(current_setting('app.impersonation_org', true), '')::uuid;
$$;
REVOKE ALL ON FUNCTION impersonation_scope_ok(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION impersonation_scope_ok(uuid) TO dealpilot_app;

-- ---------------------------------------------------------------------------
-- 2. The register (§7). Immutable: UPDATE may only close a row, once.
-- ---------------------------------------------------------------------------
CREATE TABLE impersonation_sessions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES organizations(id),      -- §7 tenant_id (D-070 2)
  platform_user_id     uuid NOT NULL REFERENCES users(id),
  -- Frozen at start: the tenant reads WHO without a cross-RLS join to a
  -- non-member's users row (0001 user_read / 0007 user_org_read hide it).
  platform_user_email  text NOT NULL,
  platform_session_id  text NOT NULL,   -- "session".id; no FK: the register outlives the session
  target_user_id       uuid NOT NULL REFERENCES users(id),
  mode                 text NOT NULL CHECK (mode IN ('read_only','full')),
  reason               text NOT NULL CHECK (length(btrim(reason)) BETWEEN 20 AND 500),
  ticket_ref           text CHECK (ticket_ref IS NULL OR (btrim(ticket_ref) <> '' AND length(ticket_ref) <= 60)),
  ip_address           text,
  started_at           timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NOT NULL,
  ended_at             timestamptz,
  end_reason           text CHECK (end_reason IN ('manual','ttl','revoked')),
  ended_by             uuid REFERENCES users(id) ON DELETE SET NULL,     -- NULL = the system
  CHECK ((ended_at IS NULL) = (end_reason IS NULL)),
  CHECK (expires_at > started_at),
  CHECK (ended_at IS NULL OR ended_at >= started_at),
  CHECK (end_reason IS DISTINCT FROM 'manual' OR ended_by IS NOT NULL),
  CHECK (target_user_id <> platform_user_id)
);
CREATE UNIQUE INDEX idx_impersonation_one_per_session
  ON impersonation_sessions (platform_session_id) WHERE ended_at IS NULL;
CREATE INDEX idx_impersonation_org ON impersonation_sessions (organization_id, started_at DESC);
CREATE INDEX idx_impersonation_staffer ON impersonation_sessions (platform_user_id, started_at DESC);

GRANT SELECT ON impersonation_sessions TO dealpilot_app;
ALTER TABLE impersonation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE impersonation_sessions FORCE ROW LEVEL SECURITY;
-- WITH CHECK exists for the rls-coverage both-directions rule; the app role
-- holds no INSERT anyway.
CREATE POLICY impersonation_isolation ON impersonation_sessions
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

CREATE FUNCTION impersonation_sessions_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'impersonation_sessions is append-only' USING ERRCODE = 'PA000';
  END IF;
  IF OLD.ended_at IS NOT NULL OR NEW.ended_at IS NULL
     OR (NEW.id, NEW.organization_id, NEW.platform_user_id, NEW.platform_user_email, NEW.platform_session_id,
         NEW.target_user_id, NEW.mode, NEW.reason, NEW.ticket_ref, NEW.ip_address, NEW.started_at, NEW.expires_at)
        IS DISTINCT FROM
        (OLD.id, OLD.organization_id, OLD.platform_user_id, OLD.platform_user_email, OLD.platform_session_id,
         OLD.target_user_id, OLD.mode, OLD.reason, OLD.ticket_ref, OLD.ip_address, OLD.started_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'impersonation_sessions rows may only be closed, once' USING ERRCODE = 'PA000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER impersonation_sessions_no_rewrite BEFORE UPDATE OR DELETE ON impersonation_sessions
  FOR EACH ROW EXECUTE FUNCTION impersonation_sessions_immutable();

COMMENT ON TABLE impersonation_sessions IS
  'Support-access register (admin-console.md §7). Bound to the staffer''s own "session".id; no target session exists. Written only by impersonation_start()/impersonation_close() (0067) and the trigger/lifecycle paths that call them. Tenant-readable at /security; retained with the audit trail (§12, >= 24 months).';

-- ---------------------------------------------------------------------------
-- 3. Every request served under a session (§7 "every request"). No
--    organization_id on purpose (keyed by the register); no app grant.
-- ---------------------------------------------------------------------------
CREATE TABLE impersonation_requests (
  seq              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  impersonation_id uuid NOT NULL REFERENCES impersonation_sessions(id),
  method           text NOT NULL,
  route            text NOT NULL,                              -- routed pattern
  url              text NOT NULL CHECK (length(url) <= 512),   -- path + query, truncated
  status_code      integer NOT NULL,
  at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_impersonation_requests ON impersonation_requests (impersonation_id, seq);

CREATE FUNCTION impersonation_requests_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'impersonation_requests is append-only' USING ERRCODE = 'PA000';
END $$;
CREATE TRIGGER impersonation_requests_no_rewrite BEFORE UPDATE OR DELETE ON impersonation_requests
  FOR EACH ROW EXECUTE FUNCTION impersonation_requests_immutable();

COMMENT ON TABLE impersonation_requests IS
  'admin-console.md §7 "every request made during the session": one row per request served under a live impersonation, written by impersonation_log_request() from the API''s onResponse hook. Platform-internal; immutable; retained with the audit trail.';

-- ---------------------------------------------------------------------------
-- 4. activity_events learns the session (§7/§12).
-- ---------------------------------------------------------------------------
ALTER TABLE activity_events
  ADD COLUMN impersonation_id uuid REFERENCES impersonation_sessions(id),
  ADD CONSTRAINT activity_events_impersonation_actor
    CHECK (impersonation_id IS NULL OR actor_type IN ('platform','system'));
COMMENT ON COLUMN activity_events.impersonation_id IS
  'admin-console.md §7/§12: the support session this act belongs to. For acts made UNDER the session (recordEvent) actor_user_id is the IMPERSONATED user and the staffer is impersonation_sessions.platform_user_id; the session''s OWN created/updated rows (the 0067 definers) carry the staffer who opened it, the person who closed it, or NULL for the clock/trigger.';
CREATE INDEX idx_activity_impersonation ON activity_events (impersonation_id, seq) WHERE impersonation_id IS NOT NULL;

-- The LIVE lists from 0064:154-172 verbatim + impersonation_session. No new verb.
ALTER TABLE activity_events DROP CONSTRAINT activity_events_entity_type_check;
ALTER TABLE activity_events ADD CONSTRAINT activity_events_entity_type_check
  CHECK (entity_type IN ('deal','lead','vehicle','membership','pay_plan',
                         'checklist_item','checklist_template','intake_key',
                         'invitation','dispatch_assignment','deal_document',
                         'deal_fi_product','tenant_branding','consent','suppression',
                         'internal_dnc','conversation','appointment','contact',
                         'organization','store','task','impersonation_session'));
ALTER TABLE activity_events DROP CONSTRAINT activity_events_parent_entity_type_check;
ALTER TABLE activity_events ADD CONSTRAINT activity_events_parent_entity_type_check
  CHECK (parent_entity_type IS NULL OR parent_entity_type IN
         ('deal','lead','vehicle','membership','pay_plan',
          'checklist_item','checklist_template','intake_key',
          'invitation','dispatch_assignment','deal_document',
          'deal_fi_product','tenant_branding','consent','suppression',
          'internal_dnc','conversation','appointment','contact',
          'organization','store','task','impersonation_session'));

-- ---------------------------------------------------------------------------
-- 5. The tenancy boundary during a session. Policies cannot be altered in
--    place: DROP + CREATE, bodies verbatim (0003:13-14, 0001:155-157,
--    0051:54-60) plus the scope call. A multi-organization target is
--    impersonated in ONE organization: the others do not exist for the
--    session (O-22).
-- ---------------------------------------------------------------------------
DROP POLICY membership_self_read ON memberships;
CREATE POLICY membership_self_read ON memberships FOR SELECT
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
         AND impersonation_scope_ok(organization_id));
DROP POLICY membership_isolation ON memberships;
CREATE POLICY membership_isolation ON memberships
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid
         AND impersonation_scope_ok(organization_id))
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid
         AND impersonation_scope_ok(organization_id));
DROP POLICY notifications_self_read ON notifications;
CREATE POLICY notifications_self_read ON notifications FOR SELECT
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
         AND impersonation_scope_ok(organization_id));
DROP POLICY notifications_self_update ON notifications;
CREATE POLICY notifications_self_update ON notifications FOR UPDATE
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND impersonation_scope_ok(organization_id))
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND impersonation_scope_ok(organization_id));

-- has_permission (0022:77-101) body verbatim + the scope. SECURITY DEFINER
-- bypasses policies, so it must carry the predicate itself; the GUC is
-- transaction-level, so the definer body sees it.
CREATE OR REPLACE FUNCTION has_permission(p_org uuid, p_user uuid, p_permission text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT impersonation_scope_ok(p_org) AND COALESCE(
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

-- ---------------------------------------------------------------------------
-- 6. Definer surface
-- ---------------------------------------------------------------------------
-- Close: shared by end / identity / trigger / lifecycle / revoke. Idempotent.
-- Internal: no app grant.
CREATE FUNCTION impersonation_close(p_id uuid, p_reason text, p_by uuid, p_at timestamptz) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_row impersonation_sessions%ROWTYPE;
BEGIN
  UPDATE impersonation_sessions SET ended_at = p_at, end_reason = p_reason, ended_by = p_by
   WHERE impersonation_sessions.id = p_id AND impersonation_sessions.ended_at IS NULL
   RETURNING * INTO v_row;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO activity_events (organization_id, actor_user_id, actor_type, entity_type, entity_id, action, changes, impersonation_id, restricted)
  VALUES (v_row.organization_id, p_by, CASE WHEN p_by IS NULL THEN 'system' ELSE 'platform' END,
          'impersonation_session', v_row.id, 'updated',
          jsonb_build_object('status', jsonb_build_object('from', 'active', 'to', 'ended'),
                             'end_reason', jsonb_build_object('from', NULL, 'to', p_reason)),
          v_row.id, false);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION impersonation_close(uuid, text, uuid, timestamptz) FROM PUBLIC;

-- Start. One transaction: the row, the tenant-visible activity row, the
-- owners' bell rows. Returns what the route needs to mail the owners AFTER commit.
CREATE FUNCTION impersonation_start(
  p_actor uuid, p_actor_email text, p_session_id text, p_org uuid, p_target uuid, p_mode text,
  p_reason text, p_ticket text, p_ip text, p_ttl_minutes integer)
RETURNS TABLE (id uuid, started_at timestamptz, expires_at timestamptz,
               org_name text, org_slug text,
               target_email text, target_name text, owner_emails text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_org organizations%ROWTYPE; v_row impersonation_sessions%ROWTYPE;
  v_target users%ROWTYPE; v_owner uuid; v_emails text[] := '{}'; v_key text;
BEGIN
  IF p_mode = 'full' THEN
    PERFORM platform_assert_actor(p_actor, ARRAY['platform_super_admin']);
  ELSE
    PERFORM platform_assert_actor(p_actor, ARRAY['platform_super_admin','platform_support']);
  END IF;
  IF p_mode NOT IN ('read_only','full') THEN RAISE EXCEPTION 'bad mode' USING ERRCODE = '22023'; END IF;
  IF p_ttl_minutes IS NULL OR p_ttl_minutes < 1 OR p_session_id IS NULL OR btrim(p_session_id) = ''
     OR p_actor_email IS NULL OR btrim(p_actor_email) = '' THEN
    RAISE EXCEPTION 'impersonation payload incomplete' USING ERRCODE = 'PA014';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 20 THEN
    RAISE EXCEPTION 'reason too short' USING ERRCODE = '23514';
  END IF;

  -- Housekeeping: an expired row on this session must not block a new one.
  PERFORM impersonation_close(s.id, 'ttl', NULL, s.expires_at)
    FROM impersonation_sessions s
   WHERE s.platform_session_id = p_session_id AND s.ended_at IS NULL AND s.expires_at <= now();

  SELECT * INTO v_org FROM organizations o WHERE o.id = p_org FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'tenant not found' USING ERRCODE = 'PA002'; END IF;
  IF v_org.deleted_at IS NOT NULL OR v_org.status NOT IN ('active','trial','past_due','read_only') THEN
    RAISE EXCEPTION 'tenant % is %', p_org, v_org.status USING ERRCODE = 'PA017';
  END IF;

  SELECT u.* INTO v_target FROM users u
   WHERE u.id = p_target
     AND EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id AND m.organization_id = p_org AND m.status = 'active')
     AND EXISTS (SELECT 1 FROM "user" a WHERE a.id = u.id::text);
  IF NOT FOUND THEN RAISE EXCEPTION 'no such member' USING ERRCODE = 'PA015'; END IF;
  IF EXISTS (SELECT 1 FROM platform_staff ps WHERE ps.user_id = p_target AND ps.status = 'active') THEN
    RAISE EXCEPTION 'cannot impersonate platform staff' USING ERRCODE = 'PA016';
  END IF;

  BEGIN
    INSERT INTO impersonation_sessions
      (organization_id, platform_user_id, platform_user_email, platform_session_id, target_user_id,
       mode, reason, ticket_ref, ip_address, expires_at)
    VALUES (p_org, p_actor, lower(btrim(p_actor_email)), p_session_id, p_target,
            p_mode, btrim(p_reason), NULLIF(btrim(p_ticket), ''), p_ip,
            now() + make_interval(mins => p_ttl_minutes))
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'this session already impersonates' USING ERRCODE = 'PA018';
  END;

  -- §12 transparency: the tenant sees the session open, never restricted.
  INSERT INTO activity_events (organization_id, actor_user_id, actor_type, entity_type, entity_id, action, changes, reason, impersonation_id, restricted)
  VALUES (p_org, p_actor, 'platform', 'impersonation_session', v_row.id, 'created',
          jsonb_build_object('mode', jsonb_build_object('from', NULL, 'to', p_mode),
                             -- The email, not the id: the journal is read by people (review).
                             'target_email', jsonb_build_object('from', NULL, 'to', v_target.email),
                             'expires_at', jsonb_build_object('from', NULL, 'to', v_row.expires_at),
                             'ticket_ref', jsonb_build_object('from', NULL, 'to', v_row.ticket_ref)),
          btrim(p_reason), v_row.id, false);

  -- §7 tenant notification: every active owner, in-app now; email after commit.
  -- Two keys so no locale logic runs in SQL (title-keys.test.ts guards both).
  v_key := CASE WHEN p_mode = 'full' THEN 'notif_support_access_started_full' ELSE 'notif_support_access_started_read_only' END;
  FOR v_owner IN
    SELECT DISTINCT m.user_id FROM memberships m
     WHERE m.organization_id = p_org AND m.status = 'active' AND 'owner' = ANY (m.roles)
  LOOP
    INSERT INTO notifications (organization_id, user_id, urgency, title_key, params, link, entity_type, entity_id)
    VALUES (p_org, v_owner, 'high', v_key, jsonb_build_object('name', v_target.name), '/security', 'impersonation_session', v_row.id);
    SELECT array_append(v_emails, u.email) INTO v_emails FROM users u WHERE u.id = v_owner;
  END LOOP;

  RETURN QUERY SELECT v_row.id, v_row.started_at, v_row.expires_at, v_org.name, v_org.slug,
                      v_target.email, v_target.name, v_emails;
END $$;
REVOKE ALL ON FUNCTION impersonation_start(uuid, text, text, uuid, uuid, text, text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION impersonation_start(uuid, text, text, uuid, uuid, text, text, text, text, integer) TO dealpilot_app;

-- The per-request read behind the gate. VOLATILE on purpose: the one place a
-- session's standing is re-proven; it closes a row that lost it. Returns the
-- row either way with `live`; the gate answers 403 impersonation_ended once
-- for a row it just closed.
CREATE FUNCTION impersonation_identity(p_session_id text)
RETURNS TABLE (id uuid, organization_id uuid, org_name text, org_slug text, org_status text,
               platform_user_id uuid, target_user_id uuid, target_email text, target_name text,
               mode text, started_at timestamptz, expires_at timestamptz, live boolean, end_reason text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_row impersonation_sessions%ROWTYPE; v_reason text; v_org organizations%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM impersonation_sessions s WHERE s.platform_session_id = p_session_id AND s.ended_at IS NULL;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO v_org FROM organizations o WHERE o.id = v_row.organization_id;
  v_reason := CASE
    WHEN v_row.expires_at <= now() THEN 'ttl'
    -- Standing is role-aware (review): the session's MODE must still be one
    -- the staffer's CURRENT role could open — a super admin demoted to
    -- support loses a full session, a staffer re-roled to billing loses any.
    WHEN NOT EXISTS (SELECT 1 FROM platform_staff ps
                      WHERE ps.user_id = v_row.platform_user_id AND ps.status = 'active'
                        AND ps.role = ANY (CASE WHEN v_row.mode = 'full'
                                                THEN ARRAY['platform_super_admin']
                                                ELSE ARRAY['platform_super_admin','platform_support'] END)) THEN 'revoked'
    WHEN v_org.deleted_at IS NOT NULL OR v_org.status NOT IN ('active','trial','past_due','read_only') THEN 'revoked'
    WHEN NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = v_row.target_user_id
                      AND m.organization_id = v_row.organization_id AND m.status = 'active') THEN 'revoked'
    ELSE NULL END;
  IF v_reason IS NOT NULL THEN
    PERFORM impersonation_close(v_row.id, v_reason, NULL, CASE WHEN v_reason = 'ttl' THEN v_row.expires_at ELSE now() END);
  END IF;
  RETURN QUERY
  SELECT v_row.id, v_row.organization_id, v_org.name, v_org.slug, v_org.status,
         v_row.platform_user_id, v_row.target_user_id, u.email, u.name,
         v_row.mode, v_row.started_at, v_row.expires_at, v_reason IS NULL, v_reason
  FROM users u WHERE u.id = v_row.target_user_id;
END $$;
REVOKE ALL ON FUNCTION impersonation_identity(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION impersonation_identity(text) TO dealpilot_app;

-- Explicit end (§7 DELETE): the owning staffer, or any super admin.
CREATE FUNCTION impersonation_end(p_actor uuid, p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role text; v_row impersonation_sessions%ROWTYPE;
BEGIN
  v_role := platform_assert_actor(p_actor, ARRAY['platform_super_admin','platform_support']);
  SELECT * INTO v_row FROM impersonation_sessions s WHERE s.id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'impersonation not found' USING ERRCODE = 'PA002'; END IF;
  IF v_row.platform_user_id <> p_actor AND v_role <> 'platform_super_admin' THEN
    RAISE EXCEPTION 'not yours to end' USING ERRCODE = 'PA020';
  END IF;
  IF v_row.ended_at IS NOT NULL THEN RAISE EXCEPTION 'already ended' USING ERRCODE = 'PA019'; END IF;
  PERFORM impersonation_close(p_id, 'manual', p_actor, now());
END $$;
REVOKE ALL ON FUNCTION impersonation_end(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION impersonation_end(uuid, uuid) TO dealpilot_app;

-- The request trail (onResponse hook). A closed session's last request still
-- gets its line; an unknown id is ignored.
CREATE FUNCTION impersonation_log_request(p_id uuid, p_method text, p_route text, p_url text, p_status integer)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO impersonation_requests (impersonation_id, method, route, url, status_code)
  SELECT p_id, p_method, p_route, left(p_url, 512), p_status
  WHERE EXISTS (SELECT 1 FROM impersonation_sessions s WHERE s.id = p_id);
$$;
REVOKE ALL ON FUNCTION impersonation_log_request(uuid, text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION impersonation_log_request(uuid, text, text, text, integer) TO dealpilot_app;

-- Console readers (impersonation:manage). Identity facts only, never business data.
CREATE FUNCTION admin_list_impersonations(p_actor uuid, p_org uuid, p_active boolean, p_limit integer)
RETURNS TABLE (id uuid, organization_id uuid, org_name text, org_slug text,
               platform_user_id uuid, platform_email text, platform_name text,
               target_user_id uuid, target_email text, target_name text,
               mode text, reason text, ticket_ref text, started_at timestamptz, expires_at timestamptz,
               ended_at timestamptz, end_reason text, ended_by uuid, active boolean, request_count integer)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM platform_assert_actor(p_actor, ARRAY['platform_super_admin','platform_support']);
  RETURN QUERY
  SELECT s.id, s.organization_id, o.name, o.slug, s.platform_user_id, s.platform_user_email, pu.name,
         s.target_user_id, tu.email, tu.name, s.mode, s.reason, s.ticket_ref, s.started_at, s.expires_at,
         s.ended_at, s.end_reason, s.ended_by, (s.ended_at IS NULL AND s.expires_at > now()),
         (SELECT count(*)::integer FROM impersonation_requests r WHERE r.impersonation_id = s.id)
  FROM impersonation_sessions s
  JOIN organizations o ON o.id = s.organization_id
  LEFT JOIN users pu ON pu.id = s.platform_user_id
  JOIN users tu ON tu.id = s.target_user_id
  WHERE (p_org IS NULL OR s.organization_id = p_org)
    AND (p_active IS NULL OR (s.ended_at IS NULL AND s.expires_at > now()) = p_active)
  ORDER BY s.started_at DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 200);
END $$;
REVOKE ALL ON FUNCTION admin_list_impersonations(uuid, uuid, boolean, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_list_impersonations(uuid, uuid, boolean, integer) TO dealpilot_app;

CREATE FUNCTION admin_get_impersonation(p_actor uuid, p_id uuid)
RETURNS TABLE (id uuid, organization_id uuid, org_name text, org_slug text,
               platform_user_id uuid, platform_email text, platform_name text,
               target_user_id uuid, target_email text, target_name text,
               mode text, reason text, ticket_ref text, started_at timestamptz, expires_at timestamptz,
               ended_at timestamptz, end_reason text, ended_by uuid, active boolean, request_count integer)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM platform_assert_actor(p_actor, ARRAY['platform_super_admin','platform_support']);
  RETURN QUERY
  SELECT s.id, s.organization_id, o.name, o.slug, s.platform_user_id, s.platform_user_email, pu.name,
         s.target_user_id, tu.email, tu.name, s.mode, s.reason, s.ticket_ref, s.started_at, s.expires_at,
         s.ended_at, s.end_reason, s.ended_by, (s.ended_at IS NULL AND s.expires_at > now()),
         (SELECT count(*)::integer FROM impersonation_requests r WHERE r.impersonation_id = s.id)
  FROM impersonation_sessions s
  JOIN organizations o ON o.id = s.organization_id
  LEFT JOIN users pu ON pu.id = s.platform_user_id
  JOIN users tu ON tu.id = s.target_user_id
  WHERE s.id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'impersonation not found' USING ERRCODE = 'PA002';
  END IF;
END $$;
REVOKE ALL ON FUNCTION admin_get_impersonation(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_get_impersonation(uuid, uuid) TO dealpilot_app;

CREATE FUNCTION admin_impersonation_requests(p_actor uuid, p_id uuid, p_limit integer)
RETURNS TABLE (seq bigint, method text, route text, url text, status_code integer, at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM platform_assert_actor(p_actor, ARRAY['platform_super_admin','platform_support']);
  RETURN QUERY
  SELECT r.seq, r.method, r.route, r.url, r.status_code, r.at
  FROM impersonation_requests r
  WHERE r.impersonation_id = p_id
  ORDER BY r.seq ASC
  LIMIT LEAST(GREATEST(p_limit, 1), 500);
END $$;
REVOKE ALL ON FUNCTION admin_impersonation_requests(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_impersonation_requests(uuid, uuid, integer) TO dealpilot_app;

-- The target picker: a tenant's active members with a sign-in identity.
CREATE FUNCTION admin_list_tenant_members(p_actor uuid, p_org uuid)
RETURNS TABLE (user_id uuid, email text, name text, roles text[], store_codes text[], is_platform_staff boolean)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM platform_assert_actor(p_actor, ARRAY['platform_super_admin','platform_support']);
  PERFORM 1 FROM organizations o WHERE o.id = p_org AND o.deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'tenant not found' USING ERRCODE = 'PA002'; END IF;
  RETURN QUERY
  SELECT u.id, u.email, u.name,
         (SELECT array_agg(DISTINCT r.role ORDER BY r.role)
            FROM memberships m2, unnest(m2.roles) AS r(role)
           WHERE m2.user_id = u.id AND m2.organization_id = p_org AND m2.status = 'active'),
         COALESCE((SELECT array_agg(DISTINCT st.code ORDER BY st.code)
                     FROM memberships m3 JOIN stores st ON st.id = m3.store_id
                    WHERE m3.user_id = u.id AND m3.organization_id = p_org AND m3.status = 'active'), '{}'::text[]),
         EXISTS (SELECT 1 FROM platform_staff ps WHERE ps.user_id = u.id AND ps.status = 'active')
  FROM users u
  WHERE EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id AND m.organization_id = p_org AND m.status = 'active')
    AND EXISTS (SELECT 1 FROM "user" a WHERE a.id = u.id::text)
  ORDER BY u.email;
END $$;
REVOKE ALL ON FUNCTION admin_list_tenant_members(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_list_tenant_members(uuid, uuid) TO dealpilot_app;

-- ---------------------------------------------------------------------------
-- 7. Revocation is immediate
-- ---------------------------------------------------------------------------
-- (a) The staffer's session row dies (sign-out, staff revoke, expiry cleanup):
--     SECURITY DEFINER because dealpilot_app deletes sessions (0002:19) but
--     holds no UPDATE on the register.
CREATE FUNCTION session_deleted_close_impersonation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  FOR v_id IN SELECT s.id FROM impersonation_sessions s WHERE s.platform_session_id = OLD.id AND s.ended_at IS NULL LOOP
    PERFORM impersonation_close(v_id, 'revoked', NULL, now());
  END LOOP;
  RETURN OLD;
END $$;
CREATE TRIGGER session_deleted_close_impersonation AFTER DELETE ON "session"
  FOR EACH ROW EXECUTE FUNCTION session_deleted_close_impersonation();

-- (b) platform_staff_revoke — 0065:635-664 body VERBATIM plus the explicit
--     close BEFORE the session delete (deterministic ended_by = the revoker).
CREATE OR REPLACE FUNCTION platform_staff_revoke(p_actor uuid, p_user uuid, p_reason text)
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
  -- F-71: a revoked staffer's open support sessions end with them, signed.
  PERFORM impersonation_close(s.id, 'revoked', p_actor, now())
    FROM impersonation_sessions s WHERE s.platform_user_id = p_user AND s.ended_at IS NULL;
  DELETE FROM "session" WHERE "userId" = p_user::text;
  INSERT INTO platform_audit_events (actor_user_id, actor_type, event, target_user_id, changes, reason)
  VALUES (p_actor, 'platform', 'staff.revoked', p_user,
          jsonb_build_object('status', jsonb_build_object('from', 'active', 'to', 'revoked')),
          NULLIF(btrim(p_reason), ''));
END $$;

-- (c) admin_set_tenant_status — 0065:495-538 body VERBATIM plus the explicit
--     close inside the suspended/offboarding branch, before the session delete.
CREATE OR REPLACE FUNCTION admin_set_tenant_status(
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
    -- F-71: a support session on a tenant that just lost its standing ends now, signed.
    PERFORM impersonation_close(s.id, 'revoked', p_actor, now())
      FROM impersonation_sessions s WHERE s.organization_id = p_org AND s.ended_at IS NULL;
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

-- (d) admin_tenant_events — OUT columns change ⇒ DROP + CREATE (the 0066
--     precedent); 0065:404-424 body verbatim + the session and its staffer.
DROP FUNCTION admin_tenant_events(uuid, uuid, integer);
CREATE FUNCTION admin_tenant_events(p_actor uuid, p_org uuid, p_limit integer)
RETURNS TABLE (
  id uuid, organization_id uuid, store_id uuid, actor_user_id uuid, actor_type text, actor_email text,
  entity_type text, entity_id uuid, action text, changes jsonb, reason text,
  parent_entity_type text, parent_entity_id uuid, restricted boolean, created_at timestamptz, seq bigint,
  impersonation_id uuid, impersonator_email text)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM platform_assert_actor(p_actor, ARRAY['platform_super_admin','platform_support','platform_billing']);
  RETURN QUERY
  SELECT a.id, a.organization_id, a.store_id, a.actor_user_id, a.actor_type, u.email,
         a.entity_type, a.entity_id, a.action, a.changes, a.reason,
         a.parent_entity_type, a.parent_entity_id, a.restricted, a.created_at, a.seq,
         a.impersonation_id,
         -- The staffer is named only on acts made UNDER the session; on the
         -- session's own rows the actor already IS the staffer (review: the
         -- journal read "staffer acting as staffer").
         CASE WHEN a.entity_type = 'impersonation_session' THEN NULL ELSE i.platform_user_email END
  FROM activity_events a
  LEFT JOIN users u ON u.id = a.actor_user_id
  LEFT JOIN impersonation_sessions i ON i.id = a.impersonation_id
  WHERE a.organization_id = p_org
    AND (a.entity_type = 'organization' OR a.actor_type = 'platform')
  ORDER BY a.seq DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 200);
END $$;
REVOKE ALL ON FUNCTION admin_tenant_events(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_tenant_events(uuid, uuid, integer) TO dealpilot_app;

-- (e) platform_staff_grant — 0065:561-632 body VERBATIM plus one addition in
--     the role_changed branch: a role change ends the staffer's open support
--     sessions (review — full mode survived a demotion to support until the
--     TTL; billing may hold none at all). The new role re-earns its sessions.
CREATE OR REPLACE FUNCTION platform_staff_grant(p_actor uuid, p_email text, p_role text, p_note text)
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
    -- F-71: the old role's open support sessions end with the role, signed by
    -- the admin who re-roled them (impersonation_identity would also catch it
    -- on the next request; this makes ended_by deterministic).
    PERFORM impersonation_close(s.id, 'revoked', p_actor, now())
      FROM impersonation_sessions s WHERE s.platform_user_id = v_uid AND s.ended_at IS NULL;
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

-- Not here, on purpose: no platform_audit_events event (every impersonation
-- act has a tenant); no new activity verb; no 'ai' actor; no
-- session.additionalFields; no change to organizations/stores/users policies
-- (they bootstrap from memberships, which now carries the scope).
