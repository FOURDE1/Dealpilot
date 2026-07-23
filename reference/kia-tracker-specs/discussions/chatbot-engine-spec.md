# Chatbot Engine — Final Specification (Revised)

## Overview

Two-phase chatbot system. Phase 1: SMS text chatbot via Twilio — handles first contact, data collection, qualification, inventory photo sharing, and handoff to F&I. After handoff, chatbot goes silent but continues monitoring the thread, sending live summaries and scoring to the F&I agent. F&I agents reply from the CRM in the same SMS thread. Phase 2: Voice calling bot for outbound first contact and cold lead re-engagement.

---

## Phase 1: Text Chatbot (SMS via Twilio)

### Architecture

```
Client sends SMS
       ↓
  Twilio receives → webhooks to CRM
       ↓
  CRM routes to chatbot engine
       ↓
  Chatbot engine (existing custom code, optimized with Claude)
    → Reads conversation history
    → Determines intent + what data is still needed
    → Generates response
    → Sends via Twilio
       ↓
  All messages stored in conversations table
       ↓
  [After handoff]
  Chatbot goes silent but keeps reading
    → Analyzes F&I ↔ client thread
    → Sends updated summary/scoring to F&I agent in CRM
```

### Existing Chatbot

There is an existing custom-coded chatbot (Node.js/Python service). This spec defines how it integrates with the CRM, what it needs to do, and what the optimization targets are. The existing chatbot code will be loaded into Claude for optimization and refinement.

---

## Language Handling

### Detection + Quebec preference

| Client Location | Behavior |
|---|---|
| Ontario / other provinces | Auto-detect language from first message, respond in that language |
| Quebec | Auto-detect, then ask: "Would you prefer to continue in English or French? / Préférez-vous continuer en anglais ou en français?" |

### Detection method
- Analyze first client message for language
- If message is in French or contains French words → detect as French
- If unclear or single word → default to English, but if Quebec area code (438, 514, 450, 819, 873) → ask preference
- Once language is set, all subsequent messages in that language
- Language preference saved to lead record for F&I agent assignment matching

---

## Conversation Style: Hybrid

Natural, warm, conversational dialogue — but ensures all required fields get collected before handoff. Doesn't feel like a form. Feels like texting a helpful person.

### Example conversation flow

```
BOT: Hey! Thanks for reaching out about getting into a vehicle 🚗
     What kind of vehicle are you looking for?

CLIENT: Looking for an suv something reliable

BOT: Great choice — SUVs are our most popular right now.
     Do you have a budget range in mind for monthly payments?

CLIENT: Hoping around 400 a month

BOT: $400/month is definitely workable. We've got some great options
     in that range. Quick question — do you have a vehicle to trade in?

CLIENT: Ya I have a 2017 civic

BOT: Nice — Civics hold their value well, that'll help.
     And what's your name so I can get things started for you?

CLIENT: John Smith

BOT: Great to meet you John! Let me pull up some options that
     might work for you...

[chatbot searches inventory for SUVs in budget range]
[sends 2-3 vehicle photos via MMS — NO links, NO pricing]

BOT: Here are a couple SUVs we have right now that could fit
     your budget. Our finance team can get you exact numbers.
     Want me to connect you with one of our specialists?

CLIENT: Yeah let's do it

BOT: Perfect! I'm connecting you with Hussein, one of our
     finance specialists — he'll take great care of you.
     He'll be reaching out shortly. Thanks John! 🙌
```

### Rules for conversation
- Never robotic, never "Please provide your..."
- Use casual language, mirror the client's energy
- Emojis sparingly — 1-2 per conversation max
- Short messages (under 160 chars per SMS when possible to avoid splitting)
- Don't ask more than one question per message
- If client gives info unprompted, don't ask for it again
- If client goes off-topic, acknowledge then gently redirect
- Never discuss specific pricing, payments, interest rates, or approval odds in detail
- Light touch on approval: "We work with a wide range of lenders for every credit situation" or "Our finance team is really good at finding options"

---

## Data Collection (Required Fields)

