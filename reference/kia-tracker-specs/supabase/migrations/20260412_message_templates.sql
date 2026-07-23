-- Email & SMS Templates with merge field support
-- Run in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS message_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('email','sms')),
  subject     TEXT,
  body        TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'general',
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_message_templates_type
  ON message_templates (type);

CREATE INDEX IF NOT EXISTS idx_message_templates_category
  ON message_templates (category);

-- Seed a few starter templates

INSERT INTO message_templates (name, type, subject, body, category, is_default) VALUES
  (
    'Initial Outreach',
    'email',
    'Your inquiry at Kia Mont-Laurier',
    E'Hi {{first_name}},\n\nThank you for your interest in the {{vehicle_interest}}. My name is {{salesperson_name}} and I''d love to help you find the perfect vehicle.\n\nWould you be available for a quick call or a visit to our showroom this week?\n\nBest regards,\n{{salesperson_name}}\nKia Mont-Laurier',
    'outreach',
    TRUE
  ),
  (
    'Follow-Up — No Response',
    'email',
    'Still interested in the {{vehicle_interest}}?',
    E'Hi {{first_name}},\n\nI reached out a few days ago about the {{vehicle_interest}} and wanted to follow up. We have some great options available right now.\n\nFeel free to reply to this email or call me anytime.\n\nBest,\n{{salesperson_name}}',
    'follow_up',
    FALSE
  ),
  (
    'Quick Intro SMS',
    'sms',
    NULL,
    'Hi {{first_name}}! This is {{salesperson_name}} from Kia Mont-Laurier. I saw your inquiry about the {{vehicle_interest}} — when would be a good time to chat?',
    'outreach',
    TRUE
  ),
  (
    'Appointment Reminder SMS',
    'sms',
    NULL,
    'Hi {{first_name}}, just a reminder about your appointment at Kia Mont-Laurier tomorrow. See you soon! — {{salesperson_name}}',
    'appointment',
    FALSE
  ),
  (
    'Test Drive Invite',
    'email',
    'Come test drive the {{vehicle_interest}}!',
    E'Hi {{first_name}},\n\nThe {{vehicle_interest}} is on our lot and ready for a test drive. Nothing beats getting behind the wheel yourself!\n\nLet me know a time that works for you and I''ll have everything ready.\n\n{{salesperson_name}}\nKia Mont-Laurier',
    'outreach',
    FALSE
  );
