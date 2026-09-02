-- 0073 — the lender registry, and the deal that names its lender
-- (F-80; lenders-billofsale.md §1.1–§1.2; FR-FIN-007 P1; closes O-15's
-- lenders cell; Q-14 decided 2026-07-23: manual tracking, no lender APIs).
--
-- THREE concerns travel together because each is the other's consumer:
--   1. `lenders` — the tenant-scoped registry (§1.1 trimmed to the columns
--      this slice reads AND writes; rate_sheet_url / avg_turnaround_days /
--      approval_criteria / store_id / defaultRate are CUT BY NAME — D-081
--      records each un-cut condition; defaultRate is pricing and this slice
--      adds NO pricing vocabulary).
--   2. `deals.lender_id` — the FK the desking screen writes and the
--      pipeline/lead screens render (§1.2 Target: "deals get a real
--      lender_id FK"). Nullable: an existing deal has no lender.
--   3. The seeds — §1.2's 18 Canadian defaults for EVERY organization,
--      whichever door it was born through: the backfill below covers the
--      existing orgs; apps/api f01 seeds self-serve births; the
--      admin_provision_tenant restatement (BELOW, never editing 0066)
--      seeds console births; plus the lender:manage role_permissions
--      backfill (0057/0072 shape).
--
-- The 18 rows are FROZEN from packages/schemas LENDER_DEFAULTS (the single
-- source all three birth paths read); the lockstep test in
-- apps/api/src/f80-lender-seed.test.ts pins this file's tuples to the
-- constant, so the frozen copy cannot drift silently (the 0055 lesson), and
-- packages/db/src/migration-0073-backfill.test.ts executes the backfill
-- against pre-0073 organizations.

-- ---------------------------------------------------------------------
-- 1. The registry
-- ---------------------------------------------------------------------
CREATE TABLE lenders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name            text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 120),
  -- The compact label the pipeline card renders beside the funding status;
  -- NULL falls back to name at the render site.
  short_name      text CHECK (short_name IS NULL OR (btrim(short_name) <> '' AND length(short_name) <= 20)),
  category        text NOT NULL CHECK (category IN ('PRIME','NEAR_PRIME','SUBPRIME','CAPTIVE')),
  contact_name    text CHECK (contact_name  IS NULL OR length(contact_name)  <= 120),
  contact_email   text CHECK (contact_email IS NULL OR length(contact_email) <= 254),
  contact_phone   text CHECK (contact_phone IS NULL OR length(contact_phone) <= 30),
  notes           text CHECK (notes IS NULL OR length(notes) <= 500),
  -- §1.1: soft deactivation. A deactivated lender keeps its deals and its
  -- name on every screen; only NEW picks stop offering it (route-enforced).
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- One name per org, exact-string (0055's sibling shape — « TD » and « td »
  -- may coexist, visibly, D-081). The duplicate 23505 is caught in-route and
  -- mapped to 409 duplicate_name — the f53 lost-reasons shape
  -- (f53-lost-reason-routes.ts:77-83); no shared conflictFrom plumbing
  -- touches this table.
  UNIQUE (organization_id, name),
  -- Composite target for the deals FK below (the 0055 stores precedent:
  -- the DB itself refuses a rival's lender id, not just the route check).
  UNIQUE (organization_id, id)
);

CREATE TRIGGER lenders_updated_at BEFORE UPDATE ON lenders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_lenders_org ON lenders (organization_id, category, name);

-- Registry-shape grants: no DELETE ever — deals reference lenders from
-- birth; soft-off is `active`. (lost_reasons' DELETE-while-unreferenced
-- does not apply: the seed is referenced-by-design.)
GRANT SELECT, INSERT, UPDATE ON lenders TO dealpilot_app;

ALTER TABLE lenders ENABLE ROW LEVEL SECURITY;
ALTER TABLE lenders FORCE  ROW LEVEL SECURITY;

-- One org-keyed policy, 0072's exact shape. NO bare user-keyed policy and
-- no member_read policy: routes resolve the org first (requireMember under
-- withTenant for the list; the clawbackOrg iteration for id-addressed
-- writes) so the isolation policy is the only door.
CREATE POLICY lenders_isolation ON lenders
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

COMMENT ON TABLE lenders IS
  'Tenant lender registry (lenders-billofsale.md §1.1): 18 Canadian defaults seeded per organization at every birth path, extendable; the desking screen picks from it and deals.lender_id references it.';

