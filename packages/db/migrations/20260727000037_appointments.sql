-- 0037 — appointments (FR-APP, conversation-engine.md §4).
--
-- The assistant has been offered a `book_appointment` tool since F-26, with
-- nothing behind it. A model that called it would have got an error, or worse:
-- it could tell a customer "I have booked you in for Saturday at 10" and be
-- describing something that exists nowhere. This is the table that makes the
-- promise true.

CREATE TABLE appointments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES organizations(id),
  store_id          uuid NOT NULL,
  lead_id           uuid,
  conversation_id   uuid,
  /** Who is expected to be there. Null until routing assigns somebody. */
  assigned_agent_id uuid REFERENCES users(id) ON DELETE SET NULL,

  kind              text NOT NULL
                    CHECK (kind IN ('test_drive','showroom_visit','phone_call')),
  status            text NOT NULL DEFAULT 'booked'
                    CHECK (status IN ('booked','confirmed','completed','no_show','cancelled')),

  starts_at         timestamptz NOT NULL,
  ends_at           timestamptz NOT NULL,

  /**
   * The vehicle, BY STOCK NUMBER rather than by id.
   *
   * §4's tool takes a stock number because that is what `lookup_inventory`
   * returned — a model asked for a uuid would invent one. Kept as text so a
   * booking survives the vehicle being sold and removed, which is exactly when
   * somebody needs to read the appointment to find out what happened.
   */
  vehicle_stock_number text CHECK (vehicle_stock_number IS NULL OR btrim(vehicle_stock_number) <> ''),

  /** Who booked it: the assistant, a person, or the customer on a form. */
  booked_by         text NOT NULL DEFAULT 'agent'
                    CHECK (booked_by IN ('assistant','agent','customer')),
  notes             text,

  cancelled_at      timestamptz,
  cancelled_reason  text,

  deleted_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (organization_id, store_id)        REFERENCES stores        (organization_id, id),
  FOREIGN KEY (organization_id, lead_id)         REFERENCES leads         (organization_id, id),
  FOREIGN KEY (organization_id, conversation_id) REFERENCES conversations (organization_id, id),

  -- An appointment that ends before it starts is a data-entry bug that reads as
  -- a scheduling bug three screens later.
  CHECK (ends_at > starts_at),
  -- A cancellation says when AND why, or the board shows a gap nobody can explain.
  CHECK ((cancelled_at IS NULL) = (status <> 'cancelled')),
  CHECK (status <> 'cancelled' OR cancelled_reason IS NOT NULL)
);

CREATE INDEX idx_appointments_store_day
  ON appointments (organization_id, store_id, starts_at)
  WHERE deleted_at IS NULL AND status NOT IN ('cancelled','no_show');
CREATE INDEX idx_appointments_lead ON appointments (organization_id, lead_id, starts_at DESC);
CREATE INDEX idx_appointments_agent
  ON appointments (organization_id, assigned_agent_id, starts_at)
  WHERE deleted_at IS NULL;

CREATE TRIGGER appointments_updated_at BEFORE UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE ON appointments TO dealpilot_app;

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments FORCE  ROW LEVEL SECURITY;

CREATE POLICY appointments_isolation ON appointments
  USING (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- The activity vocabulary gains it (forward-only; 0033 last set it).
ALTER TABLE activity_events DROP CONSTRAINT activity_events_entity_type_check;
ALTER TABLE activity_events ADD CONSTRAINT activity_events_entity_type_check
  CHECK (entity_type IN ('deal','lead','vehicle','membership','pay_plan',
                         'checklist_item','checklist_template','intake_key',
                         'invitation','dispatch_assignment','deal_document',
                         'deal_fi_product','tenant_branding','consent','suppression',
                         'internal_dnc','conversation','appointment','organization','store'));

ALTER TABLE activity_events DROP CONSTRAINT activity_events_parent_entity_type_check;
ALTER TABLE activity_events ADD CONSTRAINT activity_events_parent_entity_type_check
  CHECK (parent_entity_type IS NULL OR parent_entity_type IN
         ('deal','lead','vehicle','membership','pay_plan',
          'checklist_item','checklist_template','intake_key',
          'invitation','dispatch_assignment','deal_document',
          'deal_fi_product','tenant_branding','consent','suppression',
          'internal_dnc','conversation','appointment','organization','store'));

COMMENT ON COLUMN appointments.vehicle_stock_number IS
  'Text, not a vehicle id: the assistant books by the stock number lookup_inventory returned, and the record must survive the vehicle being sold.';
