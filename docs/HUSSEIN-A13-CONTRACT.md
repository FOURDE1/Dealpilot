# A-13 permissions — API contract for the settings screen (AHMAD → HUSSEIN)

Merged on `develop`. Schemas in `@dealpilot/schemas`
(`packages/schemas/src/permissions.ts`); contract is `apiV1.permissions`.

## Why this exists

Owner decision D-033. Access rules used to be ad-hoc role lists in ~30 call
sites, so "what can a BDC agent do?" had no readable answer. Now there is one
catalogue of 37 permissions and a per-organization matrix the owner edits.

## Endpoints

| Method | Path | Who | Returns |
|---|---|---|---|
| GET | `/api/v1/permissions` | any member | `{permissions[], roles[], matrix}` |
| GET | `/api/v1/permissions/mine` | any member | `{permissions[]}` — the signed-in person's |
| PUT | `/api/v1/permissions/role` | `member:update_roles` | the updated matrix |
| PUT | `/api/v1/permissions/user` | `member:update_roles` | 204 |

## The screen

**A grid: permissions down, the ten roles across.** `matrix` is
`role → permissions[]`, so a cell is `matrix[role].includes(permission)`.

**Saving a role replaces its whole set.** `PUT /permissions/role` takes
`{organization_id, role, permissions[], base_version}` and the list is complete
— anything absent is revoked. Send the full set, not a delta.

**`base_version` is required** (CR-10a). It comes from `versions[role]` in the
matrix you loaded. Two admins with the screen open used to silently undo each
other: the second blind full-set write resurrected whatever the first revoked,
and the audit trail blamed the second admin for a grant they never chose. A
stale save now gets **409 `matrix_changed`** — their edit is fine, their VIEW is
old, so the message should offer a reload rather than sound like a failure.

**Two refusals to render properly:**
- **422 `would_lock_out`** — removing `member:update_roles` from `owner`. There
  would be no way back without a database console, so it is refused outright.
  Word it as protection, not as an error.
- **403** — a member who may read the matrix but not change it. Reading the
  rules is deliberately open: someone who cannot see why they were refused just
  files a support ticket.

**Reading the exceptions.** `GET /api/v1/permissions/overrides` (optionally
`?user_id=`) lists what exists — who has an exception, whether it grants or
denies, the reason, and who set it. Needs `member:update_roles`, same as setting
one. Without this the screen was set-only and an admin could never take back
what they had granted.

**Per-person exceptions.** `PUT /permissions/user` takes
`{organization_id, user_id, permission, allowed, reason?}`.
`allowed: true` grants, `false` **denies** (useful while someone is under
review), and `null` clears the override and returns them to their role. Ask for
the reason — an unexplained exception is the thing nobody dares remove three
years later.

**Hide what would 403.** `GET /permissions/mine` returns the signed-in person's
effective permissions, overrides applied. Use it to hide buttons rather than
letting people click into a refusal. Keep handling the 403 anyway — the server
is the authority and the matrix can change while a page is open.

## Please group the permissions sensibly

They come back as a flat list of 37. The owner is a dealer, not an engineer —
group them the way he thinks: Team · Leads · Inventory · Deals & delivery ·
Money · Dispatch · Settings. The `resource:action` prefix gives you the grouping
for free.

Ones worth a word of explanation next to the checkbox, because getting them
wrong has consequences:
- `checklist:sign_safety` — signing off a legally required inspection.
- `checklist:correct_delivered` — editing a delivered deal's record (D-034).
- `commission:read_all` — seeing everybody's pay, not just your own.
- `member:update_roles` — this is the one that can hand out every other one.
- `intake_key:manage` — webhook credentials; a standing key to the front door.

## Also worth knowing

Building this found **eleven actions with no rule at all** — creating a deal, a
lead, a vehicle, and others were open to any active member. They now have
defaults, so a salesperson's abilities are narrower than they were yesterday. If
something that used to work starts returning 403 for a role, that is why: check
the matrix first before assuming it is a bug.

## Anything unclear

File a CR row in `docs/TASKS.md`.
