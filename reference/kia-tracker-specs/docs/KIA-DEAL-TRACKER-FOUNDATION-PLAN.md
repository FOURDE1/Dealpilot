# Kia Deal Tracker — Foundation Rebuild Plan
### Prepared for Ralph Loop | April 6, 2026

---

## Executive Summary

We audited the Kia Deal Tracker against the four dominant platforms in our space — **Salesforce Automotive Cloud**, **GoHighLevel**, **DealerSocket**, and **Reynolds ERA-IGNITE** — and identified **32 critical gaps** in the foundation layer that prevent the system from scaling.

The existing application has solid bones: React frontend, Express backend, Supabase database, real-time subscriptions, bilingual support, and working modules for deals, delivery, dispatch, and reporting. But the foundation underneath has zero authentication security, no customer records (names are text fields on deals), no audit trail, no input validation, and no multi-store support.

**This plan rebuilds the foundation layer only.** It does not touch the 14 feature modules (inventory, leads, chatbot, etc.) — those come after. Think of this as pouring a new foundation under an existing house before adding floors.

**Timeline:** 4 phases over 6–8 weeks
**Breaking changes:** Yes — no production users yet, so we rebuild freely

---

## What's Wrong Today (The Audit)

| Problem | Risk | Impact |
|---------|------|--------|
| **No authentication** — anyone types any email and they're in | Critical | Any person can access all financial data |
| **No customer records** — customer name is just text on each deal | Critical | Repeat buyers create duplicate data, no Customer 360 view |
| **No audit trail** — zero logging of who changed what | Critical | Fails dealership compliance audit, can't resolve disputes |
| **No input validation** — bad data enters freely | High | Corrupt VINs, invalid phone numbers, broken calculations |
| **Floating-point money** — $1000 × 15% = $149.99999 | High | Hundreds of dollars lost to rounding over time |
| **No search** — can't find a customer or deal without scrolling | High | Productivity killer for sales floor |
| **No task system** — salespeople can't schedule follow-ups | High | Leads go cold, no accountability |
| **No notifications** — bell icon exists but does nothing | Medium | Managers don't see deal changes in real time |
| **No multi-store support** — hardcoded single store | Medium | Can't scale to Ready Auto or future locations |
| **No soft deletes** — accidental delete destroys data permanently | Medium | One click = lost deal history |
| **No commission clawback** — funded deal unwinds, commission stays | Medium | Overpaying salespeople on defaulted deals |
| **No bulk operations** — everything is one-at-a-time | Low | Manager can't reassign 20 deals at once |

---

## What We're Building (12 Foundation Systems)

### Phase 1 — Data Model (Week 1–2)

**1. Contacts Table — Independent Customer Records**

The most important change. Instead of a text field "John Smith" on every deal, we create a real customer record with:
- Full identity: name, email, phone, address, driver's license, employer
- Relationship tracking: source (lead, walk-in, referral), customer since, lifetime deals, lifetime value
- Bill 96 compliance: preferred language defaults to French for Quebec operations
- PIPEDA compliance: marketing consent tracking with timestamps
- Full-text search: find any customer by name, phone, email, or city instantly
- Duplicate detection: before creating a new contact, system checks phone + email against existing records
- Merge capability: found duplicates? Merge them into one record, all deals follow

Every deal, lead, and communication links back to one contact record. A customer buys 3 cars over 5 years? One record, full history.

**Frontend:** Contacts dashboard with stats, filter bar, and contact cards. Contact detail page with three-column layout (properties | activity timeline | associated deals) matching the Salesforce/HubSpot industry standard.

**2. Stores Table — Multi-Store Foundation**

Every record gets a `store_id`. Kia Mont-Laurier is store #1. Ready Auto (or any future location) becomes store #2. Each store has its own:
- Province and tax rate (13% Ontario, 14.975% Quebec)
- Business hours and holiday calendar
- Alert thresholds (vehicle aging, safety overdue, funding overdue)
- Bill of sale system (CAMS vs Merlin)
- E-sign platform preference

Users are assigned to stores. Queries automatically scope to the user's store unless they're an owner (sees everything).

**3. Financial Precision — Integer Cents**

All money stored as cents (integers), not dollars (decimals). $25,000 becomes 2500000 cents. This eliminates floating-point rounding errors that accumulate over thousands of calculations. Commission math becomes exact.

---

### Phase 2 — Security & Auth (Week 2–3)

**4. Authentication — Supabase Auth**

