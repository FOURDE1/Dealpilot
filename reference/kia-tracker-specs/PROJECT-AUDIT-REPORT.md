# Kia Deal Tracker — Full Technical, Security & Business Audit

**Prepared for:** the project owner (Hassan)
**Subject:** `kia-tracker-specs` — dealership CRM/DMS built by "vibe coding"
**Audit date:** 2026-07-19
**Method:** 8 specialist AI auditors (product/BA, backend architecture, frontend architecture, database, security, financial-logic, quality/testing, DevOps/ops) reading the actual source, followed by an adversarial verification pass on every critical/high finding. **24 of 24 critical/high findings survived attempts to refute them (0 refuted, all confirmed at high confidence).**

> ⚠️ **Read this first — emergency items (do today):**
> 1. **A live Supabase `service_role` key and a live Resend API key are sitting in plaintext in `server/.env`, and the Supabase anon key is in `client/.env`.** The service-role key is total database god-mode across every tenant. This folder is literally named `Archive` — it has been copied/zipped around. **Rotate all three keys now** (Supabase service-role + anon/JWT secret, Resend key), then read the rest.
> 2. **The API has effectively no authentication** (2 of ~150 endpoints are protected). Do not expose it to the public internet in its current state.
> 3. **Every database Row-Level-Security policy is "allow anyone"**, and the browser ships a key that can talk to the database directly — so the database is world-open independent of the API.

---

## 1. Executive Summary

### What this is
A genuinely feature-rich, **single-dealership** CRM/DMS for **Kia Mont-Laurier** (Quebec, Canada) — bilingual French-first (for Bill 96 compliance), React + Express + Supabase. It covers the whole dealership lifecycle: lead capture → scoring → assignment → deal pipeline → F&I desking with a printable Bill of Sale → inventory & recon → driver dispatch → delivery checklist → accounting/expenses → commissions → management reports. **35 functional areas** exist in the code, and several are genuinely well-modeled.

### The headline
This is a **strong single-tenant prototype with real, valuable business logic wrapped around a foundation that is not safe to expose and cannot become a multi-tenant SaaS without rebuilding its security, tenancy, data-access, and money-handling layers.** The product intelligence (desking math, commission plans, dispatch algorithm, the whole domain model) is worth keeping. The plumbing underneath it is not.

### Production-readiness scorecard (1 = unusable, 10 = production-grade)

| Dimension | Score | One-line verdict |
|---|:---:|---|
| **Security** | **1 / 10** | No real auth; RLS is decorative; live secrets committed; privilege-escalation and passwordless-login endpoints exist. |
| **Multi-tenancy** | **1 / 10** | Tenant isolation is dead code (middleware never runs) and spoofable by design; ~20 tables have no tenant column. |
| **Financial correctness** | **2 / 10** | Bill of Sale double-counts warranty; money is dollars-vs-cents schizophrenic (100× errors); clawback always logs $0; commission overrides never pay out. Zero tests on money code. |
| **Operations / DevOps** | **2 / 10** | No deploy config, no CI, no monitoring, no backups story, non-reproducible DB, hardcoded localhost. |
| **Backend architecture** | **3 / 10** | Clean file layout, but all logic in routes, no transactions, unbounded queries that silently corrupt reports past 1000 rows. |
| **Frontend architecture** | **3 / 10** | Large working UI, but split-brain state, 3 styling systems, escaped-template-literal bugs, no error boundary, no code-splitting. |
| **Database / data model** | **3 / 10** | Later migrations show real skill, but migrations can't build a fresh DB, schema has drifted, money types inconsistent. |
| **Code quality & testing** | **3 / 10** | Tests exist but ~90% only check "does the file load"; zero coverage of financial/business logic; client lint currently fails. |
| **Feature breadth / product value** | **7 / 10** | This is the real asset. Broad, coherent, dealership-specific functionality most competitors charge a lot for. |

### Overall production-readiness: **≈ 2.5 / 10** for anything beyond a trusted single-store tool behind a VPN.
### Overall multi-tenant-SaaS-readiness: **≈ 1.5 / 10.**

The feature score (7) is what makes this project valuable and worth investing in — but the average is dragged to the floor by the fact that the three things a multi-company product **must** get right (security, tenant isolation, correct money) are the three weakest areas.

---

## 2. What the Product Does (Business View)

