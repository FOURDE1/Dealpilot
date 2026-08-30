-- 0068 — announcements and platform kill switches (F-72; admin-console.md
-- §5.3, §8, §11, §12; localization-and-legal.md §2; ADR-007/009/019; D-073).
--
-- What lands here and WHY it is one migration:
--   (1) platform_settings — the two kill switches, as ROWS, seeded here so a
--       missing row can only mean tampering. The reader treats a missing row
--       as ON (fail closed), and the app role holds no DELETE.
--   (2) platform_announcements + announcement_dismissals — platform-owned and
--       deliberately WITHOUT an organization_id: the audience is a jsonb
--       predicate, not a tenant key, so rls-coverage.test.ts does not — and
--       must not — conscript them as tenant tables.
--   (3) The audience matcher, the feed, the dismissal and the fan-out as
--       SECURITY DEFINER functions. The app role holds NO grant on either
--       announcement table: the definers are the only door, so no future
--       tenant-scoped query can reach them by accident.
--   (4) platform_audit_events widened by three event values. No target
--       columns: the subject of an announcement or a setting event lives in
--       `changes` (announcement_id / setting_key), which is what 0065 and
--       0067 already do, and target_user_id stays NULL.
--
-- Vocabulary deviation from §8, deliberate (D-073): the spec's audience arm
-- is {"type":"tenants","tenant_ids":[…]}; this repo says organization, never
-- tenant (packages/schemas is the vocabulary truth — `tenant_id` appears
-- nowhere in it), so the arm is {"type":"organizations","organization_ids":[…]}.
--
-- Error contract additions (SQLSTATE → HTTP in apps/api/src/platform.ts):
--   PA021 announcement not found / not visible to this person → 404 not_found
--   PA022 the display window may only be shortened           → 409 invalid_window
--         BELT ONLY — no route can raise this today. admin_end_announcement()
--         is the only writer and cannot reach either arm of the trigger test
--         (§2 below says why). The mapping is armed for the next writer, not
--         claimed as a refusal a client can receive.
--   PA023 this announcement is not dismissible               → 422 not_dismissible
--   PA024 unknown platform setting key                       → 404 not_found
--   PA025 this announcement has already ended                → 409 already_ended
--   PA026 unknown organization in the audience               → 422 validation_failed
-- The severity/role re-check inside admin_publish_announcement and
-- admin_end_announcement raises the EXISTING PA009 (403 forbidden), because
-- one SQLSTATE maps to exactly one AppError in platformErrorFrom.
--
-- RLS note: as 0065/0066/0067, the definers act as their OWNER (superuser
-- locally, BYPASSRLS on RDS — definer-owner.test.ts). platform_settings is
-- the ONE new table the app role may read: it is global operating state, it
-- names no tenant, and the send path must read it inside the same transaction
-- that writes the send_decisions row. It carries no INSERT/UPDATE/DELETE
-- grant, so the app role can never flip a switch.
--
-- Support-session note (F-71): a fan-out bell row is filed under the LOWEST
-- matching organization id (deterministic on replay). 0067 rewrote
-- notifications_self_read to carry impersonation_scope_ok(organization_id),
-- so while a support session is scoped to that person's OTHER organization
-- the bell row is invisible; the BANNER still shows, because
-- announcement_visible() matches any in-scope membership, and the row
-- reappears when the session ends. Accepted, recorded in D-073.

-- ---------------------------------------------------------------------------
-- 1. platform_settings — the kill switches (§5.3)
-- ---------------------------------------------------------------------------
CREATE TABLE platform_settings (
  setting_key text PRIMARY KEY
              CHECK (setting_key IN ('ai_outbound_killswitch','sms_send_killswitch')),
  -- true = the KILL is ON. Default false, so the seed below is the OFF state.
  enabled     boolean NOT NULL DEFAULT false,
  -- Kept on the row only while the switch is ON, so the console can print WHY
  -- sending is stopped beside the switch. The full history lives in
  -- platform_audit_events; resuming NULLs this column on purpose.
  reason      text CHECK (reason IS NULL OR (length(btrim(reason)) >= 10 AND length(reason) <= 500)),
  changed_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (enabled = false OR reason IS NOT NULL)
);

CREATE TRIGGER platform_settings_updated_at BEFORE UPDATE ON platform_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seeded, not created on demand: a switch that does not exist is a switch
-- nobody can turn off, and killSwitches() treats a missing row as ON.
INSERT INTO platform_settings (setting_key) VALUES
  ('ai_outbound_killswitch'), ('sms_send_killswitch');

