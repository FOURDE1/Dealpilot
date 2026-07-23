# Remaining Modules — Final Specifications

This file contains the final specs for the 6 remaining modules.

---

# MODULE: Driver Dispatch Upgrade

## What changes from current build

Current system has: fleet management (chasers + dealer plates), auto-assign with conflict detection, status tracking. This upgrade adds: driver companies, auto-email, and status tracking.

## Driver Companies

Multiple companies available — dispatchers choose per run.

### Database: `driver_companies`

```sql
CREATE TABLE driver_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id), -- null = available to all stores
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  contact_name TEXT,
  service_area TEXT, -- geographic coverage description
  rate_info TEXT, -- pricing notes (flat rate, per km, etc.)
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Modify existing dispatch table

```sql
ALTER TABLE dispatch ADD COLUMN driver_company_id UUID REFERENCES driver_companies(id);
ALTER TABLE dispatch ADD COLUMN dispatch_type TEXT DEFAULT 'delivery'; -- 'delivery', 'pickup', 'transfer'
ALTER TABLE dispatch ADD COLUMN pickup_address TEXT;
ALTER TABLE dispatch ADD COLUMN delivery_address TEXT;
ALTER TABLE dispatch ADD COLUMN has_trade_in BOOLEAN DEFAULT false;
ALTER TABLE dispatch ADD COLUMN drivers_needed INTEGER DEFAULT 1;
ALTER TABLE dispatch ADD COLUMN email_sent BOOLEAN DEFAULT false;
ALTER TABLE dispatch ADD COLUMN email_sent_at TIMESTAMPTZ;
ALTER TABLE dispatch ADD COLUMN wet_ink_file_ready BOOLEAN DEFAULT false;
ALTER TABLE dispatch ADD COLUMN cash_to_collect NUMERIC;
ALTER TABLE dispatch ADD COLUMN special_instructions TEXT;
ALTER TABLE dispatch ADD COLUMN eta TEXT; -- driver-provided ETA
ALTER TABLE dispatch ADD COLUMN status_updates JSONB DEFAULT '[]'; -- [{status, timestamp, note}]
```

### Auto-email on dispatch booking
When dispatch is booked, auto-send email to driver company via Resend:

**Subject:** `Driver Request — {{year}} {{make}} {{model}} — {{delivery_date}}`

**Body includes:** Pickup address, delivery address, vehicle details (year/make/model/color/stock#), number of drivers needed (2 if no trade-in, 1 if trade-in), trade-in details if applicable, cash to collect, wet ink file status, delivery date/time, special instructions.

### Auto-calculate drivers needed
- `has_trade_in = false` → `drivers_needed = 2` (delivery car + chaser)
- `has_trade_in = true` → `drivers_needed = 1` (delivers car, drives trade-in back)

### Status tracking (simple for now, GPS future)

```
Booked → Confirmed → Picked Up → En Route → Delivered
```

Each status update recorded with timestamp in status_updates JSONB array.

### Prompt to build

```
Upgrade the existing Dispatch system in the Kia Deal Tracker.

DATABASE: Create driver_companies table and add new columns to dispatch table [paste SQL above]

BACKEND:
- CRUD for driver_companies
- Update dispatch routes: auto-email on booking via Resend, auto-calculate drivers_needed
- Add status update endpoint: POST /api/dispatch/:id/status-update (appends to status_updates array)
- Validate: dispatch cannot be booked if deal's wet_ink_file_status is not "prepared" or later

FRONTEND:
- Add driver company selector to dispatch form (dropdown from driver_companies)
- Show email status (sent/not sent) on dispatch cards
- "Resend Email" button
- Show drivers needed with explanation
- Status timeline showing all updates
- Create DriverCompanyManager.jsx for settings

