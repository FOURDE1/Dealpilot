---
name: session-save
description: Persist the current session's context into docs/ so no memory is lost. Use at the end of a working session, before context gets long, when the user says "save progress", "wrap up", or "session save", or before switching to an unrelated task.
---

# Session Save

Write everything a future session (with zero memory of this one) needs, into the
project's docs. The test: could a fresh Claude instance pick up exactly where this
session stopped, using only the repo?

## Steps

1. **SESSION_LOG.md** — prepend a new entry to `docs/SESSION_LOG.md` using the format
   defined at the top of that file. Be concrete: file paths, command outputs that
   mattered, exact next steps. "Fixed the bug" is useless; "Fixed off-by-one in
   `src/pager.ts:114`; root cause was inclusive upper bound; regression test added in
   `pager.test.ts`" is useful.

2. **DECISIONS.md** — if any decision was made this session that isn't logged yet,
   add it now (format at top of `docs/DECISIONS.md`).

3. **ARCHITECTURE.md** — if code structure changed (new module, moved boundary,
   new data flow), update the relevant section. Skip if nothing structural changed.

4. **PROJECT.md** — if a command, convention, or boundary was discovered or changed
   (e.g. the real test command differs from what's recorded), correct it.

5. **Uncommitted work check** — run `git status`. If there are uncommitted changes,
   list them in the SESSION_LOG entry under "In progress" so they aren't mistaken
   for stray files later. Do NOT commit unless the user asked. If the folder is not
   a git repository yet, note that in the log and suggest `git init` — the workflow
   assumes one.

6. **Report** — end with a 3-line summary to the user: what was saved, what's open,
   and the recommended first action for next session.

## Rules

- Never store secrets, tokens, or credentials in any doc file.
- Facts belong in docs, not in chat history — chat is lost, docs persist.
- If the session discovered that something in the docs was WRONG, fixing the doc
  matters more than adding new entries.