The chatbot must collect these before handoff. It does NOT ask them in order — it weaves them into natural conversation.

| # | Field | Required | How it's collected |
|---|---|---|---|
| 1 | Full name | Yes | "What's your name?" |
| 2 | Vehicle interest | Yes | "What kind of vehicle are you looking for?" |
| 3 | Monthly budget | Yes | "Do you have a budget range in mind?" |
| 4 | Trade-in | Yes (y/n) | "Do you have a vehicle to trade in?" |
| 5 | Trade-in details | If yes | "What are you driving now?" |
| 6 | Timeline | Nice to have | "When are you looking to get into something?" |
| 7 | Email | Nice to have | Collected naturally if client offers, not forced |
| 8 | Language | Auto | Detected from conversation |

**Note:** If the lead came from a Fluent Form, the chatbot already has income, employment, DOB, and address from the form submission. It does NOT re-ask these. It acknowledges the application: "Hey [name], thanks for filling out the application on our site! I see you're looking for [vehicle interest] — let me pull up some options."

---

## Inventory Search & Photo Sharing

### How it works
1. Based on client's vehicle interest and budget, chatbot queries the inventory table
2. Filters by: vehicle_type matches interest, deal_status = "available", store matches
3. Selects 2-3 best matches
4. Sends photos via Twilio MMS (first photo from inventory_photos for each vehicle)
5. Sends as: "Here are a couple options we have right now" — NO pricing, NO links

### What's sent per vehicle
- 1 photo (front angle preferred)
- Vehicle description in the message: "2022 Kia Sportage LX — 35,000 km"
- No price, no payment estimate, no link to listing

### What's NOT sent
- Pricing (that's F&I's negotiation)
- Website links (keeps client in the SMS conversation)
- More than 3 vehicles (overwhelms the client)

---

## Handoff Triggers

Chatbot hands off when **ANY** of these occur:

| Trigger | Detection |
|---|---|
| Client asks to speak to someone | NLP: "can I talk to someone", "speak to a person", "connect me", etc. |
| All required fields collected | System check: name + vehicle interest + budget + trade-in status all filled |
| High buying intent detected | NLP: "I'm ready", "let's do this", "how soon can I get it", "can I come in today" |
| Client asks a question chatbot can't answer | Chatbot confidence below threshold on 2+ consecutive messages |

### Handoff message (warm + professional with agent name)

```
"Perfect! I'm connecting you with [agent first name], one of our
finance specialists — they'll take great care of you and get
you the best deal possible. They'll be reaching out shortly!"
```

---

## Silent Monitoring (Post-Handoff)

### What happens after handoff
1. Chatbot **stops sending messages** to the client
2. F&I agent takes over the SMS thread — sends from the CRM using the same Twilio number
3. Chatbot **continues reading every message** in the thread (both client and agent messages)
4. Chatbot analyzes the ongoing conversation and generates:

### Live intelligence for F&I agent

After each client message, chatbot silently updates an internal panel visible to the F&I agent:

```
🤖 AI ASSISTANT — Live Analysis
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SENTIMENT: Positive — client seems eager
BUYING SIGNALS: "how soon" mentioned 2x, asking about delivery
CONCERNS DETECTED: Worried about credit approval
SUGGESTED RESPONSE: Reassure on lender options, mention flexible terms

UPDATED SUMMARY:
  Client wants a SUV, budget $400/mo
  Has 2017 Civic trade-in
  Timeline: This week
  Mentioned being declined at another dealer
  Seems motivated but nervous about approval

SCORING: 🔥 Hot lead — high conversion probability
```

### What the chatbot analyzes
- Client sentiment (positive, neutral, frustrated, losing interest)
- Buying signals (urgency words, delivery questions, payment questions)
- Concerns or objections (price, credit, trade-in value, timing)
- Suggested responses (what the agent should say next)
- Updated qualification scoring based on new info revealed during F&I conversation

---

## F&I Agent SMS from CRM

