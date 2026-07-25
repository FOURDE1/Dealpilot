# Owner test cases — the running stack

**One place for everything waiting on you.** Ahmad and Hussein add to the bottom
as work lands. Nothing here is urgent; work down it whenever you have time, in
any order.

**To start the stack:** `pnpm dev` in the project root, then
http://localhost:5173 — login `hassan-test@1dealer.ca` / `Test-Dealpilot-2026!`.
If the login fails, run `bash apps/web/scripts/seed-owner.sh` with the stack up.

**Status key:** ⬜ waiting for you · ✅ you passed it · ❌ you found a problem
(tell us and we fix it before anything else).

---

## How to read this

Each item says what to do and **what should happen**. If what happens differs
from what's written, that is a finding — write one line about it, we'll take it
from there. You do not need to describe it well; "the safety thing let me skip
it" is plenty.

Anything marked **⚠ DECISION** is a place where we picked something on your
behalf because you told us to keep moving. Each says what we chose and what the
alternative was. Changing any of them later is cheap — none is baked in.

---

## ROUND 1 — Team, leads and desking (BATCH-01)

Full steps in [OWNER-TEST-BATCH-01.md](OWNER-TEST-BATCH-01.md). Summary of what
should be true:

| # | What to check | Expected | Status |
|---|---|---|---|
| 1.1 | Team screen lists you as Owner, Active | You are there | ⬜ |
| 1.2 | Add a member, edit their roles | Appears immediately; roles update | ⬜ |
| 1.3 | Add the same email twice | Clear message, no crash | ⬜ |
| 1.4 | Assign a lead, filter "My leads" | Assignment sticks; filter is correct | ⬜ |
| 1.5 | Remove a member | Their leads return to the pool, not to a ghost | ⬜ |
| 1.6 | Desking worksheet, Quebec, the numbers in the doc | GST $1,375.00 · QST $2,743.13 · payment $640.09 · total gross $4,500.00 | ⬜ |
| 1.7 | Switch province to Ontario | Two tax lines become one HST line | ⬜ |
| 1.8 | Toggle FR ↔ EN | Amounts flip between "35 000,00 $" and "$35,000.00" | ⬜ |
| 1.9 | Same worksheet on your phone | One column, no sideways scrolling | ⬜ |

## ROUND 2 — Pipeline, inventory, delivery checklist, commissions (BATCH-02)

Full steps in [OWNER-TEST-BATCH-02.md](OWNER-TEST-BATCH-02.md). Ahmad walked all
four parts end-to-end against the running stack before handing this over, so the
numbers below are what the system actually produced, not what we hoped.

| # | What to check | Expected | Status |
|---|---|---|---|
| 2.1 | Deals board has the 10 stages | New … Complete, plus Lost | ⬜ |
| 2.2 | Move a deal New → Submitted | Sticks after refresh | ⬜ |
| 2.3 | Funding badge is a separate track | A deal can be Signed while funding is still Submitted | ⬜ |
| 2.4 | Add a vehicle | Total cost = acquisition + transport + recon | ⬜ |
| 2.5 | Duplicate stock number, then duplicate VIN | Refused, and the message names *which* field | ⬜ |
| 2.6 | **Try to deliver a deal with an unfinished checklist** | **Refused, and it lists what's outstanding** | ⬜ |
| 2.7 | Waive a soft item with no reason | Refused — it insists on a reason | ⬜ |
| 2.8 | **Try to waive the safety inspection, as Owner** | **Refused. Nobody can, including you** | ⬜ |
| 2.9 | Complete everything, then deliver | Goes through, delivery date recorded | ⬜ |
| 2.10 | Try to un-tick something after delivery | Refused — it's the record now | ⬜ |
| 2.11 | Store settings: switch "Drivers booked" off | Allowed. Switching safety off is refused | ⬜ |
| 2.12 | The deal from 2.6 still shows "Drivers booked" | Policy changes don't rewrite deals in flight | ⬜ |
| 2.13 | Pay plan 25% + $1,500 pad, fund a deal | **Pad comes off BEFORE the rate** — $5,400 gross → $975, not $1,350 | ⬜ |
| 2.14 | Fund the same deal again | Still ONE commission line. Cannot double-pay | ⬜ |

**2.13 is the one to look at hardest.** It is the exact calculation the old
system got wrong.

---

## ⚠ DECISIONS WE MADE FOR YOU

Each of these was a real fork. We picked the safer side and kept moving. Tell us
if you want any of them the other way — all are cheap to change.

### D-033 — Only Owner and GM can sign off the safety inspection
**Why:** ticking it is a statement that a legally required inspection happened,
so it carries the same weight as waiving something. If any salesperson could
tick it, "cannot be waived" would just mean "use the other button".
**The other way:** let the used-car manager or logistics record it too — they're
usually the ones who actually know. Say the word.

### D-034 — A delivered deal's checklist is frozen
**Why:** it becomes the evidence that delivery was allowed.
**Now possible:** we built the activity trail, so a correction path *with* a
recorded reason is buildable if mistakes turn out to be common in real life.
Tell us if they are.

### D-035 — see the invitation section below
The big one. Details in the next section as it lands.

---

## ROUND 3 — added as work lands

Ahmad and Hussein append here. Empty sections mean the work is in flight.

## ROUND 4 — Activity history (F-10)

Every change now leaves a line — who did it, when, and what changed.

| # | What to do | Expected | Status |
|---|---|---|---|
| 4.1 | Open any lead → scroll to "History" | Every act on that lead is listed — creation, status changes, assignments — each with the person's name and time | ⬜ |
| 4.2 | Change the lead's status, look again | The change appears at the top immediately, with old → new | ⬜ |
| 4.3 | Pipeline → any deal card → "History" | Stage moves, funding moves and the deal's creation are all there | ⬜ |
| 4.4 | Waive a checklist item with a reason, then open that deal's History | The waiver appears WITH your reason — that line is the audit record | ⬜ |
| 4.5 | Switch FR ↔ EN | Action names translate; dates reformat | ⬜ |
