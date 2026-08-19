-- 0051 — staff notifications (F-47, automation-notifications.md §2/§5/§13.1, D-050).
--
-- The bell's table. One row per recipient per alert; the row is the truth and
-- every channel is an echo of it. Titles are i18n KEYS plus params, never
-- rendered text — the same alert reads French to a French user and English
-- to an English one, decided at DISPLAY time by the recipient's own locale.

CREATE TABLE notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  /** The RECIPIENT. Cascade: a deleted user's bell has nobody to ring for. */
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id        uuid,
  urgency         text NOT NULL CHECK (urgency IN ('low','medium','high')),
  /** i18n key + ICU params, rendered by the recipient's client in their locale. */
  title_key       text NOT NULL CHECK (btrim(title_key) <> ''),
  params          jsonb NOT NULL DEFAULT '{}',
  /** Deep link into the app, e.g. /leads/abc. Relative, never absolute. */
  link            text,
  entity_type     text,
  entity_id       uuid,
  /** read = read_at IS NOT NULL — one vocabulary (the spec says reconcile). */
  read_at         timestamptz,
  /** Which channels actually carried it. In-app always; email/SMS join later. */
  channels_sent   text[] NOT NULL DEFAULT '{in_app}',
  created_at      timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (organization_id, store_id) REFERENCES stores (organization_id, id)
);

/** The badge count's exact shape: my unread, newest first. */
CREATE INDEX idx_notifications_unread
  ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX idx_notifications_user
  ON notifications (organization_id, user_id, created_at DESC);

-- Rows are written by the system and read/marked by their recipient. No
-- UPDATE beyond read-marking is meaningful, but the column guard for that
-- lives in the route; no DELETE — the bell's history is a record.
GRANT SELECT, INSERT, UPDATE ON notifications TO dealpilot_app;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE  ROW LEVEL SECURITY;

CREATE POLICY notifications_isolation ON notifications
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

/**
 * SELF-read, not member_read: a notification is addressed. A colleague's
 * bell is not the team's business — H4 payment-mismatch alerts name money
 * problems, and those go to the person responsible, not the room.
 */
CREATE POLICY notifications_self_read ON notifications FOR SELECT
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

/** Marking read is also a self-only act, under either context. */
CREATE POLICY notifications_self_update ON notifications FOR UPDATE
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

COMMENT ON TABLE notifications IS
  'Staff alerts (F-47). title_key + params are rendered client-side in the recipient''s locale; the row is the truth and realtime events are refresh hints only (D-050).';
