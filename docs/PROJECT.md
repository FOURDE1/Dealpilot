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
- **Hosting / infra:** AWS `ca-central-1` (full Canadian residency): CloudFront + S3 (SPA), ECR + ECS Fargate behind ALB (min 2 API tasks / 2 AZs from production launch), AWS WAF, Secrets Manager, KMS, Route 53; GitHub Actions CI/CD (OIDC to AWS, no long-lived keys); Sentry + PostHog EU + OpenTelemetry + pino → Better Stack; Twilio (SMS/MMS + voice via ConversationRelay), Amazon SES ca-central-1 (email — D-029, owner decision; Resend rejected), Stripe Billing (admin-managed pricing); model-agnostic AI layer (Claude models as launch defaults, selected per task by the eval/A-B harness in `packages/ai`). Build phase runs a minimal infra footprint; the production envelope (~$750–1,100/mo, restated 2026-07-24 for the RDS move) activates at launch.

## Commands

> All commands are **(planned — the monorepo scaffold is Phase 0 task A-01;
> correct these the moment reality exists)**. Until then nothing here is runnable.

| Task                   | Command |
| ---------------------- | ------- |
| Install deps           | `pnpm install` (planned) |
| Run dev server / app   | `pnpm dev` (planned) |
| Build                  | `pnpm build` (planned) |
| Lint                   | `pnpm lint` (planned) |
| Type-check             | `pnpm typecheck` (planned) |
| Unit tests             | `pnpm test` (planned) |
| Integration/e2e tests  | `pnpm test:e2e` (planned) |
| Dependency vuln scan   | `pnpm audit` (planned) |
| Format                 | `pnpm format` (planned) |

## Conventions

- **Code style:** ESLint + Prettier (linter config is source of truth once scaffolded); no `console.*` (pino only); no `any` without a justifying comment.
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
