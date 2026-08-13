# Owner decisions pending — stacked for Hassan

Things only the owner can answer. Nothing here is blocking: each one has a
defensible default already implemented, noted below. When you answer, the answer
moves to `docs/DECISIONS.md` and the code follows.

---

## D-033 — ANSWERED 2026-07-26: full RBAC, not just the safety question

**You said:** "for this and for any control on actions in the system there should
be an RBAC controlling roles, and also for each role what it can do of actions,
and things in the system fully and 100% secured, and perfect and optimized."

**Understood, and agreed — but it is a real piece of work, so here is the honest
shape of it rather than a promise.**

**What exists today.** Every endpoint checks membership and, where it matters,
role. That is real security — nothing is open — but the rules live in ~30
separate route files as small role lists (`STORE_WRITE_ROLES`,
`MEMBER_WRITE_ROLES`, `DISPATCH_ROLES`, `PAY_READ_ROLES`). Nobody can answer
"what exactly can a BDC agent do?" without reading the code, and no screen can
show you the answer.

**What you are asking for (filed as A-13):**
1. One permission catalogue — every action in the system named once
   (`deal:create`, `deal:fund`, `commission:read_all`, `dispatch:book`, …).
2. A role → permission matrix, in the database, editable, seeded with sensible
   defaults for your ten roles.
3. Every route asks the catalogue instead of carrying its own list.
4. A screen where you see and change the matrix — and a per-user override for
   the "Marc can also do X" cases every dealership has.
5. A test that FAILS if any route checks a role without going through the
   catalogue, so it cannot drift back.

**My recommendation on sequencing.** Do this BEFORE the documents module, not
after. Every feature we add now hardcodes more role lists, so the migration gets
more expensive every day. It is roughly a day of backend plus a settings screen.

**One caution, honestly.** "100% secured" is not a state a system reaches and
holds — it is a practice. What I can commit to: deny-by-default everywhere, one
place that defines who can do what, a test that stops drift, and the audit trail
we now have so you can see who did what. That is a strong position. Anyone
promising you finished perfection is selling something.

---

## D-033-original — Who may sign off the safety inspection?

**Currently implemented:** owner and GM only. Rolls into A-13 above — it becomes
one row in the matrix instead of a hardcoded list.

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

## D-034 — ANSWERED 2026-07-26: frozen, with a corrections path — BUILT

**You said:** keep it frozen, and if editing, mandatory reason and a history
table.

**Built exactly that.** A delivered deal's checklist refuses edits as before. Add
a `correction_reason` and the edit goes through — owner/GM only — and the
correction is written to the activity trail marked `corrected_after_delivery`,
with your reason, forever. You did not need a new history table: F-10's activity
trail already is one, append-only, and no part of the application can edit or
delete a row in it.

Test row 2.10 in the master doc is marked 🔁 so you can try it.

---

## D-035 — How does an invited team member actually get to log in? *(F-04 gap, raised 2026-07-26)* — **the big one**

**The problem, plainly:** when you add "Marc Seller" on the Team screen today, Marc
appears in the roster as Active and can be assigned leads — but **Marc can never sign
in**. Nothing sends him anything, and if he signs up on his own with the same email he
gets a brand-new account that has no connection to the Marc in your roster. He would be
a stranger to your dealership.

This is not a bug I can just fix quietly, because every way of fixing it changes
something you can see. I found it while building F-09 and confirmed it today.

**Why it happens:** the roster row is created with an invented internal id. The real id
only exists once the person signs up, and the two never meet.

**Option A — Invitations replace the placeholder (my recommendation).**
Adding a member sends them an email with a single-use link that expires. They set a
password, and *that* is when the roster row becomes real. Until then the Team screen
shows them as "Invited".
*What changes for you:* you cannot assign leads to someone who has not accepted yet.
I think that is correct — assigning work to an account that cannot log in is what is
broken today — but it is a real change to how the Team screen behaves.
*Cost:* about a day. Needs a small screen from Hussein (the accept-invite page).

**Option B — Keep the roster row, attach the login to it later.**
The roster keeps working exactly as it does now, including assigning leads to someone
who has not accepted. When they eventually sign up with that email, their login is
attached to the existing row.
*What changes for you:* nothing visible.
*Cost:* similar, but it changes how every request identifies the logged-in user, which
is the most safety-critical code in the system. I would want to do it carefully rather
than overnight, and I would not want to do it without you knowing.

