# Owner decisions pending — stacked for Hassan

Things only the owner can answer. Nothing here is blocking: each one has a
defensible default already implemented, noted below. When you answer, the answer
moves to `docs/DECISIONS.md` and the code follows.

---

## D-033 — Who may sign off the safety inspection? *(F-08, raised 2026-07-26)*

**Currently implemented:** owner and GM only.

**Why I chose that:** the safety inspection is the one checklist item nobody can
waive, because it is a legal obligation. But if any member could simply *tick* it,
"cannot be waived" would just mean "use the other button" — ticking it is a
statement that the inspection actually happened, so it carries the same weight as
waiving one of the soft items. Restricting it to owner/gm is the safe default.

**Why you may want it different:** in a real store, the person who knows the
inspection happened is usually the used-car manager, or logistics, not the GM.
Making the GM tick every one of them may just mean the GM ticks them without
looking — which is worse than a narrower rule honestly applied.

**What I need from you:** which roles should be able to record the safety
inspection? (Options: owner/gm only — as built; add `used_car_manager`; add
`logistics`; add both.) One sentence is enough.

---

## D-034 — Should a delivered deal's checklist ever be editable? *(F-08, raised 2026-07-26)*

**Currently implemented:** no. Once a deal reaches `delivered` or `complete`, its
checklist is frozen (409). It is the record of why delivery was allowed.

**The tradeoff:** if someone ticks an item by mistake and delivers, there is no way
to correct the record. The alternative is to allow edits after delivery with a
mandatory reason and a history table — more honest, but it is a new table and a
new screen, so I did not build it speculatively.

**What I need from you:** is "frozen after delivery" right for your stores, or do
you want a correction path with an audit trail? If corrections happen in real life
more than rarely, say so and I will build the history table.

---

## Already answered — no action needed

- SES over Resend for email (D-029). Built.
- Per-store configurable checklist items (D-020). Built — each store can switch its
  own items on and off, except the safety inspection.
- Larger batches before each test round (D-032). In effect.
