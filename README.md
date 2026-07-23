# Dealpilot — Build Repository

The build home for **Dealpilot** (client-chosen name, 2026-07-23; formerly
working name "ReadyLoans"): a multi-tenant, white-label dealership CRM/DMS plus
AI lead-automation platform, Canada/Quebec-first. This repo carries the
engineering discipline scaffold — security, quality gates,
documentation-as-memory, self-healing loops, and skills — that governs every
session of the build. Remote: `https://github.com/FOURDE1/Dealpilot.git`.

## How this repo relates to the plan

- **The plan** (57 docs, decisions locked 2026-07-23/24) lives IN THIS REPO at
  `reference/kia-tracker-specs/docs/new/` — canonical authority:
  `00-overview/ARCHITECTURE-DECISIONS.md` (26 ADRs). Read-only. (Plan docs
  predate the rename and say "ReadyLoans" — same product.)
- **The build happens at the repo root**, from scratch, per those ADRs. Project
  facts and planned commands: `docs/PROJECT.md`. Target system map:
  `docs/ARCHITECTURE.md`. Adopted + owner decisions: `docs/DECISIONS.md`.
- **The legacy code** in `reference/kia-tracker-specs/` is a business-rules
  reference only (desking/tax/commission logic); its data is test data and is
  never migrated.
- **Two Claude Code sessions build in parallel** — AHMAD and HUSSEIN — on
  `ahmad/<slug>` / `hussein/<slug>` branches, integrating through `develop`,
  with `main` protected. Protocol: `docs/TEAM-WORKFLOW.md`; board: `docs/TASKS.md`.

## New machine setup (e.g. the laptop)

Everything needed to continue lives in this repo — clone it and the agents have
their full memory (board, session logs, decisions, plan):

1. `git clone https://github.com/FOURDE1/Dealpilot.git` then **`git checkout develop`**
   — IMPORTANT: all work lives on `develop` (390+ files); `main` holds only the
   genesis scaffold until the first production release. Then open the folder in
   Claude Code. (One-time optional fix so clones land on develop automatically:
   `gh auth login` then `gh repo edit FOURDE1/Dealpilot --default-branch develop`.)
2. Install toolchain if missing: Node ≥24, pnpm (`corepack enable`), Docker
   Desktop, git. Then `pnpm install`.
3. Copy `.env.example` → `.env` (dev defaults work; no production secrets exist).
4. Stitch MCP (HUSSEIN's design work): the server config ships in `.mcp.json`;
   set the API key on this machine — easiest is adding
   `{"env": {"STITCH_API_KEY": "<your AQ. key>"}}` to `~/.claude/settings.json`
   (get the key at stitch.withgoogle.com → project settings → API).
5. Start a session with **"You are Hussein"** (or Ahmad). The bootstrap ritual
   (TEAM-WORKFLOW §2) reads the board and both session logs and continues
   exactly where things stopped.

## What's inside

```
main-project/
├── CLAUDE.md                          # Master instructions — loaded every session
├── docs/
│   ├── PROJECT.md                     # Stack, commands, conventions (source of truth for HOW)
│   ├── ARCHITECTURE.md                # Living architecture doc — Claude keeps it updated
│   ├── DECISIONS.md                   # Decision log (lightweight ADRs)
│   ├── SESSION_LOG.md                 # Persistent memory across sessions
│   └── SECURITY.md                    # Threat notes, audit results, standards checklist
└── .claude/
    ├── settings.json                  # Deny reads of .env/keys/secrets; ask before push/publish
    ├── agents/
    │   ├── code-reviewer.md           # Adversarial review subagent
    │   └── security-auditor.md        # OWASP-focused audit subagent
    └── skills/
        ├── security-audit/            # /security-audit — OWASP Top 10 + secrets + authz sweep
        ├── deps-check/                # /deps-check — package vulnerability scan (any ecosystem)
        ├── self-heal/                 # /self-heal — loop build/lint/test until clean
        ├── session-save/              # /session-save — persist context to docs/ before ending
        ├── quality-gate/              # /quality-gate — full pre-commit/pre-release checklist
        └── ui-review/                 # /ui-review — responsivity + WCAG 2.2 + UX heuristics
```

## How to work here

1. The scaffold is already in place and `docs/PROJECT.md` is filled in.
   `git init` + the monorepo scaffold is Phase 0 task **A-01** (Ahmad) — the
   workflow (commits as save-points, diff self-review, session-save's status
   check) assumes a repository, so A-01 comes first.

2. Start every session by reading the newest entry in `docs/SESSION_LOG.md` —
   it says exactly where the last session stopped.

3. Work normally. The rules in CLAUDE.md make Claude:
   - ask before irreversible or architectural decisions
   - run `/quality-gate` before claiming anything is done
   - keep `docs/SESSION_LOG.md` updated so no context is ever lost
   - treat security, accessibility, and tests as defaults, not extras

   One habit is yours: say **"wrap up"** (or run `/session-save`) before closing a
   session — Claude cannot detect that you're leaving, and that save is what makes
   the next session start where this one stopped.

## Maintaining the scaffold

This repo's copy of the starter is now project-owned: improve CLAUDE.md, skills,
and docs here as the build teaches us. Do not modify CLAUDE.md casually — it is
the operating manual the project adapts TO; project-specific facts belong in
`docs/PROJECT.md`.
