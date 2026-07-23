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

## D-024: H-01 design direction locked — "Nordique" is the token source of truth (2026-07-23) [HUSSEIN]

**Status:** accepted (initially recorded as D-023; renumbered after a same-day
numbering collision with [AHMAD]'s D-022 — his push reached origin first)
**Context:** H-01 (D-009, ADR-017 amended): five design directions were generated
in Google Stitch and presented on a comparison board; the owner picked this
session. Locked values below are the source of truth H-02 encodes in
`packages/ui` (primitive → semantic → component CSS custom properties).
**Decision:** The platform default theme is **Direction 1 "Nordique"** —
light-first, neutral surfaces, blue primary, Inter, 8 px radius.

*Primary ramp (Tailwind blue, OKLCH):* 50 `oklch(0.970 0.014 254.6)` ·
100 `oklch(0.932 0.032 255.6)` · 200 `oklch(0.882 0.057 254.1)` ·
300 `oklch(0.809 0.096 251.8)` · 400 `oklch(0.714 0.143 254.6)` (#60A5FA) ·
500 `oklch(0.623 0.188 259.8)` (#3B82F6) · 600 `oklch(0.546 0.215 262.9)`
(#2563EB) · 700 `oklch(0.488 0.217 264.4)` (#1D4ED8).

*Semantic assignment (light):* `--primary` = blue-600 (interactive fills/links —
white foreground 5.17:1, link on page 4.82:1, both AA); blue-500 = brand accent
(charts, focus ring `--ring`, non-text UI — 3:1 class only, never text on white).
*Dark:* `--primary` = blue-400 with near-black foreground (6.64:1; as link text
6.61–7.42:1 AA). White-on-blue-500 (3.68:1) and white-on-blue-400 (2.54:1) are
forbidden text pairings.

*Neutrals (KIA-Command structure, §3.1 of ui-design-system.md):* light — page
#F5F7FA `oklch(0.975 0 0)`, card #FFFFFF, input #F9FAFB, border #E5E7EB /
subtle #F3F4F6, text #1A1D23 (15.7:1) / secondary #6B7280 (4.50:1 AA) / muted
#9CA3AF; dark — page #0F1117 `oklch(0.178 0.013 270.6)`, sidebar #141720, card
#1A1D27, elevated #232738 (elevation via lighter surfaces, not shadows), border
#2A2D3A / subtle #1F2231, text #F0F2F5 (15.0:1) / secondary #9CA3AF (6.62:1) /
muted #6B7280.

*Status colors (platform, not tenant-themable):* success #10B981/#34D399,
warning #F59E0B/#FBBF24, danger #EF4444/#F87171, info #6366F1/#818CF8
(light/dark). As badge/UI fills only (≥3:1 with computed foregrounds); any
status color used AS text gets a derived `-text` variant meeting 4.5:1 (the
ui-design-system §12 auto-fix pattern) — exact ramp values land in H-02 with
the same contrast script.

*Typography:* **Inter** (300–700), self-hosted WOFF2 (no font CDN — Law 25);
scale per ui-design-system §4; `tabular-nums` mandatory on money/number columns.
*Radius:* **0.5rem (8 px, `md`)**. *Density:* `comfortable` default (44 px
rows) + `compact` mode (34–36 px) as a token swap.

**Alternatives considered:** Boréal (teal, r12 — distinctive but collides with
teal/cyan pipeline-stage chips), Indigo Atelier (primary identical to the info
status color), Ardoise et Ambre (primary identical to the warning token;
dark-first inverts the platform default), Rouge Concession (red primary reads
as danger platform-wide). Nordique is the only direction with zero
semantic-color collisions and the strongest white-label canvas.
**Consequences:** H-02 encodes these as the `packages/ui` token layers, themes
shadcn/ui against them, and proves both themes ≥4.5:1 text contrast; tenant
branding still overrides semantic tokens at runtime (ADR-018). Stitch renders
(projects "ReadyLoans H-01 — Direction 1–5") remain reference only. Comparison
board artifact regenerated on the laptop account:
https://claude.ai/code/artifact/dc86eca3-b71f-452c-a046-24cb54d06b12
**Decided by:** user (owner pick: "go with 1")

## D-023: Product name amended — "Dealpilot" → "1Dealer" (2026-07-23) [HUSSEIN]

**Status:** accepted (amends D-020 §1; D-021 domain unchanged; initially
recorded as D-022 — renumbered after the same-day collision noted in D-024)
**Context:** Owner instruction this session while confirming the H-01 design
pick; verified with the owner that the domain stays `1dealer.ca` (".co" in the
original message was a typo) and the rename is real, not domain-only.
**Decision:** The product/brand name is **"1Dealer"** (domain `1dealer.ca`,
matching D-021). All new user-facing naming (UI wordmark, login page, emails,
docs, AI persona default copy) says "1Dealer"; "Dealpilot" and "ReadyLoans"
are historical.
**Consequences:** White-label default branding (H-02+) uses "1Dealer".
Engineering identifiers are NOT renamed by this entry — package scope
`@dealpilot/*`, repo name `FOURDE1/Dealpilot`, and root package name are
AHMAD's zone; folding the identifier rename into the A-09 doc/rename sweep (or
deciding to keep the scope as-is) is flagged for AHMAD in the session log.
**Decided by:** user

## D-022: A-04 database conventions — tenant key naming, RLS write rules, role credentials (2026-07-24) [AHMAD]

**Status:** accepted
**Context:** Code review of the foundation migration (2 critical findings, both
verified live against Postgres) plus naming divergence between the plan docs
and the A-03 schemas.
**Decision:**
1. **`organization_id` is the canonical tenant key** (GUC `app.org_id`) —
   matching `@dealpilot/schemas` (A-03), superseding the plan docs' `tenant_id`
   naming. Future CI lints/pgTAP templates adapt to this, not vice versa.
2. **`WITH CHECK (true)` is banned in practice as in policy:** every write
   policy requires tenant context at minimum (`app.org_id IS NOT NULL`);
   user visibility flows only through ACTIVE memberships.
3. **Same-org structural integrity by FK:** `memberships(organization_id,
   store_id)` references `stores(organization_id, id)` — a membership can
   never point at another org's store.
4. **No credentials in git:** `dealpilot_app` is created NOLOGIN by the
   migration; LOGIN + password granted per environment (dev: local `db reset`
   bootstrap; staging/prod: Secrets Manager at provision).
5. **User INSERT+RETURNING is impossible by design** (SELECT policy needs a
   not-yet-existing membership) — A-05 creates users with client-generated
   uuids, user + membership in one `withTenant` transaction.
6. Deferred columns noted for later migrations: `organizations.country`,
   `stores.tax_region`, `memberships.invited_by/revoked_at`, `deleted_at` on
   users/memberships.
**Consequences:** RLS suite covers fail-closed reads, cross-tenant
INSERT/UPDATE, membership-gated user visibility; `RLS_REQUIRED=1` makes CI
fail rather than skip when the DB is absent. Local Postgres runs on host port
5434 (5432/5433 occupied by unrelated local projects).
**Decided by:** claude-proposed (AHMAD), from code-review findings

## D-021: Domain = 1dealer.ca; terminal-git workflow, no pull requests (2026-07-24) [AHMAD]

**Status:** accepted (amends D-019/D-020 and TEAM-WORKFLOW §7)
**Context:** Owner decisions after GitHub adoption.
**Decision:** (1) The product domain is **`1dealer.ca`** (not dealpilot.ca) —
use it for the app, tenant subdomains (`<store>.1dealer.ca`), email sending
domain, and API host planning; product name remains Dealpilot. (2) The git
workflow is **terminal-only**: no pull requests, no GitHub UI dependencies, no
server-side branch protection — feature branches are squash-merged into
`develop` locally and pushed; `main` stays release-only by protocol rule.
GitHub is the shared remote (also enables the laptop) and A-02 CI runs on
**push** to develop/main rather than on PRs.
**Consequences:** faster flow, discipline enforced by TEAM-WORKFLOW rules +
quality gates instead of server settings; CI still guards every push once A-02
lands. Domain configuration (Route 53, ACM, Resend, Better Auth URLs) targets
1dealer.ca everywhere.
**Decided by:** user

## D-020: Client answers received — platform is "Dealpilot"; five decisions closed (2026-07-24) [AHMAD]

**Status:** accepted
**Context:** The client (Hassan Al Khansa, 2026-07-23) answered all five open
questions from `reference/kia-tracker-specs/docs/new/00-overview/CLIENT-QUESTIONS.md`.
**Decision:**
1. **Name = "Dealpilot"** — packages renamed `@dealpilot/*`, root `dealpilot`,
   repo `github.com/FOURDE1/Dealpilot`. Plan docs keep "ReadyLoans" historically
   (same product); deep doc rename is backlog task A-09.
2. **Lead volume:** plan for 300+/month per dealership across all sources
   (no exact split available) — sizes AI budget and queue capacity.
3. **Bill of sale:** Merlin & other platforms keep producing it for now;
   Dealpilot's own BOS ships as an optional per-store feature.
4. **Delivery checklist:** per-store BACKEND CONFIGURATION — each store selects
   which checklist items are absolutely necessary (gating) vs optional. Ships
   as store settings; the QC/ON difference is configuration, not code.
5. **Wholesale:** access is granted per-user by the main admin — a grantable
   permission, not a fixed-role assumption.
**Consequences:** GitHub becomes origin (D-019 executed); reference material
(plan + legacy code) imported into the repo at `reference/` so any machine is
self-contained; A-09 doc-rename sweep queued.
**Decided by:** user (client answers relayed by owner)

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
