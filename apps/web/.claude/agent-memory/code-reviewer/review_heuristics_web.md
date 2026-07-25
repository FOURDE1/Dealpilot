---
name: review-heuristics-web
description: Recurring gotchas when reviewing apps/web UI diffs (stacking vs portal overlays, branch-vs-worktree diffs, sanctioned arbitrary values)
metadata:
  type: project
---

Review heuristics learned on apps/web shell/UI diffs:

- `packages/ui` overlay components (DialogContent backdrop/popup) intentionally carry NO z-index (z-auto). Any app code adding `z-*` on fixed/sticky elements will paint ABOVE portaled modals. Check stacking on every positioned-element addition until the ui package defines a layer scale.
  **Why:** first caught in the mobile bottom-nav review (z-10 nav over z-auto dialog).
  **How to apply:** grep `packages/ui/src/components/dialog.tsx` (and future popover/toast) for z-index before approving any new `fixed`/`z-` class in apps/web.
- `hussein/*` and `ahmad/*` work branches sometimes hold their work UNCOMMITTED in the working tree while the branch ref still equals develop — `git diff develop..branch` comes back empty. Always also check `git status` + working-tree diff when asked to review a branch.
- Sanctioned-looking "violations" that are actually the convention here: `text-[13px]`/`text-[11px]`/`text-[15px]` arbitrary sizes ARE the spec type scale (ui-design-system.md §5, line ~134); Playwright e2e files hardcode French UI strings (FR-first, matches auth.e2e.ts). Don't flag these.
- Spec authority for shell/responsive work: `reference/kia-tracker-specs/docs/new/06-tech-stack/ui-design-system.md` §7 — bottom tab bar is <640px only with 5 entries (Dashboard, Pipeline, Leads, Appointments, More); tablet 640–1024 gets a sidebar DRAWER, not a tab bar. Compare increments against this table.
