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

## D-042 — Compliance gaps: #1 ANSWERED 2026-07-27, the rest still open (F-15)

The compliance engine is built and every rule in it comes from the plan. While
building it I found eight places where the plan does not actually settle a
question that changes behaviour. **Nothing is blocked today** — I made every one
of them FAIL CLOSED, meaning the system refuses to send rather than guess. But
each refusal is a message that will not go out, so these want answers before real
customers are on the other end.

In plain terms:

1. ~~**A lead who phones you or walks in.**~~ **You said yes — built.** Somebody
   who walks in or telephones and gives you their number has enquired, and that
   is now recorded as permission to reply for six months, in the same instant
   the lead is created.

   Two limits I set, because they are the difference between a lawful reply and
   a fine: it covers **conversation about their enquiry only** (they asked about
   a car; they did not ask to join a promotions list), and a **referral gets
   nothing** — that is a third party handing over somebody else's number, which
   is not that person asking you anything. It also does not permit an automated
   *call*; that still needs them to say yes explicitly.
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

**Where this stands now:** #1 is answered and built. **#2 and #3 are the ones
that still decide whether ordinary follow-up works** — which messages count as
marketing, and whether to send the "you're unsubscribed" confirmation the plan
both requires and forbids. The rest matter before the first automated phone
call, which is further out.

I have written each one up in full technical detail in the session log; the above
is the version that matters to you.

---

## D-083 — Rewrite this repository's history to remove the old roster's names? *(F-82a, raised 2026-09-04)*

**Where it stands.** F-82a took your twelve salespeople's real names — and the
pay plans beside them — out of the working tree: « Vendeur 01 » … « Vendeur 12 »
everywhere, the two legacy seed files deleted, and a guard
(`apps/api/src/real-name-leak.test.ts`) that fails the build if a name comes
back. What it did NOT do is touch the past: every commit before F-82a still
contains the names, on GitHub (`develop` and `main`) and in the `backup` bare
repository. Anyone with read access can still see them with `git log -p`.

**Two ways to go.**

1. **Leave history as it is** — the tree is clean, the guard holds, the
   repository is private. The names stay reachable to whoever has read access
   today and to whoever gets it later (a contractor, an acquirer's due
   diligence, a leaked token).
2. **Rewrite history** (`git filter-repo` with a replacements file that is never
   committed) and force-push `develop`, `main` and the `backup` remote. Every
   commit hash after the first affected one changes: every clone is re-cloned,
   every open branch rebased; the commit ids and CI run ids written in
   `docs/SESSION_LOG.md` keep naming the old hashes (that is history too, and
   stays as written). One person does it, once, on a quiet day; the old objects
   leave GitHub only after its garbage collection (support can expedite).

**What I need from you:** 1 or 2. If 2, say when — it should happen before
anyone outside your team is given read access, and it costs a half-day plus a
re-clone for everyone.

My recommendation: 2, before the first outside reader — the point of 0.3 was
that the names should not be in the repository, and « in the past commits » is
in the repository. Until then, 1 is the state we are in, and the tree is guarded.

---

## Already answered — no action needed

- SES over Resend for email (D-029). Built.
- Per-store configurable checklist items (D-020). Built — each store can switch its
  own items on and off, except the safety inspection.
- Larger batches before each test round (D-032). In effect.

---

## F-69 platform console — nine defaults implemented (2026-08-26)

