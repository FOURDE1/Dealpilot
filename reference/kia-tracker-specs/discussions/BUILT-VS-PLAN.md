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
