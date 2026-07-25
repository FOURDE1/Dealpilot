---
name: review-environment-quirks
description: How to run verification in this repo — pnpm PATH location, and the working tree can be switched/rebased mid-review by the two-agent workflow
metadata:
  type: project
---

Two facts that shaped the H-02 review (2026-07-23) and will recur:

1. `pnpm`/`node` are NOT on the default non-interactive shell PATH. Use
   `export PATH="$HOME/.nvm/versions/node/v24.14.0/bin:$PATH"` first (adjust
   version if `.nvmrc` changes; repo pins Node 22 but the machine had 24.x).

2. The owner runs a two-agent parallel build (branches `ahmad/*` / `hussein/*`
   into `develop`) and actively checks out branches / runs rebases in the SAME
   working tree while a review is in progress. Mid-review the tree silently
   moved from the review branch to a conflicted rebase of develop.
   **Why:** single machine, two agent sessions sharing one clone.
   **How to apply:** treat the diff's git refs (`git show branch:file`) as the
   review source, run build/tests EARLY while the tree matches the branch tip
   (confirm with `git rev-parse HEAD` + `git status` immediately before and
   after), and never assume the start-of-conversation gitStatus snapshot is
   still current. Confirmed again 2026-07-24: the review branch itself was
   amended mid-review (246dbcc → e2f1193) — `git rev-parse` the target at start,
   review that SHA, then re-resolve and diff old..new head before reporting.

3. Gitignored build artifacts (`dist/`) in the shared tree can be STALE from the
   other session building a different branch state. Confirmed 2026-07-24 (H-04
   review): running `node scripts/check-parity.mjs` directly against a leftover
   `packages/i18n/dist` produced a FALSE failure ("en-CA missing common.signOut")
   that the committed source did not have. Always run the package script (which
   rebuilds) or `pnpm build` with output VISIBLE first; never trust an existing
   dist, and never suppress build exit codes (`>/dev/null 2>&1` hid the state).

5. The full local e2e stack is often ALREADY RUNNING (Docker Postgres :5434
   `dealpilot-db`, API :3001, Vite :5173 — playwright webServer reuses 5173).
   Probe with `docker ps` + curl before assuming e2e is unrunnable; a single
   spec runs in seconds: `cd apps/web && ./node_modules/.bin/playwright test
   e2e/<file> --reporter=line`. Caveat: the running API process may predate
   the branch — Vite serves the tree live, the API does not hot-reload.
   Confirmed 2026-07-25 (F-03): branch refs also move mid-review here — the
   first `git diff develop..branch` was EMPTY, the commit appeared minutes
   later; re-run the diff before trusting "no changes".

4. You can run a branch's build/tests WITHOUT touching the working tree and
   without installing: deps persist in gitignored `node_modules` across
   checkouts. Recipe (verified with vitest 3, tsc, Tailwind v4 CLI):
   `git archive <branch> packages/<pkg> tsconfig.base.json | tar -x -C $SCRATCH/mono`
   (mirror monorepo depth so `extends: ../../tsconfig.base.json` resolves), then
   `ln -s $REPO/packages/<pkg>/node_modules $SCRATCH/mono/packages/<pkg>/node_modules`
   and run `./node_modules/.bin/vitest run` etc. from the copy.