-- SELECT only. Writes go through admin_set_platform_setting() alone.
GRANT SELECT ON platform_settings TO dealpilot_app;

COMMENT ON TABLE platform_settings IS
  'Platform kill switches (admin-console.md §5.3). Read on every send attempt inside the send transaction; written only by admin_set_platform_setting(), which asserts platform_super_admin. webhook_delivery_pause is deliberately absent — no outbound webhook deliverer exists to gate, and a switch nothing consults is dead vocabulary. Adding it is a one-line forward CHECK swap when the deliverer lands.';

-- ---------------------------------------------------------------------------
-- 2. platform_announcements (§8). Publishing IS creating: no draft, no amend,
--    no retraction columns. The window is the schedule; shortening it is the
--    retraction. §12 immutability is the trigger below, not a comment.
-- ---------------------------------------------------------------------------
CREATE TABLE platform_announcements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  severity    text NOT NULL
              CONSTRAINT platform_announcements_severity_check
              CHECK (severity IN ('info','maintenance','incident','marketing')),
  -- §8 / Bill 96 (ADR-019): bilingual by construction. The Zod refusal is the
  -- courteous 422 MISSING_TRANSLATION; this CHECK is the guarantee.
  title_en    text NOT NULL CHECK (btrim(title_en) <> '' AND length(title_en) <= 120),
  title_fr    text NOT NULL CHECK (btrim(title_fr) <> '' AND length(title_fr) <= 120),
  body_en     text NOT NULL CHECK (btrim(body_en) <> '' AND length(body_en) <= 2000),
  body_fr     text NOT NULL CHECK (btrim(body_fr) <> '' AND length(body_fr) <= 2000),
  audience    jsonb NOT NULL CHECK (
                jsonb_typeof(audience) = 'object'
                AND (   audience->>'type' = 'all'
                     OR (audience->>'type' = 'plan'
                         AND jsonb_typeof(audience->'plan_codes') = 'array'
                         AND jsonb_array_length(audience->'plan_codes') > 0)
                     OR (audience->>'type' = 'organizations'
                         AND jsonb_typeof(audience->'organization_ids') = 'array'
                         AND jsonb_array_length(audience->'organization_ids') > 0))),
  starts_at   timestamptz NOT NULL DEFAULT now(),
  -- >= and not >: admin_end_announcement sets ends_at = GREATEST(now(),
  -- starts_at), which is exactly starts_at for an announcement that has not
  -- started yet. A zero-length window is invisible anyway (the feed requires
  -- starts_at <= now() AND ends_at > now()), so ending a SCHEDULED
  -- announcement must be legal rather than a 23514.
  ends_at     timestamptz,
  -- §8 "maintenance/incident banners are non-dismissible while active". An
  -- announcement outside its window is not shown at all, so "while active" is
  -- the whole rule: dismissibility is DERIVED, never chosen, and one CHECK
  -- makes the derivation and the rule the same object.
  dismissible boolean NOT NULL
              CHECK (dismissible = (severity IN ('info','marketing'))),
  -- §8 "incident rows must link the Better Stack status-page incident". A URL
  -- and not an opaque id: the consumer is the anchor in the banner and the
  -- person who clicks it, both of which exist on day one with no integration.
  status_incident_url text
              CHECK (status_incident_url IS NULL
                     OR (status_incident_url LIKE 'https://%' AND length(status_incident_url) <= 512)),
  CHECK ((severity = 'incident') = (status_incident_url IS NOT NULL)),
  -- No ON DELETE: users are soft-deactivated (status IN
  -- ('invited','active','disabled')) and never deleted, so the publisher's
  -- row cannot vanish and the console joins users for the email.
  published_by uuid NOT NULL REFERENCES users(id),
  published_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at >= starts_at)
);

-- ends_at leads, deliberately. The one query that filters on the window is
-- announcements_for_user(), and its selective half is "has not ended yet": the
-- archive only grows (the trigger below forbids DELETE) and every archived row
-- has an ends_at in the past, while starts_at <= now() is true of essentially
-- every published row and so prunes nothing. `ends_at IS NULL OR ends_at >
-- now()` is two ranges over this index, which the planner BitmapOrs, so the
-- per-row SECURITY DEFINER call in the feed runs on the live rows only.
-- Ordering is not what this index is for — the feed sorts on a severity CASE
-- first, which no index can serve.
CREATE INDEX idx_announcements_window ON platform_announcements (ends_at, starts_at);

