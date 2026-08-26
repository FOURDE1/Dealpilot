-- 0066 — tenant provisioning (F-70; admin-console.md §4.2–§4.4, §11–§12;
-- ADR-006/007/024/026; D-070, D-071).
--
-- What lands here and WHY:
--   1. organizations.trial_ends_at — §4.2 "14-day trial" without Stripe. The
--      organization is BORN 'trial' with a clock; nothing expires it yet (the
--      billing slice's worker reads it). No 'prospect': provisioning is one
--      transaction, so the state §4.3 calls prospect is never observable —
--      adding a status nothing can hold is the dead-vocabulary bug D-070 (7)
--      named. It arrives when Stripe makes provisioning two-phase (D-071).
--   2. admin_list_tenants / admin_get_tenant learn the clock, and the detail
--      learns the pending OWNER invitation (a provisioned tenant has zero
--      members until the owner accepts; the console is the only place that
--      can see the seat).
--   3. admin_provision_tenant — the birth. One SECURITY DEFINER call on a
--      bare pool connection (0065 header: nothing on the connection for a
--      policy to match). Seeds arrive as jsonb built from the canonical TS
--      lists (packages/schemas DEFAULT_ROLE_PERMISSIONS, packages/core
--      LOST_REASON_DEFAULTS, apps/api checklist CANONICAL) — this file owns
--      NO copy of any catalogue (0055 shows how a frozen SQL copy drifts).
--      The owner seat is an F-12 invitation row (0015): the token is hashed
--      by the API and never stored; acceptance is invitation_accept() (0021),
--      untouched. The tenant-role literal 'owner' lives HERE because the
--      admin route file may not spell a tenant role (platform-drift guard).
--   4. admin_reissue_owner_invitation — the only way to re-send or correct
--      the owner seat while nobody inside the tenant can (F-12's POST needs
--      member:invite, and a fresh tenant has no members).
--
-- Error contract additions (SQLSTATE → HTTP in apps/api/src/platform.ts):
--   PA011 slug already provisioned (DETAIL = existing organization id) → 409 slug_taken
--   PA012 duplicate store code (DETAIL = code)                          → 422 duplicate_store_code
--   PA013 tenant already has an active owner                            → 409 owner_exists
--   PA014 empty stores/seeds — a caller bug, deliberately unmapped      → 500
--
-- RLS note: as in 0065, these definers read and write tenant tables as their
-- OWNER (superuser locally, BYPASSRLS on RDS — definer-owner.test.ts).
-- admin_provision_tenant: every organization_id / store_id it writes comes
-- from RETURNING, never from the payload. admin_reissue_owner_invitation
-- writes the p_org the super admin named — after verifying it exists, is not
-- deleted, and locking it FOR UPDATE (naming the tenant is the point).

-- ---------------------------------------------------------------------------
-- 1. The trial clock
-- ---------------------------------------------------------------------------
ALTER TABLE organizations ADD COLUMN trial_ends_at timestamptz;

COMMENT ON COLUMN organizations.trial_ends_at IS
  'admin-console.md §4.2 / ADR-024: stamped by admin_provision_tenant() (now() + TRIAL_DAYS from packages/core). Read by the console; expiry becomes an event in the billing slice. NULL = not provisioned through the console.';
-- No CHECK tying it to status: F-69 fixtures and the manual transitions put
-- an organization in 'trial' without a clock, and a clock outliving the
-- status is a fact worth keeping ("this tenant WAS on trial until …").

COMMENT ON COLUMN organizations.status IS
  'Lifecycle (admin-console.md §4.2 on multi-tenancy.md §3 vocabulary). No prospect: provisioning is atomic (D-071); it arrives with the Stripe two-phase flow. churned = offboarding then purged.';

-- ---------------------------------------------------------------------------
-- 2. Directory + detail learn the clock and the pending owner seat.
--    OUT params change ⇒ DROP then CREATE (the 0065 intake_resolve precedent).
--    Bodies verbatim from 0065 plus the new columns.
-- ---------------------------------------------------------------------------
DROP FUNCTION admin_list_tenants(uuid, text, text, text, timestamptz, uuid, integer);

CREATE FUNCTION admin_list_tenants(
  p_actor uuid, p_status text, p_plan_code text, p_q text,
  p_cursor_created timestamptz, p_cursor_id uuid, p_limit integer)
RETURNS TABLE (
  id uuid, name text, slug text, legal_name text, status text, plan_id uuid, plan_code text,
  province text, default_locale text, store_count integer, member_count integer,
  created_at timestamptz, created_at_text text, activated_at timestamptz, suspended_at timestamptz,
  deleted_at timestamptz, trial_ends_at timestamptz)
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
         o.created_at, o.created_at::text, o.activated_at, o.suspended_at, o.deleted_at, o.trial_ends_at
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

DROP FUNCTION admin_get_tenant(uuid, uuid);

CREATE FUNCTION admin_get_tenant(p_actor uuid, p_org uuid)
RETURNS TABLE (
  id uuid, name text, slug text, legal_name text, status text, plan_id uuid, plan_code text,
  province text, default_locale text, store_count integer, member_count integer,
  created_at timestamptz, created_at_text text, activated_at timestamptz, suspended_at timestamptz,
  deleted_at timestamptz, trial_ends_at timestamptz,
  privacy_officer_name text, privacy_officer_email text, stripe_customer_id text,
  stores jsonb, owner_emails text[], last_activity_at timestamptz,
  owner_invitation jsonb)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM platform_assert_actor(p_actor, ARRAY['platform_super_admin','platform_support','platform_billing']);
  RETURN QUERY
  SELECT o.id, o.name, o.slug, o.legal_name, o.status, o.plan_id, o.plan_tier,
         o.province, o.default_locale,
         (SELECT count(*)::integer FROM stores s WHERE s.organization_id = o.id AND s.deleted_at IS NULL),
         (SELECT count(*)::integer FROM memberships m WHERE m.organization_id = o.id AND m.status = 'active'),
         o.created_at, o.created_at::text, o.activated_at, o.suspended_at, o.deleted_at, o.trial_ends_at,
         o.privacy_officer_name, o.privacy_officer_email, o.stripe_customer_id,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'code', s.code,
                                                        'province', s.province, 'status', s.status)
                                    ORDER BY s.code)
                   FROM stores s WHERE s.organization_id = o.id AND s.deleted_at IS NULL), '[]'::jsonb),
         COALESCE((SELECT array_agg(u.email ORDER BY u.email)
                   FROM memberships m JOIN users u ON u.id = m.user_id
                   WHERE m.organization_id = o.id AND m.status = 'active' AND 'owner' = ANY (m.roles)),
                  ARRAY[]::text[]),
         (SELECT max(a.created_at) FROM activity_events a WHERE a.organization_id = o.id),
         -- The open owner seat, if any. Never the token_hash.
         (SELECT jsonb_build_object('id', i.id, 'email', i.email, 'name', i.name,
                                    'expires_at', i.expires_at, 'expired', i.expires_at <= now())
          FROM invitations i
          WHERE i.organization_id = o.id AND 'owner' = ANY (i.roles)
            AND i.accepted_at IS NULL AND i.revoked_at IS NULL
          ORDER BY i.created_at DESC LIMIT 1)
  FROM organizations o
  WHERE o.id = p_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenant not found' USING ERRCODE = 'PA002';
  END IF;