Add EN/FR translations.
```

---

# MODULE: Funding Tracker

## Overview

Tracks a deal from bank submission through to funding confirmation. F&I agent submits the funding package. Confirmation comes via bank portal check or bank email.

## Funding Workflow

```
Not Submitted → Preparing → Submitted → In Review → Stips Required → Funded
                                                          ↓
                                                    (stips fulfilled)
                                                     → Funded
```

## Stipulations

Common stips banks require post-signing:

| Stip | Description |
|---|---|
| Proof of income | Pay stubs, NOA, bank statements |
| Proof of address | Utility bill, bank statement |
| Proof of insurance | Insurance binder/policy |
| Additional references | Personal or employment references |
| Co-signer required | Additional signer needed |
| Larger down payment | Bank requires more money down |
| Vehicle inspection | Bank wants safety or appraisal |
| Updated credit bureau | Bank needs fresh pull |

Each stip tracked individually: name, status (pending/submitted/accepted/waived), file upload, notes.

## Database: `funding_records`

```sql
CREATE TABLE funding_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  lender_submission_id UUID REFERENCES lender_submissions(id),

  -- Status
  status TEXT DEFAULT 'not_submitted', -- 'not_submitted', 'preparing', 'submitted', 'in_review', 'stips_required', 'funded'
  submitted_at TIMESTAMPTZ,
  submitted_by UUID REFERENCES users(id), -- F&I agent

  -- Stipulations
  stips JSONB DEFAULT '[]', -- [{name, status, file_url, notes, submitted_at, accepted_at}]

  -- Funding confirmation
  funded_at TIMESTAMPTZ,
  funded_amount NUMERIC,
  funding_number TEXT, -- bank reference number
  funding_confirmed_by UUID REFERENCES users(id),
  confirmation_method TEXT, -- 'portal', 'email', 'phone'

  -- Meta
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Business Logic

- One funding record per deal (linked to the selected lender submission)
- When status → "funded": auto-update deal's funding_status to "funded", auto-update delivery checklist
- Funding aging: submitted > 7 days with no update → MEDIUM alert to F&I + GM
- Stips: each stip has independent status. When all stips are accepted/waived → status can move to funded

## Prompt to build

```
Build the Funding Tracker module.

DATABASE: Create funding_records table [paste SQL above]

BACKEND:
- CRUD at /api/deals/:id/funding
- PUT /api/funding/:id/stips — update individual stip statuses
- When status changes to "funded": update deal.funding_status, delivery_checklist.funding_status, fire deal.funded notification
- Funding aging check in daily scheduled job (already in notifications spec)

FRONTEND:
- FundingSection.jsx within DealDetail: step indicator (not_submitted → funded), stips list with individual status toggles and file uploads, funding confirmation form
- Aging indicator: green < 3 days, amber 3-7, red > 7 since submission

Add EN/FR translations.
```

---

# MODULE: Lead Manager

## Overview

Ingests leads from landing page forms and Meta lead forms. Chatbot is first responder. After chatbot collects data and qualifies, leads are assigned to F&I agents based on language preference and availability (online status + schedule). Sales manager notified on new leads. Escalation if lead goes unanswered past threshold.

## Lead Sources

| Source | How it enters |
|---|---|
| Landing page forms | Webhook from website form submission |
| Facebook/Meta lead forms | Webhook from Meta Lead Ads API |
| Manual entry | Staff enters from phone call or walk-in |
| Chatbot transfer | Chatbot qualifies and hands off |

## Lead Assignment Flow

```
Lead enters system
       ↓
  Chatbot engages immediately (auto)
       ↓
  Chatbot collects: name, phone, email, vehicle interest, budget, trade-in, timeline, language
       ↓
  Chatbot qualifies lead and creates summary
       ↓
  System assigns to F&I agent based on:
    1. Language preference (EN→EN agents, FR→FR agents, bilingual→either)
    2. Availability: who is online RIGHT NOW (check online status)
    3. Schedule: who is scheduled to work today (from CRM schedule)
    4. Load balancing: who has the fewest active leads
       ↓
  Sales manager notified of new lead + assignment
       ↓
  If lead goes unanswered past threshold → escalate to next available agent + alert sales manager
```