Kia Deal Tracker is an all-in-one operating system for a car dealership. A lead comes in, gets worked, becomes a deal, the deal gets structured and financed, the car gets prepped and delivered, the money gets accounted for, and management sees reports — all in one app, in French and English.

**The end-to-end flows that actually work today:**

1. **Lead → Deal.** A lead arrives via a Fluent Forms webhook, a Meta/Facebook lead-form webhook, or manual entry → duplicate scan flags/merges it → a configurable rules engine scores it → an assignment engine routes it to a salesperson (round-robin / load-balanced / by-source, with caps) → the salesperson works it (logs calls/texts/visits, tasks, tags, appointments with double-booking checks, a speed-to-lead timer) → one click converts it into a contact + a deal.
2. **Deal pipeline.** A deal (50+ fields including trade-in) is dragged through a 10-stage Kanban with lost-reason capture; when it funds/completes, commissions auto-calculate per each salesperson's individual pay plan (rates, pads, monthly tiers, supervisor overrides).
3. **Desking → paper.** The F&I desk builds payment scenarios (provincial taxes, trade equity/negative equity, F&I products, rebates, lender rates, optional DealerTrack PDF import), compares scenarios, and generates a Quebec/Ontario Bill of Sale that auto-prints.
4. **Inventory → recon → delivery.** Vehicles are tracked with acquisition type/cost, transport & recon costs, safety/recon status; work orders flip inventory status; per-vehicle expenses are logged against suppliers with a pending→approved→paid workflow; a 4-item pre-delivery compliance checklist (insurance, funded, safety, registration) with file uploads gates delivery; driver dispatch assigns chaser vehicles, drivers, and dealer plates with 4-hour conflict detection.
5. **Accounting & management.** Expenses reconcile by category/supplier/vehicle with a per-vehicle P&L; four management reports (Sales Performance, Commissions, Financial Summary, Inventory Pipeline) export to PDF and Excel; win/loss analysis, source-ROI-vs-ad-spend, and a salesperson leaderboard round it out.

**Intended users (10 roles in code):** owner, GM, sales manager, used-car manager, F&I manager, salesperson, wholesale manager, logistics, admin/office, BDC agent. **Important:** these roles exist as a text column but are **almost never enforced** — every user sees the same 23-item menu and can call every endpoint.

---

## 3. Module Inventory & Maturity

"Maturity" below reflects what the **code actually does when wired into the running app**, not what the specs claim. Note: the planning docs (`BUILT-VS-PLAN.md`, `prd.json`, `progress.txt`) are all stale and contradict each other — `prd.json` says everything is "completed"; `BUILT-VS-PLAN.md` says the lead manager is "0% / not built." Neither is accurate. This table is the corrected map.

