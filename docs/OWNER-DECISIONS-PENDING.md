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

## Already answered — no action needed

- SES over Resend for email (D-029). Built.
- Per-store configurable checklist items (D-020). Built — each store can switch its
  own items on and off, except the safety inspection.
- Larger batches before each test round (D-032). In effect.
