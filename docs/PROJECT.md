# PROJECT.md — Project Facts

> Source of truth for HOW to run things in this repo. Claude: if a field the
> CURRENT task depends on is still `TBD`, ask the user (or discover and confirm)
> before relying on it, then record the answer here. Deep design authority:
> `reference/kia-tracker-specs/docs/new/00-overview/ARCHITECTURE-DECISIONS.md` (26 ADRs, in-repo).

## Identity

- **Name:** Dealpilot (client-chosen, 2026-07-23 — D-020; white-label product, rebrandable per tenant; formerly working name "ReadyLoans")
- **One-line purpose:** Multi-tenant, white-label dealership CRM/DMS plus an AI lead-automation layer, Canada/Quebec-first (Bill 96, Law 25, CASL, PIPEDA).
- **Target users:** Dealership staff (10 roles: owner, gm, sales_manager, used_car_manager, fi_manager, salesperson, wholesale_manager, logistics, admin_office, bdc_agent) and the platform admin (Dealpilot operator console).
- **Deployment target:** Web SaaS — responsive SPA + versioned REST API; installable PWA at module parity; no native apps at launch.

## Stack

- **Language(s) & version(s):** TypeScript 5.9 `strict` everywhere; Node.js 24 (pinned via `.nvmrc` + `engines >=24`; corrected from the plan's "22 LTS" — A-01 scaffolded on 24, D-026).
- **Framework(s):** React 19 + Vite 6 SPA (react-router v7, TanStack Query v5); Fastify v5 API; ts-rest + Zod 4 shared contracts (REST `/api/v1`, OpenAPI 3.1); BullMQ 5 workers; Better Auth 1.3+ (organization plugin, RBAC, MFA, HTTPS-only cookies); Tailwind CSS v4 + shadcn/ui on Base UI (no Tailwind Plus — owner decision 2026-07-23); react-i18next + i18next-icu, FR-first (Bill 96); vitest + Playwright.
- **Package manager:** pnpm workspaces + Turborepo. Monorepo layout: `apps/web`, `apps/api`, `apps/workers`, `apps/intake`; `packages/db`, `schemas`, `contracts`, `core`, `ui`, `i18n`, `ai`.
- **Database / storage:** Amazon RDS for PostgreSQL 16 in `ca-central-1` (VPC-private — no public accessibility, ingress from ECS task SGs only; KMS-encrypted gp3, deletion protection, automated backups + PITR; owner decision 2026-07-24, D-013) — shared-schema multi-tenant, `tenant_id`/`store_id` on every business row, RLS ENABLED + FORCED, integer cents, RDS Proxy transaction pooling at launch (dev = local Docker Postgres, staging = db.t4g.small Single-AZ); Amazon S3 (private buckets, per-tenant prefixes, presigned URLs only) + CloudFront for files/images; Socket.IO 4 + Redis adapter for realtime (tenant-namespaced rooms, app-emitted events); ElastiCache Valkey (cache, rate limiting, BullMQ backing, Socket.IO adapter).
- **Hosting / infra:** AWS `ca-central-1` (full Canadian residency): CloudFront + S3 (SPA), ECR + ECS Fargate behind ALB (min 2 API tasks / 2 AZs from the SELLING phase — D-061 owner budget phasing), AWS WAF, Secrets Manager, KMS, Route 53; GitHub Actions CI/CD (OIDC to AWS, no long-lived keys); Sentry + PostHog EU + OpenTelemetry + pino → Better Stack; Twilio (SMS/MMS + voice via ConversationRelay), Amazon SES ca-central-1 (email — D-029, owner decision; Resend rejected), Stripe Billing (admin-managed pricing); model-agnostic AI layer (Claude models as launch defaults, selected per task by the eval/A-B harness in `packages/ai`). Build phase runs a minimal infra footprint; spend then phases by RESULTS per D-061 (pilot ≤US$300/mo on lean shapes, selling phase ≤US$500, the ~$750–1,100 envelope — restated 2026-07-24 for the RDS move — at ~10-rooftop scale).

## Commands

> Verified working 2026-08-14. Correct this table the moment reality disagrees.

| Task                   | Command |
| ---------------------- | ------- |
| Install deps           | `pnpm install` |
| Run dev servers        | `pnpm dev` (turbo; api on :3001, web on :5173) |
| Build                  | `pnpm build` |
| Lint                   | `pnpm lint` |
| Type-check             | `pnpm typecheck` |
| Tests                  | `pnpm test` — or `pnpm turbo run build typecheck lint test` for the full gate |
| Tests, nothing skipped | `RLS_REQUIRED=1 REDIS_URL=redis://localhost:6381 pnpm test` (fails instead of skipping when Postgres or Redis is unreachable). **Both variables, always.** `REDIS_URL` is unset on this desktop and set in CI, so without it the BullMQ producers return their no-op and the local gate runs a DIFFERENT code path from CI — which is how tick 26 shipped two RED docs-only pushes on a tree whose local gate was green (F-72) |
| End-to-end suite       | `pnpm e2e` — the only path: its own `dealpilot_e2e_test` database rebuilt from migration zero, the API on 3101 and the SPA on 5176 (dev ports untouched), Redis required; `pnpm e2e -- --grep console-door` to narrow. CI runs the identical command (F-74) |
| Dependency vuln scan   | `pnpm audit` |
| Bootstrap the first platform super admin | `DB_ADMIN_URL=<dev db> pnpm --filter @dealpilot/db exec node dist/cli.js platform-grant <email>` (the account must exist; closes once a super admin exists — F-69) |
| Provision a tenant | As a super admin (MFA enrolled): `/admin/tenants/new` in the web app, or `POST /api/v1/admin/tenants` (F-70). With the dev `log` mailer the owner's invitation link comes back in the response — hand it to the owner; "Resend the owner invitation" on the tenant page re-issues it |
| Open a support session (act as a tenant member) | As support or a super admin: tenant page → "Session de soutien" → pick the member, mode, a reason of 20+ characters → the tenant app opens with the banner; End from the banner, the console wall, or `/admin/support-sessions/:id` (F-71). 60-minute hard TTL; the owner is notified; every request is in the session's trail |
| Stop all outbound messaging (platform-wide) | As a super admin (MFA enrolled): `/admin/platform-settings` → « Arrêt des SMS sortants » or « Arrêt des messages générés par l’IA » → *Arrêter l’envoi* + a reason of 10+ characters, or `POST /api/v1/admin/platform-settings/:setting_key` (F-72). Every process obeys within 5 seconds; resuming asks you to type the switch key back; e-mail is NOT covered; a red bar names every switch that is on |
| Tell every dealer something (announcement) | As a super admin: `/admin/announcements` → "Nouvelle annonce" → both languages, a severity, an audience, a window, or `POST /api/v1/admin/announcements` (F-72). Support may publish `info` only; an `incident` needs an `https://` status-page link; published text is never editable — the only change is *Terminer maintenant* |
| See what one dealer used | As any platform staffer: `/admin/tenants/:id` → **Utilisation**, or `GET /api/v1/admin/tenants/:id/usage` with `period=mtd`, `30d` or `90d`. Every figure is counted from business rows at read time — there is no counter table — and each carries a caption saying exactly what it counts; the plan's inclusions are shown only for `mtd`, and nothing on the card enforces, meters or bills anything (F-73) |
| Read a tenant's operating detail during a support call | As any platform staffer: `/admin/tenants/:id` → **Instantané**, or `GET /api/v1/admin/tenants/:id/snapshot` — rooftops with their timezone, the dealer's own carrier number, whether business hours are set and 30-day traffic; intake keys with `last_lead_accepted_at` and never their token or secret; comms config, branding state, active connectors, and the platform-wide transports (F-73 API, F-77 screen). The page renders only fields the schema names and is guard-tested to be unable to show an intake credential |
| See which job queues are stuck | As a super admin or support: `/admin/queues`, or `GET /api/v1/admin/queues` and `GET /api/v1/admin/queues/:name/dlq`. With no `REDIS_URL`, or a Redis that does not answer, the counts read *Inconnu* rather than 0 and the page says which; a failed job shows allow-listed identifiers only — never a customer's message — and the list pages by POSITION, so entries can shift between pages (F-73) |
| Put failed jobs back on a queue | As a super admin or support: the failed-jobs page → tick at most 20 jobs → *Remettre en file* with a reason of 10+ characters, or `POST /api/v1/admin/queues/:name/dlq/retry`. On `deferred-send`, `assistant-turn`, `first-touch` and `drip-tick` you must type the queue name back first, because a retry there can send a real customer a SECOND SMS; the audit row is filed before any job is touched, and every requested id comes back with its own outcome inside a 200 (F-73) |
| Configure a rooftop (timezone, hours, holidays, texting number) and the texting window | Signed in as owner/GM: **Réglages → Succursales → the store** (its « Exploitation » section; the same form as `/organizations/:orgId/stores/:storeId`) and **Réglages → Automatisations** (`/settings/automations`, the existing `GET`/`PUT /api/v1/organizations/:id/comms-config`). Every field lands on an existing column the senders, the drips and the assistant already read; read-only without `store:update` / `organization:update` (F-76) |
| See your month's real numbers | Signed in with « Rapports » authority (owner, GM, sales manager, F&I by default): the home page's **Chiffres du mois** — ten captioned tiles, the « À surveiller » tables (stale deals; delivered-not-funded), chartless bars — over `GET /api/v1/reports/gm-dashboard`, every figure SQL-measured on the store clock with the window returned on the wire; a salesperson's home page shows no figures and requests no report (F-78) |
| Take a commission back (clawback) | As owner/GM/F&I (« Reprise de commission » authority): **Commissions** → « Reprise… » on the line → reason + amount (partial ≤ original) → « Confirmer la reprise » — writes exactly ONE negative « Reprise » line into the CURRENT pay month (a closed month never restates); one reversal per commission line, definitive (D-080's ⚠ decision); the seller is notified with the amount, the confirming actor is not (F-79) |
| Manage your lenders and name the bank on a deal | **Réglages → Prêteurs** — the 18 seeded Canadian auto lenders (Prime / Quasi-prime / Subprime / Captif), editable under « Gérer les prêteurs » authority (owner, GM, F&I by default); deactivating removes a lender from NEW desking picks only — history keeps its name. On a deal's desking screen, the **Prêteur** select writes `deals.lender_id`; the name renders beside the funding status (F-80). On the same worksheet, **Soumissions aux prêteurs** logs what each lender answered — platform, status, buy/sell rates, ceiling, term, the lender’s quoted payment, conditions, expiry — and « Choisir cette approbation » writes the deal’s lender, rate and term and the engine recomputes; the card’s payment is the lender’s quote, the worksheet’s is the deal’s (F-81). Rates still never ride the registry |
| Log what each lender answered on a deal, and make the deal follow one approval | On a SAVED deal’s desking screen, the **Soumissions aux prêteurs** card — one card per submission (a lender re-shopped after a decline gets a second card): platform (DealerTrack / CreditApp / RouteOne / Manuelle), status (Soumise / Approuvée / Conditionnelle / Refusée), buy and sell rates with the spread computed for display, the approved ceiling, the term, the lender’s quoted payment (captioned as theirs), conditions with a « Conditions remplies » tick, expiry — over `GET`/`POST /api/v1/deals/:id/submissions`, `PATCH /api/v1/submissions/:id` and `POST /api/v1/submissions/:id/select`. Writing needs the deal-editing authority (`deal:update`: owner, GM, sales manager, used-car manager, F&I, salesperson and admin office by default); every member reads. « Choisir cette approbation » writes the lender, the sell rate and the term onto the deal and the engine recomputes — the open worksheet is rewritten too, so the next save keeps them; an approval past its expiry on the STORE’s clock cannot be chosen; the ceiling only warns. Nothing is ever deleted: a status moves back, a wrong lender or platform is corrected in place on an unchosen row, and the chosen row’s rate / term / lender are locked until it is unchosen (F-81) |
| Format                 | `pnpm format` / `pnpm format:check` |

**Local services.** `docker compose up -d` starts Postgres and Redis. Host ports
default to 5434 and 6381 and are overridable — the owner runs other projects
that have taken both ranges before:

```
DEALPILOT_DB_PORT=5436 docker compose up -d
DB_ADMIN_URL=postgresql://dealpilot:dealpilot@localhost:5436/dealpilot pnpm test
```

`DB_ADMIN_URL`, `DATABASE_URL`, `RLS_REQUIRED`, `REDIS_URL` and `CI` are the only
env vars Turborepo passes through (`turbo.json` `globalPassThroughEnv`); anything
else is stripped before a task runs, which reads as a phantom failure.

**End-to-end suite: one command, its own database.** `pnpm e2e`
(`scripts/e2e.mjs`) is the only way to run the Playwright suite, and CI's e2e
step is the same call with no `env:` block — a green run here and a green run
there are the same program (F-74, D-075). It builds the graph, resets
`dealpilot_e2e_test` from migration zero, starts the API on **3101** and the
SPA on **5176** — off the dev ports, so `pnpm dev` can stay up — and refuses
rather than adopts when anything already answers on those two ports (usually
an orphan of a crashed run; the message says how to find it). A second
`pnpm e2e` while one is running is refused by a pid lock. Forward Playwright
flags through the runner: `pnpm e2e -- --headed --grep console-door`. A bare
`playwright test` refuses to load, and `--retries` is refused because the
console journey's first-staffer bootstrap is a one-shot per reset.

The runner's only connection to the dev database is host-shaped: the
maintenance base for `CREATE DATABASE` names `dealpilot` and reads nothing.
Precedence: an explicit `DB_ADMIN_URL` wins; `DEALPILOT_DB_PORT` feeds the
default only when it is unset. Redis is shared with the dev stack on purpose
(a logical `/1` index would split the queues from pub/sub — D-075): with
`REDIS_URL` set, an e2e-enqueued job would be consumed by a worker process on
the same Redis, but `apps/workers` has no dev script, so `pnpm dev` never
starts one and the exposure needs a hand-run
`pnpm --filter @dealpilot/workers start`.

Integration suites target `dealpilot_test`, created on demand, so the dev
database survives. Never point `db:reset` at `DATABASE_URL` — it resolves to the
owner's dev database (it wiped the seeded account three times).

## Conventions

- **Code style:** ESLint + Prettier (the linter config is the source of truth); no `console.*` (pino only); no `any` without a justifying comment.
- **Branch naming:** `main` protected (every prod change is a PR), `develop` is the integration branch; work branches are `ahmad/<slug>` and `hussein/<slug>` per the two-agent parallel build (D-012).
- **Commit style:** Conventional Commits (`feat:`, `fix:`, `chore:`…).
- **Test file location:** alongside source (`*.test.ts` next to the module); Playwright e2e suites live with the app they exercise.

## Boundaries

- **Never touch:** `reference/kia-tracker-specs/` (and the sibling `../kia-tracker-specs/` on the desktop) — read-only reference for the plan and legacy business rules. No code lands there; legacy data is test data and is never migrated (ADR-026 clean start).
- **Secrets live in:** env vars locally (`.env` git-ignored, committed `.env.example`); AWS Secrets Manager injected into ECS task definitions in deployed environments; GitHub Actions environment secrets for deploy time. Never in source, git, logs, or prompts.
- **External services:** AWS account 242626139373 (CLI profile `Dealpilot`, admin — provisioned by owner 2026-07-24 for both agents; region ca-central-1; SES for email per D-029), Twilio, Stripe, Anthropic (Claude API), Sentry, PostHog (EU), Better Stack, GitHub.

## Quality bar for this project

- **Minimum test expectation:** per CLAUDE.md — every new behavior and bug fix gets a test; **90%+ coverage on money/auth/data-integrity paths** (`packages/core` carries a hard ≥90% CI gate, NFR-QUAL-002) with golden-number tests for every tax/desking/commission path.
- **Performance budget:** p75 LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1; API p95 < 300 ms; intake ACK p99 < 1 s; AI first touch < 60 s (NFR-PERF).
- **Accessibility target:** WCAG 2.2 AA — both themes, both locales (FR/EN); tenant brand colors auto-validated for contrast (NFR-ACC).
- **Browser/device support:** evergreen — last 2 major Chrome, Edge, Firefox, Safari (desktop + iOS/Android); mobile-responsive down to 360 px width, no horizontal page scroll; no IE/legacy Edge (NFR-DEV).
