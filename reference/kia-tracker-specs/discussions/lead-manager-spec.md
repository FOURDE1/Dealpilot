# Lead Manager — Final Specification (Revised)

## Overview

Ingests leads from Fluent Forms (full credit application) and Meta lead forms (shorter qualification). All leads enter a central queue and are distributed to stores based on each store's contribution to the ad budget that month. Chatbot is the first responder. After qualification, leads are assigned to F&I agents by language, availability, and workload. Unanswered leads get reassigned after 10 minutes. Unresponsive leads enter a 90-day nurture drip.

---

## Lead Sources

### 1. Landing Page — Fluent Forms (Full Credit Application)

**Platform:** Fluent Forms (WordPress plugin) with webhook already configured
**Landing pages:** 2 currently, may expand
**Same form for all landing pages**

**Fields collected (full credit pre-qualification):**

| Field | Maps to |
|---|---|
| Vehicle Type | vehicle_interest |
| Monthly Budget | monthly_budget |
| Currently driving a vehicle | current_vehicle |
| Employment Status | employment_status |
| Monthly Income | monthly_income |
| Earning Income Time Frame | income_timeframe |
| Your Job Title | job_title |
| Address | address |
| Rent or Own | housing_status |
| Monthly Rent or Mortgage | monthly_housing |
| Length at address | address_length |
| Day / Month / Year (DOB) | date_of_birth |
| Full Name | first_name + last_name (split) |
| Email | email |
| Phone/Mobile | phone |

### 2. Meta/Facebook Lead Forms

**Platform:** Meta Lead Ads, connected via Zapier
**Shorter form — qualification level only**

| Field | Maps to |
|---|---|
| What type of vehicle are you looking for? | vehicle_interest |
| Do you make more than $1800 per month? | income_threshold |
| What is your monthly vehicle budget? | monthly_budget |
| Full Name | first_name + last_name |
| Email | email |
| Phone Number | phone |

### 3. Manual Entry

Staff enters leads from phone calls, walk-ins, referrals. All fields available but only name + phone required.

---

## Central Queue & Weighted Store Distribution

### How it works

All leads from all sources enter a **central queue**. The system assigns each lead to a store based on that store's contribution to the advertising budget for the current month.

### Budget-based distribution

Each store's ad spend contribution is calculated monthly from actual spend:

```
Example:
  Google Ads total budget this month: $10,000
    Store A contributed: $6,000 (60%)
    Store B contributed: $4,000 (40%)

  Meta Ads total budget this month: $5,000
    Store A contributed: $2,000 (40%)
    Store B contributed: $3,000 (60%)

  Google lead comes in → 60% chance it goes to Store A, 40% to Store B
  Meta lead comes in → 40% chance it goes to Store A, 60% to Store B
```

### Distribution algorithm: Running tally

Not random — uses a **running tally** to ensure fairness:

1. Track actual leads received per store vs target percentage
2. When a new lead comes in, check which store is **furthest below** their target percentage
3. Assign to that store
4. Recalculate percentages

```
Example (Google leads, target 60/40):
  After 10 leads: Store A has 5 (50%), Store B has 5 (50%)
  Store A is below target (50% vs 60%) → next Google lead goes to Store A
  After 11: Store A has 6 (54.5%), Store B has 5 (45.5%)
  Store A still below → next goes to Store A
  After 12: Store A has 7 (58.3%), Store B has 5 (41.7%)
  Now Store A is close to target → next goes to Store B
```

### Separate splits for Google vs Meta

Each ad platform has its own distribution ratio because stores may contribute differently to each:

| Platform | Store | Contribution % | Leads received | Actual % | On target? |
|---|---|---|---|---|---|
| Google | Store A | 60% | 18 | 58% | ⚠️ Slightly under |
| Google | Store B | 40% | 13 | 42% | ✅ |
| Meta | Store A | 40% | 8 | 38% | ⚠️ Slightly under |
| Meta | Store B | 60% | 13 | 62% | ✅ |

### Distribution Dashboard (Owner/GM)

Real-time view showing:
- Target split per platform per store
- Actual leads received this month per store
- Current percentage vs target
- Deviation indicator (on target / over / under)
- Historical trend (last 3 months)

---

## Lead Assignment (Within a Store)

After a lead is assigned to a store, the chatbot engages immediately. After chatbot handoff, the lead is assigned to an F&I agent.

### Assignment flow

