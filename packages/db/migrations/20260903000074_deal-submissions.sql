-- 0074 — the lender submissions ledger (F-81; lenders-billofsale.md §2.1–§2.3;
-- FR-FIN-007's remaining half + FR-FIN-008; D-081 (9)'s named follow-on; D-082).
--
-- One deal, many submissions, exactly ONE selected: the partial unique below
-- is the invariant's arbiter of last resort; the route's FOR-UPDATE deal lock
-- is its serializer (apps/api/src/f81-submission-routes.ts). Selection
-- PROMOTES the chosen offer onto the deal (lender_id, interest_rate_bps ←
-- sell_rate_bps, term_months) and the engine recomputes — the deal stays the
-- single truth desk math reads; nothing here feeds desk math directly, and
-- nothing here is pay.
--
-- Stored status is the TRIMMED four (D-082): 'pending' adds no information
-- over 'submitted'; 'expired' is derived at read from expiry_date on the
-- deal's store clock; 'funded' is deals.funding_status's fact and is never
-- copied here. Transitions are free among the four (a hand-typed ledger
-- records reality — mis-clicks and lender reversals happen); three
-- path-independent CHECKs hold instead of a ladder.
--
-- Cut BY NAME (D-082 records each un-cut condition): a stored rate spread
-- (render-derived), a submission:manage verb (deal:update is reused — the
-- fi-products precedent), a DELETE grant/route (a deselected row is kept for
-- records, §2.3.1 — the free status machine and PATCHable lender_id/platform
-- are the correction doors), a deselect-to-none endpoint, a per-lender-per-
-- deal unique (a re-submission after a decline is a new row), a
-- submitted_by column (the 'created' event owns actorship), lender APIs and
-- webhooks (Q-14), and any per-store platform list (no such column exists).

CREATE TABLE deal_submissions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES organizations(id),
  store_id               uuid NOT NULL,
  deal_id                uuid NOT NULL,
  lender_id              uuid NOT NULL,

  -- All four offered, unfiltered — FR-FIN-010's per-store filter is cut by
  -- name (stores.submission_platforms exists nowhere at this tip).
  platform               text NOT NULL CHECK (platform IN ('dealertrack','creditapp','routeone','manual')),
  status                 text NOT NULL DEFAULT 'submitted'
                         CHECK (status IN ('submitted','approved','conditional','declined')),

  -- The lender's approved ceiling — informational; the deal's
  -- amount_financed_cents stays engine-computed and the UI warns on excess,
  -- never refuses.
  approval_amount_cents  integer CHECK (approval_amount_cents IS NULL OR approval_amount_cents >= 0),
  -- Basis points, integers only, like every rate on the deal (0006): the
  -- dealer's base rate vs the customer's rate. Any spread is derived at
  -- render — no stored column.
  buy_rate_bps           integer CHECK (buy_rate_bps  IS NULL OR (buy_rate_bps  BETWEEN 0 AND 10000)),
  sell_rate_bps          integer CHECK (sell_rate_bps IS NULL OR (sell_rate_bps BETWEEN 0 AND 10000)),
  -- The deal's own term bounds (0006 term_months) — one name everywhere.
  term_months            integer CHECK (term_months IS NULL OR (term_months BETWEEN 1 AND 120)),
  -- The LENDER'S quoted payment, captioned as such in the UI. The deal's
  -- payment is engine-owned and never copied from here.
  monthly_payment_cents  integer CHECK (monthly_payment_cents IS NULL OR monthly_payment_cents >= 0),

  conditions             text CHECK (conditions IS NULL OR length(conditions) <= 1000),
  conditions_met         boolean NOT NULL DEFAULT false,
  decline_reason         text CHECK (decline_reason IS NULL OR length(decline_reason) <= 500),
  -- A calendar day. No stored 'expired': lapsed is derived at read on the
  -- deal's store clock (stores.timezone, 0001), and selecting a lapsed
  -- approval is refused there — today is selectable, yesterday is not.
  expiry_date            date,

  selected               boolean NOT NULL DEFAULT false,
  submitted_at           timestamptz NOT NULL DEFAULT now(),
  -- Stamped ONCE by the route on the first entry into
  -- approved/conditional/declined; never re-stamped, never cleared.
  responded_at           timestamptz,
  notes                  text CHECK (notes IS NULL OR length(notes) <= 1000),

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  -- The three invariants the free status machine rests on (D-082). Each is
  -- one line, path-independent (routing through another value dodges
  -- nothing), and the route mirrors each as a 422 before the database has
  -- to say so.
  --   (i)  a chosen row is an approval — a PATCH moving the selected row off
  --        approved deselects it in the same UPDATE (the deal keeps its
  --        lender/rate/term as ordinary desk inputs — history keeps its name);
  --   (ii) an approval with conditions on file has them met;
  --   (iii) a decline reason belongs to a decline — leaving declined clears it.
  CONSTRAINT deal_submissions_selected_approved
    CHECK (NOT selected OR status = 'approved'),
  CONSTRAINT deal_submissions_approved_conditions_met
    CHECK (status <> 'approved' OR conditions IS NULL OR btrim(conditions) = '' OR conditions_met),
  CONSTRAINT deal_submissions_reason_declined
    CHECK (decline_reason IS NULL OR status = 'declined'),

  -- The F-80 law: composite FKs, so a cross-tenant deal/store/lender id is
  -- refused by the schema itself behind the route checks (0055's words: FK
  -- checks bypass RLS; the bare form would accept a rival's id). Targets:
  -- deals (0012), stores (0001), lenders (0073). No ON DELETE action: deals
  -- soft-delete and the app role holds no DELETE on any of the three.
  FOREIGN KEY (organization_id, deal_id)   REFERENCES deals   (organization_id, id),
  FOREIGN KEY (organization_id, store_id)  REFERENCES stores  (organization_id, id),
  FOREIGN KEY (organization_id, lender_id) REFERENCES lenders (organization_id, id)
);

