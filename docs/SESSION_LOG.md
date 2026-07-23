# SESSION_LOG.md — Persistent Memory

> Newest entry on top. Claude: update this at the end of every working session
> (or when the user runs `/session-save`, or before context gets long).
> Keep entries short and factual — this file is what future sessions read first.
> Prune entries older than ~20 sessions into `docs/archive/SESSION_LOG-<year>.md`.

## Format for each entry

```markdown
## YYYY-MM-DD — <one-line summary>

**Done:** what was completed and verified (with file paths)
**In progress:** what is half-finished and exactly where it stands
**Blocked / open questions:** anything waiting on the user or an external factor
**Decisions:** link to DECISIONS.md entries added this session
**Gotchas learned:** non-obvious things discovered (env quirks, flaky tests, API surprises)
**Next steps:** the first 1–3 things the next session should do
```

---

<!-- Entries begin below. Do not delete this line. -->

## 2026-07-24 [AHMAD] — A-03 DONE: contract published (31f5f28); origin is local bare repo

**Done:** A-03 complete and merged to develop as **31f5f28** — THE publication
event. `@readyloans/schemas`: zod-4 schemas with sanitization built in (E.164
phone, lowercase email, postal `A1A 1A1`, integer cents), spec-exact
vocabularies (10 roles + MFA set, 10 lead statuses, 19 lead sources +
source_platform, org status 7-value + plan_tier, store active/paused/closed,
membership invited/active/revoked), strict inputs, create-only defaults
(update inputs defaults-free — regression-tested). `@readyloans/contracts`:
ts-rest `/api/v1` CRUD + cursor list + soft-delete for all 5 entities, error
envelope (incl. 409/429) on every route, OpenAPI stub for A-05.
**Test/build status (evidence):** turbo build+typecheck 22/22; vitest 19/19;
eslint clean. Code-reviewer subagent found 5 CRITICAL + 9 MINOR — all fixed
(see D-016/D-017); the defaults-leak bug was verified real before fixing.
**Also this session:** A-01 closed at DONE(d4235a2) — owner chose git-only:
origin = local bare repo `../readyloans.git` (TEAM-WORKFLOW §3 updated with
HUSSEIN's clone command). A-02 deferred note (CI needs GitHub). Saw HUSSEIN's
H-01 claim land mid-session — rebase worked exactly as designed.
**For HUSSEIN:** the contract you code against is live on develop — `git pull`,
then import from `@readyloans/schemas` / `@readyloans/contracts`. H-03's
A-03 dependency is now DONE; only A-05 (auth contract) remains for the auth
screens. Locale vocabulary is `fr-CA`/`en-CA` (D-017) — use it in H-04.
**Next steps:** 1) A-04 db package + local Docker Postgres + migration 0001 +
RLS smoke test. 2) A-05 Fastify + Better Auth (unblocks H-03 fully). 3) A-06
money-math port when Sprint-1 track allows.
**Blockers:** none.

## 2026-07-24 [AHMAD] — Repo genesis + monorepo scaffold (A-01 local scope complete)

**Done:** A-01 local scope. `git init -b main` in main-project; genesis commit
0ab88a1 (CLAUDE.md, docs/, .claude/, .mcp.json, README, .gitignore, .env.example);
`develop` branched; scaffold built on `ahmad/monorepo-scaffold` and squash-merged
to develop as **d4235a2**: pnpm+Turborepo workspace — apps/{web,api,workers,intake},
packages/{db,schemas,contracts,core,ui,i18n,ai} as compiling stubs; TS 5.9 strict
base (noUncheckedIndexedAccess, verbatimModuleSyntax); ESLint 9 flat +
typescript-eslint; Prettier; vitest; pnpm catalog pins typescript; .gitattributes
LF; repo-local git identity Hassan <hassan@readycar.ca>.
**Test/build status (evidence):** `pnpm install` clean (17.3s, pnpm 10.26.1, install
scripts blocked by default per CLAUDE.md); `pnpm turbo run build typecheck` →
22/22 tasks successful; `pnpm lint` exit 0; `pnpm test` exit 0 (--passWithNoTests;
no tests exist yet — stubs only).
**Blocked / open questions:** A-01 remainder needs the OWNER: `gh auth login`
(gh 2.95 installed, not authenticated), GitHub org/repo name, push approval,
then branch protection on `main`. Board row set BLOCKED accordingly.
**Note for HUSSEIN:** the Stitch MCP **is now connected** (user-scope, verified
HTTP 200 with real key; tools build_site/get_screen_code/get_screen_image) — the
H-01 "not yet connected" note is stale; you can start H-01 in any fresh session.
Until A-01 push is done, no repo clone for you (per TEAM-WORKFLOW §3) — H-01
needs no repo. Also: `../kia-tracker-specs` is readable without permission
prompts (additionalDirectories) and TEAM-WORKFLOW gained §2.1 onboarding +
§2.2 async-mode sections — read them at bootstrap.
**Next steps:** 1) Owner unblocks GitHub → finish A-01 (push, protect, verify
clone). 2) A-02 CI pipeline. 3) A-03 schemas/contracts baseline (publication
unblocks H-03).

