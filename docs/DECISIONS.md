# DECISIONS.md — Decision Log (lightweight ADRs)

> Newest on top. Claude: add an entry whenever a choice is made that someone
> could later ask "why is it like this?" about — library picks, architecture,
> API shapes, tradeoffs, rejected alternatives. Never delete entries; if a
> decision is reversed, add a new entry that supersedes the old one and
> cross-link them.
>
> **Founding decision set:** the 26 canonical ADRs (ADR-001…ADR-026) in
> `../../kia-tracker-specs/docs/new/00-overview/ARCHITECTURE-DECISIONS.md` govern
> the whole build. Entries below either adopt them or record owner decisions on
> top of them; on conflict, a newer entry here supersedes.

## Format

```markdown
## D-NNN: <title> (YYYY-MM-DD)

**Status:** accepted | superseded by D-NNN
**Context:** the problem or force that made a decision necessary
**Decision:** what was chosen (one sentence, imperative)
**Alternatives considered:** what was rejected and why
**Consequences:** what this makes easier / harder; any follow-up work created
**Decided by:** user | claude-proposed-user-approved
```

---

<!-- Entries begin below. Do not delete this line. -->

## D-018: Feature-based delivery with owner acceptance gate (2026-07-24) [AHMAD]

**Status:** accepted
**Context:** The owner wants visible, testable progress and confidence: after
the infrastructure/foundation stage, features must not pile up half-integrated.
**Decision:** After Sprint-1 foundation, all work is organized as vertical
feature slices (`F-nn`): one user-visible feature at a time, both agents build
it together, and it reaches `ACCEPTED` only after the OWNER personally tests
and confirms it. No new feature starts while one awaits owner testing.
Bundles (features that only work together) are declared up front and accepted
as a unit. Full protocol: TEAM-WORKFLOW.md §12.
**Alternatives considered:** free-flowing parallel tracks (rejected — integration
debt and nothing demonstrable); milestone-only demos (rejected — feedback
arrives too late to steer).
**Consequences:** slightly lower raw throughput, much tighter feedback loop;
the board gains F-rows with AWAITING-OWNER-TEST/ACCEPTED statuses; every
feature ships with "how to test" instructions for the owner.
**Decided by:** user

## D-019: GitHub adoption incoming; Stitch on best free-tier model (2026-07-24) [AHMAD]

**Status:** accepted
**Context:** Owner will provide a GitHub repo so HUSSEIN can also work from a
laptop with the same account; and instructed that Stitch (H-01+) should use the
best model available **within the free tier** — never paid options.
**Decision:** When the owner provides the repo URL (+ `gh auth login`), GitHub
becomes `origin` (all branches pushed, `main` protected); the local bare repo
`../readyloans.git` is retired or kept as a mirror. Until then the local bare
remote stays. HUSSEIN: select Stitch's highest-quality mode that is free
(e.g. experimental/Pro mode within free generation limits) and stay inside
free-tier quotas.
**Consequences:** laptop workflow unlocked at GitHub adoption; A-02 (CI)
becomes actionable then. Design quality maximized at zero design-tool cost.
**Decided by:** user

## D-016: ts-rest 3.52 on zod 4 — accepted peer-dependency mismatch (2026-07-24) [AHMAD]

**Status:** accepted (re-evaluate at A-05)
**Context:** `@ts-rest/core@3.52.1` declares `zod ^3.22.3` as a peer, but the
platform standard is Zod 4 (ADR-016). Code review verified empirically that
import, `checkZodSchema`, and error responses all work against the built
`apiV1` contract on zod 4.4.3.
**Decision:** Ship A-03 on ts-rest 3.52 + zod 4; re-verify the pairing when
`@ts-rest/fastify` lands in A-05 and upgrade ts-rest if a zod-4-supporting
release exists then.
**Alternatives considered:** downgrade to zod 3 (rejected — ADR-016 fixes
zod 4 as the shared validation standard); drop ts-rest (rejected — typed
contract between the two agents is load-bearing for the workflow).
**Consequences:** a known-unsupported pairing is in the tree; risk isolated to
`packages/contracts` and surfaced at A-05 integration. Regression tests on the
contract package guard the behavior we rely on.
**Decided by:** claude-proposed (AHMAD), per code-review finding 11

