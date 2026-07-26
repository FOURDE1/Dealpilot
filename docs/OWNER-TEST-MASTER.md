# Owner test cases — the running stack

**One place for everything waiting on you.** Ahmad and Hussein add to the bottom
as work lands. Nothing here is urgent; work down it whenever you have time, in
any order.

**To start the stack:** `pnpm dev` in the project root, then
http://localhost:5173 — login `hassan-test@1dealer.ca` / `Test-Dealpilot-2026!`.
If the login fails, run `bash apps/web/scripts/seed-owner.sh` with the stack up.

**Status key:** ⬜ waiting for you · ✅ you passed it · ❌ you found a problem
(tell us and we fix it before anything else) · 🔁 fixed since you tested — worth
another look.

**Rounds 1 and 2 are marked from your 2026-07-26 testing.** Three rows are 🔁
rather than ✅ because we changed something after you looked. Round 3 was a
placeholder and is gone — the real rounds are 4 onward.

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
| 1.1 | Team screen lists you as Owner, Active | You are there | ✅ |
| 1.2 | Add a member, edit their roles | Appears immediately; roles update | ✅ |
| 1.3 | Add the same email twice | Clear message, no crash | 🔁 |
| 1.4 | Assign a lead, filter "My leads" | Assignment sticks; filter is correct | ✅ |
| 1.5 | Remove a member, then **invite them back** | Rejoining works now (it failed with "operation failed" — fixed 2026-07-26). Their leads go back to the pool; who had them is in the lead's History | 🔁 |
| 1.6 | Desking worksheet, Quebec, the numbers in the doc | GST $1,375.00 · QST $2,743.13 · payment $640.09 · total gross $4,500.00 | ✅ |
| 1.7 | Switch province to Ontario | Two tax lines become one HST line | ✅ |
| 1.8 | Toggle FR ↔ EN | Amounts flip between "35 000,00 $" and "$35,000.00" | ✅ |
| 1.9 | Same worksheet on your phone | One column, no sideways scrolling | ✅ |

## ROUND 2 — Pipeline, inventory, delivery checklist, commissions (BATCH-02)

Full steps in [OWNER-TEST-BATCH-02.md](OWNER-TEST-BATCH-02.md). Ahmad walked all
four parts end-to-end against the running stack before handing this over, so the
numbers below are what the system actually produced, not what we hoped.

| # | What to check | Expected | Status |
|---|---|---|---|
| 2.1 | Deals board has the 10 stages | New … Complete, plus Lost | ✅ |
| 2.2 | Move a deal New → Submitted | Sticks after refresh | ✅ |
| 2.3 | Funding badge is a separate track | A deal can be Signed while funding is still Submitted | ✅ |
| 2.4 | Add a vehicle | Total cost = acquisition + transport + recon | ✅ |
| 2.5 | Duplicate stock number, then duplicate VIN | Refused, and the message names *which* field | ✅ |
| 2.6 | **Try to deliver a deal with an unfinished checklist** | **Refused, and it lists what's outstanding** | ✅ |
| 2.7 | Waive a soft item with no reason | Refused — it insists on a reason | ✅ |
| 2.8 | **Try to waive the safety inspection, as Owner** | **Refused. Nobody can, including you** | ✅ |
| 2.9 | Complete everything, then deliver | Goes through, delivery date recorded | ✅ |
| 2.10 | Try to un-tick something after delivery | Refused — unless you give a reason, which is now allowed and recorded (D-034) | 🔁 |
| 2.11 | Store settings: switch "Drivers booked" off | Allowed. Switching safety off is refused | ✅ |
| 2.12 | The deal from 2.6 still shows "Drivers booked" | Policy changes don't rewrite deals in flight | ✅ |
| 2.13 | Pay plan 25% + $1,500 pad, fund a deal **that makes money** | **Pad comes off BEFORE the rate** — $5,400 gross → $975. Your test deal sold at $26,900 against a $70,000 cost, so it lost $43,100 and correctly paid $0 — see the note below | 🔁 |
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

## Why your commission showed $0.00

Your funded test deal had a **sale price of $26,900 and a vehicle cost of
$70,000** — a $43,100 loss on paper. The engine floors the commissionable amount
at zero, so it paid nothing, which is correct: you do not pay a percentage of a
loss. The screen showing a bare "$0.00" without saying why is fair criticism and
is filed as CR-10.

