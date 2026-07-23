# TEAM-WORKFLOW.md — Two-Agent Parallel Development Protocol

> Two Claude Code accounts build this repo simultaneously: **AHMAD** and **HUSSEIN**.
> This file is the law of how they coexist without destroying each other's work.
> It is followed literally. When this file and improvisation disagree, this file wins.
> Only the human owner changes this file — never either agent.
>
> Companion files: `docs/TASKS.md` (task board), `docs/SESSION_LOG.md` (cross-agent
> journal), `CLAUDE.md` + `docs/PROJECT.md` (engineering rules — still fully apply).

---

## 1. Identities & ownership zones

| | **AHMAD — Backend & Platform** | **HUSSEIN — Frontend & Experience** |
|---|---|---|
| **Owns (exclusive write)** | `apps/api/**`, `apps/workers/**`, `apps/intake/**`, `packages/db/**` (incl. ALL migrations), `packages/schemas/**`, `packages/contracts/**`, `packages/core/**`, `packages/ai/**`, `infra/**`, root monorepo config (`package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` arbiter, `turbo.json`, `tsconfig*.json`, `.npmrc`, root lint/format config), `.github/**` (CI workflows), `README.md` | `apps/web/**` (incl. admin console UI and e2e UI tests), `packages/ui/**` (design tokens, theming, components), `packages/i18n/**` (ALL locale files) |
| **Never edits** | Anything in HUSSEIN's zone | Anything in AHMAD's zone |

