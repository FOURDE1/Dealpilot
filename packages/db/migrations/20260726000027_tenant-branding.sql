-- 0027 — white-label branding per tenant (white-labeling.md §2; ADR-018).
--
-- Phase 2 of the roadmap: the platform becomes multi-tenant in fact rather than
-- only in schema. A dealership group gets its own name, logo, colours, font and
-- corner radius, from ONE deployment — no per-tenant build, no per-tenant
-- deploy.
--
-- Two things this table is careful about:
--
-- 1. DRAFT vs PUBLISHED. The SPA only ever receives a published row. Somebody
--    experimenting with a puce primary at 4pm on a Friday must not repaint the
--    app for every user on the floor while they are still deciding.
-- 2. The contrast fixes are STORED, not recomputed on read. `contrast_adjustments`
--    records exactly what the server changed and why, so a tenant who asks "I
--    picked #FDE047, why is my link darker?" gets an answer with a number in it
--    instead of a shrug.
--
-- The spec calls the key `tenant_id`; this schema has always said
-- `organization_id` and the schema is the vocabulary that ships (ADR-007).

CREATE TABLE tenant_branding (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id),
  -- Non-null = a rooftop sub-brand; resolution prefers the store row (§3).
  store_id           uuid,

  display_name       text CHECK (display_name IS NULL OR btrim(display_name) <> ''),
  legal_name         text,
  support_email      text,
  support_phone      text,
  sms_sender_name    text,
  -- ADR-022 first-turn disclosure: the AI says this name when it introduces
  -- itself, so it is branding, not configuration.
  ai_persona_name    text NOT NULL DEFAULT 'Alex',

  -- Asset keys, not URLs: the file lives behind F-13c's storage driver and is
  -- served by the API, so a private bucket never needs to become public.
  logo_light_key     text,
  logo_dark_key      text,
  favicon_key        text,
  email_logo_key     text,
  login_bg_key       text,

  -- Colours are OKLCH strings (§2). Validated and auto-fixed in packages/core
  -- at publish; the CHECK here is a shape guard, not a colour theory.
  primary_color      text NOT NULL DEFAULT 'oklch(0.55 0.2 262)'
                     CHECK (primary_color ~* '^oklch\([0-9.]+ [0-9.]+ [0-9.]+\)$'),
  accent_color       text CHECK (accent_color IS NULL OR accent_color ~* '^oklch\([0-9.]+ [0-9.]+ [0-9.]+\)$'),
  success_color      text CHECK (success_color IS NULL OR success_color ~* '^oklch\([0-9.]+ [0-9.]+ [0-9.]+\)$'),
  warning_color      text CHECK (warning_color IS NULL OR warning_color ~* '^oklch\([0-9.]+ [0-9.]+ [0-9.]+\)$'),
  danger_color       text CHECK (danger_color IS NULL OR danger_color ~* '^oklch\([0-9.]+ [0-9.]+ [0-9.]+\)$'),
  info_color         text CHECK (info_color IS NULL OR info_color ~* '^oklch\([0-9.]+ [0-9.]+ [0-9.]+\)$'),

  font_family        text NOT NULL DEFAULT 'inter'
                     CHECK (font_family IN ('inter','system','custom')),
  font_woff2_key     text,
  font_woff2_bold_key text,
  radius             text NOT NULL DEFAULT 'md' CHECK (radius IN ('none','sm','md','lg')),
  density            text NOT NULL DEFAULT 'comfortable' CHECK (density IN ('comfortable','compact')),
  dark_mode          text NOT NULL DEFAULT 'derived' CHECK (dark_mode IN ('derived','custom','disabled')),

  -- The whole published VIEW, snapshotted at publish: name, logo keys, font,
  -- radius, density, dark-mode strategy and the computed palette.
  --
  -- A snapshot rather than a status flag over the live columns, because those
  -- columns are the DRAFT. Serving them beside the last published palette would
  -- leak a half-finished rename to the sales floor, and filtering the live read
  -- on `status='published'` would make the app go unbranded the moment somebody
  -- opened the editor. Editing must neither repaint the app nor blank it.
  published_snapshot jsonb,
  contrast_adjustments jsonb NOT NULL DEFAULT '[]'::jsonb,

  status             text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  -- 'draft' here means "has unpublished edits", NOT "nothing is live": the
  -- snapshot above stays served either way.
  -- Bumped on publish; the SPA uses it to bust its cached stylesheet (§3).
  version            integer NOT NULL DEFAULT 1 CHECK (version > 0),
  published_at       timestamptz,

  deleted_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (organization_id, store_id) REFERENCES stores (organization_id, id),
  -- A published row has to carry what was published. A published row with no
  -- palette would repaint the app from nothing.
  CHECK (published_snapshot IS NULL OR published_at IS NOT NULL)
);

-- One brand per organisation, and one per store that overrides it. Partial so a
-- retired override can be soft-deleted and a new one created.
CREATE UNIQUE INDEX idx_tenant_branding_org
  ON tenant_branding (organization_id)
  WHERE store_id IS NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX idx_tenant_branding_store
  ON tenant_branding (store_id)
  WHERE store_id IS NOT NULL AND deleted_at IS NULL;

CREATE TRIGGER tenant_branding_updated_at BEFORE UPDATE ON tenant_branding
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE ON tenant_branding TO dealpilot_app;

ALTER TABLE tenant_branding ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_branding FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_branding_isolation ON tenant_branding
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- The activity vocabulary gains this entity (forward-only; 0025 last set it).
ALTER TABLE activity_events DROP CONSTRAINT activity_events_entity_type_check;
ALTER TABLE activity_events ADD CONSTRAINT activity_events_entity_type_check
  CHECK (entity_type IN ('deal','lead','vehicle','membership','pay_plan',
                         'checklist_item','checklist_template','intake_key',
                         'invitation','dispatch_assignment','deal_document',
                         'deal_fi_product','tenant_branding','organization','store'));

ALTER TABLE activity_events DROP CONSTRAINT activity_events_parent_entity_type_check;
ALTER TABLE activity_events ADD CONSTRAINT activity_events_parent_entity_type_check
  CHECK (parent_entity_type IS NULL OR parent_entity_type IN
         ('deal','lead','vehicle','membership','pay_plan',
          'checklist_item','checklist_template','intake_key',
          'invitation','dispatch_assignment','deal_document',
          'deal_fi_product','tenant_branding','organization','store'));

COMMENT ON COLUMN tenant_branding.contrast_adjustments IS
  'What the server changed to meet WCAG AA at publish, and by how much — shown on the publish confirmation (white-labeling.md §12).';