```
Lead enters central queue
       ↓
  Weighted distribution → assigned to a store
       ↓
  Chatbot engages immediately via SMS (Twilio)
       ↓
  Chatbot collects data + qualifies
       ↓
  Chatbot hands off with summary
       ↓
  System assigns to F&I agent at that store based on:
    1. Language match (lead language → agent's preferred_languages)
    2. Online status (is_online = true, heartbeat within 3 min)
    3. Schedule (agent is scheduled to work right now)
    4. Load balancing (fewest active leads, under max_active_leads cap)
       ↓
  Sales manager notified of new assignment
       ↓
  10-minute timer starts
       ↓
  If agent doesn't respond within 10 minutes:
    → Lead TAKEN AWAY from first agent
    → Reassigned to next available agent (same criteria)
    → First agent notified: "Lead reassigned due to no response"
    → Sales manager alerted
    → Timer restarts for new agent
       ↓
  If second agent also doesn't respond in 10 minutes:
    → Reassigned again (up to 3 attempts)
    → After 3 failed assignments → escalate to sales manager directly
```

### Reassignment rules
- The lead is **taken away** from the non-responsive agent (not shared)
- The agent loses the lead from their queue
- Reassignment is logged in lead history (who had it, how long, why it moved)
- The sales manager sees every reassignment in real-time

---

## Unresponsive Leads (Client Never Replies)

### 3 attempts then nurture drip

| Attempt | Timing | Channel | Action if no response |
|---|---|---|---|
| 1 | Immediate (chatbot) | SMS | Wait 4 hours |
| 2 | 4 hours later | SMS | Wait 24 hours |
| 3 | Next day | SMS or call | Mark as unresponsive |

After 3 failed attempts with no client response:
- Lead status → "unresponsive"
- Lead moves to **nurture drip with 90-day expiry**
- Drip sends periodic check-ins (configurable intervals)
- After 90 days with no engagement → lead status → "expired"
- If client responds at any point during drip → lead reactivates, re-enters assignment flow

---

## Duplicate Detection & Handling

### Detection
- On every new lead: check phone number against existing leads
- If match found: flag as duplicate

### Handling
1. System auto-sends a message to the client: "Hi [name], it looks like you've already submitted an application with us. Just confirming — are you still interested in finding a vehicle?"
2. New submission data merged into existing lead record (updated fields, new source tracked)
3. If client confirms interest → lead reactivated if it was in nurture/expired
4. If client was already in an active deal → alert the assigned salesperson
5. Duplicate submissions logged for analytics (helps identify high-intent leads — someone who submits twice is serious)

---

## Database

### Table: `leads`

```sql
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id), -- assigned store (null while in central queue)

  -- Source tracking
  source TEXT NOT NULL, -- 'fluent_form', 'meta_lead_form', 'manual', 'chatbot'
  source_platform TEXT, -- 'google', 'meta' (which ad platform drove this lead)
  source_campaign TEXT,
  source_url TEXT,
  source_form_data JSONB, -- raw webhook payload for reference

  -- Client info (shared fields)
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT NOT NULL,
  preferred_language TEXT DEFAULT 'en',
  date_of_birth DATE,

  -- Credit application fields (from Fluent Form)
  vehicle_interest TEXT,
  monthly_budget TEXT,
  current_vehicle TEXT,
  employment_status TEXT,
  monthly_income NUMERIC,
  income_timeframe TEXT,
  job_title TEXT,
  address TEXT,
  housing_status TEXT, -- 'rent', 'own'
  monthly_housing NUMERIC,
  address_length TEXT,

  -- Meta form fields
  income_threshold BOOLEAN, -- "makes more than $1800/mo"

  -- Chatbot
  chatbot_engaged BOOLEAN DEFAULT false,
  chatbot_engaged_at TIMESTAMPTZ,
  chatbot_summary TEXT,
  chatbot_handoff_at TIMESTAMPTZ,

  -- Status
  status TEXT DEFAULT 'new',
  -- 'new', 'chatbot_engaged', 'assigned', 'contacted', 'qualified', 'converted', 'unresponsive', 'nurture', 'expired', 'lost'

  -- Assignment
  assigned_to UUID REFERENCES users(id),
  assigned_at TIMESTAMPTZ,
  assignment_method TEXT, -- 'auto_language', 'auto_availability', 'manual', 'escalation', 'reassignment'
  assignment_attempts INTEGER DEFAULT 0, -- how many agents it's been assigned to
  previous_agents JSONB DEFAULT '[]', -- [{user_id, assigned_at, reassigned_at, reason}]

  -- Contact tracking
  contact_attempts INTEGER DEFAULT 0,
  first_contacted_at TIMESTAMPTZ,
  last_contacted_at TIMESTAMPTZ,
  response_time_seconds INTEGER, -- time from lead creation to first human contact

  -- Conversion
  converted_deal_id UUID REFERENCES deals(id),
  converted_at TIMESTAMPTZ,

  -- Lost / Unresponsive
  lost_reason TEXT,
  lost_at TIMESTAMPTZ,

  -- Nurture
  nurture_drip_status TEXT DEFAULT 'none', -- 'none', 'active', 'paused', 'opted_out', 'expired'
  nurture_started_at TIMESTAMPTZ,
  nurture_expires_at TIMESTAMPTZ, -- 90 days from start
  nurture_last_sent_at TIMESTAMPTZ,

  -- Duplicate
  is_duplicate BOOLEAN DEFAULT false,
  duplicate_of UUID REFERENCES leads(id),
  duplicate_notified BOOLEAN DEFAULT false,

  -- Meta
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_leads_store ON leads(store_id);
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_leads_assigned ON leads(assigned_to);
CREATE INDEX idx_leads_phone ON leads(phone);
CREATE INDEX idx_leads_source_platform ON leads(source_platform);
```