END $$;
REVOKE ALL ON FUNCTION admin_get_tenant(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_get_tenant(uuid, uuid) TO dealpilot_app;

-- ---------------------------------------------------------------------------
-- 3. The birth (§4.3). One transaction: organization, stores, catalogues,
--    owner invitation and audit rows commit together or not at all.
-- ---------------------------------------------------------------------------
CREATE FUNCTION admin_provision_tenant(
  p_actor uuid, p_tenant jsonb, p_stores jsonb, p_owner jsonb, p_seeds jsonb,
  p_token_hash text, p_trial_days integer, p_invite_ttl_days integer)
RETURNS TABLE (organization_id uuid, invitation_id uuid, store_ids uuid[],
               trial_ends_at timestamptz, invitation_expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_org        uuid;
  v_existing   uuid;
  v_store      uuid;
  v_stores     uuid[] := '{}';
  v_inv        invitations%ROWTYPE;
  v_slug       text := p_tenant->>'slug';
  v_locale     text := p_tenant->>'default_locale';
  v_plan       uuid := (p_tenant->>'plan_id')::uuid;
  v_email      text := lower(btrim(p_owner->>'email'));
  v_until      timestamptz;
  s            jsonb;
BEGIN
  PERFORM platform_assert_actor(p_actor, ARRAY['platform_super_admin']);

  -- Defence in depth behind Zod and org-seeds.ts: an organization where
  -- nobody can do anything must not exist for a millisecond (f01 comment).
  IF jsonb_array_length(COALESCE(p_stores, '[]'::jsonb)) = 0
     OR jsonb_array_length(COALESCE(p_seeds->'role_permissions', '[]'::jsonb)) = 0
     OR jsonb_array_length(COALESCE(p_seeds->'lost_reasons', '[]'::jsonb)) = 0
     OR jsonb_array_length(COALESCE(p_seeds->'checklist', '[]'::jsonb)) = 0
     OR p_trial_days IS NULL OR p_trial_days < 1 OR p_invite_ttl_days IS NULL OR p_invite_ttl_days < 1 THEN
    RAISE EXCEPTION 'provisioning payload incomplete' USING ERRCODE = 'PA014';
  END IF;

  -- Idempotent on slug (§4.3): the existing id travels in DETAIL. A soft-
  -- deleted organization still holds its slug (UNIQUE, 0001) — the console
  -- links to it and shows the deleted chip.
  SELECT o.id INTO v_existing FROM organizations o WHERE o.slug = v_slug;
  IF FOUND THEN
    RAISE EXCEPTION 'slug % already provisioned', v_slug USING ERRCODE = 'PA011', DETAIL = v_existing::text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM plans p WHERE p.id = v_plan AND p.active) THEN
    RAISE EXCEPTION 'unknown or inactive plan' USING ERRCODE = 'PA007';
  END IF;

  v_until := now() + make_interval(days => p_trial_days);

  BEGIN
    INSERT INTO organizations (name, slug, legal_name, province, default_locale, plan_id, status, trial_ends_at)
    VALUES (p_tenant->>'display_name', v_slug, p_tenant->>'legal_name', p_tenant->>'province',
            v_locale, v_plan, 'trial', v_until)
    RETURNING organizations.id INTO v_org;
    -- organizations_sync_plan (0065) fills plan_tier; activated_at stays NULL
    -- because 'trial' is not 'active' (first entry into active is stamped by
    -- admin_set_tenant_status).
  EXCEPTION WHEN unique_violation THEN
    -- Lost the race against a concurrent provisioning of the same slug. The
    -- winner is committed by the time the index refuses us: answer with ITS id.
    SELECT o.id INTO v_existing FROM organizations o WHERE o.slug = v_slug;
    RAISE EXCEPTION 'slug % already provisioned', v_slug USING ERRCODE = 'PA011', DETAIL = COALESCE(v_existing::text, '');
  END;

  -- §12: the tenant sees who created it (the F-01 equivalent is f01-routes.ts
  -- organization 'created'). Same {field:{from,to}} shape as recordEvent.
  INSERT INTO activity_events (organization_id, actor_user_id, actor_type, entity_type, entity_id, action, changes, restricted)
  VALUES (v_org, p_actor, 'platform', 'organization', v_org, 'created',
          jsonb_build_object(
            'slug',           jsonb_build_object('from', NULL, 'to', v_slug),
            'status',         jsonb_build_object('from', NULL, 'to', 'trial'),
            'plan_id',        jsonb_build_object('from', NULL, 'to', v_plan),
            'trial_ends_at',  jsonb_build_object('from', NULL, 'to', v_until),
            'legal_name',     jsonb_build_object('from', NULL, 'to', p_tenant->>'legal_name'),
            'province',       jsonb_build_object('from', NULL, 'to', p_tenant->>'province'),
            'default_locale', jsonb_build_object('from', NULL, 'to', v_locale)),
          false);

  -- A-13 matrix (= seedPermissions, apps/api/src/permissions.ts) and F-53
  -- lost reasons (= seedLostReasons, f01-routes.ts), from the same constants.
  INSERT INTO role_permissions (organization_id, role, permission)
  SELECT v_org, r->>'role', r->>'permission'
  FROM jsonb_array_elements(p_seeds->'role_permissions') r;

  INSERT INTO lost_reasons (organization_id, name, name_fr, icon, display_order)
  SELECT v_org, t.l->>'name', t.l->>'name_fr', t.l->>'icon', t.ord::integer
  FROM jsonb_array_elements(p_seeds->'lost_reasons') WITH ORDINALITY AS t(l, ord);

  -- Stores (§4.3 stores[]) + the per-store delivery checklist (= ensureTemplate,
  -- apps/api/src/checklist.ts). Store locale inherits the tenant's: §4.3's
  -- store body has no locale. Every other store column keeps its DEFAULT
  -- (0001 status, 0017 dispatch window, 0023 bill_of_sale_system, 0054 hours).
  -- The timezone was checked by the route (assertKnownTimezone) — pg_timezone_names carries no RLS.
  FOR s IN SELECT value FROM jsonb_array_elements(p_stores) LOOP
    BEGIN
      INSERT INTO stores (organization_id, name, code, province, city, timezone, default_locale)
      VALUES (v_org, s->>'name', s->>'code', s->>'province', NULLIF(btrim(s->>'city'), ''), s->>'timezone', v_locale)
      RETURNING stores.id INTO v_store;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'duplicate store code %', s->>'code' USING ERRCODE = 'PA012', DETAIL = s->>'code';
    END;
    v_stores := v_stores || v_store;

    INSERT INTO checklist_templates (organization_id, store_id, code, label_fr, label_en, required, overridable, sort_order)
    SELECT v_org, v_store, c->>'code', c->>'label_fr', c->>'label_en', true,
           (c->>'overridable')::boolean, (c->>'sort_order')::integer
    FROM jsonb_array_elements(p_seeds->'checklist') c;

    INSERT INTO activity_events (organization_id, store_id, actor_user_id, actor_type, entity_type, entity_id, action,
                                 changes, parent_entity_type, parent_entity_id, restricted)
    VALUES (v_org, v_store, p_actor, 'platform', 'store', v_store, 'created',
            jsonb_build_object('code',     jsonb_build_object('from', NULL, 'to', s->>'code'),
                               'timezone', jsonb_build_object('from', NULL, 'to', s->>'timezone')),
            'organization', v_org, false);
  END LOOP;

  -- The founding owner's seat: an F-12 invitation (0015), org-wide. No users
  -- row, no membership until a real person accepts (D-035). invited_by = the
  -- staffer's users row (platform_staff_grant upserts it, 0065).
  INSERT INTO invitations (organization_id, store_id, email, name, roles, token_hash, invited_by, expires_at)
  VALUES (v_org, NULL, v_email, NULLIF(btrim(p_owner->>'name'), ''), ARRAY['owner'], p_token_hash, p_actor,
          now() + make_interval(days => p_invite_ttl_days))
  RETURNING * INTO v_inv;

  INSERT INTO activity_events (organization_id, actor_user_id, actor_type, entity_type, entity_id, action,
                               changes, parent_entity_type, parent_entity_id, restricted)
  VALUES (v_org, p_actor, 'platform', 'invitation', v_inv.id, 'created',
          jsonb_build_object('email', v_email, 'roles', jsonb_build_object('from', NULL, 'to', to_jsonb(v_inv.roles))),
          'organization', v_org, false);

  RETURN QUERY SELECT v_org, v_inv.id, v_stores, v_until, v_inv.expires_at;
END $$;
REVOKE ALL ON FUNCTION admin_provision_tenant(uuid, jsonb, jsonb, jsonb, jsonb, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_provision_tenant(uuid, jsonb, jsonb, jsonb, jsonb, text, integer, integer) TO dealpilot_app;

-- ---------------------------------------------------------------------------
-- 4. Re-issue the owner seat (expired 7-day link, mistyped email). Refused
--    once an owner is active: from then on F-12's tenant path is the door.
-- ---------------------------------------------------------------------------
CREATE FUNCTION admin_reissue_owner_invitation(
  p_actor uuid, p_org uuid, p_email text, p_name text, p_token_hash text, p_invite_ttl_days integer)
RETURNS TABLE (invitation_id uuid, email text, expires_at timestamptz, revoked_invitation_ids uuid[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_email   text := lower(btrim(p_email));
  v_inv     invitations%ROWTYPE;
  v_revoked uuid[] := '{}';
  v_id      uuid;
  v_old     text;
BEGIN
  PERFORM platform_assert_actor(p_actor, ARRAY['platform_super_admin']);

  IF p_invite_ttl_days IS NULL OR p_invite_ttl_days < 1 OR v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'reissue payload incomplete' USING ERRCODE = 'PA014';
  END IF;

  -- Locked: two staffers re-issuing at once serialize here, so the second
  -- sees the first's row and revokes it instead of tripping the open index.
  PERFORM 1 FROM organizations o WHERE o.id = p_org AND o.deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenant not found' USING ERRCODE = 'PA002';
  END IF;

  -- The stranded-row rule of f12 assertNotAlreadyMember: an owner with no
  -- sign-in identity behind them is not an owner.
  IF EXISTS (SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
             WHERE m.organization_id = p_org AND m.status = 'active' AND 'owner' = ANY (m.roles)
               AND EXISTS (SELECT 1 FROM "user" a WHERE a.id = u.id::text)) THEN
    RAISE EXCEPTION 'tenant already has an owner' USING ERRCODE = 'PA013';
  END IF;

  -- Replace, never duplicate (idx_invitations_open_per_email, 0015): every open
  -- owner seat AND any open invitation to this address goes first.
  -- The journal row names the address that lost its seat (a row with empty
  -- changes reads as nothing in the console; review).
  FOR v_id, v_old IN
    UPDATE invitations SET revoked_at = now()
    WHERE invitations.organization_id = p_org AND invitations.accepted_at IS NULL AND invitations.revoked_at IS NULL
      AND ('owner' = ANY (invitations.roles) OR invitations.email = v_email)
    RETURNING invitations.id, invitations.email
  LOOP
    v_revoked := v_revoked || v_id;
    INSERT INTO activity_events (organization_id, actor_user_id, actor_type, entity_type, entity_id, action, changes, restricted)
    VALUES (p_org, p_actor, 'platform', 'invitation', v_id, 'revoked', jsonb_build_object('email', v_old), false);
  END LOOP;

  INSERT INTO invitations (organization_id, store_id, email, name, roles, token_hash, invited_by, expires_at)
  VALUES (p_org, NULL, v_email, NULLIF(btrim(p_name), ''), ARRAY['owner'], p_token_hash, p_actor,
          now() + make_interval(days => p_invite_ttl_days))
  RETURNING * INTO v_inv;

  INSERT INTO activity_events (organization_id, actor_user_id, actor_type, entity_type, entity_id, action, changes, restricted)
  VALUES (p_org, p_actor, 'platform', 'invitation', v_inv.id, 'created',
          jsonb_build_object('email', v_email, 'roles', jsonb_build_object('from', NULL, 'to', to_jsonb(v_inv.roles)), 'reissued', true),
          false);

  RETURN QUERY SELECT v_inv.id, v_inv.email, v_inv.expires_at, v_revoked;
END $$;
REVOKE ALL ON FUNCTION admin_reissue_owner_invitation(uuid, uuid, text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_reissue_owner_invitation(uuid, uuid, text, text, text, integer) TO dealpilot_app;

-- Not in this migration, on purpose: no new table (rls-coverage untouched),
-- no CHECK swap on organizations.status (no prospect), no new activity verbs
-- or entity types (organization/store/invitation + created/revoked exist,
-- 0064), no platform_audit_events event (staff.* only), no tenant_branding
-- or tenant_comms_config row (absence is the default by design, F-14/F-15).