## D-017: A-03 schema conventions — defaults, strictness, spec vocabularies (2026-07-24) [AHMAD]

**Status:** accepted
**Context:** Code review of A-03 found zod defaults leaking through `.partial()`
into PATCH inputs (an empty PATCH reset entities to defaults), strip-mode
inputs accepting unknown keys, and invented status vocabularies.
**Decision:** (1) Create inputs carry defaults; update inputs are explicit,
strict, defaults-free objects — regression-tested. (2) All request inputs are
`z.strictObject`. (3) Vocabularies are spec-exact: org status 7-value +
plan_tier from multi-tenancy.md §3; store status active/paused/closed;
membership status invited/active/revoked; lead source 19-value enum +
source_platform from leads.md §2.1. (4) Locale = `fr-CA`/`en-CA` (resolves the
spec's `fr`/`en` vs `fr-CA`/`en-CA` tension in favor of full BCP-47 tags,
default `fr-CA`). (5) Lead phone is the required contact channel (leads.md §1);
lead `score`/`status` are engine-owned, never client inputs on create.
**Consequences:** A-04 can generate DB CHECK constraints directly from these
enums; H-03 consumes a stable published contract; any vocabulary change is a
deliberate schema-package change, not an ad-hoc edit.
**Decided by:** claude-proposed (AHMAD), from code-review findings 1–10

## D-015: TypeScript backend re-confirmed (2026-07-24)

**Status:** accepted
**Context:** The database-platform re-plan (D-013) prompted the owner to re-check the backend language choice before build start.
**Decision:** Keep the backend on TypeScript — Fastify v5 on Node.js 22, TypeScript 5.9 `strict` across the whole monorepo (ADR-001/003 stand unchanged).
**Alternatives considered:** none seriously — re-confirmation, not a re-opening; the shared Zod contracts and single-language monorepo remain the rationale.
**Consequences:** No change to any plan or task; recorded so the re-confirmation is traceable.
**Decided by:** user

## D-014: Better Auth re-confirmed after Cognito comparison (2026-07-24)

**Status:** accepted
**Context:** With the move to single-vendor AWS (D-013), Amazon Cognito was compared as the AWS-native auth option.
**Decision:** Keep Better Auth 1.3+ (organization plugin, 10 roles, memberships, MFA, HTTPS-only cookies) as the auth stack — re-confirmed by the owner.
**Alternatives considered:** Amazon Cognito (rejected: no native organization/membership model matching Platform → Org → Store, weaker white-label fit, per-MAU pricing; ADR-006 alternatives already rejected Supabase Auth and Clerk).
**Consequences:** Zero auth rework — Better Auth was never Supabase-dependent; its tables simply live in RDS now (ADR-006 consequences note amended 2026-07-24). A-05 scope is unchanged.
**Decided by:** user

## D-013: Amazon RDS for PostgreSQL over Supabase (2026-07-24)

