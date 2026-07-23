# ReadyLoans — Non-Functional Requirements

This document is the numbered catalog of non-functional requirements for the ReadyLoans platform: performance, availability, scalability, security, regulatory compliance (Bill 96, Law 25, PIPEDA, CASL/CRTC, OMVIC), accessibility, browser/device support, data retention, observability, and engineering quality. Each NFR states a measurable target and how it is verified. Targets marked **(Target)** go beyond anything the legacy system attempted; everything conforms to `00-overview/ARCHITECTURE-DECISIONS.md` — the referenced ADR is the authority on the mechanism.

**Priority key:** **P0** = must hold before Kia Mont-Laurier (tenant #1) goes live on ReadyLoans; **P1** = must hold before a second, external tenant is onboarded; **P2** = must hold at SaaS scale.

## Table of Contents

1. [Performance (NFR-PERF)](#1-performance-nfr-perf)
2. [Availability & Reliability (NFR-AVL)](#2-availability--reliability-nfr-avl)
3. [Scalability (NFR-SCL)](#3-scalability-nfr-scl)
4. [Security (NFR-SEC)](#4-security-nfr-sec)
5. [Compliance (NFR-CMP)](#5-compliance-nfr-cmp)
6. [Accessibility (NFR-ACC)](#6-accessibility-nfr-acc)
7. [Browser, Device & Mobile Support (NFR-DEV)](#7-browser-device--mobile-support-nfr-dev)
8. [Data Management & Retention (NFR-DATA)](#8-data-management--retention-nfr-data)
9. [Observability & Auditability (NFR-OBS)](#9-observability--auditability-nfr-obs)
10. [Engineering Quality & Maintainability (NFR-QUAL)](#10-engineering-quality--maintainability-nfr-qual)

---

## 1. Performance (NFR-PERF)

The three headline SLOs are product features, not ops trivia: speed-to-lead is the core sales pitch (ADR-025).

| ID | Requirement | Target | Priority | Verification |
|---|---|---|---|---|
| NFR-PERF-001 | API request latency | **p95 < 300 ms** per endpoint (ADR-025) | P0 | OTel traces → Better Stack dashboards; burn-rate alerts |
| NFR-PERF-002 | Lead-intake webhook acknowledgment (`apps/intake`) | **p99 < 1 s**; design point sub-100 ms ACK — validate, enqueue, return (ADR-005) | P0 | Synthetic probes + intake ACK histogram |
| NFR-PERF-003 | AI first touch (intake ACK → first SMS sent) | **< 60 s** (ADR-022/025) | P1 | First-touch latency metric emitted by the BullMQ lead Flow; PostHog funnel |
| NFR-PERF-004 | Realtime UI updates (kanban moves, notifications, AI coaching panel) | Visible to subscribed clients **< 2 s** after commit (Target) | P1 | Playwright E2E with two sessions; Socket.IO event-delivery lag metrics (ADR-004) |
| NFR-PERF-005 | SPA initial load (login → dashboard interactive) | **< 3 s** on a mid-range laptop over 4G; route-level code-splitting mandatory (the legacy app ships the PDF parser + charts to the login page — banned) | P1 | Lighthouse CI budget on the per-PR CloudFront preview deploys (ADR-014/023) |
| NFR-PERF-006 | Kanban board query (deals by stage, one store) | **< 150 ms** at 5,000 active deals — covering composite indexes `(tenant_id, store_id, pipeline_stage)` (ADR-008) | P1 | pg_stat_statements review; seeded load test in staging |
| NFR-PERF-007 | Heavy artifacts (PDF/Excel generation, image processing, bulk imports) | Never in a request handler — always BullMQ workers (ADR-012/021); job pickup < 5 s under normal load | P0 | Code review gate + queue-latency metrics |
| NFR-PERF-008 | List endpoints | Mandatory pagination (default 50, max 200 per page); unbounded queries banned — the legacy 1,000-row silent truncation corrupted financial reports | P0 | Contract-level: ts-rest schemas require pagination params; CI contract check |
| NFR-PERF-009 | Global search (Ctrl+K) | Results **< 400 ms** for 5-per-type/20-max across contacts + deals (GIN-indexed tsvector) | P2 | Trace on `/api/v1/search` |
| NFR-PERF-010 | AI conversation turn (client SMS in → agent reply out, excluding carrier latency) | **p95 < 15 s** per turn incl. Haiku extraction (Target); prompt caching on the frozen per-tenant prefix (~90% input-cost cut, ADR-022) | P1 | Turn-latency metric per conversation |

## 2. Availability & Reliability (NFR-AVL)

| ID | Requirement | Target | Priority | Verification |
|---|---|---|---|---|
| NFR-AVL-001 | Platform availability (API + SPA) | **99.9% monthly** (≈ 43 min/mo error budget) (Target) | P1 | Better Stack uptime monitors + public status page (ADR-025) |
| NFR-AVL-002 | API redundancy | **≥ 2 always-on `apps/api` Fargate tasks spread across 2 AZs** behind the ALB; health-checked; zero-downtime CodeDeploy blue/green deploys with alarm-gated automatic rollback (ADR-014/023, decided 2026-07-23; FR-OPS-001) | P0 | Terraform/CDK config review; deploy-time smoke test |
| NFR-AVL-003 | Graceful degradation on cache loss | Valkey loss degrades performance only, never correctness — no correctness-critical data lives solely in cache (ADR-010) | P0 | Chaos test: kill Valkey in staging, assert reads still correct |
| NFR-AVL-004 | Job reliability | Every queue: idempotent jobs (deterministic IDs), exponential backoff, **DLQ with alerting**; webhook redelivery cannot double-process (ADR-012) | P0 | DLQ depth alarms; duplicate-delivery integration test |
| NFR-AVL-005 | Outbound webhook delivery | Retries with exponential backoff up to 24 h, then DLQ; per-tenant delivery log UI (ADR-005) | P1 | Delivery-log audit; simulated endpoint outage test |
| NFR-AVL-006 | Graceful shutdown | SIGTERM drains in-flight requests (10 s budget) and running jobs before exit | P0 | Deploy observation; no 5xx spike during rollout |
| NFR-AVL-007 | Health checks | `/healthz` (liveness) + `/readyz` readiness (DB ping + Valkey + migration ledger) returning 200/503, per the hosting-topology.md §5 contract — the legacy health check checked nothing | P0 | LB configured against `/readyz`; synthetic monitor |
| NFR-AVL-008 | Database recovery | RDS automated backups + PITR enabled (ADR-008); **RPO ≤ 5 min, RTO ≤ 4 h** (Target); restore procedure tested quarterly — the legacy system has no backup story at all | P0 | Documented, timed snapshot/PITR restore drill into a scratch RDS instance |
| NFR-AVL-009 | Realtime fallback | If the Socket.IO realtime layer is degraded, UI falls back to 30 s polling without data loss (Target) | P2 | Feature-flagged fallback path; chaos test |
| NFR-AVL-010 | Send-layer safety | Email/SMS sends are at-least-once with idempotency keys; a crashed worker never re-sends a client-facing message twice within a conversation turn | P1 | Idempotency-key assertion tests on the send service |

## 3. Scalability (NFR-SCL)

| ID | Requirement | Target | Priority | Verification |
|---|---|---|---|---|
| NFR-SCL-001 | Tenant scale envelope | Shared-schema design sized for **dozens-to-hundreds of organizations** and their rooftops without architecture change (ADR-007); DB-per-tenant (Neon branch) reserved as enterprise escalation | P1 | Load test with 50 synthetic tenants in staging |
| NFR-SCL-002 | Data volume | Monthly range partitioning pre-planned for `messages`, `activity_events`, `notifications` at **> 10 M rows**; partition keys chosen now (ADR-008) | P2 | Migration rehearsal on staging copy |
| NFR-SCL-003 | Worker scaling | `apps/workers` horizontally scaled by queue depth; **per-tenant group limiters** so one dealership's bulk import cannot starve another's lead pipeline (ADR-012) | P1 | Queue-depth autoscale rule; noisy-neighbor load test |
| NFR-SCL-004 | Rate limiting | Layered token buckets (rate-limiter-flexible on Valkey): global ceiling → per-IP (unauthenticated intake/auth) → **per-tenant plan quota** → per-endpoint (PDF, AI initiation, bulk); `429` + `Retry-After` + `X-RateLimit-*` (ADR-011) | P0 | Automated limit tests per layer; quota config on tenant record |
| NFR-SCL-005 | Read scaling | Read replica added only when reporting load demands it; reports/AI analytics route to replica when present (ADR-008) | P2 | Query-routing flag; replica-lag monitor |
| NFR-SCL-006 | Concurrency correctness | All multi-step mutations (lead→deal convert, dispatch resource assignment, commission recompute, distribution tallies) run in **Postgres transactions**; the legacy read-modify-write races are banned | P0 | Code review gate; race-condition integration tests |
| NFR-SCL-007 | Connection management | RDS Proxy transaction pooling for API/workers with `SET LOCAL` tenant context per transaction (proxy-safe); small direct pool only for migrations/LISTEN (ADR-008) | P0 | Connection-count dashboard; pool exhaustion alarm |
| NFR-SCL-008 | AI cost scaling | Per-tenant prompt caching + Haiku for extraction keeps marginal AI cost per conversation predictable; per-tenant usage metered for billing and quota (ADR-022/024) | P1 | Cost-per-conversation metric per tenant |

## 4. Security (NFR-SEC)

The audit scored the legacy system 1/10 here; every item below is a hard gate.

| ID | Requirement | Target | Priority | Verification |
|---|---|---|---|---|
| NFR-SEC-001 | Authentication coverage | **Every** API route authenticated except an explicit public allowlist (health, auth, intake webhooks with their own verification); Better Auth sessions — rotating refresh, HTTPS-only `Secure`/`HttpOnly`/`SameSite=Lax` cookies (ADR-006) | P0 | Route-table audit in CI: any unlisted unauthenticated route fails the build |
| NFR-SEC-002 | Tenant isolation | Postgres RLS **ENABLED AND FORCED** on all tenant tables; `USING(true)` permanently banned; tenant context from the verified session only (`SET LOCAL`), never client headers (ADR-007) | P0 | Automated cross-tenant probe suite (attempt reads/writes across tenants for every table) in CI |
| NFR-SEC-003 | Authorization | 10-role permission matrix enforced server-side (e.g., confirm payments = owner/gm/admin_office; submit to lenders = owner/gm/fi_manager; automation rules = owner/gm); salesperson sees own deals, sale-price-only financials | P0 | Matrix-driven authorization tests per endpoint |
| NFR-SEC-004 | MFA | TOTP required for `owner`, `gm`, `admin_office`; optional for others (ADR-006) | P0 | Auth-flow E2E test |
| NFR-SEC-005 | Transport encryption | TLS 1.2 min / **1.3 preferred** on every hop incl. app→Postgres (`sslmode=verify-full`) and app→Valkey; HSTS + preload; automatic certs for tenant custom domains (ADR-015) | P0 | SSL Labs scan; connection-string audit |
| NFR-SEC-006 | At-rest & field-level encryption | Provider AES-256 baseline; **field-level AES-256-GCM envelope encryption (AWS KMS, per-tenant data keys)** for SIN, driver's licence, DOB, income/credit details, banking/void-cheque data; blind HMAC indexes for equality lookup; pgsodium banned (ADR-015) | P0 | Schema audit: sensitive columns must be ciphertext types; decrypt paths logged |
| NFR-SEC-007 | Input validation | Zod 4 on every request/response and job payload from `packages/schemas`/`contracts`; `.passthrough()` banned; sanitization (trim, E.164 phones, lowercase emails) before validation (ADR-016) | P0 | Contract coverage check in CI |
| NFR-SEC-008 | Secrets | No secrets in the repo — platform secret stores only; the three leaked legacy keys (Supabase service-role, Resend, anon) **rotated on migration day** (ADR-023); service-role credentials held only by workers/admin functions | P0 | Secret-scanning in CI; key-rotation runbook executed |
| NFR-SEC-009 | File storage | All S3 buckets private (Block Public Access, SSE-KMS); per-tenant path prefixes; **presigned URLs only** (upload + download); upload MIME/extension/size validation; EXIF/GPS stripped from images (ADR-013) | P0 | Anonymous-access probe on every bucket in CI |
| NFR-SEC-010 | Webhook authenticity | Inbound: provider signature verification (Meta `X-Hub-Signature-256`, Twilio signature) or per-source shared secrets. Outbound: HMAC-SHA256 over `{timestamp}.{body}`, ±5-min replay window, dual-secret rotation (ADR-005) | P0 | Signature test vectors; replay-attack test |
| NFR-SEC-011 | Brute-force / abuse | Auth endpoints: 5 attempts / 15 min / IP; intake endpoints: high-burst buckets with per-source limits (ADR-011) | P0 | Rate-limit integration tests |
| NFR-SEC-012 | Error hygiene | No raw database errors (table/column/constraint names) or stack traces to clients; structured `AppError` envelope | P0 | Error-shape contract tests |
| NFR-SEC-013 | Session control | Per-tenant session revocation; permission changes effective immediately (DB-backed sessions — no stale-JWT window) (ADR-006) | P1 | Revocation E2E test |
| NFR-SEC-014 | Dependency & platform hygiene | Automated dependency audit in CI; Docker images rebuilt on base-image CVEs; browser CSP + helmet-equivalent headers on API | P1 | CI audit step; header scan |
| NFR-SEC-015 | Penetration testing | External pen test before the first non-Hassan tenant onboards; annual thereafter (Target) | P1 | Pen-test report + remediation log |

## 5. Compliance (NFR-CMP)

Compliance is platform-layer, not per-feature (vision doc, Guiding Principle 4). The AI outbound engine **must not go live** until NFR-CMP-005 through NFR-CMP-009 hold.

| ID | Requirement | Target | Priority | Verification |
|---|---|---|---|---|
| NFR-CMP-001 | **Bill 96 — French equivalence** | Full FR/EN coverage of UI, emails, PDFs, SMS, AI scripts incl. staff-facing screens; `fr-CA` default for Quebec tenants (detector: user profile → tenant default → browser); **CI EN↔FR key-parity gate — missing key fails the build** (ADR-019) | P0 | CI gate; screen-by-screen FR review of desking/leads/accounting (the legacy leak points) |
| NFR-CMP-002 | Bill 96 — contracts of adhesion | French presented first on Quebec contracts; Bill of Sale and the 13-document catalog rendered FR-first for QC deals; **no Ontario/OMVIC text on Quebec contracts** (legacy defect F9) | P0 | Golden-master PDF snapshots per province in CI |
| NFR-CMP-003 | **Law 25 — residency** | **Full Canadian residency — all personal information stored *and processed* in `ca-central-1`**: RDS for PostgreSQL + S3 storage (ADR-008/013) and all platform compute on AWS `ca-central-1` (ADR-014) — single-vendor AWS, no cross-border transfer for the core platform (closes Q-11); analytics on PostHog EU cloud; no PII in Sentry (scrubbed via beforeSend) (ADR-008/014/025) | P0 | Region audit of every data store and compute service; Sentry scrub tests |
| NFR-CMP-004 | Law 25 — automated decisions (s.12.1) | Any financing-significant automated decision (AI routing/scoring that affects credit outcomes) carries disclosure to the individual + a human-review path; decision inputs logged (ADR-022) | P1 | Decision-log audit; disclosure copy in FR+EN |
| NFR-CMP-005 | Law 25 / PIPEDA — consent | Per-lead/contact **consent ledger**: basis (express/implied), source, timestamp, expiry; `consent_marketing` enforced (not just stored); granular opt-in gates PostHog capture/replay (ADR-022/025) | P0 | Consent checks in the send layer; test: no send without valid basis |
| NFR-CMP-006 | **CASL** — commercial electronic messages | Implied consent (inquiry) expires **6 months**; existing business relationship **24 months**; sender identification + unsubscribe in every CEM; expiry enforced automatically by the send layer | P0 | Expiry unit tests; message-footer template audit |
| NFR-CMP-007 | CASL/CRTC — STOP & quiet hours | **STOP = immediate global opt-out** across SMS/drips (no exceptions); CRTC quiet hours enforced platform-wide in the send layer: **9:00–21:30 weekdays, 10:00–18:00 weekends, recipient-local time** (ADR-020) | P0 | STOP E2E test; quiet-hours boundary tests across timezones |
| NFR-CMP-008 | CRTC — DNCL & ADAD | National DNCL scrub with **≤ 31-day freshness** + per-tenant internal DNC before any outbound voice; **no automated outbound call without recorded express consent** (ADAD) — "Can our assistant call you? Reply YES" captured in SMS (ADR-022) | P1 | Consent-record requirement in the call-initiation path; scrub-age monitor |
| NFR-CMP-009 | AI transparency | AI self-identifies in the first conversational turn, FR + EN; full conversation audit log retained; agent never quotes pricing, rates, or approval odds (guardrail in the prompt + output filter) | P1 | Prompt/eval suite in `packages/ai`; transcript sampling |
| NFR-CMP-010 | Tax correctness (legal documents) | QC GST 5% + QST 9.975%, ON HST 13% via **effective-dated server-side tax tables** (no blended-rate rounding — the DECIMAL(6,4) 14.98% defect is banned); manufacturer rebates taxed **post-tax**; Section 87 exemption; BC/MB trade-in credits enabled; federal Luxury Tax > $100k (Target) | P0 | Golden-number tests per province/scenario (ADR-023, ≥90% coverage on `packages/core`) |
| NFR-CMP-011 | OMVIC (Ontario) | OMVIC disclosure generated for Ontario deals only; per-deal OMVIC fee representable (`omvic_fee_cents` or province+`is_retail` derivation — open decision O7) | P1 | Document-generation tests per province |
| NFR-CMP-012 | Immutable legal records | Bill of Sale and signed documents persisted as **immutable snapshots with hashes** at generation time; reprints byte-identical (ADR-021) | P0 | Hash-verification test; reprint diff test |
| NFR-CMP-013 | Breach readiness | Incident-response runbook incl. Law 25 notification obligations (Commission d'accès à l'information + affected individuals when risk of serious injury); access to PII decrypt paths audited (ADR-015) | P1 | Runbook exists + annual tabletop exercise |

## 6. Accessibility (NFR-ACC)

Legacy state: 9 aria attributes in ~24,000 lines of JSX (AODA legal exposure). Target regime: **WCAG 2.2 AA**.

| ID | Requirement | Target | Priority | Verification |
|---|---|---|---|---|
| NFR-ACC-001 | Conformance level | WCAG 2.2 AA across the staff SPA and all client-facing pages (credit-app forms, chat widget) | P1 | axe-core in Playwright CI; manual audit per release |
| NFR-ACC-002 | Contrast | AA contrast (4.5:1 text, 3:1 large text/UI) in both themes; **tenant-supplied brand colors auto-validated with foreground auto-adjust** (ADR-018) | P1 | Automated contrast check in the branding pipeline |
| NFR-ACC-003 | Keyboard | All interactive elements keyboard-operable; kanban drag-and-drop has a keyboard alternative (move-to-stage menu); visible focus rings; Ctrl/Cmd+K palette fully keyboard-driven | P1 | Keyboard-only E2E pass on core flows |
| NFR-ACC-004 | Semantics | shadcn/ui on Base UI primitives provides accessible roles/aria by default (ADR-017); custom components must match; form fields labeled; errors announced (`aria-live`) | P1 | axe-core; component-library review |
| NFR-ACC-005 | Touch & motion | Touch targets ≥ 44×44 px (48×48 preferred); `prefers-reduced-motion` respected (kanban animations, confetti, toasts) | P2 | Design-review checklist; media-query test |
| NFR-ACC-006 | Not color-alone | Status conveyed by icon/label + color (rotting indicators, checklist states, funding badges) — never color alone | P1 | Design review; grayscale screenshot audit |

## 7. Browser, Device & Mobile Support (NFR-DEV)

| ID | Requirement | Target | Priority | Verification |
|---|---|---|---|---|
| NFR-DEV-001 | Browsers | Evergreen: last 2 major versions of Chrome, Edge, Firefox, Safari (desktop + iOS/Android). No IE/legacy-Edge support | P0 | Playwright matrix on Chromium/WebKit/Firefox |
| NFR-DEV-002 | Responsive breakpoints | < 640 px mobile (single column + bottom tab bar, max 5 tabs: Dashboard, Deals, Deliveries, Reports, More); 640–1024 tablet (2-col, collapsible sidebar); 1024–1440 desktop; > 1440 wide | P1 | Visual regression at each breakpoint |
| NFR-DEV-003 | Mobile pipeline UX | Kanban horizontal scroll with snap (~85%-width columns); swipe right = call, swipe left = move stage; full-screen form modals; sticky submit buttons | P2 | Mobile E2E on real-device viewport profiles |
| NFR-DEV-004 | Mobile-critical flows | Driver view (delivery details, cash to collect, photo upload, "Delivery Complete") and salesperson day view fully usable on a phone — these are field workflows, not desk workflows | P1 | Mobile E2E for the driver + salesperson journeys |
| NFR-DEV-005 | Native apps | None at launch — responsive PWA-style web only; AG Grid Enterprise deferred (ADR-017; vision doc Non-Goals) | — | — |
| NFR-DEV-006 | Minimum viewport | Usable at 360 px width without horizontal page scroll (wide tables/boards scroll within their own containers) | P1 | Visual regression at 360 px |

## 8. Data Management & Retention (NFR-DATA)

| ID | Requirement | Target | Priority | Verification |
|---|---|---|---|---|
| NFR-DATA-001 | Soft deletes | `deleted_at` on all business tables; every read filters it; restore endpoints per resource; **hard delete only by owner after 90 days** (ADR-009; Tier-0 spec) | P0 | Schema lint; soft-delete behavior tests |
| NFR-DATA-002 | Audit trail | Every state change emits an append-only, tenant-scoped `activity_events` row (~28 event types) with old/new-value metadata for field changes — logged from every mutating route (ADR-009) | P0 | Mutation-route coverage check: route without activity log fails review |
| NFR-DATA-003 | Money | All monetary values INTEGER cents; commission rates NUMERIC(5,4); per-deal tax stored as split `gst_cents`/`qst_cents`/`pst_cents`/`hst_cents` written by the desking engine (ADR-009) | P0 | Schema lint: no NUMERIC money columns; golden-number tests |
| NFR-DATA-004 | Timestamps & timezones | UTC storage everywhere; tenant timezone applied at render; quiet-hours and business-day logic computed in recipient-local / store-local time | P0 | TZ boundary tests (post-delivery job, quiet hours) |
| NFR-DATA-005 | Volatile computations | No `CURRENT_DATE`/`NOW()` in stored generated columns (`days_in_stock`, `days_at_garage` computed in views/queries) (ADR-009) | P0 | Schema lint |
| NFR-DATA-006 | Legal document retention | Immutable deal-document snapshots (Bill of Sale, signed contracts) retained **≥ 7 years** after deal completion (CRA/OMVIC business-records horizon) in the stricter-policy document bucket class (ADR-013) (Target) | P1 | Retention policy config + audit |
| NFR-DATA-007 | Conversation & consent retention | AI/SMS conversation logs and the consent ledger retained for the life of the customer relationship + 3 years (CASL due-diligence defense) (Target); STOP/opt-out records retained indefinitely | P1 | Retention job audit |
| NFR-DATA-008 | Law 25 destruction | Personal information destroyed or anonymized when purposes are fulfilled and retention windows lapse; automated purge jobs with logs; billing dunning leads to **read-only, never deletion** (ADR-024) | P2 | Purge-job dry-run reports |
| NFR-DATA-009 | Lead lifecycle data | Nurture expiry 90 days → status `expired` (data kept, messaging stops); CASL implied-consent expiry auto-enforced (6/24 months) independent of lead status | P1 | Lifecycle unit tests |
| NFR-DATA-010 | Analytics data minimization | PostHog session replay input-masked; Sentry PII-scrubbed (no request bodies with personal data); analytics identify by opaque IDs, not names/phones (ADR-025) | P0 | Config review + replay sampling |
| NFR-DATA-011 | Migration fidelity | Legacy → ReadyLoans data migration is checksummed and reconciled: deal counts, commission totals (in cents), document links; dollars×100 conversion audited row-by-row where legacy stored floats (ADR-026) | P0 | Reconciliation report signed off before legacy retirement |
| NFR-DATA-012 | Backups | PITR (NFR-AVL-008) plus logical dumps before every destructive migration; seed/test tooling can never point at production (env-guarded — legacy seeds carried DELETEs against prod) | P0 | CI guard; migration runbook |

## 9. Observability & Auditability (NFR-OBS)

| ID | Requirement | Target | Priority | Verification |
|---|---|---|---|---|
| NFR-OBS-001 | Error tracking | Sentry on frontend + backend with release health; PII scrubbed; alert on new-issue spikes (ADR-025) | P0 | Sentry project config; scrub tests |
| NFR-OBS-002 | Tracing | OpenTelemetry auto-instrumentation on Fastify, BullMQ, and pg; trace context propagated through jobs; every request/job carries `tenant_id` + `request_id` + actor | P0 | Trace-continuity test across a lead Flow |
| NFR-OBS-003 | Logging | pino structured JSON (no raw `console.*` — legacy had 201); shipped to Better Stack; log levels env-controlled; no PII at info level | P0 | Lint rule banning console; log sampling review |
| NFR-OBS-004 | SLO monitoring | Burn-rate alerting on the three SLOs (API p95 < 300 ms; intake ACK p99 < 1 s; AI first-touch < 60 s); public status page (ADR-025) | P1 | Alert-rule review; game-day exercise |
| NFR-OBS-005 | Product telemetry | Speed-to-lead, handoff rate, reassignment rate, conversion by source/store as first-class PostHog metrics (consent-gated) — these are the numbers the owner sells the platform on | P1 | Dashboard exists per tenant |
| NFR-OBS-006 | Delivery audit | Outbound webhook + email + SMS delivery logs queryable per tenant (status, attempts, provider IDs); DLQ contents inspectable | P1 | Delivery-log UI test |
| NFR-OBS-007 | Access audit | Authentication events, permission changes, cross-tenant service-role function invocations, and PII decrypt operations logged to `activity_events`/audit sink | P1 | Audit-event coverage tests |

## 10. Engineering Quality & Maintainability (NFR-QUAL)

| ID | Requirement | Target | Priority | Verification |
|---|---|---|---|---|
| NFR-QUAL-001 | Type safety | TypeScript 5.9 `strict` across all apps/packages; no `any` escapes in `packages/core`/`schemas` (ADR-001) | P0 | `tsc --noEmit` in CI |
| NFR-QUAL-002 | Test coverage | **≥ 90% on `packages/core`** (desking, tax, commission, pipeline rules) with golden-number tests for every tax/commission/desking path — the legacy shipped zero (ADR-023) | P0 | Vitest coverage gate in CI |
| NFR-QUAL-003 | Contract integrity | ts-rest + Zod contracts are the single API source; OpenAPI 3.1 generated and diff-checked in CI; breaking changes require `/v2` + ≥ 6-month deprecation (ADR-003) | P0 | OpenAPI diff gate |
| NFR-QUAL-004 | i18n integrity | EN↔FR key-parity CI gate (build fails on drift) (ADR-019) | P0 | CI gate |
| NFR-QUAL-005 | Migration discipline | Migrations rebuild a fresh DB from zero in CI (`db reset` green); forward-only; expand-and-contract for breaking changes; dry-run in ephemeral Postgres containers (testcontainers) per PR, with staging RDS snapshot-restore rehearsals for risky changes (ADR-023, amended 2026-07-24) | P0 | CI migration job |
| NFR-QUAL-006 | Single sources of truth | One enum/status vocabulary per entity in `packages/schemas`; one API client; one money lib; one phone normalizer — the legacy's 3-generations/51-redeclarations pattern is banned | P0 | Lint rules + code review |
| NFR-QUAL-007 | Component hygiene | Components > 400 lines split; route-level code splitting; error boundary per route; no `alert()` (toasts only) | P1 | ESLint max-lines rule; bundle-size budget |
| NFR-QUAL-008 | Deploy discipline | No manual deploys — every prod change is a PR through GitHub Actions (lint, typecheck, tests, contract/i18n/migration gates, Playwright smoke); instant rollback path (ADR-023) | P0 | Branch protection + pipeline config |
| NFR-QUAL-009 | Documentation | ADRs are canonical; conflicts between older specs and ADRs resolve to ADRs (ADR-026); status claims must cite the audit or a newer verified source — `prd.json`-style aspirational statuses are banned | P0 | Doc review checklist |
