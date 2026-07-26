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

## Already answered — no action needed

- SES over Resend for email (D-029). Built.
- Per-store configurable checklist items (D-020). Built — each store can switch its
  own items on and off, except the safety inspection.
- Larger batches before each test round (D-032). In effect.
