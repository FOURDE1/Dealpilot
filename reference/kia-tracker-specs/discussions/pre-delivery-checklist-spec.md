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