Replace the current "type your email" login with real authentication:
- Email + password login with encrypted credentials
- JWT tokens with automatic refresh (no more localStorage-only sessions)
- Multi-factor authentication (required for owner, GM, admin)
- Password reset via email
- Admin creates accounts (no self-registration)

**5. Role-Based Access Control (10 Roles)**

| Role | Sees | Can Do |
|------|------|--------|
| Owner | All stores, all data | Everything |
| GM | Own store, all data | Everything except create users |
| Sales Manager | Own store | Manage team deals, commissions, reporting |
| Used Car Manager | Own store | Inventory, wholesale, aging |
| F&I Agent | Own store, financials | Finance desk, funding, documents |
| Salesperson | Own deals only | Create/edit own deals, own commissions |
| Wholesale Manager | Own store | Wholesale listings, offers, auctions |
| Logistics | Delivery data only | Dispatch, delivery checklists |
| Admin/Office | Own store | Administrative tasks |
| Receptionist | Limited | Lead intake, task creation |

Every API endpoint enforces these roles. A salesperson cannot see another salesperson's commission. The logistics coordinator cannot see deal financials.

**6. Input Validation**

Every form submission validated before it touches the database:
- VIN: exactly 17 characters, correct format (no I, O, Q per NHTSA standard)
- Phone: normalized to digits, must be 10–11 digits
- Postal code: Canadian format (A1A 1A1)
- Money fields: must be non-negative integers
- Pipeline stages: must be one of 10 valid values
- Bad data returns clear error messages to the user

**7. Soft Deletes**

Nothing is permanently destroyed. "Delete" sets a `deleted_at` timestamp. Records can be restored. Archived records are queryable by managers. Hard delete only by owner action after 90 days.

---

### Phase 3 — Productivity Systems (Week 3–5)

**8. Activity Events — Universal Timeline**

Every change to every record is logged:
- Who changed it, when, what field, old value → new value
- Stage changes, document uploads, emails sent, payments received, checklist completions
- Displayed as a chronological timeline on every contact, deal, and inventory record
- Legally required for dealership compliance audits

**9. Global Search — Cmd+K Command Palette**

Press Ctrl+K from anywhere to search across all contacts, deals, and inventory simultaneously. Results show instantly with type-ahead. Supports partial phone number matching, VIN lookup, and stock number prefix search.

**10. Tasks & Follow-Ups**

Full task management for the sales floor:
- Create tasks: call, email, text, meeting, follow-up, document request
- Assign to any user, set due date and priority
- Auto-overdue detection (checked every 15 minutes)
- Quick-create from any deal or contact page ("Call John tomorrow about his trade-in")
- "My Tasks" widget on dashboard showing overdue, today, and upcoming
- Recurring tasks (weekly follow-up, monthly check-in)

**11. Notification Bell**

The existing bell icon comes to life:
- Real-time unread count badge
- Dropdown panel with notification list
- Three urgency levels: low (in-app only), medium (in-app + email later), high (requires acknowledgment)
- Escalation chains: high-urgency notification not acknowledged in 10 minutes? Escalates to sales manager. Still not acknowledged in 30? Escalates to GM.
- Auto-generated from activity events: deal stage changed, new deal created, task overdue

---

### Phase 4 — Financial & Operations (Week 5–6)

**12. Commission Clawback Tracking**

When a funded deal defaults or unwinds:
- Flag the deal for clawback (owner, GM, or F&I only)
- System reverses commission calculations
- Records reason, amount, who initiated, when
- Notifies the affected salesperson and GM
- Shows in commission reports with full audit trail

**13. Bulk Operations**

Manager operations at scale:
- Select multiple deals → change stage, reassign salesperson
- Select multiple tasks → mark complete, reassign
- Each bulk action validates permissions and logs activity per record
- Returns success/failure per item (partial success is OK)

---

## Technical Architecture

### Before (Current)
```
Frontend → localStorage user → raw fetch() → Express (no auth, no validation) → Supabase
```

### After (Foundation)
```
Frontend → Supabase Auth (JWT) → api.js (auto-token) → Express:
  → authenticateUser (verify JWT)
  → requireRole (RBAC check)
  → scopeToStore (multi-store filter)
  → validate(schema) (Zod validation)
  → route handler → Supabase (scoped queries)
  → activityLogger (audit trail)
  → notify (real-time notifications)
  → errorHandler (structured errors)
```

### New Database Tables (6)
| Table | Purpose |
|-------|---------|
| `contacts` | Independent customer records with full-text search |
| `stores` | Multi-store configuration and scoping |
| `activity_events` | Universal audit trail and timeline |
| `tasks` | Follow-ups, reminders, assignments |
| `notifications` | Real-time alerts with escalation |
| `deal_parties` | Contact-to-deal join (buyer + cosigner) |