| # | Decision | Default in place |
|---|---|---|
| O-1 | `trustDevice: true` on TOTP verification is refused with 422 for **every** account (the plugin cannot tell staff from tenants before the session exists). The web never sends it. | Refused. Alternative: a short `trustDeviceMaxAge` (affects tenants equally). |
| O-2 | `ADMIN_SESSION_MAX_AGE_HOURS` — how long a console session lives after its TOTP challenge | 12 |
| O-3 | Plan seed: `included_storage_gb` (10/50/200/∞) and the enterprise price (NULL = negotiated) are not in the spec's §5.1 table | Placeholders; the plan editor slice makes them data (ADR-024 amendment). |
| O-4 | `read_only` tenants **keep receiving intake leads** (only suspended/offboarding/purged answer 410) | Kept — the provider is not the tenant; losing the customer's message is worse. |
| O-5 | `read_only` **pauses** outbound automation (drips, assistant replies, first touch, deferred sends) | Paused (multi-tenancy.md §8). |
| O-6 | Suspension deletes **all** Better Auth sessions of the tenant's active members, including the ones they use in other organizations | Blunt version; multi-org staff sign in again. |
| O-7 | `offboarding → active` reversal offered (the spec has no way back) | Offered; slug confirmation + reason required. |
| O-8 | Same-origin `/admin/*` until the CloudFront host split (`admin.readyloans.app` — infra work, money) | Accepted. |
| O-9 | Bootstrap: the first super admin is granted by `cli.js platform-grant <email>` against `DB_ADMIN_URL`; the path closes once an active super admin exists. Recovery after a total lockout = owner SQL on `platform_staff`. | As stated. |

## F-70 tenant provisioning — seven defaults implemented (2026-08-27)

| # | Decision | Default in place |
|---|---|---|
| O-10 | Trial length **14 days with no automatic expiry**: the console shows the end date and "(ended)"; `trial → active/suspended` stay manual until the billing slice's worker acts on the clock. | 14 days, manual. |
| O-11 | The owner's invitation lives **7 days** (F-12's TTL); a slow onboarding is covered by the console's "Resend the owner invitation" rather than a longer owner-specific TTL. | 7 days + reissue. |
| O-12 | **No `prospect` status** until Stripe makes provisioning two-phase (D-071 1). | None. |
| O-13 | A **soft-deleted organization keeps its slug**: re-provisioning a churned dealer under the same slug answers 409 pointing at the deleted tenant. Slug reuse is a retention / slug-history policy for later. | Slug stays taken. |
| O-14 | The owner receives the generic bilingual "join a team" invitation email; a tenant-named owner email is a small follow-up. | Generic now. |
| O-15 | §4.4 catalogs without a table today are **deferred, not invented**; a reviewer reading §4.4 literally will call the slice incomplete. | Deferred (D-071 11); **lenders resolved 2026-09-02 by F-80 (D-081)** — fees, F&I products, message templates, notification rules, store thresholds and pipeline colours stay deferred. |
| O-16 | Lost-reason vocabulary: the repo's **ten** bilingual names (incl. "Merged duplicate") ship, not the spec's nine keys. | Repo list. |

## F-71 support sessions (impersonation) — eleven defaults implemented (2026-08-27)

| # | Decision | Default in place |
|---|---|---|
| O-17 | **Home-grown** session-bound impersonation, not the Better Auth `admin` plugin: the plugin's authority is a second role column, it mints a real session for the target and hands the staffer's own token to the browser, ships fifteen endpoints we must not expose, and carries none of §7's controls. | Home-grown. |
| O-18 | Owners get an **email AND an in-app notification** for EVERY session start, read-only included. | Both, always. |
| O-19 | Powers refused even in full mode: organization update/delete, invite / roles / revoke, intake keys, pay plans, document signing, safety sign-off, customer replies. Wider than the spec's four because those (PII decrypt, billing, export without DSAR) have no producer yet. | As listed; one constant. |
| O-20 | The tenant sees the **staffer's email** in its register. | Shown. |
| O-21 | Two staffers may impersonate the same person at once (each session audited on its own). | Allowed. |
| O-22 | A member of several dealer groups is impersonated in **one** of them; the others do not exist for the session (enforced by the database, not the screen). | Enforced. |
| O-23 | Every request in a session is logged with its address (query included) in an immutable, platform-only table, kept with the audit trail (≥ 24 months). | Logged. |
| O-24 | Owners can be impersonated **without consent** — notification, not consent (§7). | Allowed. |
| O-25 | No live rooms / presence for the impersonator (no lead-routing side effects); the tenant view refetches. | None. |
| O-26 | Full-mode writes fire the tenant's normal automations (outbound included), mitigated by the read-only default, super-only full mode, the blocked list and the trail. | Fire normally. |
| O-27 | Hard TTL **60 minutes, no refresh**; the console is closed while a session is live, except the End. | 60 min; closed. |

