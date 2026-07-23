# Notifications & Automation Engine — Final Specification

## Overview

Three systems working together:
1. **Roles & Permissions** — who sees what, who can do what
2. **Notification Engine** — alerts routed to the right people at the right urgency
3. **Automation Rules** — triggers that fire notifications and actions automatically

---

## 1. Roles & Permissions

### Role Definitions

| Role | Scope | Description |
|---|---|---|
| **Owner** | All stores | Sees everything across all stores. Full admin access. |
| **General Manager (GM)** | Own store | Sees everything within their store. Full store-level admin. |
| **Sales Manager** | Own store | Manages salespeople, deal pipeline, lead assignments |
| **Used Car Manager** | Own store | Manages inventory, garage work orders, recon, vehicle readiness |
| **F&I Agent** | Own store | Manages finance submissions, approvals, funding, document signing |
| **Salesperson** | Own deals | Sees only their own deals and assigned leads |
| **Wholesale Manager** | Own store | Manages aging inventory, auction listings, wholesale offers |
| **Logistics / Operations** | Own store | Manages dispatch, drivers, deliveries, work orders |
| **Admin / Office Staff** | Own store | Handles payments, document filing, data entry, admin tasks |
| **BDC / Lead Handler** | Own store | Handles incoming leads, chatbot handoffs, initial client contact |

### Multi-Role Support
- One person CAN hold multiple roles (e.g., used car manager + wholesale manager)
- Permissions are additive — if you have two roles, you get the combined permissions of both
- Roles are assigned per user in the system settings

### Visibility Hierarchy

```
Owner ──────── sees ALL stores, ALL deals, ALL data
  │
  ├── GM (Store A) ──── sees all data within Store A
  │     ├── Sales Manager ──── sees all deals + leads in Store A
  │     ├── Used Car Manager ── sees all inventory + work orders in Store A
  │     ├── F&I Agent ───────── sees all deals in Store A (finance focus)
  │     ├── Wholesale Manager ─ sees all inventory in Store A (aging focus)
  │     ├── Logistics ────────── sees dispatch + deliveries in Store A
  │     ├── Admin ────────────── sees all data in Store A (data entry focus)
  │     ├── BDC ──────────────── sees leads + chatbot in Store A
  │     └── Salesperson ──────── sees ONLY their own deals + assigned leads
  │
  └── GM (Store B) ──── sees all data within Store B
        └── (same structure)
```

### Permission Matrix

| Action | Owner | GM | Sales Mgr | Used Car Mgr | F&I | Salesperson | Wholesale | Logistics | Admin | BDC |
|---|---|---|---|---|---|---|---|---|---|---|
| View all deals (store) | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ own only | ✅ | ✅ | ✅ | ❌ |
| Create deal | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| Move deal stages | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Override delivery checklist | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Mark deal as Lost | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| View/manage inventory | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| Create work orders | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Manage dispatch/drivers | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Book delivery | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Confirm delivery complete | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| Confirm payments | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Submit to lenders | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Flag for wholesale | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| View/manage leads | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ own | ❌ | ❌ | ❌ | ✅ |
| View reports | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ own | ✅ | ✅ | ❌ | ❌ |
| Manage salespeople | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| System settings | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Manage automation rules | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

---

## 2. Notification System

### Urgency Tiers

| Tier | Channels | When to use |
|---|---|---|
| **LOW** | In-app bell icon only | Routine status updates, informational |
| **MEDIUM** | In-app + email | Overdue items, things that need attention today |
| **HIGH** | In-app + email + SMS (Twilio) | Failures, money issues, anything needing immediate action |

### Complete Alert Catalog

#### HIGH Urgency (in-app + email + SMS)

| # | Alert | Trigger | Who Gets It |
|---|---|---|---|
| H1 | Chatbot handoff failed | Chatbot couldn't reach any available F&I agent | Sales Manager, GM |
| H2 | Deal fell through (Lost) | Deal marked as Lost at any stage | Salesperson (their deal), Sales Manager |
| H3 | Delivery failed | Delivery marked as failed (any reason) | Salesperson, Sales Manager, Logistics |
| H4 | Payment mismatch | Cash collected ≠ expected amount | Admin, GM |
| H5 | Client requesting callback | Client requests immediate callback via chatbot or form | Assigned salesperson, BDC |

#### MEDIUM Urgency (in-app + email)

