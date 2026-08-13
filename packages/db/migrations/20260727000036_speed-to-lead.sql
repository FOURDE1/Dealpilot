-- 0036 — speed to lead (leads.md §5, ADR-025).
--
-- The industry number this product is sold on: leads contacted within five
-- minutes are 21× more likely to qualify, and 13.2% of dealerships manage it.
-- A metric that decides whether the pitch is true cannot rest on somebody
-- remembering to press "Log First Contact" — which is what the legacy system
-- did, and is a fair part of why 43.2% of automotive leads are mishandled.
--
-- So these columns are stamped by the SEND PATH. Every message to a customer
-- goes through one function (F-19); a contact that happened and was not
-- recorded is therefore not a thing that can happen.

ALTER TABLE leads
  -- §5.1's four names, kept verbatim so the spec and the schema read alike.
  ADD COLUMN first_contacted_at     timestamptz,
  ADD COLUMN last_contacted_at      timestamptz,
  -- Creation → first contact. Stored rather than derived: `created_at` is the
  -- lead's, and a lead may be merged or re-parented, at which point a computed
  -- answer silently changes a number somebody has already reported.
  ADD COLUMN response_time_seconds  integer CHECK (response_time_seconds >= 0),
  ADD COLUMN contact_attempts       integer NOT NULL DEFAULT 0
                                    CHECK (contact_attempts >= 0),
  -- When a person became responsible. §5.2's ten-minute reassignment ladder
  -- counts from here, not from creation.
  ADD COLUMN assigned_at            timestamptz;

-- The two facts have to agree: a response time without a contact is a number
-- with nothing behind it.
ALTER TABLE leads ADD CONSTRAINT leads_response_time_needs_contact
  CHECK ((first_contacted_at IS NULL) = (response_time_seconds IS NULL));

-- A first contact is also a contact.
ALTER TABLE leads ADD CONSTRAINT leads_contact_attempts_agree
  CHECK (first_contacted_at IS NULL OR contact_attempts > 0);

CREATE INDEX idx_leads_speed ON leads (organization_id, store_id, created_at DESC)
  WHERE deleted_at IS NULL;

/**
 * Stamp the first contact, and every one after it.
 *
 * A trigger rather than route code, because the rule is "any outbound message
 * to this lead counts" and there must be no way to send one without it
 * counting. `COALESCE` on the first-contact fields makes it idempotent: the
 * first time wins, and it stays won.
 */
CREATE FUNCTION leads_stamp_contact() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_lead uuid;
BEGIN
  IF NEW.direction <> 'outbound' THEN
    RETURN NEW;
  END IF;
  SELECT cv.lead_id INTO target_lead
  FROM conversations cv WHERE cv.id = NEW.conversation_id;
  IF target_lead IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE leads l
  SET first_contacted_at = COALESCE(l.first_contacted_at, NEW.created_at),
      last_contacted_at  = NEW.created_at,
      response_time_seconds = COALESCE(
        l.response_time_seconds,
        GREATEST(0, floor(extract(epoch FROM (NEW.created_at - l.created_at)))::integer)
      ),
      contact_attempts = l.contact_attempts + 1,
      updated_at = now()
  WHERE l.id = target_lead AND l.organization_id = NEW.organization_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER messages_stamp_contact AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION leads_stamp_contact();

COMMENT ON COLUMN leads.response_time_seconds IS
  'Creation to first outbound contact. Stamped by trigger on messages — never by a screen, because a metric a person has to remember is a metric that is wrong.';
