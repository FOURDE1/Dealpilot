# ReadyLoans — Functional Requirements Catalog

This document is the exhaustive, numbered inventory of every capability requested across the master spec (KIA-DEAL-TRACKER-COMPLETE-SPECS.md), the module specs in `discussions/`, the Tier-0 foundation spec, the accounting roadmap, and the ReadyLoans multi-tenant/AI direction — each with a priority and its **current status in the existing codebase** as established by the July 2026 audit (the ground truth; `prd.json` statuses are unreliable). Where a requirement describes behavior beyond what any spec shipped, it is marked **(Target)**. Stack references conform to `00-overview/ARCHITECTURE-DECISIONS.md`.

**Priority key:** **P0** = foundation/blocker (security, tenancy, money correctness — required before any tenant besides Kia ML, and mostly before Kia ML itself); **P1** = launch parity (required for Kia ML to run on ReadyLoans day-to-day); **P2** = full-spec behavior that can follow parity; **P3** = deferred/future (explicitly phased later in the specs or ADRs).

**Status key:** **Built** = works end-to-end today (possibly with defects — noted); **Partial** = some pieces exist (schema/API/UI incomplete or unwired); **Missing** = does not exist in the current system.

## Table of Contents

- [1. Tenancy & Organizations (FR-TEN)](#1-tenancy--organizations-fr-ten)
- [2. Authentication & RBAC (FR-AUTH)](#2-authentication--rbac-fr-auth)
- [3. Contacts / CRM (FR-CON)](#3-contacts--crm-fr-con)
- [4. Lead Manager (FR-LEAD)](#4-lead-manager-fr-lead)
- [5. AI Conversation Engine (FR-AI)](#5-ai-conversation-engine-fr-ai)
- [6. Deal Pipeline (FR-PIPE)](#6-deal-pipeline-fr-pipe)
- [7. Finance Desk / Desking (FR-FIN)](#7-finance-desk--desking-fr-fin)
- [8. Funding Tracker (FR-FUND)](#8-funding-tracker-fr-fund)
- [9. Pre-Delivery Checklist (FR-PDC)](#9-pre-delivery-checklist-fr-pdc)
- [10. Delivery Tracker (FR-DEL)](#10-delivery-tracker-fr-del)
- [11. Driver Dispatch (FR-DISP)](#11-driver-dispatch-fr-disp)
- [12. Inventory Command Center (FR-INV)](#12-inventory-command-center-fr-inv)
- [13. Garage / Work Orders (FR-GAR)](#13-garage--work-orders-fr-gar)
- [14. Wholesale Manager (FR-WHL)](#14-wholesale-manager-fr-whl)
- [15. Document Manager (FR-DOC)](#15-document-manager-fr-doc)
- [16. Notifications & Automation (FR-NOT)](#16-notifications--automation-fr-not)
- [17. Reporting & Analytics (FR-REP)](#17-reporting--analytics-fr-rep)
- [18. Accounting & Expenses (FR-ACC)](#18-accounting--expenses-fr-acc)
- [19. Commissions (FR-COM)](#19-commissions-fr-com)
- [20. Tasks, Activity & Search (FR-TASK)](#20-tasks-activity--search-fr-task)
- [21. Appointments (FR-APP)](#21-appointments-fr-app)
- [22. Communications & Drips (FR-COMM)](#22-communications--drips-fr-comm)
- [23. White-Label & Branding (FR-WL)](#23-white-label--branding-fr-wl)
- [24. Billing & Entitlements (FR-BILL)](#24-billing--entitlements-fr-bill)
- [25. Internationalization (FR-I18N)](#25-internationalization-fr-i18n)
- [26. Platform Operations & Deployment (FR-OPS)](#26-platform-operations--deployment-fr-ops)

---

## 1. Tenancy & Organizations (FR-TEN)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-TEN-001 | Three-level hierarchy: Platform → Organization (dealer group) → Store (rooftop); every business row carries `tenant_id` (org) + `store_id` (ADR-007) | P0 | Missing |
| FR-TEN-002 | Postgres RLS ENABLED AND FORCED on all tenant tables; `SET LOCAL app.tenant_id/app.user_id/app.store_ids` per transaction; `USING(true)` policies banned | P0 | Missing (all ~140 current policies are `USING(true)`) |
| FR-TEN-003 | Memberships model `(user_id, org_id, store_id, roles[])` — one person, multiple stores/orgs, additive roles | P0 | Missing (single nullable `users.store_id` today) |
| FR-TEN-004 | Store configuration record: `province`, tax config, `twilio_number`, `bill_of_sale_system` ('cams'\|'merlin'), `esign_platform` ('onespan'\|'docusign'), `submission_platforms[]`, `available_fi_products[]`, `business_hours` JSONB (default Mon–Fri 09:00–20:00, Sat 09:00–17:00, Sun closed), `holiday_dates[]`, `alert_thresholds` JSONB (aging 30 d, safety 3 d, funding 7 d, rotting 7 d, no-photos 48 h, recon $2,000) | P0 | Partial (stores table exists with most columns; scoping middleware never executes) |
| FR-TEN-005 | Tenant context derived only from the verified session — never from a client-supplied header | P0 | Missing (current middleware spoofable) |
| FR-TEN-006 | Cross-store inventory visibility with cost-field masking (acquisition/transport/recon/total_invested/margin hidden outside own store; owner sees all) — app-level column masking, not RLS | P1 | Missing |
| FR-TEN-007 | Internal wholesale store-to-store: selling store's unit marked `wholesale` with `sold_to_store_id` + `internal_wholesale_price`; buying store gets a new inventory record with `acquisition_type='internal_wholesale'` at that cost | P2 | Missing |
| FR-TEN-008 | Cross-tenant reads (AI network routing, platform admin) only via audited service-role functions | P1 | Missing |
| FR-TEN-009 | Tenant onboarding flow: create org, stores, branding, seed roles/users, Stripe subscription (Target) | P2 | Missing |
| FR-TEN-010 | Clean-start launch (decided 2026-07-23): **no legacy data migration** — all legacy tracker data is test data; production opens with an empty database + seed/reference config, and Kia ML onboards as tenant #1 (org = Hassan Group with its three stores) through standard provisioning + tenant data entry; the legacy app is kept as a business-rules reference only | P0 | Missing |

## 2. Authentication & RBAC (FR-AUTH)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-AUTH-001 | Better Auth 1.3+ self-hosted with organization plugin; email/password; sessions with rotating refresh; HTTPS-only `Secure`/`HttpOnly`/`SameSite=Lax` cookies (ADR-006) | P0 | Missing (localStorage session; forgeable login blob; passwordless legacy `POST /users/login` auto-creates accounts) |
| FR-AUTH-002 | Every API route authenticated except health + auth endpoints; explicit public allowlist | P0 | Missing (only 2 of ~150 endpoints protected) |
| FR-AUTH-003 | 10 platform roles: owner, gm, sales_manager, used_car_manager, fi_manager, salesperson, wholesale_manager, logistics, admin_office, bdc_agent; multi-role additive | P0 | Partial (roles stored, almost never enforced — all roles see same 23-item menu) |
| FR-AUTH-004 | Permission matrix enforced server-side (e.g., override checklist = owner/gm/sales_manager/fi_manager only; confirm payments = owner/gm/admin_office only; submit to lenders = owner/gm/fi_manager only; manage automation rules = owner/gm only) | P0 | Missing |
| FR-AUTH-005 | Row-level visibility: owner all stores; store roles own store; salesperson own deals only with sale-price-only financials; fi_manager sees financials but not others' commissions | P0 | Missing |
| FR-AUTH-006 | MFA (TOTP) required for owner/gm/admin_office; optional others | P0 | Missing |
| FR-AUTH-007 | Account creation by admin invitation only (no self-registration); password reset by email | P0 | Partial |
| FR-AUTH-008 | Per-tenant session revocation; permission changes effective immediately (DB-backed sessions) | P1 | Missing |
| FR-AUTH-009 | Auth brute-force limiting: 5 attempts / 15 min / IP | P0 | Missing |
| FR-AUTH-010 | Enterprise SSO: Better Auth SAML/OIDC package; WorkOS ($125/connection) fallback (Target) | P3 | Missing |

## 3. Contacts / CRM (FR-CON)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-CON-001 | Contact records: names, email, phones, address, DOB, licence, employer, income range, `preferred_language` (default 'fr'), `preferred_contact` (default 'text'), tags, source, `referred_by_contact_id`, lifetime deals/value | P1 | Built |
| FR-CON-002 | PIPEDA consent fields: `consent_marketing` NOT NULL default false + `consent_marketing_at` | P0 | Built (schema); enforcement Missing |
| FR-CON-003 | Duplicate check on phone + email at create; find-duplicates and merge (`POST /merge {keep_id, merge_id}` — moves deals/leads/activity, keeps older `customer_since`) | P1 | Built |
| FR-CON-004 | Weighted full-text search vector (name A, email/phone B, city C) with GIN index | P1 | Built |
| FR-CON-005 | `deal_parties` (buyer/cosigner) authoritative; `deals.contact_id` denormalized primary buyer; auto-link/auto-create contact on deal creation (match by phone) | P1 | Built |
| FR-CON-006 | Three-column contact detail: properties (280px) / activity timeline / associated deals & vehicles (300px) | P2 | Partial (timeline renders empty — logger unwired) |
| FR-CON-007 | High-sensitivity PII (SIN, licence #, DOB, income, banking) field-level encrypted AES-256-GCM + KMS with blind HMAC lookup indexes (ADR-015) (Target) | P0 | Missing |

## 4. Lead Manager (FR-LEAD)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-LEAD-001 | Fluent Forms webhook intake — all 16 credit-prequal fields mapped (vehicle_interest, monthly_budget, employment, income, housing, DOB, split name, email, phone…); raw payload kept in `source_form_data` JSONB | P1 | Built |
| FR-LEAD-002 | Meta Lead Ads intake via Zapier — 6 fields incl. income-threshold boolean | P1 | Built |
| FR-LEAD-003 | Manual lead entry (calls, walk-ins, referrals) — name + phone only required | P1 | Built |
| FR-LEAD-004 | ADF/XML intake + inbound-email ADF parsing (AutoTrader.ca, Kijiji Autos) at per-tenant endpoints `/in/v1/leads/{tenantSlug}/{sourceKey}`; sub-100ms ACK; deterministic-ID dedupe; provider signature verification (ADR-005) (Target) | P1 | Missing |
| FR-LEAD-005 | Duplicate detection by phone at creation: flag `is_duplicate`/`duplicate_of`, merge or dismiss; auto-message the client to reconfirm interest; alert assigned salesperson if the client has an active deal | P1 | Built (detect/merge); auto-message Missing |
| FR-LEAD-006 | Lead statuses: new, chatbot_engaged, assigned, contacted, qualified, converted, unresponsive, nurture, expired, lost | P1 | Partial (subset in use) |
| FR-LEAD-007 | Central queue + weighted store distribution: leads land with `store_id=null`, assigned to the store furthest below its target % for that platform (Google and Meta tracked separately) from `lead_distribution_config` (spend, target %, actual %, month); running-tally algorithm, not random | P2 | Missing |
| FR-LEAD-008 | Distribution Dashboard (owner): per-platform per-store spend/target/actual/deviation, ad-spend update form, 3-month history | P2 | Missing |
| FR-LEAD-009 | Agent assignment cascade after AI handoff: (1) language match, (2) online (heartbeat ≤ 3 min), (3) scheduled now (`staff_schedules`), (4) fewest active leads under `max_active_leads` (default 10); no agent → escalate to sales manager | P1 | Partial (round-robin/load-balanced/source-based engines built; language/schedule cascade Missing) |
| FR-LEAD-010 | 10-minute reassignment: no contact logged in 10 min → remove from agent, log to `previous_agents[]` (reason `no_response`), reassign excluding previous agents, HIGH alert to sales manager; after 3 attempts → assign to sales manager | P1 | Missing (no scheduler exists) |
| FR-LEAD-011 | Lead scoring engine (12 operators, 20+ fields, cached scores) | P2 | Built |
| FR-LEAD-012 | Unresponsive flow: 3 contact attempts (immediate, +4 h, next day) → status `unresponsive` → 90-day nurture (`nurture_expires_at`); reply any time reactivates and re-enters assignment; expiry → `expired` | P2 | Missing (workflow definitions exist; nothing executes) |
| FR-LEAD-013 | Convert to deal: `POST /api/v1/leads/:id/convert` creates pre-filled deal, links `converted_deal_id` | P1 | Built |
| FR-LEAD-014 | Presence: agent heartbeat + auto-offline after 3 min — via Socket.IO connection state + heartbeats backed by Valkey (ADR-004, amended 2026-07-24) replacing 60 s polling (Target) | P1 | Partial (heartbeat fields exist) |
| FR-LEAD-015 | Staff schedules: weekly grid per user (`day_of_week`, start/end, active) feeding assignment | P2 | Partial |
| FR-LEAD-016 | Lead aging colors: < 5 min green, 5–15 min amber, > 15 min unassigned red + escalation alert | P2 | Partial |
| FR-LEAD-017 | Lead stats: conversion rate by source/store, avg `response_time_seconds` (creation → first human contact) by agent; dashboard stats bar (new today, assigned, unresponded, converted MTD, conversion rate) | P2 | Built (basic) |
| FR-LEAD-018 | Lead detail slide-out with source-specific layouts (Fluent = full financial profile; Meta = qualification only), full assignment timeline, actions: Assign/Reassign, Convert, Mark Lost (reason required), Start Nurture | P2 | Partial |
| FR-LEAD-019 | Configuration-driven lead connector framework (decided 2026-07-23): every intake source runs as a per-tenant connector config (JSON webhook, ADF/XML email, API polling) mapping into the canonical Lead envelope; all cataloged sources (Fluent, Meta, AutoTrader.ca, Kijiji Autos, CarGurus, Marketplace, OEM…) ship as connectors, and any new source is added by configuration, not code (Target) | P1 | Missing |

## 5. AI Conversation Engine (FR-AI)

All P1 items here follow module parity in sequencing (ADR-026) but are launch-defining for the ReadyLoans product.

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-AI-001 | SMS conversation agent on Claude Opus 4.8 (launch default — see FR-AI-019) via Messages API + tool runner (`lookup_inventory`, `check_agent_availability`, `book_appointment`, `create_or_update_lead`, `request_human`, `send_credit_app_link`) with Twilio transport (ADR-022) | P1 | Missing (stub stores inbound SMS, empty reply, no Twilio SDK) |
| FR-AI-002 | First-touch < 60 s from intake ACK, enqueued as a BullMQ Flow step (intake → normalize → consent → first-touch → extract → route → assign) (ADR-012) | P1 | Missing |
| FR-AI-003 | Language handling: auto-detect from first message; Quebec leads (area codes 438/514/450/819/873 or QC store) explicitly asked EN/FR preference; language locked, saved to lead, used for agent matching | P1 | Missing |
| FR-AI-004 | Conversation style rules: never robotic, ≤ 1 question per message, ≤ 160 chars where possible, 1–2 emojis max, never re-ask volunteered info, never discuss pricing/payments/rates/approval odds | P1 | Missing |
| FR-AI-005 | Required capture before handoff: full name, vehicle interest, monthly budget, trade-in y/n (+ details if yes); timeline/email nice-to-have; Fluent leads: never re-ask form data, acknowledge the application | P1 | Missing |
| FR-AI-006 | Structured extraction per turn with Claude Haiku 4.5 (launch default — FR-AI-019) (JSON schema, `additionalProperties:false`) writing back to the lead record | P1 | Missing |
| FR-AI-007 | Inventory search + MMS: ≤ 3 available matching vehicles, first photo each, description only — no pricing, no links | P1 | Missing |
| FR-AI-008 | Handoff triggers (each individually toggleable): human requested (NLP), all required fields collected, high buying intent (NLP), low confidence 2+ consecutive messages; max 15 messages before forced handoff | P1 | Missing |
| FR-AI-009 | Silent monitoring post-handoff: after each client message update the agent panel — sentiment (positive/neutral/frustrated/losing_interest), buying signals, concerns, suggested response, summary, score hot/warm/cold + reason — delivered realtime (Socket.IO tenant rooms, ADR-004) | P1 | Missing |
| FR-AI-010 | Agent messaging from CRM in the same SMS thread/number; HANDOFF divider; unread badges; conversation indicators on lead/deal cards | P1 | Missing |
| FR-AI-011 | Business-hours awareness: after-hours/weekend/holiday collection with "agent will reach out next business morning" expectation; per-store hours + holidays | P1 | Missing |
| FR-AI-012 | Inbound routing: find-or-create conversation by phone; `chatbot_active` → engine; `handed_off`/`agent_active` → monitor + notify agent; `drip_active` reply → reactivate lead; "STOP" → immediate opt-out | P1 | Missing |
| FR-AI-013 | Compliance engine (platform-level): per-lead consent ledger (express/implied, source, timestamp, 6/24-month CASL expiry), global STOP, CRTC quiet hours, DNCL scrub ≤ 31 days + internal DNC, ADAD express-consent gate before any automated outbound call, AI self-identification in first turn (FR+EN), full conversation audit log (ADR-022) | P0 | Missing |
| FR-AI-014 | Per-tenant prompt caching on frozen prefix (dealership config, compliance footer, inventory summary) — ~90% input-cost cut | P1 | Missing |
| FR-AI-015 | Cross-tenant network routing: route a lead to the best dealership in the network (deterministic rules + model-assisted scoring); financing-significant automated decisions get Law 25 s.12.1 disclosure + human review (Target) | P2 | Missing |
| FR-AI-016 | Voice agent: Twilio ConversationRelay ($0.07/min, BYO-Claude) sharing the SMS brain; recordings + transcripts in the same conversation; voicemail → brief message + follow-up SMS; use cases in order: first-contact call, cold re-engagement (24 h+ silent), pre-unresponsive last attempt | P2 | Missing (Phase 2) |
| FR-AI-017 | Chatbot settings (GM/owner): status toggle, hours/holiday editors, style knobs, required-field toggles, handoff-trigger toggles, photo limit | P2 | Missing |
| FR-AI-018 | Web-chat channel on the same conversation model (Target) | P3 | Missing |
| FR-AI-019 | Model-agnostic engine (decided 2026-07-23): per-task/per-tenant model choice is configuration selected by the built-in eval/A-B harness — candidate models (Claude Opus/Sonnet/Haiku, future releases) run the same golden/adversarial suites and the best quality-per-dollar per task wins the config slot; models swappable without code changes; the $0.50/conversation cost alert stands | P1 | Missing |
| FR-AI-020 | AI error assistant (decided 2026-07-23): on production errors, auto-report — Sentry issue webhook → BullMQ `ops-triage` job aggregates the scrubbed error + trace + recent releases (least-privilege, **read-only**) → AI produces plain-language description, probable cause, suggested fix, and affected tenants → files/updates an internal ops ticket (deduped by Sentry issue) surfaced in the **admin console ops inbox** with notification and a "was this helpful" feedback loop into the eval harness (FR-AI-019). Admin-facing only — end users keep generic error envelopes; no secrets/PII in prompts; **suggestions only, never auto-executed** (ADR-022 amended; observability.md §12) (Target) | P2 | Missing |
| FR-AI-021 | In-app AI guide for admins (decided 2026-07-23): "describe this screen / guide me" helper in the admin console — answers about screens, settings, and task flows generated from product docs + current route context, never from tenant business data; same model-agnostic layer and guardrails as FR-AI-020 (Target) | P2 | Missing |

## 6. Deal Pipeline (FR-PIPE)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-PIPE-001 | 10 stages: new, submitted, approved, signed, sourcing, pending_delivery, scheduled, delivered, complete, lost — single enum in `packages/schemas` (ADR-009) | P1 | Built |
| FR-PIPE-002 | Parallel funding track on every card: not_submitted → submitted → stips_required → funded (badge, not a stage) | P1 | Partial |
| FR-PIPE-003 | Complete requires BOTH `delivered_at` set AND `funding_status='funded'`; auto-move when both true; drag to Complete otherwise blocked with tooltip | P1 | Partial |
| FR-PIPE-004 | Stage skipping where inapplicable (in-stock: signed → pending_delivery); backward moves allowed by any user; any stage → lost | P1 | Built |
| FR-PIPE-005 | Lost requires a reason (9 canonical reasons + free-text detail); kanban drag-to-Lost opens reason selector first | P1 | Built (reasons exist) |
| FR-PIPE-006 | Lost → auto-enroll in lost-reason-specific nurture drip (see FR-COMM-004) | P2 | Missing |
| FR-PIPE-007 | `stage_entered_at` reset on every change; `deal_stage_history` timeline (from/to/who/when/note) on deal detail | P1 | Partial (columns exist; history/timeline unwired) |
| FR-PIPE-008 | Kanban (default) + sortable list toggle; Complete/Lost hidden by default; column headers show count + total $; filter bar: stage, salesperson, funding status, date range, sale type | P1 | Built |
| FR-PIPE-009 | Card: client, vehicle, price bold, salesperson avatar, days-in-stage rotting colors (green < 3 d / amber 3–7 d / red > 7 d), funding pill, sourced badge | P1 | Built (rotting partial) |
| FR-PIPE-010 | Stage-transition API validates rules (lost reason required; complete gate) and writes history atomically | P1 | Partial (no transactions) |
| FR-PIPE-011 | Superseded (decided 2026-07-23): with the clean-start launch (FR-TEN-010) there is no legacy status migration — `pipeline_stage` is native to the target schema; the `deal_status`/`finance_status`/`is_sold` mapping survives only as a business-rules reference | — | Superseded |

## 7. Finance Desk / Desking (FR-FIN)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-FIN-001 | Finance payment calculator: `net_trade = allowance − lien`; `amount_financed = price + F&I + tax + lender_fee − down − net_trade`; amortization `M = P·r(1+r)^n/((1+r)^n−1)`; `cost_of_borrowing = M·n − P` — implemented once in `packages/core` with golden-number tests | P0 | Built (logic exists; must be ported + tested) |
| FR-FIN-002 | Provincial tax: ON HST 13%; QC GST 5% + QST 9.975% on correct bases; per-product taxable flags; trade-in credit; Section 87 (Indian Status) exemption; manufacturer rebates applied **after** tax; BC/MB trade-in credit enabled; federal Luxury Tax > $100k (Target); effective-dated tax-rate tables server-side | P0 | Built with defects (rebates pre-tax; BC/MB disabled; luxury tax absent; blended-rate rounding) |
| FR-FIN-003 | Per-deal tax persisted as split integer-cent columns (`tax_gst_cents`, `tax_qst_cents`, `tax_pst_cents`, `tax_hst_cents`, `tax_total_cents`) written back from the desking engine (ADR-009) | P0 | Missing (desking never persists — blocks tax reports) |
| FR-FIN-004 | Deal types: finance (all stores), cash (no calculator), lease (franchise stores only — hidden for used-car stores) | P1 | Partial (finance/cash) |
| FR-FIN-005 | Lease calculator: residual = MSRP × residual %; payment = depreciation/term + (sale_price + residual) × money_factor; equivalent APR = MF × 2400 (display) | P2 | Missing |
| FR-FIN-006 | Scenario comparison up to 4 side-by-side (rates/terms 48/60/72/84/products/down), saved scenarios, best-payment/lowest-COB/highest-reserve highlights | P1 | Built |
| FR-FIN-007 | Lender submissions per deal: lender, platform (dealertrack/creditapp/routeone/manual), status (submitted/pending/approved/conditional/declined/expired), approval amount, buy_rate/sell_rate + rate_spread, term, payment, conditions + conditions_met, decline reason, expiry | P1 | Partial (static client-side lender list; no submissions table in use) |
| FR-FIN-008 | "Select This Approval": auto-updates deal selected_lender/amount/rates/term/payment; deselects others; conditional stays conditional until conditions met; fires lender.approved (MEDIUM) | P1 | Missing |
| FR-FIN-009 | Submission strategy guidance by credit tier: prime 1–2, near-prime 2–4, subprime 3–5, deep subprime 5+ | P3 | Missing |
| FR-FIN-010 | Per-store platform lists (`stores.submission_platforms`): used-car = DealerTrack + CreditApp; Kia = DealerTrack + RouteOne | P1 | Partial (column exists) |
| FR-FIN-011 | F&I product menu per store (`fi_product_catalog` + `stores.available_fi_products`): used-car = warranty + GAP; franchise = all 9 (warranty, gap, tire_rim, paint, fabric, theft, maintenance, loan_insurance, rust); `deal_fi_products` with cost, sell_price, profit, term, deductible, taxable; recalc `fi_products_total` on change | P1 | Partial |
| FR-FIN-012 | Profit analysis: `front_gross = sale_price − inventory.total_invested`; `fi_reserve = rate_spread × amount_financed`; `back_gross = reserve + Σ product profits`; `total_gross = front + back` | P1 | Partial |
| FR-FIN-013 | DealerTrack PDF import into desking | P2 | Built |
| FR-FIN-014 | Bill of Sale generation (QC/ON variants) as immutable, hashed, persisted snapshot at generation time; correct totals (no warranty double-count); no Ontario/OMVIC text on Quebec contracts; French-first for QC (ADR-021) | P0 | Built with critical defects (double-count; localStorage-only; OMVIC text on QC contracts) |
| FR-FIN-015 | Vehicle confirmation sign-off by F&I (who + when) before contract | P2 | Missing |

## 8. Funding Tracker (FR-FUND)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-FUND-001 | One `funding_record` per deal linked to the selected lender submission; statuses not_submitted → preparing → submitted → in_review → stips_required → funded (+ rejected) | P1 | Partial (status badge only) |
| FR-FUND-002 | Individual stips tracking (`stips` JSONB): name, status (pending/submitted/accepted/waived), file, notes, timestamps; catalog: proof of income/address/insurance, references, co-signer, larger down, inspection, fresh bureau | P1 | Missing |
| FR-FUND-003 | All stips accepted/waived → funded allowed; on funded: set `deal.funding_status='funded'`, update checklist funding item, record `funded_amount`, `funding_number`, `confirmation_method` (portal/email/phone), fire deal.funded (MEDIUM) | P1 | Missing |
| FR-FUND-004 | Funding aging: green < 3 d / amber 3–7 d / red > 7 d; submitted > 7 days with no update → MEDIUM alert F&I + GM (daily job) | P1 | Missing |

## 9. Pre-Delivery Checklist (FR-PDC)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-PDC-001 | 10 items with per-item status flows: insurance, void cheque, funding, IDV, safety inspection, vehicle ready, wet-ink file, delivery date, drivers booked, registration | P1 | Partial (4 items today: insurance, funded, safety, registration — tracked, not enforced) |
| FR-PDC-002 | Safety inspection is a HARD block (must be `passed`) with **no** override — legal requirement; exception `sold_as_is=true` removes it and requires the as-is waiver document + badge | P0 | Missing |
| FR-PDC-003 | Soft-block override: manager selects own name + required free-text reason; logged to `checklist_overrides` (who/when/why/items); MEDIUM alert to GM; history on deal + audit reports | P1 | Missing |
| FR-PDC-004 | Conditional hiding: cash deals hide void cheque/funding/IDV; as-is hides safety; non-ON/QC hides registration; hidden items excluded from completion % | P1 | Missing |
| FR-PDC-005 | Readiness endpoint returns `{ready, hard_blocks[], soft_blocks[], hidden_items[]}` with the exact block logic from the spec; Schedule Delivery button disabled/warned accordingly | P1 | Missing |
| FR-PDC-006 | IDV via CreditApp: send (phone/email), statuses not_sent/sent/completed/failed, attempts counter, failure notes; manual status update now, CreditApp Open API later (Target) | P1 | Missing |
| FR-PDC-007 | Insurance verify: received (doc uploaded) vs verified (active, right vehicle, effective date ≤ delivery date); warn if effective date after delivery date | P1 | Partial |
| FR-PDC-008 | Stale-checklist alert: deal approved but items unchanged 48 h → alert salesperson | P2 | Missing |
| FR-PDC-009 | 22-item PDI template usable per deal (Target — seeded but unused today) | P2 | Partial |

## 10. Delivery Tracker (FR-DEL)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-DEL-001 | Delivery-photo email ingestion (Resend Inbound webhook; IMAP 2-min cron fallback): parse stock number (alphanumeric 4–10 chars) from subject, match `deals.stock_number`, store attachments, update `delivery_photos_status` (complete at 2+ photos) | P1 | Missing |
| FR-DEL-002 | 2 required photos: client with vehicle + client ID; per-photo type tracking | P1 | Missing |
| FR-DEL-003 | Unmatched photos → review queue; admin manual assignment; MEDIUM alert Admin + Logistics | P1 | Missing |
| FR-DEL-004 | Multi-method payment tracking per deal (`deal_payments`): e_transfer_before / e_transfer_at_delivery / cash / bank_draft; status Expected → Received → Confirmed → Deposited with proof files, confirmation numbers, deposit reference | P1 | Missing |
| FR-DEL-005 | Payment summary: `payment_complete = total_confirmed ≥ total_down_payment`; `outstanding = total_down_payment − total_confirmed`; recalc on confirm; amounts in integer cents | P1 | Missing |
| FR-DEL-006 | Cash mismatch (counted ≠ expected) → HIGH alert Admin + GM; flagged for follow-up | P1 | Missing |
| FR-DEL-007 | Trade-in at delivery: 1 driver when trade-in present; received flags by driver; inspection at the lot by used-car manager; condition mismatch → MEDIUM alert salesperson + sales manager | P1 | Missing |
| FR-DEL-008 | Delivery confirmation with warnings (not hard blocks): photos/payments/trade-in outstanding → "Confirm Anyway" / "Wait"; on confirm auto-move Scheduled → Delivered + `delivered_at` | P1 | Partial |
| FR-DEL-009 | Failed delivery: reason list (no-show → stay Scheduled; refusal → possible Lost; vehicle issue → back to Pending delivery; wrong docs → reschedule); HIGH alert salesperson + sales manager + logistics | P1 | Missing |
| FR-DEL-010 | Post-delivery automation next business day at 10:00 (skip weekends): thank-you via client's preferred channel + drip enrollment; manual trigger fallback | P2 | Missing |
| FR-DEL-011 | Mobile driver view: delivery details, vehicle, cash to collect, wet-ink confirmation, photo upload, "Delivery Complete" | P2 | Missing |

## 11. Driver Dispatch (FR-DISP)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-DISP-001 | Fleet management: chaser vehicles + dealer plates CRUD; auto-assign with 4-hour conflict-detection window; atomic assignment | P1 | Built (atomicity Missing — no transactions) |
| FR-DISP-002 | Driver companies directory (`driver_companies`: store_id null = all stores, email required, service area, rate info) | P1 | Missing |
| FR-DISP-003 | Auto-email on booking (Resend): subject `Driver Request — {{year}} {{make}} {{model}} — {{delivery_date}}`; body with addresses, vehicle, drivers needed, trade-in, cash to collect, wet-ink status, instructions; resend button + sent indicator | P1 | Missing |
| FR-DISP-004 | Drivers-needed formula: no trade-in → 2 (chaser); trade-in → 1 | P1 | Missing |
| FR-DISP-005 | Dispatch blocked unless deal `wet_ink_file_status` ≥ 'prepared' | P1 | Missing |
| FR-DISP-006 | Status timeline: Booked → Confirmed → Picked Up → En Route → Delivered; `status_updates` JSONB with timestamps; driver-provided ETA text | P2 | Partial |
| FR-DISP-007 | GPS tracking / route optimization (Target, explicitly future) | P3 | Missing |

## 12. Inventory Command Center (FR-INV)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-INV-001 | Standalone `inventory` table — vehicles independent of deals; `deals.inventory_id` link; VIN unique, stock_number unique | P1 | Built |
| FR-INV-002 | VIN decode via a commercial Canadian-aware service (e.g., DataOne, chosen through a short accuracy evaluation — owner priority is maximum accuracy; NHTSA vPIC is the dev-only fallback — decided 2026-07-23) auto-populating year/make/model/trim/body/engine/drive/fuel/doors/country; review + manual fallback | P1 | Partial |
| FR-INV-003 | Acquisition types: auction, dealer_trade, trade_in (auto), internal_wholesale, consignment, in_stock; acquisition date/cost | P1 | Built (subset) |
| FR-INV-004 | Trade-in received on a deal → auto-create inventory record (cost = trade allowance, `source_deal_id`, `location_status='on_lot'`) | P1 | Missing |
| FR-INV-005 | Cost basis: `total_invested = acquisition + transport + recon` (computed at query time — no volatile generated columns, ADR-009); `days_in_stock` computed likewise | P1 | Built (as generated columns — must move to views) |
| FR-INV-006 | Photos: 6 required angles (front, back, driver, passenger, interior, odometer) + optional; `photo_complete` only at 6/6; per-angle flags; drag-drop upload; > 48 h on lot with < 6 photos → alert (S5) | P1 | Partial |
| FR-INV-007 | Recon: inspection checklist (mechanical/body/interior/tires/safety items, condition good/needs_work/urgent); recon estimate > $2,000 (store threshold) requires GM approval before WO; recon status flow not_needed → … → complete | P1 | Partial |
| FR-INV-008 | Location statuses: at_source / in_transit / on_lot / at_garage / delivered / wholesale (+ ready); deal_status: available / reserved / sold_pending / delivered / wholesale | P1 | Built (subset) |
| FR-INV-009 | Views: Pipeline kanban by location (drag-drop), Grid, Table, Aging; stats bar; filters incl. store, days-in-stock slider, photo status | P1 | Partial |
| FR-INV-010 | Aging colors green < 30 / amber 30–60 / red > 60 days; aging alerts at 30 d (notify) and 60 d (auto-flag wholesale) | P1 | Built (colors) / Missing (alerts) |
| FR-INV-011 | Detail slide-out: gallery with per-angle slots, financials (masked cross-store), status tracker, linked deal, actions (Send to Garage, Flag for Wholesale, Link to Deal, Transfer to Store), timeline | P1 | Partial |
| FR-INV-012 | Sourced units: seller info, payment proof (wire/e-transfer/cc), bill-of-sale received, pickup booking | P1 | Built |

## 13. Garage / Work Orders (FR-GAR)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-GAR-001 | Garage profiles per store: services[], `does_ontario_safety`, `does_quebec_safety`, `is_internal` (Kia's own garage — QC only, never ON safety), `standard_rates` JSONB, avg turnaround | P1 | Partial (API exists, no UI) |
| FR-GAR-002 | WO types: safety_inspection, mechanical, body_work, detailing, general_maintenance; WO number `WO-YYYY-NNNN` sequential per year | P1 | Partial |
| FR-GAR-003 | Status flow Draft → Sent → Received → In Progress → Completed → Invoiced (+ cancelled; safety adds passed/failed); Sent auto-emails garage via Resend with the full vehicle block | P1 | Missing (email) |
| FR-GAR-004 | Province filtering on safety WOs: ON vehicles → only `does_ontario_safety` garages; QC → only `does_quebec_safety` | P1 | Missing |
| FR-GAR-005 | Safety completion cascades: passed → inventory `safety_status='passed'` + linked deal checklist passed; failed → inventory failed + notes, checklist stays blocking, alert used-car manager | P1 | Missing |
| FR-GAR-006 | Recon cascades: WO completion marks matching recon items complete; all recon WOs done → `recon_status='complete'`; invoiced `actual_cost` rolls into `inventory.recon_cost` → `total_invested` | P1 | Missing |
| FR-GAR-007 | Transport by lot staff: to/from garage fields; WO sent → location `at_garage`; pickup → `on_lot` | P2 | Missing |
| FR-GAR-008 | Garage queue view with days-at-garage colors (green < 3 / amber 3–5 / red > 5); safety overdue alert at 3 days (S2 cron) | P1 | Missing |
| FR-GAR-009 | Cost auto-estimate from garage `standard_rates` per service, user-overridable | P2 | Missing |

## 14. Wholesale Manager (FR-WHL)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-WHL-001 | `wholesale_listings`: flag reason (aging/overstock/damage/low_demand/manual), platform (traderev/acv/eblock/direct), asking price, offers JSONB with per-offer status, auto-computed `best_offer`, snapshot `total_invested` at flag time, `wholesale_loss = total_invested − sold_amount` | P2 | Missing (only a `sale_type` field exists) |
| FR-WHL-002 | Auto-flag: 30 days → notify wholesale mgr + GM; 60 days → auto-flag for review (daily job, skip already-flagged); manual flag anytime | P2 | Missing |
| FR-WHL-003 | Multi-platform simultaneous listing; sold → `inventory.deal_status='wholesale'`; loss into reporting | P2 | Missing |
| FR-WHL-004 | Dashboard sorted by days in stock; row colors amber > 45 d / red > 60 d; offer management slide-out | P2 | Missing |

## 15. Document Manager (FR-DOC)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-DOC-001 | 13-document catalog with conditional generation at "Signed" stage: base (bill_of_sale, privacy_consent, vehicle_condition, odometer_statement) + bank_contract (financed), omvic_disclosure (ON only), one agreement per F&I product, trade_in_lien_authorization (lien), as_is_waiver (as-is), carfax_report (used, unsigned), lease_agreement (lease/franchise) | P1 | Missing (stub) |
| FR-DOC-002 | `source_system` per store: bill of sale from CAMS (Ready Group) / Merlin (Kia); e-sign platform per store (OneSpan/DocuSign), envelope IDs tracked manually (no API) | P1 | Missing |
| FR-DOC-003 | Lifecycle: not_ready → generated → e_signed → printed → in_file → signed (at delivery) → filed; unsigned docs skip e-sign steps | P1 | Missing |
| FR-DOC-004 | F&I product add/remove syncs agreement documents | P2 | Missing |
| FR-DOC-005 | Wet-ink workflow: all `requires_signature` docs printed → deal `wet_ink_status='prepared'`; printable per-deal checklist; batch mark-printed / mark-filed; bulk signed-upload with type matching | P1 | Missing |
| FR-DOC-006 | Signed-document storage (Amazon S3, private document bucket class, presigned URLs — ADR-013) + search by deal #, client, stock #, VIN, type | P1 | Partial (insurance/funding uploads only; legacy bucket currently anon-writable — must be closed) |
| FR-DOC-007 | PDF generation via React → HTML → headless Chromium in sandboxed workers; ExcelJS retained; immutable branded bilingual snapshots with hashes (ADR-021) | P0 | Missing (PDFKit inline today) |
| FR-DOC-008 | Scanner/email auto-ingest + OCR type detection (Target, future phase) | P3 | Missing |

## 16. Notifications & Automation (FR-NOT)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-NOT-001 | Urgency tiers: LOW = in-app; MEDIUM = + email; HIGH = + SMS; per-user `notification_preferences` JSONB + `sms_enabled` respected | P1 | Missing (bell is static) |
| FR-NOT-002 | 20 pre-seeded alerts (5 HIGH incl. handoff failed, payment mismatch, delivery failed; 10 MEDIUM incl. safety/funding overdue, aging 30 d, override used; 5 LOW) with exact recipient targets | P1 | Missing |
| FR-NOT-003 | Automation engine: `fireEvent(eventType, eventData, storeId)` over 22 event types; rules = trigger + conditions JSONB + actions + recipients (deal.salesperson, deal.fi_agent, role.* at deal's store, role.owner); template variables ({{client_name}} etc.); GM/owner rule manager UI | P1 | Missing (CRUD without evaluator) |
| FR-NOT-004 | Scheduled checks as BullMQ repeatable jobs (ADR-012): S1 aging (daily 8:00, deduped per vehicle/threshold), S2 safety overdue, S3 funding overdue, S4 deal rotting, S5 photo compliance, S6 post-delivery (10:00) | P1 | Missing (no scheduler at all) |
| FR-NOT-005 | Escalation: HIGH unacknowledged 10 min → sales manager, 30 min → GM; task overdue 60 min → sales manager; checker every 5 min | P2 | Missing |
| FR-NOT-006 | In-app delivery: bell + unread badge, 20 most recent, urgency stripes, deep links, mark-all-read, realtime (Socket.IO tenant rooms, ADR-004); toasts bottom-right MEDIUM+ only, 5 s auto-dismiss | P1 | Partial (UI shell) |
| FR-NOT-007 | Staff SMS: HIGH only, tenant-branded prefix (not hardcoded "[KIA TRACKER]" — ADR-018), ≤ 160 chars, deep link | P1 | Missing |
| FR-NOT-008 | Per-store configurable thresholds (`stores.alert_thresholds`) editable by GM | P1 | Partial (column exists) |

## 17. Reporting & Analytics (FR-REP)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-REP-001 | 4 core reports (Sales Performance, Commissions, Financial Summary, Inventory Pipeline) with PDF + Excel export | P1 | Built (export path moves to workers, ADR-021) |
| FR-REP-002 | Win/loss, source ROI, leaderboard reports | P2 | Built |
| FR-REP-003 | GM Command Center default view for GM/Owner: stats row (pipeline by stage, gross MTD, units, avg front/back gross, funding pipeline, inventory, aging, leads, conversion), 6 charts, attention tables (rotting > 7 d, overdue funding, incomplete checklists), today's deliveries, recent activity | P1 | Missing |
| FR-REP-004 | Per-unit P&L: revenue (sale + F&I products + reserve) − cost (acquisition + transport + recon) − expenses (commission + pack) = net; on every deal + inventory record | P1 | Partial (accounting P&L tabs exist) |
| FR-REP-005 | Scheduled reports via jobs + Resend: daily sales 19:00, weekly Monday 8:00 (PDF), monthly P&L 1st (Excel), inventory aging Monday 8:00; per-store recipients config | P2 | Missing |
| FR-REP-006 | All aggregation SQL-side with mandatory pagination (fixes the 1000-row truncation defect) | P0 | Missing |
| FR-REP-007 | Reports respect role visibility (salesperson = own only; admin/BDC = none) and tenant scoping | P0 | Missing |

## 18. Accounting & Expenses (FR-ACC)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-ACC-001 | Suppliers directory + 17 seeded expense categories with `is_cogs` flag | P1 | Built |
| FR-ACC-002 | Expenses attach to inventory and/or deals, rolled up via `stock_number` (trigger-filled); `amount_cents` + `tax_cents` + generated `total_cents`; statuses pending → approved → paid (+ rejected, void); anyone adds, managers approve; DELETE soft-voids | P1 | Built (best-designed module — port as-is) |
| FR-ACC-003 | Receipt upload to `expense-receipts` bucket (private + signed URLs — Target; policy undecided today) | P1 | Built (bucket policy open question) |
| FR-ACC-004 | `vehicle_expense_summary` view (approved + paid only); cost strip on inventory detail (Purchase/Transport/Recon/Added/Total) | P1 | Built |
| FR-ACC-005 | Accounting tabs: Reconciliation, P&L by Vehicle, Vendor Spend, Aged Inventory, P&L Journal, Commissions, Purchase Journal; CSV export | P1 | Built (commissions tab joins on free-text name — must use FK) |
| FR-ACC-006 | Tax collection reports (GST/HST/PST/QST) over date range with detail ledger — depends on FR-FIN-003 write-back | P1 | Missing (blocked) |
| FR-ACC-007 | Sold Vehicles Journal, OMVIC fee register (`omvic_fee_cents`), F&I manager commissions, PDF/Excel for all tabs, purchase-by-finance-type groupings | P2 | Missing |
| FR-ACC-008 | Tier-2 report suite (AR aging, buyer reports, Section 87 transaction reports, inventory turnover, catalogues…) and Tier-3 modules (lease contracts, parts & service, loans/investors, rental, payroll, Equifax) (Target) | P3 | Missing |

## 19. Commissions (FR-COM)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-COM-001 | Individual pay plans: rate (5%–35%, NUMERIC(5,4)), pad (default $1,500 = 150,000 cents), tiers (e.g., 30% if monthly gross > $60k else 25%), supervisor overrides (+5% to the supervisor) — the 12 real plans re-entered at tenant onboarding (clean-start launch, no data migration — decided 2026-07-23; legacy plans serve as the business-rules reference) | P0 | Built (data real; engine defective) |
| FR-COM-002 | Calculation rules in `packages/core`: integer cents only; **pad subtracted before rate**; tier check across ALL the salesperson's deals in the period (no row caps); override paid to the supervisor; clawback status checked before payout; ≥ 90% test coverage | P0 | Built with defects ($15-vs-$1,500 pad; inverted overrides; truncation) |
| FR-COM-003 | Auto-calculation on fund/complete; recomputation only with an audit trail (activity event with old/new values), never silent | P0 | Built with defect (silent overwrite at current rate) |
| FR-COM-004 | Clawback: flag by owner/gm/fi_manager; reverses the commission amount (not $0), records reason/amount/who/when; notifies salesperson + GM; statuses active/clawed_back/adjusted | P1 | Partial ($0-clawback bug; never reverses) |
| FR-COM-005 | Commission reporting by salesperson via FK (`salesperson_id`), never name matching (ADR-009) | P0 | Missing |

## 20. Tasks, Activity & Search (FR-TASK)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-TASK-001 | Tasks: types (call/email/text/meeting/follow_up/document/other), priorities, due dates (future-only on create), reminders, recurrence (daily/weekly/monthly, auto-next on complete), entity links | P1 | Built |
| FR-TASK-002 | Overdue sweep every 15 min → status overdue + notify assignee; dashboard sections Overdue/Due Today/Upcoming | P1 | Missing (no scheduler) |
| FR-TASK-003 | Activity events: append-only, tenant-scoped, ~28 enumerated event types, metadata JSONB diffs (changed fields only), logged from every mutating route (ADR-009) | P0 | Partial (schema + logger exist; called by nothing) |
| FR-TASK-004 | Ctrl/Cmd+K global search: contacts + deals (+ inventory Target), 5/type, 20 max, partial matching (phone last-4, VIN last-6, stock prefix), recent searches | P1 | Built |
| FR-TASK-005 | Bulk operations: bulk stage move (validated transitions), bulk assign, bulk task complete; per-item success/failure results; manager+ for cross-user ops; transactional with activity logs | P2 | Built (bulk works; transactions Missing) |

## 21. Appointments (FR-APP)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-APP-001 | Appointment booking with double-booking and vehicle-conflict checks | P1 | Built |
| FR-APP-002 | AI tool `book_appointment` creates appointments from conversations (Target, ADR-022) | P1 | Missing |

## 22. Communications & Drips (FR-COMM)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-COMM-001 | All sends through BullMQ queues — no provider SDK calls in request handlers (ADR-020); per-store Twilio numbers; per-tenant Resend sending domains/DKIM as tenants mature | P0 | Missing (2 inline Resend templates today) |
| FR-COMM-002 | Message templates with merge fields ({{first_name}}, {{vehicle}}, {{store_name}}…) rendered and actually sent (SMS/email) | P1 | Partial (rendering exists; no sending channel) |
| FR-COMM-003 | Drip sequences (`drip_sequences` + `drip_enrollments`): post-delivery cadence Day 1/7/30/90/180/ongoing; hourly step executor; statuses active/paused/completed/opted_out/expired/reactivated | P2 | Partial (design + enroll; nothing executes) |
| FR-COMM-004 | Lost-lead drips by reason (couldn't approve → 6 mo; payment too high → 3 mo + price-drop trigger; ghosted → 7/14/30 then monthly, 90 d; other-dealer / changed-mind → 90 d) | P2 | Missing |
| FR-COMM-005 | STOP → immediate global opt-out (legal); positive drip reply → reactivate + re-enter assignment; new deal → drip stops | P0 | Missing |
| FR-COMM-006 | CRTC quiet hours enforced in the send layer platform-wide: 9:00–21:30 weekdays, 10:00–18:00 weekends, recipient-local (ADR-020) | P0 | Missing |
| FR-COMM-007 | Client contact only through the conversation layer — the notification engine never messages clients directly | P1 | Missing |
| FR-COMM-008 | React Email tenant-branded transactional templates; server-side i18n (FR/EN by recipient language) | P1 | Missing |

## 23. White-Label & Branding (FR-WL)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-WL-001 | `tenant_branding` record: logos (+ dark, favicon, email), OKLCH primary/accent/semantic colors, font (self-hosted WOFF2), radius/density, legal name, support contacts | P1 | Missing |
| FR-WL-002 | Resolution custom domain → subdomain (`{dealer}.readyloans.app`) → login org; CSS variables injected pre-first-paint; cached; neutral skeleton fallback (ADR-018) | P1 | Missing |
| FR-WL-003 | Per-tenant custom domains with automatic DNS-validated ACM certs on CloudFront (ADR-014) | P2 | Missing |
| FR-WL-004 | Derived dark palettes (OKLCH transforms) + manual override; WCAG AA auto-validation with foreground auto-adjust | P1 | Missing |
| FR-WL-005 | Server-side branding parity: emails, PDFs, SMS sender ID, AI persona name all tenant-parameterized; hardcoded Kia branding = release blocker | P0 | Missing |

## 24. Billing & Entitlements (FR-BILL)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-BILL-001 | Stripe Billing: per-rooftop subscription tiers ($300–$800/mo), 14-day trial, customer portal (ADR-024) | P2 | Missing |
| FR-BILL-002 | Usage meters: AI voice minutes, SMS segments, AI conversations (Stripe Meters) | P2 | Missing |
| FR-BILL-003 | Stripe Tax for GST/QST/HST on invoices | P2 | Missing |
| FR-BILL-004 | Entitlements (seats, stores, AI quotas, flags) derived from subscription, cached on tenant, driving rate limits (ADR-011) | P2 | Missing |
| FR-BILL-005 | Dunning → grace → read-only; never data deletion | P2 | Missing |
| FR-BILL-006 | Admin-managed pricing (decided 2026-07-23): plans, prices, and entitlement bundles are **data managed from the admin console** — tiers created/edited, per-tenant overrides and quotas set, and Stripe products/prices synced without a code deploy (pricing is data, not code) | P2 | Missing |

## 25. Internationalization (FR-I18N)

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-I18N-001 | react-i18next + i18next-icu; EN/FR full coverage; detector order user profile → tenant default → browser; `fr-CA` default for Quebec tenants (ADR-019) | P0 | Partial (944/944 key parity is genuinely good; default is EN; desking/leads/accounting screens leak hardcoded English) |
| FR-I18N-002 | CI gate: EN↔FR key parity — missing key fails the build | P0 | Missing |
| FR-I18N-003 | Server-side i18n for emails, PDFs, SMS, AI scripts; contracts of adhesion French-first | P0 | Missing |
| FR-I18N-004 | `Intl` formatting per locale (fr-CA `1 234,56 $`); UTC storage, tenant-timezone render | P1 | Partial |

## 26. Platform Operations & Deployment (FR-OPS)

Ops-facing requirements on the platform itself (decided 2026-07-23; ADR-023 amended — the legacy tracker has no CI/CD at all, so everything here is Target).

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-OPS-001 | Blue-green service deployments with instant revert: ECS blue/green via CodeDeploy — two ALB target groups per routed service (`api`, `intake`), health-gated green task set, canary/linear traffic shifting, **automatic rollback on CloudWatch alarms** (traffic snaps back to blue in seconds; blue retained ≥ 1 h post-cutover); `workers` (no ALB target) rolls back by previous-revision redeploy (ci-cd.md §7–8) | P1 | Missing |
| FR-OPS-002 | SPA versioned releases with instant rollback: every build uploaded to an immutable per-SHA S3 prefix; the active release is a pointer served via CloudFront; **rollback = pointer flip + invalidation** — instant, no rebuild; releases retained ≥ 30 days (ci-cd.md §7) | P1 | Missing |
| FR-OPS-003 | Deploy/rollback safety invariant: migration gating unchanged under blue-green — expand-and-contract guarantees the outgoing and incoming versions both run correctly on the same schema while serving simultaneously; app rollback never requires schema rollback (ci-cd.md §6) | P0 | Missing |

---

## Requirement Counts by Status (summary)

| Status | Count | Reading |
|---|---|---|
| Built (incl. built-with-defects) | ~40 | The harvestable asset — port to `packages/core`/new stack with tests (ADR-026) |
| Partial | ~35 | Mostly "schema + CRUD, no engine/UI" — finish on the new foundation, not the legacy app |
| Missing | ~105 | Dominated by: everything time/event-driven (no scheduler exists today), the AI layer, tenancy/white-label/billing, and enforcement (RBAC, checklist gates, compliance) |