### In-app messaging
F&I agents send SMS to clients directly from the CRM:
- Type message in the deal/lead detail view
- Message sends from the **same Twilio number** the chatbot used (seamless to client)
- Full conversation history visible (chatbot messages + agent messages + client messages)
- Agent sees the AI assistant panel alongside the conversation

### UI: Conversation View (within Lead/Deal Detail)

```
Conversation with John Smith          📱 613-555-0172
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  🤖 Hey! Thanks for reaching out...         10:00 AM
  👤 Looking for an suv something reliable    10:02 AM
  🤖 Great choice — SUVs are our most...     10:02 AM
  👤 Hoping around 400 a month               10:03 AM
  🤖 $400/month is definitely workable...    10:03 AM
  ...
  🤖 I'm connecting you with Hussein...      10:08 AM
  ── HANDOFF ──────────────────────────────────────
  👨‍💼 Hey John! Hussein here. I've got your    10:12 AM
     info and I'm already looking at some
     great options for you...
  👤 Awesome thanks man                       10:13 AM
  👨‍💼 Quick question — on your Civic, do       10:14 AM
     you still owe anything on it?

  [Type a message...                        ] [Send]

  ┌─── 🤖 AI Assistant ─────────────────────────┐
  │ SENTIMENT: Positive — responsive, engaged    │
  │ CLIENT just revealed: trade-in may have lien │
  │ SUGGEST: Ask payoff amount, affects deal     │
  │ structure significantly                      │
  └──────────────────────────────────────────────┘
```

---

## Outside Business Hours

### Schedule-aware behavior

| Scenario | Chatbot behavior |
|---|---|
| **Late night / early morning** (after hours on weekday) | Fully engage, collect all data, but instead of handoff say: "Our finance team is done for the day, but I've got everything ready for them. [Agent name] will reach out to you first thing tomorrow morning!" |
| **Saturday during business hours** | Normal operation — engage, collect, handoff as usual |
| **Saturday after business hours** | Engage and collect, but set expectation: "Our team is off for the weekend — [Agent name] will reach out Monday morning. You're all set!" |
| **Sunday** | Engage and collect, set Monday expectation |
| **Holidays** | Acknowledge: "We're closed for [holiday] today but I've got your info ready. Our team will reach out on the next business day!" Queue for next business day. |

### Business hours configuration
Per-store setting in the stores table:

```sql
ALTER TABLE stores ADD COLUMN business_hours JSONB DEFAULT '{
  "monday":    {"open": "09:00", "close": "20:00"},
  "tuesday":   {"open": "09:00", "close": "20:00"},
  "wednesday": {"open": "09:00", "close": "20:00"},
  "thursday":  {"open": "09:00", "close": "20:00"},
  "friday":    {"open": "09:00", "close": "20:00"},
  "saturday":  {"open": "09:00", "close": "17:00"},
  "sunday":    null,
  "holidays":  []
}';
```

---

## Phase 2: Voice Calling Bot (Future)

### Platform
Whatever integrates best with the existing SMS chatbot and Twilio infrastructure. Evaluate at build time: Bland AI, Vapi, or Retell.

### Use cases (in priority order)

| # | Use Case | When | Goal |
|---|---|---|---|
| 1 | **First contact — outbound call** | New lead comes in → voice bot calls immediately | Faster engagement than SMS, higher pickup rate |
| 2 | **Cold lead re-engagement** | Lead engaged via SMS but went cold (no reply 24h+) | Re-establish contact via different channel |
| 3 | **Unresponsive follow-up** | After 3 failed SMS attempts (part of drip) | Last attempt before marking unresponsive |

### Voice bot script
- Same data collection goals as text chatbot
- Same handoff triggers
- Records call → transcript stored in conversations table
- If client answers: qualify and hand off to F&I
- If voicemail: leave a brief message, follow up via SMS

### Integration with text chatbot
- Voice and text share the same conversation record per lead
- If voice bot calls and client doesn't answer, SMS bot sends a follow-up text
- If client already engaged via SMS, voice bot has context from that conversation
- F&I agent sees both SMS and call transcripts in the same CRM conversation view