**What I need from you:** A or B. If you have no strong feeling, say "your call" and I
will build A.

**Until then:** the Team screen works for *you* and anyone who signs up themselves and
is then added. It does not yet work for inviting someone who has no account. I have
noted this on the owner test sheets so it does not look like a surprise failure.

---

## D-036 — Does an "as-is" sale skip the safety inspection? *(F-13, raised 2026-07-26)*

**Two rules we hold both contradict each other, and only you can choose.**

**Your instruction (D-033):** the safety inspection is a legal obligation and
nobody may waive it. That is what we built — no role can skip it.

**The plan's rule (documents.md §3, delivery.md §2.2):** a vehicle sold **as-is**
is exempt from the safety inspection, *because* the as-is waiver the customer
signs discloses exactly that. The paperwork replaces the inspection.

Both are defensible. In Quebec an as-is sale genuinely is a different legal
transaction, and forcing an inspection on a $2,000 wholesale unit you have
explicitly sold with no warranty may be the wrong rule. But "nobody can skip
safety" is a much easier rule to defend if anything ever goes wrong.

**Currently implemented:** your version. Marking a deal as-is adds the waiver
document to the file and changes **nothing** about the safety inspection.

**What I need from you:** should an as-is deal skip the safety inspection, or
not? If yes, I would want the as-is waiver to be *signed* before the exemption
applies — the disclosure is the entire justification, so the exemption should
depend on it rather than on a checkbox.

I found this because F-13's migration comment claimed the coupling existed. It
never did. That comment is corrected.

---

## D-037 — Do you sell insurance-type F&I products? (F-13b)

**Why I am asking.** F-13b gives F&I products their own rows, so a warranty, a
GAP policy and each aftermarket item now produce their own agreement in the
customer's file, named after the product. Every one of them is taxed with the
vehicle, because desking works out the tax base from the deal's single F&I
total.

Credit life and disability insurance are the exception in the real world —
they are insurance premiums, not goods, and they are not taxed the same way.

**What I did NOT build.** I left the per-product "taxable" switch out entirely
rather than putting one in that desking ignores. A box you can tick that
changes nothing would have quietly overcharged a customer tax and reported it
as correct.

**What I need from you:** does the group sell credit life, disability, or any
other insurance-type F&I product? If yes, I will make the tax base read the
products instead of the deal total, and the switch becomes real. If no, this
stays as it is and costs nothing.

---

## D-038 — Should a FUNDED deal's money be frozen the way a delivered checklist is?

**Why I am asking.** You answered the same question for the delivery checklist
(D-034): keep it frozen, and if someone must edit it, force a reason and keep
the history. Built.

The equivalent gap on the money side already existed before this batch: once a
deal is funded, its sale price, cost and F&I can still be edited, and the
commission written at funding is NOT rewritten. So the deal and the pay it
generated can drift apart. Every change is in the activity trail, so nothing is
hidden — but nothing stops it either.

**Where it stands:** the pay itself is safe — commission is worked out from the
sale price, the vehicle cost and the F&I reserve, and F-13b's product rows do
not touch any of those. What can drift is the deal's reported gross.

**What I need from you:** apply your D-034 answer to funded deals too — mandatory
reason, owner/GM only, recorded — or leave money editable after funding? I have
not assumed, because freezing it could block a legitimate correction the day
before month-end and that is your call, not mine.

---

## D-039 — Should a deal be blocked from filing until the signed pages are scanned in? (F-13c)

**What now exists.** A document can carry its actual page — PDF or photo — and
the system records the SHA-256 of those bytes. Every time the file is read back
the hash is recomputed, so an altered page is refused rather than served. That
is the difference between "someone ticked signed" and "the signed page is here
and unchanged".

Each deal now reports `wet_ink_verified`: true when every document needing a
signature has a stored page on record.

**What I did NOT do.** Nothing is blocked by it. I did not make scanning a
condition of filing a deal, because that is a workflow change for every store —
some scan at the desk as the customer signs, some batch it at month-end, and a
gate turned on without warning would stop deliveries on day one.

**What I need from you:** should a deal be blocked from `filed` until every
signature page is scanned in? If yes, I would suggest turning it on per store,
the way the checklist items work, so a store that batches its scanning can move
to it rather than be stopped by it.

---

## D-040 — ANSWERED BY EVIDENCE 2026-07-27: it was worse than described, and is fixed

**What I found.** There are two ways to put someone on your team. The invitation
flow — the one your screens use — works correctly: they get a link, they sign
up, and their account is tied to their membership.