## Staff Scheduling & Availability

### Database: `staff_schedules`

```sql
CREATE TABLE staff_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL, -- 0=Sunday, 6=Saturday
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Database: `user_availability`

```sql
-- Track online status (updated by heartbeat)
ALTER TABLE users ADD COLUMN is_online BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN last_seen_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN preferred_languages TEXT[] DEFAULT '{"en"}'; -- ['en'], ['fr'], ['en', 'fr']
ALTER TABLE users ADD COLUMN max_active_leads INTEGER DEFAULT 10; -- load balancing cap
```

### Online detection
- Frontend sends a heartbeat every 60 seconds: PUT /api/users/heartbeat
- If no heartbeat for 3 minutes → user marked offline
- Online status visible in lead assignment and team views

## Database: `leads`

```sql
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id) NOT NULL,

  -- Source tracking
  source TEXT NOT NULL, -- 'landing_page', 'meta_lead_form', 'manual', 'chatbot'
  source_campaign TEXT, -- ad campaign name
  source_medium TEXT, -- cpc, social, organic
  source_url TEXT, -- landing page URL
  source_form_data JSONB, -- raw form/webhook payload for reference

  -- Client info
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT NOT NULL,
  preferred_language TEXT DEFAULT 'en', -- 'en', 'fr'
  preferred_contact TEXT DEFAULT 'text', -- 'text', 'call', 'email'

  -- Qualification
  vehicle_interest TEXT,
  budget_range TEXT,
  has_trade_in BOOLEAN DEFAULT false,
  trade_in_details TEXT,
  timeline TEXT, -- 'immediate', 'this_week', 'this_month', 'browsing'
  credit_situation TEXT, -- 'excellent', 'good', 'fair', 'poor', 'unknown'

  -- Chatbot
  chatbot_engaged BOOLEAN DEFAULT false,
  chatbot_summary TEXT, -- handoff notes from chatbot
  chatbot_engaged_at TIMESTAMPTZ,
  chatbot_handoff_at TIMESTAMPTZ,

  -- Assignment
  status TEXT DEFAULT 'new', -- 'new', 'chatbot_engaged', 'assigned', 'contacted', 'qualified', 'converted', 'lost'
  assigned_to UUID REFERENCES users(id),
  assigned_at TIMESTAMPTZ,
  assignment_method TEXT, -- 'auto_language', 'auto_availability', 'manual', 'escalation'

  -- Conversion
  converted_deal_id UUID REFERENCES deals(id),
  converted_at TIMESTAMPTZ,

  -- Lost
  lost_reason TEXT,
  lost_at TIMESTAMPTZ,
  nurture_drip_status TEXT DEFAULT 'none', -- 'none', 'active', 'paused', 'opted_out'

  -- Contact tracking
  first_contacted_at TIMESTAMPTZ,
  last_contacted_at TIMESTAMPTZ,
  contact_attempts INTEGER DEFAULT 0,

  -- Duplicate detection
  is_duplicate BOOLEAN DEFAULT false,
  duplicate_of UUID REFERENCES leads(id),

  -- Meta
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_leads_store ON leads(store_id);
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_assigned ON leads(assigned_to);
CREATE INDEX idx_leads_phone ON leads(phone);
```

## Duplicate Detection

- On lead creation: check if phone number already exists in leads table
- If match found: flag as duplicate, link to original lead
- Admin can merge or dismiss duplicates

## Lead Aging

| Age | Color | Meaning |
|---|---|---|
| < 5 minutes | Green | Fresh — chatbot is engaging |
| 5–15 minutes | Amber | Chatbot should have handed off by now |
| > 15 minutes unassigned | Red | Escalation — alert sales manager |

## API Endpoints

```
GET    /api/leads                     — List leads (filters: source, status, assigned_to, date range, store)
GET    /api/leads/:id                 — Single lead
POST   /api/leads                     — Create lead (manual)
PUT    /api/leads/:id                 — Update lead
POST   /api/leads/webhook/landing     — Webhook for landing page form submissions
POST   /api/leads/webhook/meta        — Webhook for Meta lead form submissions
POST   /api/leads/:id/assign          — Assign to agent (manual or auto)
POST   /api/leads/:id/convert         — Convert to deal (creates deal, links lead)
GET    /api/leads/stats               — Lead stats: by source, conversion rate, avg response time
GET    /api/leads/duplicates          — List flagged duplicates
POST   /api/leads/:id/merge           — Merge duplicate into original
PUT    /api/users/heartbeat           — Online status heartbeat
GET    /api/users/available           — List currently available agents (online + scheduled + under cap)
```

## Prompt to build

```
Build the Lead Manager module.

