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

---

## ROUND 13 — F&I products, scanned pages, and the customer's own notice

> You test at http://localhost:5173 · hassan-test@1dealer.ca / Test-Dealpilot-2026!
>
> **Big picture, in one line each:**
>
> 1. **F&I is itemised now.** A warranty, a GAP policy, rustproofing — each is
>    its own line with its own name, and each one puts its OWN agreement in the
>    customer's paper file. Before this, three of the thirteen document types
>    could never appear at all, because F&I was one nameless number and there was
>    nothing to name an agreement after.
> 2. **A filed page can be checked, not just claimed.** You can attach the
>    scanned signature page to a document. The system records a fingerprint of
>    those exact bytes and re-checks it every time the file is opened — if the
>    file ever changes, it refuses to show it rather than hand you an altered
>    contract.
> 3. **The customer hears from you when the driver leaves** — in their language,
>    with the arrival time in YOUR store's clock.

| # | What to do | Expected | Status |
|---|---|---|---|
| 13.1 | Open a deal → F&I → add a warranty: name it "Safe-Guard 5 ans", price $2,500, cost $1,500 | It saves, and **the deal's F&I total becomes $2,500** — the total is now the sum of the lines | ⬜ |
| 13.2 | Open that deal's Documents | A **"Warranty agreement — Safe-Guard 5 ans"** is in the file, named after the product. This document could not exist at all before today | ⬜ |
| 13.3 | Add a GAP and two aftermarket items (say "Antirouille" and "Protection peinture") | Each gets its own agreement. The two aftermarket ones are **named differently** — a clerk holding the folder can tell them apart | ⬜ |
| 13.4 | Open the Documents list, close it, open it again, three or four times | The list does **not** grow. (Before the fix, every open added another copy of each aftermarket agreement to the customer's file) | ⬜ |
| 13.5 | Delete the "Antirouille" line | Its agreement leaves the file. **"Protection peinture" stays.** The F&I total drops by that amount | ⬜ |
| 13.6 | Try to add a SECOND warranty to the same deal | Refused — "this deal already has a warranty". One warranty, one GAP, as many aftermarket items as you sell | ⬜ |
| 13.7 | Try to save a product with a cost HIGHER than its price. Then add a good one and try editing its price *down* below its cost | Both refused — the same loss cannot slip in through an edit that the create form would have caught | ⬜ |
| 13.8 | Take a deal where you typed an F&I number by hand, then add your first product | The typed number is **replaced** by the product total. Check the deal's History — the change is recorded, from what to what. Nothing about money moves silently | ⬜ |
| 13.9 | On any document, attach a scanned page (PDF or a photo) | It uploads, and the document now shows it has a page on file | ⬜ |
| 13.10 | Open that attached page back up | It downloads and opens normally | ⬜ |
| 13.11 | Attach the SAME file again, then attach a DIFFERENT one | The same file changes nothing; a different one is stored **beside** the first, not over it. A corrected scan never erases what was filed before | ⬜ |
| 13.12 | Attach something that is not a PDF or an image (a .docx, say) | Refused, clearly | ⬜ |
| 13.13 | Look at a deal where every signature page has been scanned in | It reports the file as **verified** — a different, stronger statement than "someone ticked signed". Nothing is blocked by it yet, on purpose — see D-039, I need your answer | ⬜ |
| 13.14 | Print a deal's file sheet, then mark the whole stack printed in one go | One action moves them all. If one of them can't make that move, **nothing** moves and it tells you why — a half-marked file is exactly what would fool the booking gate | ⬜ |
| 13.15 | Book a delivery, put a real email on the customer's lead, then mark the run "departed" | The customer gets an email: their car is on the way, in **French** unless the lead says English, with the arrival time in **your store's timezone** and your store's phone number | ⬜ |
| 13.16 | Change the arrival time on that run, then change the driver's phone number | The new arrival time earns a second email; the phone correction does not. They are told what matters to them, not every edit | ⬜ |
| 13.17 | Mark a run departed for a deal whose customer has **no email** on file | The delivery still goes ahead, and the run does **not** claim the customer was notified. (Local testing prints emails to the log rather than sending them — so on your machine the run will correctly say "not notified") | ⬜ |
| 13.18 | Open a dispatch run → its status feed | Every step of that run in order — booked, departed, arrived — who did it and when | ⬜ |

**Two I need YOU to judge, not me:**

- **13.a** Does the customer email read like something you would sign your
  dealership's name to? It is deliberately plain — no logo, no tracking, no
  link. Tell me if you want it branded, or shorter, or with the salesperson's
  name in it.
- **13.b** In 13.8, the hand-typed F&I number is replaced by the itemised total.
  I think that is right — the itemised list is the better record — but it is
  your money and your call. If you would rather it refuse and make the user
  clear the old number first, say so.

**Waiting on you (nothing is blocked, but these shape what I build next):**
D-036 (as-is vs safety inspection), D-037 (do you sell credit life / disability
insurance?), D-038 (should a funded deal's money be frozen like a delivered
checklist is?), D-039 (should filing require the scanned pages?). All four are
written out in `docs/OWNER-DECISIONS-PENDING.md`.

> **Numbering note:** rounds 5 and 10 each appear twice further up this file —
> a slip from an earlier session. I have not renumbered them under you
> mid-testing; go by the titles, not the numbers.

**One note from Hussein (the UI half):** adding an F&I product now updates the
deal's payment and every derived figure immediately, everywhere — the pipeline
card included, no re-save needed (an earlier same-day lag was filed as CR-13 and
fixed before you read this). The F&I total boxes on the worksheet go grey once
products exist because the itemised list owns them; type your F&I by hand only
on deals with no product lines.

---

## ROUND 14 — Your own brand (F-14, server half)

> **Heads up:** this round is mostly **API-level**. The screens for it — the
> colour pickers, the live preview — are Hussein's next piece, and until they
> land there is nothing to click. I am listing it now so the behaviour is
> written down before you see it, and so you know what to expect when the editor
> arrives.
>
> **What it is:** the app stops being one dealership's app. Your group's name,
> colours, font and corner style, from the same single installation that serves
> everyone else. Nobody rebuilds anything for you.

**The part I want you to know about, because it is a decision I made for you:**

You can pick a colour that is impossible to read — a pale yellow, a near-white.
The system **does not refuse it**. It keeps your yellow on your buttons exactly
as you chose it, and quietly darkens the *text* version of it until it can be
read, keeping the same colour family. It then tells you it did that, with the
numbers.

I chose that over refusing to publish, because being told "your brand is
invalid" is worse than being told "your link colour was adjusted from 2.9:1 to
4.5:1". If you would rather it hard-refuse and make you pick again, say so and I
will switch it.

| # | What to do | Expected | Status |
| --- | --- | --- | --- |
| 14.1 | (When the editor lands) Set your group's display name and a primary colour, save | Saved as a **draft**. Nothing on anyone else's screen changes yet | ⬜ |
| 14.2 | Look at the app in another browser/window while the draft is unsaved | Still the old look. A draft never repaints the floor | ⬜ |
| 14.3 | Press publish | Now everyone sees it | ⬜ |
| 14.4 | Edit the colour again but do NOT publish | The app **keeps the published look** — it does not go blank or revert to grey. Editing neither repaints nor unbrands | ⬜ |
| 14.5 | Pick a deliberately terrible colour (pale yellow #FDE047) and publish | It publishes. Buttons are your yellow; link/text is a darker version of the same yellow; the confirmation lists the adjustment with before/after numbers | ⬜ |
| 14.6 | Check dark mode with that same brand | Also readable — a colour can pass on white and be invisible on black, and both are checked | ⬜ |
| 14.7 | Type a colour name like "cornflowerblue" instead of a hex | Refused. A silently-defaulted colour is a brand nobody chose | ⬜ |
| 14.8 | As a salesperson (not owner/GM), open the app | They **see** the brand but cannot change it | ⬜ |

| 14.9 | Upload a logo (PNG or SVG), publish, reload | Your logo appears. Upload a different one and it replaces it | ⬜ |
| 14.10 | Try to upload a logo bigger than 200 KB | Refused, and it tells you the limit rather than just failing | ⬜ |
| 14.11 | Try to use an SVG as the EMAIL logo | Refused — email programs cannot render SVG reliably, so it would look right here and be missing from every email you send | ⬜ |
| 14.12 | Give ONE rooftop its own colours and name, publish it | That rooftop shows its own brand; your other stores keep the group's. Publishing a rooftop's brand does not touch the group's | ⬜ |
| 14.13 | Sign out and look at the sign-in page | It is **not** branded — see D-041; I need your answer before it can be | ⬜ |

**One I need YOU to judge:** 14.5 is the whole philosophy of this feature in one
click. Try it and tell me whether "publish anyway and fix the text" feels right
for your business, or whether you want it to stop you.

**Still waiting on you:** D-036 (as-is vs safety), D-037 (insurance-type F&I
products), D-038 (freeze a funded deal's money?), D-039 (require scans before
filing?), D-040 (close the old add-a-colleague API door?).

## ROUND 15 — Store settings (the Merlin fix)

> A store is opened first and configured after. These three settings live on
> the store's EDIT page (open a store from its organization, scroll to "Store
> settings"). They were readable by the system since the paperwork feature but
> settable by nobody — so every store sat on the CAMS default.

| # | What to do | Expected | Status |
|---|---|---|---|
| 15.1 | Open a store → "Store settings" → set "Bill of sale system" to Merlin, save | Saved. Reopen the store — it still says Merlin | ⬜ |
| 15.2 | On a deal at that store, open Documents → the bill of sale | Its source now reads Merlin instead of CAMS — the setting reaches the paperwork | ⬜ |
| 15.3 | Set the e-sign platform (OneSpan or DocuSign), then clear it back to None | Both persist and prefill on reopen | ⬜ |
| 15.4 | Set the "Conflict window" to 30 | Refused before you can save — it must be 1 to 24 hours | ⬜ |
| 15.5 | Set it to 6, save; then book two deliveries ~5 hours apart | They flag as a conflict (within your 6-hour window) where 4 hours apart would not have | ⬜ |

## ROUND 16 — Your own brand, the editor (F-14)

> This is the screen the ROUND 14 branding round was waiting for. Open a store's
> organization → "Branding" (top-right). You set your group's name, colours and
> style, save a draft (nobody else sees it), then publish when you're ready.

| # | What to do | Expected | Status |
|---|---|---|---|
| 16.1 | Organization → "Branding": set the display name and a primary colour, Save draft | "Draft saved." Nothing on anyone else's screen changed | ⬜ |
| 16.2 | Type a colour that isn't a hex or oklch (e.g. "blue") | The field is flagged and Save is blocked until you fix it | ⬜ |
| 16.3 | Pick a deliberately pale colour (#FDE047), Save, then **Publish** | It publishes, and it tells you it darkened the text version to stay readable — with the before/after numbers (e.g. 1.3:1 → 4.5:1). Your colour is kept; only the text form of it is adjusted | ⬜ |
| 16.4 | After publishing, look at the app (sidebar, any screen) | The group's **name** is now yours in place of "1Dealer"; the corners and focus outlines follow your brand. (Full brand button/link colours are the next piece — the name, radius and focus ring land now) | ⬜ |
| 16.5 | Edit a colour again but do NOT publish | The live app keeps the published look — a draft never repaints the floor | ⬜ |
| 16.6 | As a salesperson (not owner/GM), look for Branding | The "Branding" button is not offered to them, and going to the address directly gives a plain "you can't change this" — the editor is owner/GM only. (They still SEE your published brand everywhere in the app.) | ⬜ |

**Honest scope note:** the editor and publishing are complete, and the name +
radius + focus-ring repaint live today. The full brand *fill* colours on buttons
and links need one more design-system change on our side (so a brand colour that
is perfect on a button but unreadable as a link is handled correctly in both
light and dark themes) — that is the next branding piece, deliberately held
until it can be done without breaking readability.

## ROUND 17 — Creating a dealer from the platform console (F-70)

> This is YOUR side of the product: the console at `/admin` where you create a
> dealer group, its stores and the invitation for its owner. It needs a
> platform super-admin account with two-factor turned on (see PROJECT.md
> "Bootstrap the first platform super admin", then Security → enable 2FA).
> In the local setup no email leaves the machine, so the console hands you the
> owner's link instead — that is expected.

| # | What to do | Expected | Status |
|---|---|---|---|
| 17.1 | `/admin` → Tenants → "New tenant". Type a display name (e.g. *Groupe Tremblay*) | The identifier fills itself in (`groupe-tremblay`); the province defaults to Québec, the language to French, the first store's time zone to Montréal | ⬜ |
| 17.2 | Fill the legal name, pick a plan, the owner's name and email; add a second store in Ontario | The second store's time zone switches to Toronto on its own; the store code suggests itself from the store name | ⬜ |
| 17.3 | Give both stores the same code, submit | Refused before anything is created — the second store's code is flagged and the summary links to it | ⬜ |
| 17.4 | Fix the code, submit | "Tenant … created." with the trial end date, an **invitation link** (no email is delivered locally) and a Copy button; "Open the tenant" leads to its page | ⬜ |
| 17.5 | On the tenant page | Status *Trial*, "Trial ends" in 14 days, "Owner invited" with the email and the link's expiry; the journal lists the organization, both stores and the invitation, each signed by you | ⬜ |
| 17.6 | Go back to "New tenant" and submit the SAME identifier again | Refused with "already provisioned" and a link that opens the existing tenant — nothing duplicated | ⬜ |
| 17.7 | On the tenant page → "Resend the owner invitation", correct the email address | A new link; the journal shows the old invitation revoked and the new one issued; "Owner invited" shows the corrected address | ⬜ |
| 17.8 | Open the link in a private window, sign up with the OWNER's address, accept | The owner lands in a working dealer: both stores exist, a lead can be created, the lost-reason list and the delivery checklist are already there | ⬜ |
| 17.9 | Back on the tenant page | Owners now lists the owner, members = 1, "Owner invited" is gone and "Resend" is no longer offered | ⬜ |
| 17.10 | As a Support or Billing staffer, look for "New tenant" | Not offered — creating dealers is the super admin's alone | ⬜ |

## ROUND 18 — Acting as a dealer's user, with the dealer watching (F-71)

> When a dealer calls support ("the board does not load for my GM"), a
> platform staffer can act as that user for up to an hour — read-only unless
> a super admin opens a full session. The dealer's owner is told the moment
> it starts, sees every session on their Security page, and every request is
> logged. Two browsers help here: one signed in as support, one as the owner.

| # | What to do | Expected | Status |
|---|---|---|---|
| 18.1 | As **support**: `/admin` → a tenant → "Session de soutien" → pick a salesperson, keep *Lecture seule*, type a 10-character reason | Refused in place: the counter says 20 characters minimum; nothing is opened | ⬜ |
| 18.2 | Type a real reason, open the session | You land in the dealer's app with a yellow banner: "Session de soutien — au nom de … — se termine à …", a *Lecture seule* chip and a *Terminer* button; the top-right name is still yours | ⬜ |
| 18.3 | Browse leads, contacts, the dashboard; then try to edit a lead or create one | Reads work; every change is refused, and the yellow banner adds "Session de soutien en lecture seule — modification refusée" | ⬜ |
| 18.4 | Go to `/admin` | A wall: the console is closed while you act as someone — only *Terminer* and "Ouvrir l'application du locataire" | ⬜ |
| 18.5 | As the **owner** (other browser): the bell and the inbox (log mailer) | A notification and an email say support opened a read-only session acting as that salesperson, with the reason | ⬜ |
| 18.6 | Owner → Sécurité du compte → "Accès du soutien" | The session is listed: who, acting as whom, mode, reason, start and end; marked *En cours* | ⬜ |
| 18.7 | As support: press *Terminer* on the banner | Back in the console on the session's page: ended manually, by you; the request trail lists everything you did (the refused edits included) | ⬜ |
| 18.8 | As a **super admin**: open a *Complet* session acting as the owner; create a lead | It works. The lead's history says "Création — {owner} · via une session de soutien"; the tenant journal in `/admin` says "{you} (soutien) au nom de {owner}" | ⬜ |
| 18.9 | Still in full mode: try to remove a colleague, invite someone, or change the organization's name | Refused, and the banner adds "Action non permise pendant une session de soutien"; the colleague is untouched | ⬜ |
| 18.10 | From another super-admin browser, suspend that dealer | The session ends at once (*Révoquée*, by the suspending admin); the first browser is plain support again | ⬜ |
| 18.11 | Open a session, then sign out without ending it | The register shows it *Révoquée* — a session never outlives the sign-in it was bound to | ⬜ |
| 18.12 | As **billing**, look for "Sessions de soutien" | Not offered — billing opens and manages no session | ⬜ |

## ROUND 19 — Stopping all outbound messaging, and telling every dealer why (F-72)

> Two things live on your side of the product this round. The **Interrupteurs**
> page is the 3am screen: two switches that stop outbound SMS and outbound
> AI messages for EVERY dealer at once. The **Annonces** page is how you tell
> them — a bar at the top of their app plus a notification in their bell.
> You need a platform super-admin account with two-factor on, and two
> browsers help: one in `/admin`, one signed in as a dealer's user. Locally
> no e-mail leaves the machine, and a switch takes up to five seconds to
> reach the other processes — both are expected.

| # | What to do | Expected | Status |
|---|---|---|---|
| 19.1 | `/admin` → **Interrupteurs** | Two switches, both *Envoi normal*: « Arrêt des SMS sortants » and « Arrêt des messages générés par l’IA ». Each says what keeps going — for the SMS one, "Les courriels (invitations, vérification de compte, avis de soutien) continuent." — and both say "Chaque processus obéit dans un délai maximal de 5 secondes." | ⬜ |
| 19.2 | On « Arrêt des SMS sortants » press *Arrêter l’envoi* and type a four-word reason of fewer than ten characters | Refused in place: the field is *Raison (10 caractères minimum)* and nothing is stopped | ⬜ |
| 19.3 | Type a real reason (e.g. *panne Twilio en cours*) and confirm | The switch reads *Envoi arrêté* with "Modifié par <your address> le <today>" and your reason; a red bar appears across the top of the console: "Envoi arrêté pour toute la plateforme : Arrêt des SMS sortants" | ⬜ |
| 19.4 | In the dealer's browser, open a lead and try to send an SMS | Refused, with the reason in plain words: "La plateforme a suspendu tous les SMS sortants". Nothing is queued and nothing is sent later | ⬜ |
| 19.5 | While the switch is still on, go to a tenant page in `/admin` and use "Resend the owner invitation" | The invitation still goes out (locally: the link comes back on screen). E-mail is covered by no switch — that is deliberate, so a locked-out operator can still get back in | ⬜ |
| 19.6 | Back on **Interrupteurs**, press *Reprendre l’envoi* and type a wrong name in the confirmation box | The box asks "Tapez sms_send_killswitch pour confirmer la reprise"; a wrong name is refused with "Le nom ne correspond pas." and sending stays stopped | ⬜ |
| 19.7 | Type `sms_send_killswitch` and confirm; wait about five seconds, then retry the dealer's SMS | The switch reads *Envoi normal*, the red console bar is gone, and the SMS goes. The reason you typed is no longer shown — it lives only in the audit trail | ⬜ |
| 19.8 | `/admin` → **Annonces** → *Nouvelle annonce*. Fill only *Titre (français)* and *Texte (français)*, gravité *Information*, destinataires *Tous les locataires*, press *Publier* | Refused before anything is published: "Les deux langues sont obligatoires avant publication (loi 96)." and "Il manque encore : …" naming the two English fields | ⬜ |
| 19.9 | Fill the English title and text, publish | The announcement is listed as *Active* with its window and an *Avis envoyés* count that fills in within a few seconds. In the dealer's browser: a grey strip near the top of the app, and a bell notification "Annonce : <your English or French title, matching that screen's language>" | ⬜ |
| 19.10 | In the dealer's browser press *Masquer* on that strip, then reload the page | The strip stays gone for that person only; the bell notification is still there. Another user in the same dealer still sees the strip | ⬜ |
| 19.11 | Publish a second announcement, gravité *Incident*, leaving *Lien vers l’état du service* empty | Refused — an incident must carry the status-page link. Add an `https://…` link and publish | ⬜ |
| 19.12 | Look at the dealer's browser again | A red bar at the top with *Incident*, the text, and *Voir l’état du service* opening your link in a new tab. There is no *Masquer*: "Une annonce de maintenance ou d’incident ne peut pas être masquée tant qu’elle est active." | ⬜ |
| 19.13 | In `/admin` open the incident → *Terminer maintenant* → confirm ("Elle disparaît immédiatement. Le texte est conservé et ne peut pas être modifié.") | It reads *Terminée*, the red bar is gone from the dealer's app on the next refresh, and nothing on the announcement can be edited or deleted — ever | ⬜ |
| 19.14 | Publish a *Nouveauté* to *Tous les locataires*, then put one dealer into *Past due* from its tenant page and look at that dealer's app | The "Nouveauté" is not shown to them: "Une nouveauté n’est pas montrée aux locataires en retard de paiement ou en lecture seule." An *Incident* would still be shown to the same dealer | ⬜ |
| 19.15 | As a **Support** staffer: *Nouvelle annonce* with gravité *Incident*; then as **Billing**, look for **Interrupteurs** | Support may publish *Information* and nothing heavier; billing is offered neither the switches nor the announcements | ⬜ |

## ROUND 20 — What a dealer used, and the queue of jobs that failed (F-73)

> Two new places this round. On any dealer's page there is now an
> **Utilisation** link: what that dealer actually used, for the month or the
> last 30/90 days, with a sentence under every number saying exactly what it
> counts. And **Files de travaux** in the console menu is the first screen in
> this product that shows work the system tried and failed to do — and lets you
> put a failed job back. Two of the steps below are marked ⚠ DECISION: on some
> queues, putting a job back **sends the customer the same text message a
> second time**, and you should watch that happen once before you sign off on
> it. You need a platform super-admin account with two-factor on, one dealer
> with real traffic, and a phone you can read.

| # | What to do | Expected | Status |
|---|---|---|---|
| 20.1 | `/admin` → **Tenants** → open a dealer with real activity → the **Utilisation** link at the right of the name row | The usage page, headed *Utilisation*, with the dealer's name and plan beside it. Two panels — *Taille du locataire* and *Activité de la période* — and a line above them naming the exact window: "Du <date/heure> au <date/heure>" | ⬜ |
| 20.2 | Read the number labelled **Personnes ayant modifié quelque chose** and the small print under it | "Personnes ayant un accès actif aujourd’hui qui ont modifié quelque chose durant la période. Lire n’écrit rien : ce nombre est un plancher, jamais le nombre d’utilisateurs actifs." Nowhere on this page does anything call itself active users, DAU, WAU or MAU | ⬜ |
| 20.3 | Compare **Personnes avec accès** and **Accès par point de vente** for a dealer with someone working at more than one rooftop | The two numbers are different, on purpose, and each says why: the first is distinct people, the second counts one row per point of vente ("la même personne présente à trois points de vente compte trois fois"). The SECOND number is the one the tenant page already shows as *Membres* — the same fact, never a second version of it | ⬜ |
| 20.4 | Scroll to **Compris dans le forfait** | Three items only — *Personnes avec accès*, *Segments SMS* and *Conversations avec l’assistant* — with two sentences above them: "Ce que le forfait comprend, rien de plus. Un dépassement n’est ni bloqué, ni mesuré, ni facturé automatiquement." and "Quantité pour toute l’organisation, pas par succursale." No bar is red, and there is no 80% or 100% marker anywhere | ⬜ |
| 20.5 | Change **Période** to *90 derniers jours* | Every figure changes and the window line changes with it. The *Compris dans le forfait* panel now shows only "Ce que le forfait comprend est mensuel : affiché pour le mois en cours seulement." — no allowance numbers at all, so a monthly figure can never sit beside a 90-day count | ⬜ |
| 20.6 | Look for minutes vocales, appels API, erreurs 429, or an error count on this page | None of them are there. They were cut by name because nothing in this product produces them; each has a written condition that would bring it back (D-074, O-39) | ⬜ |
| 20.7 | Open the same page for a brand-new dealer the assistant has never greeted | **Premier contact de l’IA (p95)** reads *Aucune mesure* — not "0 s" — and **Prospects dans l’échantillon** reads 0 beside it | ⬜ |
| 20.8 | `/admin` → **Files de travaux** in the left menu | Ten queues by name in plain French (*Envois différés*, *Tours de l’assistant*, *Premier contact*, *Séquences (tic horaire)*…), each with *État*, *En attente* and *Échecs*, under the note "Vue plateforme — ces files servent tous les locataires." | ⬜ |
| 20.9 | Stop the local Redis (`docker compose stop redis`), wait ~30 seconds, and look again | Every row reads *File injoignable* and the counts read **Inconnu**, never 0, with "La file n’a pas répondu. Les compteurs sont inconnus — ce n’est pas « aucun échec »." The page does not error out. Start Redis again (`docker compose start redis`) before continuing | ⬜ |
| 20.10 | Click **Envois différés** to open its failed jobs | A table of failed jobs showing the job id, the identifiers it carries, the *Motif de l’échec* and the first stack line — and two notes: "Identifiants seulement — jamais le contenu d’un message." and "La liste des échecs est vivante et plafonnée : la pagination est par position…". **Nowhere is the text of a customer's message shown**, and any phone number or e-mail inside a failure reason appears as `[phone redacted]` / `[email redacted]` | ⬜ |
| 20.11 | Go back and open **Séquences (tic horaire)** | There is no *Filtrer par organisation* box on this queue, and instead: "Cette file ne porte aucun identifiant d’organisation, alors le filtre par locataire n’est pas offert. Une page vide dirait « ce locataire n’a aucun échec », ce qui serait faux." Four of the ten queues behave this way | ⬜ |
| 20.12 ⚠ DECISION | Back on **Envois différés**, tick one failed job, press *Remettre en file*, type a real reason, and type a **wrong** name in the confirmation box | The dialog carries a red warning first: "Avertissement : remettre un travail de cette file en file peut envoyer un DEUXIÈME message texte au client. La référence du transporteur n’est inscrite qu’après sa réponse, alors un message déjà livré peut être envoyé une seconde fois — et rien sur ce chemin ne détecte le doublon." Below it, "Tapez « deferred-send » pour confirmer"; a wrong name is refused with "Le nom ne correspond pas." and nothing is requeued. **This confirmation is required for even one job — decide whether that is what you want** | ⬜ |
| 20.13 ⚠ DECISION | Type `deferred-send` exactly, confirm, then look at the customer's phone for that job | The customer receives the same text message **a second time**. That is the hazard the warning names, and it is the reason for the typed confirmation, the limit of twenty jobs per request and the permanent register row. **Decide whether support staff should be able to do this at all, or only with your approval** | ⬜ |
| 20.14 | Look at the result panel the dialog shows afterwards | *Résultat, travail par travail*: one line per job with *Remis en file*, *Travail introuvable*, *N’était pas en échec*, *Non tenté* or *Erreur*, and the note "Un travail « non tenté » n’a pas été touché : le délai de la demande a été atteint avant lui…". The job leaves the failed list | ⬜ |
| 20.15 | Open **Réattribution de prospects** (or *Extraction par l’IA*), tick a failed job and press *Remettre en file* | No confirmation box and no red warning — instead "Les travaux de cette file peuvent être repris sans qu’un client reçoive de message." A reason of ten characters is still required | ⬜ |
| 20.16 | Sign in as a **Billing** staffer and look at the console menu; then open a dealer's *Utilisation* page | **Files de travaux** is not offered at all, and the failed-jobs address is refused if typed directly. The usage page still opens — §11 gives usage to every platform role | ⬜ |
| 20.17 | As a super admin, start a support session on a dealer, and while it is live try the *Utilisation* page and **Files de travaux** | Neither loads: the API refuses both with 409 while a session is live, and each page shows « Impossible de charger les données. Réessayez. » End the session and both work again. A retry filed inside a support session would carry two identities for one act, so it is not allowed | ⬜ |
