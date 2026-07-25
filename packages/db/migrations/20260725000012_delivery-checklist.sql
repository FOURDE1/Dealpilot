-- 0012 delivery checklist (F-08): the gate between Signed and Delivered
-- (delivery.md §2). Ten canonical items, nine SOFT (a manager may override
-- with a reason, and the override is recorded) and one HARD — the safety
-- inspection, which is a legal obligation and can never be waived.
--
-- Per-store configuration is the owner's answer in D-020: each store decides
-- which items it requires, so a template row can be switched off without
-- touching code. Items already attached to a deal keep their own copy, so
-- editing the template never rewrites history on deals in flight.

CREATE TABLE checklist_templates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  store_id         uuid NOT NULL,
  code             text NOT NULL
                   CHECK (code IN ('insurance','void_cheque','funding','idv','safety',
                                   'vehicle_ready','wet_ink_file','delivery_date',
                                   'drivers_booked','registration')),
  label_fr         text NOT NULL CHECK (btrim(label_fr) <> ''),
  label_en         text NOT NULL CHECK (btrim(label_en) <> ''),
  required         boolean NOT NULL DEFAULT true,
  -- The safety inspection is a HARD block: required, and never overridable.
  overridable      boolean NOT NULL DEFAULT true,
  sort_order       integer NOT NULL DEFAULT 0,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, store_id, code),
  FOREIGN KEY (organization_id, store_id) REFERENCES stores (organization_id, id)
);

CREATE TRIGGER checklist_templates_updated_at BEFORE UPDATE ON checklist_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- A deal's own copy of the checklist. `required`/`overridable` are SNAPSHOT
-- from the template at attach time: changing store policy tomorrow must not
-- silently change what a deal in flight was allowed to deliver on.
-- A tenant-scoped FK target, so a checklist item can never point at a deal in
-- another organization. Without it an org-mismatched row would be invisible to
-- the deal's real tenant, and readiness would count it as absent — i.e. it
-- would report READY on a deal with an outstanding requirement.
-- Takes ACCESS EXCLUSIVE on `deals` while the unique index builds. Fine at this
-- size; when `deals` is large this wants CREATE UNIQUE INDEX CONCURRENTLY first,
-- then ADD CONSTRAINT ... USING INDEX (expand-then-contract).
ALTER TABLE deals ADD CONSTRAINT deals_org_id_key UNIQUE (organization_id, id);

CREATE TABLE deal_checklist_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  deal_id          uuid NOT NULL,
  code             text NOT NULL,
  label_fr         text NOT NULL,
  label_en         text NOT NULL,
  required         boolean NOT NULL,
  overridable      boolean NOT NULL,
  sort_order       integer NOT NULL DEFAULT 0,

  completed_at     timestamptz,
  completed_by     uuid REFERENCES users(id),
  -- A soft item can be waived by a manager, but never silently: the reason is
  -- part of the record (delivery.md §2 — every override is logged).
  overridden_at    timestamptz,
  overridden_by    uuid REFERENCES users(id),
  override_reason  text CHECK (override_reason IS NULL OR btrim(override_reason) <> ''),

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deal_id, code),
  FOREIGN KEY (organization_id, deal_id) REFERENCES deals (organization_id, id),
  -- An override without a reason is not an override.
  CHECK ((overridden_at IS NULL) = (override_reason IS NULL))
);

CREATE INDEX idx_checklist_items_deal ON deal_checklist_items (deal_id, sort_order);
CREATE INDEX idx_checklist_items_org ON deal_checklist_items (organization_id);

CREATE TRIGGER deal_checklist_items_updated_at BEFORE UPDATE ON deal_checklist_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE ON checklist_templates TO dealpilot_app;
GRANT SELECT, INSERT, UPDATE ON deal_checklist_items TO dealpilot_app;

ALTER TABLE checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE checklist_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE deal_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_checklist_items FORCE ROW LEVEL SECURITY;

CREATE POLICY checklist_template_isolation ON checklist_templates
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

CREATE POLICY checklist_item_isolation ON deal_checklist_items
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- NOTE: deliberately NO member-read policy on these two tables. Both routes
-- resolve the org from the caller's own membership and then run under
-- withTenant, so tenant isolation is the only policy that should apply.
-- A permissive SELECT policy keyed on app.user_id would OR with isolation and
-- hand a dual-context caller every organization they belong to.

-- These two statements READ stores/deals, which are RLS-protected, and no
-- app.org_id is set during a migration. Locally the migration role is a
-- superuser and bypasses RLS; on RDS it may not, in which case the SELECTs
-- would silently return zero rows and the migration would report success with
-- nothing seeded. `row_security = off` makes that case ERROR instead of lying.
SET LOCAL row_security = off;

-- Seed every existing store with the canonical 10 (delivery.md §2). New stores
-- get theirs from the API when their first deal needs a checklist.
INSERT INTO checklist_templates (organization_id, store_id, code, label_fr, label_en, required, overridable, sort_order)
SELECT s.organization_id, s.id, t.code, t.label_fr, t.label_en, true, t.overridable, t.sort_order
FROM stores s
CROSS JOIN (VALUES
  ('insurance',      'Assurance du client',        'Client insurance',      true,  1),
  ('void_cheque',    'Chèque annulé',              'Void cheque',           true,  2),
  ('funding',        'Financement approuvé',       'Funding approved',      true,  3),
  ('idv',            'Vérification d''identité',   'Identity verification', true,  4),
  ('safety',         'Inspection de sécurité',     'Safety inspection',     false, 5),
  ('vehicle_ready',  'Véhicule prêt',              'Vehicle ready',         true,  6),
  ('wet_ink_file',   'Dossier signé (original)',   'Wet-ink file',          true,  7),
  ('delivery_date',  'Date de livraison',          'Delivery date',         true,  8),
  ('drivers_booked', 'Chauffeurs réservés',        'Drivers booked',        true,  9),
  ('registration',   'Immatriculation',            'Registration',          true, 10)
) AS t(code, label_fr, label_en, overridable, sort_order)
ON CONFLICT (organization_id, store_id, code) DO NOTHING;

-- Backfill every deal still in flight. A deal that already reached a terminal
-- stage is history and gets nothing: attaching requirements to it now would
-- invent an obligation it never had. Deals in flight snapshot the template as
-- it stands TODAY, which is the only honest answer available for rows that
-- predate this feature.
INSERT INTO deal_checklist_items
  (organization_id, deal_id, code, label_fr, label_en, required, overridable, sort_order)
SELECT d.organization_id, d.id, t.code, t.label_fr, t.label_en, t.required, t.overridable, t.sort_order
FROM deals d
JOIN checklist_templates t
  ON t.organization_id = d.organization_id AND t.store_id = d.store_id AND t.active
WHERE d.deleted_at IS NULL
  AND d.pipeline_stage NOT IN ('delivered', 'complete', 'lost')
ORDER BY d.id, t.code
ON CONFLICT (deal_id, code) DO NOTHING;