-- No grant to dealpilot_app. Tenant reads go through announcements_for_user();
-- console reads and writes through the admin_* definers.

CREATE FUNCTION platform_announcements_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'platform_announcements is append-only' USING ERRCODE = 'PA000';
  END IF;
  -- jsonb rather than a hand-enumerated tuple: a column added by a later
  -- migration is frozen automatically instead of silently becoming writable.
  IF to_jsonb(NEW) - 'ends_at' IS DISTINCT FROM to_jsonb(OLD) - 'ends_at' THEN
    RAISE EXCEPTION 'a published announcement may only have its window shortened'
      USING ERRCODE = 'PA000';
  END IF;
  -- BELT, not a product path, and it is worth saying which. The only writer of
  -- this table is admin_end_announcement(), which sets ends_at :=
  -- GREATEST(now(), starts_at) — never NULL — after raising PA025 for anything
  -- whose ends_at is already at or before that instant. So it can reach
  -- neither arm: nothing a request can do produces PA022 today, and the only
  -- caller that does is the schema owner issuing a raw UPDATE (which is how
  -- f72-announcements.test.ts exercises this line). It stays armed against the
  -- next writer — a shorten-window route is the obvious one — and keeps its own
  -- SQLSTATE rather than the PA000 of the two owner-only arms above, because
  -- that writer must be refused with the 409 invalid_window platform.ts already
  -- maps, not with a bare 500.
  IF NEW.ends_at IS NULL OR (OLD.ends_at IS NOT NULL AND NEW.ends_at > OLD.ends_at) THEN
    RAISE EXCEPTION 'the display window may only be shortened' USING ERRCODE = 'PA022';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER platform_announcements_no_rewrite
  BEFORE UPDATE OR DELETE ON platform_announcements
  FOR EACH ROW EXECUTE FUNCTION platform_announcements_immutable();

COMMENT ON TABLE platform_announcements IS
  'Platform broadcast (admin-console.md §8). Immutable per §12: publishing is creating, and the only legal mutation is moving ends_at earlier. No organization_id on purpose — the audience is a jsonb predicate evaluated by announcement_matches(), not a tenant key. Written only by admin_publish_announcement()/admin_end_announcement(); read by announcements_for_user(), announcement_visible() and the admin_* readers.';

-- ---------------------------------------------------------------------------
-- 3. announcement_dismissals (§8 "per-user dismissals")
-- ---------------------------------------------------------------------------
CREATE TABLE announcement_dismissals (
  announcement_id uuid NOT NULL REFERENCES platform_announcements(id),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dismissed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id)
);

-- No grant, no RLS, no organization_id. The only writer is
-- announcement_dismiss(), which takes the person from the app.user_id GUC —
-- so a route bug cannot forge a dismissal for somebody else. The PK serves
-- every read (both are keyed announcement-first); no second index.

COMMENT ON TABLE announcement_dismissals IS
  'Per-person announcement dismissals (admin-console.md §8). Definer-only: written by announcement_dismiss(), which reads the dismisser from app.user_id and refuses a non-dismissible or invisible announcement in SQL.';

-- ---------------------------------------------------------------------------
-- 4. platform_audit_events — three new events (§12). No target columns: the
--    subject lives in `changes`, as 0065 and 0067 already do, and
--    target_user_id stays NULL for all three.
-- ---------------------------------------------------------------------------
ALTER TABLE platform_audit_events DROP CONSTRAINT platform_audit_events_event_check;
ALTER TABLE platform_audit_events ADD CONSTRAINT platform_audit_events_event_check
  CHECK (event IN ('staff.granted','staff.role_changed','staff.reinstated','staff.revoked',
                   'announcement.published','announcement.ended','settings.flipped'));

-- ---------------------------------------------------------------------------
-- 5. Fan-out idempotence, enforced where it cannot be argued with: one bell
--    row per (announcement, person), so a crash mid-batch, a BullMQ
--    redelivery and a duplicate enqueue all converge on one row.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX idx_notifications_announcement_once
  ON notifications (entity_id, user_id) WHERE entity_type = 'announcement';