| Module | Maturity | Notes |
|---|---|---|
| Leads / Lead Manager | **Functional** | Webhooks, filters, kanban, bulk ops, convert-to-deal. The most built-out area. |
| Lead scoring engine | **Functional** | 12 operators, 20+ fields, cached scores. |
| Lead assignment engine | **Functional** | Round-robin/load-balanced/source-based with caps & history. |
| Duplicate detection & merge | **Functional** | Phone/email scan, merge with record transfer. |
| Appointments | **Functional** | Double-booking & vehicle-conflict checks. |
| Contacts (CRM core) | **Functional** | Dedupe-on-create, weighted full-text search. |
| Deals & pipeline | **Functional** | 50+ fields, 10-stage kanban, commission auto-calc. |
| Desking / finance calculator | **Functional** | Provincial taxes, trade-ins, F&I, rebates, lender rates, PDF import, scenario compare. **But financial bugs — see §6.3.** |
| Bill of Sale generator | **Functional** | Prints a legal document. **But it double-counts warranty — see §6.3.** |
| Inventory Command Center | **Functional** | Acquisition/recon/safety costs & statuses, photos, days-on-lot. |
| Driver dispatch / fleet | **Functional** | Chasers, plates, drivers, 4-hr conflict detection. |
| Accounting / Expenses / Suppliers | **Functional** | Per-vehicle P&L, approval workflow, CSV export. **Best-designed data model in the project.** |
| Reports & analytics | **Functional** | 4 PDF/Excel reports + win/loss + source ROI + leaderboard. |
| Tasks & follow-ups | **Functional** | Priorities, types, my-tasks. |
| Global search / command palette | **Functional** | Ctrl+K across contacts/deals/vehicles. |
| Salespeople & commissions | **Functional** | 12 real pay plans. **But override logic is inverted — see §6.3.** |
| Tags, saved filters, lost reasons | **Functional** | Categorization + reusable filters. |
| i18n (EN/FR) | **Functional** | 944/944 key parity — genuinely good. |
| Message templates | **Partial** | Renders `{{merge_field}}` templates but **there is no channel that sends them.** |
| Workflows / nurture sequences | **Partial** | Can design & enroll, **but nothing executes the steps** (no scheduler). |
| Funding tracker | **Partial** | Status badge only. |
| Garage / work orders | **Partial** | Server API exists; **no UI wired.** |
| Delivery / PDI checklist | **Partial** | 4-item checklist works; 22-item PDI template seeded but unused. |
| Commission clawback & bulk ops | **Partial** | Bulk works; **clawback always records $0 — see §6.3.** |
| Email service | **Partial** | 2 internal notifications; not configured (empty `EMAIL_FROM`). |
| Auth & RBAC | **Partial** | Login works; role enforcement almost entirely absent. |
| Multi-store tenancy | **Stub** | Middleware exists but **never runs** and is spoofable. |
| Automation / alert engine | **Stub** | CRUD only; **no evaluator** — no rule ever fires. |
| Notifications center | **Stub** | Bell icon is a static button; nothing generates notifications. |
| Activity timeline / audit trail | **Stub** | Logger exists but is **called by nothing** — timeline renders empty. |
| Document manager | **Stub** | Server API only; no UI. |
| Wholesale manager | **Stub** | Server API only; no UI. |
| Finance desk (lenders/submissions) | **Stub** | Server API only; desking uses a static client-side lender list instead. |
| Chatbot / SMS conversations | **Stub** | Stores inbound SMS, returns empty reply; no bot, no Twilio SDK. |
| Input validation (Zod) | **Stub** | Full schema library built — **imported by zero routes.** |

**The recurring pattern:** many modules have a database table and a CRUD API but **no execution engine and no UI**. Workflows don't run, automations don't fire, notifications aren't generated, the audit trail is empty — because **there is no background-job/cron/queue system anywhere in the server** (confirmed by search). Anything time-based or event-driven is inert.

---

## 4. Architecture & Tech Stack

### Stack
- **Frontend:** React 18, Vite 5, Tailwind 3.4, TanStack Query v5, react-router 6, framer-motion, recharts, `@hello-pangea/dnd`, react-i18next, pdfjs-dist. ~24,000 lines of JSX.
- **Backend:** Express 4 on Node, `@supabase/supabase-js`, zod, multer, pdfkit, exceljs, resend. ~9,300 lines, 43 route files.
- **Database:** Supabase (PostgreSQL) with realtime; ~46 tables across ~34 migration files (~2,400 lines of SQL).
- **Assessment of the stack itself:** **The technology choices are reasonable and modern.** React + Vite + Tailwind + TanStack Query + Supabase is a legitimate, popular SaaS stack. The problem is **not** the tools — it's how they've been wired together. Two caveats for a SaaS future: (1) the whole codebase is plain JavaScript with **no TypeScript**, which will hurt at scale; (2) using Supabase safely for multi-tenant SaaS **requires** real RLS, which this project skipped entirely.

### How the pieces talk (current, broken)
```
Browser (React SPA)
  │  ├─ mostly: fetch() → Express API   (no auth header on 44 of 52 files)
  │  └─ sometimes: supabase-js DIRECT → Postgres  (anon key, e.g. desking, dispatch, expenses)
  │
Express API (43 routers)
  │  └─ ONE Supabase client using the SERVICE-ROLE key  → bypasses ALL RLS
  │
Supabase Postgres
     └─ RLS enabled on ~35 tables, but EVERY policy = USING(true) → allows everyone
        9 tables have NO RLS at all (incl. expenses, appointments)
        Storage bucket "deal-files" policies grant anon full read/write/delete
```

The core architectural sin: **there are two data planes** (through the API *and* directly from the browser), the API uses a key that disables the database's own security, and the database's security is set to "allow everyone" anyway. So there is **no enforcement layer at all** — not in the app, not in the database.

---

## 5. The "Vibe Coding" Signature

This codebase has the classic fingerprints of fast AI-assisted building without an architect enforcing invariants:

