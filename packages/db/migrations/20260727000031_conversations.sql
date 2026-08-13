-- 0031 — conversations and messages (conversation-engine.md §12).
--
-- The point of this slice is not storage. It is that the compliance gate stops
-- being a thing a screen can ask and becomes the thing the sender obeys: every
-- outbound row here is created by a path that has already called
-- `evaluateSend`, and the decision that authorised it is written beside it.
--
-- Until now `send_decisions` had columns nothing wrote, registered as debt in
-- the dead-column guard. This is the slice that pays that debt.

CREATE TABLE conversations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id),
  store_id          uuid NOT NULL,
  lead_id           uuid,
  deal_id           uuid,

  channel           text NOT NULL DEFAULT 'sms'
                    CHECK (channel IN ('sms','voice','web_chat','whatsapp')),
  -- The number this conversation is with. Every outbound message goes HERE and
  -- nowhere else — the destination is never a parameter a model can supply
  -- (conversation-engine.md §4: "no tool sends free-form messages to arbitrary
  -- numbers").
  phone_e164        text NOT NULL CHECK (phone_e164 ~ '^\+1[0-9]{10}$'),

  status            text NOT NULL DEFAULT 'bot_active'
                    CHECK (status IN ('bot_active','handed_off','agent_active','drip_active','closed')),
  -- §12 and ADR-019: French, because this is a Quebec-first product and the
  -- legacy 'en' default was a bug that shipped.
  language          text NOT NULL DEFAULT 'fr' CHECK (language IN ('fr','en')),

  assigned_agent_id uuid REFERENCES users(id) ON DELETE SET NULL,
  handed_off_at     timestamptz,
  closed_at         timestamptz,
  bot_summary       text,

  deleted_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (organization_id, store_id) REFERENCES stores (organization_id, id),
  FOREIGN KEY (organization_id, lead_id)  REFERENCES leads  (organization_id, id),
  UNIQUE (organization_id, id),
  -- A handed-off conversation must say who has it, or "handed off" means
  -- nobody in particular is responsible.
  CHECK (status NOT IN ('handed_off','agent_active') OR assigned_agent_id IS NOT NULL)
);

-- One live conversation per number per organisation: the inbound router does
-- find-or-create, and two live rows would split a customer's history in half.
CREATE UNIQUE INDEX idx_conversations_live
  ON conversations (organization_id, phone_e164, channel)
  WHERE status <> 'closed' AND deleted_at IS NULL;
CREATE INDEX idx_conversations_lead ON conversations (organization_id, lead_id);
CREATE INDEX idx_conversations_open ON conversations (organization_id, status, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE TRIGGER conversations_updated_at BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

/**
 * Every message, in or out. Append-only.
 *
 * `consent_ledger_id` on an outbound row is the whole compliance story in one
 * column: it names the basis the send actually relied on. "We had consent" is
 * not a defence — "we relied on this row, acquired here, on this evidence" is,
 * and a message that cannot point at one should not have been sent.
 */
CREATE TABLE messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id),
  conversation_id   uuid NOT NULL,

  direction         text NOT NULL CHECK (direction IN ('inbound','outbound')),
  sender_type       text NOT NULL CHECK (sender_type IN ('client','bot','agent','system','drip')),
  channel           text NOT NULL DEFAULT 'sms'
                    CHECK (channel IN ('sms','mms','voice_transcript','web_chat')),
  body              text NOT NULL,

  -- Which consent authorised this send, and which decision recorded it.
  consent_ledger_id uuid REFERENCES consent_ledger(id),
  send_decision_id  uuid REFERENCES send_decisions(id),

  provider_ref      text,
  segments          integer CHECK (segments IS NULL OR segments > 0),
  delivered         boolean NOT NULL DEFAULT false,
  delivered_at      timestamptz,

  created_at        timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (organization_id, conversation_id) REFERENCES conversations (organization_id, id),
  -- An outbound message MUST name the consent it relied on. This is the
  -- constraint that makes the gate load-bearing rather than advisory: there is
  -- no code path that can store a sent message without one, however the sender
  -- was written or rewritten.
  CHECK (direction = 'inbound' OR consent_ledger_id IS NOT NULL),
  -- An inbound message is from the client; a bot cannot receive.
  CHECK (direction = 'outbound' OR sender_type = 'client')
);

CREATE INDEX idx_messages_conversation ON messages (organization_id, conversation_id, created_at);
CREATE INDEX idx_messages_recent ON messages (organization_id, created_at DESC);

/** A conversation is a record of what was said. Nothing may rewrite it. */
CREATE FUNCTION messages_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Delivery receipts arrive after the fact and are the one legitimate update.
  IF TG_OP = 'UPDATE'
     AND (NEW.organization_id, NEW.conversation_id, NEW.direction, NEW.sender_type,
          NEW.channel, NEW.body, NEW.consent_ledger_id, NEW.send_decision_id, NEW.created_at)
         IS NOT DISTINCT FROM
         (OLD.organization_id, OLD.conversation_id, OLD.direction, OLD.sender_type,
          OLD.channel, OLD.body, OLD.consent_ledger_id, OLD.send_decision_id, OLD.created_at)
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'messages is append-only: only delivery fields may change (row %)', OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER messages_append_only_trg BEFORE UPDATE OR DELETE ON messages
  FOR EACH ROW EXECUTE FUNCTION messages_append_only();

GRANT SELECT, INSERT, UPDATE ON conversations, messages TO dealpilot_app;

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE  ROW LEVEL SECURITY;
ALTER TABLE messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages      FORCE  ROW LEVEL SECURITY;

CREATE POLICY conversations_isolation ON conversations
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
CREATE POLICY messages_isolation ON messages
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- The activity vocabulary gains these (forward-only; 0028 last set it).
ALTER TABLE activity_events DROP CONSTRAINT activity_events_entity_type_check;
ALTER TABLE activity_events ADD CONSTRAINT activity_events_entity_type_check
  CHECK (entity_type IN ('deal','lead','vehicle','membership','pay_plan',
                         'checklist_item','checklist_template','intake_key',
                         'invitation','dispatch_assignment','deal_document',
                         'deal_fi_product','tenant_branding','consent','suppression',
                         'internal_dnc','conversation','message','organization','store'));

ALTER TABLE activity_events DROP CONSTRAINT activity_events_parent_entity_type_check;
ALTER TABLE activity_events ADD CONSTRAINT activity_events_parent_entity_type_check
  CHECK (parent_entity_type IS NULL OR parent_entity_type IN
         ('deal','lead','vehicle','membership','pay_plan',
          'checklist_item','checklist_template','intake_key',
          'invitation','dispatch_assignment','deal_document',
          'deal_fi_product','tenant_branding','consent','suppression',
          'internal_dnc','conversation','message','organization','store'));

COMMENT ON COLUMN messages.consent_ledger_id IS
  'The consent this send relied on. Required on every outbound row by CHECK — the gate is load-bearing, not advisory.';
