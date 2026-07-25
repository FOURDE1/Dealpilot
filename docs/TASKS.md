# TASKS.md — Task Board (Phase 0, Sprint 1)

> Governed by `docs/TEAM-WORKFLOW.md` — read it first. Seeded 2026-07-23 from
> ROADMAP Phase 0 (`kia-tracker-specs/docs/new/00-overview/ROADMAP.md`).

## Legend

**Row types:** `A-nn` AHMAD task · `H-nn` HUSSEIN task · `CR-nn` contract request
(HUSSEIN → AHMAD; only AHMAD edits `packages/contracts` + `packages/schemas`) ·
`HO-nn` handoff (a change needed in the other agent's zone: what, why, exact files).

**Statuses (exact format):** `BACKLOG` → `CLAIMED(AGENT, YYYY-MM-DD)` →
`IN-PROGRESS(branch)` → `REVIEW` → `DONE(YYYY-MM-DD, merge-sha)`, plus
`BLOCKED(needs X from Y)` at any point.

**Claim protocol:**
1. Bootstrap per TEAM-WORKFLOW §2 (read workflow, this board, both agents' latest
   session-log entries).
2. Pick the highest-priority unclaimed task **in your own track** whose
   dependencies are `DONE` — but open `CR`/`HO` rows addressed to you come first.
3. Set the row to `CLAIMED(you, date)` and push the coordination commit **before**
   writing code; set `IN-PROGRESS(branch)` when the branch exists.
4. One IN-PROGRESS task per agent. Blocked? Mark `BLOCKED(needs …)`, claim the next.
5. Update your row in the same session as every state change; never edit the other
   agent's rows.

## Board

| ID | Task | Owner | Status | Depends on | Notes |
|---|---|---|---|---|---|
| A-01 | Git init + monorepo scaffold (strict TS); GitHub deferred by owner | AHMAD | DONE(2026-07-24, d4235a2) | — | Owner decision 2026-07-24: git-only for now — origin = local bare repo `../readyloans.git`; GitHub repo/protection becomes a follow-up task when needed |
| A-02 | CI pipeline: lint/typecheck/test on push to develop/main, frozen lockfile | AHMAD | DONE(2026-07-24, 125c900) | A-01 | D-026. Owner paid the GitHub bill 2026-07-24 → live-verified BOTH ways: GREEN run 30045013846 (probe branch = develop tree, all steps pass incl. db-from-zero + 108 tests on ubuntu) and RED run 30045318726 (deliberate failing test → fails exactly at the Test step; every prior step green). Probe branch deleted. Every push to main/develop/ahmad/**/hussein/** now gets the full gate |
| A-03 | packages/schemas + packages/contracts baseline (tenant, store, user, lead) | AHMAD | DONE(2026-07-24, 31f5f28) | A-01 | CONTRACT PUBLISHED — import from @readyloans/schemas + @readyloans/contracts; code-reviewed (14 findings fixed); 19 tests |
| A-04 | packages/db + local Docker Postgres (dev) + first migration (tenants/orgs/stores/users + RLS); staging = RDS via IaC | AHMAD | DONE(2026-07-24, 637c9fd) | A-01, A-03 | RLS proven live (8 isolation tests incl. negatives); Postgres on host port 5434 (5432/5433 busy); reviewed — 2 critical findings fixed (D-022); staging RDS still via A-07 |
| A-05 | Fastify api skeleton: health check + error envelope + Better Auth wiring | AHMAD | DONE(2026-07-24, see merge) | A-01, A-03, A-04 | Reviewed (2 MAJOR fixed, D-025); 34/34 tests incl. live auth round-trip + gate regression; unblocks H-03 |
| A-11 | Transactional email: SES sender in apps/api + Better Auth sign-up verification (env-gated enforcement) | AHMAD | DONE(2026-07-25, 882ccdf) | A-07 unit 1 | Owner approved the dep + "no need to pay now" (D-030). Sandbox: sends go to verified addresses / SES simulator; production access deferred |
| A-05.1 | Auth hardening slice (COMPLETE with A-11: requireEmailVerification now available, env-gated): requireEmailVerification, cookieCache, session TTLs, CORS allowedHeaders/maxAge, auth schema, baseURL host in toWebRequest | AHMAD | DONE(2026-07-24, see merge) | A-05 | TTLs explicit (7d/refresh daily), CORS allowedHeaders+maxAge, toWebRequest uses BETTER_AUTH_URL host. cookieCache REJECTED with evidence (cached cookie outlives sign-out). Still deferred: requireEmailVerification (needs Resend key from OWNER), dedicated auth schema. 159/159 tests |
| H-01 | Stitch design selection: 3–5 directions + palettes; owner picks; lock tokens | HUSSEIN | DONE(2026-07-23, 6f07342) | — | Owner picked Direction 1 "Nordique"; tokens locked in D-024 (OKLCH + contrast evidence); name amended to "1Dealer" (D-023) |
| H-02 | Design tokens + Tailwind v4 + shadcn/ui setup in packages/ui (semantic layers, light/dark) | HUSSEIN | DONE(2026-07-23, 2fd3dea) | A-01, H-01 | Nordique tokens (D-024) + WCAG gate (74 tests); reviewed by 3-lens adversarial workflow, all confirmed findings fixed; --input = shadcn border semantic + --input-bg; Base UI dep deferred to H-05 |
| H-03 | apps/web shell: routing, layout, auth screens against A-05 contract | HUSSEIN | DONE(2026-07-24, 93a29a7) | A-03, A-05, H-02 | Increments 734e5f8 + 93a29a7. Full DoD verified live: Docker PG (migrations from zero) + API booted; curl round-trip sign-up→me→sign-out→401; Playwright e2e 3/3 (system Chrome via Vite proxy). `pnpm --filter @dealpilot/web test:e2e` needs the local stack up |
| H-04 | i18n scaffold FR-first (fr-CA default) with EN parity gate | HUSSEIN | DONE(2026-07-24, b26f490) | A-01 | Typed locales + typed t() keys; parity gate covers missing/extra/empty (incl. fr-CA reference) + ICU arg mismatches, locale set derived; shell re-keyed FR/EN, switcher, html lang; e2e 5/5; reviewed (25-agent workflow), all confirmed findings fixed; CI wiring = HO-03 |
### Contract requests & handoffs

| ID | Task | Owner | Status | Depends on | Notes |
|---|---|---|---|---|---|
| HO-04 | SECURITY footgun: `.env.example` line 5 sets DATABASE_URL to the compose SUPERUSER (`dealpilot:dealpilot`) — feeding it to the API silently BYPASSES all RLS (superusers ignore even FORCED policies; live-verified: fresh user saw another user's org/stores until the API was restarted on `dealpilot_app`). Root file = AHMAD zone. Fix: split URLs in .env.example (API/app = `dealpilot_app:dealpilot_app_dev`, migrations/db:reset = owner URL) + comment, or have the API refuse to start as a superuser in dev. | AHMAD | DONE(2026-07-24, 3bdbb0f) | — | Filed by HUSSEIN 2026-07-24; FIXED same day by AHMAD: API refuses superuser at boot (regression-tested), .env.example split (DATABASE_URL=app role, DB_ADMIN_URL=owner for migrations), db CLI prefers DB_ADMIN_URL |
| HO-01 | Fix Windows ESM crash in `packages/ui/scripts/generate-css.mjs`: an absolute Windows path reaches the ESM loader → `ERR_UNSUPPORTED_ESM_URL_SCHEME` (protocol 'c:'). Wrap with `url.pathToFileURL(...)` wherever a path is imported/passed as a module URL. | HUSSEIN | DONE(2026-07-23, 081c546) | — | Filed by AHMAD 2026-07-23; fixed same day by HUSSEIN — dynamic import now goes through `pathToFileURL(...).href`; ui build + 74 tests green on Linux, Windows-safe by construction |
| HO-03 | Wire the i18n parity gate into CI: replace the no-op i18n step in `.github/workflows/ci.yml` (AHMAD zone) with `pnpm --filter @dealpilot/i18n check:parity` (needs the i18n build first — it reads dist/). Gate semantics: exits non-zero listing missing/extra/empty/args-mismatch keys vs fr-CA. | AHMAD | DONE(2026-07-25, db77ca6) | — | Filed by HUSSEIN 2026-07-24; wired by AHMAD: ci.yml no-op replaced with `pnpm --filter @dealpilot/i18n --fail-if-no-match run check:parity` (script self-builds; verified locally) |
| HO-02 | Root `pnpm test` broken on develop: root vitest (no config) scans `reference/kia-tracker-specs/**` — 17 legacy test files fail (their deps aren't installed; reference/ is read-only). Fix in root config (AHMAD zone): root vitest config/exclude for `reference/**`. Verified pre-existing before H-02 (fails identically on clean develop). Blocks turbo `//#test` and will block A-02 CI. | AHMAD | DONE(2026-07-23, 125c900) | — | Filed by HUSSEIN 2026-07-23 (renumbered from HO-01). AHMAD findings: root `vitest.config.ts` with `exclude: reference/**` has existed on develop SINCE 637c9fd (A-04) — `git show 637c9fd:vitest.config.ts`; clean-tree frozen install on latest develop runs 6 files / 108/108 green (no reference/** collected). Suspect your failing run was a checkout predating 637c9fd or vitest invoked inside reference/. The REAL half — stale "Node 22 + .nvmrc" fact — fixed in 125c900 (.nvmrc=24 added, PROJECT.md corrected). If it still fails on your machine on latest develop: re-open with exact command, cwd, and `git rev-parse HEAD` |
| CR-01 | dddf3a9's HO-09 rewrite dropped `reinstated: true` from the add-path revive response — the Team screen's "was already in the organization, access and roles updated" notice silently vanished (UI reads that flag; e2e assertion parked pending this). Restore the flag on the revive branch (one line) and HUSSEIN re-arms the notice assertion. | AHMAD | DONE(2026-07-25, see merge) | — | Filed by HUSSEIN 2026-07-25; restored in the CONTRACT: `MemberAdded` = Member + optional `reinstated` (mirrors IntakeKeyCreated). Tests pin both directions — a revive carries the flag, a new member does not. HUSSEIN: re-arm the notice assertion |
| CR-03 | The F-08 endpoints (deals/:id/checklist, stores/:id/checklist-template + PATCHes) are not in `packages/contracts` apiV1 — the web client ships route literals mirroring docs/HUSSEIN-F08-CONTRACT.md (responses still parsed with the shared schemas). Add them to the ts-rest contract so OpenAPI and the typed client cover them. | AHMAD | OPEN | — | Filed by HUSSEIN 2026-07-26 |
| CR-02 | Vehicles 409s arrive without a field path: `conflictFrom`'s CONSTRAINT_PATHS lacks both vehicles uniqueness rules (`vehicles_organization_id_store_id_stock_number_key`, `idx_vehicles_org_vin`), so a duplicate-VIN 409 is indistinguishable from a duplicate stock number and the UI must guess (it currently says "stock number exists" for both). Add both names → details[0].path 'stock_number'/'vin'; the UI branch for 'vin' is already shipped and waiting. | AHMAD | DONE(2026-07-25, see merge) | — | Filed by HUSSEIN 2026-07-25; both rules mapped (the VIN one is a partial unique INDEX, not a table constraint — pg still reports its name). Test pins each path; your 'vin' branch now receives what it expects |
| HO-09 | **SECURITY (found by HO-05/06 adversarial review, verified end-to-end): reinstate-on-add is a privilege-escalation path.** POST /api/v1/members matches ANY same-org membership by email (no `status='revoked'` filter) and unconditionally `UPDATE ... SET status='active', roles=$2` — so (a) an admin_office/gm can type the SOLE OWNER's email into the add form with roles they hold → the owner's membership is rewritten, org left with ZERO active owners (assertNotLastOwner runs only on PATCH); (b) re-adding an ACTIVE colleague silently strips their real roles; (c) PATCH {status:'active'} (the Reinstate button) skips assertGrantable — a gm can re-activate a revoked OWNER. Fix: restrict the add-path reinstate to `status='revoked'` (409 on active), run last-owner + grantable (incl. role-STRIP) checks on both paths. NOTE for the fix: apps/web e2e re-adds an ACTIVE member and expects the reinstate notice — that assertion must flip to the 409 message in the same merge (coordinate; HUSSEIN will adapt within minutes like F-06). UI side is already hardened: removed list shows stored roles; add-form reinstate shows an explicit notice. | AHMAD | DONE(2026-07-25, see merge) — AHMAD: reinstate only revives REVOKED/INVITED (active → 409 already_member); reviving checks the TARGET's roles against the actor's rank; the add form can no longer rewrite the sole owner. 3 regression tests; HUSSEIN client follow-up b2a3ca5 | — | Filed by HUSSEIN 2026-07-25 |
| HO-07 | Owner's seeded account keeps getting wiped: all 6 API integration suites call `reset()` → `DROP SCHEMA public CASCADE` on `postgresql://…:5434/dealpilot` — the SAME database the owner's dev stack uses, so every merge-gate test run deletes hassan-test@1dealer.ca (owner hit this 3× now). Fix in AHMAD zone: point the suites at an isolated `dealpilot_test` DB (compose init script or `CREATE DATABASE IF NOT EXISTS` in a shared test helper) so dev data survives test runs. Interim: HUSSEIN re-runs `apps/web/scripts/seed-owner.sh` after every test run before owner testing. | AHMAD | DONE(2026-07-25, see merge) — AHMAD: suites now run against an isolated `dealpilot_test` DB (ensureTestDatabase/testAdminUrl/testAppUrl in @dealpilot/db). PROVEN: full 267-test run left hassan-test@1dealer.ca intact. No more owner lockouts | — | Filed by HUSSEIN 2026-07-25 after third owner lockout |
| HO-05 | Lease payments ignore the typed rate/term: `toEngineInput` (apps/api/src/f05-deals-routes.ts) never maps `interest_rate_bps`/`term_months` onto the engine's lease params — `computeDeal` always uses defaults (moneyFactor 0.00125, 48 mo, residual 55%), so a saved lease stores rate/term beside a payment computed from neither. UI ships with rate/term DISABLED for lease + a fixed-program note; remove that lock once mapped (rate→money factor, term→leaseTermMonths, or expose program params in the schema). | AHMAD | DONE(2026-07-25, see merge) | — | FIXED same day: MF = APR/2400, lease term = term_months, residual_percent added (migration 0008) and stored with the deal; golden test QC → \$444.50/mo. **HUSSEIN: remove the rate/term lock on the lease form.** Filed by HUSSEIN 2026-07-25 (confirmed by F-05 adversarial review, engine+API read) |
| HO-06 | Revoked members are unrecoverable from the UI: GET /api/v1/members filters `status <> 'revoked'`, so the roster can never show a revoked row to reinstate (PATCH status:'active' exists and works), and re-adding the same email 409s (platform-unique users). Suggest a `status` filter (or `include_revoked=1`) on the members list so the Team screen can offer "Reinstate". **OWNER HIT THIS LIVE 2026-07-25**: removed Marc, tried re-adding the same email, got "account already exists" with no path back — remove is a one-way door in the UI. FIXED by AHMAD same day: re-adding an email already in the org REINSTATES that membership and applies the roles (201, same id) instead of 409, and the roster accepts `?status=revoked` so the UI can list former colleagues and offer Reinstate. Cross-org emails still 409 (invite-token flow deferred). HUSSEIN's half (Show-removed view + Reinstate button) is ready to build the day the list can return revoked rows. Recommend the explicit list filter over auto-reinstate-on-add (an add that silently restores old roles would surprise). | AHMAD | DONE(2026-07-25, see merge) — AHMAD: re-adding a REVOKED colleague reinstates them, roster takes ?status=revoked; tightened by HO-09 so ACTIVE members are never silently rewritten | — | Filed by HUSSEIN 2026-07-25; owner-confirmed same day |

| HO-08 | **BREAKING CONTRACT (F-06) — deal status becomes TWO tracks.** Ready on branch `ahmad/f06-pipeline` (NOT merged, so develop stays green until your half is ready). What changes in `@dealpilot/schemas`: `DealStatus` is GONE. New `PipelineStage` = `new, submitted, approved, signed, sourcing, pending_delivery, scheduled, delivered, complete, lost` (where the CAR is) and `FundingStatus` = `not_submitted, submitted, stips_required, funded` (where the MONEY is). `Deal.status` → `Deal.pipeline_stage` + `Deal.funding_status`, plus `funded_at`/`delivered_at` (server-stamped on first transition). `UpdateDealInput` takes `pipeline_stage` and/or `funding_status`; `DealListQuery` filters on either. Value mapping for your labels/i18n: `working`→`new`, `funded`→`complete`; submitted/approved/delivered/lost carry over; the 5 new stages need labels (FR+EN). Files that break today: `apps/web/src/features/deals/labels.ts`, `apps/web/src/features/leads/lead-detail-page.tsx:170`. **Sequence:** ping on the board when your half is ready → AHMAD merges F-06 → you merge yours immediately after. | HUSSEIN | OPEN | — | Filed by AHMAD 2026-07-25. Why now: the drift was mine (F-05 shipped an ad-hoc vocabulary) and only dev data exists — correcting later means migrating real deals. | *(renumbered from HO-07 per §8 — number was taken by the test-DB isolation filing)*

### Feature slices (TEAM-WORKFLOW §12 / D-018 — one at a time, owner-accepted)

| ID | Task | Owner | Status | Depends on | Notes |
|---|---|---|---|---|---|
| F-01 | Organization & store administration: sign in → create/list/edit organizations + their stores. AHMAD half: `/api/v1` org+store routes (A-03 contract) on the RLS db. HUSSEIN half: admin screens on H-02 tokens + H-03 shell. | BOTH | ACCEPTED(2026-07-24) | A-05, H-02 | **OWNER CONFIRMED 2026-07-24** ("yes… now go") after personally testing the auth shell on the desktop (sign-up→dashboard→sign-out all working). AHMAD half claimed 2026-07-24; HUSSEIN half = admin screens, claim when you're back (contract already on develop since A-03). OWNER TESTED AND ACCEPTED 2026-07-24 on the laptop stack: signed in, created an organization, created a store inside it, edited both — "all worked" (owner's words in chat). First feature slice complete end-to-end. Also desktop-verified by AHMAD the same day (headless-browser journey: org+store create/edit, zero console errors). |
| F-02 | Leads: create a lead → see it in the lead list → change its status. AHMAD half: `/api/v1` lead routes (A-03 contract: 10 statuses, 19 sources) on the RLS db. HUSSEIN half: lead list/detail/create screens + status control on H-05 primitives. | BOTH | ACCEPTED(2026-07-25) | F-01, A-05 | **OWNER TESTED AND ACCEPTED 2026-07-25** ("i did tested", chat with AHMAD). Second feature slice complete end-to-end. AHMAD: claim your half when back (contract published since A-03). HUSSEIN builds H-05 primitives first — the lead list/table/forms sit on them. **OWNER TEST STEPS (laptop, http://localhost:5173, hassan-test@1dealer.ca / Test-Dealpilot-2026!):** 1) Se connecter → Prospects (sidebar) → «Nouveau prospect». 2) Choisir votre organisation + succursale, entrer un téléphone (+15145551234), prénom/nom, source, «Créer le prospect». 3) Sur la fiche: changer le statut (ex. Contacté) → «Modifications enregistrées». 4) «Retour aux prospects» → le prospect est listé avec son statut. 5) Bonus: essayer un téléphone invalide → message en français. OWNER TESTED AND ACCEPTED 2026-07-25 on the laptop (EN locale): lead created, listed, status changed — "okay done". |
| F-03 | PROPOSED (owner to confirm): **Intake webhook → lead arrives automatically** — AHMAD half: apps/intake connector endpoint (ADR-005, per-tenant `/in/v1/leads/{slug}/{sourceKey}`, dedupe, consent basis) + enqueue→lead row; HUSSEIN half: lead list already displays arrivals — add source/`chatbot` badge polish + empty-state hint. RECOMMENDED: it opens the AI speed-to-lead pipeline (the product's pitch). Alternative candidate: lead ASSIGNMENT to salespeople (needs member-list routes from AHMAD + assignee UI from HUSSEIN). | BOTH | SUPERSEDED (consolidated into the row below) | F-02 | Filed by HUSSEIN 2026-07-25 after F-02 acceptance |

| F-02b | (duplicate row from parallel board edits — consolidated into the F-02 row above by AHMAD 2026-07-25; kept per no-delete rule) | BOTH | ACCEPTED(2026-07-25) | — | The public webhook intake noted here became the F-03 proposal below |

| F-03 | PROPOSED — owner pick: (A) **Intake webhook** [AHMAD recommendation]: public per-store intake URL + secret key → external forms/Meta post leads → auto-appear in the list with source attribution. AHMAD-heavy (apps/intake endpoint, intake keys, rate limiting); HUSSEIN: intake-key management UI. (B) Lead assignment: assign leads to salespeople + "my leads" view — UI-heavy, backend mostly exists. | BOTH | ACCEPTED(2026-07-25) | F-02 | **OWNER PICKED A 2026-07-25** ("do what is the most recommended"). AHMAD half: intake_keys table + mgmt API + public intake endpoint + rate limit. HUSSEIN half: intake-key management UI (create/copy-once/revoke) + lead source badge — claim after AHMAD contract lands. OWNER TESTED AND ACCEPTED 2026-07-25: created a key, fired a signed webhook from the terminal, lead arrived in the list ("done and working"). |
| F-04 | PROPOSED (owner+AHMAD to confirm scope): **Lead assignment to salespeople** — needs AHMAD: member-list route (+ likely a minimal 'add member/invite' path, since only one user exists per org today — flag: this widens the slice) ; HUSSEIN: assignee select on the lead page + 'assigned to' in the list. ALTERNATIVE: more intake providers (Meta signature scheme / ADF email — AHMAD-heavy, deepens F-03). | BOTH | SUPERSEDED by BATCH-01 F-04 below | F-03 | Filed by HUSSEIN 2026-07-25 after F-03 acceptance |

**BATCH-01 (D-031 — owner tests F-04 + F-05 TOGETHER when both are INTEGRATED):** BOTH HALVES INTEGRATED 2026-07-25 — owner script: docs/OWNER-TEST-BATCH-01.md (English).

| ID | Task | Owner | Status | Depends on | Notes |
|---|---|---|---|---|---|
| F-04 | **Team members + lead assignment**: invite/add a colleague to the org with roles → assign a lead to a salesperson → filter "my leads". AHMAD half: `/api/v1/memberships` (list org members with names/roles, add member by email, change roles, revoke) + `assigned_to` filter on the lead list. HUSSEIN half: Team screen (list/add/roles/revoke) + assignee picker on the lead detail + "My leads" filter on the list. | BOTH | **ACCEPTED 2026-07-25** (owner ran BATCH-01; one issue — unnamed 422 on invalid email — fixed same day) | F-02 | **OWNER CONFIRMED 2026-07-25** (batch instruction). Today only ONE user exists per org, so the add-member path is what makes assignment demonstrable. HUSSEIN: claim your half now — AHMAD publishes the contract first, ping-free (watch develop). |
| F-05 | **Deal desking**: from a lead, build a deal — vehicle price, trade, fees, F&I → live payment + Canadian taxes + gross, saved to the deal. AHMAD half: migration (deals) + `/api/v1/deals` CRUD + `POST /api/v1/deals/calculate` driving the **A-06 money engine** (`@dealpilot/core`: 13-province tax, amortization/lease, desking, commissions). HUSSEIN half: desking screen with live recalculation + FR/EN money formatting. | BOTH | **ACCEPTED 2026-07-25** (owner ran BATCH-01, golden numbers confirmed on screen) | F-02, A-06 | Puts the already-built and golden-tested money engine in front of the owner — the highest-value unused asset in the repo. Contract lands before HUSSEIN's UI (§4). |

**BATCH-02 COMPLETE 2026-07-26 — F-06 ✓ F-07 ✓ F-08 ✓ F-09 ✓ (all halves integrated). AWAITING-OWNER-TEST: docs/OWNER-TEST-BATCH-02.md (verified against the running stack, UI labels reconciled). Pending owner decisions: D-033 (safety sign-off role), D-035 (invite flow next batch).**

| ID | Task | Owner | Status | Depends on | Notes |
|---|---|---|---|---|---|
| F-06 | **Deal pipeline (canonical 10 stages + kanban)**: a deal moves new → submitted → approved → signed → sourcing → pending_delivery → scheduled → delivered → complete (or lost), with the parallel funding-status track. AHMAD half: migrate `deals.status` to the spec's `pipeline_stage` vocabulary + `funding_status`, transition rules, stage filter/grouping endpoint. HUSSEIN half: kanban board (drag or stage buttons) + stage badges. | BOTH | INTEGRATED(develop b6575f8 + b6f2ab3 — both halves, same hour; BATCH-02 owner test comes after F-07) | F-05 | **AHMAD found vocabulary DRIFT in his own F-05**: deals shipped with `working/submitted/approved/funded/delivered/lost`, but deals-pipeline.md §2 defines 10 canonical stages (`new, submitted, approved, signed, sourcing, pending_delivery, scheduled, delivered, complete, lost`). Correcting now while only dev data exists — CONTRACT CHANGE, HUSSEIN rebuild against the new enum. |
| F-07 | **Inventory (vehicles)**: stock a vehicle (VIN, year/make/model, cost, price, status) → pick it on a deal → it shows as sold/pending. AHMAD half: vehicles table + `/api/v1/vehicles` CRUD + `vehicle_id` on deals with same-org enforcement. HUSSEIN half: inventory list/detail + vehicle picker in the desking worksheet. | BOTH | INTEGRATED(develop 294eb21 + edcc722 — both halves) | F-06 | Next module in the plan's order; makes desking concrete (price a REAL car) and sets up delivery/PDI later. |

| F-08 | **Deal → delivery checklist**: mark a delivered deal's required steps (per-store configurable items, D-020) so "delivered" means something auditable. AHMAD half: checklist template per store + per-deal items + completion API. HUSSEIN half: checklist panel on the deal. | BOTH | INTEGRATED(develop dfe5fc6 + 82853e2/a76979f — both halves) | F-06, F-07 | Two adversarial review rounds found 17 defects in AHMAD's own first cut, the worst being that the gate was a NO-OP unless someone had opened the checklist panel first (items were never created), and that `pipeline_stage: 'complete'` walked straight around it. Both fixed and mutation-proven. Contract for HUSSEIN below. |
| F-09 | **Commissions on funded deals**: when a deal is funded, compute the salesperson's commission with the A-06 engine (pad-before-rate, tier by funded month, overrides) and show it. AHMAD half: pay-plan per membership + commission rows on funding. HUSSEIN half: commission view. | BOTH | IN-PROGRESS(AHMAD half DONE; HUSSEIN: pay-plan + commission views) | F-06 | Proposed 2026-07-25. The engine and its golden tests already exist (A-06); this wires them to real deals — the owner's 12 real pay plans become live data. |

### Backlog (next sprint candidates — do not claim in Sprint 1)

| ID | Task | Owner | Status | Depends on | Notes |
|---|---|---|---|---|---|
| A-06 | packages/core money math port + golden tests (tax/desking, commissions, amortization; ≥90% cov) | AHMAD | DONE(2026-07-24, 5a47cfd) | A-01 | ROADMAP 0.6; legacy code = executable spec (now at reference/kia-tracker-specs) |
| A-08 | GitHub adoption + Dealpilot rebrand + reference import | AHMAD | DONE(2026-07-24, see merge) | A-01 | origin = github.com/FOURDE1/Dealpilot; @dealpilot/* packages; plan+legacy in reference/; new-machine setup in README |
| A-09 | Doc sweep: propagate names + D-020 client answers through reference/docs/new plan docs | AHMAD | BACKLOG | A-08 | Low priority; plan docs currently say ReadyLoans (noted in README/§2.1). Scope-rename question RESOLVED by owner (D-027, 2026-07-24): KEEP `@dealpilot/*` internal scope; "1Dealer" is user-facing only |
| A-07 | AWS IaC baseline + first deploy, minimal-footprint cost ramp | AHMAD | IN-PROGRESS(unit 1 DEPLOYED: SES DKIM pending-auto, deploy role live; unit 2 = costed compute, flag first) | A-01, A-02 | ROADMAP 0.7 (incl. staging RDS db.t4g.small Single-AZ, VPC-private — D-013); every apply needs owner approval. **UNIT 1 DEPLOYED** (SES verified + OIDC role, ~$0/mo). **UNIT 2 DEFERRED by owner 2026-07-25 (D-030 — "no need to pay now"); revisit when a remote env is actually needed.** Costs kept for that day: Components for a always-on staging env in ca-central-1 and rough list-price estimates (AHMAD 2026-07-25, to be confirmed at apply time): RDS db.t4g.small Single-AZ + 20GB gp3 ~$30/mo · ECS Fargate 1 small task ~$20/mo · ALB ~$20-25/mo · ElastiCache t4g.micro ~$13/mo · S3+CloudFront+Route53 ~$3-5/mo · **NAT Gateway ~$35/mo + data (the avoidable one — VPC endpoints instead)**. **Rough total ~$85-125/mo with VPC endpoints, ~$120-160/mo with NAT.** Options: (a) build it now, (b) defer staging and keep developing locally at $0 until closer to launch [AHMAD recommendation — nothing needs it yet], (c) build a cheaper scheduled/stop-start variant. |
| A-10 | i18n-friendly schema errors: hardcoded EN messages in packages/schemas (e.g. PhoneE164) defeat client-side localization — drop per-field literals or export message KEYS so app error maps speak | AHMAD | DONE(on develop — MESSAGE_KEYS in packages/schemas/src/common.ts; the ahmad/a10-schema-messages branch pointer is stale) | — | Filed from HUSSEIN's F-02 review note 2026-07-25 |
| H-05 | packages/ui core primitives (Button, Input, Form, Table, Dialog) on locked tokens | HUSSEIN | DONE(2026-07-24, 9f4aaf5) | H-02 | DataTable (TanStack v8, sortable, state handling), themed Base UI Dialog, RHF Form composition with full aria wiring; 81 ui tests; demo both themes. F-02 lead screens build on these |

---

## Task details

### A-01 — Repo + monorepo scaffold
**Scope:** `git init` in `main-project`; create the GitHub repo and push (**ask the
owner** for org/repo name + confirmation — externally visible action); branch
protection on `main` (no direct pushes, PR required) and create `develop`; pnpm +
Turborepo workspace: `apps/{web,api,workers,intake}`, `packages/{db,schemas,contracts,core,ui,i18n,ai}`
as minimal compiling stubs; TypeScript 5.9 `strict` shared base config; root lint/
format config; `.gitignore` + `.env.example`; commit lockfile.
**DoD:** `pnpm install && pnpm turbo build lint typecheck test` green locally on the
skeleton; repo pushed; branch protection verified; HUSSEIN can clone
(`main-project-hussein`).

### A-02 — CI pipeline
**Scope:** GitHub Actions on PRs to `develop`/`main`: `pnpm install --frozen-lockfile`,
turbo lint + typecheck + test (vitest); actions pinned to full commit SHAs; no
long-lived cloud keys. Include an i18n-parity job step that no-ops with a visible
"pending H-04" notice until HUSSEIN publishes the parity script (then wire it via
HUSSEIN's HO row).
**DoD:** a test PR shows all checks running and green; a deliberately broken PR fails.

### A-03 — Schemas + contracts baseline
**Scope:** Zod 4 schemas in `packages/schemas` for tenant(org), store, user/membership,
lead — integer cents convention, one status vocabulary per entity; ts-rest contracts
in `packages/contracts` for `/api/v1` CRUD/list (paginated) on those entities + the
error envelope shape; OpenAPI 3.1 generation stub.
**DoD:** both packages build; types importable from both zones; contracts merged to
`develop` (this merge is the publication event H-03 waits on).

### A-04 — DB package + local Postgres + first migration
**Scope:** `packages/db` with migration tooling; dev database = **local Docker
Postgres 16 via compose** — no cloud dependency (RDS over Supabase, D-013); the
**staging Amazon RDS for PostgreSQL 16 instance** (ca-central-1, db.t4g.small
Single-AZ, VPC-private, KMS-encrypted gp3) is defined in IaC and provisioned with
the A-07 baseline (**ask the owner** before any AWS apply); migration 0001:
`organizations`, `stores`, `users`/`memberships` with `tenant_id` scoping, RLS
ENABLED + FORCED, composite `(tenant_id, …)` indexes; CI-testable `db reset` from
migration zero (ephemeral Postgres containers in CI, ADR-023); integer cents;
soft deletes.
**DoD:** fresh `db reset` builds the schema from zero against local Docker
Postgres; RLS smoke test (seeded tenant #2 sees nothing of tenant #1) passes;
secrets only in env/Secrets Manager, `.env.example` updated.

### A-05 — API skeleton + Better Auth
**Scope:** Fastify v5 app in `apps/api` mounting the A-03 contracts; `/api/v1/health`;
global error handler emitting the contract error envelope; Better Auth with
organizations plugin, HTTPS-only cookies, deny-by-default auth with explicit public
allowlist (health, auth routes); pino structured logs with request IDs; session/user
contract published for the web app.
**DoD:** API boots locally against the A-04 DB; sign-up/sign-in/sign-out + `me`
round-trip verified with real requests; unauthenticated requests to protected
routes rejected; auth contract merged to `develop` (unblocks H-03 auth screens).

### H-01 — Stitch design selection
**Scope:** Use **Google Stitch via its MCP** to generate 3–5 professional design
directions + color palettes for a data-dense, bilingual (FR-first) dealership
CRM/DMS — light + dark, WCAG 2.2 AA contrast. The Stitch MCP is **not yet
connected**: ask the owner to connect it before starting; do not substitute another
tool without owner approval. Present the directions to the owner; the owner picks;
lock the winning palette/typography/radius/density as the token source of truth.
**DoD:** owner has explicitly selected a direction; locked token values recorded in
`docs/DECISIONS.md` (tagged `[HUSSEIN]`) and handed to H-02.

### H-02 — Tokens + Tailwind v4 + shadcn/ui in packages/ui
**Scope:** Encode the H-01 locked tokens as CSS custom properties in primitive →
semantic → component layers (components reference semantic only); Tailwind CSS v4 +
shadcn/ui base setup in `packages/ui` (NO Tailwind Plus); light/dark themes both
meeting ≥4.5:1 text contrast; export a themed demo story/page proving tokens drive
shadcn components.
**DoD:** `packages/ui` builds; demo renders in both themes; tokens documented in the
package README; merged to `develop`.

### H-03 — apps/web shell
**Scope:** React 19 + Vite 6 SPA in `apps/web`: react-router v7 route tree (public
auth routes + protected app layout), TanStack Query v5 client wired to the ts-rest
contracts from `develop`, app layout (nav/sidebar/topbar) on `packages/ui`, auth
screens (sign-in/sign-up/sign-out, session guard) against the **A-05 published
contract** — no hand-written API types. **Sequencing:** routing + layout may start
once H-02 is DONE; auth screens must wait for A-05 `DONE`.
**DoD:** `pnpm dev` serves the shell; real sign-in against the local API redirects
into the protected layout; unauthenticated access redirects to sign-in; basic
Playwright e2e for the auth journey passes.

### H-04 — i18n scaffold FR-first
**Scope:** react-i18next in `packages/i18n` with `fr-CA` as default locale and
`en-CA` secondary (Bill 96: FR-first including staff UI); namespace layout +
typed keys; language switcher hook; **EN↔FR key-parity check script** (fails on any
key missing in either language) exposed as a package script; seed both locales for
the H-03 shell strings. Then file an `HO` row for AHMAD to wire the parity script
into the A-02 CI pipeline (`.github/**` is AHMAD's zone).
**DoD:** shell renders FR by default and switches to EN with zero missing keys;
parity script exits non-zero when a key is removed from one locale (demonstrated);
HO row filed for CI wiring.

---

## Sprint 1 dependency map

```mermaid
graph LR
    A01[A-01 repo+scaffold] --> A02[A-02 CI]
    A01 --> A03[A-03 schemas+contracts]
    A01 --> A04[A-04 db+local PG+RLS]
    A03 --> A04
    A03 --> A05[A-05 api+auth]
    A04 --> A05
    H01[H-01 Stitch selection] --> H02[H-02 tokens+ui]
    A01 --> H02
    A01 --> H04[H-04 i18n]
    H02 --> H03[H-03 web shell]
    A03 --> H03
    A05 --> H03
    H04 -. HO: CI wiring .-> A02
```

**Day-1 parallel start:** AHMAD → A-01. HUSSEIN → H-01 (needs no repo; needs owner
to connect the Stitch MCP). Neither agent waits on the other to begin.
