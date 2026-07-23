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
