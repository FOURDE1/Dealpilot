# CLAUDE.md — Engineering Operating Manual

Universal rules for this project. Project-specific facts (stack, exact commands,
boundaries, quality bar) live in @docs/PROJECT.md — treat that file as the source
of truth for HOW to run things. If a fact you need is `TBD` there, ask the user,
then record the answer in PROJECT.md so it is never asked again.

## Session ritual

- **Start:** read the newest entry in docs/SESSION_LOG.md before non-trivial work —
  it says exactly where the last session stopped.
- **End:** run `/session-save` when the user wraps up, when context gets long, or
  after completing significant work (you cannot detect the user leaving — save
  early). Chat history is lost; docs persist. Facts belong in files, not in chat.
- When compacting, always preserve: the list of modified files, the current task,
  and the exact test/build commands.

## Ask the user first — never decide alone

Stop and ask (with a recommendation) before:
- deleting files/directories, dropping data, force-pushes, or history rewrites —
  ALWAYS ask-first, even though git could restore them
- changing public API contracts, database schema, or auth/security behavior
- adding a new dependency, framework, or service
- any irreversible or externally visible action (pushes, deploys, publishing, emails)
- choosing between two designs with materially different tradeoffs
- suppressing any check (skipping a test, lint-disable, type-cast escape hatch)

If unsure about requirements, APIs, or file contents: ask or verify — never fabricate.
Reversible means recoverable from git without losing uncommitted work; ordinary
edits to tracked files are reversible — for those and everything else in scope,
proceed without asking.

## Working style

- **Plan before code** for non-trivial work: a short written plan (goal, steps, files
  touched, how it will be verified), agreed with the user.
- **Small steps:** work in independently verifiable increments; commit after each
  working step when the user has asked for commits (save-points for rollback).
- **Smallest change that solves the stated problem.** No speculative layers, options,
  abstractions, or dependencies (YAGNI). Prefer editing existing code over writing
  parallel new code.
- **Leave it better:** spend ~10% of each change improving what you touched
  (dead code out, names clarified, duplication merged) — never a rewrite nobody
  asked for. Cleanups within touched files count as in-scope, not "unrelated changes".
- **Unfamiliar or fast-moving API?** Look up the official docs for the PINNED
  version (web search/fetch if needed) before writing code — never code against
  remembered APIs.
- **Spike escape hatch:** when the user declares work a spike/prototype/throwaway,
  the testing, quality-gate, UI, and performance rules are suspended — mark the
  code `SPIKE`, note it in SESSION_LOG.md, and re-apply full rules the moment any
  spike code is kept. Ask-first rules (secrets, dependencies, deploys, deletions)
  always apply.
- **Never merge/commit code you cannot explain line by line.** Self-review the full
  diff before declaring done.

## Code quality

- Priority order when principles conflict: **correctness > simplicity > YAGNI > DRY**.
  Duplication is cheaper than the wrong abstraction — abstract on the third
  occurrence (rule of three), not the second.
- Apply SOLID selectively: single responsibility at module level and dependency
  inversion at architectural boundaries. Do not introduce interfaces or design
  patterns without a second concrete, current need. Name the pattern in a comment
  when you do use one.
- Prefer deep modules (simple interface, substantial implementation) over many
  shallow ones. Never split a function for length alone.
- Match the style of surrounding code; the linter/formatter owns style — do not
  hand-enforce what tooling enforces.

## Errors, null, and input

- **Parse, don't validate:** convert untrusted input (API payloads, env/config, CLI
  args, file contents, DB rows) into typed/validated structures ONCE at the boundary
  (schema validation). Interior code trusts its types.
- Expected, recoverable failures → return result/error values. Bugs and unrecoverable
  states → exceptions/panics. Fail fast at startup on bad config.
- **Never mask errors:** empty catch blocks, `except: pass`, ignored error returns,
  and broad catch-log-continue are forbidden. Errors either get handled meaningfully,
  or propagate.
- **Fail closed:** on error, deny access / abort the operation — never "allow because
  the check crashed" (OWASP Top 10:2025 A10, Mishandling of Exceptional Conditions).
- Null discipline: enable the stack's strictest null/type checking; no `any`,
  non-null `!`, or `!!` escapes without a comment justifying why it is safe.
- Every external call gets an explicit timeout; retry only idempotent operations,
  with exponential backoff + jitter, max ~3 attempts.

## Testing

- Every new behavior and every bug fix gets a test; write (or state) the failing
  test BEFORE the fix so it is proven to detect the bug.
- **Never delete, skip, weaken, or rewrite a failing test to make it pass.** Fix the
  code, or stop and ask the user which side (test or code) encodes the real requirement.
- Shape: unit tests for logic/algorithms, integration tests for boundaries and glue
  (where most bugs live), a few end-to-end tests for critical user journeys.
  No assertion-free tests; no tests that only exercise mocks.
- Coverage is a floor, not a goal: aim ~75–85% overall, 90%+ on money/auth/data
  integrity paths. Never chase 100%.
- **Evidence before claims:** never say "done", "fixed", or "passing" without running
  the checks and showing real output. Exercise changed behavior end-to-end, not just
  the unit tests. Run `/quality-gate` before commits, PRs, releases, and after any
  non-trivial change; for trivial edits (typo, comment, user-dictated config value)
  its checks + self-review sections suffice.

