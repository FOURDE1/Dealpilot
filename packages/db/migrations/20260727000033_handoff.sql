-- 0033 — the handoff (conversation-engine.md §9).
--
-- 0031 built the conversation and left five columns nothing could write, which
-- the dead-column guard has been holding as debt ever since. This is the slice
-- that writes them: a person takes the conversation, and the assistant stops.

-- §9: the assistant's read on the lead, carried onto the conversation so the
-- console can sort a queue without joining the analysis log.
ALTER TABLE conversations ADD COLUMN bot_score text
  CHECK (bot_score IN ('hot','warm','cold'));

-- §9 trigger 2 needs four fields, and this is the fourth.
--
-- Three values, not a boolean, because "no trade" and "never asked" are opposite
-- facts about whether this lead is ready for a person and a boolean cannot tell
-- them apart. A default of 'unknown' is the honest one: nothing has asked yet.
ALTER TABLE leads ADD COLUMN trade_in_status text NOT NULL DEFAULT 'unknown'
  CHECK (trade_in_status IN ('none','has_trade','unknown'));

-- When the assistant handed this lead to a person. Distinct from
-- conversations.handed_off_at: a lead may be reached on more than one
-- conversation, and this is the first time a human took over on any of them.
ALTER TABLE leads ADD COLUMN chatbot_handoff_at timestamptz;

-- §9 trigger 5, "as-is (settings default)". Lives beside ai_daily_contact_cap
-- because it is the same kind of budget: how much the assistant may do before a
-- person is required.
ALTER TABLE tenant_comms_config ADD COLUMN bot_turn_cap integer NOT NULL DEFAULT 15
  CHECK (bot_turn_cap BETWEEN 1 AND 100);

/**
 * What the assistant thinks (conversation-engine.md §9).
 *
 * Every row here is model output, and the table is built to keep it in its
 * place: advisory, addressed to a person, never an input to a decision the
 * platform makes on its own. In particular `suggested_response` is a draft for
 * an agent to read — sending it goes through the same gate and the same
 * outbound guard as any other message, because a suggestion that could be sent
 * by accepting it is a message a jailbroken model can send.
 *
 * Append-only by grant: the silent monitor adds a row per update (§9) rather
 * than rewriting one, so the file shows what the assistant believed at the time
 * and not only what it last believed.
 */
CREATE TABLE conversation_analysis (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id),
  store_id          uuid NOT NULL,
  conversation_id   uuid NOT NULL,
  lead_id           uuid,

  analysis_type     text NOT NULL
                    CHECK (analysis_type IN ('handoff_summary','live_update','scoring')),
  sentiment         text NOT NULL
                    CHECK (sentiment IN ('positive','neutral','frustrated','losing_interest')),
  buying_signals    text[] NOT NULL DEFAULT '{}',
  concerns          text[] NOT NULL DEFAULT '{}',
  suggested_response text,
  summary           text NOT NULL CHECK (btrim(summary) <> ''),
  score             text NOT NULL CHECK (score IN ('hot','warm','cold')),
  score_reason      text NOT NULL CHECK (btrim(score_reason) <> ''),

  created_at        timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (organization_id, store_id)       REFERENCES stores        (organization_id, id),
  FOREIGN KEY (organization_id, conversation_id) REFERENCES conversations (organization_id, id),
  FOREIGN KEY (organization_id, lead_id)         REFERENCES leads         (organization_id, id)
);

CREATE INDEX idx_conversation_analysis_conv
  ON conversation_analysis (organization_id, conversation_id, created_at DESC);
CREATE INDEX idx_conversation_analysis_lead
  ON conversation_analysis (organization_id, lead_id, created_at DESC);

-- No UPDATE, no DELETE: what the assistant believed is a fact about a moment.
GRANT SELECT, INSERT ON conversation_analysis TO dealpilot_app;

ALTER TABLE conversation_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_analysis FORCE  ROW LEVEL SECURITY;

CREATE POLICY conversation_analysis_isolation ON conversation_analysis
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- The activity vocabulary loses 'message' (forward-only; 0031 added it).
--
-- 0031 declared it on the assumption that messages would want a trail, and
-- nothing ever emitted one — messages ARE their own append-only log, so an
-- activity row per message would be the same fact written twice. The
-- dead-vocabulary guard found it the moment 0033 gave it company. The handoff
-- records itself against the CONVERSATION, which is the thing that changed
-- hands; the analysis row is likewise its own log and gets no entity type until
-- something needs to point at one.
ALTER TABLE activity_events DROP CONSTRAINT activity_events_entity_type_check;
ALTER TABLE activity_events ADD CONSTRAINT activity_events_entity_type_check
  CHECK (entity_type IN ('deal','lead','vehicle','membership','pay_plan',
                         'checklist_item','checklist_template','intake_key',
                         'invitation','dispatch_assignment','deal_document',
                         'deal_fi_product','tenant_branding','consent','suppression',
                         'internal_dnc','conversation','organization','store'));

ALTER TABLE activity_events DROP CONSTRAINT activity_events_parent_entity_type_check;
ALTER TABLE activity_events ADD CONSTRAINT activity_events_parent_entity_type_check
  CHECK (parent_entity_type IS NULL OR parent_entity_type IN
         ('deal','lead','vehicle','membership','pay_plan',
          'checklist_item','checklist_template','intake_key',
          'invitation','dispatch_assignment','deal_document',
          'deal_fi_product','tenant_branding','consent','suppression',
          'internal_dnc','conversation','organization','store'));

COMMENT ON COLUMN conversation_analysis.suggested_response IS
  'A draft for a person to read. Sending it runs the compliance gate and the outbound guard like any other message — accepting a suggestion is not a shortcut past either.';
