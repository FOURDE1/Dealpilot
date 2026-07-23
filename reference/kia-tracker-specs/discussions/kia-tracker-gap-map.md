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