## F-72 announcements and kill switches — ten defaults implemented (2026-08-30)

| # | Decision | Default in place |
|---|---|---|
| O-28 | `webhook_delivery_pause` is **not declared**. The spec names three kill switches; this product has an outbound chokepoint for two. There is no outbound webhook deliverer to stop, and a switch that gates nothing is a promise the console cannot keep. | Two switches, not three. |
| O-29 | A flip reaches every process **within five seconds**, not instantly: each process keeps its own five-second snapshot and there is no broadcast, because Redis is optional in this deployment and a guarantee that silently is not one is worse than a number. The switches page prints the number. | 5-second TTL. |
| O-30 | If the switch row cannot be read or is missing, the switch counts as **ON** and the send is refused. A kill switch may fail in exactly one direction. | Fails closed. |
| O-31 | **Stopping** takes one click and a reason of ten characters or more; **resuming** also requires typing the switch's name back, because resuming releases a backlog onto real customers. The reason is cleared when sending resumes and survives only in the immutable audit register — there is no flip-history screen. | Confirm to resume. |
| O-32 | A super admin can flip a switch **while a support session is live** (the incident that starts the session is the incident that needs the switch); publishing an announcement during a session is still refused. | Two routes exempt. |
| O-33 | "Emits a Sentry event + Better Stack incident" becomes three things we actually have: an **immutable audit row**, a **WARN log line** with a stable name a log drain can alert on, and a **standing red bar in the console** naming every switch that is on. Neither service is wired into this codebase and this slice does not invent one. The audit register has no screen — the bar and the log line are what a person reads. | Audit row, WARN, banner. |
| O-34 | **Email is covered by no switch.** `mailer.send` has eight call sites and five are credential paths — sign-up verification (auth.ts:63), invitations (f12:83), owner provisioning (f70:124/:159), the support-access notice (f71:69) — that a locked-out operator needs during the very incident. Two more are the driver-company dispatch request (f11:257/:456), an operational notice to a third-party vendor. Only the customer ETA email (f11:683) is customer-facing, and it is the named next step. Each switch's own copy says e-mails keep going. | Email keeps sending. |
| O-35 | **Dismissibility is derived from severity**, never chosen: maintenance and incident notices cannot be hidden while they are up; information and "Nouveauté" can. Enforced by a database rule, not by the screen. | Derived, not supplied. |
| O-36 | A published announcement is **never edited and never deleted** — no drafts, no retraction. The only change possible is ending it now, which takes it off every screen and keeps the text. | Immutable, endable. |
| O-37 | The bell notification carries **both languages** and the reader's own screen picks; nothing in this product ever writes a person's language preference, so choosing one when the notice is written would ship French to every English rooftop. The banner is bilingual by the same rule. | Both titles; viewer picks. |

## F-73 usage, tenant snapshot and the job inspector — fourteen defaults implemented (2026-08-30)

