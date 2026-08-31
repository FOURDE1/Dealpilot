-- 0070 — retire two branding values that have had no producer since F-14
-- (F-75; white-labeling.md §5, §6; D-076).
--
-- `dark_mode='custom'` has no columns to carry custom dark values and no code
-- path; `font_family='custom'` has no upload slot, no @font-face injection, and
-- an editor that mapped it back to 'inter'. Both sat in the CHECK, the Zod enum
-- and (dark) the editor's select — declared everywhere, reachable nowhere. F-75
-- writes the first consumers of `dark_mode` and `font_family`; a consumer that
-- must alias `custom` is the dead-vocabulary bug in new code, so the value goes
-- before the consumer lands. Forward-only; 0027 is applied and untouched.
--
-- UN-CUT CONDITIONS, verbatim (recorded in D-076 — a value returns only with
-- its producer and consumer, in one slice):
--   dark_mode='custom'   — explicit dark colour columns + validateBrandingContrast
--                          taking them + editor fields, in one slice.
--   font_family='custom' — a `font` slot (WOFF2 allowlist, 300 KB × 2), the §6
--                          licence attestation columns, @font-face + preload
--                          injection — its own slice, re-adding the value with
--                          producer and consumer together.
--
-- WHAT EACH DATA STATEMENT IS FOR:
--   * The two column UPDATEs move any row holding a retired value to the
--     default, so the narrowed CHECK cannot fail to apply.
--   * The `published_snapshot` VALUE rewrite (custom → derived / inter) is the
--     PARSE-SAFETY fix: the SPA parses the frozen payload with the narrowed
--     `PublishedBranding` enum, and a stale `custom` would fail that parse and
--     silently unbrand the tenant. The editor has offered `dark_mode='custom'`
--     since F-14, so the migration must not assume no snapshot carries it.
--   * The `font_woff2_key` / `font_woff2_bold_key` KEY scrub is HYGIENE, not
--     parse safety: zod 4.4.3 `z.object` strips unknown keys, so a snapshot
--     still carrying them would parse. It is done anyway because a retired key
--     inside a frozen payload is the dead-vocabulary pattern this slice exists
--     to end — and it is NOT a no-op: on the dev database (read-only probe,
--     2026-08-31) it touches 72 of 72 published rows, every one of which
--     carries both keys as JSON null, and fires `tenant_branding_updated_at`
--     (0027) on each. `version` is untouched ON PURPOSE: the SPA re-reads on
--     staleTime, not on version, and the palette inside the snapshot is the
--     same palette — a new version here would claim a publish nobody made.
--   * The rewrite uses `||` with a null-stripped object rather than
--     `jsonb_set` with a CASE: `jsonb_set(target, path, NULL)` returns NULL,
--     which would replace a whole snapshot with NULL for any row whose snapshot
--     lacked the key. The `||` form rewrites a key only when it holds `custom`
--     and cannot null a row.
--   * The DO block makes the migration FAIL if any retired value survives — a
--     CHECK restatement that raced a concurrent write would otherwise fail
--     with a less useful error, and a silent partial rewrite must not commit.
--
-- RLS: `tenant_branding` is FORCE ROW LEVEL SECURITY (0027). Locally the
-- migration role `dealpilot` is a superuser with BYPASSRLS (rls.test.ts); on
-- RDS the role MUST hold BYPASSRLS (docs/SECURITY.md; 0065). Without the line
-- below a non-BYPASSRLS runner would see zero rows: every UPDATE would touch
-- nothing, the DO block would pass VACUOUSLY, and the migration would report
-- success having done nothing — exactly the case 0012 documents. With
-- `row_security = off` that runner ERRORS instead of lying. Valid here because
-- migrate.ts wraps each file in its own transaction, so SET LOCAL is scoped to
-- this file.
SET LOCAL row_security = off;

-- Rows that hold a retired value are moved to the default first (none on the
-- dev database today: 0 `custom` in either column — the migration must not
-- assume that of any other database).
UPDATE tenant_branding SET dark_mode = 'derived' WHERE dark_mode = 'custom';
UPDATE tenant_branding SET font_family = 'inter'  WHERE font_family = 'custom';

-- The frozen payload: retired values rewritten, retired keys removed. Scoped
-- to the rows that carry either, so an already-clean snapshot is not rewritten
-- (and its updated_at not bumped) for nothing.
UPDATE tenant_branding
   SET published_snapshot =
         (published_snapshot - 'font_woff2_key' - 'font_woff2_bold_key')
         || jsonb_strip_nulls(jsonb_build_object(
              'dark_mode',   CASE WHEN published_snapshot->>'dark_mode'   = 'custom' THEN 'derived' END,
              'font_family', CASE WHEN published_snapshot->>'font_family' = 'custom' THEN 'inter'   END))
 WHERE published_snapshot IS NOT NULL
   AND (   published_snapshot ? 'font_woff2_key'
        OR published_snapshot ? 'font_woff2_bold_key'
        OR published_snapshot->>'dark_mode'   = 'custom'
        OR published_snapshot->>'font_family' = 'custom');

-- Nothing retired may survive into the CHECK restatement below.
DO $$
DECLARE
  survivors integer;
BEGIN
  SELECT count(*) INTO survivors
    FROM tenant_branding
   WHERE dark_mode = 'custom'
      OR font_family = 'custom'
      OR published_snapshot ? 'font_woff2_key'
      OR published_snapshot ? 'font_woff2_bold_key'
      OR published_snapshot->>'dark_mode'   = 'custom'
      OR published_snapshot->>'font_family' = 'custom';
  IF survivors > 0 THEN
    RAISE EXCEPTION '0070: % tenant_branding row(s) still carry a retired branding value after the rewrite', survivors;
  END IF;
END $$;

-- Constraint names confirmed live via pg_constraint on `dealpilot` and
-- `dealpilot_test` (2026-08-31): Postgres names an inline column CHECK
-- `<table>_<column>_check`. apps/api/src/branding-vocabulary.test.ts holds
-- each of these EQUAL to its Zod enum from now on.
ALTER TABLE tenant_branding DROP CONSTRAINT tenant_branding_dark_mode_check;
ALTER TABLE tenant_branding ADD  CONSTRAINT tenant_branding_dark_mode_check
  CHECK (dark_mode IN ('derived','disabled'));

ALTER TABLE tenant_branding DROP CONSTRAINT tenant_branding_font_family_check;
ALTER TABLE tenant_branding ADD  CONSTRAINT tenant_branding_font_family_check
  CHECK (font_family IN ('inter','system'));

-- A key nothing can upload and nothing can load.
ALTER TABLE tenant_branding DROP COLUMN font_woff2_key;
ALTER TABLE tenant_branding DROP COLUMN font_woff2_bold_key;

COMMENT ON COLUMN tenant_branding.dark_mode IS
  'derived = the §5 dark palette computed at publish; disabled = the app is held to the light theme (F-75). custom retired in 0070 — no column ever carried a custom dark value.';
COMMENT ON COLUMN tenant_branding.font_family IS
  'inter = the platform''s default font stack; system = the OS stack. custom (self-hosted WOFF2) retired in 0070 — nothing could upload or load it.';