| # | Alert | Trigger | Who Gets It |
|---|---|---|---|
| M1 | Safety inspection overdue | Work order sent to garage 3+ days ago, no result | Used Car Manager |
| M2 | Funding overdue | Funding submitted to bank 7+ days ago, no update | F&I Agent (on the deal), GM |
| M3 | Vehicle aging — 30 days | Unit hits 30 days in stock | Used Car Manager, Wholesale Manager, GM |
| M4 | Deal approved by lender | Lender approval received on a deal | F&I Agent, Salesperson (their deal) |
| M5 | Checklist override used | Manager overrode pre-delivery checklist | GM |
| M6 | Unmatched delivery photos | Delivery photos received but couldn't match to a deal | Admin, Logistics |
| M7 | Trade-in condition mismatch | Trade-in inspection doesn't match agreed condition | Salesperson (their deal), Sales Manager |
| M8 | Deal funded | Bank confirmed funding on a deal | F&I Agent, Salesperson (their deal) |
| M9 | New lead assigned to you | Lead assigned (by round-robin or manual) | Assigned salesperson |
| M10 | Delivery completed | Driver confirmed delivery complete | Salesperson (their deal), Admin |

#### LOW Urgency (in-app only)

| # | Alert | Trigger | Who Gets It |
|---|---|---|---|
| L1 | Deal stage changed | Deal moved to a new pipeline stage | Salesperson (their deal) |
| L2 | Work order completed | Garage marked work order as done | Used Car Manager, Logistics |
| L3 | Document signed | Client signed a document via DocuSign/OneSpan | F&I Agent (on the deal) |
| L4 | Delivery photos received | Photos auto-matched to a deal | Salesperson (their deal) |
| L5 | Payment confirmed | Admin confirmed a payment amount | Salesperson (their deal) |

### Alert Thresholds (Configurable)

| Threshold | Default Value | Configurable By |
|---|---|---|
| Lead response time | Handled by chatbot (no human timer) | — |
| Vehicle aging alert | 30 days in stock | GM (per store) |
| Safety inspection overdue | 3 days since sent to garage | GM (per store) |
| Funding overdue | 7 days since submitted to bank | GM (per store) |
| Deal rotting (stage aging) | 7 days in same stage | GM (per store) |
| Vehicle no photos | 48 hours after arriving on lot | GM (per store) |
| Recon cost threshold | $2,000 (alert GM if exceeded) | GM (per store) |

---

## 3. SMS Strategy

### Platform: Twilio

### Who receives SMS

| Recipient | SMS For | Number Source |
|---|---|---|
| **Staff** | HIGH urgency alerts only | Staff phone number on their user profile |
| **Clients** | All client communication goes through chatbot | Client phone number on lead/deal record |

### Staff SMS rules
- Only HIGH urgency alerts send SMS
- Staff can opt out of SMS in their profile settings (but in-app + email still fire)
- SMS is a short notification with a link to the deal in the system
- Format: `[KIA TRACKER] {alert title} — {deal/client name}. View: {link}`
- Max 160 characters for the SMS body

### Client SMS
- Clients are NOT contacted via the notification engine directly
- All client communication (reminders, follow-ups, drip sequences) goes through the **Chatbot Engine**
- The chatbot uses Twilio as its SMS transport layer
- This keeps all client messaging in one place with conversation history

### Twilio setup needed
- One Twilio phone number per store (for outbound SMS)
- Inbound SMS from clients routes to the chatbot engine
- Staff SMS uses the same Twilio account but a separate number or messaging service

---

## 4. Notification Delivery

### In-App Notifications (bell icon)

**UI behavior:**
- Bell icon in top bar with unread count badge (red dot with number)
- Click opens a dropdown showing the 20 most recent notifications
- Each notification shows: urgency color stripe (left border), title, message preview, timestamp, read/unread state
- Click a notification → navigates to the relevant deal/lead/inventory record
- "Mark all as read" button at top of dropdown
- Unread count updates in real-time via Supabase subscription

**Notification card format:**
```
🔴 │ Delivery failed — John Smith                    2 min ago
   │ Client not home. Deal #A12345 needs reschedule.
───┤────────────────────────────────────────────────
🟡 │ Safety inspection overdue — 2019 Kia Forte      1 hour ago
   │ Sent to garage 4 days ago. No result received.
───┤────────────────────────────────────────────────
⚪ │ Deal stage changed — Sarah Johnson               3 hours ago
   │ Moved from Approved → Signed.
```