**Status:** accepted
**Context:** ADR-008 had chosen Supabase Postgres; the owner wants single-vendor AWS and VPC-private networking, and RDS was already the documented exit path (ADR-014). Taken before build start, the exit costs nothing — no data, code, or cutover exists to migrate.
**Decision:** Run the database on Amazon RDS for PostgreSQL 16 in `ca-central-1` — VPC-private (no public accessibility; ingress only from ECS task security groups), KMS-encrypted gp3, deletion protection, automated backups + PITR, credentials in Secrets Manager, RDS Proxy pooling at launch (`SET LOCAL` tenant context is proxy-safe); dev = local Docker Postgres, staging = db.t4g.small Single-AZ, prod = Multi-AZ db.t4g.medium (ADR-008 rewritten 2026-07-24).
**Alternatives considered:** Supabase Postgres (previous decision — superseded; its bundled Realtime/Storage/branching move to the documented fallbacks: Socket.IO + Valkey (ADR-004), S3 + sharp + CloudFront (ADR-013), testcontainers + staging snapshot restores (ADR-023)); Neon (better branching, not needed); Aurora (cost/complexity unwarranted at this scale).
**Consequences:** Single-vendor AWS — one region, one jurisdiction, one bill; no service-role key exists at all (workers use scoped DB roles from Secrets Manager); dev DB access via bastion/SSM only; RLS/tenant model unchanged (ADR-007). Cost: build phase ~US$28–30/mo (inside the old Supabase range), production ~US$140–170/mo (+~$95–115) — production envelope restated ~US$750–1,100/mo (ADR-014). A-04 re-scoped: local Docker Postgres + RDS via IaC instead of a Supabase project.
**Decided by:** user

## D-012: Two-agent parallel build — AHMAD & HUSSEIN (2026-07-23)

**Status:** accepted
**Context:** Two Claude Code accounts are available; the build plan has parallelizable tracks.
**Decision:** Execute the build with two parallel agents personified as AHMAD and HUSSEIN: `main` protected, `develop` as integration branch, work branches `ahmad/<slug>` and `hussein/<slug>`.
**Consequences:** Task IDs are prefixed A-nn / H-nn; each agent self-reviews and the other reviews on merge to `develop`; SESSION_LOG entries name the agent.
**Decided by:** user

## D-011: AI error assistant (2026-07-23)

**Status:** accepted
**Context:** Dealership staff are non-technical; raw error surfaces cost support time.
**Decision:** Ship an AI-powered error assistant that turns user-facing errors into plain-language FR/EN explanations and suggested next steps.
**Consequences:** Needs a spec before implementation (scope, model task in `packages/ai`, no PII/secret leakage into prompts); complements — never replaces — the structured `AppError` envelope.
**Decided by:** user

## D-010: Blue-green deploys (2026-07-23)

**Status:** accepted
**Context:** ADR-014/023 defaulted to ECS rolling deploys with a circuit breaker, listing CodeDeploy blue/green as optional later hardening.
**Decision:** Adopt blue-green deployments (CodeDeploy on ECS) with automatic rollback as the production deploy strategy, promoting the ADR's optional path to the default.
**Consequences:** Cleaner instant rollback and traffic-shifted canaries; slightly more CI/CD and IaC setup in Phase 0/infra tasks; supersedes the rolling-deploy default in ADR-014/023.
**Decided by:** user

## D-009: Stitch-first design selection (2026-07-23)

**Status:** accepted
**Context:** The UI needs a professional visual direction before `packages/ui` theming is built; the owner wants to choose from concrete options, not descriptions.
**Decision:** Select the design direction Stitch-first — generate candidate designs in Google Stitch, have the owner pick, and use the selected design to seed the `packages/ui` design system.
**Consequences:** Hussein's first task (H-01) is the Stitch design round; UI build waits on the selection; tokens/themes derive from the chosen design.
**Decided by:** user

## D-008: No Tailwind Plus — professional UI via Tailwind v4 + shadcn/ui (2026-07-23)

**Status:** accepted
**Context:** ADR-017 and open question Q-09 carried Tailwind Plus ($299) as an optional purchase for marketing/site chrome.
**Decision:** Do not purchase Tailwind Plus; achieve the professional UI bar with Tailwind CSS v4 + shadcn/ui (Base UI) alone.
**Consequences:** Closes Q-09; any marketing chrome is built from the same design system; AG Grid Enterprise remains deferred per ADR-017.
**Decided by:** user

## D-007: Commercial VIN decode service (2026-07-23)