-- Exactly one selected per deal — the arbiter for a writer that bypasses the
-- deal lock; unreachable through the routes (they deselect first under the
-- lock), so a 23505 here surfaces as a 500, never a mapped code.
CREATE UNIQUE INDEX deal_submissions_one_selected
  ON deal_submissions (deal_id) WHERE selected;

-- The list's order and the FK lookups.
CREATE INDEX idx_deal_submissions_deal
  ON deal_submissions (deal_id, submitted_at, id);
CREATE INDEX idx_deal_submissions_lender
  ON deal_submissions (lender_id);

CREATE TRIGGER deal_submissions_updated_at BEFORE UPDATE ON deal_submissions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Ledger grants (0072/0073's workflow shape): create INSERTs, response-
-- recording and selection UPDATE; no DELETE anywhere — a submission is
-- negotiation evidence and every recordable field is PATCHable for
-- corrections (D-082). The exact grant shape is pinned by
-- packages/db/src/migration-0074-submissions.test.ts.
GRANT SELECT, INSERT, UPDATE ON deal_submissions TO dealpilot_app;

ALTER TABLE deal_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_submissions FORCE  ROW LEVEL SECURITY;

-- One org-keyed policy, 0073's exact shape. NO bare user-keyed policy and no
-- member_read policy: routes resolve the org first (dealOrg for the deal-
-- addressed list/create; the lenderOrg iteration for id-addressed writes)
-- and run under withTenant — the isolation policy is the only door.
CREATE POLICY deal_submissions_isolation ON deal_submissions
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

COMMENT ON TABLE deal_submissions IS
  'Per-deal lender shopping ledger (lenders-billofsale.md §2): one deal, many submissions, exactly one selected (partial unique). Selection promotes lender_id / sell rate / term onto the deal and the engine recomputes; the deal remains the single truth desk math reads. Written under deal:update; no DELETE.';
COMMENT ON COLUMN deal_submissions.approval_amount_cents IS
  'The lender''s approved ceiling. Informational: amount_financed_cents stays engine-computed; the UI warns when it exceeds this and never refuses.';
COMMENT ON COLUMN deal_submissions.monthly_payment_cents IS
  'The LENDER''S quoted payment, captioned as such. The deal''s payment is engine-owned and never copied from here.';
COMMENT ON COLUMN deal_submissions.expiry_date IS
  'Approval expiry (calendar day). No stored ''expired'' status: lapsed is derived at read on the deal''s store clock; selecting a lapsed approval is refused there.';
COMMENT ON COLUMN deal_submissions.selected IS
  'The chosen approval (at most one per deal; partial unique deal_submissions_one_selected). Set true only by the select route, which promotes the row''s lender / sell rate / term onto the deal; set false by the select route when another row is chosen, and by the status PATCH when this row leaves approved (CHECK deal_submissions_selected_approved).';

-- The activity vocabulary learns the entity (0072 precedent: DROP + re-ADD,
-- the LIVE lists from 0072:95-111 verbatim + 'deal_submission'; no new verb —
-- create is 'created', response and selection are 'updated'; parent = deal).
ALTER TABLE activity_events DROP CONSTRAINT activity_events_entity_type_check;
ALTER TABLE activity_events ADD CONSTRAINT activity_events_entity_type_check
  CHECK (entity_type IN ('deal','lead','vehicle','membership','pay_plan',
                         'checklist_item','checklist_template','intake_key',
                         'invitation','dispatch_assignment','deal_document',
                         'deal_fi_product','tenant_branding','consent','suppression',
                         'internal_dnc','conversation','appointment','contact',
                         'organization','store','task','impersonation_session',
                         'commission_clawback','deal_submission'));
ALTER TABLE activity_events DROP CONSTRAINT activity_events_parent_entity_type_check;
ALTER TABLE activity_events ADD CONSTRAINT activity_events_parent_entity_type_check
  CHECK (parent_entity_type IS NULL OR parent_entity_type IN
         ('deal','lead','vehicle','membership','pay_plan',
          'checklist_item','checklist_template','intake_key',
          'invitation','dispatch_assignment','deal_document',
          'deal_fi_product','tenant_branding','consent','suppression',
          'internal_dnc','conversation','appointment','contact',
          'organization','store','task','impersonation_session',
          'commission_clawback','deal_submission'));