DATABASE: Create leads table, staff_schedules table, add user columns [paste SQL above]

BACKEND:
- CRUD for leads with store scoping
- Webhook endpoints for landing page + Meta lead forms: normalize payload into lead schema, check for duplicates on phone, auto-assign via language → availability → schedule → load balancing
- Auto-assignment service: finds best available agent based on language match, online status, schedule, active lead count
- Heartbeat endpoint: updates user's is_online and last_seen_at. Cron marks users offline after 3 min no heartbeat.
- Convert endpoint: creates deal pre-filled from lead data, marks lead as converted
- Duplicate detection on phone number match
- Lead stats endpoint: count by source, conversion rate, avg time to first contact

FRONTEND:
- LeadsDashboard.jsx: stats bar (new today, by source, conversion rate) + filter bar + lead list
- LeadCard.jsx: name, source badge, status, vehicle interest, age with color coding
- LeadDetail.jsx: slide-out panel with all info, chatbot summary, convert button, assignment info
- Schedule manager in settings for staff work schedules
- Online status indicator on team views

Add route: /leads. Add "Leads" to sidebar. Add EN/FR translations.
```

---

# MODULE: Wholesale Manager

## Overview

Manages aging inventory flagged for wholesale disposal. Tracks listings on TradeRev, ACV Auctions, EBlock, and direct-to-dealer sales.

## Wholesale Platforms

| Platform | Type |
|---|---|
| TradeRev | Online auction |
| ACV Auctions | Online auction |
| EBlock | Online auction |
| Direct to dealers | Negotiated sale |

## Wholesale Workflow

```
Vehicle flagged for wholesale (manual or auto at 30+ days)
       ↓
  Listed on platform(s)
       ↓
  Offers received / bids tracked
       ↓
  Offer accepted → sold
       ↓
  Vehicle marked as wholesaled in inventory
```

## Auto-flag Rules
- Vehicle hits 30 days in stock → notification to wholesale manager + GM
- Vehicle hits 60 days → auto-flagged for wholesale review (wholesale manager must act)
- GM can manually flag any vehicle at any time

## Database: `wholesale_listings`

```sql
CREATE TABLE wholesale_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id UUID REFERENCES inventory(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id) NOT NULL,

  -- Flagging
  flagged_at TIMESTAMPTZ DEFAULT NOW(),
  flagged_by UUID REFERENCES users(id),
  flag_reason TEXT, -- 'aging', 'overstock', 'damage', 'low_demand', 'manual'

  -- Status
  status TEXT DEFAULT 'flagged', -- 'flagged', 'listed', 'offer_received', 'sold', 'cancelled'

  -- Listing
  platform TEXT, -- 'traderev', 'acv', 'eblock', 'direct'
  listing_date DATE,
  listing_url TEXT,
  asking_price NUMERIC,

  -- Offers
  offers JSONB DEFAULT '[]', -- [{buyer, amount, date, platform, status: 'pending'|'accepted'|'declined', notes}]
  best_offer NUMERIC, -- auto-calculated highest offer

  -- Sale
  sold_to TEXT,
  sold_amount NUMERIC,
  sold_at TIMESTAMPTZ,
  sold_platform TEXT,

  -- Financials
  total_invested NUMERIC, -- copied from inventory at time of flagging
  wholesale_loss NUMERIC, -- total_invested - sold_amount (if sold below cost)

  -- Meta
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Business Logic