### Modified Tables (8)
All existing tables (deals, salespeople, commissions, delivery_checklists, sourced_units, dispatch, users, chaser_vehicles, dealer_plates) receive: `store_id`, `deleted_at`, `version` (optimistic locking), `created_by`/`updated_by`.

Deals table additionally gets: `contact_id`, `pipeline_stage` (10 stages), `stage_entered_at`, `clawback_status`, `search_vector`.

Money columns renamed from dollars (decimal) to cents (integer).

### New Server Dependencies
| Package | Purpose |
|---------|---------|
| `zod` | Input validation schemas |
| `helmet` | Security headers (CSP, HSTS, etc.) |
| `express-rate-limit` | Brute force protection |
| `pino` | Structured JSON logging |
| `escape-html` | XSS prevention in emails |

---

## What This Does NOT Include

This plan is the **foundation only**. The following are explicitly deferred to subsequent phases:

| Module | Status | When |
|--------|--------|------|
| Kanban pipeline UI | Uses `pipeline_stage` from this foundation | Tier 1 (next) |
| Inventory command center | Needs foundation complete | Tier 1 |
| Lead management | Uses contacts table from this foundation | Tier 1 |
| Workflow automation engine | Uses activity_events + notifications from this foundation | Tier 1 |
| Communication channels (SMS, unified inbox) | Needs contacts + activity | Tier 2 |
| Lender/credit integration (DealerTrack, RouteOne) | Needs finance desk module | Tier 2 |
| Digital retailing (customer-facing deal builder) | Needs inventory + pricing | Tier 2 |
| AI chatbot (Claude-powered) | Needs leads + communications | Tier 3 |
| Mobile PWA | Needs stable platform | Tier 2 |
| OEM portal integration (Kia incentives, warranty) | Tier 3 |

Every deferred module depends on at least one system built in this foundation plan. This is why we build the foundation first.

---

## Competitive Positioning

After this foundation is complete, the system will have:

| Capability | Salesforce | GoHighLevel | DealerSocket | Us (After Foundation) |
|-----------|-----------|-------------|-------------|----------------------|
| Customer 360 | ✅ | ✅ | ✅ | ✅ |
| Audit trail | ✅ | ❌ | ✅ | ✅ |
| Role-based access | ✅ | ✅ | ✅ | ✅ |
| Multi-store ready | ✅ | ✅ | ✅ | ✅ |
| Real-time updates | ✅ | ✅ | ❌ | ✅ |
| Bilingual (EN/FR) | ❌ | ❌ | ❌ | ✅ |
| Global search | ✅ | ✅ | ✅ | ✅ |
| Task management | ✅ | ✅ | ✅ | ✅ |
| Notification escalation | ✅ | ❌ | ❌ | ✅ |
| Commission clawback | ❌ | ❌ | ❌ | ✅ |
| Canadian compliance (Bill 96, PIPEDA) | ❌ | ❌ | ❌ | ✅ |
| Per-seat cost | $300/user/mo | $97–497/mo | Custom | $0 (self-hosted) |

Our unfair advantages after foundation:
1. **Purpose-built for Canadian Kia dealers** — Bill 96, OMVIC, PIPEDA baked in
2. **AI-native architecture** — Claude integration designed from day one, not bolted on
3. **Zero licensing fees** — self-hosted, no per-seat charges
4. **Real-time by default** — Supabase subscriptions, not polling
5. **Modern stack** — ships features 5x faster than enterprise Java platforms

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Breaking changes to existing features | No production users. Full rebuild allowed. |
| Data migration errors (customer dedup) | Migration script runs on test database first. Manual review of edge cases. |
| Supabase Auth migration from localStorage | Clear migration path. Old login stops working. Users receive invite emails with new credentials. |
| Scope creep into Tier 1 features | Spec explicitly lists what's excluded. Foundation only. |
| Timeline slip | Phases are independent. Phase 1 (data model) can ship while Phase 2 (auth) is in progress. |

---

## Next Steps

1. **Review this plan** — flag anything that needs changing
2. **Approve foundation scope** — confirm we're not missing anything critical
3. **Begin Phase 1** — contacts table, stores table, financial precision migration
4. **Weekly check-ins** — demo progress at end of each phase

---

*This document is the shareable summary. The full technical specification (17 sections, database schemas, API endpoints, component specs) is at `docs/superpowers/specs/2026-04-06-tier0-foundation-rebuild-design.md` in the repository.*
