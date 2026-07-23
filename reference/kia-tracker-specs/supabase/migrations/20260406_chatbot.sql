-- ============================================
-- CHATBOT ENGINE — Conversations + Messages
-- Advanced Module Story A-002
-- ============================================

-- 1. Conversations table
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  store_id UUID REFERENCES stores(id),
  channel TEXT NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms', 'web', 'whatsapp')),
  phone_number TEXT, -- client's phone
  twilio_sid TEXT, -- Twilio conversation SID
  status TEXT NOT NULL DEFAULT 'bot_active' CHECK (status IN ('bot_active', 'handed_off', 'agent_active', 'closed')),
  language TEXT DEFAULT 'en',
  assigned_agent_id UUID REFERENCES users(id),
  handed_off_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  bot_summary TEXT, -- chatbot's summary at handoff
  bot_score INTEGER, -- chatbot's lead score at handoff
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER conversations_updated_at
  BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 2. Messages table
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('client', 'bot', 'agent')),
  sender_id UUID REFERENCES users(id), -- null for client and bot
  body TEXT NOT NULL,
  media_url TEXT, -- for MMS/image messages
  twilio_sid TEXT, -- Twilio message SID
  metadata JSONB, -- intent detection, sentiment, etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Indexes
CREATE INDEX idx_conversations_lead ON conversations(lead_id);
CREATE INDEX idx_conversations_contact ON conversations(contact_id);
CREATE INDEX idx_conversations_store ON conversations(store_id);
CREATE INDEX idx_conversations_status ON conversations(status);
CREATE INDEX idx_conversations_agent ON conversations(assigned_agent_id);
CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_messages_created ON messages(created_at);

-- 4. RLS
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Conversations viewable" ON conversations FOR SELECT USING (true);
CREATE POLICY "Conversations insertable" ON conversations FOR INSERT WITH CHECK (true);
CREATE POLICY "Conversations updatable" ON conversations FOR UPDATE USING (true);

CREATE POLICY "Messages viewable" ON messages FOR SELECT USING (true);
CREATE POLICY "Messages insertable" ON messages FOR INSERT WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
