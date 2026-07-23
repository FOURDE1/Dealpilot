# Accounting / Expenses Roadmap

Multi-session build of per-vehicle expense tracking + CAMS-equivalent reports.
Sessions 1 and 2 are complete and in the codebase. This doc captures the
remaining work so we can pick it up cold.

---

## Decisions locked (don't re-ask)

- Expenses attach to **both inventory units and deals** (one can roll up to the other via `stock_number`).
- **Manager approval** for status transitions; anyone authenticated can add.
- Receipts uploaded directly to Supabase Storage bucket `expense-receipts`.
  - User must create this bucket in the Supabase dashboard.
- Status model: `pending → approved → paid`, plus `rejected` and `void`.
- Workflow: `DELETE` soft-voids, preserves audit trail.
- Export format: **CSV now**, server-side PDF + Excel planned via existing
  `server/services/reportGenerator.js`.
- **No QuickBooks / Sage export yet** (deferred; IIF/CSV would go in Tier 2).
- No new libraries installed; Tailwind + existing stack only.

---

## Shipped in Session 1

**Schema** — `supabase/migrations/20260414_expenses.sql`:
- `suppliers` table (active flag, category, contact, tax #, payment terms).
- `expense_categories` seed table — 17 categories with `is_cogs` flag.
- `expenses` table — FKs to inventory + deals + stock_number, supplier FK +
  fallback name, amount_cents + tax_cents + generated total_cents, status,
  approval audit columns, receipt_url, notes, trigger to auto-fill
  `stock_number` from linked inventory.
- `vehicle_expense_summary` view — approved+paid totals per inventory unit.

**API** — `server/routes/suppliers.js`, `server/routes/expenses.js`
(both registered in `server/index.js`). CRUD + `/categories`,
`/summary/inventory/:id`, `/:id/approve`, `/:id/reject`, `/:id/pay`.
DELETE soft-voids.

**UI**:
- `components/expenses/ExpensesPanel.jsx` (reusable: inventoryId / dealId / stockNumber).
- `components/expenses/SupplierSelector.jsx` — searchable + inline "Add supplier".
- `components/expenses/ExpenseForm.jsx` — modal with categories + supplier + amount/tax + invoice + date + notes + receipt upload.
- `pages/AccountingPage.jsx` at `/accounting` with tabs: Reconciliation, P&L by Vehicle, Vendor Spend, Aged Inventory.
- Sidebar nav entry added.
- `ExpensesPanel` embedded in `DealDetail.jsx` (Section 3D).

---

## Shipped in Session 2

- `pages/InventoryDetailPage.jsx` at `/inventory/:id` — hero card, cost summary strip (Purchase / Transport / Recon / Added Expenses / Total), embedded `ExpensesPanel`. Inventory cards already navigate to this route.
- Direct receipt upload in `ExpenseForm` → Supabase Storage bucket `expense-receipts` via `supabase.storage.from(...).upload()`. Auto-fills public URL. Spinner + error handling.
- Three additional tabs on `AccountingPage`:
  - **P&L Journal** — delivered-deal ledger joined with approved+paid expenses by stock_number; totals row + CSV export.
  - **Commissions** — grouped by `salesperson_name`, Deals / Sales Volume / Front Gross / Commission per person.
  - **Purchase Journal** — from inventory acquisition data, group by Vendor / Acquisition Type / None, grand-total banner.

---

## Still to do

### Session 3 (next up — mostly existing-data reports)

1. **Persist tax breakdown on deals.** Current blocker for tax collection reports.
   - Migration: add `tax_total_cents`, `tax_gst_cents`, `tax_pst_cents`, `tax_hst_cents`, `tax_qst_cents` to `deals`.
   - Write-back from `DeskingPage` on "Save & Return to Deal" action (currently the page navigates without persisting desking state — need a PUT to `/api/deals/:id` with the computed tax values from `computeDeal()`).
2. **Tax Collection reports** — GST, HST, PST, QST; collection + summary views over date range, both detail ledger and per-tax-type totals.
3. **Sold Vehicles Journal** — by manufacturer, by salesperson, retail vs wholesale, with P&L.
4. **OMVIC transaction fee register** — needs per-deal `omvic_fee_cents` field or derivation from province + `is_retail`.
5. **F&I Manager commissions** — needs either a role flag on `salespeople` or a separate `fi_commissions` table. Decide with user.
6. **Server-side PDF + Excel exports** — extend `server/services/reportGenerator.js` with new report types for all Accounting tabs; wire a "PDF / Excel" button next to each tab's "CSV" button.
7. **Vehicle Purchase by Finance Type, by Amount** — add group-by options to existing Purchase Journal tab.
8. **Inventory List (as at), Inventory List with Expenses, By Floorplan** — new tab on Accounting or extension of Aged Inventory.

### Session 4+ (Tier 2, still existing data)

- Profit/Loss Journal with HST / with GST variants (split from current P&L Journal).
- Revenue/Cost Statement for Delivered Vehicles.
- Buyer Report, Returned Retail Customers, Conditional Sale reports.
- Traded Vehicles, Vehicle Movements, Arrival reports.
- Customer-centric reports: emails, Indian Status transactions, financed customers.
- Accounts Receivable + by status (needs an AR schema — if deals track outstanding balance, use that; otherwise new table).
- Inventory Turnover, Sold vs Wholesale breakdown.
- Monthly Revenue (Financed Vehicles).
- Bottom Price Catalogue, For-Sale Catalogue sorted by price.

### Tier 3 (new modules — each needs schema work)

Each of these is a multi-session build of its own:

- **Lease module** — contracts table, maturity tracking, customer insurance. Unlocks 9 reports (book value, current leases, insurance expiry, matured/maturing leases, HST collected on leases, monthly revenue).
- **Parts & Service** — parts inventory, work orders, mechanic labor. Unlocks ~24 reports.
- **Payment schedules / Loans / Investors** — amortization tracking, investor allocations. Unlocks ~10 reports (missing payments, unpaid principal by investor, upcoming payments, matured loans, refinancing, interest earned).
- **Auction module** — separate integration. 6 reports.
- **Rental module** — contracts + revenue tracking. 1-2 reports.
- **Payroll / Clock in-out** — time tracking module. 2 reports.
- **Audit log** — system-wide audit trail. 3 reports + general value beyond accounting.
- **Equifax integration** — paid API. 1 report.
- **GAP + customer insurance tracking** — insurance contract fields on deals. 3 reports.

---

## Open questions to resolve in Session 3

- **F&I Manager commissions** — add role flag to `salespeople` (`is_fi_manager boolean`) so the same commission table handles both, or separate schema?
- **Receipts bucket policy** — keep public-read or switch to signed URLs (more secure, slightly more work)?
- **Tax write-back trigger** — only on "Save & Return to Deal" click, or also on every desking input change (debounced)?
- **PDF template branding** — reuse existing `reportGenerator.js` header/footer, or design new for Accounting reports?

---

## Quick reference — files touched

**New server files:**
- `server/routes/suppliers.js`
- `server/routes/expenses.js`

**New migrations:**
- `supabase/migrations/20260414_expenses.sql`

**New client files:**
- `client/src/components/expenses/ExpensesPanel.jsx`
- `client/src/components/expenses/SupplierSelector.jsx`
- `client/src/components/expenses/ExpenseForm.jsx`
- `client/src/pages/AccountingPage.jsx`
- `client/src/pages/InventoryDetailPage.jsx`

**Modified:**
- `server/index.js` (route registration)
- `client/src/App.jsx` (routes for `/accounting`, `/inventory/:id`)
- `client/src/components/Layout.jsx` (sidebar entry)
- `client/src/components/DealDetail.jsx` (embed ExpensesPanel)
- `client/src/locales/en.json` + `fr.json` (nav.accounting)

**Supabase dashboard actions user still needs to take:**
1. Run `supabase/migrations/20260414_expenses.sql` in SQL Editor.
2. Create Storage bucket `expense-receipts` (public or with RLS — decide later).