## Security (baseline: OWASP Top 10:2025 + ASVS 5.0)

- Authorization: deny by default; enforce server-side on EVERY request; re-check
  object ownership (this user, this record) — never trust client-supplied IDs or roles.
- Injection: never build SQL, shell commands, or HTML by concatenating untrusted
  data. Parameterized queries, argument-array process spawning, framework
  auto-escaping (never bypassed without sanitization + justification).
- Secrets: never in source, git, logs, error messages, or prompts. Environment
  variables or a secret manager; `.env` is gitignored with a committed `.env.example`.
- Secure defaults: debug off in prod, generic error messages to users (details to
  logs), security headers (CSP, HSTS, X-Content-Type-Options), CORS locked to known
  origins, least-privilege credentials.
- Log auth failures, authz denials, and validation failures — without secrets or PII.
- Crypto: vetted libraries only, never custom. Passwords: Argon2id/bcrypt/scrypt.
- If the project touches LLMs: treat all model output as untrusted input; assume
  prompt injection wherever untrusted content enters the context; least-privilege
  tools with human approval for consequential actions.
- Run `/security-audit` after auth/input/upload/payment work and before releases.
  Findings and decisions live in docs/SECURITY.md.

## Dependencies (supply chain is attack surface #3)

- Before adding ANY package: verify exact name (typosquatting/slopsquatting is
  real), publisher, repo, and maintenance state — then ask the user (see above).
- Never install a version published in the last 24–48h; prefer cooldowns
  (Dependabot default 3 days / pnpm `minimumReleaseAge`).
- Lockfiles are committed, installs are frozen in CI (`npm ci` / `--frozen-lockfile`
  / `--locked` equivalents). Review lockfile diffs like code — an unexpected
  `resolved` URL off the official registry is an incident.
- Do not run dependency install scripts by default (npm v12+/pnpm v10+ default;
  `--ignore-scripts` elsewhere). Pin CI actions to full commit SHAs.
- Run `/deps-check` when adding dependencies and periodically (weekly or per release).

## UI/UX (any project with an interface)

- Accessibility target: **WCAG 2.2 AA** (exceeds the EU EAA's current legal
  baseline of WCAG 2.1 AA — building to 2.2 covers both).
  Non-negotiables: semantic HTML before ARIA; full keyboard operability with visible
  focus; interactive targets ≥24×24 px (design to 44–48); text contrast ≥4.5:1 in
  BOTH light and dark themes; drag actions have click alternatives; never re-ask for
  data in-session; login allows paste/password managers.
- Responsive: mobile-first; container queries for components, media queries for page
  layout; `100svh` (with a `100vh` fallback line above), never bare `100vh`; fluid
  type via `clamp()` with a rem term; verify at 200% zoom and 320px width.
- Motion: animate only inside `@media (prefers-reduced-motion: no-preference)`.
- Performance budget (p75 real-user): LCP ≤2.5s, INP ≤200ms, CLS ≤0.1.
- Forms: single column, persistent labels (placeholders are not labels), correct
  `type`/`inputmode`/`autocomplete`, inline validation, errors in text not color alone.
- Design tokens as CSS custom properties: primitive → semantic → component layers;
  components reference semantic tokens only.
- Run `/ui-review` after significant UI work.

## Performance & scalability

- **Measure before optimizing** (applies to EVERY project type) — profile or EXPLAIN
  first, fix the top item, re-measure. Reject speculative micro-optimization; state
  perf claims with numbers.

The rest of this section applies to projects with a service/API tier:
- Services stateless (session/cache/files in backing services). Config from
  environment. Structured logs to stdout with request/trace IDs.
- Every list endpoint paginates from day one (cursor/keyset by default) with a max
  page size; no unbounded queries. Index foreign keys and frequent WHERE/ORDER BY
  columns — verify with EXPLAIN, don't guess. Watch for N+1 (eager-load/batch).
- Cache-aside only with: key schema, TTL (always), invalidation trigger, and
  stampede protection. The system must survive a cold cache.
- Rate-limit public endpoints (token bucket; 429 + Retry-After). Async-queue
  anything not needed in the response.
- Migrations are expand-then-contract — two app versions always run during deploys.

## Documentation as memory

- docs/SESSION_LOG.md — session journal (via `/session-save`)
- docs/DECISIONS.md — every significant decision, logged when made
- docs/ARCHITECTURE.md — living system map; fix drift the moment you notice it
- docs/SECURITY.md — threat notes, audit results, accepted risks
- docs/PROJECT.md — stack facts and commands; correct it when reality disagrees

## Skills

| Run | When |
| --- | --- |
| `/quality-gate` | before commits/PRs/releases and after non-trivial changes |
| `/self-heal` | build/tests broken, after refactors — loop until green |
| `/security-audit` | after auth/input/payment work; before releases |
| `/deps-check` | when adding deps; weekly or per release |
| `/ui-review` | after significant UI work |
| `/session-save` | end of session; before long-context work |

Subagents: dispatch **code-reviewer** on significant diffs and **security-auditor**
to verify audit findings — the author should never be the only grader.

## Maintaining this file

Keep under ~200 lines: prune anything Claude could derive from the code. If a
section grows into a procedure, move it to a skill; path-specific rules go in
`.claude/rules/*.md` with `paths:` frontmatter. Add a rule only after the same
mistake happens twice.