## 2026-07-24 — DB platform switch: Supabase → Amazon RDS; docs aligned

**Done:** Owner decision (2026-07-24) recorded and propagated: the database moves
from Supabase to **Amazon RDS for PostgreSQL 16** in `ca-central-1` (VPC-private,
RDS Proxy at launch, KMS/gp3, backups + PITR); Better Auth re-confirmed after a
Cognito comparison; TypeScript backend re-confirmed. Canonical ADRs already
amended in `../kia-tracker-specs/docs/new/00-overview/ARCHITECTURE-DECISIONS.md`
(ADR-004 Socket.IO realtime, ADR-006 note, ADR-008 RDS, ADR-013 S3/CloudFront,
ADR-014/015/023 + stack table). Docs aligned this session: kia-tracker-specs —
`EXECUTIVE-SUMMARY.md` (target stack table), `ROADMAP.md` (Phase 0 item 0.7 RDS
via IaC, realtime rows, envelope restated), `OPEN-QUESTIONS.md` +
`OPEN-QUESTIONS-SIMPLE.md` (Q-08 cost table → RDS + S3 rows, envelope
~US$750–1,100/mo; Q-11 update notes), `functional-requirements.md` +
`non-functional-requirements.md` (Socket.IO/S3/RDS Proxy where Supabase was the
target), `README.md` (05-database description); main-project — `PROJECT.md`
(stack facts), `ARCHITECTURE.md` (overview + mermaid + data flow),
`DECISIONS.md` (D-013/D-014/D-015), `TASKS.md` (A-04 re-scoped to local Docker
Postgres + staging RDS via A-07 IaC).
**In progress:** nothing — still pre-build.
**Blocked / open questions:** unchanged — client answers pending in
`../kia-tracker-specs/docs/new/00-overview/CLIENT-QUESTIONS.md`; none block Phase 0.
**Decisions:** D-013 (RDS over Supabase), D-014 (Better Auth re-confirmed vs
Cognito), D-015 (TypeScript backend re-confirmed) in docs/DECISIONS.md.
**Gotchas learned:** Supabase mentions in legacy/as-is descriptions (old Kia
tracker, leaked-key rotation, audit findings) are intentional history — do not
"fix" them; realtime is now app-emitted Socket.IO events (no DB change-capture),
so emitters must tenant-scope every payload; there is no service-role key
anywhere in the target architecture; dev needs zero cloud resources (local
Docker Postgres).
**Next steps:** unchanged — (1) Ahmad A-01 scaffold; (2) Hussein H-01 Stitch
round; (3) both read the newest SESSION_LOG entry + PROJECT.md before starting.

## 2026-07-23 — Setup session: plan locked, scaffold adapted, ready for Phase 0

**Done:** Planning phase complete — 57 docs in `../kia-tracker-specs/docs/new/`
(canonical authority: `00-overview/ARCHITECTURE-DECISIONS.md`, 26 ADRs amended
2026-07-23 with owner decisions). Owner decisions locked and logged (D-001…D-012).
Scaffold adapted to ReadyLoans: `docs/PROJECT.md` (identity, stack, planned
commands, conventions, boundaries, quality bar), `docs/ARCHITECTURE.md` (target
system map), `docs/DECISIONS.md` (founding ADRs + 11 owner decisions),
`docs/SECURITY.md` (baseline, threat model, deferred-legal-review risk),
`README.md` (repo↔plan relationship). No code exists yet.
**In progress:** nothing — pre-build.
**Blocked / open questions:** client answers pending in
`../kia-tracker-specs/docs/new/00-overview/CLIENT-QUESTIONS.md` (final product
name, lead volumes, Merlin/CAMS role, ON-vs-QC checklist, wholesale authority);
none block Phase 0.
**Decisions:** D-001…D-012 in docs/DECISIONS.md (adopt 26 ADRs; AWS ca-central-1;
clean-start DB; admin-managed pricing; model-agnostic AI; connector framework;
commercial VIN decode; no Tailwind Plus; Stitch-first design; blue-green deploys;
AI error assistant; two-agent build AHMAD/HUSSEIN).
**Gotchas learned:** `../kia-tracker-specs/` is read-only reference — business
rules live in its code/specs, its data is worthless (never migrate); on any
conflict between older specs and the ADRs, the ADRs win; commands in PROJECT.md
are planned, not real, until A-01 lands.
**Next steps:** (1) Ahmad — A-01: `git init` + pnpm/Turborepo monorepo scaffold
(apps/web, api, workers, intake; packages/db, schemas, contracts, core, ui, i18n,
ai), then correct PROJECT.md commands against reality. (2) Hussein — H-01: Stitch
design round → owner selects the design direction (D-009). (3) Both: read the
newest SESSION_LOG entry + PROJECT.md before starting.
