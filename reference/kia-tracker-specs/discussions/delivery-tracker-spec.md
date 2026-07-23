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