The other one is an API endpoint left over from before invitations existed. It
marks somebody **active** on your team immediately, but their membership is not
tied to any sign-in account. They would log in and see an empty app while your
team list showed them as active.

**Your screens do not use it**, so you cannot hit this by clicking. It is a door
in the API that nothing walks through.

**What I found when I went to close it.** It was not merely a door to a broken
room — it was a room with no way out. Proven end to end:

1. Add somebody by email → the system says "added", and marks them active.
2. Invite that same person → **refused, "already a member"** — by the very
   membership that broke them.
3. They sign up → different identity → they see an empty application, forever.

There was no sequence of actions in the product that could rescue that person.

**Fixed, and nothing is waiting on you.** Adding a colleague now attaches to the
account they already have, so they see the organisation the moment they sign in.
If they have no account yet, it refuses and says to invite them — because "not
added yet" is a far better state than "added and locked out". The invitation
path no longer treats a broken membership as a colleague, so it can repair one.

**A limitation lifted on the way past:** the same person can now belong to two
dealership groups. That was previously refused; it turned out to be a side
effect of the same bug, not a rule.

**Your dev database has none of these**, which I checked before changing
anything — your screens use invitations, so you never walked through that door.

---

## D-041 — Should the sign-in page carry the dealership's branding?

**Where it stands.** Everything after sign-in can be branded. The sign-in page
itself cannot, because the server has no way to know which dealership a visitor
belongs to before they have signed in.

**Two ways to fix it.**

1. **A web address per dealership** — `groupehassan.dealpilot.app`, or their own
   domain. That is how the plan intends it, it is the better experience, and it
   is part of the custom-domain work that needs paid AWS. Nothing to decide now
   beyond "yes, later".
2. **A dealership name in the link** — `…/login?org=groupe-hassan`. Works today
   with no infrastructure. The cost: anyone who guesses a name can see that the
   dealership uses the system, and see their logo. Not a security hole, but it is
   information you would be publishing.

**What I need from you:** is option 2 acceptable as an interim, or would you
rather the sign-in page stay plain until the proper web addresses exist? I have
built neither, because publishing which dealerships are your clients is your
call.

My recommendation: leave it plain. The gain is one screen; the cost is a list of
your clients that anybody can probe.

---

## D-042 — Eight gaps in the compliance rules that only you can close (F-15)

The compliance engine is built and every rule in it comes from the plan. While
building it I found eight places where the plan does not actually settle a
question that changes behaviour. **Nothing is blocked today** — I made every one
of them FAIL CLOSED, meaning the system refuses to send rather than guess. But
each refusal is a message that will not go out, so these want answers before real
customers are on the other end.

In plain terms:

1. **A lead who phones you or walks in.** The plan only describes capturing
   consent from web forms. A walk-in has given you their number in person —
   should that count as permission to text them? Right now it does not, so those
   leads get no automated follow-up at all.
2. **Which messages count as marketing.** "Your car is ready" and "we have a sale
   this weekend" need different permissions. The plan defines this for drip
   campaigns only. Every other message type needs you to say which it is.
3. **The "you're unsubscribed" confirmation.** The plan says never message someone
   after they say stop, AND says to send them a confirmation that they have been
   unsubscribed. Those contradict. I currently do not send it.
4. **What a past customer's purchase permits.** A completed sale gives you
   permission for two years — but the plan does not say whether that includes
   phone calls or only texts and email.
5. **What "START" turns back on.** If somebody opts out and later texts START,
   are they back to everything, or only to conversation about their own deal?
6. **Call consent: once, or standing?** If a customer agrees to an automated call
   today, does that permission last, or is it for that one call?
7. **What counts as a sales call.** Different rules apply to a sales call than to
   "your car is ready for pickup". Nothing in the plan says how to tell them
   apart automatically.
8. **Unsubscribing by email.** The stop-word machinery is all text-message based;
   email has no equivalent path yet.

**My recommendation:** answer 1, 2 and 3 first — they are the ones that decide
whether ordinary, lawful follow-up can happen at all. The rest matter before the
first automated phone call, which is further out.

I have written each one up in full technical detail in the session log; the above
is the version that matters to you.

---

## Already answered — no action needed

- SES over Resend for email (D-029). Built.
- Per-store configurable checklist items (D-020). Built — each store can switch its
  own items on and off, except the safety inspection.
- Larger batches before each test round (D-032). In effect.
