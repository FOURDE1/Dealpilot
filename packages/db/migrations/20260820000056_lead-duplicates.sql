-- 0056 — duplicate detection & merge (F-54, leads.md §8, ADR-026).
--
-- The same PERSON arriving twice becomes a reviewable PAIR, not a silent
-- overwrite: the newer lead is `lead_id`, the older is `duplicate_of`, and
-- the older lead is always the canonical keeper. Detection is data
-- (normalized phone/email/name matches); resolution is a human verb
-- (merge or dismiss) with its own audit columns.

CREATE TABLE lead_duplicates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  /** The comparison's scope when the leads carry a store; NULL = org-wide. */
  store_id        uuid,
  /** The NEWER lead — the one that would be merged away. */
  lead_id         uuid NOT NULL,
  /** The OLDER lead — always the canonical keeper. */
  duplicate_of    uuid NOT NULL,
  match_type      text NOT NULL CHECK (match_type IN
                    ('phone','email','name','phone_email','phone_name','email_name','phone_email_name')),
  confidence      integer NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','merged','dismissed')),
  resolved_by     uuid REFERENCES users(id),
  resolved_at     timestamptz,
  merged_by       uuid REFERENCES users(id),
  merged_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CHECK (lead_id <> duplicate_of),
  UNIQUE (lead_id, duplicate_of),
  FOREIGN KEY (organization_id, lead_id)      REFERENCES leads  (organization_id, id),
  FOREIGN KEY (organization_id, duplicate_of) REFERENCES leads  (organization_id, id),
  FOREIGN KEY (organization_id, store_id)     REFERENCES stores (organization_id, id)
);

CREATE TRIGGER lead_duplicates_updated_at BEFORE UPDATE ON lead_duplicates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX idx_lead_duplicates_org_status ON lead_duplicates (organization_id, status, created_at DESC);
CREATE INDEX idx_lead_duplicates_lead ON lead_duplicates (lead_id) WHERE status = 'pending';
CREATE INDEX idx_lead_duplicates_keeper ON lead_duplicates (duplicate_of) WHERE status = 'pending';

GRANT SELECT, INSERT, UPDATE ON lead_duplicates TO dealpilot_app;

-- §8.2 #3: the merge deletes the SOURCE's score row (the keeper's stands).
-- 0045 granted no DELETE because nothing removed scores until merge existed.
GRANT DELETE ON lead_scores TO dealpilot_app;

ALTER TABLE lead_duplicates ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_duplicates FORCE  ROW LEVEL SECURITY;

CREATE POLICY lead_duplicates_isolation ON lead_duplicates
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

CREATE POLICY lead_duplicates_member_read ON lead_duplicates FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = lead_duplicates.organization_id
      AND m.status = 'active'
      AND m.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  ));

-- Detection needs to compare NORMALIZED contact fields across a tenant's
-- leads without scanning the table: expression indexes on the §8.1 forms.
CREATE INDEX idx_leads_dup_phone ON leads (organization_id, right(regexp_replace(phone, '\D', '', 'g'), 10))
  WHERE deleted_at IS NULL;
CREATE INDEX idx_leads_dup_email ON leads (organization_id, lower(email))
  WHERE deleted_at IS NULL AND email IS NOT NULL;
CREATE INDEX idx_leads_dup_name ON leads (organization_id, regexp_replace(lower(btrim(coalesce(first_name,'') || ' ' || coalesce(last_name,''))), '\s+', ' ', 'g'))
  WHERE deleted_at IS NULL;

-- §8.2 Target: the dedicated seeded lost reason a merged-away source lead
-- carries. Backfilled here for existing organizations; provisioning
-- (@dealpilot/core LOST_REASON_DEFAULTS) carries it for new ones.
INSERT INTO lost_reasons (organization_id, name, name_fr, icon, display_order)
SELECT o.id, 'Merged duplicate', 'Doublon fusionné', '🔗', 10
FROM organizations o
ON CONFLICT (organization_id, name) DO NOTHING;

COMMENT ON TABLE lead_duplicates IS
  'Duplicate-person pairs (leads.md §8): newer lead vs older keeper, matched on normalized phone/email/name; pending pairs are the review queue.';