-- ---------------------------------------------------------------------
-- 2. The deal names its lender
-- ---------------------------------------------------------------------
-- Nullable — an existing deal has no lender, and a cash deal never gets
-- one. Composite FK so a cross-tenant lender id is refused by the schema
-- itself, defence in depth behind requireLenderInOrg (0055's own words:
-- FK checks bypass RLS, so the bare form would accept a rival's id). No
-- ON DELETE action: the app role holds no DELETE grant on lenders.
ALTER TABLE deals
  ADD COLUMN lender_id uuid,
  ADD CONSTRAINT deals_lender_fk
    FOREIGN KEY (organization_id, lender_id)
    REFERENCES lenders (organization_id, id);

CREATE INDEX idx_deals_lender ON deals (lender_id) WHERE lender_id IS NOT NULL;

COMMENT ON COLUMN deals.lender_id IS
  'lenders-billofsale.md §1.2 Target: the lender funding this deal, written by the desking screen (deal:update), rendered beside funding_status. Nullable: pre-F-80 deals and cash deals name none. Deactivating the lender never clears this — history keeps its name.';

-- ---------------------------------------------------------------------
-- 3a. Seed EXISTING organizations (the third birth path).
--     Frozen from packages/schemas LENDER_DEFAULTS — the lockstep test
--     pins every tuple. Idempotent under the SAME name only (exact-string
--     UNIQUE): an org that already has a row under the same name keeps it
--     untouched. Soft-deleted organizations are seeded too — bare
--     FROM organizations matches 0055/0057/0072, and the ship-time
--     spot-check counts ALL organizations × 18.
-- ---------------------------------------------------------------------
INSERT INTO lenders (organization_id, name, short_name, category, notes)
SELECT o.id, d.name, d.short_name, d.category, d.notes
FROM organizations o
CROSS JOIN (VALUES
  ('TD Auto Finance',                          'TD',     'PRIME',      NULL),
  ('RBC Royal Bank',                           'RBC',    'PRIME',      NULL),
  ('CIBC',                                     'CIBC',   'PRIME',      NULL),
  ('Scotiabank',                               'Scotia', 'PRIME',      NULL),
  ('Desjardins',                               'Desj.',  'PRIME',      NULL),
  ('National Bank',                            'NBC',    'PRIME',      NULL),
  ('BMO Bank of Montreal',                     'BMO',    'PRIME',      NULL),
  ('Scotia Dealer Advantage',                  'SDA',    'NEAR_PRIME', NULL),
  ('iA Financial Group (Industrial Alliance)', 'iA',     'NEAR_PRIME', NULL),
  ('ACC (Automotive Credit Corporation)',      'ACC',    'NEAR_PRIME', NULL),
  ('TD Non-Prime (TD Auto Finance Special)',   'TD NP',  'NEAR_PRIME', 'TD subprime program'),
  ('Eden Park',                                'Eden',   'NEAR_PRIME', NULL),
  ('Santander Consumer Canada',                'Sant.',  'SUBPRIME',   NULL),
  ('Iceberg Finance',                          'Ice.',   'SUBPRIME',   NULL),
  ('Quantifi (by Desjardins)',                 'Quant.', 'SUBPRIME',   NULL),
  ('Rifco National Auto Finance',              'Rifco',  'SUBPRIME',   NULL),
  ('Northlake Financial',                      'NLake',  'SUBPRIME',   NULL),
  ('Kia Finance (KFCC)',                       'KIA',    'CAPTIVE',    'Kia Finance Company of Canada')
) AS d(name, short_name, category, notes)
ON CONFLICT (organization_id, name) DO NOTHING;

-- ---------------------------------------------------------------------
-- 3b. The console birth seeds lenders too: admin_provision_tenant is
--     RESTATED (0066 is never edited). Same 8-parameter signature and OUT
--     table, so CREATE OR REPLACE (the 0065/0066 DROP-then-CREATE rule
--     applies only to OUT-param changes); the body is copied from 0066's
--     $$ block (:153-274) with exactly two insertions:
--       (i)  the PA014 guard gains a lenders-emptiness arm (the same
--            jsonb_array_length shape as its sibling arms) — an organization
--            born without its lender pick-list is the same "nobody can do
--            anything" class the guard exists for;
--       (ii) after the lost_reasons INSERT, the lenders INSERT over
--            jsonb_array_elements(p_seeds->'lenders').
--     Everything else — actor assert, slug idempotency, plan check,
--     activity rows, stores loop, checklist seed, owner invitation,
--     RETURN — is copied byte-for-byte from the 0066 FILE (never from a
--     live pg_get_functiondef dump). Any other diff between the two
--     bodies is a defect.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_provision_tenant(
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
     OR jsonb_array_length(COALESCE(p_seeds->'lenders', '[]'::jsonb)) = 0
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

  -- F-80: the lender catalog (= LENDER_DEFAULTS via org-seeds.ts
  -- provisioningSeeds() — SQL owns no copy). Plain INSERT: a fresh org
  -- cannot conflict; a duplicate in the payload is a caller bug that must
  -- abort the birth.
  INSERT INTO lenders (organization_id, name, short_name, category, notes)
  SELECT v_org, l->>'name', l->>'short_name', l->>'category', l->>'notes'
  FROM jsonb_array_elements(p_seeds->'lenders') l;

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
-- CREATE OR REPLACE keeps the 0066 ACL, restated anyway so the file is
-- self-evidently the 0065/0066 shape:
REVOKE ALL ON FUNCTION admin_provision_tenant(uuid, jsonb, jsonb, jsonb, jsonb, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_provision_tenant(uuid, jsonb, jsonb, jsonb, jsonb, text, integer, integer) TO dealpilot_app;

-- ---------------------------------------------------------------------
-- 3c. The authority joins the catalogue for EXISTING orgs (0057/0072
--     shape). New orgs get it from DEFAULT_ROLE_PERMISSIONS via both
--     birth seeds. Defaults per D-081: owner, gm, fi_manager — rows
--     written for all three so the backfill equals the TS default.
-- ---------------------------------------------------------------------
INSERT INTO role_permissions (organization_id, role, permission)
SELECT o.id, d.role, d.permission
FROM organizations o
CROSS JOIN (VALUES
  ('owner',      'lender:manage'),
  ('gm',         'lender:manage'),
  ('fi_manager', 'lender:manage')
) AS d(role, permission)
ON CONFLICT DO NOTHING;
