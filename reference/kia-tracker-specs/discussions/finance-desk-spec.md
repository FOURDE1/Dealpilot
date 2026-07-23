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
