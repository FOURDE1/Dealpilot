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
