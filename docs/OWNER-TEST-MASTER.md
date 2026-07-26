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

### D-035 — Invitations: we built Option A (the one Ahmad recommended)
**The problem:** adding "Marc Seller" created his row on the Team screen but sent
him nothing, and he could never log in. If he signed up himself he got a
completely separate account with no link to your roster.
**What we built:** adding someone now emails them a link. They set a password,
and *that* is when they become a real member. Until then the Team screen shows
them as **Invited**.
**The visible change you were asked about:** you cannot assign leads to someone
who has not accepted yet. We think that is right — assigning work to an account
that cannot log in is what was broken — but it is a real change, and it is
reversible if you disagree.
**The other way (Option B):** keep the roster row working as it does now and
attach a login to it later. Say the word and we switch.

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

## ROUND 5 — Invitations (F-12) — **the D-035 fix**

This is the one that closes "an invited person can never log in". Test it with
a second email address you control (a personal Gmail is fine).

| # | What to do | Expected | Status |
|---|---|---|---|
| 5.1 | Team → invite someone, using an email you can actually open | They appear as **Invited**, not Active | ⬜ |
| 5.2 | Check that inbox | An email arrives, in French first then English, with a link | ⬜ |
| 5.3 | Open the link **while signed out** | It says which dealership invited you and as what role — nothing else | ⬜ |
| 5.4 | Set a password and accept | You land in the app as that person, on your dealership | ⬜ |
| 5.5 | Sign back in as yourself → Team | They are now **Active**, with the roles you chose | ⬜ |
| 5.6 | Open the same link again | It no longer works — one use only | ⬜ |
| 5.7 | Invite the same person again | Refused: already on the team | ⬜ |
| 5.8 | Invite someone, then revoke it before they accept | Their link stops working immediately | ⬜ |
| 5.9 | Try to assign a lead to someone still **Invited** | Not offered. That is the D-035 trade-off above | ⬜ |

**Worth knowing:** the link expires after 7 days, and if you forward it to
someone else it will not work for them — accepting requires signing in as the
invited email address. That is deliberate: an invitation is a key to your
business data.

**If email doesn't arrive:** we're on Amazon SES and the domain may still be in
sandbox, which only delivers to verified addresses. In that case the API hands
the link back so you can pass it on manually, and 5.2 is the only step that
fails — everything else still works. Tell us and we'll request production access.

## ROUND 6 — Dispatch (F-11): getting the car to the customer

Needs Hussein's dispatch board before you can click through it. The rules below
are what the system does today, so you can sanity-check them against how your
store actually runs.

| # | What to do | Expected | Status |
|---|---|---|---|
| 6.1 | Settings → Fleet: add two dealer plates and one chaser car | They appear, both plates "available" | ⬜ |
| 6.2 | A deal **with** a trade-in → book the delivery | **1 driver, no chaser** — the driver brings the trade-in back | ⬜ |
| 6.3 | A deal **without** a trade-in → book the delivery | **2 drivers + the chaser** — someone has to bring driver 1 home | ⬜ |
| 6.4 | Book a second delivery the same afternoon | Uses the **second** plate — no warning, because there is one free | ⬜ |
| 6.5 | Book a **third** the same afternoon (only two plates) | Booked anyway, **flagged** with which plate clashes and with which deal | ⬜ |
| 6.6 | Book something for next week | No warning — a plate booked Friday is free on Tuesday | ⬜ |
| 6.7 | Mark a run departed, then arrived, then completed | The plate and chaser go back to "available" | ⬜ |
| 6.8 | Cancel a booked run | Same — a called-off run must not lock up a plate | ⬜ |
| 6.9 | Try to mark a run "arrived" without "departed" | Refused. The ETA you gave the customer was never true | ⬜ |
| 6.10 | Try to edit a completed run's driver | Refused — it is the record now | ⬜ |
| 6.11 | Cancel the run that a flagged one clashed with | The flag clears by itself — no stale warnings on the board | ⬜ |
| 6.12 | Try to remove a plate a booked run needs | Refused, with why. Cancel that run first, then it removes | ⬜ |

**The judgement call to check (6.5):** a clash never blocks the booking. It gets
flagged so a dispatcher can look at it, because you can fix a flagged run and
you cannot fix a refusal. The window is **4 hours** either side, and it is
per-store — say the word if your geography wants something different.

## ROUND 7 — Dispatch paperwork (F-11b)

| # | What to do | Expected | Status |
|---|---|---|---|
| 7.1 | Settings → Driver companies: add one with a real email you can open | Saved. Leave the store blank to make it usable by every store | ⬜ |
| 7.2 | **Try to book a delivery before ticking "Wet-ink file" on the checklist** | **Refused** — a driver must not leave without the signed file | ⬜ |
| 7.3 | Tick "Wet-ink file", then book, choosing that driver company | Booked, and an email goes out | ⬜ |
| 7.4 | Read that email | French first then English; both addresses; cash to collect; and it says **why** the second driver is coming | ⬜ |
| 7.5 | Book one with a trade-in | The email says the driver returns in the trade — no second driver | ⬜ |
| 7.6 | Add cash to collect, e.g. $1,500 | Shows as "1 500,00 $" and "$1,500.00" — a driver carrying money should see it in their own language | ⬜ |
| 7.7 | Hit "Resend" on a booked run | Goes out again | ⬜ |
| 7.8 | Book a run with no driver company | Allowed — you may drive it yourself. Nothing is emailed | ⬜ |

**7.2 is a real workflow change:** you now cannot send a driver before the
signed file is ticked (or waived, with a reason) on the delivery checklist. We
used the checklist you already have rather than inventing a second place to
track the same paperwork. If that is too strict for how your store runs, say so.

**⚠ STILL NOT BUILT:** the customer "your car is on its way" notification and
the driver's own status updates feed. Everything else in dispatch is done.

## ROUND 5 — Look, feel and accessibility (app-wide pass)

| # | What to do | Expected | Status |
|---|---|---|---|
| 5.1 | Top bar → the new theme button ("Dark mode") | The whole app flips to a dark look and REMEMBERS it after closing the browser | ⬜ |
| 5.2 | On your phone, open every tab | Nothing scrolls sideways anywhere; all six tabs fit; the current tab has a blue marker line | ⬜ |
| 5.3 | Waive a checklist item | The "Waived" tag now has an amber background (it used to be plain text) | ⬜ |
| 5.4 | Press Tab on any page, first thing | An "Aller au contenu / Skip to content" button appears — Enter jumps past the menu | ⬜ |
| 5.5 | Look at your browser tabs | Each page names itself (e.g. "Prospects — 1Dealer"), not just "1Dealer" | ⬜ |
| 5.6 | Commissions in the left menu | It is there now; the deal column names the customer and clicks through to them | ⬜ |
| 5.7 | Open a lead's History | Field names in plain words ("Statut", "Étape") and values in French/English — no more computer codes | ⬜ |

**⚠ DECISION (theme default):** first visit follows your device's light/dark
preference; the button then remembers your choice. Alternative was light-always.
