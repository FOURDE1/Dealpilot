-- 0023 deal documents (F-13, documents.md §2/§3/§4/§11.1).
--
-- The paper a deal has to carry. Thirteen document types, and which of them a
-- given deal needs is DERIVED from the deal's own shape: a lease needs a lease
-- agreement, an Ontario deal needs an OMVIC disclosure, a trade with a lien
-- needs a payoff authorization. Nobody should be maintaining that list by hand
-- per deal — getting it wrong is a compliance problem, not a clerical one.
--
-- This is also what finally makes the wet-ink gate real. F-08's `wet_ink_file`
-- checklist item and F-11b's dispatch gate are both a manual tick today: a
-- person asserting the file is complete. With this table the same question has
-- an actual answer — is every document that requires a signature signed?

-- Needed by the as-is waiver rule (§3), and it is the compliance counterpart of
-- the safety exemption (delivery.md §2.2): an as-is deal may skip the safety
-- hard block ONLY because this disclosure is in the file.
ALTER TABLE deals ADD COLUMN sold_as_is boolean NOT NULL DEFAULT false;

CREATE TABLE deal_documents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL,
  store_id            uuid NOT NULL,
  deal_id             uuid NOT NULL,

  document_type       text NOT NULL CHECK (document_type IN (
                        'bank_contract','bill_of_sale','warranty_agreement','gap_agreement',
                        'aftermarket_agreement','privacy_consent','omvic_disclosure',
                        'vehicle_condition','trade_in_lien_authorization','odometer_statement',
                        'as_is_waiver','carfax_report','lease_agreement')),
  document_name       text NOT NULL CHECK (btrim(document_name) <> ''),
  source_system       text NOT NULL CHECK (source_system IN
                        ('dealertrack','cams','merlin','internal','carfax')),

  -- One vocabulary (ADR-009). The Carfax path skips the signing states:
  -- not_ready → generated → in_file → filed.
  status              text NOT NULL DEFAULT 'not_ready' CHECK (status IN
                        ('not_ready','generated','e_signed','printed','in_file','signed','filed')),
  -- False for information-only documents (Carfax): they belong in the file but
  -- nobody signs them, and counting them as unsigned would block every delivery.
  requires_signature  boolean NOT NULL DEFAULT true,

  esign_platform      text CHECK (esign_platform IS NULL OR esign_platform IN ('onespan','docusign')),
  esign_envelope_id   text,
  esign_sent_at       timestamptz,
  esign_signed_at     timestamptz,

  printed_at          timestamptz,
  printed_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  signed_at_delivery  timestamptz,
  filed_at            timestamptz,
  filed_by            uuid REFERENCES users(id) ON DELETE SET NULL,

  -- Storage paths, filled in when the upload slice lands (ADR-013: S3, private
  -- buckets, per-tenant prefixes, presigned URLs only).
  unsigned_file_url   text,
  signed_file_url     text,

  notes               text,
  /** Wet-ink checklist display order — the order a driver hands them over. */
  sort_order          integer NOT NULL DEFAULT 0,

  deleted_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (organization_id, deal_id) REFERENCES deals (organization_id, id),
  FOREIGN KEY (organization_id, store_id) REFERENCES stores (organization_id, id)
);

-- One row per document type per deal. Aftermarket agreements are the exception
-- — a deal can carry several — so they are excluded from the rule rather than
-- forcing a fake distinction into the type.
CREATE UNIQUE INDEX idx_deal_documents_one_per_type
  ON deal_documents (deal_id, document_type)
  WHERE deleted_at IS NULL AND document_type <> 'aftermarket_agreement';

CREATE INDEX idx_deal_documents_deal ON deal_documents (deal_id, sort_order)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_deal_documents_org_status ON deal_documents (organization_id, status)
  WHERE deleted_at IS NULL;

CREATE TRIGGER deal_documents_updated_at BEFORE UPDATE ON deal_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Which system produces the bill of sale, per store (§2). Ready Group stores
-- use CAMS, Kia uses Merlin.
ALTER TABLE stores
  ADD COLUMN bill_of_sale_system text NOT NULL DEFAULT 'CAMS'
    CHECK (bill_of_sale_system IN ('CAMS','Merlin','Other')),
  ADD COLUMN esign_platform text
    CHECK (esign_platform IS NULL OR esign_platform IN ('onespan','docusign'));

GRANT SELECT, INSERT, UPDATE ON deal_documents TO dealpilot_app;

ALTER TABLE deal_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_documents FORCE ROW LEVEL SECURITY;

CREATE POLICY deal_document_isolation ON deal_documents
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

/**
 * Is this deal's wet-ink file complete?
 *
 * True when every document that requires a signature has been signed (or
 * filed). Information-only documents — the Carfax report — need only to be in
 * the file, because nobody signs them and treating them as outstanding would
 * block every used-car delivery forever.
 *
 * A deal with NO documents returns NULL, meaning "not applicable": deals that
 * predate F-13 must not become undeliverable because a table arrived after
 * they were written.
 */
CREATE FUNCTION wet_ink_complete(p_deal uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN count(*) = 0 THEN NULL
    ELSE bool_and(
      CASE WHEN requires_signature
           THEN status IN ('signed','filed')
           ELSE status IN ('in_file','filed')
      END)
  END
  FROM deal_documents
  WHERE deal_id = p_deal AND deleted_at IS NULL;
$$;

-- The activity vocabulary gains this entity. Forward-only: 0018 set the
-- constraint and is merged, so it is replaced here rather than edited.
ALTER TABLE activity_events DROP CONSTRAINT activity_events_entity_type_check;
ALTER TABLE activity_events ADD CONSTRAINT activity_events_entity_type_check
  CHECK (entity_type IN ('deal','lead','vehicle','membership','pay_plan',
                         'checklist_item','checklist_template','intake_key',
                         'invitation','dispatch_assignment','deal_document',
                         'organization','store'));

ALTER TABLE activity_events DROP CONSTRAINT activity_events_parent_entity_type_check;
ALTER TABLE activity_events ADD CONSTRAINT activity_events_parent_entity_type_check
  CHECK (parent_entity_type IS NULL OR parent_entity_type IN
         ('deal','lead','vehicle','membership','pay_plan',
          'checklist_item','checklist_template','intake_key',
          'invitation','dispatch_assignment','deal_document',
          'organization','store'));
