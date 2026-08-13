-- 0028 — the compliance engine (compliance-and-quality.md §1–§12; ADR-020/022).
--
-- Phase 3 does not begin with the AI. It begins with the thing that must be
-- structurally incapable of being bypassed by one.
--
-- The spec's doctrine, verbatim: compliance is enforced "in the send layer and
-- by data-model constraints, not by prompt instructions alone (ADR-020/022): a
-- jailbroken model must still be structurally unable to send an unconsented
-- message or place an unconsented call."
--
-- That sentence is why these are tables and constraints rather than checks in a
-- worker. A prompt can be talked out of a rule. A CHECK constraint cannot.
--
-- The stake, from the roadmap: "compliance is binary — a CASL violation costs up
-- to $10M". Every ambiguity in the spec is therefore resolved by FAILING CLOSED:
-- where the rule is unclear the send is blocked, never allowed, and the open
-- question is written down for a human (docs/OWNER-DECISIONS-PENDING.md).

-- Composite target so the child tables below can enforce same-org consistency,
-- exactly as 0012 did for deals.
ALTER TABLE leads ADD CONSTRAINT leads_org_id_key UNIQUE (organization_id, id);

-- ---------------------------------------------------------------------------
-- Consent ledger (§2)
-- ---------------------------------------------------------------------------

/**
 * Every basis on which this organisation may contact this person.
 *
 * Append-mostly: a consent is never edited into a different consent. Expiry and
 * revocation are recorded as their own facts, so the answer to "what were we
 * relying on when we sent that, and when did we acquire it?" survives the
 * question being asked three years later.
 */
CREATE TABLE consent_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  store_id        uuid,

  -- One act by a consumer ("tick this box") fans out to several rows, one per
  -- channel and scope it authorises. `grant_id` groups them so a single act can
  -- be audited — and revoked — as the one act it was.
  grant_id        uuid NOT NULL DEFAULT gen_random_uuid(),

  lead_id         uuid,
  -- Identity keys, because consent is often acquired BEFORE a lead row exists
  -- (a web form at 02:00 that has not been normalised yet).
  phone_e164      text CHECK (phone_e164 ~ '^\+1[0-9]{10}$'),
  email           text CHECK (email = lower(btrim(email)) AND position('@' IN email) > 1),

  channel         text NOT NULL CHECK (channel IN ('sms','mms','email','voice','all')),
  scope           text NOT NULL CHECK (scope IN ('conversational','marketing','ai_outbound_call')),
  consent_type    text NOT NULL CHECK (consent_type IN ('express','implied_inquiry','implied_ebr')),

  source          text NOT NULL CHECK (source IN (
                    'form_checkbox','webhook_inquiry','sms_reply','voice','delivery_completed',
                    'staff_manual','re_opt_in')),
  -- What was actually shown and clicked: the wording, the IP, the user agent,
  -- the provider payload. A consent record with no evidence is an assertion.
  evidence        jsonb NOT NULL,

  granted_at      timestamptz NOT NULL,
  expires_at      timestamptz,
  revoked_at      timestamptz,
  revoked_reason  text CHECK (revoked_reason IN (
                    'stop_keyword','said_stop_extracted','email_unsubscribe',
                    'staff_manual','dsar_erasure')),

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (organization_id, lead_id)  REFERENCES leads  (organization_id, id),
  FOREIGN KEY (organization_id, store_id) REFERENCES stores (organization_id, id),

  -- A row no gate can find is a row that protects nobody.
  CHECK (lead_id IS NOT NULL OR phone_e164 IS NOT NULL OR email IS NOT NULL),
  -- The identity key must match the channel, or a STOP arriving by phone number
  -- cannot locate the consent it is meant to revoke.
  CHECK (channel NOT IN ('sms','mms','voice','all') OR phone_e164 IS NOT NULL),
  CHECK (channel NOT IN ('email','all')             OR email      IS NOT NULL),
  -- §2: implied bases expire (inquiry + 6 months, purchase + 24 months); express
  -- "never (revocable)". Making that a constraint means an implied consent
  -- cannot be stored as though it lasted forever.
  CHECK ((consent_type IN ('implied_inquiry','implied_ebr')) = (expires_at IS NOT NULL)),
  CHECK (expires_at IS NULL OR expires_at > granted_at),
  CHECK ((revoked_at IS NOT NULL) = (revoked_reason IS NOT NULL))
);