To see 2.13 work properly, use a deal where the sale price is **above** the
vehicle cost. And you could not fix that deal because the worksheet has no edit
path at all — CR-07, the most important thing on Hussein's list.

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

**On your local stack, no email is actually sent** — it goes to the server log.
That is expected, and the app knows it: the invite form hands you the **link**
directly instead of claiming an email went out. Copy it into another browser
(or a private window) to play the part of the person being invited. Step 5.2
only applies once we're sending real mail.

**When we do go live on email:** we're on Amazon SES and the domain may still be
in sandbox, which only delivers to verified addresses. Same behaviour — you get
the link back — so nothing is ever stuck. Tell us and we'll request production
access.

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

## ROUND 8 — Inviting your team for real (F-12)

| # | What to do | Expected | Status |
|---|---|---|---|
| 8.1 | Team → fill name, email, roles → "Invite" | The person appears as **Invited** in the roster; a real email goes out (on this test machine the link shows on screen instead — see note) | ⬜ |
| 8.2 | Open the invitation link (private window) | It names your organization and the roles; the email address is pre-filled and locked | ⬜ |
| 8.3 | Create the password and accept | You land in the app as that person; back on your account, they are **Active** | ⬜ |
| 8.4 | Invite the same email again | "Already on the team" — no duplicate | ⬜ |
| 8.5 | Invite someone and "Cancel invitation" before they accept | The Invited row disappears; their link stops working | ⬜ |
| 8.6 | While someone is only Invited, open a lead's Assign list | They are NOT offered — they don't have an account yet (on purpose; tell us if that feels wrong: D-035) | ⬜ |

**Note (CR-05):** on this dev machine, emails land in a log instead of an
inbox, so the sheet may say "sent" while nothing arrives — we've asked for the
link to be shown on screen in dev. On the real AWS setup it goes by email.

## ROUND 9 — Deliveries & transport (F-11)

| # | What to do | Expected | Status |
|---|---|---|---|
| 9.1 | Organizations → your store → "Logistics" | Add a driver company (name + email), a chaser car and a dealer plate | ⬜ |
| 9.2 | On a deal, click "Book the delivery" BEFORE ticking the signed file | Refused in plain words: the driver leaves with a complete signed file — pointing you at the checklist | ⬜ |
| 9.3 | Tick "Wet-ink file" on the checklist, book again with a time, address, the company and cash to collect | Booked; the dialog closes | ⬜ |
| 9.4 | Dashboard → "View deliveries" | The run is on the board: customer, company, the PLATE and CHASER the system picked, and the cash amount standing out | ⬜ |
| 9.5 | Move the status | Only real moves are offered (Assigned → Departed → Arrived → Completed, or Cancelled); a completed run is frozen | ⬜ |
| 9.6 | "Resend request" | It tells the truth: re-sent, or the mail service is down — never a false failure | ⬜ |
| 9.7 | Book the same deal twice | "A run already exists for this deal." — by name, not a generic error | ⬜ |

**⚠ DECISION:** booking is restricted to owner, GM and logistics (matching the
API). Salespeople see the board link but get a plain "not allowed" message.

## ROUND 10 — Your findings, fixed (retest)

| # | What to do | Expected | Status |
|---|---|---|---|
| 10.1 | Open a deal → "Edit" → change the price → save | The worksheet opens on the deal's numbers; the payment recomputes — re-desking works | ⬜ |
| 10.2 | Remove someone who had an account, re-invite them, open their link, try "create account" | It switches to sign-in by itself with a plain message; their password gets them in and re-joined | ⬜ |
| 10.3 | Tick a checklist item | It now says who AND when, to the minute | ⬜ |

## ROUND 10 — Permissions (A-13) — **your D-033 ask**

Needs Hussein's settings screen before you can click it, but the rules are live
now and you can feel them.

| # | What to do | Expected | Status |
|---|---|---|---|
| 10.1 | Settings → Permissions: read the matrix | Every action in the system, and exactly what each of the 10 roles can do. This is the question you could not get an answer to before | ⬜ |
| 10.2 | Give "Salesperson" the right to add a vehicle, save | A salesperson can immediately stock a car — no deploy, no code change | ⬜ |
| 10.3 | Take it away again | They are refused straight away | ⬜ |
| 10.4 | Give ONE person an exception ("Marc can also do X") | Only Marc gains it. His colleagues do not | ⬜ |
| 10.5 | DENY one person something their role allows | Only that person loses it — useful while somebody is under review | ⬜ |
| 10.6 | Try to remove "change permissions" from Owner | Refused — otherwise nobody could ever undo it without a database console | ⬜ |
| 10.7 | Ask a salesperson to open the permissions screen | They can READ the rules but not change them | ⬜ |
| 10.8 | Check the History after any change | Every permission change is recorded with who made it | ⬜ |

