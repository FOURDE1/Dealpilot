-- 0001 foundation: organizations, stores, users, memberships (A-04)
-- Conventions (ADR-009): integer cents, soft deletes, timestamptz, CHECK-backed
-- vocabularies mirroring @dealpilot/schemas exactly. Tenant isolation: RLS
-- ENABLED + FORCED on every tenant table, keyed by the transaction-local GUC
-- `app.org_id` set via SET LOCAL (multi-tenancy.md §4; packages/db withTenant).

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- organizations (tenant root)
-- ---------------------------------------------------------------------------
CREATE TABLE organizations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 200),
  slug               text NOT NULL UNIQUE
                     CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 3 AND 40),
  status             text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','trial','past_due','read_only','suspended','offboarding','purged')),
  plan_tier          text NOT NULL DEFAULT 'core'
                     CHECK (plan_tier IN ('core','growth','scale','enterprise')),
  stripe_customer_id text UNIQUE,
  default_locale     text NOT NULL DEFAULT 'fr-CA' CHECK (default_locale IN ('fr-CA','en-CA')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);

CREATE TRIGGER organizations_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- stores
-- ---------------------------------------------------------------------------
CREATE TABLE stores (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name            text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 200),
  code            text NOT NULL
                  CHECK (code ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$' AND length(code) BETWEEN 2 AND 20),
  phone           text CHECK (phone ~ '^\+1[0-9]{10}$'),
  address_line1   text CHECK (length(address_line1) <= 200),
  city            text CHECK (length(city) <= 100),
  province        text NOT NULL
                  CHECK (province IN ('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT')),
  postal_code     text CHECK (postal_code ~ '^[A-Z][0-9][A-Z] [0-9][A-Z][0-9]$'),
  default_locale  text NOT NULL DEFAULT 'fr-CA' CHECK (default_locale IN ('fr-CA','en-CA')),
  timezone        text NOT NULL DEFAULT 'America/Montreal' CHECK (btrim(timezone) <> ''),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','closed')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  UNIQUE (organization_id, code),
  UNIQUE (organization_id, id)  -- composite target so FKs can enforce same-org consistency
);

CREATE INDEX idx_stores_org_status ON stores (organization_id, status) WHERE deleted_at IS NULL;

CREATE TRIGGER stores_updated_at BEFORE UPDATE ON stores
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- users (global identities — org linkage lives in memberships)
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE CHECK (email = lower(btrim(email)) AND position('@' IN email) > 1),
  name          text NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 120),
  phone         text CHECK (phone ~ '^\+1[0-9]{10}$'),
  language_pref text NOT NULL DEFAULT 'fr-CA' CHECK (language_pref IN ('fr-CA','en-CA')),
  status        text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','disabled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- memberships = (user, organization, store, roles[]) — additive multi-role
-- ---------------------------------------------------------------------------
CREATE TABLE memberships (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  store_id        uuid,
  roles           text[] NOT NULL
                  CHECK (cardinality(roles) >= 1 AND roles <@ ARRAY[
                    'owner','gm','sales_manager','used_car_manager','fi_manager',
                    'salesperson','wholesale_manager','logistics','admin_office','bdc_agent'
                  ]::text[]),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','revoked')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (user_id, organization_id, store_id),
  -- The store must belong to the SAME organization — cross-org membership
  -- poisoning is structurally impossible (code-review finding, 2026-07-24).
  FOREIGN KEY (organization_id, store_id) REFERENCES stores (organization_id, id)
);

CREATE INDEX idx_memberships_org_user ON memberships (organization_id, user_id) WHERE status = 'active';
CREATE INDEX idx_memberships_user ON memberships (user_id) WHERE status = 'active';

CREATE TRIGGER memberships_updated_at BEFORE UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Application role (least privilege; FORCE RLS applies to it)
-- Dev password matches docker-compose; staging/prod override via Secrets
-- Manager at provision time (never in git).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dealpilot_app') THEN
    -- NOLOGIN here: no credential in git. LOGIN + password are granted per
    -- environment — dev via the local `db reset` bootstrap, staging/prod via
    -- Secrets Manager at provision time (D-022).
    CREATE ROLE dealpilot_app NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO dealpilot_app;
GRANT SELECT, INSERT, UPDATE ON organizations, stores, users, memberships TO dealpilot_app;
-- No DELETE grants anywhere: soft deletes only (ADR-009).

-- ---------------------------------------------------------------------------
-- Row-level security: ENABLED + FORCED everywhere; tenant key = app.org_id GUC.
-- current_setting(..., true) yields NULL when unset -> policies evaluate to
-- NULL -> no rows. No tenant context = no data, by construction.
-- ---------------------------------------------------------------------------
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE stores        ENABLE ROW LEVEL SECURITY;
ALTER TABLE stores        FORCE ROW LEVEL SECURITY;
ALTER TABLE users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE users         FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships   ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships   FORCE ROW LEVEL SECURITY;

CREATE POLICY org_isolation ON organizations
  USING (id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('app.org_id', true), '')::uuid);

CREATE POLICY store_isolation ON stores
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

CREATE POLICY membership_isolation ON memberships
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- Users are visible only via an ACTIVE membership in the current org (a
-- revoked membership grants nothing). Writes always require tenant context —
-- WITH CHECK (true) is banned (docs/SECURITY.md; D-022). Note: INSERT with
-- RETURNING cannot work under this model (the SELECT policy needs a membership
-- that does not exist yet) — A-05 user creation uses client-generated uuids and
-- inserts user + membership inside one withTenant transaction.
CREATE POLICY user_read ON users FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.user_id = users.id
      AND m.status = 'active'
      AND m.organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  ));

CREATE POLICY user_write ON users FOR INSERT
  WITH CHECK (NULLIF(current_setting('app.org_id', true), '') IS NOT NULL);

CREATE POLICY user_update ON users FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.user_id = users.id
      AND m.status = 'active'
      AND m.organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid
  ));