CREATE INDEX idx_consent_org_lead ON consent_ledger (organization_id, lead_id);
-- The gate's hot path. It deliberately does NOT filter on a status column:
-- expiry passes continuously, and a cached status is stale between sweeps.
CREATE INDEX idx_consent_gate_phone ON consent_ledger (organization_id, phone_e164, channel, scope)
  WHERE revoked_at IS NULL;
CREATE INDEX idx_consent_gate_email ON consent_ledger (organization_id, email, channel, scope)
  WHERE revoked_at IS NULL;
CREATE INDEX idx_consent_grant ON consent_ledger (organization_id, grant_id);

/**
 * The ledger is evidence, so the parts that make it evidence cannot be edited.
 *
 * Revocation and expiry are real events and must be writable. Everything that
 * describes WHAT was consented to, by WHOM, and on what evidence, is frozen —
 * enforced here rather than by convention, because "we do not edit consent
 * records" is exactly the sort of rule that quietly stops being true.
 */
CREATE FUNCTION consent_ledger_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.organization_id, NEW.grant_id, NEW.lead_id, NEW.phone_e164, NEW.email,
      NEW.channel, NEW.scope, NEW.consent_type, NEW.source, NEW.evidence,
      NEW.granted_at, NEW.expires_at)
     IS DISTINCT FROM
     (OLD.organization_id, OLD.grant_id, OLD.lead_id, OLD.phone_e164, OLD.email,
      OLD.channel, OLD.scope, OLD.consent_type, OLD.source, OLD.evidence,
      OLD.granted_at, OLD.expires_at)
  THEN
    RAISE EXCEPTION 'consent_ledger is append-only: only revoked_at/revoked_reason may change (row %)', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  -- Revocation is a one-way door. Un-revoking would let somebody who said STOP
  -- be quietly restored; a fresh opt-in appends a NEW row instead.
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'a revoked consent cannot be un-revoked; record a new consent instead (row %)', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER consent_ledger_immutable_trg BEFORE UPDATE ON consent_ledger
  FOR EACH ROW EXECUTE FUNCTION consent_ledger_immutable();
CREATE TRIGGER consent_ledger_updated_at BEFORE UPDATE ON consent_ledger
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Suppression — the STOP list (§5)
-- ---------------------------------------------------------------------------

/**
 * "Do not contact this number on this channel."
 *
 * §5: scope is organisation-wide — STOP to one rooftop suppresses every store of
 * the tenant. There is deliberately no store_id here: a customer who says stop
 * has not said "stop, except from your other lot".
 */
CREATE TABLE suppression_list (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES organizations(id),
  phone_e164             text NOT NULL CHECK (phone_e164 ~ '^\+1[0-9]{10}$'),
  channel                text NOT NULL CHECK (channel IN ('sms','mms','email','voice')),
  source                 text NOT NULL CHECK (source IN (
                           'stop_keyword','said_stop_extracted','email_unsubscribe','staff_manual')),
  source_message_ref     text,
  -- The literal word that matched, kept for the file a regulator would read.
  matched_keyword        text,

  -- Soft clear, never DELETE. §7 keeps suppression entries through a deletion
  -- request precisely because they are the proof we must NOT make contact.
  cleared_at             timestamptz,
  cleared_reason         text CHECK (cleared_reason IN ('re_opt_in')),
  cleared_by_message_ref text,

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK ((cleared_at IS NOT NULL) = (cleared_reason IS NOT NULL))
);

CREATE UNIQUE INDEX idx_suppression_live
  ON suppression_list (organization_id, phone_e164, channel) WHERE cleared_at IS NULL;
CREATE INDEX idx_suppression_history
  ON suppression_list (organization_id, phone_e164, created_at DESC);

