---
name: self-heal
description: Iteratively run build, lint, type-check, and tests, fixing failures until everything passes or a human decision is needed. Use when the user says "fix the build", "make tests pass", "self heal", after large refactors, or when multiple checks are failing at once.
---

# Self-Heal Loop

Run the project's verification commands in a loop, fixing root causes until green.
This is a disciplined debugging loop, not whack-a-mole.

## Loop

Repeat until all checks pass (or an exit condition below fires):

1. **Run checks in order** (commands from `docs/PROJECT.md`; discover and record
   them if missing): install/sync deps → type-check → lint → build → unit tests →
   integration tests. Stop at the FIRST failing stage — later stages are noise
   until earlier ones pass.

2. **Diagnose before touching code.** Read the full error, find the failing file
   and line, and state (to yourself) the root cause hypothesis. If the same error
   has appeared twice already, your hypothesis was wrong — reread the actual code
   path instead of patching symptoms.

3. **Fix the root cause, not the message.** Deleting a failing test, loosening a
   type to `any`, adding a lint-disable comment, or widening a catch block are NOT
   fixes — they are forbidden unless the user explicitly approves that specific
   suppression, and each approved one gets a comment explaining why.

4. **Re-run the failed check** to confirm the fix, then restart from step 1 so the
   fix didn't break an earlier stage.

## Exit conditions — stop and ask the user when:

- The fix would change public API, database schema, or documented behavior.
- Two plausible fixes exist with different tradeoffs (report both, recommend one).
- A test is failing because the SPEC is ambiguous — the test and the code disagree
  and you cannot tell which one encodes the real requirement.
- 3 consecutive iterations made no progress on the same failure (report everything
  tried and the current hypothesis).
- The failure is environmental (missing service, credentials, network) rather than
  in the code.

## After the loop

- Summarize: what was broken, root causes found, files changed, checks now passing
  (with the actual final command outputs, not just "all green").
- Add any non-obvious root cause to `docs/SESSION_LOG.md` gotchas.
- If the loop revealed a missing test (a bug no test caught), write that test.