---

## Drip Sequences

### Post-Delivery Drip (already defined in Delivery Tracker spec)

| Timing | Message | Purpose |
|---|---|---|
| Day 1 (next business day) | Thank you + enjoy your vehicle | Goodwill |
| Day 7 | How's the new car? Any questions? | Satisfaction check |
| Day 30 | Service reminder — first oil change | Revenue |
| Day 90 | Referral ask — know anyone looking? | Referrals |
| Day 180 | Trade-up check — ready for an upgrade? | Re-engage |
| Ongoing | Seasonal promotions, service specials | Revenue |

### Lost Lead Re-Engagement Drip

| Lost Reason | Drip Strategy | Duration |
|---|---|---|
| Couldn't get approved | Re-engage when new lender programs available | 6 months |
| Payment too high | Notify when similar vehicle at lower price in inventory | 3 months |
| Ghosted / unresponsive | Gentle check-ins at 7, 14, 30 days, then monthly | 90 days then expire |
| Went to another dealer | "Still happy?" at 30, 90 days | 90 days |
| Changed their mind | Check in at 30, 60 days | 90 days then expire |

### Drip rules
- Client can opt out at any time (reply STOP → auto opt-out, legally required)
- If client responds positively during drip → reactivate lead, re-enter assignment flow
- If client starts a new deal → drip stops automatically
- Drip messages sent via same Twilio number as original conversation
- All drip messages logged in conversation history

---

## Database

### Table: `conversations`

```sql
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id), -- linked after conversion
  store_id UUID REFERENCES stores(id) NOT NULL,
  channel TEXT DEFAULT 'sms', -- 'sms', 'voice', 'web_chat'
  twilio_number TEXT, -- the Twilio number used for this conversation
  client_phone TEXT NOT NULL,
  status TEXT DEFAULT 'chatbot_active',
  -- 'chatbot_active', 'handed_off', 'agent_active', 'drip_active', 'closed'
  chatbot_handoff_at TIMESTAMPTZ,
  assigned_agent_id UUID REFERENCES users(id),
  language TEXT DEFAULT 'en',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_conv_lead ON conversations(lead_id);
CREATE INDEX idx_conv_deal ON conversations(deal_id);
CREATE INDEX idx_conv_phone ON conversations(client_phone);
```

### Table: `messages`

```sql
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL, -- 'client', 'chatbot', 'agent', 'system', 'drip'
  sender_id UUID, -- user ID if agent, null for chatbot/client
  content TEXT NOT NULL,
  media_urls TEXT[], -- MMS image URLs (vehicle photos, etc.)
  channel TEXT DEFAULT 'sms', -- 'sms', 'voice_transcript', 'web_chat'
  twilio_sid TEXT, -- Twilio message SID for tracking
  delivered BOOLEAN DEFAULT false,
  delivered_at TIMESTAMPTZ,
  read_by_agent BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_msg_conv ON messages(conversation_id);
CREATE INDEX idx_msg_created ON messages(created_at);
```

### Table: `chatbot_analysis`

```sql
CREATE TABLE chatbot_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id),
  analysis_type TEXT NOT NULL, -- 'handoff_summary', 'live_update', 'scoring'
  sentiment TEXT, -- 'positive', 'neutral', 'frustrated', 'losing_interest'
  buying_signals TEXT[],
  concerns TEXT[],
  suggested_response TEXT,
  summary TEXT, -- updated qualification summary
  score TEXT, -- 'hot', 'warm', 'cold'
  score_reason TEXT, -- why this score
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_analysis_conv ON chatbot_analysis(conversation_id);
```

### Table: `drip_sequences`