| # | Decision | Default in place |
|---|---|---|
| O-38 | **No usage counter table.** Every usage figure is counted from the rows themselves each time the card is opened, not kept in a running total. A running total is a second version of the truth that drifts from the rows it counts, and the nightly job the spec budgets to correct that drift is not built — so the drift would be silent. It also depends on Redis, which is not configured on every machine, and a total reading zero because Redis was absent looks exactly like a dealer who did nothing. | Counted live. The un-cut condition is in the migration header: a rollup table lands only together with BOTH its hourly flush job and its nightly reconcile job. |
| O-39 | **Seven of the spec's usage numbers are cut by name**, each with the condition that would bring it back: `dau`/`wau`/`mau` (sign-in records are deleted on sign-out, so any historical figure is arithmetic on deleted rows), `ai_voice_minutes` (nothing dials, nothing answers, no call has a duration anywhere in this product), `api_calls_mtd` and `rate_limit_429s` (the limiter stores a level under an expiring key, never a count, and fails open), `intake_ack_p99_ms` (nothing times the intake acknowledgement). Also cut: the health card's error count (no error service is wired — same call as O-33) and per-tenant failed-job depth (four of the ten queues carry no tenant at all). | Cut, not faked. |
| O-40 | **"Personnes ayant modifié quelque chose" replaces daily/weekly/monthly active users, and is a floor.** It counts people with access today who changed something in the window. Reading writes no record, so a manager who watches the board all day counts as zero. Both captions say so; it is never labelled "active users". | A floor, named as one. |
| O-41 | **Four numbers ship under new names** because the spec's names claim more than the rows support: seats (distinct people, not membership rows), leads created (every lead row created — there is no way to tell webhook-ingested from hand-keyed), assistant conversations engaged, and document bytes (the only size column in the product is on deal documents; brand assets record no size, so it is not total storage). | Renamed, with a caption each. |
| O-42 | **Plan inclusions are shown for three of five, and only for the current month.** Seats, SMS segments and assistant conversations get a bar; AI minutes and storage GB do not, because neither has an honest numerator. The bars say « Compris dans le forfait » — never "limite", never "restant" — carry **no 80%/100% markers**, and going over is drawn in the ordinary colour. Nothing stops at an inclusion and nothing is billed past it, and the copy says that. For a 30-day or 90-day window the API returns no inclusion figures at all, so a monthly number can never sit beside a quarterly count. | Three bars, month only, no thresholds. |
| O-43 | **A plan's inclusions are read for the whole organization, not multiplied by the number of rooftops**, even though §5.1 prices per rooftop. The only column the spec annotates as per-rooftop is AI minutes, and that one is cut, so multiplying would invent a rule. The rooftop count rides beside the figure so it is never read without its context. | Per tenant. Owner call if it should be per rooftop. |
| O-44 | **Leads and deals created keep counting after they are deleted; document bytes stop.** Deleting a lead does not un-ingest it, and a usage figure that moves backwards months later is not a usage figure. A deleted document, by contrast, really does free storage. This cost two extra database indexes on two busy tables, deliberately. | Counted including deleted; storage excludes them. |
| O-45 | **Putting a failed job back on the queue can send a real customer a second text message**, on four of the ten queues (`deferred-send`, `assistant-turn`, `first-touch`, `drip-tick`). Those workers record the carrier's reference only after the carrier answers, so a carrier timeout leaves a message delivered and unmarked — one of the likeliest reasons the job failed in the first place — and re-running it sends the text again. Nothing on that path detects the duplicate. Controls: the queue name must be typed back for **any** retry on those queues (not just for several), at most twenty jobs per request, a reason of ten characters, and one permanent register row filed before anything is touched. | Allowed, with a typed confirmation and a warning that names the hazard. |
| O-46 | **A failed job shows identifiers only — never a customer's message.** Each queue publishes a short list of the payload fields the console may display, checked by a test that refuses any free-form field and refuses `body` by name. The failure reason is free text written by whatever crashed, so phone numbers and e-mail addresses are stripped out of it before it is shown, and it is truncated. | Identifiers only. |
| O-47 | **On the four queues whose jobs name no dealer, filtering by dealer is refused rather than answered.** An empty page would read as "this dealer has no failures", which on those queues is false by construction. The console does not offer the filter and the API refuses it. | Refused, with an explanation on screen. |
| O-48 | **The register records the request, not the result.** The row is written before Redis is touched, because the two cannot be committed together and an unrecorded retry is the failure the spec forbids; so it records the queue, the job ids asked for, the dealers those jobs name, and the reason. Nothing is recorded when no queue is configured, because nothing was attempted. There is no screen that reads this register — it is forensic, like the rest of the platform audit trail. | Over-records deliberately; no reader. |
| O-49 | **The tenant snapshot carries no "deployed version".** There is no build identifier, no image tag and no deploy pipeline in this product; the migration version is a database-wide number and putting it on one dealer's card would invite "this dealer is on…". F-72 cut Sentry rather than substitute a lookalike; the same call is made here. | Cut, no substitute. |
| O-50 | **All five F-73 screens are closed while a support session is live.** F-72 opened the kill switches during a session because an incident may need them in the same minute; reading a usage card and requeueing a job are not that, and a retry filed inside a support session would carry two identities for one act. | Refused during impersonation. |
| O-51 | **The tenant snapshot ships as an API only.** The database function, the contract entry and `GET /api/v1/admin/tenants/:id/snapshot` are built and tested, but no console page reads it yet, so a reviewer reading §9 will call the slice incomplete. The usage card and the job inspector both have screens. | Resolved 2026-08-31 — F-77 (D-078): `/admin/tenants/:id` → **Instantané**. |
| O-52 | **The 12-month gross trend is cut by name** (F-78, D-079). The dashboard shows this month only; a trend needs at least three months of delivered history to say anything, and a 12-row month list as its consumer. Un-cut: both exist. | Dashboard shows the current month. |
| O-53 | **« Overdue funding » ships as « Livrées, non financées »** — delivered deals not yet funded, oldest first, no threshold — because no submission timestamp exists in the schema; the spec's name claims a clock the rows cannot support. Un-cut: `funding_submitted_at` with its f05 producer AND its consumer in one slice. | The honest name shipped (F-78, D-079). |
| O-54 | **The incomplete-checklists attention table is cut by name** (F-78, D-079): checklist rows are materialized lazily at delivery time, so a SQL count today reads an unopened checklist as complete — the figure would lie. Un-cut: eager materialization, or a counted set-returning query with a measured plan. | Not shown rather than wrong. |
| O-55 | **A multi-timezone dealer group's dashboard month is its FIRST store's month**, and the caption names the timezone (F-78, D-079). Today every store is America/Montreal, measured. Un-cut: an organization-level clock producer, or an all-stores-agree rule. | First store's clock, captioned. |
| O-56 | **A salesperson's own-figures dashboard is deferred by name** (F-78, D-079): their home page shows the greeting, response speed and the recent-prospects list — a list is honest as a list — and zero figures; a personal report needs its own figure ledger gated on the person. Un-cut: that ledger. | No figures rather than a floor. |
| O-57 | **Attention rows name the customer as plain text** (F-78, D-079): the wire carries the deal's lead only, so no link to `/contacts/:id` is offered even where a contact exists. Un-cut: `contact_id` on the attention wire plus the link. | Plain text for now. |
| O-58 | **Add `@vitest/coverage-v8@3.2.7` as a devDependency of `packages/core`** — vitest's own coverage provider (repo vitest-dev/vitest, trusted-publisher release of 2026-07-06, exact-pinned to the vitest already in the lockfile; nine of its thirteen direct dependencies are absent from the lockfile and their own dependencies are too, so the transitive footprint is larger than nine — to be measured with a lockfile-only dry run before any install) — so the ≥ 90 % `packages/core` coverage gate that PROJECT.md, TASKS A-06, ARCHITECTURE.md, NFR-QUAL-002 and ADR-023 claim can exist in CI. Measured 2026-09-04 without it: ≈ 97.8 % lines / ≈ 95.7 % functions; branches ≈ 88–92 % and may need ~6 tests. Until you say yes the docs say the gate is pending (F-82a, D-083 (11)). | Not installed (CLAUDE.md ask-first on dependencies); `PROJECT.md:109` and `ARCHITECTURE.md:71` say « pending O-58 ». |

## Console e2e — decided 2026-08-31 (option A, D-075)

The `⚠ NEEDS YOUR DECISION` block that stood here since 2026-08-30 is
resolved by option A, the one it recommended: the suite got its own database
(`dealpilot_e2e_test`, rebuilt from migration zero on every run) and its own
first-staffer bootstrap, so the console's browser test now exists
(`apps/web/e2e/f74-console-door.e2e.ts`) and **your dev database's one-shot is
still unspent** — `platform_staff` there is empty, and nothing on the e2e path
can name that database. The full record, including the two alternatives
rejected with reasons, is `docs/DECISIONS.md` D-075; how to run the suite and
the one orphan database to drop yourself are in `docs/OWNER-ACTIONS.md`
(2026-08-31). The old block's spec count is retired with it: the phrase is
*every `*.e2e.ts` under `apps/web/e2e`*, and the suite is the count.
