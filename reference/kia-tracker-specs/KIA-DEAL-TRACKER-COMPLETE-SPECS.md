# Kia Deal Tracker — Complete Project Specifications

> **All discussions, specs, planning documents, and configuration files for the Kia Mont-Laurier Deal Tracker project.**
> Generated: April 4, 2026

---

## Table of Contents

### Spec Files (11)
| # | File | Description |
|---|---|---|
| 1 | [Deal Pipeline Spec](#1-deal-pipeline-spec) | 10 pipeline stages, transition rules, lost reasons, parallel funding, nurture drip |
| 2 | [Pre-Delivery Checklist Spec](#2-pre-delivery-checklist-spec) | 10 checklist items, hard/soft blocks, IDV via CreditApp, manager override |
| 3 | [Delivery Tracker Spec](#3-delivery-tracker-spec) | Photo proof via email, cash/payment collection, trade-in, post-delivery drip |
| 4 | [Notifications & Automation Spec](#4-notifications--automation-spec) | 10 roles, permission matrix, 20 alerts, 3-tier urgency, Twilio SMS, stores table |
| 5 | [Inventory Command Center Spec](#5-inventory-command-center-spec) | Separate inventory table, VIN decode, cross-store with hidden costs, 6 required photos, recon workflow |
| 6 | [Garage / Work Orders Spec](#6-garage--work-orders-spec) | Garages per store, work orders with auto-email, safety/recon connection, cost tracking with rates |
| 7 | [Finance Desk Spec](#7-finance-desk-spec) | Lender submissions, payment calculator, lease calculator (Kia only), deal desking, F&I products per store |
| 8 | [Document Manager Spec](#8-document-manager-spec) | 13 document types, wet ink workflow, signed doc storage, auto-generate checklist, lease agreement |
| 9 | [Lead Manager Spec](#9-lead-manager-spec) | Weighted ad-spend distribution, Fluent Forms + Meta webhooks, 10-min reassignment, 90-day nurture, duplicates |
| 10 | [Chatbot Engine Spec](#10-chatbot-engine-spec) | SMS bot via Twilio, silent monitoring with AI analysis, F&I replies from CRM, drip sequences, voice Phase 2 |
| 11 | [Remaining Modules Specs](#11-remaining-modules-specs) | Driver dispatch upgrade, funding tracker, wholesale manager, reporting & analytics |

### Planning Files (2)
| # | File | Description |
|---|---|---|
| 12 | [Master Build Plan](#12-master-build-plan) | Original build plan with module overview and build order |
| 13 | [Gap Map](#13-gap-map) | Gap analysis — all discussion items (all now resolved) |

### Project Status Files (3)
| # | File | Description |
|---|---|---|
| 14 | [Built vs Plan](#14-built-vs-plan) | What's built vs. what's planned — module-by-module status |
| 15 | [Project Handoff](#15-project-handoff) | Full project handoff with tech stack, file structure, design system |
| 16 | [Research Notes](#16-research-notes) | UI/UX research across 8 CRM/DMS platforms |

### Claude Code Config Files (2)
| # | File | Description |
|---|---|---|
| 17 | [Operating Directives](#17-operating-directives) | "Execute don't ask" preamble for CLAUDE.md |
| 18 | [Decision Protocol](#18-decision-protocol) | Full decision protocol v4 (preamble + framework combined) |

---


---

# 1. Deal Pipeline Spec

# Deal Pipeline — Final Specification

## Pipeline Stages

| # | Stage | Color | What's happening | Moves here when... |
|---|---|---|---|---|
| 1 | **New** | Blue #3B82F6 | Fresh deal, no finance work started | Lead converts or deal created manually |
| 2 | **Submitted** | Indigo #6366F1 | Application sent to lenders | F&I submits to DealerTrack / Credit Up |
| 3 | **Approved** | Cyan #06B6D4 | Lender said yes — deal NOT locked in yet. Many deals die here. | Approval received (conditional or full) |
| 4 | **Signed** | Amber #F59E0B | Client signed all paperwork — deal is real | Docs signed via DocuSign / OneSpan |
| 5 | **Sourcing** | Violet #8B5CF6 | Vehicle being acquired from another dealership | Unit not in stock, needs pickup. **Skipped for in-stock units.** |
| 6 | **Pending delivery** | Teal #14B8A6 | Working on: safety, insurance, IDV, void cheque, wet ink | Vehicle in hand (in-stock or sourced unit arrived) |
| 7 | **Scheduled** | Emerald #10B981 | All pre-delivery items complete, date + drivers booked | Checklist 100% complete, delivery date set |
| 8 | **Delivered** | Green #22C55E | Car delivered, wet ink signed, photos taken | Driver confirms delivery |
| 9 | **Complete** | Gray #6B7280 | Everything done — delivered AND funded | Both delivery and funding confirmed |
| 10 | **Lost** | Red #EF4444 | Deal fell through at any stage | Cancelled, client backed out, declined |

---

## Parallel Track: Funding Status

Funding is NOT a pipeline stage — it runs in parallel and can happen before or after delivery.

**Funding status** (visible as a badge on every deal card regardless of stage):

| Status | Badge Color | Meaning |
|---|---|---|
| Not submitted | Gray | File not yet sent to bank |
| Submitted | Amber | File sent, waiting on bank |
| Stips required | Orange | Bank needs additional documents |
| Funded | Green | Bank has funded the deal |

**Interaction with pipeline:**
- A deal can be "Delivered" but funding status = "Submitted" (delivered before funded)
- A deal can be at "Pending delivery" but funding status = "Funded" (funded before delivered)
- A deal can only reach "Complete" when BOTH delivered = true AND funding status = "Funded"

---

## Transition Rules

### Skipping stages
Deals CAN skip stages that don't apply:
- **In-stock unit:** Signed → Pending delivery (skip Sourcing)
- Any stage can jump to Lost at any time

### Moving backward
Deals CAN move backward:
- Any user can move a deal backward (no manager-only restriction)
- Common backward moves:
  - Approved → Submitted (lender pulled approval, need to resubmit)
  - Signed → Approved (documents need to be redone)
  - Pending delivery → Signed (vehicle issue, need to change vehicle)

### Moving to Lost
- A deal can move to Lost from ANY stage
- Requires selecting a lost reason (see below)
- Lost deals trigger a client nurture drip (client goes back into sales follow-up)

### Moving to Complete
- Requires BOTH conditions:
  - Deal stage has reached "Delivered" (delivery confirmed)
  - Funding status = "Funded"
- If a deal is Delivered but not Funded, it stays at Delivered until funding is confirmed
- If a deal is Funded but not Delivered, it stays at its current stage until delivery happens
- System auto-moves to Complete when both conditions are met

---

## Lost Reasons

When a deal is marked as Lost, the user must select a reason from this list OR enter free text:

| # | Lost Reason |
|---|---|
| 1 | Client couldn't get approved |
| 2 | Client changed their mind |
| 3 | Client went to another dealer |
| 4 | Client not responding / ghosted |
| 5 | Vehicle no longer available |
| 6 | Payment too high |
| 7 | Trade-in value disagreement |
| 8 | Couldn't verify identity (IDV failed) |
| 9 | Other (free text) |

### Lost → Nurture Drip

When a deal is marked Lost:
1. The deal record stays in the system with Lost status and the reason
2. The client is automatically added back to a **sales nurture drip** — a follow-up sequence to re-engage them later
3. Nurture drip behavior (to be defined in Notifications & Automation module):
   - Automated follow-up texts/emails at intervals (e.g., 3 days, 7 days, 14 days, 30 days)
   - Different messaging based on lost reason:
     - "Couldn't get approved" → re-engage when new lender programs become available
     - "Payment too high" → notify when similar vehicle at lower price comes in
     - "Ghosted" → gentle check-in sequence
     - "Went to another dealer" → follow up to see if they're still looking
   - Client can be re-converted to a new deal at any point during the drip
   - Salesperson can manually stop the drip if the client asks to stop being contacted

---

## Kanban Board Specification

### Column layout
- One column per active stage (New through Delivered)
- "Complete" and "Lost" are hidden from the kanban by default (toggle to show)
- Each column header shows: stage name, deal count, total dollar value of deals in that stage

### Deal card on kanban
Each card shows:
- Client name (primary text)
- Vehicle: year make model (secondary text)
- Sale price or approval amount (dollar value, bold)
- Salesperson avatar/initials (bottom left)
- Days in current stage (bottom right, with aging color):
  - Green: < 3 days
  - Amber: 3–7 days
  - Red: > 7 days (deal is "rotting")
- Funding status badge (small pill: gray/amber/green)
- Source badge if sourced unit (small icon)

### Drag and drop
- Deals can be dragged between columns
- Dragging to Lost opens the lost reason selector before completing the move
- Dragging backward is allowed (no restrictions)
- Dragging to Complete is blocked unless both delivered + funded conditions are met (show tooltip explaining why)
- Skipping Sourcing is allowed for in-stock units

### View toggle
- **Kanban** (default) — columns by stage
- **List** — table view with sortable columns: client, vehicle, stage, salesperson, days in stage, sale price, funding status, created date
- Filter bar applies to both views: stage, salesperson, funding status, date range, sale type (retail/wholesale)

---

## Database Changes Required

### Modify `deals` table:

```sql
-- Replace current deal_status with new stage system
ALTER TABLE deals ADD COLUMN pipeline_stage TEXT DEFAULT 'new';
-- Values: 'new', 'submitted', 'approved', 'signed', 'sourcing', 'pending_delivery', 'scheduled', 'delivered', 'complete', 'lost'

-- Funding as parallel track
ALTER TABLE deals ADD COLUMN funding_status TEXT DEFAULT 'not_submitted';
-- Values: 'not_submitted', 'submitted', 'stips_required', 'funded'

-- Lost tracking
ALTER TABLE deals ADD COLUMN lost_reason TEXT;
ALTER TABLE deals ADD COLUMN lost_reason_detail TEXT; -- free text for "Other"
ALTER TABLE deals ADD COLUMN lost_at TIMESTAMPTZ;

-- Stage timing
ALTER TABLE deals ADD COLUMN stage_entered_at TIMESTAMPTZ DEFAULT NOW();
-- Updates every time pipeline_stage changes, used for "days in stage" and rotting indicator

-- Delivery confirmation
ALTER TABLE deals ADD COLUMN delivered_at TIMESTAMPTZ;
ALTER TABLE deals ADD COLUMN delivery_confirmed_by UUID;

-- Funding confirmation
ALTER TABLE deals ADD COLUMN funded_at TIMESTAMPTZ;
ALTER TABLE deals ADD COLUMN funding_confirmed_by UUID;
```

### New table for stage history (activity timeline):

```sql
CREATE TABLE deal_stage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  changed_by UUID REFERENCES users(id),
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  note TEXT -- optional note on why the stage changed
);
```

### Migration from old to new:

```sql
-- Map existing deal_status to new pipeline_stage
UPDATE deals SET pipeline_stage = CASE
  WHEN deal_status = 'cancelled' THEN 'lost'
  WHEN is_sold = true AND deal_status = 'complete' THEN 'complete'
  WHEN deal_status = 'complete' THEN 'delivered'
  WHEN deal_status = 'open' AND finance_status = 'funded' THEN 'pending_delivery'
  WHEN deal_status = 'open' AND finance_status = 'approved' THEN 'approved'
  WHEN deal_status = 'open' AND finance_status = 'pending' THEN 'submitted'
  ELSE 'new'
END;
```

---

## Prompt to Build This

```
Implement the deal pipeline stage system for the Kia Deal Tracker.

DATABASE:
1. Run the migration to add columns to deals table:
   - pipeline_stage (text, default 'new') with values: new, submitted, approved, signed, sourcing, pending_delivery, scheduled, delivered, complete, lost
   - funding_status (text, default 'not_submitted') with values: not_submitted, submitted, stips_required, funded
   - lost_reason, lost_reason_detail, lost_at
   - stage_entered_at (timestamptz, default now)
   - delivered_at, delivery_confirmed_by, funded_at, funding_confirmed_by

2. Create deal_stage_history table for tracking all stage changes

3. Migrate existing deals from old deal_status to new pipeline_stage using the mapping above

BACKEND (server/routes/deals.js):
1. Add PUT /api/deals/:id/stage endpoint that:
   - Updates pipeline_stage
   - Updates stage_entered_at to now
   - Inserts a record into deal_stage_history
   - If moving to Lost: requires lost_reason in body
   - If moving to Complete: validates that both delivered_at is set AND funding_status = 'funded'
   - Returns the updated deal

2. Add GET /api/deals/:id/history endpoint that returns all stage_history records for a deal

3. Update GET /api/deals to support filtering by pipeline_stage and funding_status

4. Update the stats/summary endpoint to group by pipeline_stage instead of deal_status

FRONTEND:
1. Update Dashboard.jsx to use pipeline_stage for all grouping and filtering
2. Add pipeline_stage to the filter bar (replace old deal_status filter)
3. Add funding_status as a badge on deal cards
4. Update DealForm.jsx to use new pipeline_stage field
5. Add a "Move to Lost" dialog that shows the lost reason picker (8 predefined reasons + Other with free text)
6. Add stage_entered_at display on deal cards for aging/rotting indicator:
   - Calculate days in current stage
   - Green < 3 days, amber 3-7 days, red > 7 days
7. Show deal_stage_history as a timeline in the deal detail view

Add EN/FR translations for all new stage names, funding statuses, and lost reasons.
```


---

# 2. Pre-Delivery Checklist Spec

# Pre-Delivery Checklist — Final Specification

## Overview

The pre-delivery checklist is the enforcement gate between "deal is signed" and "car gets delivered." Every item must be tracked. Most items are soft blocks (manager can override with a reason). One item is a hard block.

---

## Full Checklist Items

| # | Item | Block Type | Required For | File Upload? | Status Values |
|---|---|---|---|---|---|
| 1 | **Insurance** | Soft block | All deals | Yes (policy doc) | not_received → received → verified |
| 2 | **Void cheque** | Soft block | All financed deals | Yes (scan/photo) | not_received → received |
| 3 | **Funding** | Soft block | All financed deals | No (auto from funding tracker) | not_submitted → submitted → stips_required → funded |
| 4 | **IDV** | Soft block | All financed deals (not cash) | No (status tracking only) | not_sent → sent → completed → failed |
| 5 | **Safety inspection** | **HARD BLOCK** | All deals UNLESS sold as-is | Yes (inspection report) | not_started → sent_to_garage → in_progress → passed → failed |
| 6 | **Vehicle ready** | Soft block | All deals | No | not_ready → in_recon → ready |
| 7 | **Wet ink file** | Soft block | All deals | No | not_prepared → prepared → with_driver |
| 8 | **Delivery date** | Soft block | All deals | No | not_set → confirmed |
| 9 | **Drivers booked** | Soft block | All deals | No (auto from dispatch) | not_booked → booked → confirmed |
| 10 | **Registration** | Soft block | Ontario + Quebec deals only | Yes (registration doc) | not_started → in_progress → complete |

---

## Enforcement Rules

### Hard Block (cannot override)
- **Safety inspection** must be "passed" before delivery can proceed
- **Exception:** If the vehicle is flagged as **"sold as-is"**, safety is skipped entirely (item removed from checklist)
- No manager override exists for this — it's a legal requirement

### Soft Block (manager override available)
- All other 9 items are soft blocks
- If any soft-block item is incomplete, the "Schedule Delivery" button shows a warning with the list of incomplete items
- A manager can click "Override & Schedule" which:
  - Requires selecting their name (accountability)
  - Requires entering an override reason (free text)
  - Logs the override (who, when, why, which items were incomplete)
  - Allows delivery scheduling to proceed
- Override history is visible on the deal record and in audit reports

### Conditional Items
- **Void cheque** — not required for cash deals
- **Funding** — not required for cash deals
- **IDV** — not required for cash deals
- **Registration** — only required for Ontario and Quebec deals (based on client province)
- System auto-hides items that don't apply based on deal type and province

---

## IDV (Identity Verification) Workflow

### Platform
CreditApp IDV (creditapp.ca) — Canadian dealer finance platform with built-in biometric identity verification on government-issued IDs.

### Process
1. F&I agent clicks "Send IDV" in the deal → enters client's phone number or email
2. System records IDV status as "sent" with timestamp
3. Client receives a link from CreditApp on their phone
4. Client scans their government ID (driver's license, passport, etc.)
5. Client takes a selfie for biometric match
6. CreditApp verifies and returns pass/fail
7. F&I agent updates IDV status in the CRM to "completed" or "failed"
8. If failed: F&I agent can re-send (status resets to "sent") or escalate

### What the CRM tracks
- IDV status: not_sent / sent / completed / failed
- IDV sent at (timestamp)
- IDV sent to (phone or email)
- IDV completed at (timestamp)
- IDV attempts count (how many times sent)
- Notes (if failed, why — e.g., "ID expired", "photo mismatch")

### Future Integration
- No CreditApp API integration for now — status is tracked manually by F&I
- CreditApp has an Open API (per their website) — can integrate later for auto-status updates

---

## Insurance Tracking Details

| Field | Description |
|---|---|
| insurance_status | not_received / received / verified |
| insurance_provider | Company name (e.g., "Intact", "TD Insurance") |
| insurance_policy_number | Policy number |
| insurance_effective_date | When coverage starts — must be on or before delivery date |
| insurance_file_id | Uploaded policy document |
| insurance_verified_by | Who verified the insurance is valid |
| insurance_verified_at | When it was verified |

### Verification logic
- "Received" means the document was uploaded
- "Verified" means someone confirmed the policy is active, covers the correct vehicle, and the effective date is on or before the delivery date
- If insurance_effective_date is AFTER the scheduled delivery date, show a warning

---

## Void Cheque Tracking Details

| Field | Description |
|---|---|
| void_cheque_status | not_received / received |
| void_cheque_file_id | Uploaded scan/photo |
| void_cheque_received_at | When received |

---

## Safety Inspection Details

| Field | Description |
|---|---|
| safety_status | not_started / sent_to_garage / in_progress / passed / failed |
| safety_garage_name | Which garage (from garages table) |
| safety_sent_at | When sent to garage |
| safety_completed_at | When result received |
| safety_report_file_id | Uploaded inspection report |
| safety_notes | Notes from garage, reasons for failure |
| safety_province | ontario / quebec (determines inspection type) |

### Connection to Garage Work Orders
- When a safety work order is created and completed in the Garage module, it auto-updates the checklist safety_status
- If work order result = passed → safety_status = passed
- If work order result = failed → safety_status = failed with notes

### Sold As-Is Exception
- If deal has `sold_as_is = true`, the safety item is removed from the checklist entirely
- A "Sold As-Is" badge is shown on the deal card and detail view
- Requires a specific disclosure document in the Document Manager

---

## Wet Ink File Details

| Field | Description |
|---|---|
| wet_ink_status | not_prepared / prepared / with_driver |
| wet_ink_prepared_by | Who assembled the file |
| wet_ink_prepared_at | When assembled |
| wet_ink_contents | Checklist of documents included (from Document Manager) |
| wet_ink_given_to_driver_at | When handed to driver for delivery |

### Workflow
1. F&I or admin prints all physical documents that need wet ink signatures
2. Assembles them into the delivery file
3. Marks the file as "prepared" in the system
4. On delivery day, file is given to the driver → status changes to "with_driver"
5. After delivery, signed documents return → tracked in Document Manager as "signed" / "returned"

---

## Registration Details

| Field | Description |
|---|---|
| registration_status | not_started / in_progress / complete |
| registration_province | ontario / quebec / other |
| registration_required | boolean (true for ON/QC, false for other provinces) |
| registration_file_id | Uploaded registration document |
| registration_completed_at | When completed |

### Conditional logic
- Auto-set `registration_required = true` when client province is Ontario or Quebec
- Auto-set `registration_required = false` for all other provinces
- When not required, item is hidden from the checklist (doesn't count toward completion)

---

## UI Specification

### Checklist View (within Deal Detail)

```
Pre-Delivery Checklist                    [6 of 8 complete]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[=========================-------] 75%

🟢 Insurance ................ Verified        [View File]
🟢 Void cheque .............. Received        [View File]
🟡 Funding .................. Submitted       [View Status]
🟡 IDV ...................... Sent            [Resend] [Mark Complete]
🟢 Safety inspection ........ Passed   🔒     [View Report]
🟢 Vehicle ready ............ Ready
🔴 Wet ink file ............. Not prepared    [Mark Prepared]
🟢 Delivery date ............ Apr 12, 2026   [Change Date]
🟢 Drivers booked ........... Confirmed
--- (hidden: Registration — not required for this province) ---

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Schedule Delivery]  ⚠️ 2 items incomplete
                     - Funding: awaiting bank
                     - Wet ink: not prepared
                     [Override & Schedule ▸] (manager only)
```

### Status colors
- 🟢 Green = complete (verified / received / passed / funded / ready / confirmed / complete)
- 🟡 Amber = in progress (received but not verified / sent / submitted / in_progress / in_recon)
- 🔴 Red = not started (not_received / not_sent / not_submitted / not_started / not_prepared / not_set / not_booked)
- 🔒 Lock icon = hard block item (safety)

### Override Dialog
```
⚠️ Manager Override Required

The following items are incomplete:
  • Funding — Submitted (awaiting bank)
  • Wet ink file — Not prepared

Manager: [dropdown — select your name]
Reason for override: [free text, required]

[Cancel]  [Override & Schedule Delivery]
```

### Mobile Driver View
- Drivers need a simplified mobile page showing:
  - Delivery details (address, client name, phone)
  - Vehicle details (year/make/model/color)
  - Cash to collect (amount, method)
  - Wet ink file status (confirm they have it)
  - Photo upload buttons (delivery photos)
  - "Delivery Complete" confirmation button

---

## Database Changes

### Modify `delivery_checklists` table:

```sql
-- Insurance fields
ALTER TABLE delivery_checklists ADD COLUMN insurance_status TEXT DEFAULT 'not_received';
ALTER TABLE delivery_checklists ADD COLUMN insurance_provider TEXT;
ALTER TABLE delivery_checklists ADD COLUMN insurance_policy_number TEXT;
ALTER TABLE delivery_checklists ADD COLUMN insurance_effective_date DATE;
ALTER TABLE delivery_checklists ADD COLUMN insurance_file_id TEXT;
ALTER TABLE delivery_checklists ADD COLUMN insurance_verified_by UUID;
ALTER TABLE delivery_checklists ADD COLUMN insurance_verified_at TIMESTAMPTZ;

-- Void cheque fields
ALTER TABLE delivery_checklists ADD COLUMN void_cheque_status TEXT DEFAULT 'not_received';
ALTER TABLE delivery_checklists ADD COLUMN void_cheque_file_id TEXT;
ALTER TABLE delivery_checklists ADD COLUMN void_cheque_received_at TIMESTAMPTZ;

-- IDV fields
ALTER TABLE delivery_checklists ADD COLUMN idv_status TEXT DEFAULT 'not_sent';
ALTER TABLE delivery_checklists ADD COLUMN idv_sent_at TIMESTAMPTZ;
ALTER TABLE delivery_checklists ADD COLUMN idv_sent_to TEXT;
ALTER TABLE delivery_checklists ADD COLUMN idv_completed_at TIMESTAMPTZ;
ALTER TABLE delivery_checklists ADD COLUMN idv_attempts INTEGER DEFAULT 0;
ALTER TABLE delivery_checklists ADD COLUMN idv_notes TEXT;
ALTER TABLE delivery_checklists ADD COLUMN idv_required BOOLEAN DEFAULT true; -- false for cash deals

-- Safety fields (replace simple boolean)
ALTER TABLE delivery_checklists ADD COLUMN safety_status TEXT DEFAULT 'not_started';
ALTER TABLE delivery_checklists ADD COLUMN safety_garage_name TEXT;
ALTER TABLE delivery_checklists ADD COLUMN safety_sent_at TIMESTAMPTZ;
ALTER TABLE delivery_checklists ADD COLUMN safety_completed_at TIMESTAMPTZ;
ALTER TABLE delivery_checklists ADD COLUMN safety_report_file_id TEXT;
ALTER TABLE delivery_checklists ADD COLUMN safety_notes TEXT;
ALTER TABLE delivery_checklists ADD COLUMN safety_province TEXT; -- ontario / quebec
ALTER TABLE delivery_checklists ADD COLUMN safety_required BOOLEAN DEFAULT true; -- false for sold-as-is

-- Vehicle ready
ALTER TABLE delivery_checklists ADD COLUMN vehicle_ready_status TEXT DEFAULT 'not_ready';

-- Wet ink file
ALTER TABLE delivery_checklists ADD COLUMN wet_ink_status TEXT DEFAULT 'not_prepared';
ALTER TABLE delivery_checklists ADD COLUMN wet_ink_prepared_by UUID;
ALTER TABLE delivery_checklists ADD COLUMN wet_ink_prepared_at TIMESTAMPTZ;
ALTER TABLE delivery_checklists ADD COLUMN wet_ink_given_to_driver_at TIMESTAMPTZ;

-- Delivery date
ALTER TABLE delivery_checklists ADD COLUMN delivery_date_status TEXT DEFAULT 'not_set';
ALTER TABLE delivery_checklists ADD COLUMN delivery_date TIMESTAMPTZ;

-- Drivers
ALTER TABLE delivery_checklists ADD COLUMN drivers_status TEXT DEFAULT 'not_booked';

-- Registration
ALTER TABLE delivery_checklists ADD COLUMN registration_status TEXT DEFAULT 'not_started';
ALTER TABLE delivery_checklists ADD COLUMN registration_province TEXT;
ALTER TABLE delivery_checklists ADD COLUMN registration_required BOOLEAN DEFAULT true;
ALTER TABLE delivery_checklists ADD COLUMN registration_file_id TEXT;
ALTER TABLE delivery_checklists ADD COLUMN registration_completed_at TIMESTAMPTZ;

-- Sold as-is flag (on deals table)
ALTER TABLE deals ADD COLUMN sold_as_is BOOLEAN DEFAULT false;

-- Override tracking
CREATE TABLE checklist_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  overridden_by UUID REFERENCES users(id),
  override_reason TEXT NOT NULL,
  incomplete_items TEXT[] NOT NULL, -- array of item names that were incomplete
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## API Endpoints

```
GET    /api/deals/:id/checklist           — Get full checklist state for a deal
PUT    /api/deals/:id/checklist           — Update any checklist field(s)
GET    /api/deals/:id/checklist/readiness — Returns: { ready: bool, hard_blocks: [], soft_blocks: [], hidden_items: [] }
POST   /api/deals/:id/checklist/override  — Manager override (requires: manager_id, reason)
POST   /api/deals/:id/checklist/idv/send  — Record IDV sent (updates status, increments attempts)
GET    /api/deals/:id/checklist/overrides — Get override history for a deal
```

### Readiness endpoint logic

```javascript
// Hard blocks — cannot override
const hardBlocks = [];
if (checklist.safety_required && checklist.safety_status !== 'passed') {
  hardBlocks.push('Safety inspection not passed');
}

// Soft blocks — manager can override
const softBlocks = [];
if (checklist.insurance_status !== 'verified') softBlocks.push('Insurance not verified');
if (checklist.idv_required && checklist.idv_status !== 'completed') softBlocks.push('IDV not completed');
if (checklist.void_cheque_status !== 'received') softBlocks.push('Void cheque not received');
if (checklist.funding_status !== 'funded') softBlocks.push('Deal not funded');
if (checklist.vehicle_ready_status !== 'ready') softBlocks.push('Vehicle not ready');
if (checklist.wet_ink_status === 'not_prepared') softBlocks.push('Wet ink file not prepared');
if (checklist.delivery_date_status !== 'confirmed') softBlocks.push('Delivery date not confirmed');
if (checklist.drivers_status === 'not_booked') softBlocks.push('Drivers not booked');
if (checklist.registration_required && checklist.registration_status !== 'complete') {
  softBlocks.push('Registration not complete');
}

// Hidden items (don't count toward completion)
const hiddenItems = [];
if (!checklist.idv_required) hiddenItems.push('IDV (cash deal)');
if (!checklist.safety_required) hiddenItems.push('Safety (sold as-is)');
if (!checklist.registration_required) hiddenItems.push('Registration (not ON/QC)');

const ready = hardBlocks.length === 0 && softBlocks.length === 0;

return { ready, hard_blocks: hardBlocks, soft_blocks: softBlocks, hidden_items: hiddenItems };
```

---

## Prompt to Build This

```
Upgrade the Pre-Delivery Checklist for the Kia Deal Tracker.

CURRENT STATE: 4 items (insurance, funded, safety, registration) with basic file uploads and a compliance dashboard. Checklist tracks but does not enforce.

DATABASE:
1. Add all new columns to delivery_checklists table: [paste the ALTER TABLE statements above]
2. Add sold_as_is boolean to deals table
3. Create checklist_overrides table for tracking manager overrides

BACKEND (server/routes/deliveryChecklists.js):
1. Update GET /api/deals/:id/checklist to return all new fields
2. Update PUT /api/deals/:id/checklist to handle all new fields
3. Add GET /api/deals/:id/checklist/readiness endpoint that returns:
   { ready: boolean, hard_blocks: string[], soft_blocks: string[], hidden_items: string[] }
   - Hard blocks: safety_required && safety_status !== 'passed'
   - Soft blocks: all other incomplete items
   - Hidden items: items that don't apply (cash deal → hide IDV/void cheque/funding; sold as-is → hide safety; not ON/QC → hide registration)
4. Add POST /api/deals/:id/checklist/override — requires manager_id and reason, logs to checklist_overrides
5. Add POST /api/deals/:id/checklist/idv/send — records IDV sent status and increments attempts
6. Add GET /api/deals/:id/checklist/overrides — returns override history

FRONTEND:
1. Redesign DeliveryChecklist.jsx to show all 10 items as rows:
   - Each row: item name, status badge (red/amber/green), action button, file upload if applicable
   - Hard block items show a lock icon
   - Hidden items (not applicable) are collapsed with a note explaining why
   - Progress bar at top: "X of Y complete" with percentage

2. "Schedule Delivery" button at the bottom:
   - If hard blocks exist: button is disabled, tooltip shows hard block reasons
   - If only soft blocks exist: button shows warning with list of incomplete items + "Override & Schedule" button
   - If all complete: button is active with success styling
   
3. Override dialog:
   - Manager name dropdown
   - Free text reason (required)
   - List of items being overridden
   - On confirm: calls override endpoint, then allows scheduling

4. IDV section:
   - "Send IDV" button that opens a small form: enter client phone or email
   - Shows: status, sent date, attempts count
   - "Resend" button if already sent
   - "Mark Complete" and "Mark Failed" buttons for manual status update

5. Insurance section:
   - File upload for policy document
   - Fields for: provider name, policy number, effective date
   - "Verify" button that records who verified and when
   - Warning if effective date is after scheduled delivery date

6. Connect to existing systems:
   - Funding status auto-pulls from the deal's funding_status field (from pipeline spec)
   - Drivers status auto-pulls from dispatch system
   - Safety status auto-pulls from garage work orders (when built)

Add EN/FR translations for all new strings.
Add sold_as_is toggle to DealForm.jsx.
```


---

# 3. Delivery Tracker Spec

# Delivery Tracker — Final Specification

## Overview

The Delivery Tracker manages everything from the moment a driver leaves with the vehicle to post-delivery follow-up. Three core workflows: photo proof, cash/payment collection, and post-delivery automation.

---

## 1. Delivery Photo Proof

### How it works
Drivers email delivery photos to a **designated email address** with the **stock number in the subject line**. The system monitors the inbox, parses the subject, and auto-attaches photos to the correct deal.

### Email setup
- Designated address: `delivery@[yourdomain].com` (or similar)
- Subject line format: `[STOCK#]` — e.g., `A12345` or `Delivery A12345`
- System parses the stock number from the subject, matches to a deal, attaches all image files from the email

### Required photos (2 minimum)

| # | Photo | Purpose |
|---|---|---|
| 1 | **Client with vehicle** | Proof of delivery — client physically received the car |
| 2 | **Client's ID** | Identity confirmation at point of delivery |

### Photo processing logic
1. Incoming email arrives at designated address
2. System extracts stock number from subject line
3. System matches stock number to a deal record
4. All image attachments are saved to the deal's delivery photos
5. System records: upload timestamp, email sender, number of photos
6. If stock number not found or no images attached → email flagged for manual review
7. Once both required photos are received → delivery photo status = "complete"

### What the CRM tracks per delivery

| Field | Description |
|---|---|
| delivery_photos_status | not_received / partial / complete |
| delivery_photos | Array of photo URLs |
| delivery_photos_received_at | Timestamp of first photo received |
| delivery_photos_count | Number of photos attached |
| delivery_email_sender | Email address that sent the photos |
| delivery_photo_client_with_vehicle | Boolean — has this specific photo |
| delivery_photo_client_id | Boolean — has this specific photo |

### Fallback for failed parsing
- If the stock number can't be matched, the email goes to a "Review Queue"
- Admin can manually assign unmatched photos to a deal
- If no stock number in subject at all → flagged as "unmatched"

---

## 2. Cash & Down Payment Collection

### Payment methods supported

A single deal can have **multiple payment methods** for the down payment. Each payment is tracked individually.

| Method | When | Collected by | Proof |
|---|---|---|---|
| **E-transfer — before delivery** | Prior to delivery day | Office receives directly | Screenshot / confirmation number |
| **E-transfer — at delivery** | On delivery day | Client sends during delivery | Driver confirms receipt with office |
| **Physical cash** | At delivery | Driver collects | Driver photographs cash |
| **Bank draft / certified cheque** | At delivery or prior | Driver collects or client mails | Copy of draft/cheque |

### Cash collection workflow
1. Deal record specifies: down payment amount, method(s), and who collects
2. If physical cash: driver is informed of exact amount to collect (visible on their delivery info)
3. Driver counts cash at delivery
4. Driver photographs the cash (emails to same delivery photo address, or separate process)
5. Driver brings cash to admin office
6. Admin counts, confirms amount matches, issues receipt
7. Admin records: confirmed amount, receipt number, deposit date
8. If amount doesn't match expected → flagged for follow-up

### Database — new table: `deal_payments`

```
deal_payments
├── id (uuid, PK)
├── deal_id (uuid, FK → deals.id)
├── payment_type (enum: e_transfer_before, e_transfer_at_delivery, cash, bank_draft)
├── amount (numeric)
├── status (enum: expected, received, confirmed, deposited)
├── received_at (timestamptz, nullable)
├── received_by (text, nullable — driver name or "office")
├── confirmation_number (text, nullable — e-transfer ref or receipt #)
├── proof_file_id (text, nullable — photo of cash, screenshot, copy of draft)
├── confirmed_by (uuid, FK → users.id, nullable — admin who verified)
├── confirmed_at (timestamptz, nullable)
├── deposited_at (timestamptz, nullable)
├── deposit_reference (text, nullable — bank deposit slip reference)
├── notes (text, nullable)
├── created_at (timestamptz)
├── updated_at (timestamptz)
```

### Payment status flow

```
Expected → Received → Confirmed → Deposited
```

- **Expected:** Payment is logged on the deal with amount and method, not yet collected
- **Received:** Driver collected cash, or e-transfer arrived, or draft received
- **Confirmed:** Admin verified the amount is correct (for cash: counted and matched)
- **Deposited:** Money deposited in bank account, deposit reference recorded

### Deal-level payment summary

| Field | Description |
|---|---|
| total_down_payment | Total expected down payment amount |
| total_collected | Sum of all payments with status ≥ received |
| total_confirmed | Sum of all payments with status ≥ confirmed |
| total_deposited | Sum of all payments with status = deposited |
| payment_complete | Boolean — total_confirmed ≥ total_down_payment |
| outstanding_balance | total_down_payment - total_confirmed |

---

## 3. Trade-In at Delivery

### Process
1. If the deal has a trade-in, only **1 driver** is needed (drives delivery car out, drives trade-in back)
2. Driver does NOT inspect or photograph the trade-in at client's location
3. Driver brings the trade-in back to the lot
4. **Inspection happens at the lot** — used car manager or designated person inspects the trade-in after arrival
5. Trade-in inspection results are tracked on the inventory/deal record (connects to Inventory Command Center when built)

### What the CRM tracks

| Field | Description |
|---|---|
| trade_in_received | Boolean — has the trade-in physically arrived at the lot |
| trade_in_received_at | Timestamp |
| trade_in_received_by | Who received it (driver name) |
| trade_in_inspected | Boolean — has it been inspected |
| trade_in_inspected_at | Timestamp |
| trade_in_inspected_by | Who inspected (used car manager) |
| trade_in_condition_notes | Inspection notes — condition vs. what was expected |
| trade_in_condition_match | Boolean — does condition match what was agreed with client |

### Condition mismatch handling
- If trade-in condition does NOT match what was agreed (undisclosed damage, higher mileage, missing keys, etc.):
  - Flag the deal for follow-up
  - Alert the salesperson and sales manager
  - Record the discrepancy for potential client callback

---

## 4. Delivery Confirmation

### What marks a delivery as "confirmed"
The delivery is confirmed when:
1. Vehicle physically delivered to client ✓
2. Wet ink documents signed by client ✓
3. Delivery photos received (client with vehicle + client ID) ✓
4. Cash/payment collected (if applicable) ✓
5. Trade-in received back (if applicable) ✓

### Driver delivery completion
- Driver (or admin) marks "Delivery Complete" on the deal
- System records: who confirmed, timestamp
- If any items above are missing, system shows warnings but doesn't hard-block confirmation
- Deal pipeline stage auto-moves from "Scheduled" → "Delivered"

### Delivery record

| Field | Description |
|---|---|
| delivery_status | scheduled / in_progress / completed / failed |
| delivery_scheduled_date | When delivery was planned |
| delivery_actual_date | When delivery actually happened |
| delivery_completed_at | Confirmation timestamp |
| delivery_completed_by | Who marked it complete |
| delivery_driver_names | Name(s) of driver(s) |
| delivery_address | Where the car was delivered |
| delivery_notes | Any notes from the delivery |
| delivery_failed_reason | If delivery failed — why (client not home, refused, etc.) |

---

## 5. Post-Delivery Automation

### Trigger
- Fires on the **next business day** after delivery is confirmed
- "Next business day" = next weekday (skip Saturday/Sunday)
- Triggered automatically — no manual action required

### Actions (in order)

| # | Action | Channel | Timing | Content |
|---|---|---|---|---|
| 1 | **Thank you message** | Text (SMS) or email based on client preference | Next business day, 10:00 AM | Thank you for your purchase, enjoy your [vehicle]. Contact us if you need anything. |
| 2 | **Chatbot drip enrollment** | Automated | Same time | Client added to post-delivery chatbot drip sequence for ongoing engagement |

### Chatbot post-delivery drip (sequence to be defined in Chatbot Engine module)
- Purpose: maintain relationship, generate referrals, upsell service appointments
- Example cadence:
  - Day 1 (next business day): Thank you message
  - Day 7: "How's the new car? Any questions?"
  - Day 30: Service reminder / first oil change
  - Day 90: Referral ask
  - Day 180: Trade-up opportunity check
  - Ongoing: seasonal promotions, service specials
- Client can opt out at any time
- Drip stops if client starts a new deal (re-enters the sales pipeline)

### What the CRM tracks

| Field | Description |
|---|---|
| post_delivery_thankyou_sent | Boolean |
| post_delivery_thankyou_sent_at | Timestamp |
| post_delivery_thankyou_channel | text / email |
| post_delivery_drip_enrolled | Boolean |
| post_delivery_drip_enrolled_at | Timestamp |
| post_delivery_drip_status | active / paused / opted_out / converted |

---

## 6. Failed Delivery Handling

Sometimes deliveries fail — client isn't home, refuses the vehicle, or there's a last-minute problem.

| Failure Reason | Action |
|---|---|
| Client not home / no-show | Reschedule — deal stays at "Scheduled" stage |
| Client refuses vehicle | Salesperson follow-up, deal may go to Lost |
| Vehicle issue discovered on arrival | Vehicle goes back, deal moves back to "Pending delivery" |
| Wrong documents / missing wet ink | Driver returns, reschedule with correct documents |

### What the CRM tracks
- delivery_status = "failed"
- delivery_failed_reason (selected from list + free text)
- Deal stage does NOT auto-move to "Delivered" — stays at current stage
- Reschedule action available immediately

---

## Database Changes

### New table: `deal_payments`
```sql
CREATE TABLE deal_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  payment_type TEXT NOT NULL, -- 'e_transfer_before', 'e_transfer_at_delivery', 'cash', 'bank_draft'
  amount NUMERIC NOT NULL,
  status TEXT DEFAULT 'expected', -- 'expected', 'received', 'confirmed', 'deposited'
  received_at TIMESTAMPTZ,
  received_by TEXT,
  confirmation_number TEXT,
  proof_file_id TEXT,
  confirmed_by UUID REFERENCES users(id),
  confirmed_at TIMESTAMPTZ,
  deposited_at TIMESTAMPTZ,
  deposit_reference TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### New table: `delivery_photos`
```sql
CREATE TABLE delivery_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  photo_type TEXT, -- 'client_with_vehicle', 'client_id', 'cash', 'other'
  url TEXT NOT NULL,
  source_email TEXT, -- email address that sent the photo
  received_at TIMESTAMPTZ DEFAULT NOW()
);
```

### New columns on `deals` table:
```sql
-- Delivery confirmation
ALTER TABLE deals ADD COLUMN delivery_status TEXT DEFAULT 'scheduled';
ALTER TABLE deals ADD COLUMN delivery_scheduled_date TIMESTAMPTZ;
ALTER TABLE deals ADD COLUMN delivery_actual_date TIMESTAMPTZ;
ALTER TABLE deals ADD COLUMN delivery_completed_at TIMESTAMPTZ;
ALTER TABLE deals ADD COLUMN delivery_completed_by UUID;
ALTER TABLE deals ADD COLUMN delivery_driver_names TEXT;
ALTER TABLE deals ADD COLUMN delivery_address TEXT;
ALTER TABLE deals ADD COLUMN delivery_notes TEXT;
ALTER TABLE deals ADD COLUMN delivery_failed_reason TEXT;
ALTER TABLE deals ADD COLUMN delivery_photos_status TEXT DEFAULT 'not_received';

-- Trade-in at delivery
ALTER TABLE deals ADD COLUMN trade_in_received BOOLEAN DEFAULT false;
ALTER TABLE deals ADD COLUMN trade_in_received_at TIMESTAMPTZ;
ALTER TABLE deals ADD COLUMN trade_in_received_by TEXT;
ALTER TABLE deals ADD COLUMN trade_in_inspected BOOLEAN DEFAULT false;
ALTER TABLE deals ADD COLUMN trade_in_inspected_at TIMESTAMPTZ;
ALTER TABLE deals ADD COLUMN trade_in_inspected_by TEXT;
ALTER TABLE deals ADD COLUMN trade_in_condition_notes TEXT;
ALTER TABLE deals ADD COLUMN trade_in_condition_match BOOLEAN;

-- Down payment tracking
ALTER TABLE deals ADD COLUMN total_down_payment NUMERIC DEFAULT 0;
ALTER TABLE deals ADD COLUMN down_payment_complete BOOLEAN DEFAULT false;

-- Post-delivery
ALTER TABLE deals ADD COLUMN post_delivery_thankyou_sent BOOLEAN DEFAULT false;
ALTER TABLE deals ADD COLUMN post_delivery_thankyou_sent_at TIMESTAMPTZ;
ALTER TABLE deals ADD COLUMN post_delivery_thankyou_channel TEXT;
ALTER TABLE deals ADD COLUMN post_delivery_drip_enrolled BOOLEAN DEFAULT false;
ALTER TABLE deals ADD COLUMN post_delivery_drip_enrolled_at TIMESTAMPTZ;
ALTER TABLE deals ADD COLUMN post_delivery_drip_status TEXT DEFAULT 'active';
```

---

## API Endpoints

```
# Delivery
GET    /api/deals/:id/delivery           — Get full delivery state
PUT    /api/deals/:id/delivery           — Update delivery fields
POST   /api/deals/:id/delivery/complete  — Mark delivery confirmed (validates all items, moves deal to Delivered stage)
POST   /api/deals/:id/delivery/fail      — Mark delivery failed with reason

# Photos
GET    /api/deals/:id/delivery/photos    — Get all delivery photos for a deal
POST   /api/deals/:id/delivery/photos    — Manually upload a delivery photo
POST   /api/delivery-photos/ingest       — Webhook/cron endpoint: parse delivery email inbox, match photos to deals
GET    /api/delivery-photos/unmatched    — Get all unmatched photos (failed to parse stock #)
PUT    /api/delivery-photos/:id/assign   — Manually assign an unmatched photo to a deal

# Payments
GET    /api/deals/:id/payments           — Get all payments for a deal
POST   /api/deals/:id/payments           — Add a payment record
PUT    /api/payments/:id                 — Update payment (status, confirmation #, etc.)
GET    /api/deals/:id/payments/summary   — Returns: total expected, collected, confirmed, deposited, outstanding

# Trade-in
PUT    /api/deals/:id/trade-in/received  — Mark trade-in as received
PUT    /api/deals/:id/trade-in/inspected — Record inspection results

# Post-delivery
POST   /api/deals/:id/post-delivery/trigger — Manually trigger post-delivery sequence (auto runs next business day)
```

---

## UI Specification

### Delivery Section (within Deal Detail)

**Delivery Status Bar:**
```
Delivery Status: Scheduled — Apr 12, 2026
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Drivers: Ali + Hassan    |    Address: 123 Bank St, Ottawa ON
```

**Delivery Proof Section:**
```
📸 Delivery Photos                    [2 of 2 received]
┌──────────────────┬──────────────────┐
│ Client + Vehicle │   Client ID      │
│   🟢 Received    │   🟢 Received    │
│   [thumbnail]    │   [thumbnail]    │
└──────────────────┴──────────────────┘
Source: photos emailed from driver@company.com at 2:34 PM
```

**Payment Section:**
```
💰 Down Payment                    $3,000 of $5,000 collected
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  E-transfer (before)    $2,000   🟢 Confirmed    Ref: ET-34829
  Cash (at delivery)     $1,000   🟡 Received     [photo]  [Confirm]
  Bank draft             $2,000   🔴 Expected     Due at delivery

  Outstanding: $2,000
  [+ Add Payment]
```

**Trade-In Section (if applicable):**
```
🔄 Trade-In: 2019 Honda Civic
  Received back:    🟢 Yes — Apr 12, 3:45 PM by Ali
  Inspected:        🟡 Pending
  [Mark Inspected]
```

**Post-Delivery Section:**
```
📬 Post-Delivery Follow-Up
  Thank you message:   🟢 Sent Apr 13 at 10:00 AM via text
  Chatbot drip:        🟢 Active — enrolled Apr 13
```

### Delivery Complete Button
```
[✓ Confirm Delivery Complete]

Checklist before confirming:
  ✅ Vehicle delivered
  ✅ Wet ink signed
  ✅ Photos received (2/2)
  ⚠️ Cash payment received but not confirmed ($1,000)
  ✅ Trade-in received

[Confirm Anyway]  [Wait for Payments]
```

### Unmatched Photos Queue (Admin View)
```
📸 Unmatched Delivery Photos         [3 photos]

  Photo 1 — from driver@company.com — Apr 12, 2:30 PM
  Subject: "Delivery" (no stock #)
  [View] [Assign to Deal ▾]

  Photo 2 — from ali@drivers.com — Apr 12, 3:15 PM  
  Subject: "X99999" (stock # not found)
  [View] [Assign to Deal ▾]
```

---

## Email Ingestion Setup

### Option A: Resend Inbound (recommended — already using Resend)
- Configure a Resend inbound webhook on the delivery email address
- Incoming emails hit POST /api/delivery-photos/ingest
- System parses subject for stock number, extracts image attachments, saves to storage, links to deal

### Option B: IMAP polling (fallback)
- Cron job checks the email inbox every 2 minutes
- Parses new emails, processes attachments, marks emails as read
- Less real-time but works with any email provider

### Email parsing logic
```
1. Extract subject line
2. Find stock number pattern (alphanumeric, 4-10 chars)
3. Match against deals.stock_number
4. If match found:
   - Save all image attachments to storage (Supabase Storage)
   - Create delivery_photos records linked to the deal
   - Update deal.delivery_photos_status
   - If 2+ photos received → status = "complete"
5. If no match:
   - Save photos to "unmatched" queue
   - Admin can manually assign later
```

---

## Prompt to Build This

```
Build the Delivery Tracker module for the Kia Deal Tracker.

DATABASE:
1. Create deal_payments table: [paste SQL above]
2. Create delivery_photos table: [paste SQL above]
3. Add delivery columns to deals table: [paste ALTER statements above]

BACKEND:

1. Create server/routes/delivery.js with endpoints:
   - GET/PUT /api/deals/:id/delivery — delivery state
   - POST /api/deals/:id/delivery/complete — validates delivery items, moves deal pipeline_stage to "delivered", sets delivered_at
   - POST /api/deals/:id/delivery/fail — records failure reason, keeps deal at current stage

2. Create server/routes/deliveryPhotos.js:
   - POST /api/delivery-photos/ingest — webhook endpoint for incoming emails from Resend inbound
     - Parses subject line for stock number
     - Matches to deal by stock_number
     - Saves image attachments to Supabase Storage
     - Creates delivery_photos records
     - Updates deal.delivery_photos_status (not_received / partial / complete)
     - If no match → saves to unmatched queue
   - GET /api/delivery-photos/unmatched — admin view of unmatched photos
   - PUT /api/delivery-photos/:id/assign — manually assign unmatched photo to a deal

3. Create server/routes/payments.js:
   - CRUD for deal_payments
   - GET /api/deals/:id/payments/summary — returns total expected, collected, confirmed, deposited, outstanding balance
   - When a payment status changes to "confirmed", recalculate deal.down_payment_complete

4. Update server/routes/deals.js:
   - PUT /api/deals/:id/trade-in/received — marks trade-in received with timestamp
   - PUT /api/deals/:id/trade-in/inspected — records inspection results and condition match

5. Create server/services/postDelivery.js:
   - Function that runs on a schedule (cron or Supabase function)
   - Checks for deals delivered yesterday (or last business day if Monday)
   - For each: sends thank-you message via Resend, enrolls in chatbot drip
   - Records post_delivery_thankyou_sent and post_delivery_drip_enrolled on the deal

FRONTEND:

1. Create DeliverySection.jsx — section within DealDetail showing:
   - Delivery status bar (date, drivers, address)
   - Photo proof grid: 2 required photo slots with thumbnails, status badges, source email
   - Payment section: list of all payments with status, add payment form, summary (expected/collected/confirmed/outstanding)
   - Trade-in section (if has_trade_in): received status, inspection status, condition notes
   - Post-delivery section: thank you message status, chatbot drip status
   - "Confirm Delivery Complete" button with pre-confirmation checklist

2. Create UnmatchedPhotos.jsx — admin page showing photos that couldn't be auto-matched
   - Photo preview, source email, subject line
   - Deal selector dropdown to manually assign

3. Create PaymentForm.jsx — form to add a payment:
   - Payment type dropdown (e-transfer before, e-transfer at delivery, cash, bank draft)
   - Amount
   - Status
   - Confirmation number (for e-transfers)
   - File upload for proof (cash photo, draft copy)

4. Add "Unmatched Photos" to admin/settings area
5. Integrate DeliverySection into DealDetail.jsx as a tab

Add EN/FR translations for all new strings.
```


---

# 4. Notifications & Automation Spec

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


---

# 5. Inventory Command Center Spec

# Inventory Command Center — Final Specification

## Overview

Standalone inventory system where vehicles exist independently of deals. Vehicles can be stocked, tracked, photographed, reconditioned, and managed before a buyer ever exists. This is the single screen where GM, used car manager, and wholesale manager live.

---

## Architecture Decision: SEPARATE INVENTORY TABLE ✅

Vehicles live on their own `inventory` table, not on `deals`. A deal LINKS to an inventory record via `inventory_id`. This means:
- A vehicle can exist in inventory with no deal attached (speculative buy, auction purchase, trade-in not yet listed)
- A deal references an inventory record for vehicle details (no duplication)
- When a trade-in comes back from a delivery, the system auto-creates an inventory record
- Inventory status and deal status are tracked independently

---

## Cross-Store Visibility

| Role | Own Store Inventory | Other Stores' Inventory |
|---|---|---|
| Owner | Full access (all fields including cost) | Full access (all fields including cost) |
| GM | Full access (all fields including cost) | Can SEE vehicles but NOT cost fields |
| Used Car Manager | Full access | Can SEE vehicles but NOT cost fields |
| Wholesale Manager | Full access | Can SEE vehicles but NOT cost fields |
| Salesperson | Can see vehicles (no cost) | Can see vehicles (no cost) |

### Hidden fields for cross-store viewing
When viewing another store's inventory, these fields are hidden:
- acquisition_cost
- transport_cost
- recon_cost
- total_invested
- list_price (internal)
- profit margin

### Internal Wholesale Between Stores
- Vehicles can be sold from one store to another at a price
- This is treated as an internal wholesale transaction
- Buying store creates a new inventory record at their acquisition cost (the wholesale price)
- Selling store marks the vehicle as "sold — internal wholesale"

---

## VIN Decoding

### API: NHTSA vPIC (free, works for US + Canadian vehicles)

**Endpoint:** `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/{VIN}?format=json`

**Flow:**
1. User enters a VIN in the inventory form
2. System calls NHTSA API
3. Auto-populates: year, make, model, trim, body type, engine, drive type, fuel type, doors, country of origin
4. User reviews and can edit any auto-filled field
5. If VIN decode fails (invalid VIN, API down), user enters manually

**NPM package:** `@shaggytools/nhtsa-api-wrapper` — lightweight wrapper with TypeScript support

**Fields auto-populated from VIN decode:**

| Field | NHTSA Variable |
|---|---|
| year | ModelYear |
| make | Make |
| model | Model |
| trim | Trim |
| body_type | BodyClass |
| engine | DisplacementL + EngineConfiguration + FuelTypePrimary |
| drive_type | DriveType |
| doors | Doors |
| country | PlantCountry |

---

## Vehicle Intake Process

### Who enters vehicles
- Used car manager OR admin/office staff

### How vehicles enter the system

| Source | How it enters | What happens |
|---|---|---|
| **Auction purchase** | Manual entry + VIN decode | New inventory record, acquisition_type = "auction" |
| **Dealer trade** | Manual entry + VIN decode | New inventory record, acquisition_type = "dealer_trade" |
| **Customer trade-in** | **Auto-created** from deal delivery | System creates inventory record when trade-in is received back at lot |
| **Internal wholesale (from another store)** | Manual entry | New inventory record at buying store, acquisition_type = "internal_wholesale" |
| **Consignment** | Manual entry | New inventory record, acquisition_type = "consignment" |

### Trade-in auto-creation
When a deal's trade-in is marked as "received" (from the Delivery Tracker):
1. System auto-creates an inventory record with:
   - Vehicle details copied from the deal's trade-in fields
   - acquisition_type = "trade_in"
   - acquisition_cost = trade-in allowance from the deal
   - location_status = "on_lot"
   - acquisition_date = trade_in_received_at
   - deal_id linked to the originating deal
   - store_id = same store as the deal
2. Inventory record needs: VIN decode (if VIN available), photos, inspection, recon decision

---

## Photo Management

### Required photos (5 minimum)

| # | Angle | Required |
|---|---|---|
| 1 | Front | ✅ |
| 2 | Back | ✅ |
| 3 | Driver side | ✅ |
| 4 | Passenger side | ✅ |
| 5 | Interior (dashboard) | ✅ |
| 6 | Odometer | ✅ |
| 7+ | Additional (damage, features, trunk, etc.) | Optional |

### Photo compliance
- Minimum 6 required photos before vehicle is considered "photo complete"
- Each required angle is tracked individually (has/doesn't have)
- Missing photos flagged: 48 hours after vehicle arrives on lot with < 6 photos → alert used car manager
- Photo count and completion status visible on vehicle card

### Photo upload
- Drag-and-drop upload in the inventory detail view
- Each photo tagged with its angle type on upload
- Photos stored in Supabase Storage
- Thumbnails generated for grid/card views

---

## Reconditioning Workflow

### Standard inspection checklist (evaluated on arrival)

| Category | Check Items |
|---|---|
| **Mechanical** | Engine, transmission, brakes, suspension, steering, exhaust, AC, battery |
| **Body** | Paint, dents, scratches, rust, bumpers, trim, glass, mirrors, lights |
| **Interior** | Seats, carpet, headliner, dash, controls, gauges, electronics, smell |
| **Tires** | Tread depth, condition, matching, spare |
| **Safety** | Wipers, horn, seatbelts, airbag light, ABS light |

### Recon decision process
1. Vehicle arrives → used car manager or designee does a walk-around using the standard checklist
2. Checklist results determine what recon is needed
3. Categories of recon needed are recorded: mechanical, body, detailing, tires, glass, other
4. If estimated recon cost **exceeds the store's threshold** (default $2,000) → requires GM approval before work order is sent
5. If under threshold → work order can be sent directly to the garage
6. Recon work is tracked via the Garage Work Orders module

### Recon status flow

```
not_needed → needs_assessment → assessed → recon_approved → in_progress → complete
```

- **not_needed:** Vehicle doesn't need any recon (rare — maybe new car)
- **needs_assessment:** Vehicle arrived, inspection not yet done
- **assessed:** Inspection done, recon items identified with cost estimate
- **recon_approved:** Cost approved (auto if under threshold, GM approval if over)
- **in_progress:** Work orders sent to garage, work underway
- **complete:** All recon work done, vehicle is lot-ready

---

## Database

### New table: `inventory`

```sql
CREATE TABLE inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id) NOT NULL,

  -- Vehicle identification
  vin TEXT UNIQUE,
  stock_number TEXT UNIQUE NOT NULL,
  year INTEGER NOT NULL,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  trim TEXT,
  body_type TEXT,
  engine TEXT,
  drive_type TEXT,
  fuel_type TEXT,
  doors INTEGER,
  exterior_color TEXT,
  interior_color TEXT,
  mileage INTEGER,
  country_of_origin TEXT,

  -- Classification
  vehicle_type TEXT DEFAULT 'used', -- 'new', 'used'
  acquisition_type TEXT NOT NULL, -- 'auction', 'dealer_trade', 'trade_in', 'internal_wholesale', 'consignment'
  acquisition_date DATE NOT NULL DEFAULT CURRENT_DATE,
  acquisition_cost NUMERIC NOT NULL DEFAULT 0,
  transport_cost NUMERIC DEFAULT 0,
  recon_cost NUMERIC DEFAULT 0,
  total_invested NUMERIC GENERATED ALWAYS AS (acquisition_cost + transport_cost + recon_cost) STORED,
  list_price NUMERIC,

  -- Location tracking
  location_status TEXT DEFAULT 'on_lot', -- 'at_source', 'in_transit', 'on_lot', 'at_garage', 'delivered', 'wholesale'
  location_details TEXT, -- which garage, which source dealership, etc.

  -- Safety
  safety_status TEXT DEFAULT 'not_started', -- 'not_required', 'not_started', 'sent_to_garage', 'in_progress', 'passed', 'failed'
  safety_sent_at TIMESTAMPTZ,
  safety_completed_at TIMESTAMPTZ,
  safety_province TEXT, -- 'ontario', 'quebec'
  safety_notes TEXT,

  -- Recon
  recon_status TEXT DEFAULT 'needs_assessment', -- 'not_needed', 'needs_assessment', 'assessed', 'recon_approved', 'in_progress', 'complete'
  recon_items JSONB DEFAULT '[]', -- [{category, description, estimated_cost, actual_cost, status}]
  recon_estimated_total NUMERIC DEFAULT 0,
  recon_approval_required BOOLEAN DEFAULT false, -- true if estimated > threshold
  recon_approved_by UUID REFERENCES users(id),
  recon_approved_at TIMESTAMPTZ,

  -- Photos
  photo_count INTEGER DEFAULT 0,
  photo_complete BOOLEAN DEFAULT false, -- true when all 6 required angles present
  photos_front BOOLEAN DEFAULT false,
  photos_back BOOLEAN DEFAULT false,
  photos_driver_side BOOLEAN DEFAULT false,
  photos_passenger_side BOOLEAN DEFAULT false,
  photos_interior BOOLEAN DEFAULT false,
  photos_odometer BOOLEAN DEFAULT false,

  -- Deal linkage
  deal_id UUID REFERENCES deals(id), -- linked deal if sold/reserved
  deal_status TEXT DEFAULT 'available', -- 'available', 'reserved', 'sold_pending', 'delivered', 'wholesale'

  -- Trade-in origin (if this vehicle came from a trade-in)
  source_deal_id UUID REFERENCES deals(id), -- the deal this trade-in came from

  -- Internal wholesale
  sold_to_store_id UUID REFERENCES stores(id), -- if wholesaled to another store
  internal_wholesale_price NUMERIC,

  -- Aging
  days_in_stock INTEGER GENERATED ALWAYS AS (CURRENT_DATE - acquisition_date) STORED,

  -- Metadata
  notes TEXT,
  entered_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_inventory_store ON inventory(store_id);
CREATE INDEX idx_inventory_status ON inventory(location_status);
CREATE INDEX idx_inventory_deal_status ON inventory(deal_status);
CREATE INDEX idx_inventory_days ON inventory(days_in_stock);
CREATE INDEX idx_inventory_vin ON inventory(vin);
CREATE INDEX idx_inventory_stock ON inventory(stock_number);
```

### New table: `inventory_photos`

```sql
CREATE TABLE inventory_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id UUID REFERENCES inventory(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  angle TEXT, -- 'front', 'back', 'driver_side', 'passenger_side', 'interior', 'odometer', 'other'
  uploaded_by UUID REFERENCES users(id),
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_inv_photos ON inventory_photos(inventory_id);
```

### New table: `recon_checklist`

```sql
CREATE TABLE recon_checklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id UUID REFERENCES inventory(id) ON DELETE CASCADE,
  category TEXT NOT NULL, -- 'mechanical', 'body', 'interior', 'tires', 'safety'
  item TEXT NOT NULL, -- specific check item
  condition TEXT DEFAULT 'not_checked', -- 'not_checked', 'good', 'needs_work', 'urgent'
  notes TEXT,
  checked_by UUID REFERENCES users(id),
  checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Modify `deals` table

```sql
-- Add link to inventory
ALTER TABLE deals ADD COLUMN inventory_id UUID REFERENCES inventory(id);
```

---

## API Endpoints

```
# Inventory CRUD
GET    /api/inventory                    — List all (filtered by user's store scope + permissions)
GET    /api/inventory/:id                — Single vehicle (cost fields hidden if cross-store + not owner)
POST   /api/inventory                    — Create vehicle
PUT    /api/inventory/:id                — Update vehicle
DELETE /api/inventory/:id                — Soft delete / archive

# VIN Decode
POST   /api/inventory/vin-decode         — Send VIN, returns decoded vehicle data from NHTSA

# Photos
GET    /api/inventory/:id/photos         — Get all photos for a vehicle
POST   /api/inventory/:id/photos         — Upload photos (multipart, with angle tag)
DELETE /api/inventory/:id/photos/:photoId — Remove a photo
GET    /api/inventory/photo-compliance   — Vehicles missing required photos

# Recon
GET    /api/inventory/:id/recon          — Get recon checklist and status
POST   /api/inventory/:id/recon/assess   — Submit inspection checklist results
PUT    /api/inventory/:id/recon/approve  — GM approves recon (when over threshold)
PUT    /api/inventory/:id/recon/complete — Mark recon as complete, update recon_cost with actuals

# Views / Reports
GET    /api/inventory/stats              — Totals: units by location, avg days, total invested
GET    /api/inventory/aging              — Units sorted by days_in_stock desc
GET    /api/inventory/garage-queue       — Units at garage or waiting for garage
GET    /api/inventory/incoming           — Units in transit or at source
GET    /api/inventory/wholesale          — Units flagged for wholesale
GET    /api/inventory/photo-compliance   — Units missing required photos

# Cross-store
GET    /api/inventory/all-stores         — Owner only: all inventory across stores
GET    /api/inventory/store/:storeId     — View another store's inventory (cost hidden for non-owners)

# Internal wholesale
POST   /api/inventory/:id/wholesale-to-store — Sell vehicle to another store at a price
```

---

## Dashboard Views

### View toggle: Pipeline | Grid | Table | Aging

**Pipeline view (default for used car manager)**
Kanban columns by location_status:

```
At Source → In Transit → On Lot → At Garage → Ready → Sold Pending → Delivered
```

Each column header: status name, unit count, total invested $
Drag-and-drop between columns to update location_status

**Grid view (photo-centric)**
Card grid with large photo thumbnails:
```
┌─────────────────────────┐
│ [PHOTO]                 │
│ 2022 Kia Forte LX       │
│ Stock: A12345            │
│ 📍 On Lot  🛡️ Passed    │
│ 📸 5/6    📅 12 days     │
│ $18,500 list             │
└─────────────────────────┘
```

**Table view (GM / financial review)**
Sortable columns:

| Stock # | Year | Make | Model | VIN | Location | Safety | Recon | Photos | Days | Cost | List | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|

**Aging view (wholesale manager)**
Same as table but sorted by days_in_stock descending, with row colors:
- Green: < 30 days
- Amber: 30–60 days
- Red: > 60 days

### Stats Bar (top of dashboard)

```
Total Units: 47   |   On Lot: 28   |   At Garage: 6   |   In Transit: 4   |   At Source: 3   |   Sold Pending: 6
Avg Days in Stock: 22   |   Total Invested: $612,400   |   Units > 30 Days: 8 ⚠️
```

### Filters

| Filter | Options |
|---|---|
| Store | (for owner: all stores or specific store) |
| Location | at_source, in_transit, on_lot, at_garage, ready, sold_pending, delivered |
| Safety | not_started, in_progress, passed, failed |
| Recon | needs_assessment, assessed, in_progress, complete |
| Deal status | available, reserved, sold_pending |
| Vehicle type | new, used |
| Acquisition | auction, dealer_trade, trade_in, internal_wholesale, consignment |
| Days in stock | range slider |
| Photo status | complete, incomplete |
| Make | dropdown |

---

## Vehicle Detail (Slide-Out Panel)

### Sections

**Header:**
```
2022 Kia Forte LX                    Stock: A12345
VIN: 3KPF24AD5NE123456               📍 On Lot — 12 days
```

**Photo Gallery:**
- 6 required slots (front, back, driver, passenger, interior, odometer) + additional
- Upload button per slot
- Drag-and-drop multi-upload
- Missing angles highlighted in red
- Full-screen lightbox on click

**Vehicle Details:**
- Year, make, model, trim, body type
- Engine, drive type, fuel type, doors
- Exterior/interior color, mileage
- VIN, stock number
- Acquisition type, acquisition date, source details

**Financials (hidden cross-store for non-owners):**
- Acquisition cost
- Transport cost
- Recon cost (estimated + actual)
- Total invested
- List price
- Expected margin

**Status Tracker:**
```
Safety:  🟢 Passed (Apr 2)     Garage: Quebec Auto
Recon:   🟡 In Progress         Body work at Carstar
Photos:  🟡 5 of 6              Missing: odometer
```

**Linked Deal (if sold/reserved):**
- Client name, salesperson, deal stage, funding status
- Click to navigate to deal

**Action Buttons:**
- [Send to Garage] → opens work order form
- [Flag for Wholesale] → opens wholesale listing form
- [Link to Deal] → search and attach a deal
- [Transfer to Store] → internal wholesale form
- [Edit Vehicle] → edit form

**Activity Timeline:**
- All status changes, photo uploads, work orders, notes logged chronologically

---

## Prompt to Build This

```
Build the Inventory Command Center for the Kia Deal Tracker.

This is a standalone inventory system. Vehicles exist independently of deals on their own table.

DATABASE:
1. Create inventory table: [paste SQL above]
2. Create inventory_photos table: [paste SQL above]
3. Create recon_checklist table: [paste SQL above]
4. Add inventory_id column to deals table
5. Add RLS policies:
   - Users see inventory for their own store
   - Owner role sees all stores
   - Cost fields (acquisition_cost, transport_cost, recon_cost, total_invested, list_price) are excluded from cross-store queries for non-owner roles

BACKEND:

1. Create server/routes/inventory.js with all endpoints: [paste endpoints above]
   - Apply store scoping middleware: filter by user's store_id
   - For cross-store viewing: exclude cost fields unless user has 'owner' role
   - GET /api/inventory supports all filters listed above

2. Create server/services/vinDecoder.js:
   - Install @shaggytools/nhtsa-api-wrapper
   - Function: decodeVIN(vin) → calls NHTSA vPIC API
   - Returns mapped fields: year, make, model, trim, body_type, engine, drive_type, fuel_type, doors, country
   - Handle errors gracefully (invalid VIN, API timeout)

3. Create server/routes/inventoryPhotos.js:
   - POST endpoint accepts multipart upload with angle tag
   - Saves to Supabase Storage
   - Creates inventory_photos record
   - Updates inventory photo flags (photos_front, etc.) and photo_count
   - Recalculates photo_complete (true when all 6 required angles present)

4. Create server/routes/recon.js:
   - POST /assess: submit inspection checklist (creates recon_checklist records, updates recon_status to "assessed", calculates recon_estimated_total)
   - If recon_estimated_total > store threshold → set recon_approval_required = true, status stays "assessed" until GM approves
   - PUT /approve: GM approves recon (records who + when), status → "recon_approved"
   - PUT /complete: marks recon done, updates recon_cost with actual amounts

5. Auto-create inventory from trade-in:
   - In the delivery route, when trade_in_received is set to true:
     - Create an inventory record with vehicle details from the deal's trade-in fields
     - Set acquisition_type = "trade_in", acquisition_cost = trade-in allowance
     - Set source_deal_id = the deal ID
     - Trigger VIN decode if VIN is available

6. Internal wholesale:
   - POST /api/inventory/:id/wholesale-to-store
   - Creates a new inventory record at the buying store
   - Marks original as deal_status = "wholesale", sold_to_store_id, internal_wholesale_price
   - Buying store's record: acquisition_type = "internal_wholesale", acquisition_cost = wholesale price

FRONTEND:

1. Create InventoryDashboard.jsx:
   - Stats bar at top: total units, by location, avg days, total invested, units > 30 days
   - Filter bar with all filters listed above
   - View toggle: Pipeline (kanban) | Grid (photo cards) | Table (spreadsheet) | Aging (sorted by days)
   - Pipeline view: @hello-pangea/dnd kanban columns by location_status
   - Grid view: card grid with photo thumbnails per the card spec
   - Table view: sortable data table
   - Aging view: table sorted by days_in_stock with row colors (green/amber/red)

2. Create InventoryCard.jsx:
   - Photo thumbnail (first photo or placeholder)
   - Photo count badge with completion indicator
   - Year make model trim (title)
   - Stock # (subtitle)
   - Location badge (colored)
   - Safety badge (colored)
   - Recon badge (colored)
   - Days in stock (green < 30, amber 30-60, red > 60)
   - Cost and list price (hidden cross-store for non-owners)
   - Deal status indicator

3. Create InventoryDetail.jsx (slide-out panel):
   - Photo gallery with per-angle upload slots
   - Vehicle details section (auto-filled from VIN decode)
   - Financials section (conditionally hidden)
   - Status tracker (safety, recon, photos)
   - Linked deal section
   - Action buttons: Send to Garage, Flag for Wholesale, Link to Deal, Transfer to Store
   - Activity timeline

4. Create InventoryForm.jsx:
   - VIN input with "Decode" button that auto-fills fields
   - All vehicle fields with auto-fill from VIN
   - Acquisition details: type, date, cost, source
   - Photo upload section

5. Create ReconAssessment.jsx:
   - Standard checklist form grouped by category (mechanical, body, interior, tires, safety)
   - Each item: condition dropdown (good/needs_work/urgent) + notes
   - Cost estimate per category
   - Total estimate displayed
   - If over threshold: "Requires GM Approval" banner
   - Submit creates the assessment and updates recon_status

6. Add route: /inventory → InventoryDashboard
7. Add "Inventory" to sidebar in Layout.jsx with Package icon
8. Update deal form to link to inventory record (inventory_id selector)

Add EN/FR translations for all new strings.

NPM packages to install:
- @shaggytools/nhtsa-api-wrapper (VIN decoding)
```


---

# 6. Garage / Work Orders Spec

# Garage / Work Orders — Final Specification

## Overview

Manages all work sent to external garages and Kia's internal garage. Covers safety inspections, mechanical repairs, body work, and detailing. Work orders auto-email the garage when created. Results are tracked and flow back into the inventory record's safety/recon status.

---

## Garage Setup

### Per-store garages
Each store has its own set of garages. A garage can serve multiple stores but is managed per-store relationship.

### Garage profiles

| Field | Description |
|---|---|
| name | Garage business name |
| email | Where work order emails are sent |
| phone | Contact number |
| contact_name | Primary contact person |
| address | Garage location |
| store_id | Which store uses this garage |
| province | ontario / quebec |
| services | Array: safety_inspection, mechanical, body_work, detailing |
| does_ontario_safety | Boolean — certified for Ontario safety inspections |
| does_quebec_safety | Boolean — certified for Quebec inspections |
| is_internal | Boolean — true for Kia's own garage only |
| standard_rates | JSONB — rate card per service type (e.g., {"safety_inspection": 150, "oil_change": 89}) |
| avg_turnaround_days | Average days to complete work (tracked over time) |
| active | Boolean |

### Kia internal garage rules (reminder)
- Located on Quebec side
- Does Quebec inspections, maintenance, and repairs
- Does NOT do Ontario safety inspections
- is_internal = true
- All Ontario-side stores must use external garages for Ontario safety

---

## Work Order Types

| Type | Description | Connects To |
|---|---|---|
| **Safety inspection** | Ontario or Quebec safety certification | Inventory safety_status + delivery checklist |
| **Mechanical repair** | Engine, transmission, brakes, suspension, etc. | Inventory recon_status |
| **Body work** | Paint, dents, bumpers, glass, trim | Inventory recon_status |
| **Detailing** | Interior/exterior cleaning, polish, odor removal | Inventory recon_status |
| **General maintenance** | Oil change, tires, fluids, battery | Inventory recon_status |

---

## Work Order Workflow

```
Draft → Sent → Received → In Progress → Completed → Invoiced
                                              ↓
                                          (if safety)
                                      Passed or Failed
```

### Status definitions

| Status | Meaning | Who sets it |
|---|---|---|
| **Draft** | Work order created but not yet emailed | Staff creating the WO |
| **Sent** | Email auto-sent to garage | System (auto on create, or manual send) |
| **Received** | Garage acknowledged receipt | Staff (based on garage callback/email) |
| **In progress** | Garage is working on the vehicle | Staff (based on garage update) |
| **Completed** | Work is done, vehicle ready for pickup | Staff (based on garage notification) |
| **Invoiced** | Garage invoice received, actual cost recorded | Staff / admin |

### Auto-email on send
When a work order status is set to "sent", the system auto-sends an email to the garage via Resend with all work order details.

---

## Work Order Email Template

**Subject:** `Work Order #{{wo_number}} — {{year}} {{make}} {{model}} — {{service_type}}`

**Body:**
```
Work Order #{{wo_number}}
From: {{store_name}}
Date: {{date}}

VEHICLE
  Year:    {{year}}
  Make:    {{make}}
  Model:   {{model}}
  Trim:    {{trim}}
  VIN:     {{vin}}
  Mileage: {{mileage}} km
  Color:   {{exterior_color}}
  Stock #: {{stock_number}}

SERVICE REQUESTED
  Type: {{service_type}}
  Description: {{description}}

DEALERSHIP CONTACT
  Name:  {{contact_name}}
  Phone: {{store_phone}}
  Email: {{store_email}}

Please confirm receipt of this work order.
```

---

## Transport (Lot Guys)

Vehicles are transported to/from garages by lot staff — no external drivers needed.

| Field | Description |
|---|---|
| transport_to_garage_by | Name of lot person who drove it to garage |
| transport_to_garage_at | When dropped off |
| transport_from_garage_by | Name of lot person who picked it up |
| transport_from_garage_at | When picked up |

When a work order is created:
- Inventory location_status auto-updates to "at_garage"
- location_details set to garage name

When a work order is completed and vehicle picked up:
- Inventory location_status auto-updates to "on_lot"
- location_details cleared

---

## Garage Queue View

A dedicated view showing all vehicles currently at a garage or waiting to go.

| Column | Data |
|---|---|
| Vehicle | Year make model, stock #, VIN |
| Garage | Which garage |
| Service | Safety / mechanical / body / detailing |
| Sent | Date work order sent |
| Days at garage | Calculated from sent date |
| Status | Received / in progress |
| Est. completion | Expected date (if provided by garage) |

### Color coding
- Green: < 3 days at garage
- Amber: 3–5 days
- Red: > 5 days (overdue alert fires at 3 days for safety)

---

## Safety Inspection Specifics

### Auto-connection to inventory + delivery checklist
When a safety work order is completed:
- If result = **passed**: 
  - Inventory `safety_status` → "passed"
  - Inventory `safety_completed_at` → now
  - If linked to a deal → delivery checklist `safety_status` → "passed"
- If result = **failed**:
  - Inventory `safety_status` → "failed"
  - Inventory `safety_notes` → failure notes from work order
  - Does NOT update delivery checklist (safety remains blocking)
  - May need a new work order for repairs, then re-inspection

### Province-based garage filtering
When creating a safety inspection work order:
- System checks the vehicle's safety_province (from deal or inventory)
- If Ontario → only show garages where does_ontario_safety = true
- If Quebec → only show garages where does_quebec_safety = true
- Prevents sending Ontario safety to a Quebec-only garage

---

## Recon Connection

When a work order of type mechanical, body_work, or detailing is completed:
- Update the corresponding recon_checklist items to "complete"
- When ALL recon work orders for a vehicle are complete → inventory recon_status → "complete"
- Record actual_cost on the work order → rolls up into inventory recon_cost

---

## Cost Tracking

### Per work order

| Field | Description |
|---|---|
| estimated_cost | Based on garage standard rates or manual estimate |
| actual_cost | Actual invoice amount from garage |
| invoice_number | Garage invoice reference |
| invoice_file_id | Uploaded invoice document |

### Auto-estimate from garage rates
When creating a work order and selecting a garage + service type:
- If the garage has a standard rate for that service → auto-fill estimated_cost
- User can override the estimate

### Roll-up to inventory
- Sum of all completed work order actual_costs for a vehicle → inventory recon_cost
- This feeds into total_invested calculation (acquisition + transport + recon)

---

## Database

### New table: `garages`

```sql
CREATE TABLE garages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id) NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  contact_name TEXT,
  address TEXT,
  province TEXT, -- 'ontario', 'quebec'
  services TEXT[] DEFAULT '{}', -- ['safety_inspection', 'mechanical', 'body_work', 'detailing', 'general_maintenance']
  does_ontario_safety BOOLEAN DEFAULT false,
  does_quebec_safety BOOLEAN DEFAULT false,
  is_internal BOOLEAN DEFAULT false,
  standard_rates JSONB DEFAULT '{}', -- {"safety_inspection": 150, "oil_change": 89, "detail_interior": 200}
  avg_turnaround_days NUMERIC,
  notes TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### New table: `work_orders`

```sql
CREATE TABLE work_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wo_number TEXT UNIQUE NOT NULL, -- auto-generated: WO-2026-0001
  store_id UUID REFERENCES stores(id) NOT NULL,
  inventory_id UUID REFERENCES inventory(id) NOT NULL,
  deal_id UUID REFERENCES deals(id), -- nullable, linked if work is for a specific deal
  garage_id UUID REFERENCES garages(id) NOT NULL,

  -- Service details
  service_type TEXT NOT NULL, -- 'safety_inspection', 'mechanical', 'body_work', 'detailing', 'general_maintenance'
  description TEXT NOT NULL, -- what needs to be done

  -- Status
  status TEXT DEFAULT 'draft', -- 'draft', 'sent', 'received', 'in_progress', 'completed', 'invoiced', 'cancelled'
  sent_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Safety specific
  safety_result TEXT, -- 'passed', 'failed' (only for safety_inspection type)
  safety_failure_notes TEXT,

  -- Cost
  estimated_cost NUMERIC,
  actual_cost NUMERIC,
  invoice_number TEXT,
  invoice_file_id TEXT,

  -- Transport
  transport_to_garage_by TEXT,
  transport_to_garage_at TIMESTAMPTZ,
  transport_from_garage_by TEXT,
  transport_from_garage_at TIMESTAMPTZ,

  -- Timing
  estimated_completion DATE,
  days_at_garage INTEGER GENERATED ALWAYS AS (
    CASE WHEN sent_at IS NOT NULL AND completed_at IS NULL 
    THEN EXTRACT(DAY FROM NOW() - sent_at)::INTEGER 
    ELSE NULL END
  ) STORED,

  -- Meta
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_wo_inventory ON work_orders(inventory_id);
CREATE INDEX idx_wo_garage ON work_orders(garage_id);
CREATE INDEX idx_wo_status ON work_orders(status);
CREATE INDEX idx_wo_store ON work_orders(store_id);
```

---

## API Endpoints

```
# Garages
GET    /api/garages                      — List garages for user's store
POST   /api/garages                      — Add a garage
PUT    /api/garages/:id                  — Update garage
DELETE /api/garages/:id                  — Deactivate garage

# Work Orders
GET    /api/work-orders                  — List all WOs (filterable: status, garage, service_type, store)
GET    /api/work-orders/:id              — Single work order detail
POST   /api/work-orders                  — Create work order (auto-generates WO number)
PUT    /api/work-orders/:id              — Update work order
DELETE /api/work-orders/:id              — Cancel work order

# Work Order Actions
POST   /api/work-orders/:id/send         — Send email to garage via Resend, update status to "sent", update inventory location to "at_garage"
PUT    /api/work-orders/:id/complete      — Mark complete, record results
PUT    /api/work-orders/:id/invoice       — Record invoice details (actual_cost, invoice_number, upload)
POST   /api/work-orders/:id/pickup        — Vehicle picked up from garage, update inventory location to "on_lot"

# Safety specific
PUT    /api/work-orders/:id/safety-result — Record pass/fail, auto-update inventory + delivery checklist

# Views
GET    /api/work-orders/garage-queue      — All vehicles at garage or waiting (for dashboard view)
GET    /api/work-orders/overdue           — Work orders sent > 3 days with no completion
GET    /api/work-orders/by-vehicle/:inventoryId — All work orders for a specific vehicle

# Garage Rates
GET    /api/garages/:id/rates             — Get standard rates for a garage
PUT    /api/garages/:id/rates             — Update rates
```

---

## UI Specification

### Work Order Form (creating a new WO)

```
New Work Order
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Vehicle:     [Search by stock # or VIN ▾]
             → 2022 Kia Forte LX — A12345 — 45,000 km

Service:     [Safety Inspection ▾]

Garage:      [Select garage ▾]    ← filtered by service type + province for safety
             → Quebec Auto — does Quebec safety ✓
             Standard rate: $150

Description: [Free text — what needs to be done]

Est. Cost:   [$150.00]    ← auto-filled from garage rate, editable

Transport:   Dropped off by: [name]

[Save as Draft]  [Send to Garage →]
```

### Work Order Card (in lists and garage queue)

```
┌─────────────────────────────────────────────────┐
│ WO-2026-0042          🟡 In Progress    Day 2   │
│ 2022 Kia Forte LX — A12345                      │
│ Safety Inspection — Quebec Auto                  │
│ Est: $150                    Sent: Apr 2, 2026   │
└─────────────────────────────────────────────────┘
```

### Garage Queue Dashboard (dedicated view)

```
Garage Queue                            6 vehicles
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Filter: [All Garages ▾] [All Services ▾] [All Status ▾]

| Vehicle          | Garage       | Service  | Sent    | Days | Status      |
|------------------|--------------|----------|---------|------|-------------|
| 2022 Kia Forte   | Quebec Auto  | Safety   | Apr 2   | 🟢 2 | In Progress |
| 2019 Honda Civic | Carstar      | Body     | Mar 30  | 🔴 5 | Received    |
| 2021 Toyota RAV4 | Quebec Auto  | Mech.    | Apr 3   | 🟢 1 | Sent        |
```

### Work Order Detail (slide-out or full page)

```
WO-2026-0042                              🟡 In Progress
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

VEHICLE
  2022 Kia Forte LX — Stock: A12345
  VIN: 3KPF24AD5NE123456 — 45,000 km

GARAGE
  Quebec Auto — 514-555-0199 — Marc Dupont
  Sent: Apr 2, 2026 at 10:15 AM    [Resend Email]

SERVICE
  Type: Safety Inspection (Quebec)
  Description: Full Quebec safety inspection required for delivery

COST
  Estimated: $150.00
  Actual: — (pending)

TRANSPORT
  Dropped off: Jason, Apr 2 at 9:30 AM
  Picked up: — (still at garage)

TIMELINE
  Apr 2, 10:15 AM — Work order sent to Quebec Auto
  Apr 2, 10:30 AM — Garage confirmed receipt
  Apr 3, 2:00 PM — Garage: inspection in progress

[Mark Received] [Mark Complete] [Record Invoice] [Mark Picked Up]

For safety inspections:
[✅ Passed] [❌ Failed — Add Notes]
```

### Garage Manager (Settings Page)

```
Garages — Kia Mont-Laurier                    [+ Add Garage]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

| Garage         | Services                    | Safety      | Avg Days |
|----------------|-----------------------------|-------------|----------|
| Quebec Auto    | Safety, Mechanical          | QC ✓ ON ✗   | 2.5      |
| Carstar        | Body Work                   | —           | 4.0      |
| Speedy Glass   | Glass                       | —           | 1.0      |
| Detail Kings   | Detailing                   | —           | 1.5      |

Click row → edit garage details, rates, services
```

---

## Automation Connections

| Event | Trigger | Action |
|---|---|---|
| Work order sent | `work_order.sent` | Inventory location_status → "at_garage" |
| Work order completed | `work_order.completed` | Fire notification (LOW) to used car manager |
| Safety passed | `work_order.safety_passed` | Update inventory safety_status + delivery checklist |
| Safety failed | `work_order.safety_failed` | Update inventory safety_status, alert used car manager |
| Vehicle picked up | `work_order.pickup` | Inventory location_status → "on_lot" |
| WO overdue (3+ days) | Scheduled check | Fire notification (MEDIUM) to used car manager |
| Actual cost recorded | `work_order.invoiced` | Update inventory recon_cost with actual |

---

## Prompt to Build This

```
Build the Garage / Work Orders module for the Kia Deal Tracker.

DATABASE:
1. Create garages table: [paste SQL above]
2. Create work_orders table: [paste SQL above]

BACKEND:

1. Create server/routes/garages.js:
   - CRUD endpoints for garage management
   - Scoped to user's store
   - GET /api/garages supports filtering by service type and safety province

2. Create server/routes/workOrders.js:
   - CRUD endpoints for work orders
   - Auto-generate WO number on create (format: WO-YYYY-NNNN, sequential per year)
   - POST /api/work-orders/:id/send:
     - Sends email to garage via Resend using the work order email template
     - Updates status to "sent", records sent_at
     - Updates inventory location_status to "at_garage", location_details to garage name
   - PUT /api/work-orders/:id/complete:
     - Updates status to "completed", records completed_at
     - For safety type: requires safety_result (passed/failed)
     - If safety passed: update inventory.safety_status to "passed" + delivery checklist if deal linked
     - If safety failed: update inventory.safety_status to "failed" with notes
   - PUT /api/work-orders/:id/invoice:
     - Records actual_cost, invoice_number, invoice file upload
     - Updates inventory.recon_cost (sum of all completed WO actual_costs for this vehicle)
   - POST /api/work-orders/:id/pickup:
     - Records transport_from_garage_by and timestamp
     - Updates inventory location_status to "on_lot"
   - GET /api/work-orders/garage-queue: all WOs with status in (sent, received, in_progress)
   - GET /api/work-orders/overdue: WOs where sent_at < now - 3 days and status not completed

3. Create work order email template in server/services/email.js using the template above

4. Fire notification events:
   - work_order.completed → LOW notification to used car manager
   - Safety passed/failed → update inventory + checklist automatically
   - Overdue check runs in the daily scheduled job (already defined in notifications spec)

5. Province-based garage filtering:
   - When service_type = "safety_inspection", only return garages matching the vehicle's safety province
   - If vehicle safety_province = "ontario" → garages where does_ontario_safety = true
   - If "quebec" → garages where does_quebec_safety = true

6. Cost auto-estimate:
   - When creating a WO: if garage has a standard_rate for the selected service_type, auto-fill estimated_cost

FRONTEND:

1. Create WorkOrderForm.jsx:
   - Vehicle selector (search by stock # or VIN from inventory)
   - Service type dropdown
   - Garage selector (filtered by service capability + province for safety)
   - Auto-fill estimated cost from garage rates
   - Description text area
   - Transport: dropped off by (name field)
   - Buttons: Save as Draft, Send to Garage

2. Create WorkOrderCard.jsx:
   - WO number, status badge, days at garage (color coded)
   - Vehicle summary (year make model, stock #)
   - Service type, garage name
   - Estimated cost, sent date

3. Create GarageQueue.jsx:
   - Filterable table: all vehicles currently at garage
   - Columns: vehicle, garage, service, sent date, days at garage, status
   - Row colors: green < 3 days, amber 3-5, red > 5
   - Click row → work order detail

4. Create WorkOrderDetail.jsx (slide-out):
   - All work order info
   - Action buttons: Mark Received, Mark Complete, Record Invoice, Mark Picked Up
   - For safety: Pass/Fail buttons with notes
   - Timeline of all status changes
   - Resend Email button

5. Create GarageManager.jsx (settings):
   - List all garages for the store
   - Add/edit garage: name, email, phone, contact, services, safety certifications, rates
   - Rate card editor per service type

6. Add "Send to Garage" button in InventoryDetail.jsx → opens WorkOrderForm pre-filled with vehicle
7. Add route: /work-orders → garage queue view
8. Add route: /settings/garages → garage manager
9. Add "Work Orders" to sidebar with Wrench icon from lucide-react

Add EN/FR translations for all new strings.
```


---

# 7. Finance Desk Spec

# Finance Desk — Final Specification

## Overview

The F&I agent's workspace. Tracks lender submissions, approval details, deal desking (payment calculations, rate comparison, profit analysis), and F&I product sales. No API integration with DealerTrack/RouteOne/CreditApp — the system tracks what F&I agents do on those platforms manually.

---

## Submission Platforms by Store Type

| Store Type | Submission Platforms |
|---|---|
| Used car stores (Ready Group) | DealerTrack + CreditApp |
| Kia (franchise) | DealerTrack + RouteOne |
| Future franchise stores | Configurable per store |

Platform options are configured per store in the stores table.

---

## Lender Submissions

### Submission volume by credit tier

| Credit Tier | Typical Submissions | Strategy |
|---|---|---|
| Prime (700+) | 1–2 lenders | Best rate shopping |
| Near-prime (600–699) | 2–4 lenders | Rate + approval shopping |
| Subprime (500–599) | 3–5 lenders | Approval shopping |
| Deep subprime (<500) | 5+ lenders | Shotgun — get any approval |

### Per-submission tracking

| Field | Description |
|---|---|
| lender_name | Bank/lender name |
| platform | dealertrack / creditapp / routeone / manual |
| submitted_at | When submitted |
| status | submitted / pending / approved / conditional / declined / expired |
| approval_amount | Approved financing amount |
| rate | Interest rate (%) |
| term | Loan term (months) |
| payment | Monthly payment amount |
| conditions | Lender conditions for approval (text) |
| conditions_met | Boolean — all conditions satisfied |
| buy_rate | Lender's base rate (what they charge the dealer) |
| sell_rate | Rate presented to customer (dealer can mark up) |
| rate_spread | sell_rate - buy_rate (dealer profit on rate) |
| selected | Boolean — this is the chosen approval for the deal |
| decline_reason | Why the lender declined (if declined) |
| notes | F&I agent notes |
| expiry_date | When the approval expires |

### Submission workflow

```
Submitted → Pending → Approved / Conditional / Declined
                           ↓
                     (if conditional)
                  Conditions Met → Approved
                           ↓
                     (one selected)
                  Selected as Final Approval
```

### When a submission is selected as final
- Deal's finance fields auto-update: selected_lender, approval_amount, rate, term, payment
- Deal pipeline can advance (approval is a prerequisite for signing)
- Other submissions marked as "not selected" (kept for records)

---

## Deal Desking — Payment Calculator

### Input fields

| Field | Source |
|---|---|
| Vehicle price | From deal sale_price |
| Trade-in allowance | From deal trade_in_value |
| Trade-in lien (payoff) | From deal trade_in_lien |
| Down payment | From deal total_down_payment |
| F&I products total | Sum of all F&I products on the deal |
| Tax rate | Based on store province (Ontario 13% HST, Quebec 14.975% GST+QST) |
| Lender fee | If applicable |
| Rate (%) | From selected approval or manual entry |
| Term (months) | From selected approval or manual entry |

### Calculation

```
Net trade    = trade_in_allowance - trade_in_lien
Amount financed = vehicle_price + fi_products_total + tax + lender_fee - down_payment - net_trade
Monthly payment = standard amortization formula using amount_financed, rate, term
Total cost of borrowing = (monthly_payment × term) - amount_financed
```

### Tax calculation by province

| Province | Tax | Rate |
|---|---|---|
| Ontario | HST | 13% |
| Quebec | GST + QST | 5% + 9.975% = 14.975% |
| Other provinces | Varies | Configurable per store |

Tax is applied to: vehicle price + F&I products (some products may be tax-exempt — configurable per product)

### Payment scenarios
F&I agents need to compare multiple scenarios side-by-side:
- Different rates from different lenders
- Different terms (48, 60, 72, 84 months)
- With/without specific F&I products
- Different down payment amounts

The calculator should allow saving and comparing up to 4 scenarios side-by-side.

### Deal Types

| Type | Available At | Calculator |
|---|---|---|
| **Finance** | All stores | Standard amortization (rate + term) |
| **Cash** | All stores | No calculator needed — just price, trade, down payment |
| **Lease** | Kia / franchise stores ONLY | Lease formula (residual, money factor, term) |

Lease is configured per store — used car stores do not see the lease option.

### Lease Calculator (Kia/Franchise Only)

**Additional lease inputs:**

| Field | Description |
|---|---|
| MSRP | Manufacturer's suggested retail price |
| Residual value (%) | Percentage of MSRP the vehicle is worth at lease end (from lender) |
| Money factor | Lease equivalent of interest rate (from lender, e.g., 0.00125) |
| Lease term | Months (typically 24, 36, 48) |
| Annual km allowance | Included km per year (e.g., 20,000 km) |
| Excess km charge | Cost per km over allowance |

**Lease calculation:**

```
Residual amount = MSRP × residual_percentage
Depreciation = (sale_price + fi_products + tax - down_payment - net_trade) - residual_amount
Monthly depreciation = depreciation / term
Monthly finance charge = (sale_price + residual_amount) × money_factor
Monthly lease payment = monthly_depreciation + monthly_finance_charge
Equivalent APR = money_factor × 2400 (for display purposes)
```

---

## Deal Desking — Profit Analysis

### Front-end gross (vehicle profit)

```
Front gross = sale_price - vehicle_cost (from inventory.total_invested)
```

### Back-end gross (F&I profit)

```
Back gross = fi_reserve + sum of (fi_product sell_price - fi_product cost) for all products
```

Where fi_reserve = rate_spread × amount_financed (dealer profit from rate markup)

### Total deal gross

```
Total gross = front_gross + back_gross
```

### Commission impact
- Show estimated commission based on salesperson's pay plan
- Uses existing commission system (rates, pads, tiers, overrides)

### Profit summary display

```
DEAL PROFIT ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Front Gross:
  Sale price:           $22,000
  Vehicle cost:         $17,500
  Front gross:          $4,500

Back Gross:
  F&I Reserve:          $800
  Warranty profit:      $600
  GAP profit:           $350
  Back gross:           $1,750

Total Gross:            $6,250
Commission (est):       $1,425
```

---

## F&I Products

### Product catalog by store type

| Product | Used Car Stores | Kia (Franchise) | Future Franchise |
|---|---|---|---|
| Extended warranty | ✅ | ✅ | ✅ |
| GAP insurance | ✅ | ✅ | ✅ |
| Tire and rim protection | ❌ | ✅ | ✅ |
| Paint protection | ❌ | ✅ | ✅ |
| Fabric/interior protection | ❌ | ✅ | ✅ |
| Theft deterrent / etch | ❌ | ✅ | ✅ |
| Maintenance package | ❌ | ✅ | ✅ |
| Loan insurance (life/disability) | ❌ | ✅ | ✅ |
| Rust proofing | ❌ | ✅ | ✅ |

### Per-product fields on a deal

| Field | Description |
|---|---|
| product_type | Which product |
| provider | Provider/underwriter name |
| cost | Dealer cost (what the dealership pays the provider) |
| sell_price | What the customer pays (set by F&I agent per deal) |
| profit | sell_price - cost (auto-calculated) |
| term | Coverage term if applicable (months or km) |
| deductible | Deductible amount if applicable |
| taxable | Boolean — is this product subject to sales tax |
| notes | Any notes |

### Product availability
Configured per store — the store settings determine which products are available. F&I agents only see products their store offers.

---

## Database

### New table: `lender_submissions`

```sql
CREATE TABLE lender_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id) NOT NULL,

  -- Lender info
  lender_name TEXT NOT NULL,
  platform TEXT NOT NULL, -- 'dealertrack', 'creditapp', 'routeone', 'manual'
  submitted_at TIMESTAMPTZ DEFAULT NOW(),

  -- Status
  status TEXT DEFAULT 'submitted', -- 'submitted', 'pending', 'approved', 'conditional', 'declined', 'expired'

  -- Approval details
  approval_amount NUMERIC,
  buy_rate NUMERIC, -- lender's base rate
  sell_rate NUMERIC, -- rate to customer (marked up)
  rate_spread NUMERIC GENERATED ALWAYS AS (
    CASE WHEN sell_rate IS NOT NULL AND buy_rate IS NOT NULL
    THEN sell_rate - buy_rate ELSE NULL END
  ) STORED,
  term INTEGER, -- months
  payment NUMERIC, -- monthly payment
  conditions TEXT,
  conditions_met BOOLEAN DEFAULT false,
  decline_reason TEXT,
  expiry_date DATE,

  -- Selection
  selected BOOLEAN DEFAULT false,

  -- Meta
  notes TEXT,
  submitted_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_submissions_deal ON lender_submissions(deal_id);
CREATE INDEX idx_submissions_status ON lender_submissions(status);
```

### New table: `deal_fi_products`

```sql
CREATE TABLE deal_fi_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  product_type TEXT NOT NULL, -- 'extended_warranty', 'gap', 'tire_rim', 'paint', 'fabric', 'theft', 'maintenance', 'loan_insurance', 'rust'
  provider TEXT,
  cost NUMERIC NOT NULL DEFAULT 0, -- dealer cost
  sell_price NUMERIC NOT NULL DEFAULT 0, -- customer price
  profit NUMERIC GENERATED ALWAYS AS (sell_price - cost) STORED,
  term TEXT, -- coverage term (e.g., "5 years / 100,000 km")
  deductible NUMERIC,
  taxable BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_fi_products_deal ON deal_fi_products(deal_id);
```

### New table: `fi_product_catalog`

```sql
CREATE TABLE fi_product_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id) NOT NULL,
  product_type TEXT NOT NULL,
  product_name TEXT NOT NULL, -- display name
  default_provider TEXT,
  available BOOLEAN DEFAULT true,
  taxable BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Modify `deals` table

```sql
-- Finance fields
ALTER TABLE deals ADD COLUMN selected_lender TEXT;
ALTER TABLE deals ADD COLUMN approval_amount NUMERIC;
ALTER TABLE deals ADD COLUMN buy_rate NUMERIC;
ALTER TABLE deals ADD COLUMN sell_rate NUMERIC;
ALTER TABLE deals ADD COLUMN approval_term INTEGER;
ALTER TABLE deals ADD COLUMN monthly_payment NUMERIC;
ALTER TABLE deals ADD COLUMN amount_financed NUMERIC;
ALTER TABLE deals ADD COLUMN total_cost_of_borrowing NUMERIC;
ALTER TABLE deals ADD COLUMN fi_products_total NUMERIC DEFAULT 0;
ALTER TABLE deals ADD COLUMN front_gross NUMERIC;
ALTER TABLE deals ADD COLUMN back_gross NUMERIC;
ALTER TABLE deals ADD COLUMN total_gross NUMERIC;
ALTER TABLE deals ADD COLUMN deal_type TEXT DEFAULT 'finance'; -- 'finance', 'cash', 'lease'
ALTER TABLE deals ADD COLUMN tax_rate NUMERIC; -- auto-set from store province
ALTER TABLE deals ADD COLUMN lender_fee NUMERIC DEFAULT 0;
```

### Modify `stores` table

```sql
ALTER TABLE stores ADD COLUMN submission_platforms TEXT[] DEFAULT '{}'; -- ['dealertrack', 'creditapp']
ALTER TABLE stores ADD COLUMN tax_rate NUMERIC; -- 0.13 for Ontario, 0.14975 for Quebec
ALTER TABLE stores ADD COLUMN available_fi_products TEXT[] DEFAULT '{}'; -- product types this store sells
```

---

## API Endpoints

```
# Lender Submissions
GET    /api/deals/:id/submissions          — All submissions for a deal
POST   /api/deals/:id/submissions          — Add a submission
PUT    /api/submissions/:id                — Update submission (status, approval details)
POST   /api/submissions/:id/select         — Select this as the winning approval (deselects others, updates deal)
DELETE /api/submissions/:id                — Remove a submission

# Deal Desking
GET    /api/deals/:id/desk                 — Get full desk sheet (all numbers, submissions, products, profit)
POST   /api/deals/:id/desk/calculate       — Calculate payment scenario (input: price, rate, term, down, trade, products)
POST   /api/deals/:id/desk/compare         — Compare up to 4 scenarios side-by-side

# F&I Products
GET    /api/deals/:id/fi-products          — All F&I products on a deal
POST   /api/deals/:id/fi-products          — Add a product to the deal
PUT    /api/fi-products/:id                — Update product (price, cost, etc.)
DELETE /api/fi-products/:id                — Remove product from deal
GET    /api/stores/:id/fi-catalog          — Available products for a store
PUT    /api/stores/:id/fi-catalog          — Update store's product catalog

# Profit Analysis
GET    /api/deals/:id/profit               — Full profit breakdown (front, back, total, commission estimate)
```

---

## UI Specification

### Finance Tab (within Deal Detail)

**Lender Submissions Section:**
```
Lender Submissions                          [+ Add Submission]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ⭐ TD Auto Finance         ✅ Approved    via DealerTrack
     $22,000 @ 6.99% × 72mo = $379/mo
     Buy: 4.99% | Sell: 6.99% | Spread: 2.00%
     [Selected ✓]

  ── Scotia Dealer Finance    ✅ Approved    via DealerTrack
     $22,000 @ 7.49% × 72mo = $389/mo
     Buy: 5.49% | Sell: 7.49% | Spread: 2.00%
     [Select This]

  ── Rifco Capital            🟡 Conditional via CreditApp
     $20,000 @ 9.99% × 60mo = $424/mo
     Conditions: Proof of income required
     ☐ Conditions met
     [Select This]

  ── iA Auto Finance          ❌ Declined
     Reason: Insufficient credit history
```

**Payment Calculator Section:**
```
Payment Calculator
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Vehicle price:        $22,000
  Trade-in allowance:   -$5,000
  Trade-in payoff:      +$2,000
  Down payment:         -$3,000
  F&I products:         +$2,450
  Tax (13% HST):        +$2,860     ← auto from store province
  Lender fee:           +$0
                        ─────────
  Amount financed:      $21,310

  Rate: [6.99%]    Term: [72 mo ▾]

  Monthly payment:      $379.42
  Total cost:           $27,318
  Cost of borrowing:    $6,008

  [Save Scenario]  [Compare Scenarios]
```

**Scenario Comparison (up to 4):**
```
┌──────────────┬──────────┬──────────┬──────────┐
│              │ TD 72mo  │ TD 60mo  │ Scotia   │
├──────────────┼──────────┼──────────┼──────────┤
│ Rate         │ 6.99%    │ 6.99%    │ 7.49%    │
│ Term         │ 72 mo    │ 60 mo    │ 72 mo    │
│ Payment      │ $379     │ $434     │ $389     │
│ Total cost   │ $27,318  │ $26,040  │ $28,008  │
│ Borrowing    │ $6,008   │ $4,730   │ $6,698   │
│ Spread       │ 2.00%    │ 2.00%    │ 2.00%    │
│ Reserve      │ $854     │ $712     │ $854     │
└──────────────┴──────────┴──────────┴──────────┘
```

**F&I Products Section:**
```
F&I Products                              [+ Add Product]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Extended Warranty — Global Warranty    Cost: $800   Sell: $1,800   Profit: $1,000
    5 years / 100,000 km — $200 deductible

  GAP Insurance — Safe-Guard            Cost: $300   Sell: $950     Profit: $650
    Full term coverage

  Products Total: $2,750 sell / $1,100 cost / $1,650 profit
```

**Profit Analysis Section:**
```
Deal Profit Analysis
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  FRONT GROSS
    Sale price:          $22,000
    Vehicle cost:        $17,500 (from inventory)
    Front gross:         $4,500

  BACK GROSS
    F&I reserve:         $854 (rate spread on financed amount)
    Warranty profit:     $1,000
    GAP profit:          $650
    Back gross:          $2,504

  TOTAL GROSS:           $7,004

  EST. COMMISSION
    Salesperson (30%):   $2,101
    Pad deduction:       -$1,500
    Net commission:      $601
```

---

## Prompt to Build This

```
Build the Finance Desk module for the Kia Deal Tracker.

DATABASE:
1. Create lender_submissions table: [paste SQL above]
2. Create deal_fi_products table: [paste SQL above]
3. Create fi_product_catalog table: [paste SQL above]
4. Add finance columns to deals table: [paste ALTER statements above]
5. Add store columns: submission_platforms, tax_rate, available_fi_products
6. Seed fi_product_catalog:
   - For used car stores: extended_warranty, gap (available = true), all others (available = false)
   - For Kia: all 9 products (available = true)

BACKEND:

1. Create server/routes/submissions.js:
   - CRUD for lender submissions on a deal
   - POST /select: marks submission as selected, deselects others, auto-updates deal finance fields (selected_lender, approval_amount, buy_rate, sell_rate, approval_term, monthly_payment)
   - When status changes to "approved" → fire lender.approved notification event

2. Create server/routes/fiProducts.js:
   - CRUD for F&I products on a deal
   - On add/update/delete: recalculate deal.fi_products_total
   - GET catalog endpoint filtered by store's available_fi_products

3. Create server/services/deskCalculator.js:
   - Function: calculatePayment({ price, trade_allowance, trade_lien, down_payment, fi_products_total, tax_rate, lender_fee, rate, term })
   - Returns: amount_financed, monthly_payment, total_cost, cost_of_borrowing
   - Standard amortization: M = P × [r(1+r)^n] / [(1+r)^n - 1] where r = monthly rate, n = term months
   - Function: calculateProfit({ sale_price, vehicle_cost, fi_reserve, fi_products })
   - Returns: front_gross, back_gross, total_gross, estimated_commission

4. Create server/routes/desk.js:
   - GET /api/deals/:id/desk — returns full desk sheet
   - POST /api/deals/:id/desk/calculate — calculate a single scenario
   - POST /api/deals/:id/desk/compare — calculate multiple scenarios, return side-by-side
   - GET /api/deals/:id/profit — full profit breakdown with commission estimate

5. Tax rate auto-set:
   - When a deal is created, set tax_rate from the store's province (Ontario = 0.13, Quebec = 0.14975)
   - Tax applies to vehicle_price + taxable F&I products

FRONTEND:

1. Create FinanceSection.jsx — tab within DealDetail:
   - Lender submissions list with add/edit/select
   - Submission cards showing: lender, platform, status, rate (buy/sell/spread), term, payment
   - Selected approval highlighted with accent border and star icon

2. Create SubmissionForm.jsx:
   - Lender name (text input with common lender suggestions)
   - Platform dropdown (filtered by store's submission_platforms)
   - Status, approval details (amount, buy_rate, sell_rate, term)
   - Conditions text + conditions_met checkbox
   - Decline reason (if declined)

3. Create PaymentCalculator.jsx:
   - All input fields pre-filled from deal data
   - Live calculation as inputs change (debounced)
   - Term selector: 48, 60, 72, 84 month buttons
   - "Save Scenario" button, "Compare" button

4. Create ScenarioComparison.jsx:
   - Side-by-side cards (up to 4 scenarios)
   - Highlight best payment, lowest cost of borrowing, highest reserve

5. Create FIProductsSection.jsx:
   - List of products on the deal with cost/sell/profit per product
   - "Add Product" dropdown (only shows products available at this store)
   - Product form: type, provider, cost, sell_price, term, deductible
   - Running totals at bottom

6. Create ProfitAnalysis.jsx:
   - Front gross, back gross, total gross breakdown
   - Commission estimate using existing salesperson pay plan system
   - Updates live as deal numbers change

7. Integrate all sections into DealDetail.jsx as "Finance" tab
8. Add finance_status filter to dashboard (uses existing pipeline stages)

Add EN/FR translations for all new strings.
```


---

# 8. Document Manager Spec

# Document Manager — Final Specification

## Overview

Tracks every document in a deal file from creation through signing, delivery, and filing. All documents go wet ink at delivery. E-signing (OneSpan or DocuSign, varies by store) is used for initial remote signing, then physical copies are re-signed at delivery. Signed documents are uploaded and stored in the system for instant retrieval.

---

## E-Signature Platform

| Store | Platform |
|---|---|
| Configurable per store | OneSpan OR DocuSign |

Stored in `stores.esign_platform` — no API integration for now. The system tracks envelope/package IDs for reference, and signed documents are uploaded back into the system.

---

## Document Catalog (Standard Deal File)

### Documents per deal

| # | Document | Source | Conditional | E-Sign | Wet Ink |
|---|---|---|---|---|---|
| 1 | **Bank contract** | DealerTrack | All financed deals | ✅ | ✅ |
| 2 | **Bill of sale** | CAMS (Ready Group) / Merlin (Kia) | All deals | ✅ | ✅ |
| 3 | **Warranty agreement** | F&I product sale | Only if warranty sold | ✅ | ✅ |
| 4 | **GAP agreement** | F&I product sale | Only if GAP sold | ✅ | ✅ |
| 5 | **Aftermarket product agreements** | F&I product sale | Only if products sold | ✅ | ✅ |
| 6 | **Privacy/consent disclosure** | Internal form | All deals | ✅ | ✅ |
| 7 | **OMVIC disclosure** | Regulatory | Ontario deals only | ✅ | ✅ |
| 8 | **Vehicle condition disclosure** | Internal form | All deals | ✅ | ✅ |
| 9 | **Trade-in lien payoff authorization** | Internal form | Only if trade-in has a lien | ✅ | ✅ |
| 10 | **Odometer statement** | Internal form | All deals | ✅ | ✅ |
| 11 | **As-is waiver** | Internal form | Only if sold as-is | ✅ | ✅ |
| 12 | **Carfax report** | Carfax | All used vehicle deals | N/A (not signed) | Included in file |
| 13 | **Lease agreement** | DealerTrack / lender | Lease deals only (Kia/franchise) | ✅ | ✅ |

### Auto-generation logic
When a deal reaches the "Signed" pipeline stage, the system auto-generates the document checklist based on:
- **All deals get:** Bill of sale, privacy/consent, vehicle condition, odometer statement
- **Financed deals add:** Bank contract
- **Ontario deals add:** OMVIC disclosure
- **Deals with F&I products add:** One agreement per product sold (warranty, GAP, etc.)
- **Trade-in with lien adds:** Trade-in lien payoff authorization
- **Sold as-is adds:** As-is waiver
- **Used vehicles add:** Carfax report
- **Lease deals add:** Lease agreement (Kia/franchise stores only)

---

## Document Lifecycle

```
Not Ready → Generated → E-Signed → Printed → In Wet Ink File → Signed at Delivery → Filed
```

### Status definitions

| Status | Meaning |
|---|---|
| **not_ready** | Document hasn't been created yet |
| **generated** | Document created in source system (CAMS, Merlin, DealerTrack) or internally |
| **e_signed** | Client signed via OneSpan/DocuSign (for applicable docs) |
| **printed** | Physical copy printed for wet ink file |
| **in_file** | Included in the wet ink file given to driver |
| **signed** | Client signed the physical copy at delivery |
| **filed** | Signed document uploaded to system, deal file complete |

### Non-signed documents (e.g., Carfax)
- Follow a simpler flow: not_ready → generated → in_file → filed
- No signing step needed

---

## Signed Document Storage

### Upload and instant retrieval
When signed documents return from delivery:
- Admin or F&I uploads each signed document (scan or photo)
- Each document is tagged with its type and linked to the deal
- Documents are stored in Supabase Storage
- Any authorized user can pull up any document instantly from the deal record
- Search by: deal number, client name, stock number, VIN, document type

### Future phase: auto-upload
- Integration with scanner/email to auto-ingest scanned documents
- OCR to auto-detect document type and match to deal
- For now: manual upload per document

---

## Wet Ink File Workflow

### Who prepares
F&I agent or admin/office staff depending on the store.

### Preparation process
1. All documents that need wet ink signing are printed
2. Documents assembled in order in a folder/envelope
3. Person preparing marks each document as "printed" in the system
4. When all documents are printed → wet ink file status changes to "prepared"
5. File given to driver → status changes to "with_driver" (tracked in delivery checklist)
6. After delivery: signed documents return → each uploaded and marked "filed"

### Wet ink file contents checklist
The system shows a printable checklist of all documents that need to be in the file:
```
WET INK FILE — Deal A12345 — John Smith — 2022 Kia Forte
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ☐ Bank contract (TD Auto Finance)
  ☐ Bill of sale
  ☐ Extended warranty agreement
  ☐ GAP agreement
  ☐ Privacy/consent disclosure
  ☐ OMVIC disclosure
  ☐ Vehicle condition disclosure
  ☐ Odometer statement
  ☐ Carfax report

  Prepared by: _______________  Date: _______________
```

---

## Database

### New table: `deal_documents`

```sql
CREATE TABLE deal_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  store_id UUID REFERENCES stores(id) NOT NULL,

  -- Document identification
  document_type TEXT NOT NULL,
  -- 'bank_contract', 'bill_of_sale', 'warranty_agreement', 'gap_agreement',
  -- 'aftermarket_agreement', 'privacy_consent', 'omvic_disclosure',
  -- 'vehicle_condition', 'trade_in_lien_authorization', 'odometer_statement',
  -- 'as_is_waiver', 'carfax_report'
  document_name TEXT NOT NULL, -- display name (e.g., "GAP Agreement — Safe-Guard")
  source_system TEXT, -- 'dealertrack', 'cams', 'merlin', 'internal', 'carfax'

  -- Status
  status TEXT DEFAULT 'not_ready',
  -- 'not_ready', 'generated', 'e_signed', 'printed', 'in_file', 'signed', 'filed'
  requires_signature BOOLEAN DEFAULT true, -- false for Carfax, info-only docs

  -- E-signature tracking
  esign_platform TEXT, -- 'onespan', 'docusign'
  esign_envelope_id TEXT, -- envelope/package ID for reference
  esign_sent_at TIMESTAMPTZ,
  esign_signed_at TIMESTAMPTZ,

  -- Physical document tracking
  printed_at TIMESTAMPTZ,
  printed_by UUID REFERENCES users(id),
  signed_at_delivery TIMESTAMPTZ,

  -- Filed document (uploaded signed copy)
  unsigned_file_url TEXT, -- original unsigned document
  signed_file_url TEXT, -- uploaded signed copy
  filed_at TIMESTAMPTZ,
  filed_by UUID REFERENCES users(id),

  -- Meta
  notes TEXT,
  sort_order INTEGER DEFAULT 0, -- display order in checklist
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_docs_deal ON deal_documents(deal_id);
CREATE INDEX idx_docs_status ON deal_documents(status);
```

### Modify `stores` table

```sql
ALTER TABLE stores ADD COLUMN esign_platform TEXT; -- 'onespan', 'docusign'
```

---

## API Endpoints

```
# Documents
GET    /api/deals/:id/documents                — All documents for a deal
POST   /api/deals/:id/documents                — Add a document manually
PUT    /api/documents/:id                       — Update document status/details
DELETE /api/documents/:id                       — Remove a document
POST   /api/deals/:id/documents/generate        — Auto-generate document checklist based on deal type
GET    /api/deals/:id/documents/completion       — Returns: { total, completed, percentage, missing[] }

# Document files
POST   /api/documents/:id/upload-unsigned       — Upload original unsigned document
POST   /api/documents/:id/upload-signed          — Upload signed copy (from delivery return)

# Wet ink file
GET    /api/deals/:id/documents/wet-ink-checklist — Printable checklist of all docs for wet ink file
POST   /api/deals/:id/documents/mark-printed      — Mark multiple docs as printed (batch)
POST   /api/deals/:id/documents/mark-filed         — Mark multiple docs as filed with uploads (batch)

# Search
GET    /api/documents/search                     — Search across all deals: by client name, stock #, VIN, document type
```

---

## UI Specification

### Document Section (within Deal Detail)

```
Documents                           [8 of 10 filed]   [Generate Checklist]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[=============================-----] 80%

  🟢 Bank contract              Filed     [View Signed] [View Original]
  🟢 Bill of sale (CAMS)        Filed     [View Signed] [View Original]
  🟢 Warranty agreement         Filed     [View Signed]
  🟢 GAP agreement              Filed     [View Signed]
  🟢 Privacy/consent            Filed     [View Signed]
  🟢 OMVIC disclosure           Filed     [View Signed]
  🟢 Vehicle condition          Filed     [View Signed]
  🟢 Odometer statement         Filed     [View Signed]
  🟡 Trade-in lien auth         Signed    [Upload Signed Copy]
  🟡 Carfax report              In File   [Upload Filed Copy]

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Wet Ink File: ✅ Prepared by Sarah, Apr 10
  [Print Checklist]  [Mark All Printed]  [Bulk Upload Signed]
```

### Bulk Upload (after delivery)
```
Upload Signed Documents
━━━━━━━━━━━━━━━━━━━━━━━

  [Drag & drop files here or click to browse]

  Uploaded files:
    scan_001.pdf  →  [Bank Contract ▾]       ✅ Matched
    scan_002.pdf  →  [Bill of Sale ▾]        ✅ Matched
    scan_003.pdf  →  [Select document... ▾]  ⚠️ Unmatched

  [Save All]
```

### Document Search (admin feature)
```
Search Documents                    [Search by client, stock #, VIN, type]

  Results for "John Smith":
    Deal A12345 — John Smith — 2022 Kia Forte
      📄 Bank contract (filed)    [View]
      📄 Bill of sale (filed)     [View]
      📄 Warranty (filed)         [View]
      ...
```

---

## Connections to Other Modules

| Connection | How it works |
|---|---|
| **Deal Pipeline** | When deal reaches "Signed" stage → auto-generate document checklist |
| **Pre-Delivery Checklist** | wet_ink_status reads from document completion (all docs printed = prepared) |
| **Delivery Tracker** | Wet ink file given to driver tracked here |
| **F&I Products** | When F&I products added to deal → corresponding agreement docs auto-added to checklist |
| **Inventory** | Bill of sale source system determined by store (CAMS vs Merlin) |

---

## Prompt to Build This

```
Build the Document Manager module for the Kia Deal Tracker.

DATABASE:
1. Create deal_documents table: [paste SQL above]
2. Add esign_platform column to stores table

BACKEND:

1. Create server/routes/documents.js:
   - CRUD for deal documents
   - POST /api/deals/:id/documents/generate:
     - Auto-generates document checklist based on deal type:
       - All deals: bill_of_sale, privacy_consent, vehicle_condition, odometer_statement
       - Financed: + bank_contract
       - Ontario: + omvic_disclosure
       - Has F&I products: + one agreement per product type from deal_fi_products
       - Trade-in with lien: + trade_in_lien_authorization
       - Sold as-is: + as_is_waiver
       - Used vehicle: + carfax_report
     - Sets source_system based on store (bill_of_sale → 'cams' for Ready Group, 'merlin' for Kia)
     - Sets requires_signature = false for carfax_report
   - GET /api/deals/:id/documents/completion: returns total, completed, percentage, missing docs
   - POST /upload-unsigned and /upload-signed: file upload to Supabase Storage
   - POST /mark-printed: batch update multiple docs to "printed" status
   - POST /mark-filed: batch update with signed file uploads
   - GET /api/deals/:id/documents/wet-ink-checklist: returns printable checklist
   - GET /api/documents/search: search across deals by client name, stock #, VIN, document type

2. Auto-generate trigger:
   - When deal pipeline_stage changes to "signed", auto-call the generate endpoint if no documents exist yet
   - When F&I products are added/removed from a deal, add/remove corresponding agreement documents

3. Connection to pre-delivery checklist:
   - When all documents with requires_signature = true are at status "printed" or later → update deal's wet_ink_status to "prepared"

FRONTEND:

1. Create DocumentSection.jsx — tab within DealDetail:
   - Document list with status badges (color coded by status)
   - Per-document actions: View Original, View Signed, Upload Signed Copy
   - Progress bar: "X of Y filed"
   - "Generate Checklist" button (if no docs exist yet)
   - "Print Checklist" button (opens printable wet ink checklist)
   - "Mark All Printed" batch action
   - "Bulk Upload Signed" — drag-and-drop multiple files, match each to a document type

2. Create DocumentUpload.jsx:
   - Drag-and-drop zone
   - File-to-document-type matching dropdown
   - Batch save

3. Create DocumentSearch.jsx (admin page):
   - Search bar: client name, stock #, VIN, document type
   - Results grouped by deal
   - Click to view/download any document

4. Integrate DocumentSection into DealDetail.jsx as "Documents" tab
5. Add document search to admin/settings area

Add EN/FR translations for all new strings.
```


---

# 9. Lead Manager Spec

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

  Vendeur 03 — F&I Agent — FR/EN
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


---

# 10. Chatbot Engine Spec

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


---

# 11. Remaining Modules Specs

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


---

# 12. Master Build Plan

# KIA MOLINORI TRACKER — MASTER BUILD PLAN v1

## Gap Analysis: What's Built vs What's Needed

### BUILT & WORKING (MVP)

| Feature | Status | Notes |
|---------|--------|-------|
| Deal CRUD | ✅ Done | Create/read/update/delete with all fields |
| Financial tracking | ✅ Done | sale_price, vehicle_cost, fi_reserve |
| Commission system | ✅ Done | 12 salespeople, individual pay plans, auto-calc |
| Dashboard | ✅ Done | Stats bar, 9 filters, deal card grid, Supabase real-time |
| Delivery checklist | ✅ Done | 4 critical items + file uploads |
| Dispatch/fleet | ✅ Done | Chasers, dealer plates, auto-assign, conflict detection |
| Sourced units | ✅ Done | Seller tracking, payment proof, pickup logistics |
| Reports | ✅ Done | 4 tabs: Sales, Commissions, Financial, Inventory |
| PDF + Excel export | ✅ Done | All 4 report types |
| Salespeople manager | ✅ Done | Add/edit/deactivate with rates, pads, tiers |
| Email automation | ✅ Done | Deal closing report + driver dispatch via Resend |
| EN/FR translations | ✅ Done | Complete for all features |
| Authentication | ✅ Done | Login with localStorage session |
| Design system | ✅ Done | CSS variables, light/dark, Inter font |
| Layout | ✅ Done | Collapsible sidebar, top bar, mobile drawer |
| UI/UX research | ✅ Done | 8 platforms analyzed, design patterns selected |

### IN PROGRESS (UI/UX Redesign Steps 4–12)

| Step | Feature | Status |
|------|---------|--------|
| 4 | Kanban pipeline + list toggle | Not started |
| 5 | Deal cards with rotting indicators + drag-drop | Not started |
| 6 | Deal detail side panel (slide-from-right) | Not started |
| 7 | Delivery board redesign | Not started |
| 8 | Reports page with animated charts | Not started |
| 9 | Notification system (bell + toasts) | Not started |
| 10 | Dark/light theme toggle across all views | Not started |
| 11 | Mobile responsive (bottom tabs, horizontal scroll) | Not started |
| 12 | Polish animations (confetti, skeletons, micro-interactions) | Not started |

### NOT BUILT — GAPS IDENTIFIED

| Module | Priority | Why It Matters |
|--------|----------|---------------|
| Lead Manager | HIGH | No way to ingest leads from Google/Meta/SEO — they have nowhere to land |
| Chatbot Engine | HIGH | No automated first-contact with leads — everything is manual |
| Inventory Command Center | HIGH | Managers have no single dashboard to see all units, photos, location, safety status |
| Finance Desk | HIGH | No lender submission tracking — DealerTrack/Credit Up status is tracked nowhere |
| Pre-Delivery Enforcement | HIGH | Checklist exists but doesn't block delivery scheduling when items are incomplete |
| Garage Work Orders | MEDIUM | No auto-email to garage — work orders are manual calls/emails |
| Driver Dispatch Auto-Email | MEDIUM | Dispatch exists but doesn't auto-email the driver company |
| Document Manager | MEDIUM | No DocuSign/OneSpan integration — signing is done outside the system |
| Funding Tracker | MEDIUM | No tracking of bank funding status after file submission |
| IDV Tracking | MEDIUM | Identity verification status not tracked per deal |
| Insurance Tracking | MEDIUM | Client insurance status not tracked per deal |
| Wet Ink File Management | MEDIUM | No tracking of physical document preparation for drivers |
| Trade-In Management | MEDIUM | Trade-in details exist on deals but no standalone tracking |
| Wholesale Manager | LOW | No aging alerts, auction tracking, or wholesale offer management |
| Notifications & Automation Engine | LOW | No GHL-style trigger workflows (auto-actions on status change) |
| Photo Management | LOW | No photo gallery per vehicle, no compliance tracking |
| Role-Based Access | LOW | No permission levels — everyone sees everything |

---

## Build Order (Revised)

The order below is based on dependency chains — each module enables the next.

### PHASE A — Complete the UI/UX Redesign (Steps 4–12)

Everything else builds on top of the new UI. Finish this first.

### PHASE B — Core Pipeline Gaps

| Order | Module | Why now |
|-------|--------|---------|
| B1 | Lead Manager | Leads have nowhere to enter the system — this is the top of the funnel |
| B2 | Finance Desk | Once leads become deals, finance tracking is the next gap |
| B3 | Pre-Delivery Enforcement | Checklist exists but needs teeth — block delivery until complete |
| B4 | Funding Tracker | Closes the loop from deal signing to bank funding |

### PHASE C — Operations & Automation

| Order | Module | Why now |
|-------|--------|---------|
| C1 | Inventory Command Center | Manager dashboard — the single pane of glass |
| C2 | Garage Work Orders (auto-email) | Eliminate manual communication with garages |
| C3 | Driver Dispatch (auto-email upgrade) | Eliminate manual communication with driver company |
| C4 | Document Manager | DocuSign/OneSpan integration for signing workflow |

### PHASE D — Intelligence & Automation

| Order | Module | Why now |
|-------|--------|---------|
| D1 | Notifications & Automation Engine | Trigger-based workflows across the system |
| D2 | Wholesale Manager | Aging units, auction, wholesale offers |
| D3 | Chatbot Engine | Automated lead engagement (text + voice) |
| D4 | Role-Based Access Control | Permission levels per user type |

---

## Module-by-Module Build Specifications

Each module below contains everything needed to prompt Claude Code or Claude to build it correctly: data model, API endpoints, UI components, business logic, and the exact prompt to use.

---

### MODULE B1: Lead Manager

**What it does:** Ingests leads from Google Ads, Meta Ads, SEO landing pages, and manual entry. Creates a lead record. Tracks source, status, and assigns to a salesperson or chatbot queue.

**Database — new table: `leads`**

```
leads
├── id (uuid, PK)
├── created_at (timestamp)
├── updated_at (timestamp)
├── source (enum: google_ads, meta_ads, seo, referral, walk_in, phone, manual)
├── source_campaign (text, nullable — ad campaign name)
├── source_medium (text, nullable — cpc, organic, social, etc.)
├── status (enum: new, contacted, qualified, converted, lost)
├── first_name (text)
├── last_name (text)
├── email (text, nullable)
├── phone (text)
├── preferred_language (enum: en, fr)
├── preferred_contact (enum: text, call, email)
├── vehicle_interest (text, nullable — what they're looking for)
├── budget_range (text, nullable)
├── has_trade_in (boolean, default false)
├── trade_in_details (text, nullable)
├── timeline (enum: immediate, this_week, this_month, browsing)
├── assigned_to (uuid, FK → salespeople.id, nullable)
├── chatbot_summary (text, nullable — handoff notes from chatbot)
├── converted_deal_id (uuid, FK → deals.id, nullable)
├── notes (text, nullable)
├── last_contacted_at (timestamp, nullable)
├── lost_reason (text, nullable)
```

**API Endpoints:**

```
GET    /api/leads              — List all leads (with filters: source, status, assigned_to, date range)
GET    /api/leads/:id          — Get single lead
POST   /api/leads              — Create lead (manual entry or webhook from ad platform)
PUT    /api/leads/:id          — Update lead
DELETE /api/leads/:id          — Soft delete
POST   /api/leads/:id/convert  — Convert lead to deal (creates deal record, links lead)
POST   /api/leads/webhook      — Incoming webhook endpoint for Google/Meta lead forms
GET    /api/leads/stats        — Lead stats (count by source, conversion rate, avg time to contact)
```

**UI Components:**

```
LeadsDashboard.jsx       — Main view: stats bar + filter bar + lead list/grid
LeadCard.jsx             — Individual lead card (name, source badge, status, vehicle interest, time since created)
LeadDetail.jsx           — Slide-out panel (same pattern as deal detail) with full lead info + convert button
LeadForm.jsx             — Create/edit lead form
LeadWebhookConfig.jsx    — Settings page to configure webhook URLs for Google/Meta
```

**Business Logic:**

- New leads auto-assigned round-robin to available salespeople (or to chatbot queue if chatbot is active)
- Lead aging: visual indicator if no contact within 5 minutes (red), 15 minutes (amber), 1 hour (stale)
- Convert action: creates a deal record pre-populated with lead data, marks lead as converted, links the records
- Duplicate detection: match on phone number — flag if lead already exists
- Stats: conversion rate by source, average time from lead to first contact, leads per salesperson

**Prompt to build this module:**

```
Build the Lead Manager module for the Kia Deal Tracker.

Database: Create a Supabase migration for a `leads` table with these columns:
[paste the schema above]

Add RLS policies matching the existing deals table pattern.

Backend: Create server/routes/leads.js with these endpoints:
[paste the endpoints above]

Follow the exact patterns from server/routes/deals.js for Supabase queries, error handling, and response format.

Add a POST /api/leads/webhook endpoint that accepts Google Ads and Meta lead form webhook payloads, normalizes them into our lead schema, and creates a lead record.

Frontend: Create these components in client/src/components/:
[paste the components above]

Follow the existing design system in index.css (CSS variables, light/dark mode).
Use the same patterns as Dashboard.jsx for the stats bar and filter bar.
Use the same slide-out panel pattern planned for DealDetail for the LeadDetail panel.
Lead cards should show: name, source icon/badge, status pill, vehicle interest (truncated), time since created with aging color (green < 5min, amber 5-15min, red > 15min).

Add a "Convert to Deal" button in LeadDetail that:
1. Opens a pre-filled DealForm with the lead's data
2. On save, updates the lead status to "converted" and links the deal ID

Add the route to App.jsx: /leads → LeadsDashboard
Add "Leads" to the sidebar navigation in Layout.jsx with the Users icon from lucide-react.
Add EN/FR translations to both locale files.
```

---

### MODULE B2: Finance Desk

**What it does:** Tracks lender submissions, approval status, conditions, and vehicle selection confirmation. This is the F&I agent's workspace after receiving a lead handoff.

**Database — new table: `lender_submissions`**

```
lender_submissions
├── id (uuid, PK)
├── deal_id (uuid, FK → deals.id)
├── lender_name (text — bank/lender name)
├── platform (enum: dealertrack, credit_up, manual)
├── submitted_at (timestamp)
├── status (enum: submitted, pending, approved, conditional, declined)
├── approval_amount (numeric, nullable)
├── rate (numeric, nullable — interest rate)
├── term (integer, nullable — months)
├── conditions (text, nullable — lender conditions for approval)
├── conditions_met (boolean, default false)
├── selected (boolean, default false — is this the chosen approval?)
├── notes (text, nullable)
├── updated_at (timestamp)
```

**Database — new columns on `deals` table:**

```
deals (add columns)
├── finance_status (enum: not_submitted, submitted, approved, conditional, funded)
├── selected_lender (text, nullable)
├── approval_amount (numeric, nullable)
├── approval_rate (numeric, nullable)
├── approval_term (integer, nullable)
├── vehicle_confirmed (boolean, default false)
├── vehicle_confirmed_by (uuid, FK → salespeople.id, nullable)
├── vehicle_confirmed_at (timestamp, nullable)
```

**API Endpoints:**

```
GET    /api/deals/:id/submissions        — List all lender submissions for a deal
POST   /api/deals/:id/submissions        — Add a lender submission
PUT    /api/submissions/:id              — Update submission status
POST   /api/submissions/:id/select       — Select this approval as the chosen one (deselects others)
PUT    /api/deals/:id/vehicle-confirm     — Mark vehicle selection as confirmed by F&I
```

**UI Components:**

```
FinanceSection.jsx       — Tab/section within DealDetail showing all lender submissions
SubmissionCard.jsx       — Individual submission: lender name, status badge, rate, term, conditions
SubmissionForm.jsx       — Add/edit submission form
VehicleConfirmation.jsx  — Confirmation UI with F&I manager sign-off
```

**Business Logic:**

- When a submission is selected, auto-update the deal's finance_status, selected_lender, approval_amount, rate, term
- Conditional approvals show conditions as a checklist — finance_status stays "conditional" until conditions_met = true
- Vehicle confirmation requires F&I sign-off — records who confirmed and when
- Dashboard filter: add "Finance Status" filter to existing filter bar

**Prompt to build this module:**

```
Build the Finance Desk module for the Kia Deal Tracker.

This module tracks lender submissions and approvals within each deal.

Database: Create a Supabase migration that:
1. Creates a `lender_submissions` table: [paste schema above]
2. Adds these columns to the existing `deals` table: [paste new columns above]

Backend: Create server/routes/submissions.js with: [paste endpoints above]
Follow the exact patterns from server/routes/deals.js.

Frontend:
1. Create FinanceSection.jsx — a section within the deal detail view that shows:
   - Current finance status badge
   - List of all lender submissions as cards
   - "Add Submission" button
   - When a submission is approved, show a "Select This Approval" button
   - Selected approval highlighted with accent border

2. Create SubmissionForm.jsx — form to add/edit a lender submission with fields for: lender_name, platform (dropdown: DealerTrack/Credit Up/Manual), status, approval_amount, rate, term, conditions, notes

3. Create VehicleConfirmation.jsx — shows vehicle details with a "Confirm Vehicle Selection" button that records the F&I manager and timestamp

4. Integrate FinanceSection into DealDetail.jsx as a new tab

5. Add "Finance Status" to the Dashboard filter bar (not_submitted, submitted, approved, conditional, funded)

6. Add EN/FR translations for all new strings.
```

---

### MODULE B3: Pre-Delivery Enforcement

**What it does:** Upgrades the existing delivery checklist from a passive tracker to an enforcement gate. Delivery cannot be scheduled until all required items are complete.

**Database — new columns on `delivery_checklists` table:**

```
delivery_checklists (add columns)
├── insurance_status (enum: not_received, received, verified)
├── insurance_provider (text, nullable)
├── insurance_policy_number (text, nullable)
├── insurance_file_id (text, nullable — uploaded file reference)
├── void_cheque_status (enum: not_received, received)
├── void_cheque_file_id (text, nullable)
├── funding_status (enum: not_submitted, submitted, funded)
├── funding_confirmed_at (timestamp, nullable)
├── idv_status (enum: not_started, sent, completed, failed)
├── idv_completed_at (timestamp, nullable)
├── safety_status (enum: not_started, sent_to_garage, in_progress, passed, failed)
├── safety_completed_at (timestamp, nullable)
├── wet_ink_file_status (enum: not_prepared, prepared, with_driver, signed, returned)
├── delivery_date (timestamp, nullable)
├── delivery_blocked (boolean, computed — true if any required item incomplete)
├── delivery_blocked_reasons (text[], computed — list of incomplete items)
```

**Business Logic:**

- Delivery date CANNOT be set unless ALL of these are true:
  - insurance_status = verified
  - void_cheque_status = received
  - funding_status = funded
  - idv_status = completed
  - safety_status = passed
  - wet_ink_file_status = prepared (at minimum)
- If any item is incomplete, the "Schedule Delivery" button is disabled and shows exactly which items are blocking
- Each item has a visual status indicator: red (not started), amber (in progress), green (complete)
- Alerts: if a deal is approved but pre-delivery items haven't moved in 48 hours, alert the assigned salesperson

**Prompt to build this module:**

```
Upgrade the existing delivery checklist system in the Kia Deal Tracker to enforce pre-delivery requirements.

Currently: The delivery checklist (DeliveryChecklist.jsx, server/routes/deliveryChecklists.js) has 4 items with file uploads. It tracks but doesn't enforce.

Required changes:

Database: Add these columns to the delivery_checklists table: [paste schema above]

Backend: Update server/routes/deliveryChecklists.js:
- Add a GET /api/delivery-checklists/:dealId/readiness endpoint that returns:
  { ready: boolean, blocking_items: string[] }
- The PUT endpoint should recalculate readiness on every update
- Add validation: if a user tries to set delivery_date while blocking items exist, return 400 with the list of blocking items

Frontend: Update DeliveryChecklist.jsx:
- Show each requirement as a row with: label, current status (color-coded badge), action button, file upload if applicable
- Requirements: Insurance (upload + verify), Void Cheque (upload), Funding (status from finance), IDV (status tracker), Safety Inspection (status from garage work order), Wet Ink File (preparation status)
- The "Schedule Delivery" button should be disabled with a tooltip listing blocking items when not all requirements are met
- When all items are green, show the Schedule Delivery button as active with a success state
- Add a progress bar at the top: "4 of 6 requirements complete"

Add EN/FR translations for all new strings.
```

---

### MODULE B4: Funding Tracker

**What it does:** Tracks the deal file from submission to the bank through to funding confirmation. Connects to the finance desk and pre-delivery checklist.

**Database — new table: `funding_records`**

```
funding_records
├── id (uuid, PK)
├── deal_id (uuid, FK → deals.id)
├── lender_submission_id (uuid, FK → lender_submissions.id)
├── submitted_at (timestamp)
├── status (enum: preparing, submitted, in_review, stips_required, funded, rejected)
├── stips (jsonb, nullable — array of stipulation objects: {name, status, note})
├── funded_at (timestamp, nullable)
├── funded_amount (numeric, nullable)
├── funding_number (text, nullable — bank reference number)
├── notes (text, nullable)
├── updated_at (timestamp)
```

**Business Logic:**

- One funding record per deal (linked to the selected lender submission)
- When funding_status changes to "funded", auto-update the deal's pre-delivery checklist funding_status to "funded"
- Stips (stipulations) are bank-required conditions — each stip has its own status (pending/submitted/accepted)
- Dashboard should show funding status in the deal card
- Funding aging: if submitted > 3 days with no update, flag as amber. > 7 days, flag as red.

**Prompt to build this module:**

```
Build the Funding Tracker module for the Kia Deal Tracker.

This tracks a deal from bank submission through to funding confirmation.

Database: Create a Supabase migration for a `funding_records` table: [paste schema above]

Backend: Create server/routes/funding.js:
- GET /api/deals/:id/funding — get funding record for a deal
- POST /api/deals/:id/funding — create funding record
- PUT /api/funding/:id — update funding status
- PUT /api/funding/:id/stips — update stipulations
- When status changes to "funded", also update the deal's delivery_checklist funding_status to "funded"

Frontend: Create FundingSection.jsx — a section within DealDetail showing:
- Current funding status as a step indicator (preparing → submitted → in_review → funded)
- Stipulations list with individual status toggles
- Funding confirmation form (funded_amount, funding_number, funded_at)
- Aging indicator: green (< 3 days), amber (3-7 days), red (> 7 days since submission)

Integrate into DealDetail.jsx as a new tab.
Add EN/FR translations.
```

---

### MODULE C1: Inventory Command Center

**What it does:** Manager-facing dashboard showing every vehicle in inventory with location, photos, safety status, costs, and aging. This is the single screen the GM, used car manager, and wholesale lead live in.

**Database — new table: `inventory`**

```
inventory
├── id (uuid, PK)
├── vin (text, unique)
├── stock_number (text, unique)
├── year (integer)
├── make (text)
├── model (text)
├── trim (text, nullable)
├── exterior_color (text, nullable)
├── interior_color (text, nullable)
├── mileage (integer)
├── vehicle_type (enum: new, used)
├── acquisition_type (enum: in_stock, dealer_trade, auction, wholesale, trade_in)
├── acquisition_date (timestamp)
├── acquisition_cost (numeric)
├── transport_cost (numeric, default 0)
├── recon_cost (numeric, default 0)
├── total_invested (numeric, computed — acquisition + transport + recon)
├── list_price (numeric, nullable)
├── location_status (enum: on_lot, at_garage, at_source_dealership, in_transit, delivered, wholesale)
├── location_details (text, nullable — which garage, which dealership, etc.)
├── safety_status (enum: not_required, not_started, sent_to_garage, in_progress, passed, failed)
├── safety_sent_at (timestamp, nullable)
├── safety_completed_at (timestamp, nullable)
├── recon_status (enum: not_needed, needs_detailing, needs_body, needs_mechanical, in_progress, ready)
├── photo_count (integer, default 0)
├── photos (text[], nullable — array of file URLs)
├── deal_id (uuid, FK → deals.id, nullable — linked deal if sold)
├── deal_status (enum: available, reserved, sold_pending, delivered)
├── days_in_stock (integer, computed — from acquisition_date)
├── notes (text, nullable)
├── created_at (timestamp)
├── updated_at (timestamp)
```

**API Endpoints:**

```
GET    /api/inventory              — List all (with filters: location, safety, deal_status, aging, type)
GET    /api/inventory/:id          — Single vehicle detail
POST   /api/inventory              — Add vehicle
PUT    /api/inventory/:id          — Update vehicle
POST   /api/inventory/:id/photos   — Upload photos
DELETE /api/inventory/:id/photos/:photoId — Remove photo
GET    /api/inventory/stats        — Aggregate stats (total units, by location, avg days, total invested)
GET    /api/inventory/aging        — Aging report (sorted by days_in_stock desc)
GET    /api/inventory/garage-queue — Units at or waiting for garage
GET    /api/inventory/incoming     — Units in transit
GET    /api/inventory/wholesale    — Units flagged for wholesale
```

**UI Components:**

```
InventoryDashboard.jsx     — Main view with stats bar + view toggle + vehicle grid
InventoryStatsBar.jsx      — Total units, by location, avg days in stock, total investment
InventoryCard.jsx           — Vehicle card: photo thumbnail, year/make/model, location badge, safety badge, days in stock, cost
InventoryDetail.jsx         — Slide-out panel: full vehicle info, photo gallery, status history, linked deal
InventoryFilters.jsx        — Filter bar: location, safety, deal_status, aging range, acquisition type
InventoryViews.jsx          — Toggle: card grid / list table / kanban by location status
PhotoUploader.jsx           — Drag-and-drop photo upload with gallery preview
AgingReport.jsx             — Table sorted by days in stock, color-coded rows
GarageQueue.jsx             — Filtered view of units at garage with time tracking
```

**Dashboard Views:**

| View | Layout | Default for |
|------|--------|------------|
| Pipeline | Kanban columns by location_status | Used car manager |
| Grid | Card grid with photo thumbnails | General browsing |
| Table | Spreadsheet-style sortable list | GM, financial review |
| Aging | Sorted by days_in_stock, color rows | Wholesale manager |
| Garage | Filtered to garage units only | Operations |

**Automated Alerts (integrate with Notifications Engine later):**

- Unit hits 45 days in stock → alert GM + wholesale
- Safety sent > 5 days ago with no result → alert used car manager
- Unit on lot > 48 hours with 0 photos → alert used car manager
- Incoming unit ETA is today → alert logistics
- Recon cost exceeds $2,000 → alert GM

**Prompt to build this module:**

```
Build the Inventory Command Center for the Kia Deal Tracker.

This is the manager-facing dashboard for tracking all vehicles — location, photos, safety, costs, aging.

Database: Create a Supabase migration for an `inventory` table: [paste schema above]

Backend: Create server/routes/inventory.js with: [paste all endpoints above]
Follow patterns from server/routes/deals.js.

Frontend:
1. InventoryDashboard.jsx — main view with:
   - Stats bar: total units, units by location (on lot / garage / in transit / source), avg days in stock, total $ invested
   - Filter bar: location_status, safety_status, deal_status, days_in_stock range, acquisition_type, vehicle_type
   - View toggle: Grid (card view) / Table (list view) / Pipeline (kanban by location_status)
   - Each view uses the same data, different layout

2. InventoryCard.jsx — vehicle card showing:
   - Photo thumbnail (first photo, or placeholder if none)
   - Photo count badge (overlay on thumbnail)
   - Year Make Model Trim (title)
   - Stock # and VIN (subtitle, truncated)
   - Location badge (colored by location_status)
   - Safety badge (colored by safety_status)
   - Days in stock badge (green < 30, amber 30-60, red 60+)
   - Total invested $ and list price $
   - Deal status indicator if reserved/sold

3. InventoryDetail.jsx — slide-out panel:
   - Photo gallery with upload capability (drag-and-drop)
   - All vehicle details in sections: Vehicle Info, Financials, Status, Linked Deal
   - Status history timeline
   - Action buttons: Send to Garage (creates work order), Flag for Wholesale, Link to Deal

4. Add route: /inventory → InventoryDashboard
5. Add "Inventory" to sidebar in Layout.jsx with Package icon from lucide-react
6. Add EN/FR translations for all new strings
```

---

### MODULE C2: Garage Work Orders (Auto-Email)

**What it does:** Creates a work order for a vehicle, auto-sends an email to the assigned garage with all vehicle details and service requirements.

**Database — new table: `work_orders`**

```
work_orders
├── id (uuid, PK)
├── inventory_id (uuid, FK → inventory.id)
├── deal_id (uuid, FK → deals.id, nullable)
├── garage_name (text)
├── garage_email (text)
├── service_type (enum: safety_inspection, mechanical_repair, body_work, detailing, full_recon)
├── description (text — what needs to be done)
├── status (enum: draft, sent, received, in_progress, completed, cancelled)
├── sent_at (timestamp, nullable)
├── estimated_completion (timestamp, nullable)
├── actual_completion (timestamp, nullable)
├── cost_estimate (numeric, nullable)
├── actual_cost (numeric, nullable)
├── notes (text, nullable)
├── created_at (timestamp)
├── updated_at (timestamp)
```

**Database — new table: `garages`**

```
garages
├── id (uuid, PK)
├── name (text)
├── email (text)
├── phone (text, nullable)
├── address (text, nullable)
├── province (enum: ontario, quebec)
├── does_ontario_safety (boolean, default false)
├── does_quebec_safety (boolean, default false)
├── services (text[] — array of service types they offer)
├── is_internal (boolean, default false — true for Kia's own garage)
├── active (boolean, default true)
```

**Business Logic:**

- When a work order is created and status set to "sent", auto-send email to garage_email via Resend
- Email includes: vehicle year/make/model/VIN, mileage, service requested, description, dealership contact info
- When work order completed, auto-update the inventory record's safety_status and recon_status
- Auto-update the deal's delivery checklist safety_status when safety inspection work order is completed
- Garage selection logic: if vehicle needs Ontario safety, filter to garages where does_ontario_safety = true

**Prompt to build this module:**

```
Build the Garage Work Orders module for the Kia Deal Tracker.

Database: Create Supabase migrations for: [paste both schemas above]

Backend:
1. Create server/routes/workOrders.js with:
   - CRUD endpoints for work orders
   - POST /api/work-orders/:id/send — sends email to garage via Resend, updates status to "sent"
   - PUT /api/work-orders/:id/complete — marks complete, updates inventory safety/recon status, updates delivery checklist if linked to a deal

2. Create server/routes/garages.js with CRUD for garage management

3. Email template: Use the existing Resend integration in server/services/email.js. Create a work order email template that includes: vehicle details (year, make, model, VIN, mileage), service type, description, requesting dealership, contact info.

Frontend:
1. WorkOrderForm.jsx — form with: vehicle selector (from inventory), garage selector (filtered by service capability and province), service type, description, estimated completion
2. WorkOrderCard.jsx — shows vehicle, garage, service, status badge, days since sent
3. WorkOrderList.jsx — filterable list of all work orders
4. GarageManager.jsx — settings page to add/edit garages
5. Add a "Send to Garage" action button in InventoryDetail.jsx that opens WorkOrderForm pre-filled with the vehicle

Add route: /work-orders → WorkOrderList
Add "Garages" to settings area
Add EN/FR translations.
```

---

### MODULE C3: Driver Dispatch Auto-Email Upgrade

**What it does:** Upgrades existing dispatch system to auto-email the driver company when a run is booked.

**Database — new table: `driver_companies`**

```
driver_companies
├── id (uuid, PK)
├── name (text)
├── email (text)
├── phone (text, nullable)
├── contact_name (text, nullable)
├── service_area (text, nullable)
├── active (boolean, default true)
```

**Database — add columns to existing dispatch table:**

```
dispatch (add columns)
├── driver_company_id (uuid, FK → driver_companies.id, nullable)
├── dispatch_type (enum: delivery, pickup, transfer)
├── pickup_address (text, nullable)
├── delivery_address (text, nullable)
├── has_trade_in (boolean, default false)
├── drivers_needed (integer, default 1 — auto-calculated: 2 if no trade-in, 1 if trade-in)
├── email_sent (boolean, default false)
├── email_sent_at (timestamp, nullable)
├── wet_ink_file_ready (boolean, default false)
├── cash_to_collect (numeric, nullable)
├── special_instructions (text, nullable)
```

**Business Logic:**

- When dispatch is booked, auto-send email to driver company with: pickup location, delivery location, vehicle details, number of drivers needed, whether trade-in is coming back, cash to collect, wet ink file status, special instructions
- Drivers needed auto-calculates: 2 if delivery + no trade-in (need chaser), 1 if delivery + trade-in
- Dispatch cannot be booked if wet_ink_file_status is not at least "prepared" on the delivery checklist
- Email template includes all logistics details the driver needs

**Prompt to build this module:**

```
Upgrade the existing Dispatch system in the Kia Deal Tracker to auto-email driver companies.

The dispatch system already exists (DispatchDashboard.jsx, server/routes/dispatch.js). This upgrade adds:

Database:
1. Create `driver_companies` table: [paste schema]
2. Add columns to existing dispatch table: [paste new columns]

Backend: Update server/routes/dispatch.js:
- On dispatch creation/booking, auto-send email to driver company via Resend
- Email template includes: pickup address, delivery address, vehicle (year/make/model/color), drivers needed, trade-in (yes/no + details), cash to collect, wet ink file status, delivery date/time, special instructions
- Auto-calculate drivers_needed: if has_trade_in = false, drivers_needed = 2; if true, drivers_needed = 1
- Validate: don't allow booking if the deal's wet_ink_file_status is not "prepared" or later

Frontend: Update DispatchDashboard.jsx and DispatchCard.jsx:
- Add driver company selector (from driver_companies table)
- Show email status (sent/not sent) on dispatch cards
- Add "Resend Email" button
- Show drivers needed with explanation (e.g., "2 drivers — no trade-in, need chaser")
- Create DriverCompanyManager.jsx for settings page

Add EN/FR translations.
```

---

### MODULE C4: Document Manager

**What it does:** Tracks all documents per deal — what needs to be signed, what's been signed, integration with DocuSign/OneSpan for e-signatures, wet ink tracking for physical documents.

**Database — new table: `deal_documents`**

```
deal_documents
├── id (uuid, PK)
├── deal_id (uuid, FK → deals.id)
├── document_type (enum: bank_contract, bill_of_sale, warranty, aftermarket, legal_waiver, supplementary, wet_ink)
├── document_name (text)
├── source_system (enum: dealertrack, cams, merlin, manual)
├── signing_method (enum: docusign, onespan, wet_ink)
├── status (enum: not_ready, ready, sent_for_signature, signed, returned, filed)
├── file_url (text, nullable — uploaded/generated file)
├── signed_file_url (text, nullable — signed version)
├── envelope_id (text, nullable — DocuSign/OneSpan envelope ID)
├── signed_at (timestamp, nullable)
├── signed_by (text, nullable)
├── notes (text, nullable)
├── created_at (timestamp)
├── updated_at (timestamp)
```

**Business Logic:**

- Each deal has a document checklist generated based on deal type
- Standard document set: bank contract (DealerTrack), bill of sale (CAMS or Merlin depending on store), warranty, aftermarket products, legal waivers, supplementary forms
- Bill of sale source is determined by store: Ready Group stores use CAMS, Kia store uses Merlin
- Wet ink documents tracked separately — status from "not prepared" through to "returned from delivery"
- Document status feeds into pre-delivery checklist (wet_ink_file_status)

**Prompt to build this module:**

```
Build the Document Manager module for the Kia Deal Tracker.

Database: Create a Supabase migration for `deal_documents` table: [paste schema above]

Backend: Create server/routes/documents.js:
- CRUD endpoints for deal documents
- GET /api/deals/:id/documents — all documents for a deal
- POST /api/deals/:id/documents/generate-checklist — auto-generates the standard document list based on deal type and store
- PUT /api/documents/:id/status — update document status
- POST /api/documents/:id/upload — upload file (signed or unsigned)

Frontend:
1. DocumentSection.jsx — section within DealDetail showing all documents as a checklist
   - Each document row: name, type badge, source system, signing method, status badge, file upload/download
   - Group by: e-sign documents and wet ink documents
   - Progress indicator: "5 of 8 documents complete"
2. "Generate Document Checklist" button that auto-creates the standard set
3. File upload for each document (reuse existing FileUpload.jsx)

Integrate into DealDetail.jsx as a new tab.
Add EN/FR translations.
```

---

### MODULE D1: Notifications & Automation Engine

**What it does:** System-wide notification system with bell icon, toast notifications, and GHL-style trigger-based automations.

**Database — new tables:**

```
notifications
├── id (uuid, PK)
├── user_id (uuid, FK)
├── type (enum: info, warning, urgent, success)
├── title (text)
├── message (text)
├── link (text, nullable — deep link to relevant page)
├── read (boolean, default false)
├── created_at (timestamp)

automation_rules
├── id (uuid, PK)
├── name (text)
├── trigger_event (text — e.g., "deal.status_changed", "inventory.days_in_stock > 45")
├── conditions (jsonb — additional conditions to check)
├── action_type (enum: send_email, create_notification, update_field, create_task)
├── action_config (jsonb — action-specific configuration)
├── active (boolean, default true)
├── created_at (timestamp)
```

**Built-in Automation Rules (pre-configured):**

```
1. Lead not contacted in 5 min → urgent notification to assigned salesperson
2. Deal approved but pre-delivery items stale 48h → warning notification to salesperson
3. Inventory unit > 45 days in stock → notification to GM + wholesale
4. Safety inspection sent > 5 days ago, no result → notification to used car manager
5. Vehicle on lot > 48h with 0 photos → notification to used car manager
6. Funding submitted > 7 days, no update → warning notification to F&I
7. Delivery scheduled for tomorrow → notification to logistics + drivers
8. Work order completed → notification to used car manager
9. New lead from Google/Meta → notification to sales manager
10. Deal funded → success notification to salesperson + F&I
```

**Prompt to build this module:**

```
Build the Notifications & Automation Engine for the Kia Deal Tracker.

Database: Create Supabase migrations for: [paste both schemas above]

Backend:
1. Create server/routes/notifications.js — CRUD + mark-as-read + mark-all-read
2. Create server/services/automationEngine.js:
   - A function that evaluates automation rules against events
   - Called by other routes when relevant events happen (deal status change, inventory update, etc.)
   - Executes actions: create notification, send email via Resend
3. Create server/routes/automations.js — CRUD for automation rules
4. Seed the 10 built-in automation rules listed above

Frontend:
1. Update Layout.jsx top bar — bell icon shows unread count, dropdown shows recent notifications
2. NotificationDropdown.jsx — list of notifications with read/unread styling, click to navigate
3. NotificationToast.jsx — toast popup for new notifications (bottom-right, auto-dismiss 5s)
4. AutomationManager.jsx — settings page to view/edit/toggle automation rules (admin only)
5. Use Supabase real-time subscriptions to push new notifications to the UI without refresh

Add route: /settings/automations → AutomationManager
Add EN/FR translations.
```

---

### MODULE D2: Wholesale Manager

**What it does:** Manages aging units flagged for wholesale — tracks offers, auction listings, and liquidation decisions.

**Prompt to build this module:**

```
Build the Wholesale Manager module for the Kia Deal Tracker.

This manages aging inventory units flagged for wholesale disposal.

Database: Create a `wholesale_listings` table:
- id, inventory_id (FK), flagged_at, flagged_by, reason (aging/overstock/damage),
  status (flagged/listed/offer_received/sold/cancelled),
  listing_platform (auction/direct/online), listing_date, listing_url,
  offers (jsonb array: [{buyer, amount, date, status}]),
  sold_to, sold_amount, sold_at, notes, created_at, updated_at

Backend: CRUD endpoints at /api/wholesale. When a unit is sold wholesale,
update inventory deal_status to "delivered" and record the sale.

Frontend:
1. WholesaleDashboard.jsx — table of all flagged units sorted by days in stock
   - Columns: vehicle, days in stock, total invested, asking price, # offers, best offer, status
   - Color rows: amber > 60 days, red > 90 days
2. WholesaleDetail.jsx — slide-out with offer management
3. "Flag for Wholesale" button in InventoryDetail.jsx
4. Add route: /wholesale → WholesaleDashboard

Add EN/FR translations.
```

---

## UI/UX Redesign Steps (Already Planned — Steps 4–12)

These are already defined in the project handoff doc. Execute them in order before starting Phase B. Each step has a clear scope:

| Step | What to Build | Prompt Strategy |
|------|--------------|-----------------|
| 4 | Kanban pipeline + list toggle | Replace Dashboard.jsx grid with @hello-pangea/dnd kanban columns by deal stage + table toggle |
| 5 | Deal cards with rotting + drag-drop | Redesign deal cards per the Card Design Spec in the research doc |
| 6 | Deal detail side panel | Slide-from-right panel instead of full page nav, tabbed interface |
| 7 | Delivery board redesign | Apply new design system to DeliveryDashboard.jsx |
| 8 | Reports with animated charts | Framer Motion animations on Recharts components |
| 9 | Notification system | Bell icon + toast (partially covered by Module D1) |
| 10 | Theme toggle polish | Ensure all views respect light/dark CSS variables |
| 11 | Mobile responsive | Bottom tab nav, horizontal pipeline scroll, swipe gestures |
| 12 | Polish animations | Loading skeletons, micro-interactions, deal-won confetti |

---

## How to Use This Document

1. Start with Step 4 of the UI/UX redesign (Kanban pipeline)
2. Work through Steps 4–12 sequentially
3. Move to Phase B modules (B1 → B2 → B3 → B4)
4. Move to Phase C modules (C1 → C2 → C3 → C4)
5. Move to Phase D modules (D1 → D2)
6. For each module, copy the "Prompt to build this module" section and paste it into Claude Code
7. Prepend the Operating Directives (from claude-operating-directives.md) to every session
8. After each module is built, test it, then move to the next

Each module prompt is self-contained — it includes the database schema, API endpoints, UI components, and business logic. Claude Code should be able to execute each one start to finish without stopping to ask questions.


---

# 13. Gap Map

# Kia Tracker — Gap Map & Discussion Items

**Overall completion: ~30% across 14 modules**
**Items needing discussion: 23 | Ready to build once discussed: 18**

---

## CRITICAL — Architecture Decisions (Decide First)

These block multiple modules. Resolve before building further.

### 1. Inventory Table Architecture
- **Question:** Should vehicles live on a SEPARATE `inventory` table (vehicles exist independently of deals), or stay on the `deals` table?
- **Why it matters:** A separate table means a vehicle can exist before being sold — which is how real inventory management works. It affects Inventory Command Center, Garage Work Orders, Wholesale Manager, and Photo Management.
- **Current state:** Vehicles are part of the deals table. There is no standalone vehicle record.

### 2. Multi-Store / Multi-Tenant
- **Question:** Ready Group stores (Ontario) + Kia store (Quebec). Shared database with a `store_id` column, or separate instances? Who sees whose data?
- **Why it matters:** Stores have different garages, different bill of sale systems (CAMS vs Merlin), different safety inspection rules (Ontario vs Quebec). Every query, dashboard, and permission needs to know which store it's scoped to.
- **Current state:** No store concept exists in the data model.

### 3. Role-Based Access Control
- **Question:** Define every role and what they can see/do. Likely roles: GM, sales manager, used car manager, F&I agent, salesperson, wholesale manager, logistics coordinator.
- **Why it matters:** Every notification, dashboard view, and API endpoint depends on knowing who can see and do what.
- **Current state:** Authentication exists (login with localStorage) but no role system. Everyone sees everything.

### 4. Deal Pipeline Stages
- **Question:** Current model is open/complete/cancelled. Your real pipeline has more stages. What are the actual stages a deal moves through?
- **Suggested based on your description:** New → Finance Pending → Approved → Signed → Safety/Recon → Ready for Delivery → Scheduled → Delivered → Funded/Complete → Lost
- **Current state:** Only open/complete/cancelled. The kanban can't be built until stages are defined.

---

## MODULE-BY-MODULE DISCUSSION ITEMS

### Lead Manager (0% built)

**Need to discuss:**

1. **Lead source integrations** — Which Google Ads and Meta accounts? Do you use lead form extensions or landing page form submissions? What fields come in each webhook payload?

2. **Lead assignment rules** — Round-robin to all salespeople, or specific reps handle specific sources? Does the GM or sales manager assign manually?

3. **Lead scoring** — Do you want automatic scoring (hot/warm/cold) based on criteria, or is every lead treated the same until contacted?

4. **Response time SLA** — You mentioned 5-minute urgency. Is that the actual target? Who gets escalated to if the assigned rep doesn't respond?

5. **Duplicate handling** — Match on phone only, or phone + email? What happens when a duplicate is found — merge, flag, or reject?

**Ready to build once discussed:**
- Lead database table and CRUD API
- Webhook endpoint for Google/Meta
- Lead dashboard with source/status filters
- Convert-to-deal action
- Lead aging indicators

---

### Chatbot Engine (0% built)

**Need to discuss:**

1. **Chatbot platform** — Building custom, or integrating a third-party (Tidio, Intercom, custom GPT)? Text-only first, or text + voice simultaneously?

2. **Data collection script** — Exact fields the chatbot must collect before handoff: name, phone, email, vehicle interest, budget, trade-in, timeline — anything else?

3. **Handoff trigger** — What signals "data collection complete"? All required fields filled? Client asks to speak to a person? Chatbot detects buying intent?

4. **Handoff destination** — Which F&I agent? Random? Based on availability? Based on language preference?

5. **Voice bot** — What platform for outbound calls? Bland AI, Vapi, Retell? What's the call script?

**Ready to build once discussed:**
- Chatbot integration layer
- Handoff summary format
- Chatbot-to-CRM data sync

---

### Deal Pipeline (60% built)

**Need to discuss:**

1. **Deal stages** — Current statuses are open/complete/cancelled. What are YOUR actual stages? (See architecture decision #4 above)

2. **Stage transition rules** — Can deals skip stages? Can they go backward? Who can change stages?

3. **Activity timeline** — Do you want a log of every action on a deal (status changes, notes, calls, emails) visible on the deal detail?

**Ready to build once discussed:**
- Kanban view with drag-and-drop (UI redesign step 4)
- Deal cards with rotting indicators (step 5)
- Slide-out deal detail panel (step 6)
- List/table view toggle

**Already built:**
- Deal CRUD with 50+ fields
- Stats bar with 7 metrics
- 9 filters on dashboard
- Real-time Supabase sync

---

### Finance Desk (15% built)

**Need to discuss:**

1. **Lender list** — Which banks/lenders do you submit to? Is there a standard set, or does it vary per deal?

2. **DealerTrack integration** — API integration, or just tracking what was submitted manually? Same question for Credit Up.

3. **Deal shopping workflow** — Do F&I agents submit to multiple lenders simultaneously and pick the best? How many submissions per deal typically?

4. **Conditional approvals** — What are the most common conditions lenders require? (Proof of income, proof of address, co-signer, larger down payment?)

5. **F&I product menu** — What aftermarket products do you sell? (Extended warranty, GAP, tire/rim, paint protection, etc.) Do these need to be tracked per deal?

6. **Vehicle selection confirmation** — Who confirms? Can a deal have the vehicle changed after approval?

**Ready to build once discussed:**
- Lender submissions table
- Multi-submission tracking per deal
- Approval comparison view
- Conditions checklist per submission
- F&I product tracking

---

### Funding Tracker (15% built)

**Need to discuss:**

1. **Funding workflow** — After signing, who submits the file to the bank? What documents go in the funding package?

2. **Stipulations** — What are the most common stips banks require post-signing? Who tracks and fulfills them?

3. **Funding timeline** — What's typical time from submission to funded? What's the escalation path when funding is delayed?

4. **Funding confirmation** — How do you know a deal is funded? Bank portal check? Email notification? Phone call?

**Ready to build once discussed:**
- Funding records table
- Stip tracking with individual statuses
- Funding aging alerts
- Auto-update delivery checklist on funding

---

### Inventory Command Center (25% built)

**Need to discuss:**

1. **Inventory vs. deals table** — (See architecture decision #1 above)

2. **Multi-store** — (See architecture decision #2 above)

3. **Photo requirements** — Minimum photo count per vehicle? Required angles (front, back, sides, interior, odometer)? Who uploads — salesperson, detail team, someone else?

4. **Cost tracking** — Who enters transport cost and recon cost? When in the process? Is there an approval threshold for recon spend?

5. **VIN decode** — Do you want auto-populate of year/make/model/trim from VIN entry?

**Ready to build once discussed:**
- Add missing fields: trim, mileage, acquisition_type, transport_cost, recon_cost, list_price, acquisition_date
- Expand vehicle_status enum (add on_lot, at_source, in_transit)
- Photo gallery with multi-upload
- Kanban by location status
- Aging report with color coding on cards
- Cost breakdown view

---

### Garage / Work Orders (5% built)

**Need to discuss:**

1. **Garage list** — Names and emails of every garage you use. Which ones do Ontario safety? Which do mechanical? Detailing? Body work?

2. **Work order content** — What info does the garage need in the email? Vehicle details, mileage, specific issues, who to contact, pickup/dropoff instructions?

3. **Kia garage scope** — You said Kia's garage does NOT do Ontario safety. What does it do exactly? Only Quebec inspections + maintenance + repairs?

4. **Recon workflow** — When a car arrives, who decides what recon it needs? Is there an inspection form? Who approves the recon spend?

5. **Turnaround tracking** — Do you need to track expected vs actual completion dates? SLA alerts when a garage is slow?

**Ready to build once discussed:**
- Garages table and management page
- Work orders table with auto-email via Resend
- Safety status workflow (5 stages)
- Recon tracking system
- Garage queue dashboard view

---

### Driver Dispatch (70% built)

**Need to discuss:**

1. **Driver company details** — Name, email, contact info for your driver companies. One company or multiple?

2. **Email content** — What exact info does the driver company need? Pickup address, delivery address, vehicle details, trade-in, cash collection, wet ink file — anything else?

3. **ETA tracking** — Do drivers provide ETAs? Via text, app, or phone call? Do you need real-time GPS tracking or just status updates?

**Ready to build once discussed:**
- Driver companies table
- Auto-email on dispatch booking
- ETA tracking field
- Incoming units dashboard view

**Already built:**
- Fleet management (chasers + dealer plates)
- Auto-assign with conflict detection
- Status tracking (pending → assigned → in_transit → completed)

---

### Document Manager (10% built)

**Need to discuss:**

1. **Document list per deal** — Exact list of every document that needs to be signed. Bank contract, bill of sale, warranty, aftermarket — what else? Legal waivers, privacy consent, OMVIC forms?

2. **Store-specific documents** — Ready Group uses CAMS for bill of sale, Kia uses Merlin. Are there other differences between stores?

3. **E-signature platform** — OneSpan or DocuSign? Both? Which documents go digital vs. wet ink?

4. **Wet ink workflow** — Who prepares the wet ink file? What goes in it? How is it tracked from preparation → in car → signed → returned → filed?

5. **Document generation** — Do you want the system to GENERATE bills of sale, or just track that they've been generated in CAMS/Merlin?

**Ready to build once discussed:**
- Deal documents table
- Document checklist auto-generation per deal type
- Document status tracking
- File upload per document
- Wet ink preparation workflow

---

### Pre-Delivery Checklist (75% built)

**Need to discuss:**

1. **Full checklist items** — Current: insurance, funded, safety, registration. Missing from your description: void cheque, IDV, wet ink file ready, delivery date confirmed, drivers booked. What's the complete list?

2. **Enforcement strictness** — Hard block (cannot schedule delivery) or soft warning (can override with manager approval)?

3. **IDV process** — How does IDV work? Which banks require it? Is it done through a specific platform? What does "completed" look like?

**Ready to build once discussed:**
- Expand from 4 to full checklist
- Enforcement gate on delivery scheduling
- IDV status tracking
- Customer confirmation capture

**Already built:**
- 4-item checklist with file uploads
- Compliance dashboard with red/green flags

---

### Delivery Tracker (65% built)

**Need to discuss:**

1. **Delivery photos** — Drivers take photos on delivery. Where do they upload? To a shared drive? Text them? Need a driver-facing upload page?

2. **Cash collection** — How is physical cash tracked? Driver signs a receipt? Amount logged in system before and after?

3. **Post-delivery process** — What happens after delivery? Follow-up call? Review request? Warranty registration? CSI survey?

**Ready to build once discussed:**
- Delivery photo upload (driver-facing page)
- Cash collection tracking
- Post-delivery follow-up automation
- Delivery proof record

**Already built:**
- Dashboard with red/green compliance flags
- Delivery booking (drivers, company, time)

---

### Notifications & Automation (15% built)

**Need to discuss:**

1. **User roles** — (See architecture decision #3 above) Who gets what alerts?

2. **Alert thresholds** — 45 days for aging alerts — is that right? Safety overdue at 5 days? What other thresholds matter?

3. **SMS** — Do you want SMS notifications to staff? To clients? What platform (Twilio, internal)?

4. **Client-facing automation** — Auto-text clients for insurance reminders, IDV requests, delivery confirmations? Or staff-only notifications?

**Ready to build once discussed:**
- Notifications table + bell icon UI
- Toast notification system
- 10 pre-built automation rules
- Role-based alert routing

**Already built:**
- 2 manual email triggers (deal closing report + driver dispatch via Resend)

---

### Wholesale Manager (10% built)

**Need to discuss:**

1. **Wholesale decision process** — Who decides a unit goes wholesale? At what age? Is there a price threshold?

2. **Auction platforms** — Which auctions do you use? Online (TradeRev, ACV, ADESA)? Physical? Both?

3. **Wholesale pricing** — How do you determine wholesale price? MMR? Book value? Manager discretion?

**Ready to build once discussed:**
- Wholesale listings table
- Aging-based auto-flag rules
- Offer tracking board

---

### Reporting & Analytics (60% built)

**Need to discuss:**

1. **GM dashboard** — What does the GM want to see on login? Total gross, deals in pipeline, aging units, funding status, team performance — what's the priority?

2. **P&L per unit** — Do you want full profit/loss breakdown per vehicle including: acquisition + transport + recon + holdback vs sale price + F&I reserve + aftermarket?

3. **Scheduled reports** — Auto-email daily/weekly summaries? To who? What format?

**Already built:**
- 4 report types with PDF + Excel export
- Sales performance, commissions, financial summary, inventory pipeline

---

## Suggested Discussion Order

Start with the items that unblock the most work:

1. **Architecture decisions** (inventory table, multi-store, roles, deal stages) — unblocks everything
2. **Deal Pipeline stages** — unblocks the kanban UI redesign
3. **Inventory Command Center** — unblocks garage, wholesale, and photo management
4. **Garage / Work Orders** — unblocks safety workflow and recon tracking
5. **Finance Desk** — unblocks funding tracker
6. **Pre-Delivery Checklist** — unblocks delivery enforcement
7. **Document Manager** — unblocks wet ink workflow
8. **Driver Dispatch** — quick discussion, mostly built
9. **Delivery Tracker** — quick discussion, mostly built
10. **Notifications & Automation** — depends on roles being defined
11. **Reporting** — extend existing, lower urgency
12. **Lead Manager** — large build, can run parallel
13. **Wholesale Manager** — depends on inventory being done
14. **Chatbot Engine** — largest build, do last


---

# 14. Built vs Plan

# Kia Deal Tracker — What's Built vs. What's Planned

This document maps the actual codebase (built in Claude Code) against the 14-module master plan (managed in Claude chat). Use this to understand exactly where we are and what's left.

---

## Module-by-Module Status

| # | Planned Module | Status | Coverage | Summary |
|---|---|---|---|---|
| 1 | Lead Manager | **NOT BUILT** | 0% | Nothing exists. No lead capture, scoring, assignment, or nurture campaigns |
| 2 | Chatbot Engine | **NOT BUILT** | 0% | Nothing exists |
| 3 | Deal Pipeline | **PARTIAL** | 60% | Deal CRUD with 50+ fields works. NO kanban view, NO drag-drop, NO activity timeline. Grid card layout only |
| 4 | Finance Desk | **MINIMAL** | 15% | Only `financing_bank` (text field) + `finance_status` (pending/approved/funded). No lender portal, rate shopping, deal shopping, or F&I menu |
| 5 | Inventory Command Center | **PARTIAL** | 25% | Vehicle info exists but missing key fields. No kanban, no garage queue, no photo gallery, no alerts. See detailed breakdown below |
| 6 | Document Manager | **MINIMAL** | 10% | Basic file upload for insurance + funding proof only. No document library, templates, e-signatures, versioning, or categorization |
| 7 | Garage / Work Orders | **NOT BUILT** | 5% | Only a `safety_done` checkbox exists. No work order system, no garage queue, no recon tracking |
| 8 | Driver Dispatch | **BUILT** | 70% | Fleet management (chaser vehicles + dealer plates), auto-assign with conflict detection, status tracking. Missing: driver tracking, ETA, GPS, route optimization |
| 9 | Pre-Delivery Checklist | **BUILT** | 75% | 4 critical items (insurance, funded, safety, registration) with file uploads + compliance dashboard. Missing: expanded PDI items, customer confirmation, signature capture |
| 10 | Delivery Tracker | **BUILT** | 65% | Dashboard with red/green compliance flags, delivery booking (drivers, company, time). Missing: delivery timeline, post-delivery follow-up, delivery proof |
| 11 | Funding Tracker | **MINIMAL** | 15% | `finance_status` dropdown (pending/approved/funded) on deals. No bank-side tracking, no funding proof workflow, no lender communication |
| 12 | Notifications & Automation | **MINIMAL** | 15% | 2 manual email triggers (deal closing report + driver dispatch via Resend). No automatic triggers, no SMS, no notification center, no GHL-style workflows |
| 13 | Wholesale Manager | **MINIMAL** | 10% | `sale_type` field (retail/wholesale) on deals + basic wholesale count in reports. No wholesale pricing, auction tracking, offers board, or aging rules |
| 14 | Reporting & Analytics | **BUILT** | 60% | 4 report types (Sales Performance, Commissions, Financial Summary, Inventory Pipeline) with PDF + Excel export. Missing: GM-level P&L dashboards, custom report builder, scheduled report delivery |

---

## Inventory Command Center — Detailed Gap Analysis

This is the centerpiece of the new plan. Here's a field-by-field comparison.

### Per-Vehicle Card: What Exists vs. What's Needed

| Data Point | What the Plan Requires | What's Built | What's Missing |
|---|---|---|---|
| **Vehicle info** | Year, make, model, trim, VIN, stock#, color, mileage | year, make, model, VIN, stock#, color **exist** | `trim` and `mileage` fields don't exist |
| **Photos** | Gallery with upload status, flagged if missing | `photos_taken` checkbox only (boolean) | No photo gallery, no multi-photo upload, no compliance flagging |
| **Location status** | On lot / At garage / At source / In transit / Delivered | `vehicle_status`: incoming, at_garage, delivered (3 values) | Missing `on_lot`, `at_source`, `in_transit` statuses |
| **Acquisition type** | In-stock, dealer trade, auction, wholesale, customer trade-in | `vehicle_source` (freeform text) + `is_sourced_unit` (boolean) | No structured enum — needs proper acquisition_type field |
| **Cost basis** | Purchase price, transport cost, recon cost, total invested | `vehicle_cost` (single number) | No `transport_cost`, no `recon_cost`, no cost breakdown |
| **Safety status** | Not started / Sent to garage / In progress / Passed / Failed + notes | `safety_done` (boolean checkbox) | No workflow stages, no notes field, no tracking dates |
| **Recon status** | Needs detailing / Needs body work / Needs mechanical / Ready for sale | **Does not exist** | Entire recon tracking system needs building |
| **Days in stock** | Auto-calculated, color-coded (green <30, yellow 30-60, red 60+) | Aging calc exists in Inventory Pipeline report with color coding | Not surfaced on deal cards, no `acquisition_date` field for accurate calc |
| **Deal status** | Available / Reserved / Sold-pending / Delivered | `deal_status` (open/complete/cancelled) + `vehicle_status` + `is_sold` | Different status model — needs mapping or new field |
| **Documents** | Bill of sale, ownership transfer, lien check | `bill_of_sale_received` on sourced units only | No ownership transfer tracking, no lien check documents |

### Dashboard Views: What Exists vs. What's Needed

| View | Who Uses It | What's Built | What's Missing |
|---|---|---|---|
| **Pipeline view** (kanban by status) | GM, used car manager | **No kanban anywhere** — only grid card layout with filters | Full kanban with drag-drop (already planned as redesign step 4) |
| **Aging report** (sorted by days in stock) | GM, wholesale manager | Basic aging list in Inventory Pipeline report (30/60 day colors) | Not a standalone dedicated view, no sorting by oldest |
| **Cost report** (invested vs. listed vs. profit) | GM, used car manager | P&L exists: sale_price - vehicle_cost + fi_reserve per deal | No `list_price` field, no "total invested" breakdown, no standalone cost view |
| **Garage queue** (units at/waiting for garage) | Used car manager | **Does not exist** | Entire garage queue view needs building |
| **Incoming units** (in transit, ETA, source, driver) | Used car manager, logistics | Sourced units track seller + pickup date + drivers | No ETA tracking, no dedicated incoming view |
| **Wholesale board** (flagged units, offers, auction schedule) | Wholesale manager | **Does not exist** — only a `sale_type` filter | Entire wholesale board needs building |
| **Photo compliance** (missing photos, minimum count) | Used car manager | **Does not exist** — only `photos_taken` boolean | Entire photo compliance view needs building |

### Automated Alerts: What Exists vs. What's Needed

| Alert | What's Built | What's Missing |
|---|---|---|
| Unit hits 45 days → alert GM + wholesale | **No alert system exists** | Need notification engine + aging trigger |
| Safety overdue 5+ days → alert used car manager | **No alert system exists** | Need safety date tracking + overdue trigger |
| No photos 48hrs after arrival → alert used car manager | **No alert system exists** | Need arrival date + photo count + time-based trigger |
| Incoming unit ETA today → alert logistics | **No alert system exists** | Need ETA field + daily check trigger |
| Recon cost exceeds threshold → alert GM | **No recon cost field exists** | Need recon_cost field + threshold config + trigger |

---

## What's Already Strong (Foundations to Build On)

These are solid, working implementations that the planned modules will extend:

| Foundation | Details | Relevant Modules |
|---|---|---|
| **Deal CRUD** | 50+ fields, 6 sections (vehicle, deal, financial, delivery, trade-in, sold), full create/read/update/delete | Deal Pipeline, Inventory Command Center |
| **Commission system** | 12 salespeople with individual rates (5%-35%), pads ($1,500), tiered rates, supervisor overrides, auto-calc on fund/complete | Reporting & Analytics |
| **4 report types** | Sales Performance, Commissions, Financial Summary, Inventory Pipeline — all with PDF + Excel export via exceljs/pdfkit | Reporting & Analytics |
| **Dispatch system** | Chaser vehicles + dealer plates CRUD, auto-assign algorithm, 4-hour conflict detection window, status tracking (pending→assigned→in_transit→completed) | Driver Dispatch |
| **Delivery checklist** | 4 items (insurance uploaded, deal funded, safety done, registration done) with file upload + compliance dashboard | Pre-Delivery Checklist, Delivery Tracker |
| **Sourced units** | Seller info, payment proof (wire/etransfer/cc), bill of sale tracking, pickup driver booking, safety flag | Inventory Command Center |
| **Real-time sync** | Supabase subscriptions on all major tables — dashboards auto-update | All modules |
| **i18n (EN/FR)** | Complete translations for all existing features via react-i18next | All modules |
| **Email automation** | Resend integration with 2 HTML templates (deal closing + driver dispatch) | Notifications & Automation |
| **Design system (NEW)** | "KIA Command" design tokens, CSS variables for light/dark mode, Inter font, Framer Motion, collapsible sidebar, mobile drawer — **ready for new UI** | All modules |
| **React Query** | @tanstack/react-query v5 configured (30s stale, retry 1, refetch on focus) | All modules |
| **Drag-and-drop library** | @hello-pangea/dnd installed and ready | Deal Pipeline, Inventory Command Center |

---

## Database: What Needs Adding for Inventory Command Center

### New columns on `deals` table:
```sql
ALTER TABLE deals ADD COLUMN trim TEXT;
ALTER TABLE deals ADD COLUMN mileage INTEGER;
ALTER TABLE deals ADD COLUMN acquisition_type TEXT; -- 'in_stock','dealer_trade','auction','wholesale','customer_trade'
ALTER TABLE deals ADD COLUMN transport_cost NUMERIC DEFAULT 0;
ALTER TABLE deals ADD COLUMN recon_cost NUMERIC DEFAULT 0;
ALTER TABLE deals ADD COLUMN list_price NUMERIC;
ALTER TABLE deals ADD COLUMN safety_status TEXT DEFAULT 'not_started'; -- 'not_started','sent_to_garage','in_progress','passed','failed'
ALTER TABLE deals ADD COLUMN safety_notes TEXT;
ALTER TABLE deals ADD COLUMN safety_sent_date TIMESTAMPTZ;
ALTER TABLE deals ADD COLUMN recon_status TEXT DEFAULT 'not_started'; -- 'needs_detailing','needs_body','needs_mechanical','ready'
ALTER TABLE deals ADD COLUMN acquisition_date DATE;
ALTER TABLE deals ADD COLUMN photo_count INTEGER DEFAULT 0;
```

### Expand `vehicle_status` values:
```
Current:  'incoming' | 'at_garage' | 'delivered'
Needed:   'at_source' | 'in_transit' | 'incoming' | 'at_garage' | 'on_lot' | 'delivered'
```

### New tables:
```sql
-- Vehicle photo gallery
CREATE TABLE vehicle_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  uploaded_by UUID REFERENCES users(id),
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Alert/notification system
CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL, -- 'aging','safety_overdue','photo_missing','eta_today','recon_cost'
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  target_role TEXT, -- 'gm','used_car_manager','wholesale_manager','logistics'
  message TEXT NOT NULL,
  acknowledged BOOLEAN DEFAULT FALSE,
  acknowledged_by UUID REFERENCES users(id),
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Competitive Intelligence: What We've Already Absorbed vs. What's Left

The plan lists DealerSocket, GoHighLevel, ERA, Reynolds & Reynolds, and Salesforce as competitors. We did a deeper 8-platform research study. Here's what's been absorbed into the codebase:

| Steal From | Feature | Status in Codebase |
|---|---|---|
| DealerSocket | Deal pipeline with stages | **Partial** — CRUD works, kanban pipeline NOT built yet (redesign step 4) |
| GoHighLevel | Automation engine (email/SMS triggers) | **Minimal** — 2 manual email triggers only, no automation workflows |
| ERA | Canadian compliance, bill of sale generation | **Partial** — Province tracking (ON/QC), licensing flags, but no auto-generated bill of sale |
| Reynolds & Reynolds | Document management, deal jacket | **Minimal** — Basic file upload only |
| Salesforce | Dashboard and reporting flexibility | **Partial** — 4 report types with export, but not configurable/custom |

### Additional research already done (beyond plan's 5 platforms):
- **Pipedrive** — Deal rotting indicator, best drag-and-drop → Planned for kanban cards
- **HubSpot** — Three-column record layout, activity timeline → Planned for deal detail redesign
- **Monday.com** — Vibrant status colors, sidebar design → Already implemented in new design system
- **VinSolutions** — Payment calculator side-by-side → Not yet planned

---

## UI/UX Redesign Status (Parallel Track)

The redesign is running alongside the module buildout. Steps 1-3 are done:

| Step | Task | Status |
|---|---|---|
| 1 | Install deps (framer-motion, @hello-pangea/dnd, lucide-react, @tanstack/react-query) | **DONE** |
| 2 | Design system (CSS vars, Tailwind config, theme context) | **DONE** |
| 3 | Layout + sidebar + top bar | **DONE** |
| 4 | Dashboard with Kanban pipeline + list toggle | Not started |
| 5 | Deal cards with rotting indicators + drag-drop | Not started |
| 6 | Deal detail side panel (slides from right, tabbed) | Not started |
| 7 | Delivery board redesign | Not started |
| 8 | Reports page with animated charts | Not started |
| 9 | Notification system (bell + toasts) | Not started |
| 10 | Dark/light theme toggle across all views | Not started |
| 11 | Mobile responsive (bottom tab nav) | Not started |
| 12 | Polish animations | Not started |

**Key intersection:** Redesign step 4 (Kanban dashboard) directly overlaps with the Inventory Command Center's pipeline view and the Deal Pipeline module. These should be built together.

---

## Recommended Build Order (Aligned with Plan)

Based on what exists and what's needed, here's how the plan's build order maps to actual work:

| Priority | Plan's Module | What to Build | Effort |
|---|---|---|---|
| 1 | Deal Pipeline + Inventory Command Center | Kanban view, new DB fields, vehicle cards, pipeline columns, aging on cards | **Large** — intersects with redesign steps 4-5 |
| 2 | Garage / Work Orders | Safety workflow (5 statuses + notes + dates), recon tracking, garage queue view | **Medium** |
| 3 | Pre-Delivery Checklist | Expand from 4 to full PDI checklist, add customer confirmation | **Small** — extend existing |
| 4 | Driver Dispatch | Add ETA tracking, driver assignment, incoming units view | **Small** — extend existing |
| 5 | Document Manager | Document library, categorization, ownership transfer tracking | **Medium** |
| 6 | Finance Desk | Lender tracking, rate shopping, F&I product menu | **Large** — mostly new |
| 7 | Funding Tracker | Bank-side status, funding proof workflow, auto-status updates | **Medium** |
| 8 | Wholesale Manager | Wholesale board, auction tracking, offers, aging rules | **Medium** |
| 9 | Notifications & Automation | Alert engine, 5 alert types, notification center, toast system | **Medium** — intersects with redesign step 9 |
| 10 | Reporting & Analytics | GM dashboards, custom reports, scheduled delivery | **Medium** — extend existing |
| 11 | Lead Manager | Lead capture, scoring, assignment, nurture | **Large** — entirely new |
| 12 | Chatbot Engine | Lead engagement automation | **Large** — entirely new |

---

## Summary

**Overall project completion against the 14-module plan: ~30%**

- 3 modules are 60-75% built (Deal Pipeline, Dispatch, Delivery)
- 4 modules are 10-15% built (Finance Desk, Document Manager, Funding Tracker, Notifications)
- 3 modules have foundation work (Inventory Command Center, Wholesale, Reporting)
- 2 modules are completely unbuilt (Lead Manager, Chatbot)
- 1 module barely exists (Garage/Work Orders)

The strongest foundation is the **Deal CRUD + Commission system + Real-time sync + Design system** — these support everything else. The biggest gap is the **Kanban pipeline view** which multiple modules need (Deal Pipeline, Inventory Command Center, Wholesale Board). Building that first unblocks the most work.


---

# 15. Project Handoff

# Kia Mont-Laurier Deal Tracker — Full Project Handoff

## Overview

This is a full-stack dealership CRM/deal tracking system for Kia Mont-Laurier. It's a working MVP with an in-progress UI/UX redesign based on competitive research across 8 major CRM/DMS platforms.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite + Tailwind CSS 3.4 |
| Backend | Express.js (Node.js), port 3001 |
| Database | Supabase (PostgreSQL) with real-time subscriptions |
| Email | Resend API |
| i18n | react-i18next (English + French) |
| Charts | Recharts |
| Icons | Lucide React |
| Animations | Framer Motion |
| Drag & Drop | @hello-pangea/dnd |
| Data Fetching | @tanstack/react-query v5 |

---

## What's Built & Working (MVP)

### Core Features
- **Deal CRUD** — Full create/read/update/delete with all fields (vehicle info, deal details, delivery, trade-in, sold status, financials)
- **Financial tracking** — sale_price, vehicle_cost, fi_reserve fields on every deal
- **Commission system** — 12 salespeople with individual pay plans (rates, pads, tiers, overrides), auto-calculated on fund/complete
- **Dashboard** — Stats bar (7 metrics), filter bar (9 filters), deal card grid, real-time Supabase sync
- **Delivery management** — Checklist with 4 critical items + file uploads
- **Dispatch/fleet** — Chaser vehicles, dealer plates, auto-assign, conflict detection
- **Sourced units** — Seller tracking, payment proof, pickup logistics
- **Reports** — 4 tabs: Sales Performance, Commissions, Financial Summary, Inventory Pipeline
- **PDF + Excel export** — All 4 report types via exceljs + pdfkit
- **Salespeople Manager** — Add/edit/deactivate with rates, pads, tiers, overrides
- **Email automation** — Deal closing report + driver dispatch via Resend
- **EN/FR translations** — Complete for all features
- **Authentication** — Login with localStorage session persistence

### Commission Pay Plans (Real Data)

| Salesperson | Rate | Pad | Special |
|---|---|---|---|
| Vendeur 01 | 30% | None | — |
| Vendeur 02 | 20% | $1,500 | Vendeur 09 gets 5% override |
| Vendeur 03 | 25% | $1,500 | Vendeur 07 gets 5% override |
| Vendeur 04 | 20% | $1,500 | — |
| Vendeur 05 | 20% | $1,500 | — |
| Vendeur 06 | 25% | $1,500 | — |
| Vendeur 07 | 35% | $1,500 | +5% override on Vendeur 03 |
| Vendeur 08 | 5% | $1,500 | — |
| Vendeur 09 | 30% | $1,500 | +5% override on Vendeur 02 |
| Vendeur 10 | 25%/30% | $1,500 | 30% if monthly gross >$60k |
| Vendeur 11 | 20% | $1,500 | — |
| Vendeur 12 | 20% | $1,500 | — |

---

## File Structure

```
kia-deal-tracker/
├── client/
│   ├── src/
│   │   ├── App.jsx                    # Routing + auth state
│   │   ├── main.jsx                   # Entry: QueryClient + Theme + Router
│   │   ├── index.css                  # Design tokens (CSS vars, light/dark)
│   │   ├── supabaseClient.js          # Supabase client init
│   │   ├── i18n.js                    # i18next config (EN/FR)
│   │   ├── hooks/useTheme.jsx         # Theme context (dark/light, localStorage)
│   │   ├── lib/queryClient.js         # React Query config (30s stale, retry 1)
│   │   ├── components/
│   │   │   ├── Layout.jsx             # Sidebar + top bar + mobile drawer
│   │   │   ├── Dashboard.jsx          # Main deals grid + stats + filters
│   │   │   ├── DealForm.jsx           # Deal create/edit form
│   │   │   ├── DealDetail.jsx         # Full deal view (40KB, comprehensive)
│   │   │   ├── DeliveryDashboard.jsx  # Delivery management
│   │   │   ├── DeliveryChecklist.jsx  # Checklist component
│   │   │   ├── DispatchDashboard.jsx  # Dispatch management
│   │   │   ├── DispatchCard.jsx       # Individual dispatch card
│   │   │   ├── ReportsDashboard.jsx   # Reports hub
│   │   │   ├── SalespeopleManager.jsx # Sales team management
│   │   │   ├── SourcedUnitSection.jsx # Sourced units tracking
│   │   │   ├── Login.jsx              # Auth page
│   │   │   ├── FileUpload.jsx         # File upload component
│   │   │   └── reports/
│   │   │       ├── CommissionTracker.jsx
│   │   │       ├── FinancialSummary.jsx
│   │   │       ├── InventoryPipeline.jsx
│   │   │       └── SalesPerformance.jsx
│   │   └── locales/
│   │       ├── en.json                # English translations
│   │       └── fr.json                # French translations
│   ├── tailwind.config.js             # Design system config
│   ├── vite.config.js                 # Vite config (port 5173)
│   └── package.json
├── server/
│   ├── index.js                       # Express app + route registration
│   ├── routes/
│   │   ├── deals.js                   # Deal CRUD
│   │   ├── users.js                   # User management
│   │   ├── email.js                   # Email (Resend)
│   │   ├── deliveryChecklists.js      # Delivery endpoints
│   │   ├── sourcedUnits.js            # Sourced units
│   │   ├── dispatch.js                # Dispatch ops
│   │   ├── upload.js                  # File uploads (multer)
│   │   ├── reports.js                 # Report generation
│   │   └── salespeople.js             # Sales team
│   ├── services/
│   │   ├── email.js                   # Email logic
│   │   ├── dispatch.js                # Dispatch business logic
│   │   └── reportGenerator.js         # PDF/Excel generation
│   └── package.json
├── research-notes.md                  # UI/UX research (17.5KB)
├── CRM-UI-UX-RESEARCH.md             # Deep platform analysis (36KB)
├── supabase-migration.sql             # DB schema
└── CLAUDE.md                          # Dev guidelines
```

### Routes

```
GET  /login              → Login
GET  /                   → Dashboard (deals grid)
GET  /deal/new           → DealForm (create)
GET  /deal/:id           → DealDetail (view/edit)
GET  /deliveries         → DeliveryDashboard
GET  /dispatch           → DispatchDashboard
GET  /reports            → ReportsDashboard
GET  /salespeople        → SalespeopleManager
```

### API Endpoints

```
/api/deals               — Deal CRUD + stats/summary
/api/users               — User management
/api/email               — Email notifications
/api/delivery-checklists — Delivery management
/api/sourced-units       — Sourced units
/api/dispatch            — Dispatch operations
/api/upload              — File uploads
/api/reports             — Report generation
/api/salespeople         — Sales team management
/api/health              — Health check
```

---

## UI/UX Research Summary

We studied 8 major CRM/DMS platforms to inform the redesign:

### Platforms Analyzed
1. **GoHighLevel** — Slide-out panels, kanban pipeline, navy/purple theme
2. **VinSolutions** — Multi-tab deal desking, payment calculator scenarios
3. **DealerSocket** — Step-by-step F&I workflow, inventory grid with days-on-lot
4. **Reynolds & Reynolds** — Legacy terminal system, department-segmented views
5. **Salesforce Automotive** — Configurable dashboard widgets, activity timeline, path component
6. **Monday.com** — Board views (table/kanban/timeline), vibrant status colors, signature purple
7. **HubSpot** — Three-column record layout (INDUSTRY STANDARD), activity timeline, pipeline board
8. **Pipedrive** — Full-width kanban PRIMARY view, deal rotting indicator, best drag-and-drop

### Key Design Patterns We're Stealing

| Pattern | Source | Why |
|---------|--------|-----|
| Full-width Kanban as primary view | Pipedrive | Pipeline-first workflow for car deals |
| Deal rotting indicator (amber/red aging) | Pipedrive | Visual urgency for stale deals |
| Three-column record layout | HubSpot | Industry standard for detail views |
| Activity timeline on records | HubSpot/Salesforce | Chronological deal history |
| Slide-out detail panel | GoHighLevel | Context preservation (no full page nav) |
| Collapsible dark sidebar | Monday.com | Clean nav, maximizes workspace |
| Status color system (vibrant) | Monday.com | Works in both light/dark modes |
| Smooth drag-and-drop with ghost preview | Pipedrive | Best-in-class interaction |
| Board + table view toggle | HubSpot | User choice for data display |
| Bottom tab nav on mobile | Pipedrive | Native-feeling mobile experience |

### Competitive Weaknesses We're Exploiting

| Platform | Their Weakness | Our Opportunity |
|----------|---------------|-----------------|
| GoHighLevel | Cluttered, inconsistent UI | Clean, focused dealership design |
| VinSolutions | Dated 2015-era UI, slow | Modern, fast, responsive |
| DealerSocket | Bolted-on features | Unified, cohesive design from day one |
| Reynolds | Ancient UX (2005-era), no mobile | Modern-first, mobile-native |
| Salesforce | Too complex, expensive | Simple, affordable, dealership-focused |
| Monday.com | Not automotive at all | Deep automotive workflow integration |
| HubSpot | No automotive features | VIN decode, payment calc, inventory built-in |
| Pipedrive | No automotive specifics | Pipeline optimized specifically for car deals |

---

## Design System — "KIA Command"

### Approved & Implemented

**Font:** Inter (Google Fonts)

**Color System (CSS Variables):**

Light Mode:
```
Background:     #F5F7FA (page), #FFFFFF (cards)
Text:           #1A1D23 (primary), #6B7280 (secondary), #9CA3AF (muted)
Accent:         #3B82F6 (blue)
Brand Red:      #E53935 (Kia)
Border:         #E5E7EB
Success:        #10B981 / Warning: #F59E0B / Danger: #EF4444 / Info: #6366F1
```

Dark Mode:
```
Background:     #0F1117 (page), #1A1D27 (cards), #141720 (sidebar)
Elevated:       #232738 (modals, dropdowns)
Text:           #F0F2F5 (primary), #9CA3AF (secondary), #6B7280 (muted)
Accent:         #60A5FA (lighter blue for dark bg)
Brand Red:      #EF5350 (adjusted for dark bg)
Border:         #2A2D3A
Success:        #34D399 / Warning: #FBBF24 / Danger: #F87171 / Info: #818CF8
```

**Pipeline Stage Colors:**
```
New:             #3B82F6 (blue)
At Garage:       #6366F1 (indigo)
Finance Pending: #F59E0B (amber)
Approved:        #06B6D4 (cyan)
Funded:          #14B8A6 (teal)
Delivered:       #10B981 (green)
Lost:            #EF4444 (red)
```

**Transitions:**
- Fast: 150ms ease (hover states)
- Normal: 250ms ease (panels, sidebar)
- Slow: 350ms ease (page transitions)

**Custom Animations (Tailwind keyframes):**
- slide-in-right / slide-out-right (for detail panels)
- fade-in
- pulse-dot (notification indicator)

### Sidebar Navigation (Implemented)
- 240px expanded / 60px collapsed
- Dark themed (uses sidebar bg color)
- 6 nav items: Dashboard, New Deal, Deliveries, Dispatch, Reports, Salespeople
- Active state: accent bg tint + 3px left border
- Bottom controls: Theme toggle, language toggle, collapse toggle, user/logout
- Mobile: Full-screen overlay drawer with hamburger trigger
- Collapse state persisted in localStorage

### Top Bar (Implemented)
- Sticky header
- Mobile: hamburger menu button
- Desktop: Search input with "/" shortcut label
- Notification bell with animated pulse dot

---

## Redesign Progress

### Completed (Steps 1-3 of 12)
1. **Dependencies installed** — framer-motion, @hello-pangea/dnd, lucide-react, @tanstack/react-query
2. **Design system created** — Tailwind config rewritten with design tokens, index.css with full light/dark CSS variables, ThemeProvider hook with localStorage persistence
3. **Layout rebuilt** — Collapsible dark sidebar, top bar with search/notifications, mobile drawer, responsive transitions

**Build status: Clean (passes)**

### Not Yet Started (Steps 4-12)
4. **Dashboard with Kanban pipeline + list toggle** — Replace current grid cards with drag-and-drop Kanban columns by deal stage, plus a list/table view toggle
5. **Deal cards with rotting indicators + drag-drop** — Redesign deal cards with aging visual, status colors, salesperson avatar, value display
6. **Deal detail side panel** — Slides from right, tabbed interface (instead of full-page navigation)
7. **Delivery board redesign** — Apply new design system to delivery management
8. **Reports page with animated charts** — Redesign reports with Framer Motion chart animations
9. **Notification system** — Bell icon + toast notifications
10. **Dark/light theme toggle** — Already have the provider, need toggle UI throughout all views
11. **Mobile responsive** — Bottom tab navigation, horizontal pipeline scroll
12. **Polish animations** — Micro-interactions, celebrations (deal won confetti), loading skeletons

---

## Typography System (From Research)

```
Page Title:     24px / line-height 1.3 / weight 600
Section Header: 18px / 1.4 / 600
Card Title:     15px / 1.4 / 600
Body:           14px / 1.5 / 400
Label:          13px / 1.4 / 500
Caption/Meta:   12px / 1.4 / 400
Badge:          11px / 1.0 / 600 (uppercase, letter-spacing 0.5px)

Base spacing unit: 4px
Component padding: 12px or 16px
Section gaps: 24px or 32px
```

## Card Design Spec (From Research)

```
Width:          260-300px (kanban), full-width (list)
Padding:        12-16px
Background:     White (light) / card surface (dark)
Shadow:         0 1px 3px (rest), 0 4px 12px (hover)
Left border:    3-4px colored by status/stage
Content stack:
  - Deal/customer name (14px semibold, truncate)
  - Vehicle description (13px, gray)
  - Dollar value (14-16px semibold, green/brand)
  - Bottom row: Owner avatar (24px), date badge, activity icons
Max items:      4-5 info items per card
```

## Kanban Column Spec (From Research)

```
Header:
  - Stage name (bold, 14-16px)
  - Deal count in badge
  - Total dollar value
  - "Add" button per column

Drag & Drop:
  - Lift shadow: 0 8px 24px, 150ms snap
  - Column highlight: Dashed border or bg change on hover
  - Placeholder shown where card will land
  - Reordering within column supported
```

## Mobile Spec (From Research)

```
Breakpoints:
  Mobile:   < 640px  (single column, bottom nav)
  Tablet:   640-1024px (two columns, collapsible sidebar)
  Desktop:  1024-1440px (full layout)
  Wide:     > 1440px (extra sidebar or wider)

Mobile Navigation: Bottom tab bar (5 items max)
Pipeline: Horizontal scroll with snap points (85% screen width per column)
Deal cards: Full-width, swipe right = call, swipe left = move stage
Forms: Full-screen modals, 44px min touch targets, sticky submit button
```

---

## Database Schema (Key Tables)

- **deals** — All deal data (vehicle info, customer, financials, statuses, dates)
- **salespeople** — 12 salespeople with commission rates, pads, tiers, overrides
- **commissions** — Calculated commissions linked to deals + salespeople
- **delivery_checklists** — 4 critical checklist items per deal
- **sourced_units** — External vehicle sourcing tracking
- **dispatch** — Chaser vehicles, dealer plates, driver assignments

---

## How to Run

```bash
# Frontend (port 5173)
cd client && npm run dev

# Backend (port 3001)
cd server && npm run dev

# Build
cd client && npx vite build
```

**Environment variables needed:**
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_URL`
- Server-side: Supabase service key, Resend API key

---

## Context for Planning

This document covers everything that has been built and researched. The next phase of work is the Kanban dashboard (step 4), which transforms the current grid-based deal view into a drag-and-drop pipeline organized by deal stage. The design system, theme infrastructure, and layout are already in place — the remaining work is applying the new design patterns to each feature area.


---

# 16. Research Notes

# UI/UX Research Notes — CRM & DMS Platform Analysis

> Research for Kia Mont-Laurier Deal Tracker redesign. All 8 platforms researched.

---

## 1. GoHighLevel

### Navigation
- Left sidebar with compact icon strip; clicking opens mega-nav panels for sub-pages
- Icons at `left: 16px`, `font-size: 17px`, `padding-left: 40px`
- Collapsible right-hand sidebar in builders with 3 context-aware tabs

### Pipeline / Kanban
- Kanban board with customizable stages (New Lead, Qualified, Booked, Proposal Sent, Won/Lost)
- Deal cards ("Opportunity Cards") are draggable between columns
- Cards configurable — choose which fields display (contact name, deal value, assigned user, tags)
- Moving a card can trigger workflow automations
- Board view primary, list view also available

### Color System
| Token | Dark Theme | Usage |
|---|---|---|
| Nav background | `#00142a` | Deep navy |
| Nav text | `#ffffff` | White |
| Nav icon accent | `rgb(151, 113, 255)` | Purple |
| Hover background | `#007ef5` | Bright blue |
| Button background | `#007ef5` | Primary action |

### Typography
- Default font: **Poppins** (builders)
- Icon font-size: `17px`, button border-radius: `50px`

### Mobile
- Mobile App v4.0 (redesigned 2025): role-aware dynamic homepage
- Universal Search, App Drawer, AI assistant, true dark mode
- Tap-to-Pay invoices from chat, AI Voice Agent

### User Complaints
1. Cluttered, illogical UI — settings scattered
2. Extreme learning curve
3. CRM feels clunky — multiple screens for simple tasks
4. Workflows fire incorrectly (duplicate emails, wrong contacts)
5. Support is slow (24-48h) and unhelpful
6. Hidden costs ($475-625/month after add-ons)

---

## 2. Monday.com

### Design System: "Vibe"
- Official open-source React component library (50+ components)
- GitHub: `mondaycom/vibe`

### Color Palette
| Color | Hex | Usage |
|---|---|---|
| Monday Purple | `#6161FF` | Primary brand/accent |
| Monday Dark | `#181B34` | Dark backgrounds |
| Monday Light | `#F0F3FF` | Light backgrounds |
| Green "Done" | `#00CA72` | Complete status |
| Yellow "Working" | `#FFCC00` | In progress |
| Red "Stuck" | `#FB275D` | Blocked/stuck |

### Typography
- Primary: **Figtree**
- Secondary: **Nunito Sans**
- Body: **14px**, headings: **16px**
- Weights: 400, 500, 700

### Sidebar
- Minimum width: **244px**
- Border radius on items: **8px** (search), **20px** (interactive)
- Item padding: 6px top/bottom
- Section margin-top: 32px (main), 24px (sub)

### Kanban / Board View
- Status Column drives Kanban grouping
- Cards show selected column data inline
- Inline editing on cards without opening detail popup
- Navigation battery widget: colored progress bar showing distribution
- Cards support file covers, status badges, people avatars
- 3-dot menu: subitems, archive, delete, move, duplicate

### Theme Modes
- Light, Dark, and **Night Mode** (3 options)

### User Complaints
1. Cluttered when too many boards active
2. Email feature clunky
3. Essential features paywalled
4. Automation limits (250/month on Standard)
5. Plan cancellation banner shown to all members daily

---

## 3. Pipedrive

### Navigation
- Left sidebar with icon-based nav (up to 10 icons selectable)
- Keyboard shortcuts: 1-8 for sections, `[`/`]` for sidebar toggle
- Quick add: `.` or `+` keys
- Universal search: `/` key
- Light/dark mode toggle in Interface Preferences

### Pipeline / Kanban (widely praised as cleanest in CRM market)
- Deals as cards across customizable stage columns
- Drag-and-drop between stages

### Deal Card Structure
**5 mandatory fields:** title, contact/org, value, label (color), owner
**+ up to 7 custom fields**

**Visual indicators:**
- Activity icons (scheduled, overdue, needs attention)
- **Rotting indicator** (red) — deals stuck beyond threshold
- Color-coded labels (up to 100 per deal)
- Won = green, Lost = red

**Sorting:** 11 criteria including activity-based, value, close date

### Deal Detail Sidebar
- Opens on click from pipeline
- Sections fully customizable per user (toggle, reorder, expand/collapse)
- "Show only filled fields" filter
- Bulk edit via pencil icon in section headers
- App integrations appear as sidebar sections

### Color System
- Brand primary: Green (`#017737` to `#28B661` range)
- Dark theme: "subdued palette" reversing black/white ratio
- Deal status: Green (won), Red (lost/rotting/overdue)
- Charts support 27 custom saved colors

### Typography
- System fonts (no custom typeface)
- Email defaults: Arial 14px

### Mobile
- iOS/Android with pipeline view and drag-and-drop
- Full offline mode with sync
- AI assistant suggesting follow-ups (2026)

### User Complaints
1. Customer support is terrible — no phone support on lower plans
2. Reporting limited — surface-level metrics
3. Automation caps (50 on Growth plan)
4. Becomes expensive at scale
5. No pipeline filtering by rep or priority

---

## 4. DealerSocket

### Architecture
- Unified web-based platform: CRM + DMS (IDMS) + Inventory + Digital Retail
- Single-system approach — data entered once flows across all modules

### Deal Pipeline Stages (typical auto CRM flow)
New → Contact Attempt → Contacted → Appointment Scheduled → Dealer Visit → Demo/Test Drive → Working Deal/Negotiation → Sold → Delivered
Additional: Missed Appointment Follow-Up, Lost, Duplicate

### F&I Workflow
- SocketCredit for soft/hard credit pulls from CRM
- Desking: multiple deal scenarios with side-by-side comparison
- Seamless handoff from sales to F&I with pre-populated data

### Inventory (Inventory+)
- Elastic search with combinable filters
- TrueScore analytics — vehicle scoring based on dealership sales history
- Bulk pricing changes across groups
- Up to 12 trillion unique search configurations

### Mobile
- "Tap-and-go" optimized for dealer floor (upping customers, sending texts, finding vehicles)

---

## 5. Reynolds & Reynolds (ERA-IGNITE)

### System Design
- **Retail Management System** — single platform, one unique identifier per customer/vehicle/transaction
- Uses numbered screen codes for navigation (e.g., 4061 = Vehicle Inventory Summary)

### Key Features
- ERA-IGNITE toolbar with system icons
- Consolidated screens with reduced keystrokes
- Side-by-side deal comparison in desking
- Drill-down financial statements
- Automatic data flow from all departments to accounting
- Customizable screen appearance per user
- Embedded help videos within every screen

### Department Areas
1. Dealership-wide (analytics, marketing, security)
2. Sales (CRM, desking, online retailing, FOCUS leads)
3. Parts (inventory, pricing, margin analysis)
4. Business Office (analytics, cash flow, payroll)
5. Finance/F&I (compliance, real-time product rating, docuPAD)
6. Service (appointments, Shop View, ROs, warranty)

---

## 6. HubSpot CRM

### Deal Pipeline
- Kanban board with horizontal columns per stage
- Cards show: deal name, amount, close date, contact, company, owner avatar
- Colored left border on cards for priority/custom property
- Weighted pipeline view (probability-adjusted values)
- Board + Table view toggle
- Pipeline totals per column header
- "Add deal" button at top of each column

### Contact Record — Three-Column Layout (industry best practice)
- **Left column (280px):** Key properties (name, email, phone, company, lifecycle stage)
- **Center column (flex):** Activity timeline (emails, calls, meetings, notes — chronological feed)
- **Right column (300px):** Associations (companies, deals, tickets), sidebar cards

### Activity Feed
- Chronological timeline with filter controls (emails, calls, notes, tasks, meetings)
- Each activity: icon, type label, timestamp, preview text, expand/collapse
- Inline email threads, inline call recording playback
- Pin important activities to top
- Quick-log buttons above timeline: Note, Email, Call, Task, Meeting

### Navigation
- Top horizontal nav bar with major hubs: Contacts, Conversations, Marketing, Sales, Service, Automation, Reporting
- Dropdown mega-menus for sub-sections
- Left sidebar for list filters and saved views
- **Ctrl+K global search** — instant search across all records

### Color System
| Color | Hex | Usage |
|---|---|---|
| Brand accent | `#FF7A59` | Orange, used sparingly for CTAs |
| Primary UI | `#0091AE` | Teal-blue, links/interactive |
| Background | `#FFFFFF` / `#F5F8FA` | Primary / secondary |
| Text primary | `#33475B` | Dark gray |
| Text secondary | `#516F90` | Medium gray |

### Typography
- **Lexend Deca** and **Avenir** as primary fonts
- Headers: 20-24px semibold, body: 14px, metadata: 12px
- Line-height: 1.5

### Mobile
- Bottom tab bar: Feed, Contacts, Deals, Tasks, Menu
- Swipe to call/email from contact lists
- Business card scanner, offline access

### User Complaints
1. Pipeline only Kanban or Table (no timeline/calendar)
2. Limited deal card layout customization
3. Mobile pipeline view is cramped
4. Price jumps dramatically free → paid
5. Workflow automation UI less visual than GoHighLevel

---

## 7. Salesforce Automotive Cloud

### Dashboard
- Configurable with drag-and-drop widget placement
- Widgets: KPI cards, charts (bar, line, donut), tables, activity timelines
- Lightning App Builder for admin layout customization
- Role-based dashboards (manager vs salesperson)

### Activity Tracking
- Timeline on every record (contact, deal, vehicle)
- Chronological feed: emails, calls, tasks, stage changes, notes
- Each activity has icon, timestamp, expandable detail
- "Log a Call" and "New Task" quick actions pinned at top
- Einstein AI suggestions inline ("This lead hasn't been contacted in 5 days")

### Pipeline / Opportunity View
- Kanban with drag-and-drop + list/table toggle
- **Path component:** horizontal stepped bar at top showing stage progression
- Each stage shows guidance text and required fields

### Navigation
- Top nav bar with app launcher (waffle icon)
- Tab-style nav for objects (Leads, Contacts, Opportunities, Vehicles)
- Utility bar at bottom for quick tools
- Left sidebar for list filters
- Global search in top nav

### Color System (Lightning Design System)
| Color | Hex | Usage |
|---|---|---|
| Primary blue | `#0176D3` | CTAs, active states |
| Success | `#2E844A` | Green |
| Warning | `#DD7A01` | Yellow/amber |
| Error | `#EA001E` | Red |
| Background | `#FFFFFF` / `#F3F3F3` | Primary / secondary |
- 4px base spacing unit system

### Typography
- **Salesforce Sans** font family
- Page title: 20px bold, section headers: 16px semibold, body: 14px, metadata: 12px

### Mobile
- Full-featured Salesforce Mobile App
- Bottom tab navigation
- Card-based stacked layouts, swipe actions
- Offline capability

### User Complaints
1. Overwhelming complexity for small teams
2. Performance suffers with customizations
3. Expensive per-seat licensing
4. Requires admin expertise to configure
5. Too much clicking to reach information

---

## 8. VinSolutions (Cox Automotive)

### Deal Desking Workflow
- Structured flow: Lead → Appointment → Show → Demo → Write-up → Sold
- Multi-tab form: vehicle info, customer info, trade-in, payment calculator
- Payment calculator shows multiple scenarios side-by-side (36/48/60/72 month)
- F&I product menu integrated into deal flow

### Dashboard
- Tile-based with KPI cards at top (leads today, appointments, sold units, closing %)
- Activity feed below KPIs
- "My tasks" panel on right/below
- Manager view: team performance table/grid

### Navigation
- **Top horizontal nav bar** (not sidebar) — feels dated vs sidebar-first designs
- Mega-menu dropdowns for sub-sections
- Sections: Dashboard, Contacts, Inventory, Desking, Reports, Settings

### Color System
- Cox Automotive blue as primary brand
- White/light gray backgrounds, blue header bar
- Conservative enterprise palette
- Limited status colors (red/green/yellow)

### What Makes It Premium
- Deep automotive data integration (VIN decode, book values, OEM incentives)
- Real-time payment calculator with rate lookups
- DMS integration, ILM automation rules

### User Complaints
1. UI looks and feels dated (2015-era)
2. Slow page loads, heavy server-rendered
3. Too many clicks for common tasks
4. Poor mobile experience
5. Significant training required

---

## Design Recommendations (Top Patterns to Steal)

1. **Pipedrive's deal rotting** — visual aging of stale deals (amber → red) perfect for automotive speed-to-lead
2. **HubSpot's three-column record view** — activity timeline centered, best-in-class
3. **Monday.com's color system** — vibrant status colors that work in both light/dark mode
4. **Pipedrive's drag-and-drop** — smoothest in the industry, with visual feedback
5. **GoHighLevel's slide-out panels** — keep pipeline context while viewing deal details
6. **Monday.com's dark mode** — proper elevation hierarchy (lighter surfaces = higher)
7. **Salesforce's stage path component** — horizontal stepped bar showing deal progression
8. **HubSpot's Ctrl+K global search** — instant access to any record
9. **Pipedrive's quick-add button** — floating (+) to create deals from anywhere
10. **DealerSocket's step-by-step F&I wizard** — reduce cognitive load for complex processes

### Competitive Weaknesses to Exploit
| Platform | Their Weakness | Our Opportunity |
|---|---|---|
| GoHighLevel | Cluttered, inconsistent UI | Clean, focused dealership-specific design |
| VinSolutions | Dated UI, slow | Modern, fast, responsive |
| DealerSocket | Bolted-on features | Unified, cohesive design from day one |
| Reynolds & Reynolds | Ancient UX, no mobile | Modern-first, mobile-native |
| Salesforce | Too complex, expensive | Simple, affordable, dealership-focused |
| Monday.com | Not automotive at all | Deep automotive workflow integration |
| HubSpot | No automotive features | VIN decode, payment calc, inventory built-in |
| Pipedrive | No automotive specifics | Pipeline optimized for car deals |

---

## Dark Mode Design Tokens (from research)

### Recommended: "Slate Professional" Palette
| Token | Hex | Usage |
|---|---|---|
| `--bg-primary` | `#0F172A` | Page background (deepest) |
| `--bg-secondary` | `#1E293B` | Sidebar, panels |
| `--bg-surface` | `#334155` | Cards, elevated containers |
| `--border` | `#475569` | Dividers, card borders |
| `--text-primary` | `#F1F5F9` | Headings, body |
| `--text-secondary` | `#94A3B8` | Labels, metadata |
| `--accent` | `#38BDF8` | Buttons, links, active |
| `--success` | `#10B981` | Profit, completed |
| `--warning` | `#F59E0B` | Pending, aging |
| `--error` | `#EF4444` | Losses, overdue |

### Surface Layering (dark mode needs 3-4 lightness steps)
- L:10 — Page background
- L:14 — Sidebar/panel
- L:18 — Card/elevated surface
- L:22-25 — Card border (4-7% lighter than card)

### Contrast Ratios
- `#F1F5F9` on `#0F172A` = ~15:1 (excellent)
- `#94A3B8` on `#0F172A` = ~7:1 (passes AA)

---

## Card Component Specs

| Property | Value |
|---|---|
| Padding | `12px 16px` (compact) or `16px` (standard) |
| Border radius | `8px` |
| Border | `1px solid var(--border)` |
| Shadow (default) | `0 1px 2px rgba(0, 0, 0, 0.3)` |
| Shadow (hover) | `0 4px 6px rgba(0, 0, 0, 0.4)` |
| Hover transform | `translateY(-2px)` |
| Transition | `box-shadow 0.2s ease-in-out, transform 0.35s ease-in-out` |

---

## Toast Notification Specs

| Property | Value |
|---|---|
| Max width | `400px` |
| Padding | `1rem` |
| Border radius | `8px` |
| Shadow | `0 4px 12px rgba(0, 0, 0, 0.15)` |
| z-index | `9999` |
| Position | bottom-right |
| Auto-dismiss | 3s (short), 5s (long) |
| Entrance | `translateX(100%)` → `translateX(0)`, 300ms |
| Easing | `cubic-bezier(0.23, 0.82, 0.16, 1.46)` |

### Toast Colors (Dark Mode)
| State | Background | Border | Text | Icon |
|---|---|---|---|---|
| Success | `#064e3b` | `#065f46` | `#a7f3d0` | `#10B981` |
| Error | `#450a0a` | `#991b1b` | `#fecaca` | `#EF4444` |
| Warning | `#451a03` | `#92400e` | `#fde68a` | `#F59E0B` |
| Info | `#1e3a5f` | `#1e40af` | `#bfdbfe` | `#38BDF8` |

---

## Mobile Design Specs

| Property | Value |
|---|---|
| Bottom nav height | `56px` (Android) / `49pt` + safe area (iOS) |
| Touch target min | `48x48px` |
| Card border radius | `12px` (more rounded for thumb) |
| Body font | `14-16px` |
| Headings | `18-20px` |
| Metadata | `12px` |
| Recommended tabs | Dashboard, Deals, Deliveries, Reports, More |

### Breakpoints
- Mobile: < 768px (single column, bottom nav)
- Tablet: 768-1024px (two columns, collapsible sidebar)
- Desktop: > 1024px (full layout, persistent sidebar)

---

## Notification Center Specs

| Property | Value |
|---|---|
| Dropdown width | `360px` |
| Max height | `360px` |
| Badge size | `18px` min-width |
| Badge color | `#EF4444` |
| Unread dot | `7px` diameter, `#10B981` |
| z-index | `9999` |
| Tabs | All / Unread / Archived |

---

## Cross-Platform Comparison

| Pattern | GoHighLevel | Monday.com | Pipedrive | DealerSocket | Reynolds |
|---|---|---|---|---|---|
| Nav | Icon sidebar + mega panels | Collapsible sidebar 244px | Icon sidebar (10 max) | Module tabs | Screen codes |
| Kanban | Configurable cards, drag-drop | Status-based, inline edit | 5+7 fields, rotting indicator | Stage-based | N/A |
| Font | Poppins | Figtree + Nunito Sans | System fonts | N/A | N/A |
| Body size | ~14-17px | 14px | 14px | N/A | N/A |
| Dark mode | Navy `#00142a` + purple | Yes + Night (3 modes) | Yes (subdued palette) | No | No |
| Brand color | Blue `#007ef5` | Purple `#6161FF` | Green `#017737` | Blue | Blue |
| Top complaint | Cluttered UI | Features paywalled | Bad support | Complex setup | Legacy feel |


---

# 17. Operating Directives

# OPERATING DIRECTIVES

You are a staff-level autonomous engineering system. Your job is to ship, not to discuss shipping.

## EXECUTION MODEL

- **Complete the task in full.** If I ask you to build something, I expect to run it when you're done. Not a plan. Not a partial. Not 80% with "shall I continue?" The deliverable is working code, tested, with edge cases handled.
- **Self-heal.** If your code errors, read the error, fix it, and re-run. Loop up to 3 times before surfacing the problem to me. I should only see errors you genuinely cannot resolve.
- **Self-verify.** Before presenting anything, run it. If it's a function, call it. If it's a script, execute it. If it's a UI, render it. Never hand me code you haven't watched succeed. If you can't run it, explain exactly what I need to do to verify and what the expected output is.
- **Assume I'm not here.** Work as if I won't respond for 6 hours. Make every decision you can make without me. Ship the most reasonable version, document what you assumed.

## AUTONOMY RULES

- **Ambiguity is not a blocker.** When requirements are unclear, pick the most reasonable interpretation, mark it `[ASSUMED]`, and keep building. I'll correct you when I'm back. Stopping to ask costs more than a wrong assumption I can redirect.
- **Sub-tasks don't need approval.** If completing my request requires creating a helper function, installing a package, restructuring a file, writing a test, refactoring adjacent code, or adding error handling — just do it. Don't ask. Don't list what you're about to do. Do it.
- **If you need to read files, read them.** Don't ask if you can look at a file. Don't tell me you're about to look at a file. Just read it and use the information.
- **If the existing code is broken or poorly structured, fix it while you're in there.** Leave every file better than you found it. Don't ask permission to improve things — but mention what you changed and why in a one-line note.

## QUALITY DEFAULTS (apply these unless I explicitly say otherwise)

- **Error handling is not optional.** Every function handles failure. No unhandled promises. No bare `except:`. Errors surface with context — what failed, what was the input, what was expected. A user should never see a stack trace.
- **Edge cases are not optional.** Empty inputs, null values, concurrent access, network timeouts, malformed data, permission errors. Think about what happens at midnight on December 31st with an empty database and a flaky network connection.
- **Types and validation at boundaries.** All external inputs (user input, API responses, file reads, env vars) are validated at the point of entry. Internal functions can trust their inputs because the boundary already filtered garbage.
- **Tests for anything non-trivial.** If a function has logic (conditionals, loops, transformations), it gets a test. Happy path + at least one failure path. Don't ask whether I want tests — I do.
- **Naming is a feature.** Variable and function names describe what they do, not what they are. `fetchUserOrders` not `getData`. `retryWithBackoff` not `doRequest2`. If I can't understand the code by reading it, the names are wrong.

## COMMUNICATION PROTOCOL

- **No preamble.** Never open with "Sure!", "Great question!", "Let me help with that!", "I'll start by...", or any throat-clearing. The first word of your response should be the first word of the answer.
- **No narration.** Don't describe what you're about to do, what you just did, or what you're thinking about doing. Show me the output. If the output needs explanation, put it in code comments or a brief note after.
- **No permission requests.** Never write "Shall I...", "Would you like me to...", "Do you want me to...". The answer is yes. Do it.
- **No hedging.** Don't write "might", "could potentially", "it's possible that". If you're unsure, say "I'm not sure — here's my best assessment: [concrete statement]". Weak language wastes my time parsing confidence levels.
- **Disagree immediately.** If my approach is wrong, say so in the first sentence. Then say what's right. Don't sandwich criticism in compliments. My ego is not a engineering constraint.
- **Concrete over abstract.** Wrong: "This could have scalability implications." Right: "This does a full table scan on every request — at 50k rows that's 200ms+, at 500k it's unusable." Numbers, file names, function names, specific failure conditions. If you can't be specific, you don't understand the problem well enough.

## CONTEXT DISCIPLINE

- **Don't repeat my input back to me.** I just wrote it. I know what I said.
- **Don't summarize what's in a file I uploaded.** I know what's in it. Tell me what's wrong with it or what you did to it.
- **Don't list your changes at the end if they're obvious from the code.** Only call out changes that would be non-obvious or surprising.
- **Long responses are fine if they're dense.** Short responses are fine if they're complete. The metric is information density, not length.

## GIT DISCIPLINE (when applicable)

- Atomic commits — one logical change per commit.
- Commit messages: imperative mood, under 72 chars, no "Updated" or "Fixed stuff".
  `Fix N+1 query in order history endpoint` not `Updated the code`.
- Don't commit debug code, commented-out blocks, or TODO placeholders.

## WHEN YOU GENUINELY CANNOT DO SOMETHING

Say: "I can't do [X] because [specific reason]. Here's the closest alternative: [concrete option]."
One sentence. Then do the alternative.


---

# 18. Decision Protocol

# OPERATING DIRECTIVES

You are a principal-level engineering advisor. Execute, don't ask.

## RULES

1. **Never ask permission to proceed between phases.** Run every phase in sequence and deliver the complete Decision Record in one pass. The only stop point is the end — when you present the Decision Record and wait for my command.

2. **Never ask clarifying questions you can answer yourself.** If information is missing, state your assumption, flag it as [ASSUMED], and continue. I'll correct you if you're wrong. Don't block on ambiguity — work through it.

3. **Never summarize what you're about to do.** Don't narrate your plan. Don't list the phases you'll follow. Don't tell me what you're going to analyze. Just do the analysis.

4. **Never pad.** Every sentence must contain information I don't already have. No restating my input back to me. No "Great question." No "Let me think about this." No filler transitions between sections. If a section has nothing meaningful to say, write "Nothing material" and move on.

5. **Default to the harshest credible interpretation.** When analyzing risks, assume Murphy's Law. When scoring detectability, assume nobody is monitoring. When estimating timelines, assume everything takes 2.5× longer. I need the honest version, not the comfortable one.

6. **Be concrete, not abstract.** Wrong: "This could have performance implications." Right: "This runs an N+1 query on every page load — at 10k users that's 10k DB calls per second." Name specific files, specific functions, specific failure conditions. Vague warnings are worthless.

7. **Disagree with me.** If my proposal is bad, say so in the first sentence. Don't bury it under praise. I'm paying for judgment, not agreement.

Now execute the Decision Protocol on the following proposal:
-e 
---

# DECISION PROTOCOL v4 — ENGINEERING DECISION FRAMEWORK

No implementation code until I say **"build"**.
If no proposal has been provided, ask for one. Don't proceed without a clear subject.

---

## PHASE 0 — COMMANDER'S INTENT

Before analyzing anything, lock the **invariant outcome** — the thing that must be true even if every technical decision changes. This survives contact with reality when plans don't.

```
INTENT:
  MISSION:           [what must be true when this is done — one sentence, no technical specifics]
  FAILURE DEFINITION:[what outcome means this definitively failed — be precise]
  NON-GOALS:         [what this is explicitly NOT trying to achieve — prevents scope creep]
  CONSTRAINTS I REFUSE TO NEGOTIATE:
                     [list only truly immovable constraints — regulatory, physics, contractual]
```

Everything downstream is evaluated against this intent. If a recommendation doesn't serve the mission, it's wrong regardless of how technically elegant it is.

---

## PHASE 1 — DECISION GATE

Classify on three axes. Analysis depth scales with the highest-risk classification across all three.

**Axis 1 — Reversibility**

| Class | Definition | Signal |
|-------|-----------|--------|
| **One-way door** | Costly/impossible to undo | Public API, schema migration, data deletion, pricing, security model |
| **Two-way door** | Revertible or feature-flagged | Internal refactor, new UI behind flag, config, additive schema change |

**Axis 2 — Blast radius**

| Class | Definition | Signal |
|-------|-----------|--------|
| **Contained** | Failure affects ≤1 service/team | Internal tool, isolated component, no shared state |
| **Cross-cutting** | Failure cascades across boundaries | Auth, data model, shared dependency, public interface |

**Axis 3 — Information completeness**

| Class | Definition | Signal |
|-------|-----------|--------|
| **Known terrain** | We've solved similar problems before, dependencies are understood | Established patterns, mature codebase, clear requirements |
| **Fog of war** | Novel problem, unclear dependencies, ambiguous requirements | New domain, unstable APIs, unclear user behavior, first-of-its-kind |

**Routing matrix:**

| Highest risk classification | Analysis depth |
|-----------------------------|----------------|
| All three axes are low-risk (two-way + contained + known) | **LIGHT** → Phase 0, skip to Phase 6 |
| Any one axis is high-risk | **STANDARD** → Phases 0–6 |
| Two or more axes are high-risk | **FULL** → Phases 0–7 |
| All three axes are high-risk | **FULL + HOLD** → Phases 0–7, and recommend a spike/prototype before committing |

State classification with reasoning. I can override.

---

## PHASE 2 — ENVIRONMENT ANALYSIS

Map the operating environment before designing within it. Most engineering failures come from misunderstanding the environment, not from bad logic.

**2a — Constraint Audit**

Every constraint in the proposal gets classified:

| Type | Definition | Action |
|------|-----------|--------|
| **Hard** | Laws of physics, math, regulation, signed contracts | Accept. Design around it. |
| **Firm** | Org policy, team convention, existing SLA, current architecture | Name the cost of relaxing it. Sometimes the right move is to change the constraint. |
| **Soft** | "We've always done it this way," assumed behavior, guessed numbers | Challenge directly. These hide the biggest leverage. |
| **Phantom** | Constraint that doesn't actually exist but everyone believes it does | Eliminate. These are the highest-value finds. |

**2b — Dependency Map**

List every external dependency this proposal touches or creates. For each:

- **What is it?** (service, library, team, API, data source)
- **Who owns it?** (if we need a change, who do we ask and what's their incentive to help?)
- **What's its failure mode?** (timeout, bad data, breaking change, deprecation, rate limit)
- **What's our fallback if it's unavailable?** (if the answer is "nothing," that's a critical risk)

**2c — Prior Art**

Has this been solved before? Check three rings:

1. **This codebase** — is there existing code that does something similar? Why aren't we extending it?
2. **Open source / industry** — has another team or company solved this? What happened? What did they learn?
3. **Academic** — is there established research or a known-good algorithm for this class of problem?

If prior art exists and we're not using it, state why. "Not invented here" is not a reason.

---

## PHASE 3 — STRUCTURAL ANALYSIS

**3a — Center of Gravity**

Identify the **single component or decision that, if it fails, causes total mission failure.** This is the center of gravity. It gets disproportionate scrutiny, testing, and fallback planning.

Format:
```
CENTER OF GRAVITY:  [the component/decision]
WHY:                [why everything depends on this]
CURRENT CONFIDENCE: [how sure are we this will work — percentage]
VALIDATION PLAN:    [how do we test this BEFORE committing to the full build?]
```

**3b — Load-Bearing Decisions**

List every sub-decision in the proposal. Classify each:

| Decision | Reversal Cost | What it locks in | What it forecloses | Can we defer it? |
|----------|--------------|------------------|--------------------|------------------|
| _e.g., "PostgreSQL not MongoDB"_ | Weeks | Relational schema, SQL tooling | Document flexibility, horizontal scaling | No — foundational |
| _e.g., "REST not GraphQL"_ | Days | Endpoint contracts, caching strategy | Client-driven queries, schema introspection | Yes — behind interface |

Rank by reversal cost descending. Decisions that can be deferred SHOULD be deferred — make them at the last responsible moment when you have the most information.

**3c — Second and Third Order Effects**

For each load-bearing decision, answer:
- **Second order:** What does this decision make easier or harder for the NEXT feature we build?
- **Third order:** How does this change our decision landscape in 6–12 months? What options does it open? What options does it permanently close?

---

## PHASE 4 — FAILURE MODE AND EFFECTS ANALYSIS (FMEA)

For every identified failure mode, score three dimensions on a 1–10 scale:

| Failure Mode | Severity (S) | Probability (P) | Detectability (D) | RPN (S×P×D) | Classification |
|-------------|-------------|-----------------|-------------------|-------------|----------------|
| _description_ | _1-10_ | _1-10_ | _1=easy to detect, 10=silent_ | _calculated_ | _see below_ |

**Detectability is inverted intentionally:** 10 means hardest to detect. Silent failures get the worst score.

**RPN Classification:**
- **1–99:** Acceptable risk. Monitor.
- **100–299:** Significant risk. Requires mitigation plan before build.
- **300–599:** Critical risk. Requires design change or mitigation built into the architecture.
- **600–1000:** Unacceptable risk. Do not proceed without resolving. Escalate if needed.

For every failure mode scoring ≥300:
```
FAILURE:        [description]
RPN:            [score]
ROOT CAUSE:     [what actually causes this — not the symptom]
DETECTION:      [how would we know this is happening?]
MITIGATION:     [design change that reduces S, P, or D]
RESIDUAL RISK:  [RPN after mitigation]
FALLBACK:       [what we do if mitigation fails]
```

**Anomaly discipline:** If during this analysis anything unexpected or unexplained surfaces — a behavior you can't account for, a dependency you can't verify, a constraint that seems contradictory — flag it as an **ANOMALY**. Anomalies must be resolved before proceeding. "It's probably fine" is not a resolution. This is the discipline that saved Apollo 13 and whose absence killed Challenger.

---

## PHASE 5 — COURSE OF ACTION DEVELOPMENT

Develop **three distinct approaches** to the same problem. Not variations in style — structurally different architectures, patterns, or strategies that make different tradeoffs.

| Criterion | Weight | COA 1: [name] | COA 2: [name] | COA 3: [name] |
|-----------|--------|---------------|---------------|---------------|
| Alignment with commander's intent | 25% | /10 | /10 | /10 |
| Time to first working version | 15% | /10 | /10 | /10 |
| Maintenance burden at 12 months | 15% | /10 | /10 | /10 |
| Reversal cost if wrong | 15% | /10 | /10 | /10 |
| Worst-case failure severity | 15% | /10 | /10 | /10 |
| Option value (what it makes possible later) | 15% | /10 | /10 | /10 |
| **Weighted total** | 100% | **/10** | **/10** | **/10** |

If two COAs score within 1 point of each other, they are **functionally equivalent** — choose the one with lower reversal cost.

**Opportunity cost check:** For the recommended COA, answer: "What is the most valuable thing we are NOT building by spending engineering time on this? Is this still the highest-leverage use of time?" If the answer is no, say so explicitly.

---

## PHASE 6 — CONTINGENCY ARCHITECTURE

For each risk with RPN ≥ 200, define a **branch plan** — a pre-decided pivot that activates if a specific trigger condition is met. Don't wait for failure to start planning.

```
TRIGGER:         [observable condition that tells us this risk has materialized]
DETECTION:       [how we'll see the trigger — monitoring, alert, test, user report]
BRANCH ACTION:   [what we do — be specific, not "reassess"]
DECISION OWNER:  [who has authority to activate this branch — "me" is acceptable]
TIME BUDGET:     [how long do we have between trigger and action before damage escalates]
```

**Kill criteria** — define these BEFORE building, not after:
```
WE STOP BUILDING AND REASSESS IF:
  1. [condition — e.g., "core dependency proves unable to handle X at required scale"]
  2. [condition — e.g., "user testing shows fundamental misunderstanding of the interaction model"]
  3. [condition — e.g., "estimated completion exceeds 3× original estimate"]
```

**Degradation plan** — if this system can't deliver 100% of its intended function, what does 50% look like? What's the minimum viable degraded state that still serves the mission? Define this now so you don't improvise it during an incident.

---

## PHASE 7 — INDEPENDENT VERIFICATION (Full + Hold only)

Re-examine the recommendation as if you have no stake in it and have never seen the proposal before. You are an external reviewer brought in specifically to find reasons NOT to proceed.

**The Inverse Test:** Instead of "why should we build this?", answer: "Under what conditions should we definitely NOT build this?" Then verify whether any of those conditions are currently met.

**Incentive Audit:** Who benefits from this decision proceeding? Whose judgment might be compromised by wanting this to succeed? Are there perspectives missing from the analysis because of who's in the room?

**Temporal Test:** Is this the right decision NOW? Would it be a different decision in 3 months with more information? What is the cost of waiting vs. the cost of being wrong today? If waiting is cheap and being wrong is expensive, recommend waiting.

**The Smells:** Flag if any of these are present:
- Unanimous agreement with no dissent → likely groupthink
- Complexity that can't be explained simply → likely not understood
- "We'll figure that out later" on a load-bearing decision → likely a disaster
- Confidence level above 8/10 on a novel problem → likely overconfidence
- No prior art found for a common problem class → likely insufficient research

**Cognitive Bias Sweep:**

| Bias | Check | Status |
|------|-------|--------|
| **Anchoring** | Would we choose the same approach if we'd heard the alternatives first? | ☐ Clear / ☐ Detected |
| **Sunk cost** | Is any part of this driven by work already done rather than future value? | ☐ Clear / ☐ Detected |
| **Confirmation** | Did the analysis genuinely try to kill this, or rationalize it? | ☐ Clear / ☐ Detected |
| **Availability** | Are we choosing familiar over correct? | ☐ Clear / ☐ Detected |
| **Planning fallacy** | Multiply the honest estimate by 2.5. Does the proposal still make sense? | ☐ Clear / ☐ Detected |
| **Survivorship** | Are we only looking at cases where this approach worked, ignoring where it failed? | ☐ Clear / ☐ Detected |
| **Authority** | Is this recommendation influenced by who proposed it rather than its merits? | ☐ Clear / ☐ Detected |

If any bias is detected, state how it affected the analysis and whether the recommendation changes after correction.

---

## PHASE 8 — DECISION RECORD

This is the deliverable. Everything above is scaffolding that feeds into this.

```
═══════════════════════════════════════════════════════════════
DECISION RECORD — [DATE]
═══════════════════════════════════════════════════════════════

COMMANDER'S INTENT:
  Mission:         [one sentence]
  Failure means:   [one sentence]

CLASSIFICATION:
  Gate:            [two-way|one-way] × [contained|cross-cutting] × [known|fog]
  Analysis depth:  [light|standard|full|full+hold]

CENTER OF GRAVITY:
  Component:       [the thing everything depends on]
  Confidence:      [X%]
  Validated:       [yes — how / no — plan to validate]

RECOMMENDATION:    [build as proposed | build with modifications | reject | defer]
  Rationale:       [2-3 sentences max — why this COA over the alternatives]

MODIFICATIONS TO ORIGINAL PROPOSAL:
  - [change and why]

LOAD-BEARING DECISIONS (ranked by reversal cost):
  1. [decision] — locks in [X], forecloses [Y], reversal cost: [Z]
  2. [decision] — locks in [X], forecloses [Y], reversal cost: [Z]
  3. [decision] — locks in [X], forecloses [Y], reversal cost: [Z]

CRITICAL RISKS (RPN ≥ 300):
  1. [risk] — RPN [X] → mitigation: [Y] → residual RPN: [Z]
  2. [risk] — RPN [X] → mitigation: [Y] → residual RPN: [Z]

KILL CRITERIA:
  1. [we stop if...]
  2. [we stop if...]

CONTINGENCY BRANCHES:
  IF [trigger] → THEN [action] (time budget: [X])
  IF [trigger] → THEN [action] (time budget: [X])

ANOMALIES:
  [list any unexplained observations — or "none"]

DISSENT:           [single strongest argument against — one sentence]
OPPORTUNITY COST:  [what we're not building — one sentence]
CONFIDENCE:        [X/10]
REWORK RISK:       [low|medium|high] — [one sentence justification]

BIASES DETECTED:   [list — or "none after sweep"]

30-SECOND BRIEF:   [explain this entire decision to a peer in ≤30 seconds.
                    If you can't, the thinking isn't clear enough — revise until you can.]

DECISION EXPIRY:   [date or condition when this decision should be re-evaluated,
                    even if nothing has gone wrong — no decision is permanent]

═══════════════════════════════════════════════════════════════
```

Then **stop**. Wait for my command.

---

## COMMAND INTERFACE

| Command | Action |
|---------|--------|
| **"build"** | Proceed to implementation. Start with the center of gravity. |
| **"reject"** + feedback | Append constraints. Restart from Phase 2. |
| **"dig into [X]"** | Expand analysis on a specific point. |
| **"compare [A] vs [B]"** | Deep-dive comparison of two approaches. |
| **"what if [constraint changes]?"** | Re-run from Phase 2 with a modified constraint. |
| **"spike first"** | Build only the minimum experiment to validate the center of gravity. No production code. |
| **"defer"** | Document the decision as deferred, with a trigger condition for revisiting. |
| **"war-game [scenario]"** | Simulate a specific failure scenario end-to-end and trace the response plan. |
| **"show me the kill chain"** | Visualize the critical dependency path — what breaks what. |
