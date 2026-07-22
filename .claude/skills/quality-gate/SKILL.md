---
name: quality-gate
description: Run the full definition-of-done checklist — checks, tests, self-review, AI-specific pitfalls, docs — before claiming work complete, committing, opening a PR, or releasing. Use when finishing any task, when the user says "quality gate", "is it done", "ready to commit/ship", or before any release.
---

# Quality Gate

Nothing is "done" until this passes. Report every item honestly — a failed gate
reported truthfully is a good outcome; "all green" without evidence is a lie.

**Scale to the change:** full gate for non-trivial work, commits, PRs, and releases.
For trivial edits (typo, comment, user-dictated config value), sections 1 and 3
suffice. Work the user declared a SPIKE skips the gate entirely until kept.

## 1. Mechanical checks (commands from docs/PROJECT.md)

Run and show real output: type-check → lint → build → unit tests → integration
tests. Any failure → stop, fix (see `/self-heal`), re-run the gate from the top.

## 2. Behavior verification

- Exercise the changed behavior end-to-end (run the app/endpoint/UI flow), not just
  the test suite. State what you ran and what you observed.
- New behavior has a test; the bug fixed has a regression test that failed before
  the fix.
- No test was deleted, skipped, or weakened to get green (diff the test files).

## 3. Self-review the full diff

Read every changed line (`git diff`) and check:

- I can explain every line. Nothing was left in by accident (debug prints,
  commented-out code, TODO without an owner, dead code).
- Smallest change that solves the problem — no speculative abstractions, no drive-by
  rewrites, no unrelated changes mixed in. (Leave-it-better cleanups within touched
  files are expected and do NOT count as unrelated; changes beyond touched code do.)
- For significant diffs, also dispatch the **code-reviewer** subagent — the author
  should not be the only grader.
- Error handling: no new empty catches / swallowed errors / fail-open paths.
- Null/type safety: no new `any`, `!`, `!!`, or suppressions without justification.

## 4. AI-specific pitfalls (check explicitly — these are the common failure modes)

- Every imported package actually exists on the registry and is already in the
  manifest (no hallucinated/slopsquatted names).
- Every called API exists in the PINNED version of the dependency (check the
  lockfile version's docs, not the latest docs).
- No new 5+ line duplicate blocks — search for existing code that already does this
  and reuse it instead.
- Comments say WHY, not what; no narration comments ("call the function", "fix bug").

## 5. Security quick pass (full pass = /security-audit)

- No secrets in the diff or in new config/log output.
- New inputs validated at the boundary; new queries parameterized; new endpoints
  have authz checks.
- New dependencies were approved by the user and passed `/deps-check`.

## 6. UI changes only

- Keyboard walkthrough of changed flows; visible focus; labels on new form fields;
  contrast holds in light AND dark themes; layout verified at 320px and 200% zoom.
  (Deeper pass: `/ui-review`.)

## 7. Docs & memory

- docs/DECISIONS.md updated if any decision was made.
- docs/ARCHITECTURE.md updated if structure changed.
- docs/PROJECT.md corrected if any recorded command/fact proved wrong.
- README/user docs updated if user-facing behavior changed.

## Output

A short pass/fail table of sections 1–7 with evidence (command outputs, what was
exercised), then either "gate PASSED" or the ordered list of what must be fixed.