-- ---------------------------------------------------------------------------
-- 6. The definer surface, in dependency order.
--    announcement_matches and announcement_visible are INTERNAL helpers: no
--    GRANT, like platform_assert_actor (0065).
-- ---------------------------------------------------------------------------

-- (a) The ONE audience predicate. Two direct callers — announcement_visible()
--     and announcement_fanout_batch(); the feed and the dismissal reach it
--     through announcement_visible(). It is never re-inlined anywhere, so the
--     console's reach and the delivery cannot drift.
--     The two status clauses are ordered and on their own lines because
--     tenant-lifecycle-drift.test.ts indexes them positionally.
CREATE FUNCTION announcement_matches(p_audience jsonb, p_severity text, p_org uuid,
                                     p_plan_tier text, p_status text)
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT p_status NOT IN ('offboarding','purged','suspended')
     AND (p_severity <> 'marketing' OR p_status NOT IN ('past_due','read_only'))
     AND CASE p_audience->>'type'
           WHEN 'all' THEN true
           WHEN 'plan' THEN p_audience->'plan_codes' ? p_plan_tier
           WHEN 'organizations' THEN p_audience->'organization_ids' ? p_org::text
           ELSE false END;
$$;
REVOKE ALL ON FUNCTION announcement_matches(jsonb, text, uuid, text, text) FROM PUBLIC;

COMMENT ON FUNCTION announcement_matches(jsonb, text, uuid, text, text) IS
  'The one audience predicate (admin-console.md §8). First clause: a non-operational tenant receives nothing. Second: §8 marketing suppression for past_due|read_only — note trial IS operational and DOES receive marketing. Third: the audience arms. Internal helper, no grant.';