### Table: `lead_distribution_config`

```sql
CREATE TABLE lead_distribution_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id) NOT NULL,
  platform TEXT NOT NULL, -- 'google', 'meta'
  contribution_amount NUMERIC NOT NULL, -- actual $ contributed this month
  contribution_percentage NUMERIC, -- auto-calculated from total
  month DATE NOT NULL, -- first of the month (e.g., 2026-04-01)
  leads_received INTEGER DEFAULT 0, -- running count this month
  actual_percentage NUMERIC, -- auto-calculated: leads_received / total leads
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(store_id, platform, month)
);
```

### Table: `staff_schedules`

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

### Add to `users` table

```sql
ALTER TABLE users ADD COLUMN is_online BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN last_seen_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN preferred_languages TEXT[] DEFAULT '{"en"}';
ALTER TABLE users ADD COLUMN max_active_leads INTEGER DEFAULT 10;
```

---

## API Endpoints

```
# Leads
GET    /api/leads                          — List leads (filters: source, status, store, assigned_to, date, platform)
GET    /api/leads/:id                      — Single lead with full history
POST   /api/leads                          — Create lead (manual)
PUT    /api/leads/:id                      — Update lead

# Webhooks
POST   /api/leads/webhook/fluent-forms     — Fluent Forms webhook (full credit app fields)
POST   /api/leads/webhook/meta             — Zapier webhook for Meta lead forms
POST   /api/leads/webhook/generic          — Generic webhook (future sources)

# Assignment
POST   /api/leads/:id/assign               — Manual assign to agent
POST   /api/leads/:id/reassign             — Take from current agent, give to next available
GET    /api/users/available                 — Available agents (online + scheduled + under cap + language match)
PUT    /api/users/heartbeat                — Online status heartbeat (every 60 seconds)

# Conversion
POST   /api/leads/:id/convert              — Convert to deal (creates deal pre-filled, links lead)

# Duplicates
GET    /api/leads/duplicates               — List flagged duplicates
POST   /api/leads/:id/merge                — Merge duplicate into original

# Distribution
GET    /api/leads/distribution              — Distribution dashboard data (target vs actual per store per platform)
GET    /api/leads/distribution/config       — Current month's distribution config
PUT    /api/leads/distribution/config       — Update store ad spend contributions
GET    /api/leads/distribution/history      — Historical distribution data (last 3 months)

# Stats
GET    /api/leads/stats                     — Conversion rate, avg response time, by source, by store
GET    /api/leads/stats/response-time       — Avg time from lead in to first human contact, by agent

# Nurture
PUT    /api/leads/:id/nurture/pause         — Pause drip
PUT    /api/leads/:id/nurture/resume        — Resume drip
PUT    /api/leads/:id/nurture/opt-out       — Client opted out
POST   /api/leads/:id/reactivate            — Client responded during drip, re-enter assignment flow

# Schedule
GET    /api/users/:id/schedule              — Get staff schedule
PUT    /api/users/:id/schedule              — Update staff schedule
GET    /api/schedules/today                 — Who's working today (for assignment logic)
```

---

## UI Specification

### Leads Dashboard

**Stats bar:**
```
New Today: 12  |  Assigned: 8  |  Unresponded: 3  |  Converted (MTD): 45  |  Conversion Rate: 18%
```