- **Scaffolding built, never wired.** Auth middleware, Zod validation, store-scoping, and an activity logger all *exist and are even unit-tested* — but are imported by almost no routes. The `scopeToStore` middleware is registered *after* all the routes, so Express never even calls it. The tests pass while the behavior they test never runs in production. This is "green tests, unenforced behavior."
- **Three generations of everything, never reconciled.** Three data-fetching styles (raw `fetch`, TanStack Query, direct Supabase), three styling systems (hardcoded Tailwind grays, semantic tokens, and `var(--color-*)` variables that are *never defined* — silently rendering transparent cards), three API response shapes, three validation dialects.
- **Copy-paste at scale.** `const API_URL = ...` is redeclared in 51 files. The try/catch/500 skeleton is copy-pasted across 203 catch blocks. Phone normalization is implemented 5 separate times. A cross-cutting change (add auth, add tenant scoping) currently means editing ~50 files by hand.
- **Literal bugs that ship.** `App.jsx:103` contains `fetch(\`\${API_URL}/users/me\`)` with a **backslash before the `${`** — so it fetches the literal text `${API_URL}` and session-restore always fails, silently falling back to a **forgeable `localStorage` blob** that anyone can set to log in as anyone. The same escaped-template-literal bug appears in `Layout.jsx` (breaks nav highlighting).
- **Docs that lie.** `prd.json` marks every story "completed"; `progress.txt` is empty; policy names say "Users see their own notifications" over a policy that shows everyone everything. The specs and the code diverged and nobody reconciled them.
- **The "Ralph" autonomous loop.** `CLAUDE.md` instructs an AI to run unattended for hours, self-select work, commit autonomously, and *append its own guardrails*. Every safety control is enforced by the same agent it constrains, and there is no CI to independently verify anything it commits. This explains the "built but never integrated" pattern.

None of this is a moral judgment — vibe coding got a huge amount of real functionality built fast. But it means **the foundation was never engineered**, and that's exactly the layer a multi-company product lives or dies on.

---

## 6. Deep Findings by Dimension

### 6.1 Security — Score 1/10 (the critical dimension)

This is the most serious area and the reason the app cannot be exposed as-is.