- When sold: update inventory.deal_status to "wholesale", record sale details
- Track profit/loss: total_invested vs sold_amount
- One vehicle can be listed on multiple platforms simultaneously
- Wholesale loss rolls into reporting

## Prompt to build

```
Build the Wholesale Manager module.

DATABASE: Create wholesale_listings table [paste SQL above]

BACKEND:
- CRUD at /api/wholesale
- POST /api/inventory/:id/flag-wholesale — creates listing record, fires notification
- PUT /api/wholesale/:id/sell — records sale, updates inventory.deal_status to "wholesale"
- Auto-flag in daily scheduled job: vehicles > 60 days auto-flagged if not already
- GET /api/wholesale/stats — total flagged, listed, sold this month, total wholesale loss

FRONTEND:
- WholesaleDashboard.jsx: table of all flagged/listed units sorted by days in stock
  - Columns: vehicle, days, total invested, asking, best offer, platform, status
  - Row colors: amber > 45 days, red > 60 days
- WholesaleDetail.jsx: slide-out with offer management (add/accept/decline offers)
- "Flag for Wholesale" button in InventoryDetail.jsx
- Add route: /wholesale. Add "Wholesale" to sidebar.

Add EN/FR translations.
```

---

# MODULE: Reporting & Analytics

## Overview

Extends existing 4 report types with GM command center dashboard, per-unit P&L, and scheduled report delivery.

## GM Command Center Dashboard

Shows on login for GM and Owner roles. Single screen with all key metrics.

### Stats Row (top)

| Metric | Source |
|---|---|
| Deals in pipeline (by stage) | deals table grouped by pipeline_stage |
| Total gross this month | sum of total_gross for deals completed this month |
| Units sold this month | count of deals reaching "delivered" this month |
| Avg front gross | avg of front_gross this month |
| Avg back gross | avg of back_gross this month |
| Funding pipeline | count + $ of deals submitted but not yet funded |
| Inventory count | total active inventory units |
| Units > 30 days | count of aging inventory |
| Leads this month | count of new leads |
| Lead conversion rate | converted / total leads this month |

### Charts

| Chart | Type | Data |
|---|---|---|
| Deals by stage | Horizontal bar | Count per pipeline_stage |
| Monthly gross trend | Line chart | Total gross per month, last 12 months |
| Sales by salesperson | Bar chart | Units + gross per salesperson this month |
| Inventory aging distribution | Donut | Units in 0-30, 30-60, 60+ day buckets |
| Lead sources | Pie chart | Leads by source this month |
| Funding status | Stacked bar | Deals by funding_status |

### Tables

| Table | Data |
|---|---|
| Deals needing attention | Deals rotting > 7 days in stage, overdue funding, incomplete checklists |
| Today's deliveries | Deals scheduled for delivery today |
| Recent activity | Last 20 deal stage changes, leads, completions across the store |

## Per-Unit P&L

Available on every deal and inventory record:

```
UNIT P&L — 2022 Kia Forte LX — Stock A12345
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  REVENUE
    Sale price:              $22,000
    F&I products:            $2,750
    F&I reserve:             $854
    Total revenue:           $25,604

  COST
    Acquisition:             $15,000
    Transport:               $500
    Reconditioning:          $2,000
    Total cost:              $17,500

  GROSS PROFIT:              $8,104

  EXPENSES
    Commission:              $1,931
    Pack/holdback:           $0

  NET PROFIT:                $6,173
```