**Shared files (both write, discipline below):** `docs/TASKS.md` (add rows / update
your own rows; never delete or rewrite the other agent's rows), `docs/SESSION_LOG.md`
(append your own entries only), `docs/DECISIONS.md` (append, tagged `[AHMAD]`/`[HUSSEIN]`),
`docs/ARCHITECTURE.md` and `docs/PROJECT.md` (each agent documents/records facts only
for artifacts in its own zone).

**Human-only (neither agent edits without an explicit instruction from the human):**
`CLAUDE.md`, `docs/TEAM-WORKFLOW.md`, `.claude/**`.

**Anything not listed** defaults to AHMAD (platform). If unsure whose file it is,
treat it as the other agent's and file a HANDOFF (§5) — guessing wrong costs a day.

## 2. Session bootstrap (mandatory, every session)

The human opens a session with **"You are Ahmad"** or **"You are Hussein"**.

Before ANY work, the named agent must, in order:
1. Read this file (`docs/TEAM-WORKFLOW.md`) end to end.
2. Read `docs/TASKS.md` — full board state.
3. Read the latest `docs/SESSION_LOG.md` entries from **BOTH** agents (at minimum
   the newest `[AHMAD]` entry and the newest `[HUSSEIN]` entry).
4. `git fetch` + `git status` — confirm which branch you are on and that you are in
   **your own working copy** (§3).
5. **First session (or returning after a gap):** complete the onboarding reading
   list in §2.1 before claiming anything.
6. Only then touch code, and only on a task you have claimed (§6).

If the human did not state an identity: **ask**. Never assume, never proceed unnamed.

### 2.1 First-session onboarding — never work blindly

Before your first claimed task (and again after any long gap), read in order:
1. `docs/PROJECT.md` — stack facts, commands, boundaries, quality bar.
2. `docs/ARCHITECTURE.md` — the system map.
3. The plan: `../kia-tracker-specs/docs/new/README.md` (index), then
   `00-overview/EXECUTIVE-SUMMARY.md` and the Canonical Stack table in
   `00-overview/ARCHITECTURE-DECISIONS.md`.
4. Your zone's deep specs — AHMAD: `03-architecture/`, `05-database/`,
   `04-security/authentication-authorization.md`. HUSSEIN:
   `06-tech-stack/ui-design-system.md`, `06-tech-stack/frontend-stack.md`,
   `09-admin-whitelabel/white-labeling.md`.

**Per task, every time:** before starting a claimed task, locate (via the plan
index) and read the `docs/new` spec sections that define it. Code written
without reading its spec is treated as a defect, not a shortcut.

### 2.2 Asynchronous by design

The two agents **never need to be online at the same time**. All coordination
happens through files and git (board, session log, branches), so all of these
are valid modes: both agents in parallel; one agent working alone for days
while the other is idle; or the same human running AHMAD in one session and
HUSSEIN in a later one — identity is per-session, not per-account. The
bootstrap (§2) + claim protocol (§6) make every ordering safe.

## 3. Working copies — never share a checkout

The two agents must **never run in the same working directory**.
- **AHMAD** works in `main-project` (this directory).
- **HUSSEIN** works in a dedicated sibling clone: `main-project-hussein`.

**Remote (owner decision 2026-07-24 — git-only, no GitHub yet):** `origin` is the
local bare repository `../readyloans.git` (i.e. `Archive/readyloans.git`). All
push/pull flows through it exactly as they would through GitHub. HUSSEIN creates
his working copy with:
`git clone "<path-to>/Archive/readyloans.git" main-project-hussein` (inside
`Archive/`). When GitHub is adopted later, we add it as the new origin and push —
nothing else changes.

Coordination files (TASKS.md, SESSION_LOG.md) are read/written through git — pull
before reading, push immediately after writing (§7). Until A-01 (git init + push)
is DONE, HUSSEIN performs no file edits in the repo; only non-repo work (e.g. H-01
design exploration) is allowed.

## 4. Contract-first rule (the interface between the two agents)

`packages/contracts` + `packages/schemas` are the ONLY interface between backend
and frontend.

- **Only AHMAD edits them.** No exceptions, not even "trivial" ones.
- HUSSEIN requests additions/changes by adding a **CR row** (`CR-nn`) to TASKS.md
  stating: endpoint/entity, fields + types needed, and which H-task consumes it.
- AHMAD implements the contract on his own branch and merges to `develop`, then
  marks the CR row `DONE(date, merge-commit)`.
- **Contract changes land on `develop` BEFORE dependent UI work starts.** HUSSEIN
  codes strictly against the published types (`import` from `@readyloans/contracts`
  / `@readyloans/schemas`) — never against hand-written duplicate types. Mock data
  in the UI is fine, but it must be typed by the published contract.
- If a published contract turns out wrong mid-UI-work: stop that task, file a CR,
  mark the task `BLOCKED(needs CR-nn from AHMAD)`, switch to other claimed work.

## 5. File-ownership enforcement & handoffs

- **Never edit a file in the other agent's zone.** Not to fix a typo, not to fix a
  build, not "just this once".
- Need a change there? Add a **HANDOFF row** (`HO-nn`) to TASKS.md with: **what**
  (exact change), **why** (which of your tasks needs it), **exact file paths**, and
  who it's for. Then continue other work — never wait idle.
- The receiving agent treats open HANDOFF/CR rows addressed to it as **top priority**
  at next session start (they block the other agent).
- **Locale files** (`packages/i18n/**`): HUSSEIN owns. All merges to locale files are
  **additive-only key merges** — keys are added, never renamed/removed in the same
  change that adds features; removals are their own explicitly-logged commit.
- **Migrations** (`packages/db/**` migrations): AHMAD only. Timestamp-ordered
  filenames (`YYYYMMDDHHMMSS_<slug>.sql`); never edit an already-merged migration —
  always a new one.
- **Dependencies:** each agent may run `pnpm add` only against `package.json` files
  in its own zone (root `package.json` = AHMAD only), after the ask-first rule in
  CLAUDE.md. `pnpm-lock.yaml` changes only ever happen as the mechanical output of
  pnpm commands — never hand-edited. AHMAD arbitrates lockfile disputes.

## 6. Task board protocol (`docs/TASKS.md`)

Statuses (exact spelling, with required parenthetical data):

| Status | Meaning |
|---|---|
| `BACKLOG` | Defined, unowned beyond track assignment |
| `CLAIMED(AGENT, YYYY-MM-DD)` | Agent has claimed it; work not yet started |
| `IN-PROGRESS(branch-name)` | Being built on that branch |
| `BLOCKED(needs X from Y)` | Cannot proceed; states exactly what and from whom |
| `REVIEW` | PR open; quality gate + self-review running |
| `DONE(YYYY-MM-DD, merge-commit-sha)` | Merged to `develop`, evidence recorded |

Hard rules:
1. **Claim before working.** Update the row to `CLAIMED` (then `IN-PROGRESS` when
   the branch exists) before writing any code for it.
2. **One IN-PROGRESS task per agent** at a time. BLOCKED tasks don't count against
   the limit; claim the next task when blocked.
3. **Never work an unclaimed task** and never a task claimed by the other agent.
4. **Never claim a task whose owner column is the other agent.**
5. **Update the row in the same session as the state change** — the board must never
   lag reality across a session boundary.
6. Respect the `Depends on` column: a task whose dependency is not `DONE` can be
   CLAIMED but not IN-PROGRESS (except explicitly parallel-safe parts noted in the
   task's detail block).

## 7. Git protocol

- **`main`** — protected. Production only. No direct commits, ever. Only `develop`
  merges into it, and only when the human asks for a release.
- **`develop`** — integration branch. All feature branches merge here.
- **Branches:** `ahmad/<slug>` and `hussein/<slug>` (kebab-case slug, one task per
  branch, task ID in the first commit body).
- **Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`,
  `refactor:`, `ci:`). Small, working increments.
- **Merging:** rebase your branch on latest `develop` first, run `/quality-gate`,
  open a PR to `develop`, merge it yourself. **Each agent merges ONLY its own
  branches.** Squash-merge with a Conventional-Commit title; record the merge SHA
  in the task row.
- **Merge small and often:** a branch lives **max 1–2 days**. If a task is bigger,
  slice it into mergeable increments behind the task ID.
- **Never commit to `develop`/`main` directly** — sole exception: **coordination
  commits** touching ONLY `docs/TASKS.md`, `docs/SESSION_LOG.md`, and/or
  `docs/DECISIONS.md` may go straight to `develop` (pull first, one `docs:` commit,
  push immediately; if the push is rejected, `git pull --rebase` and retry). This
  keeps the board and log current without dragging them through feature branches.
- **Never force-push shared branches** (`main`, `develop`). Force-push is allowed
  only on your own `ahmad/*`/`hussein/*` branch after a rebase.
- **Cross-boundary changes require a HANDOFF entry** (§5) — a PR that touches the
  other agent's zone must not be opened, let alone merged.

## 8. Conflict recovery

On a rebase/merge conflict:
1. Conflicted files all in **your zone** or coordination files → resolve, continue.
2. Any conflicted file in the **other agent's zone** → **STOP.** `git rebase --abort`.
   Do NOT resolve the other agent's files. Set your task `BLOCKED(rebase conflict
   in <files>, needs <other agent>)`, add a HANDOFF row naming the exact files and
   both branches, write a session-log entry, move to other work.
3. `pnpm-lock.yaml` conflict → never hand-merge: take `develop`'s lockfile, re-run
   `pnpm install` so your own `package.json` changes regenerate it, verify the
   install and build are green, continue.

## 9. Reporting (`docs/SESSION_LOG.md`) — the cross-account channel

Every session appends an entry (newest on top, per that file's format) with the
heading prefixed by identity:

```markdown
## YYYY-MM-DD [AHMAD] — <one-line summary>
```

Body must cover: **completed** (with task IDs), **files touched**, **test/build
status with evidence** (real command output summaries, per CLAUDE.md — no
unverified "passing"), **next step**, **blockers** (incl. any HANDOFF/CR rows filed
for the other agent). Write it as if the other agent will read it **cold** — they
will: it is the only way the two accounts communicate. Never edit or reorder the
other agent's entries.

## 10. Definition of done (per task)

A task moves to `DONE` only when ALL of:
1. `/quality-gate` green (lint, typecheck, tests, build) — evidence shown.
2. New behavior has tests; bug fixes have a test that failed first (CLAUDE.md).
3. Full-diff self-review done (dispatch the code-reviewer subagent on significant
   diffs).
4. Branch rebased, PR merged to `develop` by its own author.
5. TASKS.md row updated to `DONE(date, merge-sha)` in the same session.
6. SESSION_LOG.md entry written.

## 11. Quick reference — the ten hard rules

1. State your identity or ask; bootstrap (§2) before any work.
2. Never touch the other agent's zone — HANDOFF instead.
3. Only AHMAD edits contracts/schemas/migrations/lockfile-config/CI.
4. Contracts land on `develop` before dependent UI starts.
5. Claim before working; one IN-PROGRESS task each.
6. Branch `ahmad|hussein/<slug>`; Conventional Commits; rebase before merge.
7. Merge only your own branches; small and often (≤1–2 days).
8. No direct commits to `develop`/`main` except coordination-file `docs:` commits;
   never force-push shared branches.
9. Cross-zone rebase conflict → abort, BLOCKED, HANDOFF — never resolve their files.
10. Every session ends with the board updated and a tagged session-log entry.
11. After the foundation, features ship one at a time and the OWNER accepts each
    one before the next starts (§12).

## 12. Feature-based delivery (owner decision 2026-07-24)

Once the Sprint-1 foundation is done (A-01–A-05, H-01–H-05: repo, CI, contracts,
db, api+auth, tokens, shell, i18n), ALL further work is organized as **feature
slices** (`F-nn` rows on the board): one user-visible, testable feature at a
time, built vertically across both zones.

- **A feature slice** = the full journey the owner can click through: AHMAD's
  half (schemas/contracts, migrations, API, jobs) + HUSSEIN's half (screens,
  i18n, UX) + tests on both sides. Example: "Lead intake → lead appears in the
  list → status can be changed".
- **Status flow:** `BACKLOG → CLAIMED/IN-PROGRESS → INTEGRATED (both halves
  merged to develop, e2e green) → AWAITING-OWNER-TEST → ACCEPTED(date)` or
  `REJECTED(reason)` back to in-progress. The row's Notes must contain **how to
  test it** (exact steps, URL, seeded credentials) when it reaches
  AWAITING-OWNER-TEST.
- **The gate:** the OWNER personally tests and explicitly confirms each feature.
  No new feature's API or UI work starts while one is AWAITING-OWNER-TEST —
  fill-in work during the wait is limited to: fixing rejection feedback, tests,
  docs, infra chores, and *contract preparation* for the next feature.
- **Bundles (the only exception):** if a feature is untestable without
  companions (e.g. desking needs inventory + deal), the bundle is declared UP
  FRONT as one `F-nn` row with sub-parts, and accepted as a unit — never
  discovered mid-build.
- **Parallelism stays:** within the active feature (or bundle), both agents
  work simultaneously as usual; the contract-first rule (§4) sequences them.