### Email Notifications

- Sent via Resend (already integrated)
- MEDIUM and HIGH urgency only
- Email includes: alert title, deal/client details, direct link to the deal in the system
- One email per alert (not batched/digested — these are operational alerts)

### SMS Notifications (Twilio)

- HIGH urgency only
- Staff only (clients go through chatbot)
- Short format: `[KIA TRACKER] Delivery failed — John Smith, Deal A12345. View: https://app.example.com/deal/abc123`
- Delivered within seconds of the trigger

### Toast Notifications (in-app)

- Appear bottom-right of screen when user is active in the app
- Auto-dismiss after 5 seconds
- Click navigates to relevant record
- Only show for MEDIUM and HIGH while the user is online
- Don't show toasts for LOW (too noisy — those accumulate in the bell)

---

## 5. Automation Engine

### How it works
The automation engine listens for events across the system and fires actions based on configurable rules. Each rule has a trigger, optional conditions, and one or more actions.

### Event types the engine listens for

| Event | Fires When |
|---|---|
| `deal.created` | New deal created |
| `deal.stage_changed` | Deal pipeline stage changes |
| `deal.lost` | Deal marked as Lost |
| `deal.funded` | Funding status changes to "funded" |
| `lead.created` | New lead enters the system |
| `lead.assigned` | Lead assigned to a salesperson |
| `chatbot.handoff_failed` | Chatbot couldn't reach an available agent |
| `delivery.completed` | Delivery confirmed complete |
| `delivery.failed` | Delivery marked as failed |
| `delivery.photos_received` | Delivery photos matched to a deal |
| `payment.received` | Payment received on a deal |
| `payment.mismatch` | Payment amount doesn't match expected |
| `work_order.completed` | Garage work order finished |
| `inventory.aging_threshold` | Vehicle exceeds days-in-stock threshold |
| `checklist.overridden` | Manager overrode pre-delivery checklist |
| `trade_in.condition_mismatch` | Trade-in inspection failed condition check |
| `document.signed` | Document signed in DocuSign/OneSpan |
| `lender.approved` | Lender approval received |
| `lender.declined` | Lender declined the application |
| `funding.overdue` | Funding submitted but no response after threshold |
| `safety.overdue` | Safety work order sent but no result after threshold |
| `client.callback_requested` | Client requests callback through chatbot/form |

### Rule structure

```json
{
  "name": "Delivery failed — alert team",
  "trigger_event": "delivery.failed",
  "conditions": [],
  "actions": [
    {
      "type": "create_notification",
      "urgency": "high",
      "recipients": ["deal.salesperson", "role.sales_manager", "role.logistics"],
      "title": "Delivery failed — {{client_name}}",
      "message": "{{failure_reason}}. Deal {{stock_number}} needs reschedule."
    }
  ],
  "active": true
}
```

### Recipient targeting

| Target | Resolves To |
|---|---|
| `deal.salesperson` | The salesperson assigned to the deal |
| `deal.fi_agent` | The F&I agent on the deal |
| `role.gm` | All GMs at the deal's store |
| `role.sales_manager` | All sales managers at the deal's store |
| `role.used_car_manager` | All used car managers at the deal's store |
| `role.wholesale_manager` | All wholesale managers at the deal's store |
| `role.logistics` | All logistics staff at the deal's store |
| `role.admin` | All admin/office staff at the deal's store |
| `role.bdc` | All BDC/lead handlers at the deal's store |
| `role.owner` | All owners (cross-store) |

### Pre-built automation rules (seeded on setup)