## Scheduled Reports

| Report | Schedule | Recipients | Format |
|---|---|---|---|
| Daily sales summary | Every day at 7:00 PM | GM, sales manager | Email (HTML) |
| Weekly performance | Every Monday at 8:00 AM | GM, owner | Email + PDF attachment |
| Monthly P&L | 1st of each month | GM, owner | Email + Excel attachment |
| Inventory aging | Every Monday at 8:00 AM | Used car manager, wholesale manager | Email |

Scheduled via cron jobs, sent via Resend. Recipients configurable per store.

## Database changes

```sql
CREATE TABLE scheduled_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id) NOT NULL,
  report_type TEXT NOT NULL, -- 'daily_sales', 'weekly_performance', 'monthly_pl', 'inventory_aging'
  schedule TEXT NOT NULL, -- cron expression
  recipients JSONB NOT NULL, -- [{user_id, email}]
  format TEXT DEFAULT 'email', -- 'email', 'email_pdf', 'email_excel'
  active BOOLEAN DEFAULT true,
  last_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Prompt to build

```
Build the Reporting & Analytics upgrade.

DATABASE: Create scheduled_reports table [paste SQL above]

BACKEND:
- GET /api/reports/gm-dashboard — returns all metrics, chart data, and attention-needing deals for the GM dashboard
- GET /api/reports/unit-pl/:dealId — full per-unit P&L breakdown
- CRUD for scheduled_reports
- Cron jobs for each schedule: generate report, send via Resend with optional PDF/Excel attachment
- Use existing reportGenerator.js service, extend with new report types

FRONTEND:
- GMDashboard.jsx: stats row + charts (Recharts with Framer Motion animations) + attention table + today's deliveries + recent activity
- Make this the default view for GM and Owner roles on login
- UnitPL.jsx: component showing the P&L breakdown, usable in both DealDetail and InventoryDetail
- ScheduledReportsManager.jsx: settings page to configure which reports, schedule, recipients
- Apply Framer Motion animations to all chart renders

Extend existing reports with animated charts (redesign step 8).
Add EN/FR translations.
```

---

# MODULE: Chatbot Engine (High-Level Spec)

## Overview

This is the largest and most complex module. It should be built LAST after all other modules are working. The chatbot is the first responder for all incoming leads.

## Two chatbot types

| Type | Channel | Purpose |
|---|---|---|
| **Text chatbot** | SMS (Twilio) + website chat widget | First contact, data collection, qualification |
| **Voice chatbot** | Phone calls (future — Bland AI, Vapi, or Retell) | Outbound calls to leads who don't respond to text |

### Build order: Text chatbot first, voice chatbot as Phase 2.

## Text Chatbot Responsibilities

1. **Engage immediately** when a new lead enters the system
2. **Collect required data:** name, phone, email, vehicle interest, budget, trade-in details, timeline, preferred language, credit situation
3. **Qualify the lead:** based on responses, score as hot/warm/cold
4. **Hand off to F&I agent:** once data collection is complete, transfer with a summary
5. **Handle basic questions:** hours, location, inventory availability, payment estimates
6. **Nurture drip:** post-delivery follow-up sequences, lost-lead re-engagement

## Chatbot Data Collection Script

| # | Question | Field | Required |
|---|---|---|---|
| 1 | What's your name? | first_name, last_name | Yes |
| 2 | What kind of vehicle are you looking for? | vehicle_interest | Yes |
| 3 | Do you have a budget in mind? | budget_range | No |
| 4 | Do you have a trade-in? | has_trade_in, trade_in_details | Yes (y/n) |
| 5 | When are you looking to get into a vehicle? | timeline | Yes |
| 6 | What's the best email to reach you? | email | No |
| 7 | Preferred language? (auto-detected from conversation) | preferred_language | Auto |

## Handoff Trigger
Chatbot hands off when:
- All required fields collected AND client expresses readiness
- Client explicitly asks to speak to a person
- Client asks a question the chatbot can't answer
- Chatbot detects high buying intent

## Handoff Summary Format

```
NEW LEAD HANDOFF
━━━━━━━━━━━━━━━━━━━━━━━━
Client: John Smith
Phone: 613-555-0172
Email: john@email.com
Language: English
Vehicle interest: SUV, 2020+, budget ~$25,000
Trade-in: Yes — 2017 Honda Civic, ~120,000 km
Timeline: This week
Credit: Says it's "okay" (likely near-prime)
Notes: Mentioned he was declined at another dealer.

