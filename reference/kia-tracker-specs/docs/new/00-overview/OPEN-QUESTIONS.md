# ReadyLoans — Open Questions for the Owner

This document collects every material assumption made across the ReadyLoans documentation set that requires the owner's (Hassan's) confirmation, each with the context, the options, and **our recommended default**. Per [ROADMAP.md](./ROADMAP.md) §9, an unanswered question does not stall the build: the recommended default is adopted and the decision logged; answering later than the "needed by" phase may force rework. Architecture-level choices are *not* re-opened here — those are settled in [ARCHITECTURE-DECISIONS.md](./ARCHITECTURE-DECISIONS.md) (ADR-001…026); this list covers commercial, provider, budget, migration, and business-rule decisions that only the owner can make.

> **Status update (2026-07-23):** the owner has ruled on every question below. Each section now carries a **Decision** note and the summary table a status column. The only items still open are the five client inputs collected in [CLIENT-QUESTIONS.md](./CLIENT-QUESTIONS.md) and the deferred legal review (Q-24), which remains a **mandatory pre-launch task**. The client's five remaining answers are **deferred by the owner to just before the affected configuration is needed** — building proceeds meanwhile on the documented defaults.
>
> **Update (2026-07-24):** the owner switched the database platform from Supabase to **Amazon RDS for PostgreSQL 16** in `ca-central-1` (VPC-private, single-vendor AWS — ADR-008 amended, with knock-on amendments to ADR-004/013/014/015/023). The Q-08 cost table below is restated accordingly: the Supabase line is replaced by RDS + S3 lines and the approved envelope becomes **~US$750–$1,100/mo** at production launch (build-phase ramp unchanged). No other question is affected.

## Table of Contents

