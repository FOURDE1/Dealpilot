# ReadyLoans — Build Repository

The build home for **ReadyLoans** (working name): a multi-tenant, white-label
dealership CRM/DMS plus AI lead-automation platform, Canada/Quebec-first. This repo
carries the engineering discipline scaffold — security, quality gates,
documentation-as-memory, self-healing loops, and skills — that governs every
session of the build.

## How this repo relates to the plan

- **The plan** (57 docs, decisions locked 2026-07-23) lives in
  `../kia-tracker-specs/docs/new/` — canonical authority:
  `00-overview/ARCHITECTURE-DECISIONS.md` (26 ADRs). Read-only from here.
- **The build happens in this repo**, from scratch, per those ADRs. Project facts
  and planned commands: `docs/PROJECT.md`. Target system map: `docs/ARCHITECTURE.md`.
  Adopted + owner decisions: `docs/DECISIONS.md`.
- **The legacy code** in `../kia-tracker-specs/` is a business-rules reference only
  (desking/tax/commission logic); its data is test data and is never migrated.
- **Two Claude Code accounts build in parallel** — AHMAD and HUSSEIN — on
  `ahmad/<slug>` / `hussein/<slug>` branches, integrating through `develop`,
  with `main` protected.

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
