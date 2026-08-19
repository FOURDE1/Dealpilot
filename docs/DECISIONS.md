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

## D-046 — FR-LEAD-010 timer: fire-time verification, not job cancellation (2026-08-19)

**Context:** the 10-minute reassignment ladder (leads.md §5.2, :250-254). The
spec prescribes one BullMQ delayed job per lead keyed
`reassign:{lead_id}:{attempts}` "cancelled when a communication is logged".

1. **No cancellation plumbing — the job VERIFIES at fire time.** Cancelling
   requires every message-write path to reach into Redis; a fired job that
   re-checks the database needs nothing from anybody. The job carries
   `{lead_id, assigned_to, attempt}`; at fire time it no-ops as `obsolete`
   when the lead changed hands (assigned_to differs), attempts moved, the
   lead is terminal/deleted, or as `contacted` when an outbound AGENT message
   (sender_type='agent' — the assistant's sends do not count as the human
   contact the SLA demands) exists since assigned_at. Same behavior as
   cancellation, minus a distributed cache-invalidation problem.
2. **Which assignments start the timer:** every MACHINE assignment — cascade
   (assigned or escalated: leads.md:374 runs the timer after escalation too)
   and the §7.1 rules engine. A MANUAL assignment starts no timer this slice:
   a human chose a human; auto-take-away behind their back is a policy the
   owner should switch on knowingly (parked in OWNER-ACTIONS).
3. **The ladder ends at the 3-strike manager assignment** (method
   'escalation', history `escalation: three_strikes`). The manager does not
   get a fresh 10-minute timer — the spec ends the ladder with "direct
   assignment", and a timer that takes leads away from the person the ladder
   terminates AT would be a loop, not a ladder.
4. **Take-away restores the unowned invariant** (assigned_to/assigned_at/
   method NULL, status assigned→new) and appends
   `{user_id, assigned_at, reassigned_at, reason:'no_response'}` to
   previous_agents; the re-run is cascadeAssignLead with method
   'reassignment', which already excludes previous agents. Nobody eligible →
   the cascade's own escalation assigns the manager.
5. **"HIGH alert to sales manager / notify first agent"** is recorded as
   activity events only — the M9/H-class notification channels do not exist
   yet; they attach here when the notification slice lands.
6. **No queue configured = loud degradation, not failure** (the
   deferred-send precedent): the timer simply does not run, and each skipped
   enqueue is warn-logged with the lead id.

## D-045 — FR-LEAD-009 cascade: interpretations where the spec is silent (2026-08-19)

**Context:** leads.md §7.3 defines the post-handoff funnel (language → online →
on-schedule → least-loaded under `max_active_leads`, else escalate to the sales
manager) but leaves ~10 semantics unstated. This entry records the choices so
the owner can review them as a set; each is also documented at its code site.

1. **Unknown passes, known-false filters.** Presence and schedules are
   TRI-STATE inputs to the engine (`boolean | null`). `null` = the subsystem
   has no data (presence not yet built — FR-LEAD-014; user has no schedule
   rows) and the candidate PASSES that step. `false` = the subsystem
   affirmatively says unavailable → filtered. Rationale: a funnel that
   escalates every lead to the manager because an optional subsystem is not
   deployed is a funnel nobody turns on.
2. **Language is a HARD filter** — Bill 96 is law, not preference. No
   FR-capable agent for an FR lead → escalation, never an EN-only agent.
3. **Tie-break for "fewest active" = first-min in deterministic roster order**
   (membership created_at) — same rule as §7.2 load_balanced; randomness is a
   flake generator.
4. **"Escalate to sales manager" ASSIGNS the lead** (`assignment_method =
   'escalation'`), matching the 3-strike rule's explicit wording — an alerted
   but unowned lead is an unowned lead. Target = first active member holding
   sales_manager (fallback gm, then owner — someone must own it), chosen by
   membership age. Capacity does NOT block escalation.
5. **`assignment_method` mapping:** cascade writes `auto_language` when the
   language step actually narrowed the pool, else `auto_availability`; manual
   PATCH writes `manual`; escalation writes `escalation`; the FR-LEAD-010
   re-run will write `reassignment`. The §7.1 rules engine writes NULL — the
   Target vocabulary has no name for it, and inventing one would be vocabulary
   drift.