CREATE TRIGGER suppression_list_updated_at BEFORE UPDATE ON suppression_list
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Internal do-not-call (§4)
-- ---------------------------------------------------------------------------

/**
 * §4, verbatim: "No exemptions to internal DNC."
 *
 * No `cleared_at` column, deliberately — the spec provides no path back, and a
 * column with no path to write it would be an invitation to invent one. Calling
 * such a person again requires fresh express call consent, which is a new row in
 * the ledger, not the erasure of this one.
 */
CREATE TABLE internal_dnc (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  phone_e164      text NOT NULL CHECK (phone_e164 ~ '^\+1[0-9]{10}$'),
  reason          text NOT NULL CHECK (reason IN (
                    'stop_keyword','said_stop_extracted','verbal_do_not_call','staff_manual')),
  source          text NOT NULL CHECK (source IN ('sms','voice','console','import')),
  -- NULL means the system acted on a rule, not a person on a hunch.
  added_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_internal_dnc_phone ON internal_dnc (organization_id, phone_e164);

CREATE TRIGGER internal_dnc_updated_at BEFORE UPDATE ON internal_dnc
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Per-tenant communication windows (§3)
-- ---------------------------------------------------------------------------

/**
 * The quiet-hours configuration a tenant is allowed to have.
 *
 * There are NO voice window columns, deliberately. §3's voice row reads
 * "Exemptions: None." — the CRTC window is 09:00–21:30 on weekdays and
 * 10:00–18:00 at weekends and no tenant may widen it, so no column exists that
 * could. The only configurable window is SMS, and a store row may narrow the
 * organisation's but never widen it (the gate intersects them).
 */
CREATE TABLE tenant_comms_config (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organizations(id),
  store_id                 uuid,

  sms_quiet_start          time NOT NULL DEFAULT '09:00',
  sms_quiet_end            time NOT NULL DEFAULT '21:00',
  -- §3: the first reply to somebody who just contacted you goes out immediately,
  -- 24/7, by default. A tenant may switch it off; they may not switch on
  -- anything wider.
  first_touch_quiet_exempt boolean NOT NULL DEFAULT true,
  -- §1: at most 3 AI-initiated contacts per lead per day.
  ai_daily_contact_cap     integer NOT NULL DEFAULT 3 CHECK (ai_daily_contact_cap BETWEEN 0 AND 10),

  deleted_at               timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (organization_id, store_id) REFERENCES stores (organization_id, id),
  CHECK (sms_quiet_start < sms_quiet_end)
);

CREATE UNIQUE INDEX idx_comms_config_org
  ON tenant_comms_config (organization_id) WHERE store_id IS NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX idx_comms_config_store
  ON tenant_comms_config (store_id) WHERE store_id IS NOT NULL AND deleted_at IS NULL;

CREATE TRIGGER tenant_comms_config_updated_at BEFORE UPDATE ON tenant_comms_config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- The decision record (§11)
-- ---------------------------------------------------------------------------

/**
 * Why this message was or was not sent, at the moment it was decided.
 *
 * Append-only and never edited. The outcome alone is not enough for an audit:
 * "why was this 21:15 message lawful?" needs the INPUTS — which timezone was
 * used and where it came from, which window applied, which consent row
 * authorised it. Recording only the verdict makes the trail unfalsifiable in
 * the useless direction.
 */
CREATE TABLE send_decisions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id),
  store_id           uuid,
  lead_id            uuid,
  phone_e164         text CHECK (phone_e164 ~ '^\+1[0-9]{10}$'),
  email              text,

  channel            text NOT NULL CHECK (channel IN ('sms','mms','email','voice')),
  scope              text NOT NULL CHECK (scope IN ('conversational','marketing','ai_outbound_call')),
  message_class      text NOT NULL,
  originator         text NOT NULL CHECK (originator IN ('ai','human','system')),

  status             text NOT NULL CHECK (status IN ('allowed','deferred','blocked')),
  reason             text,
  -- The row that made it lawful. Null on anything but `allowed`.
  consent_ledger_id  uuid REFERENCES consent_ledger(id),

  -- The inputs, so the decision can be re-derived rather than trusted.
  timezone           text NOT NULL,
  timezone_source    text NOT NULL CHECK (timezone_source IN ('postal_code','store','fallback')),
  recipient_local_at timestamptz NOT NULL,
  window_applied     text,
  deferred_until     timestamptz,
  gate_version       text NOT NULL,

  decided_at         timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (organization_id, lead_id)  REFERENCES leads  (organization_id, id),
  FOREIGN KEY (organization_id, store_id) REFERENCES stores (organization_id, id),
  -- An `allowed` decision must name the consent it relied on, or it proves
  -- nothing. A blocked one must say why.
  CHECK (status <> 'allowed' OR consent_ledger_id IS NOT NULL),
  CHECK (status <> 'blocked' OR reason IS NOT NULL),
  CHECK (status <> 'deferred' OR deferred_until IS NOT NULL)
);