| # | Name | Trigger | Urgency | Recipients |
|---|---|---|---|---|
| 1 | Chatbot handoff failed | `chatbot.handoff_failed` | HIGH | role.sales_manager, role.gm |
| 2 | Deal marked Lost | `deal.lost` | HIGH | deal.salesperson, role.sales_manager |
| 3 | Delivery failed | `delivery.failed` | HIGH | deal.salesperson, role.sales_manager, role.logistics |
| 4 | Payment mismatch | `payment.mismatch` | HIGH | role.admin, role.gm |
| 5 | Client requesting callback | `client.callback_requested` | HIGH | deal.salesperson, role.bdc |
| 6 | Safety overdue (3 days) | `safety.overdue` | MEDIUM | role.used_car_manager |
| 7 | Funding overdue (7 days) | `funding.overdue` | MEDIUM | deal.fi_agent, role.gm |
| 8 | Vehicle aging (30 days) | `inventory.aging_threshold` | MEDIUM | role.used_car_manager, role.wholesale_manager, role.gm |
| 9 | Deal approved by lender | `lender.approved` | MEDIUM | deal.fi_agent, deal.salesperson |
| 10 | Checklist override used | `checklist.overridden` | MEDIUM | role.gm |
| 11 | Unmatched delivery photos | `delivery.photos_received` (unmatched) | MEDIUM | role.admin, role.logistics |
| 12 | Trade-in condition mismatch | `trade_in.condition_mismatch` | MEDIUM | deal.salesperson, role.sales_manager |
| 13 | Deal funded | `deal.funded` | MEDIUM | deal.fi_agent, deal.salesperson |
| 14 | New lead assigned | `lead.assigned` | MEDIUM | deal.salesperson |
| 15 | Delivery completed | `delivery.completed` | MEDIUM | deal.salesperson, role.admin |
| 16 | Deal stage changed | `deal.stage_changed` | LOW | deal.salesperson |
| 17 | Work order completed | `work_order.completed` | LOW | role.used_car_manager, role.logistics |
| 18 | Document signed | `document.signed` | LOW | deal.fi_agent |
| 19 | Delivery photos received | `delivery.photos_received` (matched) | LOW | deal.salesperson |
| 20 | Payment confirmed | `payment.received` | LOW | deal.salesperson |

### Scheduled checks (cron jobs)

These aren't event-driven — they run on a schedule and check for threshold violations.

| # | Check | Schedule | What it does |
|---|---|---|---|
| S1 | Vehicle aging | Daily at 8:00 AM | Query all vehicles where days_in_stock ≥ threshold. Fire `inventory.aging_threshold` for each. Skip if alert already fired for this vehicle at this threshold. |
| S2 | Safety overdue | Daily at 8:00 AM | Query all work orders where status = "sent" and sent_at < (now - 3 days). Fire `safety.overdue` for each. |
| S3 | Funding overdue | Daily at 8:00 AM | Query all deals where funding_status = "submitted" and submitted_at < (now - 7 days). Fire `funding.overdue` for each. |
| S4 | Deal rotting | Daily at 8:00 AM | Query all deals where stage_entered_at < (now - 7 days) and pipeline_stage not in (complete, lost). Fire notification to deal.salesperson. |
| S5 | Vehicle no photos | Daily at 8:00 AM | Query all vehicles where location_status = "on_lot" and photo_count = 0 and arrived_at < (now - 48 hours). Alert used car manager. |
| S6 | Post-delivery follow-up | Daily at 10:00 AM | Query all deals delivered yesterday (or last business day if Monday). Send thank-you + enroll in chatbot drip. |

---

## Database Changes

### Modify `users` table:

```sql
ALTER TABLE users ADD COLUMN roles TEXT[] DEFAULT '{}'; -- array: ['salesperson', 'bdc']
ALTER TABLE users ADD COLUMN store_id UUID; -- FK to stores table
ALTER TABLE users ADD COLUMN phone TEXT; -- for SMS notifications
ALTER TABLE users ADD COLUMN sms_enabled BOOLEAN DEFAULT true;
ALTER TABLE users ADD COLUMN notification_preferences JSONB DEFAULT '{"low": ["in_app"], "medium": ["in_app", "email"], "high": ["in_app", "email", "sms"]}';
```

### New table: `stores`

```sql
CREATE TABLE stores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  province TEXT NOT NULL, -- 'ontario', 'quebec'
  address TEXT,
  phone TEXT,
  twilio_number TEXT, -- outbound SMS number for this store
  bill_of_sale_system TEXT DEFAULT 'cams', -- 'cams' or 'merlin'
  alert_thresholds JSONB DEFAULT '{
    "vehicle_aging_days": 30,
    "safety_overdue_days": 3,
    "funding_overdue_days": 7,
    "deal_rotting_days": 7,
    "no_photos_hours": 48,
    "recon_cost_threshold": 2000
  }',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### New table: `notifications`

```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id),
  urgency TEXT NOT NULL, -- 'low', 'medium', 'high'
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT, -- deep link to relevant record (e.g., /deal/abc123)
  related_deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  related_entity_type TEXT, -- 'deal', 'lead', 'inventory', 'work_order'
  related_entity_id UUID,
  channels_sent TEXT[] DEFAULT '{}', -- ['in_app', 'email', 'sms'] — which channels were used
  read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  email_sent BOOLEAN DEFAULT false,
  email_sent_at TIMESTAMPTZ,
  sms_sent BOOLEAN DEFAULT false,
  sms_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_unread ON notifications(user_id, read) WHERE read = false;