```sql
CREATE TABLE drip_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id),
  name TEXT NOT NULL, -- 'post_delivery', 'lost_couldnt_approve', 'lost_ghosted', etc.
  trigger_event TEXT NOT NULL, -- 'delivery.completed', 'deal.lost', 'lead.unresponsive'
  trigger_condition JSONB, -- e.g., {"lost_reason": "ghosted"}
  steps JSONB NOT NULL,
  -- [{day: 1, message_template: "...", channel: "sms"},
  --  {day: 7, message_template: "...", channel: "sms"}]
  duration_days INTEGER, -- how long the drip runs before expiring
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Table: `drip_enrollments`

```sql
CREATE TABLE drip_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drip_sequence_id UUID REFERENCES drip_sequences(id),
  lead_id UUID REFERENCES leads(id),
  deal_id UUID REFERENCES deals(id), -- for post-delivery drips
  conversation_id UUID REFERENCES conversations(id),
  status TEXT DEFAULT 'active', -- 'active', 'paused', 'completed', 'opted_out', 'expired', 'reactivated'
  current_step INTEGER DEFAULT 0,
  enrolled_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  last_message_sent_at TIMESTAMPTZ,
  opted_out_at TIMESTAMPTZ,
  reactivated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_drip_status ON drip_enrollments(status);
```

### Add to `stores` table

```sql
ALTER TABLE stores ADD COLUMN business_hours JSONB;
ALTER TABLE stores ADD COLUMN holiday_dates DATE[] DEFAULT '{}';
```

---

## API Endpoints

```
# Chatbot — inbound
POST   /api/chatbot/webhook/twilio-inbound  — Twilio SMS webhook (incoming client messages)
POST   /api/chatbot/webhook/twilio-status   — Twilio delivery status callbacks

# Chatbot — outbound
POST   /api/chatbot/send/:leadId            — Chatbot sends a message to a lead
POST   /api/chatbot/engage/:leadId          — Trigger chatbot to start engaging a new lead

# Agent messaging
POST   /api/messages/send                   — Agent sends SMS from CRM (same Twilio number)
GET    /api/conversations/:id               — Full conversation history
GET    /api/conversations/:id/messages       — Paginated messages
GET    /api/leads/:id/conversation           — Get conversation for a lead

# Handoff
POST   /api/chatbot/handoff/:leadId          — Trigger handoff (manual or auto)
GET    /api/chatbot/analysis/:conversationId — Get latest AI analysis for a conversation

# Drip sequences
GET    /api/drips                            — List all drip sequences
POST   /api/drips                            — Create drip sequence
PUT    /api/drips/:id                        — Update drip sequence
POST   /api/drips/:id/enroll                 — Manually enroll a lead/deal in a drip
PUT    /api/drip-enrollments/:id/pause       — Pause drip
PUT    /api/drip-enrollments/:id/resume      — Resume drip
PUT    /api/drip-enrollments/:id/opt-out     — Opt out (STOP received)
GET    /api/leads/:id/drip-status             — Current drip status for a lead

# Inventory search (for chatbot)
GET    /api/chatbot/inventory-search          — Search available vehicles matching criteria, returns photos

# Voice (Phase 2)
POST   /api/voice/call/:leadId               — Initiate outbound voice call
GET    /api/voice/transcript/:callId          — Get call transcript
```

---

## UI Specification

### Conversation View (within Lead/Deal Detail)

Full SMS thread with AI assistant panel alongside:

```
┌─────────────────────────────────────┬──────────────────────────┐
│                                     │ 🤖 AI ASSISTANT          │
│ Conversation with John Smith        │                          │
│ 📱 613-555-0172                     │ SENTIMENT: Positive      │
│                                     │                          │
│ 🤖 Hey! Thanks for reaching...     │ BUYING SIGNALS:          │
│ 👤 Looking for an suv              │ • "how soon" × 2         │
│ 🤖 Great choice...                 │ • Asked about delivery   │
│ 👤 Hoping around 400               │                          │
│ 🤖 [📸 2022 Kia Sportage]         │ CONCERNS:                │
│ 🤖 [📸 2021 Hyundai Tucson]       │ • Worried about credit   │
│ 🤖 Connecting you with Hussein..   │ • Declined elsewhere     │
│ ── HANDOFF ────────────────────     │                          │
│ 👨‍💼 Hey John! Hussein here...       │ SUGGEST:                 │
│ 👤 Awesome thanks man               │ Reassure on lender       │
│ 👨‍💼 Quick question about your       │ options, mention we work  │
│    Civic — do you still owe?        │ with 20+ lenders         │
│ 👤 Yeah about 8k left              │                          │
│                                     │ SCORE: 🔥 Hot           │
│                                     │ High conversion          │
│ [Type a message...          ] [📤] │ probability              │
│                                     │                          │
└─────────────────────────────────────┴──────────────────────────┘
```

### Drip Manager (Settings)

```
Drip Sequences                                    [+ New Drip]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ✅ Post-Delivery Follow-Up           6 steps    Active
     Trigger: delivery.completed       Duration: Ongoing

  ✅ Lost — Couldn't Get Approved      4 steps    Active
     Trigger: deal.lost (reason: approval)  Duration: 6 months

  ✅ Lost — Ghosted / Unresponsive     5 steps    Active
     Trigger: lead.unresponsive         Duration: 90 days

  ✅ Lost — Went to Another Dealer     3 steps    Active
     Trigger: deal.lost (reason: competitor)  Duration: 90 days

  Click row to edit steps, timing, and message templates