-- (b) The limit-free visibility predicate. announcement_dismiss() gates on
--     THIS, not on the LIMIT-ed feed: the dismissible severities are exactly
--     the ones the feed's ordering truncates, so gating on the feed would make
--     every dismissible row unreachable once 20 announcements are live.
CREATE FUNCTION announcement_visible(p_id uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
      FROM platform_announcements a
     WHERE a.id = p_id
       AND NULLIF(current_setting('app.user_id', true), '') IS NOT NULL
       AND a.starts_at <= now()
       AND (a.ends_at IS NULL OR a.ends_at > now())
       AND NOT EXISTS (
             SELECT 1 FROM announcement_dismissals d
              WHERE d.announcement_id = a.id
                AND d.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
       AND EXISTS (
             SELECT 1
               FROM memberships m
               JOIN organizations o ON o.id = m.organization_id AND o.deleted_at IS NULL
              WHERE m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
                AND m.status = 'active'
                -- F-71: a support session is scoped to ONE tenant, and this
                -- definer bypasses the policies that carry that scope, so it
                -- carries it itself (the has_permission precedent, 0067).
                AND impersonation_scope_ok(o.id)
                AND announcement_matches(a.audience, a.severity, o.id, o.plan_tier, o.status)));
$$;
REVOKE ALL ON FUNCTION announcement_visible(uuid) FROM PUBLIC;

-- (c) The tenant feed. Takes NO parameter: the recipient comes from
--     app.user_id, set by withUser/withContext, so there is no argument for a
--     route bug to get wrong. Returns NO tenant identifier, no plan and no
--     audience — a defect in the predicate could leak a platform-authored
--     message, never who else is a customer or what they pay.
CREATE FUNCTION announcements_for_user()
RETURNS TABLE (id uuid, severity text, title_en text, title_fr text,
               body_en text, body_fr text, dismissible boolean,
               starts_at timestamptz, ends_at timestamptz,
               status_incident_url text)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT a.id, a.severity, a.title_en, a.title_fr, a.body_en, a.body_fr,
         a.dismissible, a.starts_at, a.ends_at, a.status_incident_url
    FROM platform_announcements a
   -- The window test is repeated here on purpose. It is the same clause
   -- announcement_visible() applies, so the row set is unchanged — but a
   -- SECURITY DEFINER call is never inlined, so on its own it leaves the
   -- planner nothing sargable and the definer runs once per announcement EVER
   -- published, on a feed every signed-in tab polls each minute against a
   -- table that only grows. With the window out here, idx_announcements_window
   -- prunes to the live rows first. Measured on 3,005 rows / 3 live:
   -- 110.4 ms and 9,076 shared buffers before, 1.3 ms and 30 after.
   -- announcement_visible() remains the authority on WHO an announcement is
   -- for; this adds no rule of its own.
   WHERE a.starts_at <= now()
     AND (a.ends_at IS NULL OR a.ends_at > now())
     AND announcement_visible(a.id)
   ORDER BY CASE a.severity WHEN 'incident' THEN 0 WHEN 'maintenance' THEN 1
                            WHEN 'info' THEN 2 ELSE 3 END,
            a.starts_at DESC, a.id
   LIMIT 20;
$$;
REVOKE ALL ON FUNCTION announcements_for_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION announcements_for_user() TO dealpilot_app;

-- (d) Dismissal. No actor parameter — the person comes from app.user_id.
CREATE FUNCTION announcement_dismiss(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid;
BEGIN
  v_uid := NULLIF(current_setting('app.user_id', true), '')::uuid;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'no user in context' USING ERRCODE = 'PA021';
  END IF;
  -- Dismissing twice is not an error, and this check must come FIRST: a
  -- dismissal is exactly what makes an announcement invisible, so gating on
  -- visibility first would 404 the second click and leave the ON CONFLICT
  -- below unreachable.
  IF EXISTS (SELECT 1 FROM announcement_dismissals
              WHERE announcement_id = p_id AND user_id = v_uid) THEN
    RETURN;
  END IF;
  -- Only something currently visible to THIS person. No oracle: an
  -- announcement that does not exist and one that is not theirs are the same
  -- refusal.
  IF NOT announcement_visible(p_id) THEN
    RAISE EXCEPTION 'announcement not visible' USING ERRCODE = 'PA021';
  END IF;
  -- A maintenance or incident banner cannot be dismissed — enforced here, not
  -- in the button's disabled attribute.
  IF NOT EXISTS (SELECT 1 FROM platform_announcements WHERE id = p_id AND dismissible) THEN
    RAISE EXCEPTION 'not dismissible' USING ERRCODE = 'PA023';
  END IF;
  INSERT INTO announcement_dismissals (announcement_id, user_id)
  VALUES (p_id, v_uid) ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION announcement_dismiss(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION announcement_dismiss(uuid) TO dealpilot_app;

-- (e) The fan-out pre-check, so the worker can skip without burning the
--     BullMQ retry budget and landing a DLQ entry for an announcement
--     somebody deliberately ended.
CREATE FUNCTION announcement_fanout_state(p_id uuid)
RETURNS TABLE (state text, starts_at timestamptz)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE(
           (SELECT CASE
                     WHEN a.ends_at IS NOT NULL AND a.ends_at <= now() THEN 'ended'
                     WHEN a.starts_at > now() THEN 'scheduled'
                     ELSE 'live' END
              FROM platform_announcements a WHERE a.id = p_id), 'gone'),
         (SELECT a.starts_at FROM platform_announcements a WHERE a.id = p_id);
$$;
REVOKE ALL ON FUNCTION announcement_fanout_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION announcement_fanout_state(uuid) TO dealpilot_app;

-- (f) The fan-out itself: scan + insert + cursor in one statement.
--
--     This is the ONE F-72 definer that writes while asserting no actor, and
--     the exemption is deliberate: it is called by the worker on the bare pool
--     as dealpilot_app; it can only fan a REAL announcement out to its OWN
--     audience (the predicate is announcement_matches, not an argument); the
--     unique index caps it at one row per person; and it can neither publish
--     nor amend anything. There is no argument by which it could reach a
--     person the announcement does not already address.
--
--     DISTINCT ON (m.user_id) means a person who is an active member of two
--     matching tenants gets exactly ONE bell row, filed under the lowest
--     matching organization id so a replay is byte-identical.
CREATE FUNCTION announcement_fanout_batch(p_announcement uuid, p_after uuid, p_limit int)
RETURNS TABLE (last_user_id uuid, inserted integer, done boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_a platform_announcements%ROWTYPE; v_lim int;
BEGIN
  SELECT * INTO v_a FROM platform_announcements WHERE id = p_announcement;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'announcement not found' USING ERRCODE = 'PA021';
  END IF;
  v_lim := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 2000);
  RETURN QUERY
  WITH recipients AS (
    SELECT DISTINCT ON (m.user_id) m.user_id, m.organization_id
      FROM memberships m
      JOIN organizations o ON o.id = m.organization_id AND o.deleted_at IS NULL
      JOIN users u ON u.id = m.user_id AND u.status = 'active'
     WHERE m.status = 'active'
       AND (p_after IS NULL OR m.user_id > p_after)
       AND announcement_matches(v_a.audience, v_a.severity, o.id, o.plan_tier, o.status)
     ORDER BY m.user_id, m.organization_id
     LIMIT v_lim
  ), ins AS (
    INSERT INTO notifications
      (organization_id, user_id, urgency, title_key, params, link, entity_type, entity_id)
    SELECT r.organization_id, r.user_id,
           CASE v_a.severity WHEN 'incident' THEN 'high'
                             WHEN 'maintenance' THEN 'medium' ELSE 'low' END,
           'notif_announcement_published',
           -- BOTH titles. 0051's own contract is that the language is decided
           -- at DISPLAY time by the recipient's locale; users.language_pref is
           -- written by nothing in this product, so pre-picking here would
           -- ship one language to everybody. bell.tsx picks.
           jsonb_build_object('title_en', v_a.title_en, 'title_fr', v_a.title_fr),
           NULL,                 -- the banner is the surface; bell.tsx guards a null link
           'announcement', v_a.id
      FROM recipients r
    ON CONFLICT DO NOTHING
    RETURNING 1)
  SELECT (SELECT r2.user_id FROM recipients r2 ORDER BY r2.user_id DESC LIMIT 1),
         (SELECT count(*)::int FROM ins),
         (SELECT count(*) FROM recipients) < v_lim;
END $$;
REVOKE ALL ON FUNCTION announcement_fanout_batch(uuid, uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION announcement_fanout_batch(uuid, uuid, int) TO dealpilot_app;

-- (g) The console's settings reader. The console reads through THIS, never
--     through the API's TTL cache, so a staffer who just flipped a switch
--     sees the truth immediately rather than up to KILL_SWITCH_TTL_MS later.
CREATE FUNCTION admin_list_platform_settings(p_actor uuid)
RETURNS TABLE (setting_key text, enabled boolean, reason text,
               changed_at timestamptz, changed_by_email text)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM platform_assert_actor(p_actor, ARRAY['platform_super_admin','platform_support']);
  RETURN QUERY
    SELECT s.setting_key, s.enabled, s.reason, s.changed_at, u.email
      FROM platform_settings s
      LEFT JOIN users u ON u.id = s.changed_by
     ORDER BY s.setting_key;
END $$;
REVOKE ALL ON FUNCTION admin_list_platform_settings(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_list_platform_settings(uuid) TO dealpilot_app;

-- (h) Flipping a switch. platform_super_admin alone (§5.3).
CREATE FUNCTION admin_set_platform_setting(p_actor uuid, p_setting_key text,
                                           p_enabled boolean, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_row platform_settings%ROWTYPE; v_from boolean;
BEGIN
  PERFORM platform_assert_actor(p_actor, ARRAY['platform_super_admin']);
  IF length(btrim(COALESCE(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'reason required' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_row FROM platform_settings WHERE setting_key = p_setting_key FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown setting %', p_setting_key USING ERRCODE = 'PA024';
  END IF;
  v_from := v_row.enabled;
  UPDATE platform_settings
     SET enabled    = p_enabled,
         -- NULLed on resume: "why was this off at 04:00" survives only in
         -- platform_audit_events, which is deliberate (D-073) — F-72 ships no
         -- flip-history route.
         reason     = CASE WHEN p_enabled THEN btrim(p_reason) ELSE NULL END,
         changed_by = p_actor,
         changed_at = now()
   WHERE setting_key = p_setting_key;
  INSERT INTO platform_audit_events (actor_user_id, actor_type, event, changes, reason)
  VALUES (p_actor, 'platform', 'settings.flipped',
          jsonb_build_object('setting_key', p_setting_key,
                             'enabled', jsonb_build_object('from', v_from, 'to', p_enabled)),
          btrim(p_reason));
END $$;
REVOKE ALL ON FUNCTION admin_set_platform_setting(uuid, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_set_platform_setting(uuid, text, boolean, text) TO dealpilot_app;

-- (i) Publishing. §3: support publishes `info` and nothing else — checked here
--     as well as in the route, so a route mistake cannot widen what the
--     database allows.
CREATE FUNCTION admin_publish_announcement(
  p_actor uuid, p_severity text, p_title_en text, p_title_fr text,
  p_body_en text, p_body_fr text, p_audience jsonb,
  p_starts_at timestamptz, p_ends_at timestamptz, p_incident_url text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role text; v_id uuid;
BEGIN
  v_role := platform_assert_actor(p_actor, ARRAY['platform_super_admin','platform_support']);
  IF p_severity <> 'info' AND v_role <> 'platform_super_admin' THEN
    RAISE EXCEPTION 'platform role % may only publish info announcements', v_role
      USING ERRCODE = 'PA009';
  END IF;
  -- An organizations-audience naming an unknown or deleted organization is a
  -- typo, not an announcement: fail rather than publish to nobody.
  IF p_audience->>'type' = 'organizations' AND EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(p_audience->'organization_ids') x(id)
        WHERE NOT EXISTS (SELECT 1 FROM organizations o
                           WHERE o.id = x.id::uuid AND o.deleted_at IS NULL)) THEN
    RAISE EXCEPTION 'unknown organization in audience' USING ERRCODE = 'PA026';
  END IF;
  INSERT INTO platform_announcements
    (severity, title_en, title_fr, body_en, body_fr, audience, starts_at, ends_at,
     dismissible, status_incident_url, published_by)
  VALUES (p_severity, btrim(p_title_en), btrim(p_title_fr), btrim(p_body_en), btrim(p_body_fr),
          p_audience, COALESCE(p_starts_at, now()), p_ends_at,
          p_severity IN ('info','marketing'),          -- derived, never supplied
          NULLIF(btrim(COALESCE(p_incident_url, '')), ''),
          p_actor)
  RETURNING id INTO v_id;
  INSERT INTO platform_audit_events (actor_user_id, actor_type, event, changes)
  VALUES (p_actor, 'platform', 'announcement.published',
          jsonb_build_object('announcement_id', v_id, 'severity', p_severity,
                             'audience', p_audience));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION admin_publish_announcement(uuid, text, text, text, text, text, jsonb, timestamptz, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_publish_announcement(uuid, text, text, text, text, text, jsonb, timestamptz, timestamptz, text) TO dealpilot_app;

-- (j) Ending. The ONLY legal mutation on a published announcement (§12).
--     The audit row carries no reason: the route collects none.
CREATE FUNCTION admin_end_announcement(p_actor uuid, p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_role text; v_a platform_announcements%ROWTYPE; v_to timestamptz;
BEGIN
  v_role := platform_assert_actor(p_actor, ARRAY['platform_super_admin','platform_support']);
  SELECT * INTO v_a FROM platform_announcements WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'announcement not found' USING ERRCODE = 'PA021';
  END IF;
  -- §3 again. The severity is unknowable before the row is read, so this rule
  -- lives HERE and only here: an admin route file may not name a role
  -- (platform-drift.test.ts test 3).
  IF v_a.severity <> 'info' AND v_role <> 'platform_super_admin' THEN
    RAISE EXCEPTION 'platform role % may only end info announcements', v_role
      USING ERRCODE = 'PA009';
  END IF;
  v_to := GREATEST(now(), v_a.starts_at);
  IF v_a.ends_at IS NOT NULL AND v_a.ends_at <= v_to THEN
    RAISE EXCEPTION 'already ended' USING ERRCODE = 'PA025';
  END IF;
  UPDATE platform_announcements SET ends_at = v_to WHERE id = p_id;
  INSERT INTO platform_audit_events (actor_user_id, actor_type, event, changes)
  VALUES (p_actor, 'platform', 'announcement.ended',
          jsonb_build_object('announcement_id', p_id,
                             'ends_at', jsonb_build_object('from', v_a.ends_at, 'to', v_to)));
END $$;
REVOKE ALL ON FUNCTION admin_end_announcement(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_end_announcement(uuid, uuid) TO dealpilot_app;

-- (k) The console register. Keyset on (published_at DESC, id DESC), with
--     published_at_text as the cursor key: a JS Date round-trip truncates
--     timestamptz to milliseconds, and a row published inside the discarded
--     microseconds satisfies neither page (the f01 lesson, and the reason
--     admin_list_tenants returns created_at_text in 0065).
--     recipients_notified is a COUNT of real notifications rows, never a
--     stored column that could drift from what was delivered.
CREATE FUNCTION admin_list_announcements(p_actor uuid, p_severity text,
                                         p_cursor_at timestamptz, p_cursor_id uuid,
                                         p_limit int)
RETURNS TABLE (id uuid, severity text, title_en text, title_fr text,
               body_en text, body_fr text, audience jsonb,
               starts_at timestamptz, ends_at timestamptz, dismissible boolean,
               status_incident_url text, published_by uuid,
               published_by_email text, published_at timestamptz,
               published_at_text text, recipients_notified integer)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM platform_assert_actor(p_actor, ARRAY['platform_super_admin','platform_support']);
  RETURN QUERY
    SELECT a.id, a.severity, a.title_en, a.title_fr, a.body_en, a.body_fr, a.audience,
           a.starts_at, a.ends_at, a.dismissible, a.status_incident_url,
           a.published_by, u.email, a.published_at, a.published_at::text,
           (SELECT count(*)::int FROM notifications n
             WHERE n.entity_type = 'announcement' AND n.entity_id = a.id)
      FROM platform_announcements a
      JOIN users u ON u.id = a.published_by
     WHERE (p_severity IS NULL OR a.severity = p_severity)
       AND (p_cursor_at IS NULL OR (a.published_at, a.id) < (p_cursor_at, p_cursor_id))
     ORDER BY a.published_at DESC, a.id DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100) + 1;
END $$;
REVOKE ALL ON FUNCTION admin_list_announcements(uuid, text, timestamptz, uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_list_announcements(uuid, text, timestamptz, uuid, int) TO dealpilot_app;

-- (l) One announcement, for the console detail page.
CREATE FUNCTION admin_get_announcement(p_actor uuid, p_id uuid)
RETURNS TABLE (id uuid, severity text, title_en text, title_fr text,
               body_en text, body_fr text, audience jsonb,
               starts_at timestamptz, ends_at timestamptz, dismissible boolean,
               status_incident_url text, published_by uuid,
               published_by_email text, published_at timestamptz,
               recipients_notified integer)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM platform_assert_actor(p_actor, ARRAY['platform_super_admin','platform_support']);
  RETURN QUERY
    SELECT a.id, a.severity, a.title_en, a.title_fr, a.body_en, a.body_fr, a.audience,
           a.starts_at, a.ends_at, a.dismissible, a.status_incident_url,
           a.published_by, u.email, a.published_at,
           (SELECT count(*)::int FROM notifications n
             WHERE n.entity_type = 'announcement' AND n.entity_id = a.id)
      FROM platform_announcements a
      JOIN users u ON u.id = a.published_by
     WHERE a.id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'announcement not found' USING ERRCODE = 'PA021';
  END IF;
END $$;
REVOKE ALL ON FUNCTION admin_get_announcement(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_get_announcement(uuid, uuid) TO dealpilot_app;

-- Not in this migration, on purpose:
--   * webhook_delivery_pause (§5.3). There is no outbound webhook deliverer in
--     this codebase: apps/api/src/carrier.ts:198 is the only fetch() in server
--     source, F-49 connectors are INBOUND mappings, and f30-deliver.ts is the
--     SMS carrier handoff. A switch with no chokepoint is dead vocabulary.
--     Un-cut condition: one forward CHECK swap on platform_settings.setting_key
--     plus one gate line, the day a deliverer lands.
--   * an email (SES) kill switch. mailer.send has EIGHT call sites and FIVE
--     are credential paths — sign-up verification (auth.ts:63), invitations
--     (f12:83, f70:124, f70:159) and the support-access notice (f71:69) —
--     which a locked-out operator needs during the very incident a kill
--     switch is for. Of the other three, two are the driver-company dispatch
--     request (f11:257, :456) and one is the customer ETA (f11:683), which is
--     the only customer-facing mail and the named next candidate.
--     Un-cut condition: an email
--     decision record giving Mailer.send a refusal vocabulary; it returns a
--     bare boolean today, so a gate would be indistinguishable from an SES
--     failure. SECURITY.md carries this as an accepted risk.
--   * a draft / amend / retract lifecycle. §12 forbids editing a published
--     announcement; the window is the schedule and shortening it is the
--     retraction, so a status column would be vocabulary nothing writes.
--   * any activity_events verb or entity. An announcement belongs to no
--     tenant and activity_events.organization_id is NOT NULL, so §12's audit
--     lands in platform_audit_events (0066's closing rule).
--   * any change to drip_due_enrollments or tasks_needing_attention, whose
--     bodies tenant-lifecycle-drift.test.ts regexes for their status filters.