Conversation highlights:
- Very responsive, replied within minutes
- Specific about wanting AWD
- Flexible on make/model
━━━━━━━━━━━━━━━━━━━━━━━━
```

## Post-Delivery Drip Sequences

| Timing | Message | Purpose |
|---|---|---|
| Day 1 (next business day) | Thank you + enjoy your vehicle | Goodwill |
| Day 7 | How's the new car? Any questions? | Satisfaction check |
| Day 30 | Service reminder — first oil change | Revenue |
| Day 90 | Referral ask — know anyone looking? | Referrals |
| Day 180 | Trade-up check — ready for an upgrade? | Re-engage |
| Ongoing | Seasonal promotions, service specials | Revenue |

## Lost Lead Re-Engagement Drips

| Lost Reason | Drip Strategy |
|---|---|
| Couldn't get approved | Re-engage when new lender programs available |
| Payment too high | Notify when similar vehicle at lower price comes in |
| Ghosted | Gentle check-ins at 7, 14, 30 days |
| Went to another dealer | Follow up at 30, 90 days — are you happy? |
| Changed their mind | Check in at 30, 60 days — still interested? |

## Technology Decision (to be made later)

| Option | Pros | Cons |
|---|---|---|
| Custom GPT-powered bot (OpenAI/Anthropic API) | Full control, tailored responses | Build time, prompt engineering |
| Bland AI (voice) | Good voice quality, API-first | Voice only |
| Vapi (voice) | Flexible, good integrations | Voice only |
| Tidio / Intercom (text) | Ready-made widget, quick to deploy | Less customization |

**Recommendation:** Custom bot using Anthropic Claude API for text (you're already in the ecosystem), Twilio for SMS transport. Voice bot as separate Phase 2 with Bland AI or Vapi.

## Prompt to build (when ready)

```
Build the Text Chatbot Engine.

This is the most complex module — build it after all other modules are working.

BACKEND:
- Create server/services/chatbot.js:
  - Uses Anthropic Claude API for conversation intelligence
  - System prompt includes: dealership context, data collection script, qualification criteria, handoff rules
  - Maintains conversation state per lead in a conversations table
  - Extracts structured data from natural conversation (name, vehicle interest, etc.) and updates lead record
  - Triggers handoff when all required fields collected or client requests human

- Create server/routes/chatbot.js:
  - POST /api/chatbot/webhook/inbound — receives incoming SMS via Twilio webhook
  - POST /api/chatbot/webhook/web — receives messages from website chat widget
  - POST /api/chatbot/send — send a message to a lead (used by chatbot engine and manual override)
  - GET /api/chatbot/conversation/:leadId — get full conversation history
  - POST /api/chatbot/handoff/:leadId — manual handoff to F&I agent

- Conversation storage table for full history
- Drip sequence engine: scheduled messages based on templates and timing rules
- Integration with lead assignment system

FRONTEND:
- ChatWidget.jsx: embeddable website chat widget
- ConversationView.jsx: within LeadDetail, shows full chatbot conversation with ability for staff to take over
- DripManager.jsx: settings page to configure drip sequences and templates
- ChatbotSettings.jsx: configure system prompt, data collection requirements, handoff rules

Environment variables: ANTHROPIC_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
```
