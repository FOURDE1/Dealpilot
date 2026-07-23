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