CREATE INDEX idx_send_decisions_lead ON send_decisions (organization_id, lead_id, decided_at DESC);
CREATE INDEX idx_send_decisions_audit ON send_decisions (organization_id, decided_at DESC);
-- Counting today's AI-initiated contacts for the frequency cap.
CREATE INDEX idx_send_decisions_cap
  ON send_decisions (organization_id, lead_id, decided_at)
  WHERE status = 'allowed' AND originator = 'ai';

/** A decision record that can be edited is not a record. */
CREATE FUNCTION send_decisions_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'send_decisions is append-only (row %)', OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER send_decisions_no_update BEFORE UPDATE OR DELETE ON send_decisions
  FOR EACH ROW EXECUTE FUNCTION send_decisions_append_only();

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE ON consent_ledger, suppression_list, internal_dnc,
                                tenant_comms_config, send_decisions TO dealpilot_app;

ALTER TABLE consent_ledger      ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_ledger      FORCE  ROW LEVEL SECURITY;
ALTER TABLE suppression_list    ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppression_list    FORCE  ROW LEVEL SECURITY;
ALTER TABLE internal_dnc        ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_dnc        FORCE  ROW LEVEL SECURITY;
ALTER TABLE tenant_comms_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_comms_config FORCE  ROW LEVEL SECURITY;
ALTER TABLE send_decisions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE send_decisions      FORCE  ROW LEVEL SECURITY;

CREATE POLICY consent_ledger_isolation ON consent_ledger
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
CREATE POLICY suppression_list_isolation ON suppression_list
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
CREATE POLICY internal_dnc_isolation ON internal_dnc
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
CREATE POLICY tenant_comms_config_isolation ON tenant_comms_config
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
CREATE POLICY send_decisions_isolation ON send_decisions
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- The activity vocabulary gains these entities (forward-only; 0027 last set it).
ALTER TABLE activity_events DROP CONSTRAINT activity_events_entity_type_check;
ALTER TABLE activity_events ADD CONSTRAINT activity_events_entity_type_check
  CHECK (entity_type IN ('deal','lead','vehicle','membership','pay_plan',
                         'checklist_item','checklist_template','intake_key',
                         'invitation','dispatch_assignment','deal_document',
                         'deal_fi_product','tenant_branding','consent','suppression',
                         'internal_dnc','organization','store'));

ALTER TABLE activity_events DROP CONSTRAINT activity_events_parent_entity_type_check;
ALTER TABLE activity_events ADD CONSTRAINT activity_events_parent_entity_type_check
  CHECK (parent_entity_type IS NULL OR parent_entity_type IN
         ('deal','lead','vehicle','membership','pay_plan',
          'checklist_item','checklist_template','intake_key',
          'invitation','dispatch_assignment','deal_document',
          'deal_fi_product','tenant_branding','consent','suppression',
          'internal_dnc','organization','store'));

COMMENT ON TABLE consent_ledger IS
  'Every basis on which this organisation may contact a person. Append-only apart from revocation (trigger consent_ledger_immutable_trg) — it is evidence, not state.';
COMMENT ON TABLE send_decisions IS
  'Why each message was or was not sent, with the inputs that decided it, so a regulator can re-derive the answer rather than take our word (compliance-and-quality.md §11).';