**Filter bar:** Source (fluent/meta/manual), status, assigned agent, store, date range, platform (google/meta)

**Lead list:** Sortable table or card view
- Each lead shows: name, source badge (Fluent/Meta/Manual), status, vehicle interest, assigned agent, age (with color), contact attempts

### Lead Card

```
┌─────────────────────────────────────────────────────┐
│ 🟢 John Smith                    Meta    2 min ago  │
│ Looking for: SUV, budget $400/mo                     │
│ Phone: 613-555-0172  |  EN                           │
│ Status: Chatbot engaged  |  Assigned: —              │
└─────────────────────────────────────────────────────┘
```

### Lead Detail (slide-out)

**Client Info:**
All fields from form submission, organized in sections

**For Fluent Form leads (full credit app):**
```
CLIENT PROFILE
  Name: John Smith          DOB: Jan 15, 1990
  Phone: 613-555-0172       Email: john@email.com
  Language: English

FINANCIAL PROFILE
  Employment: Full-time     Job: Warehouse Supervisor
  Monthly Income: $4,200    Income Timeframe: 2+ years
  Housing: Rent — $1,400/mo Address: 123 Bank St, Ottawa
  Length at address: 3 years

VEHICLE INTEREST
  Looking for: SUV
  Monthly budget: $400
  Currently driving: 2017 Honda Civic
```

**For Meta leads (shorter):**
```
CLIENT PROFILE
  Name: John Smith
  Phone: 613-555-0172       Email: john@email.com

QUALIFICATION
  Vehicle interest: SUV
  Income > $1,800/mo: Yes
  Monthly budget: $400
```

**Assignment History:**
```
ASSIGNMENT TIMELINE
  Apr 5, 10:00 AM — Lead entered central queue (Meta, Google campaign)
  Apr 5, 10:00 AM — Distributed to Kia Mont-Laurier (40% Meta split)
  Apr 5, 10:00 AM — Chatbot engaged
  Apr 5, 10:03 AM — Chatbot collected: name, vehicle, budget
  Apr 5, 10:05 AM — Chatbot handed off to F&I
  Apr 5, 10:05 AM — Assigned to Hussein (FR, online, 3 active leads)
  Apr 5, 10:15 AM — ⚠️ No response — reassigned to Hassan (FR, online, 2 active leads)
  Apr 5, 10:16 AM — Hassan contacted client
```

**Action buttons:**
- [Assign / Reassign]
- [Convert to Deal]
- [Mark as Lost] (with reason)
- [Start Nurture Drip]

### Distribution Dashboard (Owner view)

```
Lead Distribution — April 2026
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

GOOGLE ADS — Total Budget: $10,000
  ┌───────────────┬──────────┬────────┬────────┬──────────┐
  │ Store         │ Spend    │ Target │ Actual │ Status   │
  ├───────────────┼──────────┼────────┼────────┼──────────┤
  │ Ready Group   │ $6,000   │ 60%    │ 58%    │ ⚠️ -2%   │
  │ Kia M-L       │ $4,000   │ 40%    │ 42%    │ ✅ +2%   │
  └───────────────┴──────────┴────────┴────────┴──────────┘

META ADS — Total Budget: $5,000
  ┌───────────────┬──────────┬────────┬────────┬──────────┐
  │ Store         │ Spend    │ Target │ Actual │ Status   │
  ├───────────────┼──────────┼────────┼────────┼──────────┤
  │ Ready Group   │ $2,000   │ 40%    │ 38%    │ ⚠️ -2%   │
  │ Kia M-L       │ $3,000   │ 60%    │ 62%    │ ✅ +2%   │
  └───────────────┴──────────┴────────┴────────┴──────────┘

  [Update Ad Spend]  [View History]
```

### Schedule Manager (Settings)

```
Staff Schedules
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Hussein Alshawi — F&I Agent — FR/EN
  ┌─────┬─────┬─────┬─────┬─────┬─────┬─────┐
  │ Sun │ Mon │ Tue │ Wed │ Thu │ Fri │ Sat │
  │ OFF │ 9-5 │ 9-5 │ 9-5 │ 9-5 │ 9-5 │ OFF │
  └─────┴─────┴─────┴─────┴─────┴─────┴─────┘

  [Edit Schedule]
```

---

## Prompt to Build This