CREATE INDEX idx_notifications_user_created ON notifications(user_id, created_at DESC);
```

### New table: `automation_rules`

```sql
CREATE TABLE automation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  trigger_event TEXT NOT NULL,
  conditions JSONB DEFAULT '[]',
  actions JSONB NOT NULL, -- array of action objects
  urgency TEXT NOT NULL, -- 'low', 'medium', 'high'
  recipients JSONB NOT NULL, -- array of recipient targets
  active BOOLEAN DEFAULT true,
  store_id UUID REFERENCES stores(id), -- null = applies to all stores
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## API Endpoints

```
# Notifications
GET    /api/notifications              — List notifications for current user (paginated, filterable)
GET    /api/notifications/unread-count — Unread count for bell icon badge
PUT    /api/notifications/:id/read     — Mark single notification as read
PUT    /api/notifications/read-all     — Mark all as read
DELETE /api/notifications/:id          — Dismiss a notification

# Automation Rules
GET    /api/automations                — List all rules (admin/GM only)
POST   /api/automations                — Create a new rule
PUT    /api/automations/:id            — Update a rule
PUT    /api/automations/:id/toggle     — Enable/disable a rule
DELETE /api/automations/:id            — Delete a rule

# Stores
GET    /api/stores                     — List all stores
POST   /api/stores                     — Create store (owner only)
PUT    /api/stores/:id                 — Update store (GM/owner)
GET    /api/stores/:id/thresholds      — Get alert thresholds for a store
PUT    /api/stores/:id/thresholds      — Update thresholds (GM/owner)

# Roles
GET    /api/users/:id/permissions      — Get resolved permissions for a user
PUT    /api/users/:id/roles            — Update user roles (GM/owner)

# SMS
POST   /api/sms/send                   — Send SMS via Twilio (internal, called by notification engine)
```

---

## UI Specification

### Bell Icon (Top Bar)
```
🔔 (3)    ← red badge with unread count, pulses on new notification
```

### Notification Dropdown
```
┌──────────────────────────────────────────────────┐
│  Notifications                    [Mark all read] │
│──────────────────────────────────────────────────│
│ 🔴 │ Delivery failed — John Smith      2 min ago │
│    │ Client not home. Reschedule needed.          │
│────│─────────────────────────────────────────────│
│ 🟡 │ Safety overdue — 2019 Kia Forte   1 hr ago  │
│    │ Garage: 4 days, no result.                   │
│────│─────────────────────────────────────────────│
│ 🟡 │ Deal funded — Sarah Johnson       3 hrs ago │
│    │ TD Auto Finance confirmed.                   │
│────│─────────────────────────────────────────────│
│ ⚪ │ Stage changed — Mike Brown        5 hrs ago  │
│    │ Approved → Signed                            │
│──────────────────────────────────────────────────│
│           View all notifications →                │
└──────────────────────────────────────────────────┘
```

### Toast Notification (bottom-right)
```
┌──────────────────────────────────────┐
│ 🔴 Delivery failed                   │
│ John Smith — client not home.        │
│                          [View Deal] │
└──────────────────────────────────────┘
  Auto-dismisses in 5 seconds
  Click anywhere → navigates to deal
```

### Automation Manager (Settings Page — GM/Owner only)
```
Automation Rules                                [+ New Rule]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ✅ Chatbot handoff failed          HIGH    → Sales Mgr, GM
  ✅ Deal marked Lost                HIGH    → Salesperson, Sales Mgr
  ✅ Safety overdue (3 days)         MEDIUM  → Used Car Mgr
  ✅ Vehicle aging (30 days)         MEDIUM  → Used Car Mgr, Wholesale, GM
  ✅ Deal stage changed              LOW     → Salesperson
  ⬜ (disabled) Vehicle no photos    MEDIUM  → Used Car Mgr

Each row: toggle on/off, click to edit recipients/thresholds
```

### Store Thresholds Settings (GM/Owner)
```
Alert Thresholds — Kia Mont-Laurier
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Vehicle aging alert:          [30] days
  Safety inspection overdue:    [3] days
  Funding overdue:              [7] days
  Deal rotting (stage aging):   [7] days
  Vehicle no photos:            [48] hours after arrival
  Recon cost alert threshold:   $[2,000]

  [Save Changes]
```