```

### Drip Step Editor

```
Edit: Post-Delivery Follow-Up
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Step 1 — Day 1 (next business day)
    Channel: SMS
    Template: "Hi {{first_name}}! Thanks for choosing us for
    your new {{vehicle}}. If you have any questions at all,
    don't hesitate to reach out. Enjoy the ride! 🚗"

  Step 2 — Day 7
    Channel: SMS
    Template: "Hey {{first_name}}! How's the {{vehicle}} treating
    you? Everything going well? Let us know if you need anything."

  [+ Add Step]

  Variables available: {{first_name}}, {{last_name}}, {{vehicle}},
  {{salesperson}}, {{store_name}}, {{store_phone}}
```

### Chatbot Settings (GM/Owner)

```
Chatbot Configuration — Kia Mont-Laurier
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Status: ✅ Active

  Business Hours: [Edit Schedule]
  Holiday Dates: [Manage Holidays]

  Conversation Style:
    Tone: Friendly, casual, helpful
    Max messages before handoff: 15
    Photo limit per conversation: 3 vehicles

  Data Collection Requirements:
    ☑ Full name (required)
    ☑ Vehicle interest (required)
    ☑ Monthly budget (required)
    ☑ Trade-in yes/no (required)
    ☐ Email (nice to have)
    ☐ Timeline (nice to have)

  Handoff Settings:
    ☑ Hand off when all required fields collected
    ☑ Hand off when client asks for a person
    ☑ Hand off on high buying intent
    ☑ Hand off when chatbot can't answer 2+ questions

  [Save Settings]
```

---

## Prompt to Build This

```
Build the Chatbot Engine for the Kia Deal Tracker.

This is the most complex module. It integrates with Twilio for SMS, the inventory system for vehicle photos, the lead assignment system for handoff, and provides real-time AI analysis to F&I agents.

DATABASE:
1. Create conversations table: [paste SQL above]
2. Create messages table: [paste SQL above]
3. Create chatbot_analysis table: [paste SQL above]
4. Create drip_sequences table: [paste SQL above]
5. Create drip_enrollments table: [paste SQL above]
6. Add business_hours and holiday_dates to stores table

BACKEND:

1. Create server/services/chatbot.js:
   - Core chatbot engine
   - Takes incoming message + conversation history
   - Uses AI (existing custom code, optimized) to:
     a. Understand client intent
     b. Determine what data fields still need collecting
     c. Generate a natural, conversational response
     d. Extract structured data from client messages → update lead record
   - Checks handoff triggers after each message:
     - All required fields collected?
     - Client asked for a person?
     - High buying intent detected?
     - Chatbot can't answer 2+ consecutive questions?
   - If handoff triggered: call lead assignment service, send handoff message with agent name