```
Build the Lead Manager module for the Kia Deal Tracker.

This is a comprehensive lead management system with weighted store distribution, chatbot-first engagement, language-based assignment, and 10-minute reassignment.

DATABASE:
1. Create leads table: [paste SQL above]
2. Create lead_distribution_config table: [paste SQL above]
3. Create staff_schedules table: [paste SQL above]
4. Add user columns: is_online, last_seen_at, preferred_languages, max_active_leads

BACKEND:

1. Create server/routes/leads.js:
   - Full CRUD with store scoping
   - All filter options: source, status, store, assigned_to, date range, source_platform

2. Create server/routes/leadWebhooks.js:
   - POST /webhook/fluent-forms: accepts Fluent Forms webhook payload
     - Maps all 16 fields to lead schema
     - Splits full_name into first_name + last_name
     - Checks for duplicate on phone number
     - If duplicate: merge data into existing lead, auto-send "duplicate detected" message to client, reconfirm interest
     - If new: create lead in central queue (store_id = null)
     - Run weighted distribution to assign store
     - Trigger chatbot engagement
   - POST /webhook/meta: accepts Zapier webhook from Meta lead forms
     - Maps 6 fields to lead schema
     - Same duplicate check, distribution, and chatbot trigger

3. Create server/services/leadDistribution.js:
   - Function: assignLeadToStore(lead)
   - Reads lead_distribution_config for current month
   - Determines source_platform (google or meta based on source/campaign data)
   - Calculates which store is furthest below their target percentage for that platform
   - Assigns lead to that store, increments leads_received counter
   - Recalculates actual_percentage

4. Create server/services/leadAssignment.js:
   - Function: assignLeadToAgent(lead, storeId)
   - Called after chatbot handoff
   - Finds best available agent at the store:
     a. Filter by language match (lead.preferred_language in agent.preferred_languages)
     b. Filter by online (is_online = true, last_seen_at within 3 min)
     c. Filter by schedule (staff_schedules shows working right now)
     d. Sort by active lead count ascending (fewest leads first)
     e. Assign to top result
   - If no agent available: escalate to sales manager
   - Starts 10-minute reassignment timer

5. Create server/services/leadReassignment.js:
   - Scheduled check every minute (or use setTimeout per lead)
   - If lead.status = "assigned" and assigned_at < (now - 10 minutes) and no contact logged:
     - Record current agent in previous_agents array with reason "no_response"
     - Remove lead from current agent
     - Run assignLeadToAgent again (excluding previous agents)
     - Increment assignment_attempts
     - Fire HIGH notification to sales manager
     - After 3 failed assignments → assign directly to sales manager

6. Create server/services/leadNurture.js:
   - When lead marked "unresponsive" after 3 contact attempts:
     - Set nurture_drip_status = "active"
     - Set nurture_expires_at = now + 90 days
   - Scheduled job checks for nurture messages to send
   - After 90 days with no engagement → status = "expired"
   - If client responds → reactivate lead, re-enter assignment flow

7. Heartbeat endpoint: PUT /api/users/heartbeat
   - Updates is_online = true, last_seen_at = now
   - Cron marks users offline if last_seen_at > 3 minutes ago

8. Distribution endpoints:
   - GET /api/leads/distribution — dashboard data
   - PUT /api/leads/distribution/config — update store ad spend for current month
   - Recalculates contribution_percentage for all stores on that platform

FRONTEND:

1. Create LeadsDashboard.jsx:
   - Stats bar: new today, assigned, unresponded, converted MTD, conversion rate
   - Filter bar: source, status, agent, store, date, platform
   - Lead list (table or card view)

2. Create LeadCard.jsx:
   - Name, source badge, status, vehicle interest, agent, age with color

3. Create LeadDetail.jsx (slide-out):
   - Full client info (different layout for Fluent vs Meta leads)
   - Financial profile section (for Fluent leads)
   - Chatbot conversation (when chatbot module built)
   - Assignment history timeline (every assignment, reassignment, with timestamps)
   - Action buttons: assign, convert, mark lost, start nurture

4. Create DistributionDashboard.jsx (owner view):
   - Per-platform per-store: spend, target %, actual %, deviation
   - "Update Ad Spend" form
   - 3-month history chart

5. Create ScheduleManager.jsx (settings):
   - Weekly grid per staff member
   - Set work hours per day
   - Toggle days on/off

6. Add heartbeat to Layout.jsx:
   - Every 60 seconds: PUT /api/users/heartbeat
   - On page unload: mark offline

7. Add route: /leads → LeadsDashboard
8. Add route: /settings/distribution → DistributionDashboard (owner only)
9. Add route: /settings/schedules → ScheduleManager
10. Add "Leads" to sidebar with Users icon

Add EN/FR translations for all new strings.
```