### User Notification Preferences (Profile)
```
Notification Preferences
━━━━━━━━━━━━━━━━━━━━━━━━

  Low urgency:     ☑ In-app    ☐ Email    ☐ SMS
  Medium urgency:  ☑ In-app    ☑ Email    ☐ SMS
  High urgency:    ☑ In-app    ☑ Email    ☑ SMS

  SMS number: +1 (613) 555-0172    [✅ Verified]
  ☑ SMS enabled

  [Save Preferences]
```

---

## Prompt to Build This

```
Build the Notifications & Automation Engine for the Kia Deal Tracker.

This is a three-part system: roles/permissions, notification delivery, and automation rules.

DATABASE:
1. Create stores table: [paste SQL above]
2. Create notifications table with indexes: [paste SQL above]
3. Create automation_rules table: [paste SQL above]
4. Add columns to users table: roles, store_id, phone, sms_enabled, notification_preferences
5. Seed 20 pre-built automation rules: [paste the rules table above]

BACKEND:

1. Create server/middleware/permissions.js:
   - Middleware that checks user roles against required permissions per route
   - Implements visibility hierarchy: owner sees all stores, GM sees own store, salesperson sees own deals
   - Export a requireRole('gm', 'sales_manager') middleware function
   - Export a scopeToStore() middleware that filters queries by user's store_id (owner bypasses)

2. Create server/services/notificationEngine.js:
   - Function: fireEvent(eventType, eventData, storeId)
   - Looks up matching automation rules for the event
   - Resolves recipients (deal.salesperson → actual user ID, role.gm → all GMs at that store)
   - Creates notification records
   - Based on urgency + user preferences, sends via channels:
     - LOW: create notification record only (in-app)
     - MEDIUM: create notification + send email via Resend
     - HIGH: create notification + send email via Resend + send SMS via Twilio
   - Respects user's notification_preferences and sms_enabled flag

3. Create server/services/twilioService.js:
   - Initialize Twilio client
   - Function: sendSMS(to, message) — sends a single SMS
   - Format: "[KIA TRACKER] {title} — {deal/client}. View: {link}"
   - Max 160 chars

4. Create server/routes/notifications.js: [paste endpoints above]
5. Create server/routes/automations.js: [paste endpoints above]
6. Create server/routes/stores.js: [paste endpoints above]

7. Create server/jobs/scheduledChecks.js:
   - 6 scheduled checks that run daily: [paste the cron table above]
   - Each check queries for threshold violations and fires events through notificationEngine
   - Use node-cron or a Supabase scheduled function

8. Integrate fireEvent() calls into existing routes:
   - deals.js: fire deal.stage_changed, deal.lost, deal.funded on relevant updates
   - deliveryChecklists.js: fire checklist.overridden on override
   - delivery.js: fire delivery.completed, delivery.failed
   - payments.js: fire payment.received, payment.mismatch
   - (Other events integrate when those modules are built)

FRONTEND:

1. Update Layout.jsx top bar:
   - Bell icon with unread count badge (Supabase real-time subscription on notifications table)
   - Click opens NotificationDropdown.jsx

2. Create NotificationDropdown.jsx:
   - Lists 20 most recent notifications
   - Left border color by urgency (red/amber/none)
   - Read/unread styling
   - Click navigates to related deal/record
   - "Mark all read" button
   - "View all" link to full notification page

3. Create NotificationToast.jsx:
   - Bottom-right toast for MEDIUM and HIGH alerts when user is online
   - Auto-dismiss 5 seconds
   - Click navigates to deal

4. Create AutomationManager.jsx (settings, GM/owner only):
   - List all rules with toggle on/off
   - Click to edit: recipients, thresholds
   - Add new custom rules

5. Create StoreSettings.jsx:
   - Alert threshold configuration
   - Store info management

6. Add notification preferences to user profile page

7. Apply role-based visibility:
   - Sidebar navigation shows/hides items based on user roles
   - Dashboard filters scoped by permissions
   - API calls filtered server-side by middleware

Add EN/FR translations for all notification titles, messages, role names, and settings labels.

Environment variables needed:
- TWILIO_ACCOUNT_SID
- TWILIO_AUTH_TOKEN
- TWILIO_PHONE_NUMBER (or per-store numbers from stores table)
```