**What changed underneath, in plain terms:** the rules used to be written in
about thirty different places in the code. They are now in one table you own,
per dealership group. Building it found **eleven actions that had no rule at
all** — "any member can desk a deal / create a lead / stock a car" was true and
nobody had ever decided it. Those are now rows you can see and change.

**On "100% secured":** that is a practice, not a finish line. What you have is
deny-by-default everywhere, one readable place defining who can do what, a test
that fails the build if a developer sneaks a rule back into the code, and an
audit trail of every change. Anyone who tells you a system is finished-secure is
selling something.

## ROUND 11 — Roles & permissions (A-13, your D-033)

| # | What to do | Expected | Status |
|---|---|---|---|
| 11.1 | Team → "Roles & permissions" | The full picture: every action, grouped, against every role — the answer to "what can a BDC agent do?" | ⬜ |
| 11.2 | Tick "Waive a checklist item" for Salesperson | Saved; reload — still ticked. Your salespeople can now waive (org-wide) | ⬜ |
| 11.3 | Untick "Manage roles" for Owner | Refused, worded as protection — you cannot lock yourself out | ⬜ |
| 11.4 | "Exception for one person": deny someone one permission with a reason | Their button disappears even though their role keeps it — deny wins | ⬜ |
| 11.5 | Check the risky rows (safety sign-off, everyone's pay, manage roles) | Each carries a one-line warning about what it really hands out | ⬜ |

## ROUND 12 — The paper file (F-13), the loss note (your finding), the shorter board (your finding)

> You test at http://localhost:5173 · hassan-test@1dealer.ca / Test-Dealpilot-2026!
> Big picture: every deal now carries its own PAPER FILE — the system derives
> which documents that exact deal needs (a financed deal needs a bank contract,
> an Ontario deal an OMVIC disclosure, a trade with money owing a lien payoff
> authorization…), and NOBODY can send a driver until every paper that needs a
> signature is actually printed. The "signed file" tick and the delivery booking
> both stopped trusting people's word — they check the papers.

| # | What to do | Expected | Status |
|---|---|---|---|
| 12.1 | Open any lead with a deal → "Documents" | The deal's paper list appears: bank contract, bill of sale, privacy consent, condition disclosure, odometer statement — with where each one stands | ⬜ |
| 12.2 | On a fresh deal, try "Book the delivery" | The form warns you up front, and refuses — NAMING each document that is not printed yet | ⬜ |
| 12.3 | On the delivery checklist, tick "Wet-ink file" before printing anything | Refused, again naming the papers. The tick is no longer a promise | ⬜ |
| 12.4 | In Documents, walk one paper forward: "Mark generated" → "Mark printed" | Each step is stamped with who and when; a paper can never jump a step (no "file it" button until it's been signed) | ⬜ |
| 12.5 | Print every paper | The banner flips to "File ready to travel"; now the wet-ink tick works and booking stops complaining | ⬜ |
| 12.6 | "Print the file sheet" | A clean printable checklist of the deal's papers — the sheet that physically travels with the driver | ⬜ |
| 12.7 | Tick "Sold as-is" on a deal (at creation or by editing), save, reopen Documents | An "As-is waiver" appeared by itself — the list follows the deal's shape. Untick it and the unused waiver leaves the file. (An earlier same-day gap here — the tick not sticking at creation — was found, filed as CR-12, and fixed before you read this) | ⬜ |
| 12.8 | Open the deal's History | Every document move is there: which paper, from what to what, by whom | ⬜ |
| 12.9 | Commissions: find your $26,900-on-$70,000 test deal | No more bare "$0.00" — it says "Deal at a loss (−$43,100.00) — no commission." The math was always right; now the screen says why | ⬜ |
| 12.10 | Open the Pipeline | Empty stages fold into thin side tabs — the board is as wide as your actual work. Click a tab to peek at an empty stage; move a deal into one and it opens by itself | ⬜ |

**Also worth knowing:** marking a paper "signed" or "filed" is a graded right
(`document:sign`) — by default only owner/GM/F&I/office hold it, because that
record is the evidence a delivery rests on. A salesperson can no longer mark a
bank contract signed. You can change all of this in Roles & permissions.