6. **`preferred_languages` defaults `'{fr-CA}'`, not the spec's `'{en}'`** —
   the platform is Quebec-first and users.language_pref already defaults
   fr-CA; backfilled from language_pref. Locale vocabulary stays 'fr-CA'/'en-CA'
   (the build's), not the spec's bare 'en'.
7. **The agent profile lives on MEMBERSHIPS, overriding the spec's
   users-level directive** (leads.md:263). The same-day adversarial review
   PROVED (live RLS probe) that users-level columns let one org's admin
   silently rewrite a shared agent's languages/cap and reshape ANOTHER org's
   routing, unaudited there. Org-scoped rows keep the write under the org
   that answers for it. The f04 PATCH writes the profile across ALL of the
   user's membership rows in the org, so a multi-store member never carries
   two competing profiles; the cascade reads one candidate per person
   (DISTINCT ON, oldest row). max_active_leads: default 10, CHECK 1–1000 —
   0 would mean "assign nothing", which is what revocation is for.
8. **Schedules:** rows live against a store (timezone anchor); a user with NO
   active rows is always-available (schedules are opt-in until the grid UI
   ships); windows are same-day only (`end > start`); split shifts = several
   rows. New permission `schedule:manage` (owner, gm, sales_manager,
   admin_office) — the catalogue grows by one, seeded for existing orgs in
   0049.
9. **History rows:** cascade writes `strategy = 'cascade'` (history CHECK
   extended in 0049; RULE CHECK unchanged — a rule cannot BE the funnel),
   `rule_id NULL`, `rule_name` naming the funnel step or escalation reason, so
   "why did Marc get this one" stays a query.
10. **Deferred to FR-LEAD-010 (next slice):** the 10-minute BullMQ timer,
    previous_agents WRITES, attempt counting, timer-cancellation semantics.
    The cascade already READS `previous_agents` and excludes them.
11. **Race rule:** the cascade's UPDATE re-checks `assigned_to IS NULL`; the
    loser of a concurrent assignment returns `already_assigned` and writes no
    history — the auto path never steals, even from itself.
12. **Known divergence, kept:** capacity counts treat `expired` as terminal
    (matching shipped F-40 and the 0047 index) although the spec's §4
    workload table counts it. Flipping it is FR-LEAD-012's call — that slice
    owns the `expired` lifecycle. Store timezones are now validated against
    `pg_timezone_names` at write time, because the cascade's schedule verdict
    would 500 the whole org on one typo'd zone (review finding).

## D-044 — MFA enforcement is deploy configuration, and it binds a named permission set (2026-08-19)

**Decision:** FR-AUTH-006's "MFA required for owner/gm/admin_office" is enforced
server-side inside `requirePermission` — but only for a five-entry blast-radius
set (`organization:update/delete`, `member:update_roles/revoke`,
`intake_key:manage`), and only when `REQUIRE_MFA=true` (default off, ON in the
production deploy config).

**Why a flag:** the same shape as `REQUIRE_EMAIL_VERIFICATION` (D-030 lineage) —
a hard gate with no flag would lock every fresh dev/test owner out of setup the
moment they created an org, and every existing e2e journey with it. Enforcement
is environment policy, not code.

**Why a named set, not all permissions:** gating everything would stop a
salesperson-facing owner from answering a lead until enrolment — punishment, not
security. The set binds exactly the powers that could weaken the policy itself
(change roles, change the org, mint standing intake credentials). The set is
typed `ReadonlySet<PermissionT>`, so a misspelled entry is a compile error, not
a silently dead gate (the dead-vocabulary lesson).

**Refusal contract:** 403 `mfa_enrolment_required` with the remedy named
(enrol at /security) — distinct from `forbidden`, because "your role may not"
and "your role must enrol first" are different conversations.

## D-043 — `fast-xml-parser` pinned to 4.5.7, not the current 5.x (2026-07-27)

**Decision:** add `fast-xml-parser@4.5.7` to `packages/core` for ADF lead
parsing. Owner approved the dependency 2026-07-27.

**Why the older major.** Version 5.10.1 is current, and it fans the package out
into six dependencies — `@nodable/entities`, `is-unsafe`,
`path-expression-matcher`, `xml-naming`, `fast-xml-builder`, `strnum` — all of
them first published within the last two months. Every one is published by the
same maintainer as the parser, so this is a refactor rather than a hijack, and
that was checked rather than assumed.

But six brand-new packages is six times the surface for a parser whose entire
job is reading hostile input from outside. 4.5.7 is the long-stable line, is 42
days old, and carries exactly one dependency (`strnum`, same author). The
lockfile diff was read: both resolutions are integrity hashes from the default
registry.

**Revisit when** the 5.x sub-packages have a year of history, or when 4.x stops
receiving security fixes — whichever comes first.

**Parser hardening.** Entity processing is switched OFF. fast-xml-parser does
not resolve external entities at all, so classic XXE file disclosure is not
reachable, but entity EXPANSION is — the "billion laughs" shape — and ADF leads
have no use for entities, so disabling it costs nothing and removes the class.
A 256 KB ceiling is applied before parsing.

---

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

## D-032: Bigger batches + a standing cross-agent listener (2026-07-25) [AHMAD]

**Status:** accepted — amends D-031 (2-3 slices per round).
**Context:** Owner 2026-07-25: "let the batch of testing be bigger so work is faster — but keep it professional", and "always put a listener between you and him, so when one stops the other continues — efficiently, without burning tokens".
**Decision (batch size):** a batch is now **3-5 feature slices**, still declared up front with per-agent halves, still one combined owner test round at the end. The **quality floor is unchanged and non-negotiable**: TDD red-first, adversarial review per slice before merge, full gate (build/typecheck/lint/tests/i18n parity) before every merge, CI green on develop, contract-first between agents. Bigger batches change how often the OWNER is interrupted — never how carefully the work is checked. A rejected slice never blocks its siblings.
**Decision (listener):** each agent ends a work stretch by arming a **cheap git watcher** on `origin/develop` rather than idling: a background poll (5-minute interval, one `git ls-remote` per tick, no model tokens burned while waiting) that wakes the session only when the other agent pushes. Wake-up rule: on wake, `git pull`, read the newest board rows + the other agent's newest session-log entry, then act on anything addressed to you (CR/HO rows first) before resuming your own queue. This is what already worked in practice — HUSSEIN's monitor woke him when AHMAD's lead routes landed, and his SIGNAL row got F-06 merged minutes after it was ready.
**Consequences:** fewer owner test rounds, no idle agent, and coordination stays in git (no chat dependency between the two accounts). Cost is bounded: polling is a shell loop, not model inference.
**Decided by:** user


## D-031: Batch delivery — ship 2-3 feature slices per owner test round (2026-07-25) [AHMAD]

**Status:** accepted — amends D-018 / TEAM-WORKFLOW §12 (one-slice-at-a-time). Per this log's header, a newer entry supersedes on conflict; **the owner should also update TEAM-WORKFLOW §12 himself when convenient (that file is human-only).**
**Context:** Owner 2026-07-25: "i want u to do more than one step (F-04), because we are slow — we do batches and then we test them, but keeping everything professional and functional". One-slice-per-acceptance made the owner a per-feature bottleneck while both agents idled between rounds.
**Decision:** Work ships in **BATCHES of 2-3 feature slices**. Each batch is declared up front on the board with per-agent halves; both agents build their halves in parallel; the batch reaches **AWAITING-OWNER-TEST only when every slice in it is INTEGRATED and green**, with ONE combined test script covering all of them. The owner accepts/rejects per slice (a rejected slice does not block its siblings).
**Non-negotiables kept (this is speed, not corner-cutting):** TDD red-first, adversarial review per slice before merge, full quality gate (build/typecheck/lint/tests/i18n parity) before every merge, CI green on develop, contract-first between agents, zone ownership, and no owner-visible feature ships untested.
**Alternatives considered:** bigger 5+ slice batches — rejected: a rejection late in a long batch wastes more work than it saves; 2-3 keeps a test round under ~15 minutes for the owner.
**Consequences:** Owner test rounds drop from per-feature to per-batch. The board's feature section now carries a **BATCH-nn** grouping row. First batch = **BATCH-01: F-04 (team members + lead assignment) + F-05 (deal desking on the A-06 money engine)**.
**Decided by:** user


## D-030: No paid AWS infrastructure until launch-adjacent; SES SDK approved (2026-07-25) [AHMAD]

**Status:** accepted
**Context:** A-07 unit 1 (SES identity + OIDC deploy role) costs ~$0/mo and is deployed. Unit 2 (VPC/NAT/ALB/ECS/RDS/ElastiCache staging) is the first real monthly bill — roughly $85-125/mo with VPC endpoints, ~$120-160/mo if a NAT Gateway is used. Nothing in the current build needs a cloud environment: both agents develop against local Docker Postgres, and every feature is owner-tested locally.
**Decision:** Owner reply 2026-07-25 ("use whatever recommended and no need to pay now"): **defer all cost-bearing AWS resources**. Keep building at ~$0/mo (SES identity, Route 53 zone and the OIDC role are free/negligible); revisit staging when a real remote environment is needed (owner demo, external integrator testing, or launch prep). When it lands, prefer VPC endpoints over a NAT Gateway (~$35/mo saved) and consider a stop/start schedule.
**Also decided (same reply):** `@aws-sdk/client-sesv2` is approved as an apps/api dependency — verified official (publisher `amzn-oss`, repo aws/aws-sdk-js-v3), pinned to 3.1092.0 (past the 48h/3-day cooldown per CLAUDE.md supply chain rules).
**Consequences:** Transactional email (sign-up verification) can be built now against the verified 1dealer.ca identity. SES stays in sandbox — real sends go to the SES mailbox simulator or verified addresses; production access is a later owner-visible request. No AWS spend accrues in the meantime.
**Decided by:** user


## D-029: Email provider = Amazon SES, not Resend (2026-07-24) [AHMAD]

**Status:** accepted (supersedes the plan's Resend choice in PROJECT.md/specs)
**Context:** The plan specified Resend (legacy used it). Owner decision 2026-07-24: "i dont want to use resend, lets use ses on aws — better in limit and more stable". Owner provisioned an admin AWS profile ("Dealpilot", account 242626139373) for both agents.
**Decision:** All transactional email (auth verification, invites, notifications, statements) goes through Amazon SES in ca-central-1, provisioned via the A-07 IaC baseline; domain identity for 1dealer.ca with DKIM; start in sandbox, request production access when the domain is verified. Keeps the whole stack inside the AWS/ca-central-1 residency envelope (D-002).
**Alternatives considered:** Resend (plan default) — rejected by owner; third-party SMTP — no reason once SES is in-account.
**Consequences:** No Resend account/key needed (owner stack shrinks). A-05.1's deferred requireEmailVerification lands after SES identity verification. Legacy Resend references in reference/ docs are historical (A-09 sweep note).
**Decided by:** user


## D-028: F-01 backend tenancy model — user-scoped reads, self-serve bootstrap, platform-authority fields (2026-07-24) [AHMAD]

**Status:** accepted
**Context:** F-01 needs "list my organizations" before tenant context exists, an org-creation path under FORCE RLS, and clear write authority.
**Decision:** (1) Migration 0003 adds SELECT-only policies keyed on `app.user_id` (withUser/withContext in @dealpilot/db): membership_self_read, org_member_read, store_member_read, user_self_read — reads only, writes still require `app.org_id`. (2) Org creation is self-serve (spec trial path): app-generated org id, org + domain user + owner membership in ONE dual-GUC transaction; `INSERT..ON CONFLICT` requires the new row to pass SELECT policies — hence user_self_read (proven live). (3) `status`/`plan_tier` are PLATFORM authority — removed from org create/update inputs; DB defaults apply; org `slug` immutable + reserved-word blocklist. (4) Write gates: org=owner, stores=owner/gm; cross-tenant/no-membership → 404 (never leak); role-insufficient → 403; deleted org fully locked down; delete-of-deleted → 404 everywhere. (5) Keyset cursors carry pg-text timestamps (JS Date ms-truncation skipped boundary rows — proven live) with strict re-parse validation.
**Alternatives considered:** SECURITY DEFINER service functions (spec §5) — deferred until the platform console; Better Auth org plugin — rejected in D-025.
**Consequences:** Hussein builds F-01 screens against the updated contract (org inputs slimmed, StoreListQuery selector). 50-agent adversarial review: no isolation bypass; all confirmed findings fixed. Platform console (A-xx later) owns status/plan_tier transitions.
**Decided by:** claude-proposed (AHMAD)


## D-027: Keep the `@dealpilot/*` internal package scope — rebrand user-facing only (2026-07-24) [AHMAD]

**Status:** accepted
**Context:** The product was renamed "Dealpilot" → "1Dealer" (D-023). Engineering
identifiers still use `@dealpilot/*` (npm scopes cannot start with a digit, so a
matching scope would need a spelling like `@onedealer/*`). Open question from
A-09: rename the scope or keep it?
**Decision:** Keep `@dealpilot/*` as the internal package scope permanently.
"1Dealer" appears only in user-facing surfaces (UI text, docs the client sees,
domain). Repo name, package scope, DB role/db names, and other engineering
identifiers stay `dealpilot`.
**Alternatives considered:** rename to `@onedealer/*` — rejected: touches every
import/lockfile for zero user-visible value, and the scope is invisible outside
the repo.
**Consequences:** A-09 shrinks to the plan-doc name sweep; no code churn. Any
future white-label tenant naming is data, not identifiers (per white-labeling
spec).
**Decided by:** user (owner reply, 2026-07-24: "yes do the recommended please")

## D-026: A-02 CI pipeline — push-triggered, SHA-pinned, ephemeral Postgres on 5434 (2026-07-23) [AHMAD]

**Status:** accepted
**Context:** No-PR workflow (D-021) means there is no PR gate; the only automated
quality signal is what runs on push. The db/api integration suites need a real
Postgres and must not silently self-skip in CI.
**Decision:** Single GitHub Actions workflow (`.github/workflows/ci.yml`):
1. **Triggers:** push to `main`/`develop` **and** `ahmad/**`/`hussein/**` (+
   manual `workflow_dispatch`). Feature-branch runs restore the pre-merge
   feedback PRs would have given — push your branch, get a verdict, then
   squash-merge (D-021 unchanged: merges stay terminal-git).
2. **Supply chain:** all actions pinned to full commit SHAs (checkout v7.0.1,
   pnpm/action-setup v6.0.9, setup-node v7.0.0); `pnpm install
   --frozen-lockfile`; lifecycle scripts stay blocked (pnpm v10 default);
   `permissions: contents: read`; no cloud credentials anywhere in CI.
3. **Database job model (ADR-023):** ephemeral `postgres:16-alpine` service
   mapped to host port **5434** so the repo-wide convention (one URL,
   `localhost:5434`, admin `dealpilot`, app role `dealpilot_app`) holds in CI
   unchanged; `db:reset` runs first (proves migrate-from-zero + dev app-role
   bootstrap), then build+typecheck, lint, and tests with **`RLS_REQUIRED=1`**
   so DB-dependent suites fail rather than skip.
4. **Determinism fix:** root vitest sets `fileParallelism: false` — the db
   suite's `beforeAll` drops/rebuilds the schema of the same database the api
   suite uses; parallel test files raced (worked locally by timing luck only).
5. **Node pin:** added `.nvmrc` = 24 (matches `engines >=24`, local v24.11.1);
   PROJECT.md's stale "Node 22 LTS" corrected. CI reads `.nvmrc`.
6. **Not enforced yet:** `format:check` (tree currently not prettier-clean —
   31 files across both zones; adopting enforcement is a joint follow-up), and
   the i18n parity step is an explicit NO-OP notice until H-04 publishes the
   script (HUSSEIN wires it via HO row).
**Alternatives considered:** PR-triggered CI (rejected — no PRs, D-021);
per-package test scripts under turbo (rejected for now — root vitest is the
established runner, 34 tests); running tests against a job container network
alias (rejected — port mapping keeps one URL for local + CI).
**Consequences:** every push to any agent branch or shared branch gets the full
gate; a red `develop` push is visible immediately. Follow-ups created: prettier
enforcement decision, H-04 parity wiring (HO), A-07 will add deploy workflows
with OIDC (no long-lived keys) separately.
**Decided by:** claude-proposed (AHMAD)

## D-025: A-05 auth architecture — Better Auth for identity only; review carve-outs (2026-07-24) [AHMAD]

**Status:** accepted (recorded as D-023 on ahmad/api-auth; renumbered to D-025
after a same-session collision with HUSSEIN's D-023/D-024 which reached origin
first — same convention HUSSEIN used renumbering off my D-022)
**Context:** A-05 wires Better Auth into the Fastify API. Security review (no
critical bypass; gate probed adversarially and held) surfaced 2 MAJOR + minor
items; some are fixed now, some are deliberate deferrals to feature slices.
**Decision:**
1. **Better Auth = identity + sessions ONLY.** No organization plugin — the
   A-04 domain tables (organizations/stores/memberships/roles + RLS) are the
   single source of tenancy truth. Identity ids are uuids for a future 1:1 link
   to `users.id`.
2. **Fixed in A-05 (from review):** M1 — production fails fast if DATABASE_URL/
   BETTER_AUTH_SECRET/BETTER_AUTH_URL/WEB_ORIGIN are left at dev defaults, and
   BETTER_AUTH_URL must be https in prod. M2 — the deny-by-default gate keys on
   the ROUTED pattern (`request.routeOptions.url`), not the raw URL, so path
   traversal cannot bypass it (regression-tested). Fastify error codes mapped to
   canonical API codes; zod/validation errors emit 422-style `details[]`;
   password min length 12 + max 128.
3. **Deliberately deferred (record, not debt-hidden):** Better Auth's own
   `/api/auth/*` error bodies keep BA's native shape (the web client SDK depends
   on it) — a documented carve-out from the canonical envelope. Identity tables
   live in `public` (single-schema for now, not a dedicated `auth` schema).
   `requireEmailVerification`, `cookieCache`, explicit `session` TTLs, CORS
   `allowedHeaders`/`maxAge`, `ipAddressHeaders`, and the `baseURL`-derived host
   in toWebRequest are scheduled for the auth-hardening feature slice / A-05.1.
4. **Entity CRUD endpoints are NOT built here** — the `apiV1` contract exists
   (A-03) but routes land with their feature slices (D-018). A-05 ships only
   health + `/api/v1/me` (session probe) + the BA mount.
**Consequences:** H-03 auth screens are unblocked (session probe + BA client
flows are live). Auth-hardening follow-ups tracked as A-05.1 backlog.
**Decided by:** claude-proposed (AHMAD), from code-review findings

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

## D-043: `leads.budget_cents` — monthly or total? (2026-08-14)

**Status:** accepted — two explicitly named columns (owner: "the most recommended and the best")
**Context:** conversation-engine.md §5 extracts `budget.monthly_budget_cents`
alongside `budget_type: 'monthly' | 'total' | null`, and writes back to a lead
column. The column that exists is `leads.budget_cents`, whose name commits to
neither, and the desking screen reads it.
**Options:** (a) `budget_cents` means TOTAL price budget; add
`monthly_budget_cents` for the payment figure. (b) `budget_cents` means the
MONTHLY payment; rename for clarity. (c) keep one column plus a `budget_type`
discriminator, matching the extraction shape exactly.
**Why it is not being guessed:** an extraction that writes a $450 monthly figure
into a column the desking screen reads as a $45,000 total is wrong in a way that
looks plausible on every screen it touches.
**Decision:** option (a), sharpened — `budget_cents` is RENAMED to
`total_budget_cents`, and `monthly_budget_cents` is added beside it (0037). Two
explicit names rather than one column plus a `budget_type` flag: a flag means
every reader must remember to check it, and the failure mode of forgetting is
silent, whereas `monthly_budget_cents` cannot be accidentally read as a total.
**Consequences:** the rename is a breaking change to `CreateLeadInput` /
`UpdateLeadInput` / the `Lead` read model. Safe today because nothing computes
with the column — it is only stored and echoed — and that stops being true the
moment desking reads it. Extraction write-back (§5) is now unblocked.
**Decided by:** user (2026-08-14)

## D-044: BullMQ namespacing — prefix, not a colon in the queue name (2026-08-15)

**Status:** accepted (implementation decision; no owner input needed)
**Context:** `QUEUE_DEFERRED_SEND` and `QUEUE_ASSISTANT_TURN` shipped as
`dealpilot:deferred-send` and `dealpilot:assistant-turn`. BullMQ 5 refuses a
colon in a queue name — a colon is its own Redis key separator — and throws from
the `QueueBase` constructor. The API and the workers therefore both crashed on
startup in any environment with Redis, which is every deployed one.
**Why it went eight commits unnoticed:** `createDeferredSendQueue` returns a
no-op when `REDIS_URL` is unset, and no local process sets it. The `Queue` was
never constructed, so the line never ran. 974 unit tests could not see it. The
new CI e2e job, booting the API against Redis for the first time, is what found
it — on its first run.
**Options:** (a) drop the namespace entirely and accept BullMQ's default `bull:`
keys. (b) keep the intent and move the namespace to BullMQ's `prefix` option.
(c) namespace by Redis logical database instead.
**Decision:** (b). `QUEUE_PREFIX = 'dealpilot'` passed as `prefix`, which
produces exactly the Redis keys the colon was reaching for, by the supported
route. Every `Queue` and `Worker` is constructed through a single `queueOpts()`
helper exported from `@dealpilot/contracts`.
**Why the helper rather than just passing `prefix` at each site:** the
half-applied version is worse than the crash. If one side sets the prefix and
the other does not, both processes are healthy and nothing throws — the API
enqueues under `dealpilot:` while the worker blocks on `bull:`, and every
deferred message waits forever for a consumer listening on different keys. A
crash announces itself; that does not. `queue-naming.test.ts` fails the build if
any call site skips the helper, and asks BullMQ itself whether a name is legal
rather than re-implementing the rule.
**Consequences:** no migration concern — there are no jobs in any Redis to
strand, because the queue has never successfully been created. F-32's
deferred-send path is now reachable for the first time and still unproven
end-to-end; the first real exercise of it is owed a test.
**Decided by:** Claude (implementation), 2026-08-15

## D-045: a contact merge does not move the audit trail (2026-08-15)

**Status:** accepted (implementation decision; deviates from FR-CON-003's wording)
**Context:** FR-CON-003 specifies that merging two customer records "moves
deals/leads/activity" to the survivor. Deals and leads move. Activity does not,
and cannot: `dealpilot_app` holds INSERT and SELECT on `activity_events` and no
UPDATE grant, so `UPDATE activity_events SET entity_id = ...` fails outright.
**Why the grant is right and the requirement bends:** merge is a permission
several roles hold. If it could re-point `entity_id`, anybody able to merge
customers could silently re-attribute past events to a different person — which
is the exact capability an audit trail exists to deny. A log that the
application can rewrite is not a log.
**Options:** (a) grant UPDATE on activity_events so the merge can re-point rows.
(b) leave the history attached to the record it happened to, and record where
that record went. (c) copy the events onto the survivor, leaving both.
**Decision:** (b). Migration 0042 adds `contacts.merged_into_contact_id`, set in
the same statement that soft-deletes the loser — a CHECK refuses a forwarding
address on a live record, so the two facts cannot be written apart. The
survivor's timeline reads its own events plus those of anything merged into it.
Rejected (a) because it trades an audit guarantee for a convenience, and (c)
because duplicated events double-count in any timeline that later follows the
pointer as well.
**Consequences:** identical on screen, opposite guarantee underneath — nothing
is ever rewritten. The merge response reports `activity` as a COUNT of events
that became reachable, not a number of rows changed; the field name is honest
about this only in the schema comment, which is worth revisiting if the number
ever appears in the UI. FR-CON-003's wording should be read as "the survivor can
see the history", not "the rows move".
**Decided by:** Claude (implementation), 2026-08-15

## D-046: `GET/PATCH /contacts/:id` were dead from F-35 to F-36 (2026-08-15)

**Status:** fixed in migration 0041 — recorded because the failure mode will recur
**Context:** both routes resolve the contact's organisation under `withUser`,
which sets `app.user_id` and deliberately not `app.org_id` (the point is to
discover the org before trusting a caller-supplied one). `contacts_isolation`
keys on `app.org_id`, so under withUser its USING clause evaluated
`organization_id = NULL` — never true. No contact was visible to anybody, the
lookup threw not-found, and both routes returned 404 to every caller including
the record's owner, for every contact, always. `leads` and `deals` each carry a
second SELECT policy for exactly this traversal; `contacts` was created without
one.
**Why nothing caught it:** the only F-35 cases touching those routes assert that
a RIVAL receives 404. They passed for the wrong reason — the rival got 404
because nobody can read a contact by id, which is what the owner got too.
**The generalisable rule:** a test that asserts something is FORBIDDEN cannot
distinguish "correctly denied" from "broken for everyone". Every negative
authorization case needs the positive case beside it, in the same suite, or it
is measuring nothing. This is the same shape as the rival-list assertion that
was changed from `toHaveLength(0)` to absence-of-a-known-row earlier in the
build.
**Decided by:** Claude (implementation), 2026-08-15
