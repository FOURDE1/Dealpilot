-- 0072 — commission clawbacks (F-79, commissions-clawbacks.md §8, §11.4; FR-COM-004).
--
-- `kind='clawback'` has been legal since 0011 with ZERO producers — the page
-- renders it (« Reprise ») and monthTotal subtracts it, test-pinned. This is
-- the producer: a flagged→reversed lifecycle row, whose CONFIRMATION writes
-- exactly one offsetting negative commissions line.
--
-- TERMINAL BY DESIGN (D-080): commissions carries UNIQUE (deal_id, user_id,
-- kind), so at most ONE clawback line can ever exist per (deal, user). We
-- accept that as the product rule — one clawback per commission line, partial
-- or full, definitive once confirmed — rather than perform surgery on the
-- constraint the funding trigger's idempotency stands on (f09's ON CONFLICT).
--
-- The same-person sale+override edge follows from that UNIQUE: a seller who
-- also earns an override on their own deal holds TWO commission lines but only
-- ONE (deal, user, 'clawback') slot, so confirming the second reversal raises
-- 23505 on the negative INSERT — the route maps it to 422 clawback_cap_reached
-- and the WHOLE transaction rolls back (a status flip with no line never
-- commits).

CREATE TABLE commission_clawbacks (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES organizations(id),
  deal_id                uuid NOT NULL REFERENCES deals(id),
  -- §11.4: "commission_id FK mandatory" — the legacy's clawback_log.commission_id
  -- was never populated (defect D11); here a clawback that cannot name the exact
  -- line it reverses cannot be written at all.
  commission_id          uuid NOT NULL REFERENCES commissions(id),

  status                 text NOT NULL DEFAULT 'flagged'
                         CHECK (status IN ('flagged','reversed')),
  reason                 text NOT NULL CHECK (btrim(reason) <> '' AND length(reason) <= 500),

  -- Copied from the commission row at flag time (server-derived, never
  -- client-supplied); the negative line at confirm time is -reversed_amount_cents,
  -- derived from THIS row — the client sends no amount at confirm.
  original_amount_cents  integer NOT NULL CHECK (original_amount_cents > 0),
  reversed_amount_cents  integer NOT NULL
                         CHECK (reversed_amount_cents > 0
                                AND reversed_amount_cents <= original_amount_cents),

  -- Plain NOT NULL FK, matching 0011's user FKs: users are soft-deleted in
  -- this product, and an evidence row must always name its actor.
  flagged_by             uuid NOT NULL REFERENCES users(id),
  confirmed_by           uuid REFERENCES users(id),
  confirmed_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),

  -- The confirmation facts travel together or not at all: status, stamp and
  -- actor are three faces of one act, so BOTH pairs are pinned — a single
  -- CHECK on confirmed_at would leave confirmed_by free to lie.
  CHECK ((status = 'reversed') = (confirmed_at IS NOT NULL)),
  CHECK ((status = 'reversed') = (confirmed_by IS NOT NULL))
);

COMMENT ON COLUMN commission_clawbacks.created_at IS
  'The flag moment. No separate flagged_at exists: both would carry the same DEFAULT now() from the same transaction, and the shared keyset pagination sorts every list on (created_at, id).';

-- §11.4 "duplicate flags blocked while flagged": a partial unique INDEX, so
-- the 409 comes from the database (race-proof), not from a read-then-write.
-- Postgres reports its name in e.constraint like a constraint's
-- (the idx_vehicles_org_vin precedent) — CONSTRAINT_PATHS maps it.
CREATE UNIQUE INDEX commission_clawbacks_one_flagged
  ON commission_clawbacks (commission_id) WHERE status = 'flagged';

CREATE INDEX idx_commission_clawbacks_org
  ON commission_clawbacks (organization_id, created_at DESC, id DESC);
CREATE INDEX idx_commission_clawbacks_commission
  ON commission_clawbacks (commission_id);
-- The list's deal_id filter and the FK lookups.
CREATE INDEX idx_commission_clawbacks_deal
  ON commission_clawbacks (deal_id);

-- Flag INSERTs, confirm UPDATEs the status; nothing is ever deleted — the
-- money correction itself is an append-only commissions row, per 0011. A
-- workflow table legitimately holds UPDATE, so it does NOT join rls-coverage's
-- immutable-tables set; its exact grant shape is pinned by T-DB1 instead.
GRANT SELECT, INSERT, UPDATE ON commission_clawbacks TO dealpilot_app;

ALTER TABLE commission_clawbacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_clawbacks FORCE ROW LEVEL SECURITY;

-- One org-keyed policy, 0013's shape. NO bare user-keyed policy: routes
-- resolve the org first (resolveOrg/clawbackOrg) and run under withTenant;
-- pay privacy on reads is route-enforced exactly like /api/v1/commissions.
CREATE POLICY commission_clawbacks_isolation ON commission_clawbacks
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- The activity vocabulary learns the entity (0067 precedent: DROP + re-ADD,
-- the LIVE lists from 0067:140-154 verbatim + commission_clawback; no new
-- verb — flag is 'created', confirm is 'updated'; parent = the deal).
ALTER TABLE activity_events DROP CONSTRAINT activity_events_entity_type_check;
ALTER TABLE activity_events ADD CONSTRAINT activity_events_entity_type_check
  CHECK (entity_type IN ('deal','lead','vehicle','membership','pay_plan',
                         'checklist_item','checklist_template','intake_key',
                         'invitation','dispatch_assignment','deal_document',
                         'deal_fi_product','tenant_branding','consent','suppression',
                         'internal_dnc','conversation','appointment','contact',
                         'organization','store','task','impersonation_session',
                         'commission_clawback'));
ALTER TABLE activity_events DROP CONSTRAINT activity_events_parent_entity_type_check;
ALTER TABLE activity_events ADD CONSTRAINT activity_events_parent_entity_type_check
  CHECK (parent_entity_type IS NULL OR parent_entity_type IN
         ('deal','lead','vehicle','membership','pay_plan',
          'checklist_item','checklist_template','intake_key',
          'invitation','dispatch_assignment','deal_document',
          'deal_fi_product','tenant_branding','consent','suppression',
          'internal_dnc','conversation','appointment','contact',
          'organization','store','task','impersonation_session',
          'commission_clawback'));

-- The clawback authority joins the catalogue (0057 precedent). Defaults per
-- §11.4: fi_manager / gm / owner. The matrix screen lists it automatically.
INSERT INTO role_permissions (organization_id, role, permission)
SELECT o.id, d.role, d.permission
FROM organizations o
CROSS JOIN (VALUES
  ('owner','commission:clawback'),
  ('gm','commission:clawback'),
  ('fi_manager','commission:clawback')
) AS d(role, permission)
ON CONFLICT DO NOTHING;

-- D-080 (b): 0011's comment said "always the deal's funded_at"; §11.4 rules
-- the OPEN period for clawbacks — a closed month's statement never restates.
-- Restated here by COMMENT because applied migrations are never edited.
COMMENT ON COLUMN commissions.funded_at IS
  'The pay period this line belongs to. sale/override: the deal''s funded_at. clawback: the CONFIRMATION time (the open period, commissions-clawbacks.md §11.4) — a closed month''s statement is never restated. Server-stamped in all cases; never client-supplied.';