1. [Decision Summary Table](#1-decision-summary-table)
2. [Commercial & Pricing](#2-commercial--pricing)
3. [Lead Providers & Integrations](#3-lead-providers--integrations)
4. [Telephony & AI Services](#4-telephony--ai-services)
5. [Budget Approvals](#5-budget-approvals)
6. [Data Migration & Cutover](#6-data-migration--cutover)
7. [Hosting](#7-hosting)
8. [Business Rules to Confirm](#8-business-rules-to-confirm)
9. [Legal & Compliance Checkpoints](#9-legal--compliance-checkpoints)

---

## 1. Decision Summary Table

| ID | Question | Recommended default | Needed by | Status (2026-07-23) |
|---|---|---|---|---|
| Q-01 | Tenant pricing tiers & metering | 3 tiers $300/$500/$800 per rooftop + metered AI usage | Phase 2 | ✅ Decided 2026-07-23 — tiers approved; plans/prices/entitlements fully manageable from the admin console (pricing is data, not code) |
| Q-02 | Do internal stores pay? | Comped internal plan, full metering recorded | Phase 2 | ✅ Decided 2026-07-23 — internal stores never pay (project owners; they cover infra); comped plan + full metering stands |
| Q-03 | Which lead providers first? | Website forms + Meta Lead Ads → AutoTrader.ca ADF → Kijiji Autos ADF | Phase 3 | ✅ Decided 2026-07-23 — ALL listed sources + generic connector framework; volumes pending client ([CLIENT-QUESTIONS.md](./CLIENT-QUESTIONS.md) Q2) |
| Q-04 | Telephony provider | Twilio (Messaging + ConversationRelay); Telnyx as tested alternate | Phase 3 | ✅ Decided 2026-07-23 — Twilio |
| Q-05 | SMS/voice number strategy | One local number per store, provisioned via Twilio | Phase 3 | ✅ Decided 2026-07-23 — one local number per store |
| Q-06 | AI conversation model & cost ceiling | Claude Opus 4.8 w/ prompt caching; Sonnet 5 fallback if per-lead cost > $0.50 | Phase 3 | ✅ Decided 2026-07-23 — changed: model-agnostic layer + eval/A-B harness, best quality-per-dollar per task; $0.50 alert stands |
| Q-07 | Voice minutes budget/cap | $0.15/min all-in planning figure; 500 min/store/mo soft cap | Phase 4 | ✅ Decided 2026-07-23 — careful per-store/per-plan caps, 80% warning, graceful human handoff; defaults stand |
| Q-08 | Monthly infra budget envelope | ~$650–$1,000/mo pre-revenue, incl. AWS budget line $180–230 (itemized §5) | Phase 0 | ✅ Decided 2026-07-23 — approved with ramp: minimal spend during build; full envelope only at production launch. Restated 2026-07-24 (DB → RDS): ~$750–$1,100/mo |
| Q-09 | Optional paid UI licences | Tailwind Plus $299: yes; AG Grid $999/dev: defer | Phase 1 | ✅ Decided 2026-07-23 — Tailwind Plus NOT purchased (the product is a system, not a landing page); professional UI via the free stack + Stitch design selection (ADR-017); AG Grid stays deferred |
| Q-10 | Data migration timing & scope | Full history; cutover at Phase 1 exit; legacy read-only after | Phase 1 | ✅ Decided 2026-07-23 — clean start: all existing data is test data; ALL migration work removed |
| Q-11 | Hosting platform | **ANSWERED — owner chose AWS `ca-central-1` (Montreal): full Canadian compute+data residency (ADR-014)** | Phase 0 — decided | ✅ Decided (previously recorded) — AWS `ca-central-1` |
| Q-12 | E-signature platform | OneSpan first (store schema default), DocuSign optional later | Phase 2 | ✅ Decided 2026-07-23 — OneSpan |
| Q-13 | Bill-of-sale system of record | Generate in ReadyLoans w/ immutable snapshots; confirm Merlin/CAMS role | Phase 1 | ❓ Pending client — Merlin/CAMS role ([CLIENT-QUESTIONS.md](./CLIENT-QUESTIONS.md) Q3) |
| Q-14 | Lender platforms (DealerTrack, Credit Up) | Manual tracking at parity; API integration Phase 5 | Phase 1 | ✅ Decided 2026-07-23 — manual tracking stays; APIs later as planned |
| Q-15 | Pipeline stage rules | 10 stages; backward moves allowed w/ reason; managers only for skip | Phase 1 | ✅ Decided 2026-07-23 — ratified as documented (per-store editable) |
| Q-16 | Delivery gate strictness | Hard block + gm/owner override, override logged | Phase 1 | ✅ Decided 2026-07-23 — ratified (hard block + logged override) |
| Q-17 | Alert thresholds | 60d aging / 14d safety / 7d funding / 48h photos / $2,000 recon (per-store) | Phase 1 | ✅ Decided 2026-07-23 — ratified (60d/14d/7d/48h/$2,000/7d, per-store editable) |
| Q-18 | Commission plans & F&I comp | Re-confirm all 12 plans at migration; F&I = role flag on membership | Phase 1 | ✅ Decided 2026-07-23 — ratified; clean DB (Q-10) ⇒ no historical corrections at all |
| Q-19 | Duplicate-lead policy | Match phone then email; flag + assisted merge (never auto-reject) | Phase 3 | ✅ Decided 2026-07-23 — ratified (phone→email, assisted merge) |
| Q-20 | Pre-delivery checklist items | 6 gating items + 2 scheduling checks (detail §8) | Phase 1 | ✅ Ratified 2026-07-23; ON-vs-QC differences + IDV banks pending client ([CLIENT-QUESTIONS.md](./CLIENT-QUESTIONS.md) Q4) |
| Q-21 | Photo requirements | 6 required angles, 48h SLA, salesperson uploads | Phase 1 | ✅ Decided 2026-07-23 — ratified (6 photos / 48h) |
| Q-22 | Wholesale rules | Flag at 60 days by GM/wholesale mgr; TradeRev + ACV first | Phase 2 | ✅ Ratified 2026-07-23; authority holders pending client ([CLIENT-QUESTIONS.md](./CLIENT-QUESTIONS.md) Q5) |
| Q-23 | VIN decode provider | NHTSA vPIC (free) now; DataOne if trim-level accuracy needed | Phase 1 | ✅ Decided 2026-07-23 — changed: commercial Canadian-aware service (e.g., DataOne) via accuracy eval; vPIC dev-only fallback |
| Q-24 | Legal review budget & timing | Counsel review of consent copy + contracts before Phase 3 go-live | Phase 3 | ⏸ Deferred — parked by owner; MANDATORY pre-launch task before AI goes live to the public |
| Q-25 | Billing/brand entity | Confirm legal entity + "ReadyLoans" name for Stripe/domains | Phase 2 | 🔶 Partial — working name "ReadyLoans" stays; final name pending client ([CLIENT-QUESTIONS.md](./CLIENT-QUESTIONS.md) Q1); keep rebrandable |

---

## 2. Commercial & Pricing

### Q-01 — Tenant pricing tiers and metering

- **Context:** ADR-024 fixes the mechanism (Stripe Billing per rooftop + Stripe Meters + Stripe Tax) and the wedge ($300–$800/mo vs quote-only incumbents at $500–$2,500+; Numa entry ~$200–$400). The exact tier composition is a business call.
- **Options:** (a) single all-inclusive price; (b) tiered with metered AI; (c) pure usage-based.
- **Recommended default (b):** **Core $300/mo** (CRM/DMS, no AI), **Growth $500/mo** (AI SMS incl. 500 conversations, overage metered), **Scale $800/mo** (adds voice incl. 300 minutes, overage metered). 14-day trial. Pay-per-AI-booked-appointment added later as an upsell meter.
- **Needed by:** Phase 2 (Stripe products/prices are configuration, not code — but entitlement quotas bake into rate limits, ADR-011).
- **✅ Decision (2026-07-23):** tiers approved as recommended ($300/$500/$800 + metered AI). **New requirement:** plans, prices, and entitlements must be fully manageable from the platform admin console — create/edit/reprice plans, per-tenant overrides, grandfathering. Pricing is data, not code; Stripe products/prices are managed through the admin UI.

### Q-02 — Do the owner's own stores pay?

- **Context:** Kia ML, ReadyCar, and Riverside are tenants #1–#3. Charging them exercises the billing path; not charging them is simpler accounting.
- **Recommended default:** an internal comped plan ($0 price on the real tier) so metering, entitlements, invoices, and dunning logic run end-to-end without moving real money.
- **Needed by:** Phase 2.
- **✅ Decision (2026-07-23):** internal stores (Kia ML, ReadyCar, Riverside) never pay a subscription — they are the project owners (they paid for the software build) and they cover the infrastructure/hosting costs. The comped plan with full metering stands.

---

## 3. Lead Providers & Integrations

### Q-03 — Which lead providers to integrate first?

- **Context:** ADR-005 supports JSON webhooks + ADF/XML + ADF-by-email. The legacy system already receives Fluent Forms (website) and Meta lead forms — those ports are cheapest. AutoTrader.ca and Kijiji Autos (both ADF-by-email via Resend Inbound) are the highest-volume Canadian marketplaces.
- **Recommended default (order):** 1) website forms (Fluent Forms JSON — existing), 2) Meta Lead Ads (existing, add `X-Hub-Signature-256` verification), 3) AutoTrader.ca ADF email, 4) Kijiji Autos ADF email, 5) CarGurus, 6) OEM (Kia Canada) feed last — spec quality varies and it only serves one store.
- **Owner input needed:** actual ad accounts/provider contracts per store, and monthly lead volume per source (sizes queue/AI budgets).
- **Needed by:** Phase 3 start.
- **✅ Decision (2026-07-23) — expanded:** integrate **all** listed sources, and additionally build a **generic lead-source connector framework** so any new source can be added later via configuration (JSON-webhook, ADF/XML-email, and API-polling adapters). Per-source monthly volumes still pending the client — see [CLIENT-QUESTIONS.md](./CLIENT-QUESTIONS.md) Q2.

### Q-12 — E-signature platform

- **Context:** the legacy store schema defaults `esign_platform = 'onespan'`; the document-manager plan lists "OneSpan or DocuSign or both". Per-store choice is already modeled.
- **Recommended default:** **OneSpan** first (existing default, strong Canadian/Quebec presence, FR-language ceremonies), DocuSign as a second `esign_platform` value only when a tenant demands it. Wet-ink lifecycle tracking ships regardless.
- **Needed by:** Phase 2 (document-manager integration work).
- **✅ Decision (2026-07-23):** OneSpan, as recommended.

### Q-13 — Bill-of-sale system of record (Merlin/CAMS)

- **Context:** Kia ML legally transacts via **Merlin**, Ready Group via **CAMS**. ReadyLoans generates its own bilingual bill of sale with immutable snapshots (ADR-021). Unclear whether the in-app document *replaces* or *parallels* Merlin/CAMS output.
- **Recommended default:** ReadyLoans generates and archives the customer-facing bill of sale; Merlin/CAMS remain the registration/DMS submission channel, tracked as a document status (`source_system` cams|merlin) — not replaced in v1.
- **Needed by:** Phase 1 (documents module parity).
- **❓ Pending client (2026-07-23):** the Merlin/CAMS role must be confirmed by the client — see [CLIENT-QUESTIONS.md](./CLIENT-QUESTIONS.md) Q3. The recommended default stands in the meantime.

### Q-14 — Lender platform integration depth (DealerTrack, Credit Up)

- **Context:** F&I currently tracks submissions manually; DealerTrack PDF import exists in desking. Real submission APIs are gated partner programs with lead time.
- **Recommended default:** manual lender-submission tracking (statuses `submitted/pending/approved/conditional/declined`) at Phase 1 parity; begin DealerTrack API partner onboarding in Phase 3 so integration can land in Phase 5.
- **Needed by:** Phase 1 (data model is the same either way; only the transport differs).
- **✅ Decision (2026-07-23):** manual lender-submission tracking stays (consistent with the client's demo DMS); API integrations later as planned.

---

## 4. Telephony & AI Services

### Q-04 — Telephony provider

- **Context:** ADR-020 selects Twilio (Messaging + ConversationRelay $0.07/min BYO-Claude) with Telnyx documented as the alternate (lower measured latency: p95 118 ms vs 161 ms; cheaper components).
- **Recommended default:** **Twilio** — one vendor for SMS + voice + numbers, ConversationRelay keeps the single-brain architecture. Re-benchmark Telnyx in Phase 4 only if voice latency or cost misses targets.
- **Needed by:** Phase 3 (numbers + SMS), Phase 4 (voice).
- **✅ Decision (2026-07-23):** Twilio, as recommended.

### Q-05 — Number strategy

- **Context:** the store schema already has `twilio_number`; CASL requires accurate sender identification.
- **Recommended default:** one local-area-code number per store (819 for Kia ML, local codes for the ON stores); no shared/short-code numbers in v1; STOP handling global across all numbers.
- **Needed by:** Phase 3.
- **✅ Decision (2026-07-23):** one local number per store, as recommended.

### Q-06 — AI conversation model and per-lead cost ceiling

- **Context:** ADR-022 sets Opus 4.8 (`claude-opus-4-8`, $5/$25 per M tokens) for conversation and Haiku 4.5 ($1/$5) for extraction, with per-tenant prompt caching (~90% input savings). A typical 15-turn SMS qualification ≈ $0.10–$0.30 with caching; Sonnet 5 ($3/$15) is the cheaper conversation fallback.
- **Recommended default:** Opus 4.8 with caching; automatic alert if average cost/conversation exceeds **$0.50**, at which point Sonnet 5 is A/B-tested per tenant. Extraction stays on Haiku regardless.
- **Needed by:** Phase 3.
- **✅ Decision (2026-07-23) — changed from the default:** the model strategy must be **dynamic** — a model-agnostic AI layer with a built-in evaluation/A-B harness that tests candidate models (Claude Opus/Sonnet/Haiku and future models) and selects the best quality-per-dollar per task; models are swappable per tenant/task without code changes. The $0.50/conversation cost alert stands.

### Q-07 — Voice minutes budget and caps

- **Context:** ConversationRelay $0.07/min + Claude tokens ≈ **$0.10–$0.20/min all-in** (industry realistic range $0.05–$0.36).
- **Recommended default:** plan at $0.15/min; per-store soft cap 500 min/mo (≈$75) with in-console warning at 80% and hard cap at 2× until the owner raises it; caps map to plan entitlements (Q-01).
- **Needed by:** Phase 4.
- **✅ Decision (2026-07-23):** careful, logical rate limiting and caps on AI usage — per-store and per-plan caps, warning at 80%, graceful human handoff when capped. The current defaults stand until real usage data tunes them.

---

## 5. Budget Approvals

### Q-08 — Monthly infrastructure budget envelope

**Context:** the stack (ADR-008/010/014/024/025) implies these recurring services. Confirm the envelope; individual items are swappable.

| Service | Purpose (ADR) | Est. monthly cost |
|---|---|---|
| Amazon RDS for PostgreSQL 16 (`ca-central-1`) | Production database: Multi-AZ db.t4g.medium ~$103 + RDS Proxy ~$23 + gp3 Multi-AZ 50–100 GB ~$13–25 + backup overage ~$0–5 (ADR-008, amended 2026-07-24). Build phase: local Docker dev $0 + db.t4g.small Single-AZ staging ~$28–30. Cheaper launch option if load testing permits: Multi-AZ db.t4g.small line ~$90 | **~$140–170 at launch** (~$28–30 during build) |
| Amazon S3 + CloudFront (files/images) | Private buckets (per-tenant prefixes, SSE-KMS, presigned URLs), sharp-generated WebP/AVIF variants via CloudFront (ADR-013, amended 2026-07-24) | ~$1–5 at pilot |
| AWS `ca-central-1` — Fargate API 2×0.5 vCPU/1 GB ~$40, worker ~$20, intake ~$10; ALB ~$24; NAT gateway ~$39; ElastiCache Valkey `cache.t4g.micro` ~$13; S3 + CloudFront SPA ~$2; WAF ~$25; Route 53 ~$2; Secrets Manager ~$7; ECR + CloudWatch ~$10 | Compute, LB, cache, SPA CDN + tenant custom domains, edge security, DNS, secrets (ADR-010/014/023) | ~$192 x86 / ~$175 Graviton — **budget line $180–230** |
| Sentry Team | Errors/traces (ADR-025) | $26–80 |
| PostHog EU cloud | Analytics/replay/flags (ADR-025) | $0–50 at launch volume |
| Better Stack | Logs, uptime, status page (ADR-025) | $30–100 |
| Resend Pro | Email + Inbound (ADR-020) | $20–90 |
| Twilio | Numbers (~$1.15/number) + SMS ($0.0079/segment) + voice | $50–200 pre-AI-scale |
| Anthropic API | AI layer (ADR-022) | $50–300 at pilot volume |
| AWS KMS | Field-level envelope encryption (ADR-015) | <$10 |
| GitHub Team | CI/CD (ADR-023) | $4/user ≈ $12 |
| **Total envelope** | | **≈ $750–$1,100/mo pre-revenue** (restated 2026-07-24 for the RDS move; was ≈ $650–$1,000 on the Supabase line) |

- **Recommended default:** approve the $1,000/mo ceiling; review quarterly. The AWS line replaces the earlier Railway (~$100–300) + Vercel (~$40–60) rows — a Railway/Fly pilot would have run ~$40–80/mo, so AWS is ~3–4× plus real ops effort, accepted with the Q-11 decision for Canadian residency and enterprise credibility (ADR-014). One-time: domain registrations (~$50/yr) and the migration-day key rotation (free, scheduled).
- **Needed by:** Phase 0.
- **✅ Decision (2026-07-23) — approved with a ramp condition:** budget approved in principle, but spend must **ramp**: minimal infrastructure cost during the build phase (smallest instances, dev/free tiers, scale-to-zero where possible); the full production envelope activates only at production launch, once the system demonstrably works and generates value. Not paying full from day one.
- **🔄 Restated (2026-07-24) — DB switched to RDS:** the owner moved the database from Supabase to Amazon RDS for PostgreSQL 16 (ADR-008). The DB line changes from Supabase ~$25–75/mo to **~$28–30/mo during build** (db.t4g.small Single-AZ staging + free local Docker dev — inside the old range, so the build-phase ramp is unchanged) and **~US$140–170/mo at production launch** (Multi-AZ db.t4g.medium + RDS Proxy + gp3 + backup overage), i.e. **+~$95–115/mo** at launch. The approved envelope is restated **~US$750–$1,100/mo** (ADR-014); the ramp condition stands.

### Q-09 — Optional paid UI licences

- **Context:** ADR-017 marked two optional purchases.
- **Recommended default:** **buy Tailwind Plus ($299 one-time)** — accelerates marketing/site chrome; **defer AG Grid Enterprise (~$999/dev/yr)** — TanStack Table covers all currently specced grids; revisit only if a tenant demands Excel-grade pivoting.
- **Needed by:** Phase 1.
- **✅ Decision (2026-07-23) — closed, no client input needed:** **Tailwind Plus is not purchased.** The product is a **system** (a logged-in CRM/DMS), not a landing page — template chrome adds no value. Professional UI/UX remains mandatory and is delivered by the free professional stack (Tailwind v4 + shadcn/ui + design tokens), with the design direction, color palette, and UI style **selected first via Google Stitch and locked as design tokens before any UI code** (ADR-017 amended 2026-07-23; process in `06-tech-stack/ui-design-system.md` §1.1). **AG Grid Enterprise stays deferred** per the §9.3 trigger criteria. This question is removed from the client list — [CLIENT-QUESTIONS.md](./CLIENT-QUESTIONS.md) now carries 5 questions.

---

## 6. Data Migration & Cutover

### Q-10 — Migration timing, scope, and legacy retirement

- **Context:** ADR-026 orders migration after the tenancy/schema foundation. The legacy DB has mixed dollars/cents rows, free-text salesperson joins, and unbuildable migrations — ETL is forensic, not mechanical.
- **Questions for the owner:**
  1. Migrate **full deal history** or a cutoff (e.g., last 24 months + all open deals)? — **Default: full history** (commissions/tax reports need it; volume is small).
  2. Acceptable cutover window? — **Default: a weekend at Phase 1 exit**, dual-run week after (legacy read-only, discrepancy report daily).
  3. Who signs off the commission reconciliation diff (recomputed vs historically paid)? — **Default: owner personally**, since corrected math will surface historical over/under-payments to named staff.
  4. Confirm the legacy app goes **read-only at cutover** and is decommissioned at Phase 2 exit (ADR-026 bans new legacy features from Phase 0).
- **Needed by:** Phase 1 planning (ETL rules), cutover date by Phase 1 exit.
- **✅ Decision (2026-07-23) — major change:** all existing data is **test data** — there is no real data to migrate. Production launches with a **clean, empty database** plus seed/reference configuration. All data-migration work is **removed**: no ETL, no historical commission reconciliation, no dual-run week, no read-only legacy period. Legacy code/specs remain a business-rules reference only; commission plans and store config are entered fresh at onboarding. The four sub-questions above are moot.

---

## 7. Hosting

### Q-11 — Hosting preference — **ANSWERED: AWS `ca-central-1` (Montreal)**

- **Decision (owner, recorded in ADR-014):** all platform compute runs on **AWS in `ca-central-1` (Montreal)** — SPA on S3 + CloudFront (per-tenant ACM custom domains), API/workers/intake on ECS Fargate behind an ALB, ElastiCache for Valkey, WAF on CloudFront + ALB, Route 53, Secrets Manager; infrastructure as code (Terraform or CDK) applied by CI, mandatory. At the time of this decision the database stayed Supabase Postgres `ca-central-1` with RDS documented as a future exit path; **on 2026-07-24 the owner took that exit path before build start — the database is now Amazon RDS for PostgreSQL 16 in the same VPC's private subnets (ADR-008 amended; single-vendor AWS, zero migration cost)**.
- **Why:** this closes the residency concern this question existed to surface — **both compute and data are now fully in Canada**, so the Law 25 cross-border-transfer analysis for the core platform reduces to "none" (the earlier options processed requests in US regions). It also buys enterprise credibility with dealer-group and OEM procurement.
- **Accepted trade-off:** a Railway or Fly.io pilot would have cost ~US$40–80/mo with near-zero ops; AWS pilot run-rate is ~US$192/mo x86 (~$175 on ARM64/Graviton), **budget line US$180–230/mo** (Q-08 updated), roughly 3–4× plus real ops effort (VPC/IAM/IaC). The owner explicitly accepted this. Railway (the previous decision) and Fly.io remain in ADR-014 as alternatives considered — not chosen.
- **Status:** decided — no further owner input needed; reflected in the Q-08 envelope and Phase 0 of [ROADMAP.md](./ROADMAP.md).

---

## 8. Business Rules to Confirm

These are product rules the documentation asserts (mostly inherited from legacy specs/gap-map discussions) that only the owner can ratify. Defaults are already written into the module specs under `01-business-logic/` — confirming them is a review, not new design.

### Q-15 — Pipeline stage rules

- **As documented:** 10 stages — `new, submitted, approved, signed, sourcing, pending_delivery, scheduled, delivered, complete, lost` — single vocabulary in `packages/schemas` (ADR-009).
- **Confirm:** Can deals move backward? (**Default: yes, with required reason, logged to `activity_events`.**) Can stages be skipped? (**Default: managers+ only; salespeople move one stage at a time.**) Who may mark `lost`? (**Default: any assigned user; `lost_reason` mandatory.**)
- **✅ Decision (2026-07-23):** ratified as documented — the owner defers to the values from the built system (10 stages, backward moves with reason, managers-only skip). Per-store editable.

### Q-16 — Delivery gate strictness

- **As documented:** delivery date cannot be set until all gating items pass (hard block, HTTP `422` `delivery_blocked` with the blocking list in the error envelope's `details[]` — api-design.md §8).
- **Recommended default:** hard block **plus a gm/owner override** that records who/when/why — operations reality (e.g., insurance verified verbally at 17:55 Friday) needs a safety valve that still leaves an audit trail.
- **✅ Decision (2026-07-23):** ratified as documented — delivery hard block with logged gm/owner override. Per-store editable.

### Q-17 — Alert thresholds

- **As documented — two generations exist** (`automation-notifications.md` §4). As-built `stores` columns, preserved as the legacy defaults by tenant provisioning (`multi-tenancy.md` §7, `schema-design.md` §3): vehicle aging **60 days** (`aging_threshold_days`) → used-car manager, wholesale manager, GM; safety overdue **14 days** (`safety_overdue_days`) → used-car manager; funding stale **7 days** (`funding_overdue_days`) → F&I + GM. The older spec generation (`stores.alert_thresholds` JSONB) used **30 days** aging / **3 days** safety instead, and adds: no photos **48 h** after arrival → used-car manager; recon cost > **$2,000** → GM; deal rotting **7 days** in stage → salesperson.
- **Recommended default:** ship the as-built numbers (60 d / 14 d / 7 d) plus 48 h photos, $2,000 recon (stored as 200000 cents, ADR-009), and 7 d deal rotting as store defaults, editable per store in the admin console (Phase 2). Owner ratifies — or tightens toward the older 30 d / 3 d spec values — at onboarding.
- **✅ Decision (2026-07-23):** ratified as documented — the as-built thresholds stand (60 d / 14 d / 7 d / 48 h / $2,000 / 7 d), per-store editable.

### Q-18 — Commission plans and F&I compensation

- **Context:** the 12 real pay plans (rates 5–35%, $1,500 pads, Vendeur 10's $60k monthly tier, three supervisor-override pairings) are ground truth and survive migration; the corrected engine enforces pad-before-rate, monthly tiers across all period deals, overrides paid to the supervisor, clawback-before-payout.
- **Confirm:** 1) each plan's current rate/pad/override at migration date (people change); 2) F&I manager compensation model — **default: `fi_manager` role on the membership + a per-store F&I plan record**, not a separate commissions table; 3) whether historical mispayments surfaced by the reconciliation (Q-10) are corrected or grandfathered — **default: grandfathered, corrected go-forward.**
- **✅ Decision (2026-07-23):** ratified as documented — the pay-plan engine rules stand. Note: with the Q-10 clean-start decision there are **no historical corrections at all** — commission plans are entered fresh at onboarding; item 3 is moot.

### Q-19 — Duplicate-lead policy

- **As documented:** legacy matched phone-only and flagged.
- **Recommended default:** match on normalized phone **then** email; duplicates flagged with an assisted merge UI (keep older `customer_since`, union tags/notes); never auto-reject — a returning lead is a hot lead.
- **✅ Decision (2026-07-23):** ratified as documented — phone→email matching with assisted merge.

### Q-20 — Pre-delivery checklist items

- **As documented:** gating items = insurance **verified** (not just received), void cheque received, funding **funded**, IDV completed, safety **passed**, wet-ink file ≥ prepared; plus non-gating scheduling checks: delivery date confirmed with customer, drivers booked.
- **Confirm:** the full list per store (ON vs QC differ on safety), and which banks require IDV + the IDV platform used.
- **✅ Decision (2026-07-23) — ratified, client input pending:** the documented checklist stands, per-store editable. Still pending the client: ON-vs-QC checklist differences and which banks require IDV (and on which platform) — see [CLIENT-QUESTIONS.md](./CLIENT-QUESTIONS.md) Q4.

### Q-21 — Photo requirements

- **Recommended default:** 6 required angles (front, rear, both sides, interior, odometer), minimum 6 photos to clear the photo-compliance flag, upload within 48 h of arrival, responsibility = listing salesperson (used-car manager alerted on breach).
- **✅ Decision (2026-07-23):** ratified as documented — 6 photos / 48 h SLA, per-store editable.

### Q-22 — Wholesale rules

- **Recommended default:** flag-eligible at 60 days in stock (amber) with GM or wholesale manager decision; price from MMR/book with manager discretion recorded; platforms **TradeRev + ACV** first, ADESA physical later. Confirm who holds wholesale authority per store.
- **✅ Decision (2026-07-23) — ratified, client input pending:** flag at 60 days, TradeRev + ACV first, as documented; per-store editable. Still pending the client: who holds wholesale authority per store — see [CLIENT-QUESTIONS.md](./CLIENT-QUESTIONS.md) Q5.

### Q-23 — VIN decode provider

- **Recommended default:** **NHTSA vPIC** (free, no key) for year/make/model/body decode at Phase 1; upgrade to a paid Canadian-aware service (DataOne, CarQuery) only if trim/package-level accuracy is needed for pricing. Auto-populate on VIN entry in inventory and desking.
- **✅ Decision (2026-07-23) — changed from the default:** the owner wants maximum accuracy and production quality — use a **commercial Canadian-aware VIN decode service** (e.g., DataOne), selected via a short accuracy evaluation; free NHTSA vPIC becomes a **development-only fallback**.

---

## 9. Legal & Compliance Checkpoints

### Q-24 — Legal review budget and timing

- **Context:** the compliance engine (ADR-022) encodes CASL, CRTC ADAD/DNCL/quiet hours, PIPEDA meaningful consent, Law 25 s.12.1, and Bill 96. The engineering is specced; the **wording** of consent asks, AI disclosures ("assistant virtuel de {store}"), STOP confirmations, and the bilingual bill-of-sale template should be reviewed by counsel — penalties reach $10M (CASL) / C$25M or 4% of turnover (Law 25).
- **Recommended default:** one fixed-fee review by a Quebec technology/privacy lawyer covering: consent copy (FR/EN), AI first-turn disclosure, outbound-call consent capture ("Reply YES"), bill-of-sale template per province, and the Law 25 PIA/AIA template — scheduled to complete **before Phase 3 go-live**; a second short review before Phase 4 (voice).
- **Needed by:** budget approval Phase 2; review complete Phase 3.
- **⏸ Deferred (2026-07-23):** legal review parked by the owner for now — but it remains a **MANDATORY pre-launch task** once the system is production-ready: the review must be completed **before the AI goes live to the public**.

### Q-25 — Billing/brand legal entity

- **Context:** Stripe account, tenant contracts, sending domains, and the `readyloans.app` domain need one owning entity; the owner operates multiple entities (Kia Mont-Laurier, ReadyCar, Riverside Auto Finance).
- **Recommended default:** a dedicated platform entity (e.g., "ReadyLoans Inc.") owns the Stripe account, trademarks, and domains; dealerships — including the owner's own — are its customers. Confirm the entity and the product name ("ReadyLoans") before external marketing.
- **Needed by:** Phase 2 (Stripe onboarding requires the legal entity).
- **🔶 Partial decision (2026-07-23):** the working name stays **"ReadyLoans"**; the final product name is pending the client — see [CLIENT-QUESTIONS.md](./CLIENT-QUESTIONS.md) Q1. The product must stay easily rebrandable.