**Status:** accepted
**Context:** Free NHTSA vPIC data is weak on Canadian-market vehicles.
**Decision:** Use a commercial Canadian-aware VIN decode service (e.g., DataOne), selected by a short accuracy evaluation; NHTSA vPIC is a development-only fallback, never production (ADR-016 amendment).
**Consequences:** Adds a paid provider + an evaluation task before inventory/desking VIN features ship.
**Decided by:** user

## D-006: Lead intake as a configuration-driven connector framework (2026-07-23)

**Status:** accepted
**Context:** Lead sources churn constantly; hand-coded parsers per source don't scale.
**Decision:** Build `apps/intake` as a generic connector framework — every source is a connector definition (transport, field mappings, auth/signature, dedupe key, consent basis) as data, not code (ADR-005 amendment).
**Consequences:** Known sources ship as built-in definitions; any new source is added via configuration alone.
**Decided by:** user

## D-005: Model-agnostic AI layer (2026-07-23)

**Status:** accepted
**Context:** Model quality/pricing shifts faster than release cycles; hardcoding models creates lock-in.
**Decision:** Make the AI layer model-agnostic — Claude Opus 4.8 (conversation) and Haiku 4.5 (extraction) are launch defaults chosen by a built-in eval/A-B harness in `packages/ai`; model assignments are configuration, swappable per tenant and per task without code changes (ADR-022 amendment).
**Consequences:** The eval harness is a build deliverable, not an afterthought; model choices are re-evaluated as new models ship.
**Decided by:** user

## D-004: Admin-managed pricing (2026-07-23)

**Status:** accepted
**Context:** Pricing changes must not require deploys or hand-edits in the Stripe dashboard.
**Decision:** Manage subscription plans, prices, and entitlements entirely from the platform admin console — Stripe products/prices created/updated via API from the admin UI, with per-tenant overrides and grandfathering; pricing is data, not code (ADR-024 amendment).
**Consequences:** Admin console scope grows (plan editor); billing/entitlement/quota reads all derive from the same tenant record.
**Decided by:** user

## D-003: Clean-start database — no legacy data migration (2026-07-23)

**Status:** accepted
**Context:** The owner confirmed all legacy tracker data is test data with no production value.
**Decision:** Launch production with a clean, empty database plus seed/reference configuration; no ETL, no reconciliation, no dual-run — the legacy system stays a business-rules reference only (ADR-026 amendment).
**Consequences:** Drops an entire migration workstream; commission plans and store config are entered fresh at tenant onboarding and validated against legacy rules; NFR-DATA-011 (migration fidelity) is void.
**Decided by:** user

## D-002: AWS hosting in ca-central-1 (2026-07-23)

**Status:** accepted
**Context:** Earlier topology drafts used Railway/Vercel; those keep compute outside Canada and lack enterprise procurement credibility.
**Decision:** Host all platform compute on AWS `ca-central-1` — CloudFront+S3 SPA, ECR + ECS Fargate behind ALB, WAF, Secrets Manager, KMS, Route 53 — with a minimal footprint during the build phase and the full production envelope (~$650–1,000/mo) only from launch (ADR-014).
**Alternatives considered:** Railway/Fly.io (cheaper, faster, but non-Canadian compute regions).
**Consequences:** Full Canadian residency for compute + data (Law 25); IaC (Terraform/CDK) in the monorepo is mandatory from day one; higher ops effort accepted by the owner.
**Decided by:** user

## D-001: Adopt the 26 founding ADRs as canonical (2026-07-23)

**Status:** accepted
**Context:** The planning phase produced 57 docs; the build needs a single decision authority.
**Decision:** Adopt ADR-001…ADR-026 in `../../kia-tracker-specs/docs/new/00-overview/ARCHITECTURE-DECISIONS.md` (dated 2026-07-21, amended 2026-07-23) as this project's founding decision set — every spec and implementation conforms; deviations require a superseding entry.
**Consequences:** Conflicts between older specs and the ADRs resolve to the ADRs; this log records only adoptions, amendments, and new decisions on top of them.
**Decided by:** user
