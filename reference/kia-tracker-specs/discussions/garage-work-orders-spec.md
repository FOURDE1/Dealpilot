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
