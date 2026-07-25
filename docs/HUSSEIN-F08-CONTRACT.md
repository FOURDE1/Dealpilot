# F-08 — API contract for the checklist panel (AHMAD → HUSSEIN)

Backend merged on `develop`. Schemas are in `@dealpilot/schemas`
(`packages/schemas/src/checklist.ts`): `ChecklistCode`, `ChecklistTemplate`,
`DealChecklistItem`, `ChecklistReadiness`, `UpdateChecklistItemInput`,
`UpdateChecklistTemplateInput`. Parse responses with those — don't hand-roll types.

## Endpoints

| Method | Path | Returns |
|---|---|---|
| GET | `/api/v1/deals/:id/checklist` | `{ items: DealChecklistItem[], readiness: ChecklistReadiness }` |
| PATCH | `/api/v1/deals/:id/checklist/:code` | the updated `DealChecklistItem` |
| GET | `/api/v1/stores/:id/checklist-template` | `{ items: ChecklistTemplate[] }` |
| PATCH | `/api/v1/stores/:id/checklist-template/:code` | the updated `ChecklistTemplate` |

`readiness` is `{ deal_id, ready_for_delivery, outstanding: ChecklistCode[], hard_blocked }`.
Items arrive sorted by `sort_order`; render them in that order.

## What the panel has to get right

**An item has three states, not two.** Not done · done (`completed_at` set) ·
waived (`overridden_at` + `override_reason` + `overridden_by`). A waived item must
look visibly different from a done one and must show its reason — that text is the
whole point of the feature, it is what an auditor reads. Never render a waiver as a
plain checkmark.

**The safety inspection has no Waive button.** `overridable: false` — for that item,
don't render the control at all. The server refuses it with 422 `hard_block` for
every role, so a button there would only ever produce an error.

**Waiving needs a reason before you send.** `UpdateChecklistItemInput` refuses
`{overridden: true}` without `override_reason` (min 3 chars). Validate in the form so
the user isn't bounced by the server.

**Only owner/gm may waive**, un-waive, or tick the safety item — 403 otherwise. Hide
those controls for other roles, but treat the server as the authority: a 403 is a real
outcome to render, not a bug.

**A delivered deal's checklist is read-only — permanently.** Once the deal has a
`delivered_at`, every item PATCH returns **409 `deal_delivered`**, and that stays true
even if someone moves the deal back to an earlier stage. (It keys on `delivered_at`,
not the current stage, precisely so stepping back can't be used to strip the record.)
Render the panel read-only whenever `deal.delivered_at` is set, not when the stage
happens to read `delivered`.

**A deal can legitimately have NO checklist.** Deals created before this feature
shipped were not given one — the migration deliberately does not invent requirements
for deals already delivered or lost. In that case `items` is `[]` and readiness is
`{ready_for_delivery: false, outstanding: [], hard_blocked: false}`. Show "No checklist
was recorded for this deal", **not** "0 of 0 complete" and not an error. Any deal
created from now on always has its ten items.

**The kanban needs a new error path.** Moving a card to **Delivered or Complete** can
now fail with 422. Two codes:

- `checklist_incomplete` — items are outstanding, all of them waivable by a manager.
- `checklist_hard_blocked` — the safety inspection is among them, so no one can waive
  past it. Worth wording differently in the UI: the first is "finish these", the
  second is "this cannot be skipped".

`error.details` carries **one entry per outstanding item**, and each `details[].code`
is the checklist code itself (`insurance`, `safety`, …) — no string to split, and it
matches the codes you already have from `GET /deals/:id/checklist`, so you can render
each item's own `label_fr`/`label_en`. (`details[].message` is an English fallback;
don't show it to users.) Show which items are missing — "Cannot deliver" alone will
just make people think the app is broken.

This applies to `complete` too, not only `delivered`.

**An empty PATCH body is 422.** Don't send `{}` — send only fields that changed.

## Labels

Every item carries `label_fr` and `label_en` from the server; use those rather than
i18n keys, because a store can rename its own items. The ten codes are `insurance`,
`void_cheque`, `funding`, `idv`, `safety`, `vehicle_ready`, `wet_ink_file`,
`delivery_date`, `drivers_booked`, `registration`.

## Store settings screen

`PATCH /stores/:id/checklist-template/:code` takes `label_fr`, `label_en`, `required`,
`sort_order`, `active`. Switching `safety` off (either `required:false` or
`active:false`) returns 422 `hard_block`. Changes apply to deals created **after** the
edit — deals already in flight keep their own snapshot, so the settings screen should
say so plainly or the owner will think the change didn't work.

## Anything unclear

Leave a CR row in `docs/TASKS.md` and I'll answer there rather than guessing.