- **The API is unauthenticated.** Only `GET /api/users/me` and `POST /api/users/create-account` require a login. **All other ~150 endpoints** — deals, leads, contacts (which hold driver's licenses, DOB, income), reports, uploads, bulk mutations, store settings — are callable by anyone with the URL. CORS is wide open.
- **Privilege escalation is trivial.** `PUT /api/users/:id` has no auth and lets anyone set any user's `role` to `owner`. There's also a **passwordless legacy login** (`POST /api/users/login`) that creates and returns a user account from just a name and email.
- **The server bypasses the database's own security.** Every query uses the Supabase **service-role key**, which ignores Row-Level Security. So RLS is never the backstop.
- **…and RLS wouldn't help anyway, because every policy is `USING(true)`.** All ~140 policies allow everyone; 9 tables (including `expenses` and `appointments`) have no RLS at all. No policy anywhere references the logged-in user (`auth.uid()`).
- **The browser can hit the database directly.** The client bundles the anon key and, in several screens (desking, dispatch, expenses), writes to Postgres directly. Because RLS is allow-all, **anyone who extracts the anon key from the shipped JavaScript (trivial) can read, modify, and delete every record and every uploaded file**, completely bypassing the API.
- **Uploaded financial/insurance documents are exposed.** The `deal-files` storage bucket's policies grant the anonymous role full read/write/delete, and the upload endpoint returns public URLs. Insurance proofs and funding documents are effectively public.
- **Live secrets are committed** in `server/.env` (service-role key + Resend key) and `client/.env` (anon key). *(These files are `.gitignore`d and were not committed to git history — but they travel inside this "Archive" copy, so treat them as leaked.)*
- **Missing baseline hardening:** no rate limiting (login brute-force & DoS are open), no `helmet`/security headers, no password policy, unverified webhooks (anyone can flood the lead engine), and search-term injection into Supabase filter grammar.

**Every one of these was independently re-verified and confirmed.**

### 6.2 Multi-Tenancy — Score 1/10 (the SaaS blocker)

The owner's goal is "for many companies, tenant-split." Today the tenancy is **cosmetic**:

- The `scopeToStore` middleware is **registered after every route**, so it never executes. Even if it did, it reads the tenant from a **client-supplied header** (`x-store-id`) — so a caller picks their own tenant.
- `store_id` is **nullable on nearly every table**; ~20 tables (tags, appointments, message templates, workflows, suppliers, assignment rules, …) have **no tenant column at all**. `tags.name` is *globally unique*, so tenant A's tag names would collide with tenant B's.
- A user belongs to exactly **one** store (a single nullable column), which rules out multi-rooftop dealer groups — the exact customers this would sell to.
- Branding ("Kia Mont-Laurier"), email recipients, dispatch company, fees, F&I products, tax rates, and lender lists are **hardcoded** into the code/bundle for one store.
- The flagship `deals` API never filters by store at all.

Bolting real tenancy onto this is not a patch — it's a schema-wide refactor plus a rebuilt access layer.

### 6.3 Financial Correctness — Score 2/10 (legal/money risk)

This app prints a **legal Bill of Sale** and pays **real commissions**, so correctness bugs here have legal and payroll consequences. The tax *structure* is actually correct (Quebec GST 5% + QST 9.975% on the right base, trade-in credit, Section 87 exemption, correct amortization). But there are confirmed defects sitting directly in the money path:

- **🔴 The Bill of Sale double-counts the extended warranty** in "Total Purchase Price" (added once into the vehicle price line and again inside the F&I total), and the renderer hides the second occurrence — so the signed legal total is overstated by exactly the warranty price on the most common F&I product. A $2,500 warranty overstates the contract by $2,500.
- **🔴 Money units are dollars-vs-cents schizophrenic.** A migration converted key `deals` money columns to **integer cents**, but the entire app still reads and writes them as **float dollars**. Result: if that migration ran, old rows are 100× new rows; and user-entered cents are silently destroyed (25000.50 → 25001). The `salespeople.pad_amount` of $1,500 subtracts as $15 against a cents-based gross. The dedicated cents-conversion helpers are dead code.
- **🔴 Commission clawback always records $0.** The code selects a column (`amount`) that doesn't exist on the commissions table (it's `commission_amount`), discards the error, and writes `0` into every clawback audit row. It also never actually reverses the commission — just flags the deal.
- **🟠 Commission overrides never pay out.** The override logic is inverted relative to the seeded pay plans, so for every configured supervisor pairing the override is always $0.
- **🟠 Commissions are silently recomputed and overwritten on every deal edit**, at the salesperson's *current* rate, with no audit trail — retroactively rewriting paid history; a reduced gross leaves a stale payout on the books.
- **🟠 Manufacturer rebates are taxed as pre-tax reductions.** In Canada, manufacturer-to-consumer rebates are applied **after** tax; treating a $2,000 Kia rebate as pre-tax undercharges ~$299.50 of tax on a legal document.
- **🟠 The signed Bill of Sale is never persisted** — it lives in `localStorage` and is recomputed from mutable state and hardcoded tax constants, so a reprint later can show *different* dollar figures than what the customer signed. There is no immutable snapshot.
- Plus: BC/Manitoba trade-in tax credit wrongly disabled, no rounding discipline (printed lines don't sum to printed totals), biweekly payments are approximations that won't match lender contracts, an Ontario/OMVIC consumer-rights block prints on a Quebec French-first contract, and the federal Luxury Tax (>$100k) is absent.
- **Zero automated tests** on any tax, desking, Bill-of-Sale, or commission code path.

### 6.4 Backend Architecture — Score 3/10

Clean file layout (one router per resource, app exported for tests) and a couple of genuinely good reference implementations (`contacts.js`, `appointments.js`). But: **all business logic lives in route handlers** (no service layer), **no transactions anywhere** (multi-step writes like lead→deal conversion, workflow step replacement, and dispatch resource locking can corrupt state on partial failure; round-robin assignment has a read-modify-write race), and **unbounded queries with in-memory aggregation**. That last one is a correctness bug, not just a perf issue: PostgREST caps results at 1000 rows by default, so **once the dealership passes ~1000 deals, financial reports, YTD summaries, exports, and the monthly commission-tier check silently compute against truncated data — wrong payouts.**

### 6.5 Frontend Architecture — Score 3/10

A large, working UI with real strengths (perfect EN/FR parity, a well-modeled desking reducer, URL-driven filters, mostly-correct TanStack Query usage where adopted). But: **split-brain state** (the same `/deals` resource lives in three unsynchronized caches), **three styling systems** including 90 references to CSS variables that are never defined, the **escaped-template-literal auth bug** (§5), **44 of 52 fetch-calling files send no auth header**, **no shared API client** (retrofitting auth/tenant headers means editing ~50 files), **no global error boundary** (any render error white-screens the app), **no code-splitting** (every user downloads the PDF parser and charting libs to see the login page), 19 `alert()` calls instead of real error states, and **near-zero accessibility** (9 aria attributes app-wide — a legal exposure under AODA in Canada). The biggest component is 1,627 lines.

### 6.6 Database / Data Model — Score 3/10

The later migrations (expenses, appointments, workflows) show **real Postgres skill** — generated columns, partial indexes, CHECK constraints, weighted full-text search. Integer-cents money, soft-deletes, and an audit table were deliberately retrofitted. But: **the migrations cannot build a fresh database** (same-day timestamp prefixes make them run in the wrong order; they depend on tables/functions defined only in files *outside* the migrations folder; three seed migrations hardcode UUIDs from the original production instance that violate foreign keys anywhere else). **`schema.sql` has drifted so far** (2 roles vs 10, decimal money vs cents, no `store_id`) that **the only source of truth is the live production database** — unacceptable for SaaS. Money types are inconsistent (commissions still dollars while deals are cents), payroll joins on free-text salesperson names, `stores.tax_rate DECIMAL(6,4)` silently rounds Quebec's 14.975% to 14.98%, and soft-delete is half-implemented (columns exist but nothing honors them; unique constraints will block re-creation after delete).

### 6.7 Code Quality & Testing — Score 3/10

19 test files / 82 cases, but **~90% of server tests only assert that a route module loads** — no handler is ever executed, no HTTP-level test library is installed. The genuine unit tests largely test **dead code** (the unwired validation/scoping/logging middleware). **The business-critical code the project itself flags as protected — commissions, dispatch, desking, taxes — has zero coverage.** The client suite passes (29/29) but **client lint currently fails** (`--max-warnings 0` with 11 errors + 53 warnings). No CI, no TypeScript, no Prettier, no pre-commit hooks, no root workspace. The server test suite can't even run on the owner's Windows machine (node_modules installed for a different OS).

### 6.8 Operations / DevOps — Score 2/10

**Zero deployment artifacts** (no Dockerfile, no CI, no platform config). No structured logging (201 raw `console.*` calls), no error tracking (Sentry etc.), no global error handler, no graceful shutdown, a health check that doesn't check the database. **No backup/restore story.** The client's API URL is hardcoded to `http://localhost:3001` and baked in at build time, so a naive deploy would silently call localhost and appear completely broken. Seed scripts point at the **production** database with **delete** statements and no environment guard. Real employee names and **actual commission compensation** are committed into docs and seeds — a privacy problem before this repo is ever shared with a contractor.

---

## 7. Business & Legal Risk Callouts

- **Data breach exposure (highest).** With the anon key public and RLS allow-all, customer PII (driver's licenses, DOB, income), financial documents, and every deal are exposed. In Canada this implicates PIPEDA (and Quebec's Law 25 privacy regime, with significant penalties). **This is a "when," not "if," if the app is exposed.**
- **Legally wrong contracts.** The Bill of Sale can overstate the total (double-counted warranty), undercharge tax (pre-tax rebate treatment), print Ontario regulator text on a Quebec contract, and cannot be reprinted faithfully (no signed snapshot). Each is a potential customer dispute or compliance finding.
- **Payroll errors.** Inverted overrides, $0 clawbacks, silent recomputation, and the cents/dollars mismatch can all produce wrong commission payouts to named employees.
- **Bill 96 / French-first.** The i18n foundation is excellent, but money screens (desking, leads) leak hardcoded English strings — the exact screens a francophone dealership uses most.
- **Confidential data in the repo.** Real salespeople's names and pay plans are in version-controlled docs/seeds.

---

## 8. The Central Question: Patch or Rebuild?

You asked directly whether this "needs to be built from first with a good architecture and techs… for many companies, fully secured, optimized, tenant-split, and ready." Here is a straight answer.

**Do not throw the project away. Do not try to patch it into a SaaS either.** The right path is in between, and it's a well-known pattern: **rebuild the foundation, salvage the product.**

### Why not "just patch it"
The three SaaS-critical layers — authentication/authorization, tenant isolation, and the money model — are not bugs you fix; they're **absent or inverted by design**. Auth touches every one of ~150 endpoints. Tenancy needs a new column on ~46 tables plus a rebuilt access layer plus RLS. The money model needs every reader/writer swept. Doing all of that *inside* the current structure (logic-in-routes, no service layer, no transactions, no TypeScript, no tests on the money code) means editing ~50 files per cross-cutting change with no safety net. You'd spend as much effort as a rebuild and still be standing on drifted migrations and dead middleware.

### Why not "start from zero"
Because there are **~24,000 lines of working, dealership-specific UI** and a **large body of correct domain logic** (the tax structure, the amortization math, the dispatch conflict algorithm, the assignment/scoring engines, the whole data model and the flows) that took real effort and encode real business knowledge. Rewriting the desking UI, the pipeline, the inventory screens, and the reports from scratch would waste that.

### The recommended approach: **Strangler rebuild of the core, harvest the features**
1. **Stand up a new, properly-architected backend and data foundation** (multi-tenant from line one — see §9).
2. **Port the domain logic** (desking math, commission rules, dispatch algorithm, tax tables) into tested, typed service modules — *fixing the confirmed bugs as you port* (warranty double-count, cents model, overrides, clawback, rebate tax).
3. **Reuse the React components** as the presentation layer, refactored onto a single API client, single state model, and a tenant/branding context.
4. **Treat the current app as an executable spec** — it's the best documentation of what the dealership needs, far better than the stale planning docs.

**Rough effort (small senior team, 2–3 engineers):** a secure, single-tenant-correct MVP in **~2–3 months**; a genuinely multi-tenant, hardened, tested SaaS in **~4–6 months**. That is faster and far less risky than continuing to build features on the current foundation, and much cheaper than a total greenfield rewrite.

---

## 9. Recommended Target Architecture (for multi-company SaaS)

- **Tenancy model:** introduce an `organizations` table above `stores` (dealer groups have multiple rooftops). Every table gets a **NOT NULL `org_id`** (and `store_id` where relevant). A `memberships(user_id, org_id, store_id, role)` table replaces the single nullable `store_id` on users, so one person can belong to multiple stores with different roles.
- **Isolation, enforced twice:** derive the tenant **only** from the verified JWT (never a client header), and back it with **real RLS** keyed on a JWT claim (`org_id = auth.jwt() ->> 'org_id'`). Use **per-request user-scoped Supabase clients** so RLS is the true backstop; reserve the service-role key for narrow admin jobs only.
- **One data plane:** all writes go through the API. If direct-from-browser Supabase reads stay (for realtime), they must be RLS-protected and tenant-filtered.
- **A real backend structure:** thin routes → a **service layer** → repositories; global auth middleware with an explicit public allowlist; centralized error handling; **Zod validation wired into every write** (the schemas already exist); **transactions via Postgres functions** for multi-step writes; **mandatory pagination** and SQL-side aggregation (no more full-table pulls).
- **Money model, settled once:** integer cents everywhere, a single currency library at the API boundary, an **effective-dated tax-rate table per province** (server-side, so tax is reproducible and auditable), and **immutable Bill-of-Sale snapshots** persisted per deal.
- **Per-tenant configuration:** branding, fees, F&I product catalogs, lender lists, email senders, and tax settings move from hardcoded constants into tenant-scoped tables.
- **A background-job system** (a queue/cron worker) so workflows, automations, notifications, aging alerts, and scheduled reports can actually run.
- **TypeScript** across client and server for a codebase this size.
- **Ops baseline:** Dockerized deploy, CI (lint + tests + build on every PR, branch protection), `helmet` + rate limiting + restricted CORS, structured logging + Sentry, a `/readyz` that checks the DB, graceful shutdown, and a tested backup/restore runbook with Supabase PITR verified.

---

## 10. Phased Roadmap

**Phase 0 — Emergency (this week).** Rotate all three keys. Do not expose the API publicly. Lock the storage bucket to authenticated access. Scrub compensation data from docs/seeds. Add an environment guard to the seed scripts.

**Phase 1 — Security & tenancy foundation (weeks 1–6).** New org/store/membership model; global auth from JWT; real RLS on every table; user-scoped clients; wire the existing Zod validation into all writes; delete the passwordless login and the mass-assignment user update; fix the escaped-template-literal auth bug and remove the localStorage fallback; single API client on the frontend with auth+tenant headers.

**Phase 2 — Financial correctness (weeks 4–8, overlapping).** Settle the cents model end-to-end with a data-migration audit; fix the warranty double-count, override logic, clawback, and rebate tax; move tax rates server-side and effective-dated; persist immutable Bill-of-Sale snapshots; **write golden-number tests** for every tax/commission/desking path before shipping.

**Phase 3 — Data layer & correctness at scale (weeks 6–12).** Rebuild the migration chain (timestamped, reproducible, CI-tested via `db reset`); consolidate the drifted schema files; add missing indexes and FK constraints; add mandatory pagination and SQL-side aggregation to reports; transactions for multi-step writes.

**Phase 4 — Ops & the inert modules (weeks 10–16).** CI/CD, monitoring, backups, Dockerized deploy; add the background-job worker and finally light up workflows, automations, notifications, and the audit trail; build the missing UIs (work orders, wholesale, documents, notifications) that already have backends.

**Phase 5 — SaaS productization (weeks 14–24).** Per-tenant branding/config/onboarding; billing; role-based UI gating; accessibility pass; per-tenant catalogs for fees/products/lenders.

---

## 11. Master Finding List (severity-ranked)

Every critical/high item below was **independently verified and confirmed** (0 of 24 refuted).

**🔴 Critical**
1. API unauthenticated — 2 of ~150 endpoints protected; everything else anonymous against a service-role client.
2. Privilege escalation — unauthenticated `PUT /api/users/:id` grants `owner`; passwordless legacy login auto-creates accounts.
3. RLS is decorative — every policy `USING(true)`; 9 tables have no RLS; anon key ships in the browser and can hit the DB directly.
4. Live service-role + Resend + anon keys committed in the working tree.
5. Storage bucket (insurance/funding docs) readable/writable by the anonymous role.
6. Tenant isolation is dead code, mounted after all routes, and spoofable by a client header.
7. Migrations cannot build a fresh database (ordering, external dependencies, hardcoded prod UUIDs).
8. Bill of Sale double-counts the extended warranty in the legal total.
9. Money units dollars-vs-cents across the app (100× errors; cents silently destroyed).
10. Commission clawback always records $0 and never reverses the commission.
11. Zero test coverage on all financial/business-critical logic.

**🟠 High**
12. Multi-tenancy skin-deep — `store_id` nullable/absent on most/~20 tables; `deals` API never filters by store.
13. Commission override logic inverted — overrides never pay out.
14. Commissions silently recomputed/overwritten on every deal edit, no audit trail.
15. Manufacturer rebates taxed pre-tax — GST/QST undercollected on the legal document.
16. Signed Bill of Sale never persisted — lives in localStorage, reprints can differ.
17. Unbounded queries + in-memory aggregation — reports/commissions silently corrupt past 1000 rows.
18. No transactions for multi-step writes — partial failures corrupt state.
19. Zod validation built but wired into zero routes — mass-assignment on deals/stores.
20. Unauthenticated file upload — no MIME check, unsanitized filename, path-traversal-capable keys.
21. Unauthenticated, unverified lead webhooks — floodable.
22. PostgREST filter injection via string-interpolated search; unvalidated sort columns.
23. Frontend: escaped-template-literal auth bug → forgeable localStorage login; 44/52 files send no auth header.
24. `stores.tax_rate DECIMAL(6,4)` silently rounds Quebec 14.975% → 14.98%; commissions join on free-text names; `schema.sql` badly drifted; no CI/monitoring/backups/deploy config.

---

## 12. Bottom Line

- **What it is:** a broad, genuinely useful, dealership-specific CRM/DMS with real domain intelligence — the *product* is a 7/10 asset.
- **How ready it is:** ~**2.5/10** for production, ~**1.5/10** for multi-tenant SaaS. Safe today only as an internal single-store tool behind a VPN — and even that is uncomfortable given the auth and financial bugs.
- **What it needs:** a rebuilt foundation — real auth, real tenant isolation with RLS, a settled money model, transactions, tests on the money code, and an ops/CI baseline.
- **Rebuild from scratch?** No — and also don't patch it into SaaS. **Rebuild the core foundation properly and harvest the working features and domain logic on top of it.** Budget ~2–3 months to a secure MVP, ~4–6 months to a real multi-tenant SaaS. Treat the current app as the spec, fix the confirmed money bugs as you port, and never expose the current version publicly.

---

*Report generated by an 8-auditor multi-agent review with adversarial verification. All file:line citations in the underlying findings were checked against the actual source; the 24 critical/high findings were each re-verified by an independent agent attempting to refute them, and none were refuted.*