2. Create server/services/chatbotMonitor.js:
   - Runs AFTER handoff when chatbot is silent
   - On each new message in a handed-off conversation:
     a. Analyzes sentiment (positive/neutral/frustrated/losing_interest)
     b. Detects buying signals and concerns
     c. Generates suggested response for the agent
     d. Updates qualification summary and score (hot/warm/cold)
     e. Saves to chatbot_analysis table
   - F&I agent sees this in real-time via Supabase subscription

3. Create server/services/inventorySearch.js:
   - Function: searchForClient(vehicleInterest, budget, storeId)
   - Queries inventory: available units matching type/budget
   - Returns top 3 matches with first photo URL for MMS
   - Photos sent via Twilio MMS (image URLs from Supabase Storage)

4. Create server/routes/chatbot.js:
   - POST /webhook/twilio-inbound: receives SMS from Twilio
     - Finds or creates conversation by phone number
     - If conversation status = "chatbot_active": route to chatbot engine
     - If "handed_off" or "agent_active": route to monitor + notify agent of new message
     - If "drip_active" and client replies: reactivate lead, re-enter assignment
     - If client sends "STOP": auto opt-out from drip, legally required
   - POST /webhook/twilio-status: delivery confirmations
   - POST /chatbot/engage/:leadId: start chatbot on a new lead
   - POST /chatbot/handoff/:leadId: manual handoff trigger

5. Create server/routes/messages.js:
   - POST /api/messages/send: agent sends SMS from CRM
     - Uses same Twilio number as chatbot conversation
     - Saves to messages table with sender_type = "agent"
     - Triggers chatbot monitor analysis on the response
   - GET /api/conversations/:id/messages: paginated message history

6. Create server/services/languageDetector.js:
   - Analyzes first client message for language
   - Checks area code for Quebec (438, 514, 450, 819, 873)
   - If Quebec: ask language preference
   - Returns detected language for conversation + lead record

7. Create server/services/businessHours.js:
   - Function: isBusinessHours(storeId) — checks store's business_hours config
   - Function: getNextBusinessDay(storeId) — returns next open day/time
   - Used by chatbot to adjust messaging and set callback expectations

8. Create server/services/dripEngine.js:
   - Scheduled job (runs every hour):
     - Check all active drip enrollments
     - For each: is it time to send the next step? (based on enrolled_at + step.day)
     - If yes: send the message via Twilio, advance current_step
     - If all steps complete: mark as "completed"
     - If expired: mark as "expired"
   - Handle opt-outs: "STOP" → immediate opt-out, no more messages
   - Handle reactivation: client replies → pause drip, reactivate lead

9. Create server/routes/drips.js:
   - CRUD for drip sequences
   - Enrollment endpoints: enroll, pause, resume, opt-out
   - Seed default drip sequences (post-delivery, lost reasons)

FRONTEND:

1. Create ConversationView.jsx:
   - Full SMS thread: chatbot messages, client messages, agent messages
   - Handoff divider line
   - Media display (MMS photos inline)
   - Message input at bottom (sends via agent SMS endpoint)
   - AI assistant panel alongside (sentiment, signals, concerns, suggestions, score)
   - Real-time updates via Supabase subscription on messages table

2. Integrate ConversationView into LeadDetail.jsx and DealDetail.jsx

3. Create DripManager.jsx (settings):
   - List all drip sequences with enable/disable toggle
   - Click to edit: steps, timing, message templates
   - Template variables: {{first_name}}, {{last_name}}, {{vehicle}}, {{salesperson}}, {{store_name}}, {{store_phone}}
   - Add/remove steps with day offset and message content

4. Create ChatbotSettings.jsx (settings, GM/owner):
   - Business hours editor per day
   - Holiday date manager
   - Data collection requirements toggles
   - Handoff trigger toggles
   - Conversation style settings

5. Add conversation indicators to lead/deal cards:
   - Icon showing: chatbot active / handed off / agent active
   - Unread message count badge
   - Last message preview

Environment variables:
- TWILIO_ACCOUNT_SID
- TWILIO_AUTH_TOKEN
- TWILIO_PHONE_NUMBER (or per-store from stores table)
- AI_API_KEY (for chatbot intelligence, if using external API)
```
