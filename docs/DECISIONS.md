# DECISIONS.md — Decision Log (lightweight ADRs)

> Newest on top. Claude: add an entry whenever a choice is made that someone
> could later ask "why is it like this?" about — library picks, architecture,
> API shapes, tradeoffs, rejected alternatives. Never delete entries; if a
> decision is reversed, add a new entry that supersedes the old one and
> cross-link them.
>
> **Founding decision set:** the 26 canonical ADRs (ADR-001…ADR-026) in
> `../../kia-tracker-specs/docs/new/00-overview/ARCHITECTURE-DECISIONS.md` govern
> the whole build. Entries below either adopt them or record owner decisions on
> top of them; on conflict, a newer entry here supersedes.

## D-081 — 2026-09-02 — The lender registry, and the deal that names its lender

F-80 (lenders-billofsale.md §1.1–§1.2; FR-FIN-007 P1 — the registry half;
closes the O-15 lenders deferral; the module-parity pick of the 2026-09-02
scoping, f78_scope §4 — its « 0071 » corrected to 0073). Designed by the
three-planner + judge workflow — winner `seed-and-births` — hardened by four
adversarial critics into a binding build document of 15 rulings and 22
amendments, built in four waves (backend → i18n + web → journey → mutations
+ gate), reviewed through six adversarial lenses with refute-biased
verification (six lenses, 4 raw findings — 1 confirmed, 3 refuted, all six finders returned (three lenses came back empty after full sweeps); the one confirmed minor was the recorded name-collision blind-spot class caught by a live mutation: T-L2's PA014-arm pin matched the migration's own comment quoting the SQL, so deleting the real guard line stayed green — the comment now paraphrases and the pin asserts inside the definer's extracted body, proven red-then-green), and gated: `pnpm turbo run build typecheck lint` 25/25 tasks (18 cached); `RLS_REQUIRED=1 REDIS_URL=redis://localhost:6381 npx vitest run` → **198 files / 2178 tests, exit 0, no unhandled errors**; `node scripts/e2e.mjs` → **72 passed in 3.0 m against dealpilot_e2e_test rebuilt from migration zero incl. 0073 (the five lender tests 4.0–10.0 s each)**, lock released, nothing left listening. Base `04e4f8b`.

(1) **The combined cut IS the design.** The scoping measured that a registry
alone is a producer with no consumer, so the slice pairs everything: the
tenant-scoped `lenders` table (producer: 0073 + the seeds + the CRUD;
consumers: the registry page, the desking Select, the render sites);
`deals.lender_id` (producer: the desking save through the EXISTING deal
PATCH; consumers: the lender name on the pipeline card — `short_name ??
name` — and the lead-detail deal line, plus the deal diff so the activity
trail names the change); and `lender:manage` (catalogue +
owner/gm/fi_manager defaults + the 0073 backfill + `requirePermission` on
POST and PATCH — permission-drift-locked). §2's submission vocabulary
(statuses, rate_spread, expiry_date, selected, deal_submissions) is NOT
declared — that is the follow-on slice this one builds the FK target for.
Columns shipped are exactly what the product reads or edits: name,
short_name, category, the three rep-contact fields, notes, active. Cut by
name with un-cut conditions in (9): rate_sheet_url, avg_turnaround_days,
approval_criteria, store_id, any lender-side pricing (rates stay on the
deal — law), IN_HOUSE/CUSTOM categories.

(2) **One seed, three births, every guard with teeth.** The 18 rows (7
PRIME / 5 NEAR_PRIME / 5 SUBPRIME / 1 CAPTIVE) ship VERBATIM from the
legacy catalog `lenderData.js` — §1.2's own table is a compressed summary
of it (« RBC Royal Bank » shortened to « RBC », the short name glued into
the name) and would have shipped the summary as data; the two real notes
(« TD subprime program », « Kia Finance Company of Canada ») come along,
empty strings become NULL. ONE constant — `LENDER_DEFAULTS` in
packages/schemas, typed by the category enum (a deliberate deviation from
the core home of LOST_REASON_DEFAULTS: core has no schemas dependency and
would lose the typing) — feeds all three paths: the f01 signup birth
(`seedLenders` in the birth transaction), console provisioning (the 0066
`admin_provision_tenant` definer RESTATED in 0073 via CREATE OR REPLACE —
its body copied from the 0066 FILE and verified BYTE-VERBATIM minus exactly
two insertions by a programmatic line diff: the PA014 guard learns the
lenders key, and one plain INSERT from `p_seeds->'lenders'` lands after
lost_reasons; a plain INSERT so a duplicate-carrying payload aborts the
birth loudly, never ON CONFLICT DO NOTHING in the definer — the recorded
no-op class), and EXISTING organizations (the 0073 backfill, soft-deleted
orgs included — a restored org must not be lender-less). The frozen SQL
copy cannot drift ungated: a migration-text test pins every FULL
(name, short_name, category, notes) tuple, the three permission rows, the
PA014 arm and the jsonb INSERT into the 0073 file; and a disposable-DB test
on the 0070-rewrite harness creates two orgs PRE-0073, applies the real
directory, asserts rows-EQUAL against `LENDER_DEFAULTS` per org plus
7/5/5/1, and re-runs both file-extracted backfill statements to prove zero
change — the CI-executable proof the harness exists for (every other suite
resets from migration zero, where the backfill runs against an empty
table). The LEAD's dev spot-check at ship (`count(*) = orgs × 18`) is a
ship step, not the proof.

(3) **The FK cannot cross tenants even at the schema layer.**
`deals.lender_id` is nullable (an existing deal has no lender) with a
COMPOSITE FK `(organization_id, lender_id)` against `UNIQUE
(organization_id, id)` on lenders — probed directly: a mismatched pair
fails with 23503 on `deals_lender_fk` while the route surface answers 422.
`requireLenderInOrg` in f05 splits the refusals so the screen can say the
truth: unknown/rival → 422 `invalid_reference`; a NEW pick of a
deactivated lender → 422 `lender_inactive` (« réactivez-le au registre »);
and the GRANDFATHER clause — placed AFTER the f05 FOR-UPDATE read, a
commented deviation from its requireLead/requireVehicle siblings, because
it must read the deal's CURRENT lender — lets a re-save that keeps the same
inactive lender succeed: desking re-sends every field, and refusing an
untouched one would break saving old deals. History never loses its name:
deactivation keeps the FK, the render sites keep showing the name
(`include_inactive` list), the Select shows the current lender suffixed
« (inactif) » and hides it for new picks.

(4) **The registry's gates, measured against their precedents.** FORCED
org-keyed `lenders_isolation` in 0072's shape and NO member_read policy —
the judge measured the coupling the plans missed: 0055's member_read
exists only because `reasonOrg` reads the row under `withUser`; F-80's
id-addressed writes resolve the org via the clawbackOrg iteration
(memberships under withUser → iterate withTenant → 404), which needs no
extra policy, and the list GET runs withTenant + requireMember. Grants are
exactly SELECT/INSERT/UPDATE — no DELETE anywhere (grant-pinned):
deactivate is `PATCH {active:false}`, one door; a mistyped name is fixed by
rename. The duplicate-name 409 is the f53 sibling's in-route shape — catch
23505, 409 `duplicate_name` with path `name` — NOT a CONSTRAINT_PATHS
entry: that table serves constraints surfacing through the SHARED
conflictFrom plumbing, which f80 does not use, and only the two f80 routes
can trip this constraint (the seeds insert into a fresh org; the backfill
rides ON CONFLICT). The constraint itself is a PLAIN `UNIQUE
(organization_id, name)` — the case-insensitive expression index was cut as
an unforced deviation from the sibling vocabulary; « TD » vs « td » stays
creatable, visible in the registry, and recorded here rather than hidden.
The PATCH carries the f53 PATCHABLE sink guard (an unpatchable key is
refused before identifier position). `lender:manage` joins NEITHER the
impersonation block-list NOR permission-drift's dangerous floor-role pin:
the block-list's own classes are authority/credentials/pay/legal/
customer-reply and the pin's are money/authority/tenant-erasure — a lender
registry is tenant config, the store:update class, and diluting either
list weakens what membership means.

(5) **The screens.** The registry lives under /settings in the F-76
pattern (the sections guard's four hard pins extended additively; members
read, writes render only with the permission — the readOnly sentence, zero
write requests network-proven in the e2e); category groups carry the
LEGACY-VERBATIM labels in both locales — « Prime / Quasi-prime / Subprime /
Captif (OEM) », EN 'Captive (OEM)' (the plan's own fact sheet had the EN
label wrong; the ruling pinned the shipped strings since parity checks
keys, not values). The desking Select is grouped by category, never shows
a uuid and never silently clears: pending → disabled with only the
current/none option; list error → the current option renders '…' and a
save leaves lender_id unchanged; the org argument is the RESOLVED orgId
unconditionally (the useLeadNames multiOrg-ternary would never fetch for a
single-org user — every fresh org). The pipeline card renders « Prêteur :
{short_name ?? name} » beside the funding control; lead-detail the full
name; NULL renders nothing invented. `input-persistence` was conscripted
for the new FK: the deals fixture resolves the seeded « TD Auto Finance »
id through the product API and sends `lender_id`, so the POST INSERT
column has a named red.

(6) **What the gate itself caught.** The first full vitest run went red on
the ADR-018 brand-leak guard: three F-80 citation comments named the
banned legacy project name (in the seed constant's header and both
locales' comment lines) — a real defect none of the waves' targeted runs
executed, fixed surgically (the comments now cite « the legacy client
catalog » by path shape without the name) and re-proven green. Lesson
recorded: a citation is also a string, and the guards read comments.

(7) **The mutation loop's own honesty (18 rows, each red then restored
byte-identical).** Three manifest corrections the loop forced: the row
naming « T-L10 » named a test that does not exist — its real reds are the
T-L2 pin plus the f70 birth/parity assertions; the drop-the-UNIQUE row is
necessarily a two-edit coherent mutation (0073's own ON CONFLICT target
fails at apply otherwise); and the drop-the-isolation-policy row reds at
the suite's beforeAll (with no policy on a FORCED table the birth's own
seed INSERT is refused) alongside the rls-coverage isolation check — the
FORCED check stays green, exactly as ruled. The permission mutation drops
BOTH requirePermission calls (the F-79 precedent: leaving one keeps the
drift guard's enforced-somewhere scan green).

(8) **Rejected, with reasons:** shipping §1.2's compressed table as seed
data; a bare `REFERENCES lenders(id)` FK (violates the composite-FK law);
a member_read policy (nothing reads the row under withUser); the
case-insensitive unique (an unforced deviation the sibling lives without);
CONSTRAINT_PATHS for a constraint outside the shared plumbing; a DELETE
route or grant; z.coerce.boolean for include_inactive (the sibling
schema's own comment bans it — 'false' would read as true); double-brace
interpolation (house is {name}); a core home for the seed constant; the
LEAD-at-ship count as the ONLY backfill proof (the 0070 harness exists for
exactly this class); a lenders activity entity (the deal's own diff
already answers who put the lender on the deal; registry CRUD follows the
f53 config precedent).

(9) **Deferred with un-cut conditions, and the resolution.** rate_sheet_url
(un-cut: a screen that renders AND edits it); avg_turnaround_days (un-cut:
the submissions slice's expected-decision display); approval_criteria
(un-cut: FR-FIN-009 strategy guidance); store_id scoping (un-cut: a real
per-store lender-list consumer); lender-side pricing (never while
rates-stay-on-the-deal is law); IN_HOUSE (un-cut: an in-house financing
module) and CUSTOM (never — a localStorage artifact); ALL of §2's
submissions (the follow-on slice: statuses, platform, buy/sell rates,
rate_spread, expiry_date, selected, `lender.approved`); a hard DELETE
(un-cut: an owner asks, with a dedupe design preserving FKs); the
funding-SLA sweep (§3.4). O-15's lenders line is RESOLVED by this slice;
the rest of that row (fees, F&I products, message templates, notification
rules, store thresholds, pipeline colours) stays deferred and the row now
says so. SECURITY.md carries no entry — its header scopes the audit log to
/security-audit runs; the isolation story is carried by rls-coverage's
behavioural entry, the cross-tenant personas, the composite-FK probe and
this decision. The PA014 window (an old-code provisioning call 500s
between 0073 applying and the new code deploying) is accepted dev-only —
the LEAD ships migration and code together. Related: D-033 (the
catalogue), D-055-era seed patterns (0055/0057), D-071 (11) (the original
deferral), D-080 (the clawbackOrg shape and in-route 409 precedents);
migration `20260902000073_lender-registry.sql`.

## D-080 — 2026-09-02 — Commission clawbacks: the negative line the page has rendered since 0011 gets its producer

F-79 (commissions-clawbacks.md §8, §11 item 4; FR-COM-004 P1; the runner-up
of the 2026-09-02 scoping, f78_scope §2 — its « 0071 » corrected to 0072).
Designed by the three-planner + judge workflow — winner `lifecycle-and-gates`
— hardened by four adversarial critics into a binding build document of 18
rulings and 21 amendments, built in four waves (backend → i18n + web →
journey → mutations + gate), reviewed through six adversarial lenses with
refute-biased verification (six lenses, 10 raw findings — 6 confirmed, 6-into-4 fixes all claims-class minors, 4 refuted, all six finders returned; the sharpest: the confirm route's requirePermission had NO red test (deleting that one line survived the suite) — T-A3b now pins it, proven red first; plus the flag dialog's month promise rebound to confirmation time, the foreclosed two-paths race comment corrected, and the notification registry's actor claim made true), and gated: `pnpm turbo run build typecheck lint` 25/25 tasks (18 cached); `RLS_REQUIRED=1 REDIS_URL=redis://localhost:6381 npx vitest run` → **191 files / 2135 tests, exit 0, no unhandled errors**; `node scripts/e2e.mjs` → **67 passed in 2.9 m first try against dealpilot_e2e_test rebuilt from migration zero incl. 0072 (the clawback test ~14.8 s)**, lock released, nothing left listening. Base `9eede0a`.

(1) **The completion.** `commissions.kind` has allowed `'clawback'` since
migration 0011 with ZERO producers, while the commissions page rendered the
kind (« Reprise ») and `monthTotal` subtracted negative lines, test-pinned —
the repo's strongest consumer-with-no-producer. The confirm route is now the
producer. Five vocabulary items ship, each with BOTH ends in-slice and a
guard that reds if either end is deleted: the `commission_clawbacks` table
(0072), `commission:clawback` (catalogue + owner/gm/fi_manager defaults +
the 0072 backfill à la 0057 + `requirePermission` in flag AND confirm —
permission-drift-locked, and added to its dangerous floor-role pin),
`notif_commission_clawback` (title-keys lockstep + the bell render test),
the `commission_clawback` activity entity (the f10 guard), and the
flagged/reversed status pair (badges, the duplicate-flag 409, the terminal
422). NOT declared: an un-flag status, an auto-suggest status, the §11.4
webhook (no webhook infrastructure exists), a reason taxonomy, any new
ActivityAction.

(2) **The two decisions, ruled with measurements.** (a) The live UNIQUE
`(deal_id, user_id, kind)` stands: ONE clawback per commission line,
terminal. It is the same constraint `writeCommissionsForFundedDeal` leans on
for funding idempotency (the ON CONFLICT arbiter), and a partial-index
replacement cannot arbitrate the bare conflict target — relaxing means
editing the repo's most money-critical INSERT to buy a capability no spec
sentence requires (§11.4 asks only `reversed ≤ original`; one partial
satisfies it). The un-cut condition is recorded: a new migration with the
partial index PLUS the f09 arbiter retarget PLUS re-proving never-pays-twice,
together. The same-person sale+override edge (two lines, one (deal, user)
slot for `'clawback'`) maps to 422 `clawback_cap_reached` — and its accepted
consequence is recorded plainly: the second clawback row stays « flagged »
forever (no un-flag exists until the deferred slice); the money stays safe
under the UNIQUE. (b) The negative line lands in the OPEN pay period:
`funded_at` = the confirm transaction's `confirmed_at`, ONE
`new Date().toISOString()` stamp used for both, byte-equality pinned. The
funded_at consumer census that makes this safe: `monthTotal` buckets by line
`funded_at` (the owner sees THIS month drop — the point), the commission
tier input reads `deals.funded_at` (pay math untouched), and F-78's
dashboard reads `delivered_at` on the store clock (D-079 (4)'s two-clock
residue restated, not changed). The shipped 0011:65 comment — « always the
deal's funded_at » — was a stale claim; it is restated truthfully for all
three kinds by 0072's `COMMENT ON COLUMN` (0011 itself is never edited), and
the month-M/M+1 test pins that a closed month's sum is byte-unchanged after
a confirmation in M+1, with the sums computed FROM `GET /api/v1/commissions`
items — admin SQL touches only the two clock backdates.

(3) **The transaction shapes.** Flag: `requirePermission` → the commission
read (404 across tenants as the APP role) → the 422 refusal map (over-amount
by path; a $0 or negative line — reachable: a loss deal writes a real
`amount_cents = 0` sale line, proven by a positive fixture; a clawback
line's own id) → a terminal check as `SELECT status … FOR UPDATE` over ALL
the commission's clawback rows — closing the zombie-flag race a critic
constructed (a flag racing a confirm blocks on the confirm's row lock and
re-reads « reversed » → 422 `clawback_terminal`), while a « flagged » row
falls THROUGH to the INSERT so the partial unique index
`commission_clawbacks_one_flagged` stays the ONLY duplicate gate (no
pre-SELECT — the index-drop mutation reds the 409 test) → plain INSERT,
23505 → 409 with path `commission_id` via the CONSTRAINT_PATHS entry.
Confirm, one `withTenant` transaction: the clawback row `FOR UPDATE`; 422
`already_reversed` on a re-confirm (idempotent-or-422 resolves to 422 — a
double-click learns it did not write twice); the commission + store read
with `num()` at the numeric boundary; ONE stamp; the core `buildClawbackLine`
(golden-tested — the negative line copies the original's user, deal, gross
and rate and carries `amount = −reversed` from the STORED row, never a
client value); a PLAIN INSERT — `ON CONFLICT DO NOTHING` is banned here
because a status flip with no line is the repo's recorded no-op-feature
class — with the commissions-UNIQUE 23505 caught BY CONSTRAINT NAME and
mapped to 422 `clawback_cap_reached`, rolling the WHOLE transaction back so
status and line are inseparable; the status flip; `notify()` and
`recordEvent` in the same transaction. List: `requireMember` with the
f09:365-372 pay-privacy clamp mirrored through the mandatory FK join — a
salesperson sees only their own rows unless `commission:read_all`.

(4) **The gates.** FORCED org-keyed RLS in 0013's shape with NO bare
user-keyed policy; grants on the new table exactly SELECT/INSERT/UPDATE and
no DELETE (the status flip is the one UPDATE a workflow table needs — the
0072 comment pre-answers the append-only reviewer; `commissions` itself
stays SELECT/INSERT only, and the grant-shape test pins both). Behavioural
cross-tenant coverage registered in rls-coverage (the entry-drop mutation
reds the guard). `commission:clawback` is also in
`IMPERSONATION_BLOCKED_PERMISSIONS` — confirming a clawback writes a money
line against someone's pay, squarely that list's « move pay » class, so a
platform support session can neither flag nor confirm — pinned by test.
Activity events carry STATUS ONLY, no amounts, and the f10 pay filter is
deliberately NOT extended: an event without money is not pay data, and
amounts-plus-filtering would reopen the door 0013 closed. The pay-visibility
asymmetry is stated, not hidden: a manager holding `commission:clawback`
without `commission:read_all` reads a line's original amount through the
clawback row, and GM recipients are role-selected, so the matrix cannot
fully narrow the bell — the task-sweep precedent.

(5) **The notification.** Params carry ONE locale-free number
(`amount: cents / 100`) — bell.tsx's own comment says every producer's
params are locale-free, and storing display-formatted money would falsify it
— rendered by an ICU `{amount, number, ::currency/CAD}` key in both locales,
pinned by a render test (fr « Reprise de commission confirmée : 500,00 $. »,
en « Commission clawback confirmed: $500.00. » — measured, with the
narrowSymbol≡symbol equivalence noted so a future locale change cannot
silently split the bell's format from the page's). Recipients: the earner
ALWAYS at high urgency; the store's GMs at medium with an owner fallback for
a no-GM store; the confirming actor is excluded from the MANAGER set only —
the earner is never excluded. The fallback is proven POSITIVELY (a second,
non-acting owner receives) beside the actor-exclusion proof, per the
test-that-asserts-absence law.

(6) **The screen.** The clawback column's branches are EXHAUSTIVE: a
clawback-kind row → « — »; flagged → badge + the confirm action only with
the permission; reversed → badge with sr-only terminal text; no clawback and
(no permission OR `amount_cents ≤ 0`) → « — »; else the flag action —
nothing disabled-but-visible, and no request fires that a 403 would answer
(the list GET answers 200 self-filtered for every role, so the earner's own
badge and bell work). The flag dialog parses money with `parseMoneyToCents`
— a critic proved `parseFloat("1 375,50") === 1` and `parseFloat("500,50")
=== 500`, a silent FR-money corruption that would have PASSED the server's
range check — with the round-trip vectors pinned in a parse test. The
confirm dialog restates the stored amount and says the reversal lands in the
pay period « EN COURS » and « Cette action est définitive. » — both claims
the code makes true.

(7) **What the build's own loop caught.** The first red run: `recordEvent`
23514'd because the activity entity-type CHECKs did not know
`commission_clawback` — 0072 also DROP+re-ADDs both CHECKs with the live
lists (the 0067 precedent); a build-order gap, recorded. The f10
dead-vocabulary guard was BLIND to the drop-recordEvent mutation: `notify()`
also carries an `entityType:` key, so the bare regex counted it as a
producer — exactly the name-collision blind-spot class the repo's memory
records — and the guard was STRENGTHENED (notify() call spans stripped
before the scan; green on the unmutated tree, red under the mutation).
The ON-CONFLICT-DO-NOTHING mutation SURVIVED the planned suite — the
manifest's named red was false because no tested path reached the
commissions UNIQUE — so T-A5b now drives the same-person sale+override edge
entirely through the API (a self-override pay plan; first confirm 200;
second confirm 422 `clawback_cap_reached`; the row stays flagged; exactly
one negative line) and is the mutation's true red. The fr-only key-drop
variant of the parity mutation dies at the mirror-shape typecheck and can
never reach dist — the both-locales drop is what proves the title-keys
lockstep and the render test. And the new activity entity conscripted the
web ENTITY_KEYS label lockstep (one line + two locale labels) — a
typecheck-enforced consumer the wave reports record.

(8) **Rejected, with reasons:** a new f79 routes file (three module-private
f09 helpers would be exported or duplicated; f09's header already names this
spec as its subject); pre-formatted `amount_fr`/`amount_en` params (falsify
bell.tsx's locale-free contract; the F-72 dual-title precedent is for
human-authored text) and a parameterless bell (the amount IS the story — no
existing notif key is parameterless); a permission-gated list (blinds the
earner to a reversal of their own pay, or fires a 403-answered request);
relaxing the UNIQUE ((2)); `ON CONFLICT DO NOTHING` on confirm ((3)); role
names in routes (D-033); a SECURITY.md audit entry (that log's own header
scopes entries to /security-audit runs; the isolation story is carried by
the conscripted guards and this decision); a `flagged_at` column
(`created_at` IS the flag moment — commented); a `store_id` column (read
from deals at notify time); extending the long f09 e2e journey (a NEW
self-contained test in the same file, own fixtures, measured ~14.8 s against
the 90 s ceiling).

(9) **Deferred with un-cut conditions, and the stale claims fixed.**
Un-flag/cancelled status (un-cut: the first real mis-flag that cannot stay
unconfirmed — also the release valve for the recorded stuck-flag edge);
auto-suggest on lost-after-commission / funding regression (manual-first —
nothing reacts to those transitions today; un-cut: a producer in the f02/f05
transactions plus a UI that acts on it, one slice); the
`commission.clawback_confirmed` webhook (§11.4/ADR-005 — no webhook infra;
the event name would be dead on arrival); a reason taxonomy (free text until
a reporting consumer exists); a second partial reversal per line (un-cut =
the (2)(a) surgery, done together); §11.5 period statements; the legacy
`store_id` list filter (no product consumer — the page maps by
commission_id). Fixed stale claims: the f09 header's « RLS self-read
policies in migration 0011 » (dropped by 0013 — pay privacy is
route-enforced, and the header now says so, plus « Writing a plan needs
pay_plan:write. »); 0011:65's funded_at story ((2)(b)). Cosmetic, recorded:
the new fr notif key uses a plain space before « : » where a neighbour uses
NBSP — flagged, not silently normalized. Related: D-033 (the catalogue),
D-074/D-079 (the caption and clock laws this page inherits), D-077 (the
guards-find-bugs discipline the loop re-confirmed); migration
`20260902000072_commission-clawbacks.sql`.

## D-079 — 2026-09-02 — The dashboard's numbers become true: a measured GM report replaces the floor-as-total tiles

F-78 (reports-analytics.md §14.1; FR-REP-003 P1 — genuinely missing at the
tip — and FR-REP-007; the recommended slice of the 2026-09-02 scoping,
f78_scope §1). Designed by the three-planner + judge workflow — winner
`honest-figures`, the claims-ledger plan — hardened by four adversarial
critics into a binding build document of 9 rulings and 28 amendments, built
in four waves with disjoint ownership (backend → i18n + web → journey →
mutations + gate), reviewed through six adversarial lenses with refute-biased
verification (six lenses, 10 raw findings — 5 confirmed, 5 refuted; one verifier died mid-run and the review was RESUMED from its journal to 16/16 rather than trusted partial; the major: the money tiles scrolled a 360 px viewport sideways (a fr-CA amount is an unbreakable NBSP token wider than a two-column tile) — fixed with a one-column grid below sm and pinned by a red-first 360 px overflow probe in the e2e; every confirmed finding fixed and proven red-then-green where a test could carry it), and gated: `pnpm turbo run build typecheck lint` 25/25 tasks (19 cached); `RLS_REQUIRED=1 REDIS_URL=redis://localhost:6381 npx vitest run` → **188 files / 2103 tests, exit 0, no unhandled errors**; `node scripts/e2e.mjs` → **66 passed twice consecutively (2.7 m / 2.8 m) against dealpilot_e2e_test rebuilt from migration zero incl. 0071 — after one investigated infra red: a vite dev-server dynamic-import fetch failure took down f09's desking page once under 4-worker load (an error-boundary snapshot proves it; not a product defect; f09 and the seven f78 blocks green in every other run)**, lock released, nothing left listening. Base `73a9084`.

(1) **The violation this slice removes.** The dashboard's four stat tiles
were computed over the FIRST PAGE of leads (`leads/api.ts:19` `limit: 100` →
`computeLeadStats` → the « Prospects (total) » StatTile) — a page floor shown
as a total on the owner's most-clicked surface, the same claim-in-the-product
class F-75 was ranked first for fixing in branding. The four tiles,
`computeLeadStats` and their five i18n keys (including `statsTitle`, whose
consumers died with them) are DELETED for every role — never sat beside the
real numbers, because two disagreeing totals on one screen are worse than one
floor. The `limit: 100` itself stays: it is correct for a LIST page; the sin
was totalling it, and the totaller died, not the list.

(2) **The report.** `GET /api/v1/reports/gm-dashboard` — one tenant route
(`ADMIN_HANDLER_COUNT` stays 28) in the F-55 discipline: SQL under
`withTenant`, `requirePermission('report:view')`, F-55's membership
store-scope block verbatim (a store-bound manager reports on their store
only), the honest-classification block in the route header, ~12 plain
statements on the one connection (each with its own full WHERE on its own
existing index — EXPLAIN per subquery showed no seq scan anywhere the header
claims one, and the whole report measured 16.5 ms on the largest seeded org),
`400 organization_required` with the page resolving the org unconditionally
(`items[0]?.id`) so a single-org owner is never 400'd by his own landing
page. The gate is the EXISTING `report:view` — its own catalogue comment
(« aggregate business analytics … manager authority by default ») describes
this report exactly, F-66's leaderboard already serves `sum(total_gross_cents)`
under it, and FR-REP-007's exclusions (salesperson, admin office, BDC) hold
under the default matrix. That `sales_manager` and `fi_manager` therefore see
the report is a recorded deliberate deviation from FR-REP-003's « gm/owner »
phrasing: the catalogue is the law (D-033), and a role check outside it is
the pattern permission-drift exists to ban. Mutation: dropping the
`requirePermission` line reddens the salesperson-403 persona
(f78-gm-dashboard.test.ts:392).

(3) **Every figure is a claim with a caption, and a positive case.** Each
figure ships as source columns → SQL → wire field → French label → caption
(what is counted, on which clock and window — interpolated from the wire's
month block, never hardcoded) → empty state → a hand-computed NON-ZERO test
(the repo's law: a metric proven only by 0-on-empty is structurally dead).
Open pipeline counts `pipeline_stage NOT IN ('delivered','complete','lost')`
— terminal stages would accumulate forever and dominate the bars, and the
caption says « Les livrées, complétées et perdues ne comptent pas. » Units
and gross count deliveries since the month start; the averages are per
delivered unit; the funding queue is captioned as a QUEUE, not a month figure
(« peu importe le mois »), and excludes lost deals — the caption says so, and
the lost-while-submitted mutation case pins it. Conversion is the SERVER's
own one-decimal quotient (`pct1dp`, exported from f55 beside `WON` so the
dashboard and the win-loss report can never disagree — two `export` keywords,
no file hoist), rendered through `Intl.NumberFormat` percent with fraction
digits pinned to 1; the render mutation (client-side `100*c/t` recompute)
reds the 33,3 % case. Nullable rates and averages render « — », never a
fabricated 0. Money sums are `int` WITHOUT `.nonnegative()` — a losing
month's gross is legally negative and must parse as an honest figure.
Attention lists cap at 10 rows with the TRUE total on the wire
(`count(*) OVER ()`). Salesperson rows keep a revoked member as
`{ name: null }` rendered as « Ancien vendeur » — the row's units are real —
with the invariant Σ rows + unattributed = the month's units. NO metric
reads `activity_events`: an audit log as a metric source makes a deleted or
edited event a silent metric change, and an INSERT-born deal records no
stage event at all — the mutation that rewires rotting to the events table
reds exactly that case. « Activité récente » is therefore deferred by name
with the line that settles it: activity read as a LIST is honest (rows claim
only their own existence); as a METRIC it is banned.

(4) **The clock, ruled and returned.** « This month » is computed on the
STORE clock per the tree's one tenant-report precedent (f67's resolution,
verbatim: the requested store's timezone, else the org's first in-scope
store by `created_at`; f67's `'America/Toronto'` no-store fallback kept and
stated in the route header — an org with no store holds no deals, but
central-queue leads can exist, so the fallback is named, not hidden). The
window rides the wire as `month { timezone, start }` — D-074's rule that no
figure travels without its period — and every month caption interpolates
`{start}` and `{tz}`; dates are formatted component-side with
`Intl.DateTimeFormat(locale, { timeZone: month.timezone })`, so a Vancouver
browser reading a Montreal month sees the month the SQL counted. Month
predicates are `>= start` ONLY — no upper bound, because `delivered_at`
cannot exceed `now()` outside time travel and a literal half-open bound
would make the boundary fixture future-dated for the first hour of each
month (a ~1 h/month flake at retries 0). Proven: the Montreal ±1 h boundary
fixtures (computed independently via `Intl` parts — they red-line a UTC
`date_trunc`), the assertion that `month.timezone` equals the STORE ROW's
value (never a literal), and a Vancouver-store case that red-lines a
hardcoded Montreal (stores created sequentially — f67's first-store pick has
no tiebreak). The honest residue, stated plainly: F-09's commission months
are UTC `date_trunc` over `funded_at`; this page's months are the store
clock over `delivered_at`. Two clocks, two keys, recorded here — not
smuggled; changing the pay month is money behaviour a dashboard slice must
not touch. A multi-store org spanning timezones gets the first store's month,
captioned (O-55). Today the point is moot in production data: 701/701 dev
stores carry America/Montreal, measured live.

(5) **Migration 0071 — `deals.stage_entered_at`, one concern, honest at both
ends.** `ADD COLUMN` nullable → `ALTER TABLE deals DISABLE TRIGGER
deals_updated_at` → `UPDATE SET stage_entered_at = updated_at` → `ENABLE
TRIGGER` → `SET DEFAULT now()` → `SET NOT NULL`. The trigger wrap is
load-bearing and was a critic's catch: the naive backfill fires the
`BEFORE UPDATE` `set_updated_at()` trigger and silently rewrites every
existing deal's `updated_at` to migration time (and
`session_replication_role` was rejected — it also disables FK triggers).
The backfill is the O-40 floor pattern: `updated_at` is at-or-after the true
stage entry, so age-in-stage UNDERSTATES — a pre-0071 deal can be missed by
« rotting > 7 days » but never falsely accused; the migration COMMENT and
the table's caption both say so (« Pour les transactions antérieures à
septembre 2026, l'ancienneté est un plancher »). A NULL backfill was
rejected: equally honest, but it empties the slice's strongest table for
weeks and wires a permanent `rotting_unmeasured` field for a decaying
cohort; floors under-alert, never over-alert. Producer: a 3-line guarded
stamp in the ONLY `pipeline_stage` writer (the f05 PATCH, beside the
`funded_at`/`delivered_at` stamps), firing only when the stage actually
changes — a same-stage PATCH does not re-stamp (mutation-proven), and the
INSERT path is the DEFAULT. Consumer: the rotting table and its caption, in
this slice. No index ships: EXPLAIN showed the existing indexes carry every
subquery; the un-cut condition (a seq scan on a > 50k-deal org → a partial
index in a NEW migration) is written in the 0071 comment and the route
header. The `Deal` wire schema is NOT widened — the report is the consumer,
and an unrendered field would be speculative vocabulary.

(6) **« Livrées, non financées » — the honest name for "overdue funding".**
The spec's name claims a submission clock the schema does not have (no
`funding_submitted_at` anywhere — grepped); the state a dealership actually
chases is delivered-and-not-paid, and both its columns have live producers.
Predicate: `pipeline_stage IN ('delivered','complete') AND funding_status <>
'funded'` — STATE-based, because `delivered_at` is stamped once and never
cleared, so a date-based predicate would list a deal regressed out of
delivered (or moved to lost) forever; aged from `COALESCE(delivered_at,
created_at)` (the F-66 convention), oldest first, NO invented threshold —
§14.1's only numeric constant is « rotting > 7 days in stage », and a 3-day
or 7-day funding threshold would be an invented fact on the very page that
exists to kill invented facts. Every delivered-unfunded deal is money not
yet collected; the table lists them all (capped at 10, true count printed).
The submission-age variant is cut by name (O-53). The rotting-then-PATCHed
cross-proof pins producer and consumer against each other: moving a rotting
deal's stage removes it from the table.

(7) **The page.** « Chiffres du mois »: ten captioned tiles — ONE column on
the smallest screens (the review measured a fr-CA money string as an
unbreakable NBSP-joined token wider than a two-column tile at 360 px; the
page scrolled sideways until the grid went `grid-cols-1 sm:grid-cols-2
lg:grid-cols-4`, and a 360 px e2e probe now pins `overflow ≤ 1 px` with a
money figure on screen, proven red first; truncating an amount was ruled out
— a clipped figure is a false figure) — then « À surveiller » — the two attention
tables FIRST (they are the "do something now" surface), then
« Répartitions »: chartless O-42 bars (open pipeline by stage, the same
open set by funding status, stock aging 0–30/31–60/60+) with fills as
`aria-hidden` decoration and every number in a text node — share-of-max has
no semantic maximum, so `role="progressbar"` was cut; then sources and
sales-by-salesperson. The F-55 SpeedPanel stays verbatim. The page title is
« Ma journée » while the permissions probe is pending and « Chiffres du
mois » once it resolves with `report:view` — the brief flicker is a ruled
behaviour (a title claims no figure), not drift. A salesperson's dashboard
keeps the greeting, the SpeedPanel, the links and the recent-leads LIST — a
list is honest as a list — with ZERO figures and ZERO report requests: the
report component never mounts without the permission, which the e2e proves
with `page.on('response')` recording no `/reports/gm-dashboard` request
across the persona's whole session. Perceived speed, stated honestly: the
report fetch is serialized behind the orgs and permissions probes — two
round trips precede it — not « +1 cached probe ».

(8) **Rejected, with reasons:** a new `report:gm_dashboard` verb (a second
spelling of the same authority, plus catalogue/matrix/backfill/drift cost
for zero FR gain); deriving rotting or overdue from `activity_events`
(banned — (3)); a NOT-NULL-DEFAULT-now() backfill (claims every old deal
entered its stage at migration time); the NULL backfill ((5)); invented
thresholds ((6)); a fixed `America/Montreal` constant and hardcoded
« heure de Montréal » captions (stale the day one rooftop changes its clock
— F-76 made the timezone tenant-producible, and a produced value the report
ignores is the dead-vocabulary sin in reverse); a `< now()` upper bound on
the month ((4)); a chart dependency (O-42's chartless bars); an
`analytics-classification.ts` file hoist (two `export` keywords instead);
all-stages pipeline bars; a bare `LEFT JOIN users` for salesperson names
(f66's membership-scoped resolution is mandatory — its review comment
records the cross-org-stranger bug the bare join caused); per-store month
windows summed (one figure with data-dependent meaning); keeping reduced
tiles for salespeople (the floor restated one role down); an access-denied
banner on the non-holder's landing page (absence is not an apology).

(9) **Deferred with un-cut conditions (O-52…O-57), and what the gate
surfaced.** O-52 the 12-month gross trend (un-cut: ≥ 3 months of delivered
history and a 12-row month list consumer); O-53 overdue-since-submission
(un-cut: `funding_submitted_at` with its f05 producer and consumer in one
slice); O-54 the incomplete-checklists attention table (un-cut: eager
materialization or a counted set-returning query with a measured plan —
`ensureDealItems` materializes lazily, so a SQL count today reads unopened
checklists as complete); O-55 the multi-timezone org clock (un-cut: an
org-level clock producer or an all-stores-agree rule); O-56 a salesperson
own-figures dashboard (un-cut: a personal ledger gated on the person); O-57
attention rows render the customer as plain text (un-cut: `contact_id` on
the attention wire and a contact link). Also deferred by name: « Livraisons
aujourd'hui » (producer live — `booked_delivery_at`; rider-sized), the
activity list ((3)), a store picker (the API already takes `store_id`), the
three cut §14.1 charts. The full-suite gate surfaced two pre-existing spec
races OUTSIDE this slice, investigated to root cause and left for their
owners, never re-run as unexamined flakiness: `f75-brand-paint`'s
request-storm bound (≤ 3) is timing-marginal under 4-worker contention (the
StrictMode-replayed prefetch races settled-error vs in-flight; isolation is
deterministic at 3; the one 4 was still mount-bounded — nothing like the
1215-request storm the bound guards), and `f76-automations` has a real
populate-clobber race proven from the surviving e2e database and the API
log (the form's GET resolving between two fills clobbers the first; the
spec's later assertions mask it because the pre-populate default passes
instantly). One surgical fix inside the gate:
`migration-0070-rewrite.test.ts` pinned « 0070 is the newest migration » and
reds the moment ANY later migration exists — generalized to exact equality
against [0070, …every later migration] computed from the real directory
(0070-applied and nothing-re-runs still exactly asserted; not one of the
named guards). Related: D-033 (the catalogue is the law), D-074 (the caption
law and the returned window), D-077 (the store clock became
tenant-producible), D-078 (the parse-pin discipline the hook test reuses);
migration `20260902000071_stage-entered-at.sql`.

## D-078 — 2026-08-31 — The snapshot page cannot show a credential by construction, and the console journey visits every read it can

F-77 (admin-console.md §9 and §11; O-51; D-074 (7)'s « API only » follow-up;
f75_scope §3, the third slice of the 2026-08-31 scoping). Designed by the
three-planner + judge workflow — winner `secret-safety` — hardened by four
adversarial critics into a binding build document of 21 rulings and 28
amendments, built in four waves with disjoint file ownership (foundations →
page → guards ∥ journey → mutations + gate), reviewed through six adversarial
lenses with refute-biased verification (six lenses, 21 raw findings — 15 confirmed, 6 refuted, all six finders returned; the fifteen deduplicate to nine fixes, two of them product defects the design had ruled in and every test had passed — the « — » store cell that conflated a live organization-level key with a deleted store, and a caption claiming a duplicate does not move « Dernier prospect accepté » — every one fixed and proven red-then-green where a test could carry it), and gated: `pnpm turbo run build typecheck lint` 25/25 tasks (21 cached); `RLS_REQUIRED=1 REDIS_URL=redis://localhost:6381 npx vitest run` → **186 files / 2082 tests, exit 0, no unhandled errors**; `node scripts/e2e.mjs` → **59 passed in 2.2 m against dealpilot_e2e_test rebuilt from migration zero (T1 8.6 s, T6 5.5 s, T7 6.0 s under 4 workers)**, lock released, nothing left listening.
Base `590bedd`.

(1) **Zero new vocabulary.** No API route (`ADMIN_HANDLER_COUNT` stays 28 and
`platform-drift.test.ts` is untouched), no column, no contract or schema
change, no permission or role check, no nav slot; 0070 stays the newest
migration. What was added: one web route
(`/admin/tenants/:tenantId/snapshot`, a sibling of the usage page, lazy like
it), one query key (`adminKeys.snapshot(id) = ['admin','tenant',id,'snapshot']`
— `invalidateTenant()`'s prefix matches it on purpose, so a status or plan
change refetches the spread copy) with one hook that PARSES
`AdminTenantSnapshot` (never a cast) and never polls, one `snapshot` i18n
namespace of exactly 29 keys in both locales, two label tables
(`BRANDING_STATE_KEYS`, typed against `BrandingStatus.options` so a fourth
state is a compile error; `PROVIDER_KEYS` hoisted from the intake page into
`features/organizations/labels.ts` and re-exported beside `STATUS_KEYS` /
`TIER_KEYS` — one map, no page-module import), and `snapshot-fields.ts`, the
allow-list the guards consume. Every column heading the page shares with a
tenant screen is the tenant screen's own string — `settings:col_store /
col_timezone / col_sms / col_hours / hoursSet / hoursUnset / defaultsNotice /
windowStart / windowEnd / firstTouchExempt / dailyCap / sec_automations`,
`intake:title / label / provider / provider_*`, `admin:storesTitle / colStatus
/ never / yes / no / back / entity_tenant_branding / storeStatus_*`,
`usage:metric_seats_provisioned / caption_seats_provisioned`, `orgs:hoursHint`
— so the words the owner checked in ROUND 23.1 are the words ROUND 24.2
quotes, and a rename on the tenant page renames the console's column.

(2) **The page cannot show a credential — five barriers, each with the
mutation that reddens it.** (a) A recursive zod-v4 walk over
`AdminTenantSnapshot` (72 dotted paths at the tree; the test demands ≥ 40)
asserts that no path segment matches `SECRET_NAME =
/token|secret|password|passphrase|hmac|signing|api[_-]?key|credential|private/i`
and that `SnapshotIntakeKey` has exactly the seven names the wire pins
(`active, id, label, last_lead_accepted_at, provider, revoked_at, store_id`);
`SECRET_NAME` is proven non-vacuous on `token / secret / signing_key /
api-key / webhook_secret / apiKey` and silent on `label / stripe_customer_id /
privacy_officer_name / store_id / last_lead_accepted_at` — the regex has no
word boundaries because `_` is a word character and `\bsecret\b` would miss
`webhook_secret`. Mutation m2 (`token: z.string()` added to
`SnapshotIntakeKey`) reddens (a) and — through its own
`AdminTenantSnapshot.parse` at `f73-snapshot.test.ts:126` — the API tests at
:432 and :456; the raw-wire pin at :423-425 stays green because a schema edit
does not change the definer's projection. (b) The schema strip, and the hook pinned to it: a valid body
carrying `intake_keys[0].token` (22 base64url), `.secret` (64 hex) and a
top-level `webhook_secret` parses to an object in which neither key survives
and whose JSON contains neither value (m2 reddens it: the token now survives);
and because the review showed that a cast in `useAdminTenantSnapshot` left
every test green — the strip case calls the schema directly — the guard now
reads the hook's source, comments stripped, and pins its `queryFn` to
`return AdminTenantSnapshot.parse(res.body)` with no `res.body as` (the cast
is red).
(c) A comment-stripped source scan over `tenant-snapshot-page.tsx` and
`snapshot-fields.ts`: no `Object.entries/keys/values/assign(`, no
`JSON.stringify(`, no `dangerouslySetInnerHTML`, no `for (const|let|var … in`,
no data object spread into JSX, no bracket access on the data bindings
(`d`, `row.original`, `snapshot.data` — label-table lookups such as
`STORE_STATUS_KEYS[…]` stay legal and are asserted present), and an identifier
walk in which no identifier matches `SECRET_NAME` or `webhook_url` /
`api_key`; sanity: `const d = snapshot.data` and `.last_lead_accepted_at`
are present, and at runtime `INTAKE_KEY_COLUMNS ⊆ Object.keys(SnapshotIntakeKey.shape)`
and `STORE_HEALTH_COLUMNS ⊆ Object.keys(SnapshotStoreHealth.shape)`. (d) The
top-level classification: `SNAPSHOT_TOP_LEVEL.rendered` (12 keys) ∪
`detailPage` (19) is exactly `Object.keys(AdminTenantSnapshot.shape)` (31),
disjoint; every rendered key is read as `d.<key>` in the page (including
`d.id`, which appears only in the header link's href) and no detail-page key
is read there at all — inverted from the plan's version, which would have
asserted that the tenant detail page reads every detail key and been red on
day one for `store_count`. Mutation m3 (drop `connectors_active` from
`rendered`) reddens it; so does deleting the header chips (`d.plan_code`
unread). (e) Render-time proof over the real page and the real bundles under
`strictIcu`: a POISONED body (the hook mocked, so the strip is bypassed on
purpose) puts none of `token` / `secret` / `webhook_url` into the markup and
the markup matches no `[0-9a-f]{32}`; a Proxy access recorder wrapped around
the honest AND the poisoned body proves that every property read on
`intake_keys[*]` is in `INTAKE_KEY_COLUMNS ∪ {id}`, on `store_health[*]` in
`STORE_HEALTH_COLUMNS ∪ {id, traffic_30d}`, on `traffic_30d` in
`SnapshotTraffic`'s keys, and that `token / secret / webhook_url /
webhook_secret` are never read — the one barrier no syntax evades, since a
destructure, a spread and `Object.entries` all invoke `[[Get]]`; the recorder's
skip list is the design's starting list and was never widened. Mutations:
m1 (hook cast + `Object.values(row.original)` in a cell) reddens (c), the
poison case, the no-UUID case and the poisoned recorder; `{(row.original as
any).secret}` reddens (c)'s identifier walk, the poison case and both recorder
cases; m11 (drop `provider` from `INTAKE_KEY_COLUMNS` while the page still
reads it) reddens the recorder while `tsc` stays green — the case that gives
the column tables a consumer. **What the browser proves, stated exactly:** T6
step 7 reads `#main`'s innerText and `page.content()` and asserts the key's
label is present while the REAL token and secret minted in T1 are absent from
both, and that the innerText carries no 32-hex run. Under m1 T6 stays green:
the definer never projects a credential (0069:473-479), so a page that dumps
every wire field prints the seven names and two dashed UUIDs (longest hex run
12). T6 is therefore the browser-side witness of the WIRE — of the definer and
the schema — and the page-side barrier is (c) + the render cases; the design's
« with the guard skipped, T6 is red at both the exact value and the regex »
was false at the tree and is recorded here as measured. The 32-hex regex is
not vacuous for the same four reasons the design gave: T1 asserts the minted
secret IS 64 hex and the token IS 22 base64url before any negative, T6 first
proves the page lists that key, the exact values sit beside the regex, and
the regex runs over innerText only (HTML carries hashes and data URIs).

(3) **The honest states, in words, and where each string is produced.**
The two tables stand in page flow under their headings, as every
other DataTable in the product does (the component paints its own card; the
review measured the design's card-in-a-card at 360 px narrowing the scroll
region to 292 px against the 326 px the same table gets on Réglages →
Succursales); the four other sections are cards. Label lookups over the
wire's `z.string()` fields use `Object.hasOwn` — `in` is true for
`constructor` and `toString`, and a poisoned value would have rendered blank
or thrown where the page promises « raw » (the unknown-word render case now
includes `constructor`). Rooftops: name with the code beneath, the status
word from `STORE_STATUS_KEYS` (raw when the `z.string()` carries something
new), the IANA name verbatim,
the E.164 number or the bare literal « — » (no `aria-label` on a `<td>`, no
sr-only sibling — the settings page's own convention), « Définies » /
« Non définies », one traffic cell « {inbound} entrants · {outbound} sortants
· {delivered} livrés » (zeros render as words, never blank; the 30-day window
lives in the heading as the definer's comment requires, 0069:404-408), and
« Aucun message en 30 jours » for a null last message — never « Jamais »,
which would claim more than a 30-day window knows. Under the table:
`orgs:hoursHint` verbatim (the store form's own sentence about what the
assistant does with and without hours — D-077 (2)'s fact has one string) and
one console-only sentence « Définies par le locataire sous Réglages →
Succursales. »; the 0069 caption idea (« not settable from the console »,
:459-462) is not rendered because F-76 made it false. Intake keys: label,
provider word, the STORE NAME joined client-side from the same body — with
two honest states the review forced apart: a key whose `store_id` is null is
an ORGANIZATION-LEVEL key (migration 0050:61 dropped the NOT NULL: « an
org-level key is the dealer group's ad-platform front door »; the POST route
accepts it, `intake_resolve` serves it as live, leads land in the central
queue), rendered with the settings pages' own word « Organisation »
(`settings:orgScope`); a key whose store was soft-deleted renders « — »
(`store_health` keeps `deleted_at IS NULL` rows, :472, while `intake_keys` is
projected unfiltered, :489). The design had ruled both as « — » on the
premise that the column was NOT NULL (0005:14) — false since 0050 — and a
support person would have read a working front-door key and a dead orphan
as the same dash. Then the
state in the definer's own order — `revoked_at` first (« Révoquée le {date} »,
because 0005 keeps `active` and `revoked_at` independent and a revoked key
with `active = true` must not read as live, :477-479), then « Active », then
« Inactive » — and « Jamais » for a key that never accepted a lead. « Inactive »
is a type-completeness fallback and says so in the page comment: the only
writer of `active = false` is the revoke UPDATE, which sets `revoked_at` in
the same statement (f03-intake-routes.ts:158-159), so the row has no producer
today; the word exists so a schema-legal row never renders blank or as a raw
boolean (un-cut condition in (9)). Caption: the token and the secret are
never shown in the console; « Dernier prospect accepté » moves only when a
lead is accepted — a refused signature (401, before the transaction) or a
suspended tenant (410) does not move it. The design's sentence also said
« ou un doublon »; the review proved it false at runtime: the intake path
has no duplicate rejection — a verbatim re-POST is accepted (202), becomes a
lead the product itself flags as a certain duplicate, and
`f03-intake-routes.ts:542` stamps `last_used_at` unconditionally inside the
same transaction, so the stamp MOVES. F-73's comment claim (0069:473-476,
f73-snapshot.test.ts:485-486, D-074) was only ever exercised with a bad
signature; F-77 was the first place the « duplicate » half became
user-facing text, and it shipped without it. Comms: with no organization
row, exactly `settings:defaultsNotice` — the same sentence the tenant reads on
Réglages → Automatisations (ROUND 23.7), because a second wording of the
platform defaults is the drift D-074 forbids and the numbers are core's
constants, which the console — the platform — may state; with a row, the
four values under the settings page's labels; ALWAYS, last, « {count, plural,
=0 {Aucune dérogation par succursale} … } » — `store_overrides` is computed
independently of the org row (:427-430), a count of 0 is a fact, no route
writes a store-level row (f73-snapshot.test.ts:340-344 pins 0), and the line
is what would qualify the defaults sentence the day one exists. Branding:
« Aucune image de marque » / « Modifications non publiées » / « Publiée » —
not « Modifiée, non publiée », which reads as « nothing is live » while the
definer's `draft` means unpublished EDITS with the previous version possibly
still up (:440-441); « Version {n} » and « Publiée le {date} » in their own
elements, « Jamais publiée » for a draft never published, and the caption says
what draft means. Access: `seats_provisioned` under the usage page's own
metric label WITH its caption (a usage number without its caption is what
`USAGE_METRIC_KEYS` exists to prevent — D-074), and « {count, plural, =0
{Aucun connecteur actif} … } » with a caption that names what counts
(registered AND active; f73-snapshot.test.ts:400-404). Platform, last and
`border-dashed`: « Plateforme — identique pour tous les locataires », the
three transports RAW in monospace (the wire types them `z.string()`; a label
map over env.ts's enums would be vocabulary the API does not publish and
would fall back to raw the day a transport is added) and a caption with the
two meanings a support person needs — « log » means no real send, « off »
means the assistant does not run — and the sentence that none of it is
changeable from the console. Every exact-text string renders in its own
element, so Playwright's `exact: true` is a claim the render test already
holds (`>Aucun connecteur actif<`, `>Aucune image de marque<`). No UUID
reaches a text node (asserted with tags stripped; printing `row.original
.store_id` reddens it) — ids are React keys and join keys only, which is also
what keeps the 32-hex scan free of false positives.

(4) **The header comes from the snapshot's own spread half.**
`AdminTenantSnapshot` extends `AdminTenantDetail` precisely so the snapshot IS
the detail plus more (D-074 (7)); the page renders `name` (a link to the
tenant page), the plan word (`TIER_KEYS`), the status chip (`STATUS_CLASSES` /
`STATUS_KEYS`, as the tenant page paints them) and « Supprimé » from the body
and calls no second hook — a `useAdminTenant` here would fetch
`admin_get_tenant` a third time per open (the snapshot route itself calls
`readAdminTenant` first, f73-usage-routes.ts:195) and give the page two
producers of the same name. The h1 is the bare word « Instantané », as the
usage page's is « Utilisation »; `BackLink` points at `/admin/tenants` because
its words (`admin:back`, « Retour aux locataires ») name the directory — a
link whose text names one page and targets another is a false claim, and
zero vocabulary forbade a new « Retour au locataire » key (the usage page's
pre-existing mismatch is in (9)).

(5) **A sibling route, not a section; no nav slot.** Measured before the
ruling: a section on the tenant page costs a second `admin_get_tenant` per
open, a half-error page under the 409, a six-mock render test and a 32-hex
scan over the journal's payloads; the contract's own words for the snapshot
are « open in a second tab » (v1.ts:1272-1276) and a second tab needs a URL.
Blast radius of the sibling: one router line after the usage child, one link
beside « Utilisation » (both inside a `ms-auto flex flex-wrap items-center
gap-4` wrapper, 44 px tall), one key. The link and the h1 and the tab title
share `snapshot.title` — D-077 (4)'s rule that a link reuses its target's
own title key, so a renamed page renames its link; no `admin.navSnapshot`.
`nav.ts` and `nav.test.ts` are untouched; T3's six-item and T5's one-item
menus stay true, and T6 proves the page is reached without a nav slot by the
most restricted role.

(6) **O-50 unchanged — the wall through the probe, and the 30 s residual.**
`RequirePlatform` wraps the whole `/admin` subtree and paints
`ImpersonationWall` from the probe (require-platform.tsx:65); a staffer with a
live support session never mounts the page. The residual: a session started
in ANOTHER tab within the probe's `staleTime: 30_000` (queryClient.ts:12-13)
renders `admin:loadError` on this page exactly as it does on the usage and
queues pages (ROUND 20.17 describes that cached-probe case and is not
edited), and the wall lands on the next probe — focus after 30 s, or a reload
(ROUND 24.8 walks the reload). The same tab paints the wall immediately
because `useStartImpersonation` invalidates `adminKeys.me` on success and on
its own 409 (api.ts:303, :308). Rejected: a per-page re-probe on this one page
(console-coverage §2.5) — it would leave the usage and queues pages
inconsistent without a decision to retrofit them; the parity retrofit is a
follow-up in (9), not scope.

(7) **The journey: one file, tenant-side producers, the floor role reads the
page, and the coverage arithmetic.** `f74-console-door.e2e.ts` is extended,
not joined by a second spec: `bootstrap-guard.test.ts` (byte-identical, still
green) requires exactly one importer of `bootstrapSuperAdmin`, and A's TOTP
secret exists only in that module after T3 — handing it across files through
a temp file would recreate the arbitrary-order hazard D-075 (3) forbids. Two
corrections to f75_scope §3 measured by the planners: the F-74 org has NO
store and NO key (T1 created only the organization), so every timezone /
« — » / no-32-hex assertion would have been vacuous without producers; and the
scoping's « twelve remaining routes » needed a source and a reconciliation:
the number is D-075's « twelve other `/admin/*` routes » (the F-74 header's
own bullet listed eleven names and no count), and it is a correct count, not
prose — router.tsx's `/admin` block had 13 named children + index + `*`;
F-74 opened index, tenants and staff; 11 named + `*` = twelve remained. T1 therefore grows, tenant-side and before the `/admin`
refusals: it waits for the org URL (the f03 race note), creates « Succursale
F74 » (`F74-nnnn`, `getByLabel('Code', { exact: true })`; no timezone typed
— the create form's default `America/Montreal`; no number → null), opens
"Sources d'admission" (straight apostrophe — `intake:title` as shipped),
creates « Formulaire F74 », reads the one-time reveal's two `<code>` elements,
and asserts the secret IS `^[0-9a-f]{64}$` and the token IS
`^[A-Za-z0-9_-]{22}$` (f03-intake-routes.ts:50-55) BEFORE any negative — a
changed shape fails loudly instead of turning absence into a tautology. These
are tenant-side producers, not console writes; the one console write is still
T4's grant. T5 now keeps B's TOTP secret (`secretB = await enrolTotp(page)`;
the return was discarded before). T6 logs in as B — the billing role, §11's
floor — and reads the directory by URL (`/admin/tenants?q=<slug>`, immune to
the remount D-077 fixed), the tenant detail (h1 = the org name), the usage
page (h1 « Utilisation », h2 « Taille du locataire »), then « Instantané »:
tab title `/^Instantané — /`, region-scoped rows (« Succursales » exact,
"Sources d'admission" exact — the key table also names the store), the
em-dash cell found by its own text (`/^—$/`, never a column index), « Non
définies », « 0 entrants · 0 sortants · 0 livrés », « Aucun message en 30
jours », « Webhook JSON générique » / « Active » / « Jamais » / the store
name, « Aucune configuration enregistrée », « Aucune image de marque »,
« Aucun connecteur actif », « Plateforme — identique pour tous les
locataires » with « Transport SMS » — and the credential block of (2). T7
logs in as A and opens every read-only console page the F-74 header left
unopened: `/admin/support-sessions` (« Sessions de soutien », « Aucune
session. »), `/admin/announcements` (« Annonces », « Aucune annonce. »),
`/admin/platform-settings` (« Interrupteurs de la plateforme », both switch
headings, « Envoi normal » exactly twice — the per-switch chip and the
post-flip notice are its two producers, platform-settings-page.tsx:89 and
:75, so a count of two also proves no switch was flipped in the run; both are
seeded off by 0068:81 and no other spec names the page), `/admin/queues`
(« Files de travaux », the platform-view sentence, « Joignable » on the
« Envois différés » row), the click-through to
`/admin/queues/deferred-send` (« Travaux en échec — Envois différés »,
« Aucun travail en échec dans cette file. ») and `/admin/nope` → the
directory (the `*` child). Determinism, each stated where a red will be read:
the registers are empty because only platform staff can write a session or an
announcement and the only staff in the run are A and B in this serial file
(grep: it is the sole spec naming `/admin`); « Joignable » holds because the
runner refuses to start without a Redis PING (scripts/e2e.mjs:294-300) and
passes `REDIS_URL` to the API it spawns, and the API's per-queue read budget
is `QUEUE_READ_TIMEOUT_MS = 1500` (queue-inspector.ts:40) — a red there means
the shared API process could not answer a `getJobCounts` inside 1.5 s under 4
workers and is investigated at `queue_inspector_read_timed_out`, never re-run
as flakiness; it is the suite's only browser proof that the API under test
holds the runner's Redis (the local/CI divergence the memory records). « Aucun
travail en échec » holds because, within apps/api/src, `new Worker(` appears
only in `f73-queue-inspector.test.ts` (:88, :136); the real processors live in
`apps/workers/src/index.ts` (:270, :301, :358) and step 7 of the runner spawns
`apps/api/dist/index.js` alone — no workers process runs during a run, so no
job can reach the failed set — AND, the review added, because the runner's
Redis (the shared `dealpilot-redis` on :6381, under the constant
`dealpilot` prefix, which the runner PINGs but never clears) carries no
failed `deferred-send` job from an earlier process: no test in the tree
fails one (the failing test Workers in `f73-queue-inspector.test.ts` are on
other queues and wipe in `afterAll`; `queue-roundtrip.test.ts`'s
deferred-send Worker only records) and the local dev stack starts no
processor — a failed job needs a hand-run workers process. This is the first
spec to assert on Redis-held state rather than on the freshly reset
database; the comment beside the assertion says so and names the
`redis-cli --scan` that tells an environment leak from a regression, and
the runner clearing the product queues' failed sets after its database reset
is a follow-up in (9). Coverage after F-77, counted against router.tsx
at the tree: of the 11 named routes + `*` the F-74 header left, 7 named + `*`
+ the new snapshot route are opened; 4 stay deferred, each a write or a page
only a write can populate — `tenants/new` (provisions a tenant and mints an
owner invitation; a form visited and not submitted proves only a mount),
`support-sessions/:sessionId` (needs a started session, which notifies the
tenant owner and walls the console for the rest of the chain — F-71's own
journey), `announcements/new` and `announcements/:announcementId` (a publish
reaches every user on the database). The gate verdicts `reauth`,
`impersonating` and `error` stay deferred for the header's reasons. Measured
cost: T1 ≈ 8 s, T6 ≈ 5.6 s, T7 ≈ 6 s under 4 workers, inside the 90 s budget;
the seven-step file runs in ≈ 36 s alone.

(8) **Rejected, with reasons:** a second spec file (one importer, one TOTP
secret); provisioning the tenant's store and key through `/admin/tenants/new`
(a console WRITE with an owner-invitation side effect, ~15 s, when a
tenant-side store costs 3 s and is what real tenants do); a section on the
tenant page (the measured costs in (5)); a nav slot (T3/T5's menus are
claims); a transport label map (vocabulary the wire does not publish); a
second defaults sentence (`commsNoRow`); a `refetchInterval` (an incident page
must not add load to the incident — the browser's reload is the refresh); a
per-page 409 re-probe (sibling inconsistency without a decision); a
`<caption>` on the tables (DataTable has no such prop and the section's
`aria-labelledby` is the table's context; adding one would touch
`@dealpilot/ui`); `aria-label` on the em-dash `<td>` (unreliably announced;
an sr-only sibling breaks `toHaveText('—')`); « Aperçu » (an overview word
for a page beside the detail page that IS the overview) and « Non » for an
inactive key (not a state word); a regex collection of `row.original.<k>`
reads in the guard (variable-name-bound — a destructure evades it; the
`satisfies readonly (keyof …)[]` tables, the runtime subset checks and the
recorder carry the claim); the JWT-shape regex in T6 (no JWT exists on this
path — cookie sessions); `body.innerText()` as the scan surface (the banner's
role chip and toasts for no gain; `#main` is admin-layout.tsx:93).

(9) **Two defects the build found outside the slice's footprint, fixed
because the gate required them, and the deferred list with un-cut
conditions.** (a) `packages/i18n/src/parity.ts`'s `icuArgs` took the first
word inside EVERY brace as an argument name; every plural in the repo before
this slice happened to start its branches with `#`, and the first `=0 {Aucun
connecteur actif}` / `=0 {No active connector}` pair reported a false
args-mismatch. It is now an ICU-aware walk (argument heads only; recursion
into plural / select / selectordinal bodies so a nested `{name}` still
counts); the `{min}` / `{minimum}` mismatch is still detected, two cases were
added to `parity.test.ts`, and `scripts/check-parity.mjs` reads the rebuilt
dist, so CI runs the same checker. Nothing was weakened — the checker now
reports strictly the real argument sets. (b) pnpm 10 forwards the `--` of
`pnpm e2e -- --grep x` literally (`argv = ["--", "--grep", "x"]`); Playwright
reads that `--` as end-of-options and silently drops the filter, so the WHOLE
suite ran for a command that every doc string, the runner's own comment and
ROUND 21.5 quote (measured with pnpm 10.26.1; `pnpm e2e --grep x` never had
the problem). `scripts/e2e.mjs` now drops one leading `--` (a no-op if pnpm
stops forwarding it); proven: the quoted command runs « Running 7 tests using
1 worker ». Deferred, each with its un-cut condition: entitlements on the
snapshot (§9 row 1 — un-cut = an entitlements / feature-flag producer; the
snapshot carries `plan_code` only); a producer for « Inactive » (a route that
pauses a key without revoking it); the usage page's `BackLink`, whose words
name the directory while its target is the tenant page
(tenant-usage-page.tsx:143 — the mirror of (4), not this slice's file); the
usage / queues 409 re-probe parity retrofit ((6)); the e2e runner clearing
the product queues' failed sets in Redis after its database reset (un-cut =
a raw `DEL` of `dealpilot:<queue>:failed` between the PING and the API
spawn, or a Redis the runner owns — today the shared :6381 is also the
vitest gate's, and a concurrent gate would lose its queues); per-store comms
rows (the route, D-077 (7)); transport labels (the day the wire publishes an
enum); Twilio / DKIM / deploy version on the platform card (O-49). Also
recorded: F-73's « dedupe leaves the stamp alone » comment
(0069:473-476, D-074) is false — see (3) — and stays as a claim in that
migration's header until a slice touches it. Related: D-074
(the snapshot's definer, the caption rule, « API only »), D-075 (one importer,
the runner), D-076 (token roles the new page obeys), D-077 (the settings
strings this page reuses; the remount fix T6's URL form sidesteps); migration
`20260830000069` (the definer `admin_tenant_snapshot`, whose NEVER-token /
NEVER-secret projection is the fact every barrier here defends).

## D-077 — 2026-08-31 — The rooftop is configured from the screen, the assistant reads the clock it was promised, and the last curl leaves the owner's runbook

F-76 (admin-console.md §10, §10.1; FR-TEN-004; FR-AI-011/017;
compliance-and-quality.md §3; the runner-up of the 2026-08-31 scoping.
Designed by the three-planner + judge workflow — winner `owner-runbook` —
hardened by four adversarial critics into a binding build document of 12
rulings and 25 amendments, built in three waves with disjoint file
ownership, reviewed through six adversarial lenses with refute-biased
verification (six lenses, 17 raw findings — 10 confirmed, 7 refuted, all six finders returned; every confirmed one fixed and proven red-then-green (the majors: sub-1000 holiday years serialised unpadded and refused by the new Store.parse for the whole store list, a holiday ignored on a store with no hours grid, weekday phrases a week early, and a daily-cap label that hid the drips)), and gated: `pnpm turbo run build typecheck lint` 25/25 tasks (17 cached); `RLS_REQUIRED=1 REDIS_URL=redis://localhost:6381 npx vitest run` → **184 files / 2028 tests, exit 0, no unhandled errors**; `node scripts/e2e.mjs` → **57 passed in 2.2 m against dealpilot_e2e_test rebuilt from migration zero — after run 1 of the gate had failed two pre-existing specs under load (f40's assignee row and F-74 T3's directory search; both green in every other run), T3's failure turned out to have a real cause — F-69's directory form was keyed on the plans query and remounted when plans arrived, wiping the typed search — fixed by keying only the plan select, then T3 5/5 and the whole suite 57/57 twice**, lock released, nothing left listening.)
(1) **Zero new vocabulary, by construction.** Every control this slice adds
produces a column the API already accepted — `timezone`, `business_hours`,
`holiday_dates`, `sms_number`, `phone`, `default_locale` through the
existing `PATCH /api/v1/stores/:id`; the quiet window, the first-touch
exemption, the daily cap and the turn cap through the existing
`GET`/`PUT /api/v1/organizations/:id/comms-config` — and every one of them
had consumers in production code and no screen: `evaluateSend` defers a text
to the store's quiet window, drips tick on the store clock, the carrier sends
from `sms_number`, the console snapshot reports `business_hours_set`, and
the owner set the one live number with curl. No new column, enum value,
permission, contract entry or detail code; three new routes only
(`/settings`, `/settings/stores`, `/settings/automations`); no migration —
0070 stays the newest.
(2) **The premise the brief had wrong, measured before a line was written.**
All three planners found that the assistant did NOT read the hours:
`apps/workers/src/assistant-turn.ts:174` fed the prompt `hoursText: null`
and `:195` `withinBusinessHours: true` unconditionally, while
`packages/ai/src/prompt/system-prompt.ts:143/:166` already printed the
fields — every customer was told the store was open. `holiday_dates` had
zero readers anywhere. So the controls ship WITH their consumer, under the
dead-vocabulary law's own logic: `packages/core/src/store-hours.ts` (pure —
`storeOpenState`, an English `hoursText`, a coarse `nextOpenPhrase` in both
languages: « plus tard aujourd'hui » / « demain matin » / a weekday /
« dès la réouverture », and a store-local `localDateTimeText`; 20 golden
cases including the 2026-03-08 DST morning, a half-open close, a holiday
today and tomorrow, fourteen holidays in a row, `{}` → not known) and one
hoisted worker SELECT (`business_hours, holiday_dates::text[], timezone` and
the comms cap) feeding the four prompt fields plus
`maxMessagesBeforeHandoff: bot_turn_cap ?? 15` — the turn-cap label is true
for the prompt as well as the handoff evaluator. An EMPTY grid keeps today's
behaviour — open, and no `Hours:` line — and the grid's hint says so; a
listed holiday counts as closed all day whether or not a grid exists (the
review caught the first cut returning "unknown" before it looked at the
holidays). The coarse phrase names a weekday only for an opening two to six
days out; beyond that it says « dès la réouverture » — a Monday eight days
away must not read as « lundi ». The prompt's first consumer test is the
worker's: closed at 03:00 → « The dealership is closed » + the phrase, open at
14:00, `{}` → open and NO `Hours:` line, a holiday today → closed, cap 8 →
« at most 8 messages ». ROUND 23.9 says in words that this is proven by the
worker's tests and is not visible on the owner's screen until
`AI_TRANSPORT=anthropic` and a key exist.
(3) **Three defects inside existing routes, fixed because the screen would
have exposed them (R12).** (a) pg returns `date[]` as local-midnight `Date`s:
`'2026-12-25'` read back as `2026-12-24T22:00:00.000Z` on this UTC+3 desktop
— a `storeRow` serialiser with local getters (the F-07 `acquisition_date`
precedent, extracted to `apps/api/src/local-date.ts`) now runs at ALL FOUR
store exits (list, GET, POST, PATCH including the no-op branch) and feeds
`diff()` so an unrelated PATCH records no phantom holiday change;
`Store.holiday_dates` is tightened to `YYYY-MM-DD` and `Store.parse(body)`
on every exit makes the serialiser's absence red in UTC CI too, not only on
non-UTC desktops. No global pg date parser (it would change
`vehicles.acquisition_date` and two month payloads nobody asked about).
(b) The F-30 « one number, one store » 409 carried no field path
(`idx_stores_sms_number` was missing from `CONSTRAINT_PATHS`; the f30 test
asserted only `>= 400`) — it lands on the number field now, and the copy
never names the holding store: the index is platform-wide and the holder
may be another dealer's rooftop. (c) `PUT comms-config` compared `HH:MM`
inputs against `HH:MM:SS` stored values as strings, and an inverted window
hit the database CHECK as a 500 — both operands are normalised and
`start >= end` is refused as a 422 with the EXISTING `invalid_window` key on
`sms_quiet_end` (the f42 precedent; a new `check_violation` code was struck).
(4) **Shape (R3, R4, R9).** An additive `/settings` group; nothing moves —
`/organizations/:orgId/stores/:storeId` stays the one producer form and
every deep link and e2e path survives; §10's « legacy pages migrate under
/settings/* » is deliberately not done. The index links ten sections and
mirrors each target page: a link hides only when the page hides itself
(branding, on `organization:update`); labels for existing pages reuse the
target's own title key, so a renamed page renames its link; a source-parsing
guard (`sections.test.ts`) proves every link resolves to exactly one route
under the `/` shell (mutations: a dead link → red; a renamed route → red).
The nav item is desktop-only (the phone bar keeps its seven items) and the
organization page carries a « Réglages » link for phone reach. Gates are the
server's own permissions through `can()` — never a role string: the store
form's whole fieldset disables without `store:update` and the automations
form without `organization:update`, each with its read-only sentence.
§10's « sales_manager may edit Automations » is a ⚠ DECISION (ROUND 23.10):
`DEFAULT_ROLE_PERMISSIONS.sales_manager` holds neither permission; the
owner widens it in the A-13 matrix; no new permission was invented.
(5) **The store form's « Exploitation » (R5, R6, R7).** Timezone = the F-70
curated select over `CANADA_TIMEZONES` (hoisted to
`apps/web/src/shared/timezones.ts`) + « Autre (nom IANA) », on CREATE too
(default `America/Montreal`, so nothing changes for existing specs);
`assertKnownTimezone` stays the only authority and the API pins all twelve
literals. Hours = a seven-row grid whose payload omits closed days
(`{}` IS the all-closed payload), one window per day, `close > open` mirrored
client-side and bound to the server rule by a 200-draft property test
(`rowErrors(d).length === 0 ⇔ UpdateStoreInput.safeParse(...).success`).
Holidays = a date list with dedupe/sort, a calendar refine (2026-02-30 and
2027-02-29 refused — previously a pg 22008 → 500) with the year bounded to
1900–2199 (the review found that a year below 1000 was accepted and then
serialised unpadded as `1-01-01`, which the new `Store.parse` refused for the
whole store list; year 0 was a 500), max 60, lockstep-tested against
`HolidayDatesShape` in the schema and its byte-identical client mirror. Every server refusal lands on its field by
`detailPaths`/`detailCodes` — `unknown_timezone`, `phone_nanp`,
`unique_violation`, the per-day `business_hours.<day>` errors,
`holiday_dates.<i>` — and a pathless 409 still maps to the top alert.
Blank numbers leave the browser as `null`, never `''`. The number hint
states what changing a LIVE number does, each clause read from the senders:
outbound moves on the next send; replies to the old number no longer reach
the store.
(6) **Rejected, with reasons:** a free-text timezone with a `<datalist>`
from `Intl.supportedValuesOf` (no assistive-technology semantics; ICU builds
may omit link names such as `America/Montreal`); `check_violation`
(`invalid_window` exists); gating index links on permissions their target
pages do not enforce (the index must not claim narrower access than the
pages); extending the org page instead of `/settings` (it stops scaling at
the first §10 section with no record to hang on); a self-deny step to prove
read-only (it proves half — a « Directeur des ventes » invitation proves
both forms); deferring holidays (a producer into a void until the wire; the
wire lands here).
(7) **Deferred, not invented — each with its un-cut condition:** per-store
comms-config overrides (the table supports them; no route writes a store
row — condition: `PUT /api/v1/stores/:id/comms-config` + contract entry);
§10's route migration; the tenant snapshot console page (O-51) where
`business_hours_set` becomes visible; a narrower permission for sales
managers; the store's address fields on the form (the prompt already prints
them); create-time hours; overnight or split windows (one window per day);
holiday presets and recurrence; `adf_email` per store (no column); the
first-touch after-hours clause in the templated first message (legal copy,
Q-24); a browser-visible assistant proof (needs an Anthropic key). Not
recorded before and now on the board: `TASKS.md` gets its first slice row
since S-01 — F-19…F-75 were never added there and live in `SESSION_LOG.md`.
Related: D-050/D-051 (F-51 hours awareness), D-074 (`business_hours_set`),
D-075 (how e2e runs), D-076 (token roles every new screen obeys);
migration `20260819000054_business-hours.sql` whose header promised the
consumer « with the AI engine ».

## D-076 — 2026-08-31 — The published brand paints the app: a fill/text role split, proof surfaces the app actually paints, and two values nothing ever produced are retired

F-75 (white-labeling.md §2–§7, §12, §13; FR-WL-002/004/005; ROADMAP §4;
F-14 increment 3. Designed by the three-planner + judge workflow — winner
`aa-by-construction` — hardened by four adversarial critics into a binding
build document of 16 rulings and 23 amendments, built in three waves with
disjoint file ownership, reviewed through six adversarial lenses with
refute-biased verification (six lenses, 20 raw findings across two passes — 15 confirmed, 5 refuted, every confirmed one fixed and proven red-then-green; the first pass's contrast finder died mid-response and its lens was re-run alone on the fixed tree (1 finding, confirmed minor, fixed)), and gated: `pnpm turbo run build typecheck lint` 25/25 tasks (21 cached); `RLS_REQUIRED=1 REDIS_URL=redis://localhost:6381 npx vitest run` → **175 files / 1903 tests, exit 0, no unhandled errors**; `node scripts/e2e.mjs` → **48 passed in 2.4 m against dealpilot_e2e_test rebuilt from migration zero**, lock released, nothing left listening.)
(1) **The problem, measured.** Since F-14 the editor offered six colours, a
font, a radius, density and a dark mode, and Publish computed a full palette —
but the SPA injected only `--radius`, `--ring`, `--sidebar-ring` and the
display name. About 80% of `PublishedBranding` was a produced payload with no
consumer, and a tenant's Publish was a claim the product did not honour. Worse,
the palette's text tones and rings were proven against pure white
(`SURFACE_LIGHT` at L = 1) while the app paints its page `#F5F7FA` and its
muted/secondary surfaces `#F3F4F6`. Measured for `#FDE047`: `text.primary`
4.502:1 on white, **4.195:1 on the page, 4.091:1 on muted** — and the focus
ring, which F-14 already injected, **2.795:1 on the page against a 3:1
floor.** A guarantee proven on a surface the app never paints was not a
guarantee; twelve published brands on the dev database carried such values.
(2) **The role split (R1).** `--primary` is fill-only. A new semantic token
`primary-text` (blue-600 light / blue-400 dark — the values `primary` carried,
so the platform look does not move) takes every text, border and accent site.
One command renamed 46 `text-primary` class sites in `apps/web/src` (47 grep
lines, one a comment) and 3 in `packages/ui`, 1 `border-primary`, 7
`accent-primary` and 11 `accent-[var(--primary)]` checkbox sites, and 6
`border-destructive` → `border-danger-border`; hand edits moved the unlabeled
usage bar and win-loss bar to their `-text` tones and dropped the one
`text-primary-foreground/75`. Rejected: re-pointing the `text-primary` class at
another variable in the Tailwind wiring (a class named for `--primary` that
reads `--primary-text` is a false claim in every DevTools panel, loses opacity
modifiers, and still needs the same guard); renaming the fill instead (it
inverts shadcn's `bg-primary text-primary-foreground` pairing that every
vendored component assumes). `packages/ui/src/theme/token-roles.ts` holds
rules 1–7 as a pure matcher scanned over the tree (154 files; 85 violations
at the base tip, 0 after) and is mutation-tested: a fill must carry its label
in the same class literal, a hover fill its hover label, no opacity on a
tenant fill or on any foreground, no `var(--primary)` escape outside
`brand-style.tsx`, no brand text tone inside a status tint.
(3) **Proof surfaces (R11, A1, A2).** `SURFACE_LIGHT = #F3F4F6`,
`SURFACE_DARK = #232738` — the darkest light and lightest dark neutral the
app paints, pinned to `@dealpilot/ui` tokens by `surfaces-lockstep.test.ts`.
`readableOn`/`ringFor` verify the value that SHIPS: the OKLCH string is
re-parsed after formatting and L is stepped until the string round-trips ≥
target (measured: the float passed at 4.5000042 while its formatted string
measured 4.4999999). Dead-zone fills (`#E11D48` 4.4988, `#6366F1` 4.4311,
`#DB2777` 4.4025 — luminance 0.17–0.19, where neither label reaches 4.5) are
nudged toward their label and recorded as `fills.<name>` adjustments.
`hoverFill` prefers the step on which the BASE label still clears AA (the
default blue flipped its button label white → near-black on hover). Stale
snapshots are not recomputed in SQL: the SPA re-proves `text.primary(_dark)`,
`ring.primary(_dark)` and `ring.danger(_dark)` against the same surfaces and
omits what fails — tokens.css applies and `data-brand-gated` names the cell;
"publish again" is the remedy (ROUND 22.1).
(4) **The token contract (R2, A3–A6).** `brand-style.tsx` is a table of 18
rows `{css, light, dark, unit, requires, proof, when}` and `brandCss`
iterates it. Units — a fill and its foreground emitted together or not at
all: `primary` (`--primary`/`--primary-foreground`), `primary-hover`
(requires `primary`), `destructive`, `destructive-hover`, `success` (consumed
by the rebuilt heatmap ramp), `accent` (`--sidebar-accent` /
`--sidebar-accent-foreground` — `accent_color`'s real consumer, R3; shadcn's
`--accent` hover tint is never injected). Proof groups: `text.primary` →
`--primary-text`, `--accent-foreground` (unconditionally, A5) and
`--sidebar-accent-foreground` when no accent unit is present; `ring.primary`
→ `--ring`, `--sidebar-ring`; `ring.danger` → `--danger-border` (the
danger-bordered inputs; UI pairs `danger-border/input-bg` and `/card` join
the gate). Warning and info rows are NOT painted and their editor fields are
hidden: no app component paints a solid warning/info fill (A6; un-cut
condition: a component that paints the solid fill with its label). Semantic
`*-text` tones and `*-bg` tints stay platform because they sit on tints the
palette does not carry. The light block is `:root:not([data-theme="dark"])`
(A4), so an omitted dark half cannot be overridden by the light value through
the cascade. `SAFE_COLOR` gates every value. `PALETTE_READS` is derived from
the table, and `brand-consumers.test.ts` proves: every cell the producer emits
is read XOR listed in `UNCONSUMED_PALETTE` with a reason; no phantom CSS
variable is painted; no UNCONSUMED cell is read; every `PublishedBranding` key
is accessed in consumer code with comments stripped; every unit fill is in
`TENANT_FILLS`.
(5) **Density, logo, favicon, title, dark lock, first paint (R5–R8, A11,
A12, A19, A21).** `data-density` on `<html>` (compact only) finally has
readers: DataTable rows and cells (`--row-h` 34 px, `--cell-py` 6 px) and
inputs (`--input-h` 40 → 34); comfortable rows become 44 px minimum — the
value the token always declared. `BrandMark` renders `<img src>` only (the
SECURITY.md convention; the first consumer of the `dark:` variant), with the
URL built from the contract path plus `organization_id`, `store_id` when set,
and `v=<version>` (the asset route caches a slot URL as immutable). One
`<link rel="icon" data-brand-favicon>`. Page titles read a `BrandNameContext`
that only `AppLayout` provides, so `/admin/*` and public routes cannot carry
a brand by construction. `dark_mode='disabled'` is a lock in `theme.ts`
(`setTheme` a no-op, storage untouched, the toggle unmounted) and the stored
preference survives a republish. No platform-palette flash: `RequireAuth`
prefetches the branding query for non-`/admin` paths and `AppLayout` shows the
neutral skeleton while the query has no answer and a fetch is in flight; a
cold load with no session fires one unauthenticated GET that answers 401 and
is refetched after sign-in (accepted, A21). The pre-login bootstrap of §3
stays behind D-041.
(6) **Migration 0070 (R4, A13, A14).** `dark_mode='custom'` and
`font_family='custom'` (with `font_woff2_key`/`font_woff2_bold_key`) had no
producer path reaching a consumer since F-14 — no custom-dark columns, no
font slot, an editor that mapped `custom` back to `inter`. Retired
forward-only: `SET LOCAL row_security = off` first (FORCE RLS: a
non-BYPASSRLS runner errors instead of updating zero rows and passing the
assertion vacuously — 0012's precedent), the column UPDATEs, a WHERE-scoped
`published_snapshot` rewrite (`||` with a null-stripped object, because
`jsonb_set(…, NULL)` would null a whole snapshot), a DO block that fails the
migration if a retired value survives, the CHECK restatements, `DROP COLUMN`
×2. On the dev database the value rewrite is a no-op (0 `custom` anywhere) but
the key scrub touches 72 of 72 published snapshots — stated in the header;
`version` is untouched on purpose. Lockstep: Zod enums, `UpdateBrandingInput`,
the editor rendering `FontFamily.options`, both locales;
`branding-vocabulary.test.ts` pins CHECK ⇔ enum set equality for all four
branding enums and the absence of the dropped columns;
`migration-0070-rewrite.test.ts` applies 0070 to a seeded stale row in its own
disposable database. The un-cut conditions are verbatim in the 0070 header.
`font_inter` is relabelled « Police de la plateforme » — Inter is not
self-hosted anywhere in this repo.
(7) **Editor (R14).** No new colour fields; warning/info hidden; a « Logo et
favicon » fieldset with three uploads (200 / 200 / 100 KB; PNG, JPEG, SVG),
« Retirer », and state text that distinguishes uploaded from published; hints
for the accent, for density (« 34 px au minimum », never "rows are 34 px")
and for a disabled dark mode. OWNER-TEST 14.9–14.11 become reachable from
the editor for the first time.
(8) **Proof (R13, A17, A18).** `apps/web/e2e/f75-brand-paint.e2e.ts` seeds a
pale brand the publish adjusts, reads every expected value back from
`GET /api/v1/branding`, asserts with `toHaveCSS`/`expect.poll` only, measures
WCAG ratios in-page with `e2e/support/contrast.ts` on both themes, checks
logo, favicon, title, density and font, proves the dark lock over a stored
preference, and that `/login` is unbranded after sign-out; the F-14 spec
asserts the unbranded shell carries none of it. No axe: a dependency is
ask-first, and the ratio is the same number.
**Rejected, with reasons:** the Tailwind re-point and the fill rename (2);
retiring `accent_color` (a consumer existed one token away — plans 2 and 3);
copying D-024 tint hexes into core to brand semantic text tones (a second
source of truth for locked values); a `lockTheme()` that writes `light` to
storage (destroys the preference for every other tenant); a route loader for
first paint (serialises branding before the session, fires for visitors,
needs a `HydrateFallback`); hardcoded OKLCH strings in the e2e (break on
every core change); importing `@dealpilot/core` inside a Playwright spec (no
precedent, loader unverified); a client-side colour computation (§5 forbids it
— the SPA re-PROVES, it never derives).
**Deferred, not invented:** card padding and kanban width under density (no
component owns them); brand-derived semantic text tones and tints (the palette
carries no tint); `--chart-1..5` and `--sidebar-primary*` (no readers, no
chart library, no hue rotation); custom fonts and custom dark palettes
(retired with their un-cut conditions in 0070); `login_bg_key` and
`email_logo_key` (produced by F-14b, consumed by nothing — un-cut conditions:
the D-041 answer in `docs/OWNER-DECISIONS-PENDING.md`; a branded-e-mail
slice); the §3 pre-login bootstrap, §11 live preview and §12 logo-luminance
heuristic; asset dimension validation (needs `sharp`, a dependency);
`Cache-Control`/`ETag` on `GET /api/v1/branding` (the SPA's `staleTime` is the
cache today); Inter self-hosting (D-024's promise, now labelled honestly).
Related: D-024, D-041 (`docs/OWNER-DECISIONS-PENDING.md`), D-075, the F-14
lineage in `docs/HUSSEIN-F14-CONTRACT.md` (CR-15/CR-16) and `docs/TASKS.md`.

## D-075 — 2026-08-31 — The e2e suite owns a disposable database, and the console's first staffer is minted by the suite, never by the owner's one-shot

F-74 (ci-cd.md §4; the `⚠ NEEDS YOUR DECISION` block of 2026-08-30,
option A; ADR-023; designed by the three-planner + judge workflow — winner
`safety-first` — hardened by an adversarial critique into a binding build
document of 18 rulings and 24 amendments, built, then reviewed through six
adversarial lenses with refute-biased verification: 22 raw findings, 14
confirmed and fixed before landing, 8 refuted with the reasons on file).
(1) **The suite runs against `dealpilot_e2e_test`, rebuilt from migration
zero on every run, locally and in CI.** The name is the enforcement:
`reset()`'s existing `/_test$/` guard permits it BY NAME, so
`DB_RESET_CONFIRM` — the escape hatch that names the dev database — appears
nowhere on the e2e path, and a vitest guard
(`apps/web/e2e/e2e-isolation-guard.test.ts`, run by `checks`) goes red if it
reappears in the runner, the Playwright config, any spec, or the `e2e:` job
block of `ci.yml`. `packages/db` gained `disposableDatabaseUrl(base, name)`
— the `/^[a-z][a-z0-9_]*_test$/` rule applied before any connection exists,
which is also the identifier whitelist for the `CREATE DATABASE`
interpolation — and an optional, guarded `[dbname]` positional on both
`reset` and `platform-grant`. Each positional path builds a SECOND pool from
the swapped URL: swapping the URL string and reusing the module pool would
have `reset()` check its guards against the `_test` name while the `DROP
SCHEMA` ran on the resolved default — HO-07 with the safety mechanism
reporting success. A pool-swap test plants a sentinel in the default
database and proves the named reset leaves it standing.
(2) **One runner, `scripts/e2e.mjs`, is the only way to run the suite —
`pnpm e2e` locally, `run: node scripts/e2e.mjs` with no `env:` block in CI —
so the two worlds are the same program.** F-72 shipped two red pushes on a
green local gate because `REDIS_URL` is unset on this desktop and set in CI;
this file is where that class of divergence stops. In order: refuse unless
Redis answers PING; take a pid lock, because the port probe alone cannot
serialize two runners (the API binds its port ~20 s AFTER the reset, so two
runners started inside that window would both pass the probe and the second
would drop the schema under the first one's live API); refuse when anything
answers on ITS ports — 3101 and 5176, both address families, constants
rather than env reads so "the dev ports are never probed" is true
unconditionally — and never adopt a server it did not start; build the full
graph; reset the database through the built CLI; assert the API's
`DATABASE_URL` ends `_test` before the process exists; spawn the API as a
direct node child logging to `.e2e/api.log`; poll `/api/v1/health` for
`{status:"ok",db:"up"}` (the old `curl -fsS` accepted a 200 that said
`db:"down"`) and, on timeout, report the LAST observation with the poll's
own traffic filtered out of the log tail; then run Playwright with the SPA
as its only `webServer`, `reuseExistingServer: false`. Teardown reaches the
actual listener (taskkill /T on Windows, SIGTERM elsewhere), also on a
pid-only SIGINT/SIGTERM to the runner, and `--retries`/`--repeat-each` are
refused because the console bootstrap is a one-shot per reset. The
Playwright config refuses to load outside the runner (`DEALPILOT_E2E=1`), so
a bare `playwright test` pointing a browser at the dev stack is a refusal,
not an accident. The reset never moves into a Playwright `globalSetup`:
verified in the installed playwright@1.61.1 that webServer plugins start
strictly before globalSetup files, so the API would pool against a schema
that does not yet exist.
(3) **The console's first staffer is minted by ONE spec through the shipped
`platform-grant` verb, with the `_test` name as its positional.**
`apps/web/e2e/f74-console-door.e2e.ts` owns the database-wide no-actor
one-shot (PA010 after the first), and `bootstrap-guard.test.ts` goes red on
a second importer OR on zero — comments are stripped before matching, so
prose cannot stand in for the import. The second staffer is granted from the
console's own `/admin/staff` form: the one console write this slice affords,
and what makes the capability-gated nav assertion falsifiable.
`adminNavItems()` is extracted from the layout and unit-tested for all three
roles, because only one bootstrap can exist per run. The owner's dev database
keeps its one-shot — `platform_staff` there is still empty — and nothing on
the e2e path can name that database: the only literal ending `/dealpilot` is
the runner's host-shaped maintenance base (`CREATE DATABASE` only), exempted
by name AND by owner credentials and asserted to occur exactly once. The
adversarial review found that exemption dead on arrival: the literal scan
stopped at the first space inside `${process.env.DEALPILOT_DB_PORT ?? 5434}`,
never saw the `/dealpilot` tail, and a mutation pointing the API's own URL at
`dealpilot` stayed green. The scan is template-aware now and all four
mutations are red.
(4) **Rejected, with reasons, so they are not re-proposed.** (a) *A logical
Redis database index (`/1`) for e2e isolation:* verified in-tree that
`deferred-queue.ts` and `apps/workers/src/index.ts` build BullMQ connections
from hostname+port only, DROPPING the URL pathname, while presence/realtime
hand the URL to ioredis, which honours it — `/1` would put the queues on 0
and pub/sub on 1, a silent half-split that looks like isolation. The residual
exposure is stated instead of built around: with `REDIS_URL` set, an
e2e-enqueued job would be consumed by a worker process on the same Redis;
`apps/workers` has no dev script, so `pnpm dev` never starts one, and the
exposure requires a hand-run `pnpm --filter @dealpilot/workers start`.
(b) *A read-only fingerprint of the dev database, checked before and after
the run:* observational under `retries: 0` — it can only report a wipe after
the fact — and it opens a dev connection on the very path whose thesis is
that it has none. Replaced by the two static proofs above, each
mutation-tested to red. (c) *Dropping the orphan `dealpilot_e2e` by script:*
its defect is that its name does not end `_test`, so no code on this path may
touch it; the owner's one-liner is in `docs/OWNER-ACTIONS.md`.
Deferred and named in the journey's header, so widening the scope is a
visible deletion: every console write except the `/admin/staff` grant, the
twelve other `/admin/*` routes, and the `reauth` / `impersonating` gate
outcomes. Related: D-070/D-071 (the console e2e debt this closes), D-074,
HO-07.

## D-052 — FR-TEN-006 cost masking: absent, never null (2026-08-20)

**Decision:** cross-store cost masking (inventory.md §9) is app-level column
masking at the API serializer per ADR-007 — the masked fields
(acquisition/transport/recon/list_price/total) are DELETED from the payload,
never nulled: a payload must not whisper that a number exists. The view is
computed per request from the caller's memberships IN THAT ORG (explicitly
org-filtered — the GET-by-id path runs under user context, and a GM hat in
org A must not unmask org B): owner → everywhere; gm/used-car/wholesale
manager → their membership store's units (an org-wide membership of those
roles = every store is their remit); everyone else → never. The response
schema makes the cost fields optional, and every web consumer treats absence
as "—" or no-prefill — never a fake zero. list_price is masked per the
spec's own table ("internal"); the deal's numbers are typed at desking.

**Amended same day by the A-13 drift guard:** the first draft hardcoded the
role list, and the guard refused it — correctly. WHO sees costs is now the
permission `vehicle:read_costs` (0052 seeds owner/gm/used-car/wholesale for
existing orgs; new orgs seed from the catalogue), editable per organization
like every other authority; WHERE stays the membership that carries it. The
view opens its OWN dual context (org+user), because the vehicle list runs
under user context where the matrix's org-scoped RLS is invisible — the
persona test caught every GM masked before the fix. The guard also learned
that a JOIN against the matrix is enforcement's second shape.

## D-074 — 2026-08-30 — Every usage number names a row that exists, and a retry says out loud that it can text a customer twice

F-73 (admin-console.md §3, §5.1, §6, §9, §11, §12;
analytics-and-adoption.md §5.3, §6, §7; ADR-009/011/012/016; designed by
the same three-planner + judge workflow as F-69…F-72 and then hardened by
an adversarial critique into a binding build document — 16 rulings, 30
amendments, a fixed build order and an 87-case manifest, with every
contested repo fact re-verified live before it was written).
(1) **No `usage_counters`, and the refusal is written into the
migration:** `packages/db/migrations/20260830000069_usage-snapshot-jobs.sql`
creates **no table and no column** — six indexes and three definers,
nothing else. §6 sources every figure from a rollup fed by an hourly
Valkey flush; a counter is a SECOND source of truth, the spec itself
budgets a nightly reconciler because of it, that reconciler is not in
this slice, and the write path is keyed on `REDIS_URL`, which is
`z.string().optional()` (`apps/api/src/env.ts:56`) and unset on every
developer machine and in CI's `checks` job — so a counter reading zero
because Redis was absent is indistinguishable from a tenant that did
nothing. Every number that has a producer is aggregated at READ time from
`leads`, `deals`, `messages`, `memberships`, `activity_events`,
`deal_documents`, `stores` and `plans` inside one STABLE SECURITY
DEFINER over a window capped at 90 days. The un-cut condition is in the
0069 header verbatim (O-38): a rollup table lands WITH its `usage-flush`
job AND its `usage-reconcile` job — never one without the other two.
(2) **Which of §6's names survived, one by one.** SHIP as named:
`deals_created`, `deals_delivered`, `sms_segments` (with its companion
`sms_messages_unsegmented`), `ai_first_touch_p95_seconds` (with
`ai_first_touch_sample_count`). RENAME-AND-SHIP (O-41), because the obvious name
claims more than the row can support: `seats_active` →
`seats_provisioned` (`count(DISTINCT mb.user_id)`, since `memberships` is
UNIQUE on `(user_id, organization_id, store_id)` and the members route
writes one row per rooftop, so a GM at three rooftops is three rows and
ONE seat), `leads_ingested` → `leads_created` (`apps/intake` is a
five-line stub and intake runs synchronously inside `apps/api`; there is
no discriminator between webhook-ingested and hand-keyed),
`ai_conversations` → `ai_conversations_engaged`, `storage_bytes` →
`document_bytes` (`deal_documents.size_bytes` is the ONLY byte column in
this schema — `tenant_branding` stores keys with no size). SUBSTITUTE for
`dau`/`wau`/`mau`: one number, `members_who_acted`. Eleven figures in all
answer a §6 name; `member_count` and `store_count` ride beside them as
context and are `admin_get_tenant`'s own SQL repeated rather than renamed
(0066:114-115), so the usage card and the tenant page cannot print two
different numbers for one fact — thirteen on the card, plus three plan
allowances. CUT by name, each with an un-cut condition in the list below
(O-39): `dau`, `wau`, `mau`, `ai_voice_minutes`, `api_calls_mtd`,
`rate_limit_429s`, `intake_ack_p99_ms`, the health card's Sentry-sourced
error count, and per-tenant DLQ depth.
(3) **`members_who_acted` is a FLOOR and is named for what it counts**
(O-40): `activity_events` is a mutation log, so a manager who reads the
kanban all day writes no row. It counts people who WROTE an
`activity_events` row in the window and who hold an active membership
today — the membership join is deliberate, because a salesperson revoked
on day 20 of a 30-day window would otherwise be counted here and not in
`seats_provisioned`, and two adjacent figures would be drawn from
different populations. It is never labelled "active users": both captions
say that reading writes no row and that the number is a floor. The dead
alternative is genuinely dead — the Better Auth `"session"` table is
hard-deleted on sign-out and expiry (`20260724000002:14-19`) and
wholesale by four platform definers (`0065:523`, `0065:658`, `0067:528`,
`0067:568`), so any retroactive DAU is arithmetic on deleted rows.
(4) **`ai_first_touch_p95_seconds` carries three restrictions, and the
caption states all three.** `percentile_disc`, not `percentile_cont` — a
latency some lead really experienced, never an interpolated one nobody
did. The sample is leads whose `chatbot_engaged_at` is in the window,
whose `created_at` is ALSO in the window (a lead created in March and
re-engaged in August would otherwise inflate August), and for which an
outbound `sender_type = 'bot'` message exists on that lead's own
conversation at or before the stamp. That EXISTS is what makes the name
true: `apps/workers/src/first-touch.ts` stamps `chatbot_engaged_at` on
two paths that send THIS lead nothing — the 24-hour dedupe path
(`:165-171`) sends no message at all, and the duplicate-as-signal path
(`:238-243`) stamps this lead while messaging the keeper's thread. An
empty sample is `null`, never 0 (`GREATEST` ignores nulls, so clamping
first would report instant service for a tenant the assistant never
greeted), and `ai_first_touch_sample_count` ships beside it because a p95
over three leads is noise.
(5) **`plans.included_*` gets three readers of five, and only for the
month to date** (O-42): `included_seats`, `included_sms_segments`,
`included_ai_conversations`. `allowances` comes back **null** for `30d`
and `90d` — the API refuses to hand the client the two numbers with which
to compare a monthly allowance to a ninety-day count, rather than
trusting a caption to repair it. `included_ai_minutes` and
`included_storage_gb` are NOT on the wire and sit in
`DEAD_PLAN_ALLOWANCES` with un-cut conditions; `plans.overage` and
`plans.features` are not rendered at all, because Core is seeded
`'hard_stop'` and nothing stops. The copy is « Compris dans le forfait »,
never « limite » and never « restant », and there are **no 80%/100%
threshold markers** — a threshold marker implies an action at the
threshold that does not exist. `included_seats` NULL means unlimited and
renders `allowanceUnlimited`, never a zero bar and never a bar at 100%;
an allowance of 0 is legal and gets no ratio at all. **`plan_code` sanity
line** (O-43): the allowance is read PER TENANT from the plan row and is
NOT multiplied by `store_count`, even though §5.1 prices per rooftop —
§5.1 annotates only `included_ai_minutes` as per-rooftop and that one is
cut, so multiplying would invent a rule. `store_count` rides the response
so the number is never read without its context, and the ambiguity is
raised as an owner decision rather than resolved by arithmetic.
(6) **Two metering decisions that stop numbers moving backwards** (O-44):
`leads_created` and `deals_created` count rows INCLUDING those
soft-deleted later — deleting a lead does not un-ingest it, and a usage
figure that moves retroactively is not a usage figure. Every existing
keyset index on those tables is PARTIAL on `deleted_at IS NULL`, so that
choice is exactly why `idx_leads_org_created` and `idx_deals_org_created`
exist: two extra indexes on two hot tables, bought to stop a number
changing after the fact, and the header says so. `document_bytes` goes
the OTHER way and filters `deleted_at IS NULL`, because a deleted
document frees storage where a deleted lead was still ingested. Six
indexes in all, each commented with the single metric it serves; the
`deal_documents` one is an `INCLUDE (size_bytes)` index-only scan, since
`idx_deal_documents_org_status` merely PREFIXES the sum rather than
serving it.
(7) **The tenant snapshot restates nothing** (§9): the route calls
`readAdminTenant()` and spreads it, then merges one
`admin_tenant_snapshot` returning only what `admin_get_tenant` does not.
The rooftop array is `store_health` and never `stores`, because
`AdminTenantDetail.stores` already exists with different members
(0066:118-122) and a second array under the same name is how two screens
start disagreeing in public. Per rooftop: `timezone`, the dealer's own
`sms_number` (shown, not reduced to a boolean — it is what a support
person checks against the Twilio console), `business_hours_set`, and a
`traffic_30d` block computed in one CTE joining `messages` through
`conversations`, since `messages` carries no `store_id`; the window is in
the block's own name so `last_message_at` cannot be read as "ever".
Intake keys carry `{id, store_id, label, provider, active, revoked_at,
last_lead_accepted_at}` and **never `token`, never `secret`** — excluded
by name in the definer, mutation-tested, and the serialized body is
asserted to contain neither value. `last_lead_accepted_at` is the honest
name for `intake_keys.last_used_at`: `f03-intake-routes.ts:542` stamps it
INSIDE the accepted-lead transaction, so a bad signature, a
suspended-tenant 410 or a dedupe rejection all leave it untouched, and
"last seen" would be false. `sms_transport`, `email_transport` and
`ai_transport` are grouped into one `platform: {…}` object under a
heading that says platform-wide, so nobody mistakes deployment
configuration for a per-tenant switch. **"Recent deploy version" is CUT**
(O-49) and `schema_migrations` is deliberately NOT substituted: it is a
schema version, it is global, it is created ad hoc by
`packages/db/src/migrate.ts:22-29` with no GRANT, and there is no deploy
pipeline for it to describe — F-72 cut Sentry rather than substitute a
lookalike (O-33) and the same discipline applies here.
(8) **A DLQ retry can send a real customer a SECOND SMS, and the design
says so rather than implying otherwise** (O-45).
`JOB_QUEUES[name].replay` is `'idempotent' | 'at_least_once'`, and **four
of the ten are `at_least_once`: `deferred-send`, `assistant-turn`,
`first-touch` and `drip-tick`.** The reason is mechanical, not cautious:
those workers reach `sendMessage(`/`deliverMessage(`, and `provider_ref`
is written only AFTER the carrier call returns — so a carrier timeout
leaves a message DELIVERED with a null ref, which is one of the likeliest
reasons the job is in the failed set at all, and re-running it
re-delivers the staged row. `runDeferredSend` re-runs the whole
compliance gate and calls `sendMessage` again with no `provider_ref`,
`send_decision_id` or job-level dedupe anywhere on the path. What is
proven is that the gate is not bypassed; "no duplicate is sent" is NOT
true and is not claimed. The controls: `queues:retry`, the queue name
**typed back at n ≥ 1 and not n > 1** (under CASL one duplicated text is
the harm, not two), `job_ids` capped at `RETRY_MAX_JOBS = 20`, a reason
of ten characters after trimming, and the register row filed first.
`Queue.retryJobs()` — which takes no id list and no filter, and would
requeue every tenant's failures at once — is never called.
(9) **`RetryOutcome` has five values and deliberately no `locked`:**
`retried | gone | not_failed | not_attempted | error`. Read from the
pinned bullmq 5.81.3: `job.retry('failed')` runs `reprocessJob-8.lua`,
whose own header documents its complete return set as 1 / -1 / -3, whose
body contains no lock check of any kind, and which never returns -2;
`finishedErrors` then assigns that number onto `err.code`
(`classes/scripts.js:1301`), so only -1 (`gone`) and -3 (`not_failed`)
can ever arrive and everything else is `error`. A job a worker is holding
sits in `active`, the ZREM on the failed set finds nothing, and the
script returns -3 — `not_failed`, inside a 200. The JSDoc at
`classes/scripts.js:1017-1021` that names -1 "locked" contradicts its own
Lua and is stale. Shipping `locked` would have minted a state with no
producer — this repo's dominant bug class, in the very enum that
describes a safety control. Mapping is by numeric `.code`, never by
message text. `not_attempted` is a NORMAL outcome, not an error: twenty
ids × two round-trips × the 1500 ms per-read belt is up to 60s of work
under `RETRY_TOTAL_BUDGET_MS = 10_000`, the budget is checked BEFORE each
`getJob`/`retry` pair so the loop never abandons a call in flight, and it
is answerable precisely because the register row was filed with the full
requested list.
(10) **The register is written BEFORE Redis is touched, and the event is
named for what can honestly be recorded at that moment** (O-48). Order:
capability → queue name (404) → body → confirm gate →
`if (!inspector.configured)` short-circuit → `organizationsOf` →
`admin_record_queue_retry(...)` → the loop → the
`platform_queue_retry_result` WARN line → 200. Redis and Postgres cannot
commit together, so one of two windows must exist — a retry no row
records, or a row recording a retry that did not happen — and §9's
"actions audited" forbids the first, so the fail-closed direction is
over-recording, which is what D-073 already chose for the kill switches.
The event is therefore **`queue.retry_requested`**, not `jobs_retried`:
at call time no outcome is known. The definer takes `(p_actor, p_queue,
p_requested, p_organization_ids, p_reason)` — there is no `p_retried` and
no outcome coherence check, because neither can exist yet.
`p_organization_ids` is the distinct set the inspector read out of the
payloads BEFORE the row was filed, and it is what lets the register
answer "whose customer got the second SMS"; it is empty on the four
queues whose jobs name no tenant and empty again when Redis is
unreachable, never a guess and never taken from the client. **No row at
all** is written when the inspector is unconfigured — nothing was
attempted, and an event there would be an audit trail of a button press.
Both directions are mutation-tested. `platform_audit_events.event` is
restated whole in the 0068 shape and now carries eight values, in
lockstep with `PLATFORM_AUDIT_EVENTS` in the same commit; the three READ
routes write no audit event, because §12 audits mutations and every admin
request already writes the `platform_access` log line.
(11) **A DLQ row shows an allow-list of scalars, never a payload**
(O-46). `JOB_QUEUES[name].dlq_fields` is an ALLOW-list, checked against
each queue's own Zod shape by
`packages/contracts/src/queue-catalogue.test.ts`: every listed key must
exist in the schema and unwrap to a uuid, a number or an enum — never a
bare `ZodString` — `'body'` is refused by name, and so is any scoping
field called `tenant_id`. `packages/contracts/src/queues.ts`' own header
claims a payload never carries a message body and `DeferredSendJob.body`
is exactly that: up to 1600 characters of a real dealer customer's SMS,
carried because it cannot be re-derived. A generic viewer would render
customer text into the platform console, and a DENYlist would fail open
on the next queue somebody adds. At runtime the projection also drops
anything that is not a string or a number — no worker calls
`Schema.parse(job.data)`, so an older deploy's payload can hold anything
anywhere, `String(v)` on an object would render `[object Object]`, and
`JSON.stringify` would leak the object the allow-list exists to keep out.
`failed_reason` and `first_stack_line` are the one surface an allow-list
structurally cannot cover — free text written by whatever threw,
routinely quoting a real person ("The 'To' number +1514… is not valid") —
so both go through the exported, directly tested `redactFailedReason`,
which removes `+1` E.164 numbers AND email addresses, redacting BEFORE
truncating at 500 and 300 characters respectively; allow-listed values
are capped at 120.
(12) **A queue that cannot be tenant-scoped REFUSES the filter rather
than answering an empty page** (O-47). `?organization_id=` on
`drip-tick`, `qa-review`, `task-sweep` or `announcement-fanout` is a 422
`validation_failed` with `details[0].code = 'queue_not_org_scoped'`.
**FOUR of the ten queues carry no `organization_id` at all** — the first
three have no payload schema whatsoever and `announcement-fanout`
deliberately has none, because an announcement belongs to no tenant
(`queues.ts:210-213`); the other SIX carry one. An empty page on those
four reads as "this tenant has no failures", which is a lie by
construction. `org_scoped` is DERIVED from the payload shape by
`queueIsOrgScoped()` and never hand-typed, so a queue that gains or loses
`organization_id` moves the catalogue with it. The field is
`organization_id` everywhere and never `tenant_id`, whatever §9 calls it
— this schema has never had that column.
(13) **The queue NAMES moved to `packages/schemas`,** because F-73 puts
them on the wire: one is a URL segment (`/admin/queues/:name/dlq`) and
one is a response field, so they are API vocabulary before they are
worker plumbing. `packages/contracts` imports `QUEUE_NAMES` and keys
`JOB_QUEUES`, `QUEUE_PAYLOAD` and `QUEUE_WORKER_FILE` off it, so a name
present in only one of the two files is a compile error rather than a
queue nobody can inspect. It could not go the other way: contracts
already depends on schemas, and declaring the list in contracts would
have left two lists with nothing between them. The catalogue is
`JOB_QUEUES` and its name array `JOB_QUEUE_NAMES` — NOT `QUEUE_`-prefixed,
because `apps/workers/src/queue-naming.test.ts:55` filters
`k.startsWith('QUEUE_') && typeof v === 'string'`, so a prefixed object is
silently skipped while a prefixed string is counted as a queue name.
(14) **Reads answer 200 whatever Redis is doing.** Every queue response
carries `queue_state: 'ok' | 'not_configured' | 'unreachable'` and
`counts: null` under anything but `ok` — never zeros, never an empty list
without a state, and **never a 503**: "we could not ask" and "nothing has
failed" are different facts, and the operator staring at a stuck queue at
3am is the person who must tell them apart. `503: ErrorEnvelope` is NOT
added to the shared `errorResponses`, which would widen every route in
the API for one route with no guard covering it. The inspector builds its
OWN connection — `{ maxRetriesPerRequest: 2, enableOfflineQueue: false,
connectTimeout: 1500 }`, deliberately not the producers'
`maxRetriesPerRequest: null` (BullMQ does not force it: `Queue` passes
`hasBlockingConnection = false` at `queue-base.js:20` and
`redis-connection.js:49-51` overrides only when blocking) — plus
`skipMetasUpdate: true`, which is what makes it an INSPECTOR rather than
a writer, since the `Queue` constructor otherwise fires
`client.hset(this.keys.meta, …)` on connect. `skipWaitingForReady` is
deliberately ABSENT: `initializing` is assigned exactly once
(`redis-connection.js:83`), so skipping the ready wait issues an `INFO`
on a socket still in `connecting`, `enableOfflineQueue: false` refuses
it, and the cached handle then reports `unreachable` FOREVER against a
healthy Redis — reproduced live, both ways. The bounded race is therefore
the SOLE hang control and its doc comment says so, with the `.catch` on
the READ and never on the race (CI 33291543933: 1603/1603 green, exit 1,
on one abandoned ioredis command). An `'error'` listener is attached to
every handle before any command is issued, handles are cached in a `Map`,
and `close()` awaits each in its own try/catch and falls back to
`disconnect()` on any rejection.
(15) **The DLQ pages by POSITION and says so, with its own cursor codec.**
The failed set is a live capped zset with no stable sort key a client can
carry, so the response declares `paging_basis: 'position'` and reports
`scanned`, and the caption states that entries can shift or repeat
between pages. The shared `encodeCursor`/`decodeCursor` could not be
reused — `f01-routes.ts:125` parses `{ c: PG_TIMESTAMPTZ, id: Uuid }`
BEFORE the caller sees anything, and a BullMQ job id is not a uuid
(`lead:{uuid}:first-touch`, or plain `"42"`) — so the DLQ carries
`DlqCursor = { n: QueueName, o: 0…DLQ_POSITION_MAX, f: uuid|null }` in
the same base64url-JSON envelope, under the same law that a tampered
cursor is a 400 and never a 500. `n` and `f` are carried so a cursor
cannot be replayed against another queue or another tenant filter, and
`o` is bounded in the codec so a forged position is refused before any
Redis command is issued. `DLQ_SCAN_MAX = 500` bounds the tenant filter,
which necessarily runs in TypeScript because a queue is not indexed by
organization.
(16) **Capabilities and error contract:** exactly two new capabilities,
`queues:read` and `queues:retry`, both `[platform_super_admin,
platform_support]` — §3's matrix withholds DLQ retry from billing, and §3
distinguishes looking at a stuck queue from acting on one, so it is a
pair and not one `queues:manage`. Usage and snapshot reuse the existing
`tenants:read` (§11 gives them to any platform role and `tenants:read` is
already exactly that set); a `usage:read` beside it would be a capability
with no refusal of its own to make, which `platform-drift.test.ts`'s
“capability nothing enforces” assertion exists to catch. **No new
SQLSTATE is minted and `apps/api/src/platform.ts` is not edited:**
tenant-not-found reuses
`PA002` → 404, a role refusal `PA009` → 403, a missing reason the generic
`23514` → 422 on path `reason`, and all three caller-bug belts (an
unknown period, a name that is not queue-shaped, an empty id list) reuse
**`PA014`**, already this schema's caller-bug code and deliberately
unmapped ⇒ 500. `PA027` is left free for a refusal that actually needs an
HTTP mapping. The 0069 header carries an error-contract block whose
content is "none, and why", plus the caveat that `23514` is a BLANKET map
(`platform.ts:160-163`), so a CHECK violation from a half-applied event
rename would tell the operator "Reason required" — which is why
`PLATFORM_AUDIT_EVENTS` and the widened CHECK ship in one commit.
(17) **Three new drift guards, and the missing half of an old one.**
`apps/api/src/usage-metric-drift.test.ts` is the slice's best artefact:
every declared metric's claimed `{table, alias, column}` must exist in
`information_schema.columns` AND the literal `alias.column` must appear
in `pg_get_functiondef('admin_tenant_usage')`, with `FROM table alias`
proved once per table and one alias per table asserted — so the guard
means "the definer really reads what the card claims" rather than "a
column of that name exists somewhere". It also runs the REVERSE check:
every `plans.included_*` column read live from the catalog is either read
by the card or carries a `DEAD_PLAN_ALLOWANCES` exemption, so an
exemption the definer starts reading must be deleted. And a channel
check: the union of `MESSAGE_CHANNELS_COUNTED` and
`MESSAGE_CHANNELS_NOT_COUNTED` must equal the LIVE `messages_channel_check`
values and the definer must contain the literal `IN ('sms','mms')`, so a
fifth channel added and classified nowhere is red — counting a web-chat
reply as "SMS the carrier never segmented" would be a fake undercount on
the card. `packages/contracts/src/queue-catalogue.test.ts` asserts the
catalogue covers every `QUEUE_*` name constant, that every exported
`*Job` schema is claimed by exactly one queue with no orphan and no
double-booking, that a payload-less queue is excused BY NAME with a
reason, that `org_scoped` matches what the payloads say, and the
allow-list rules above. `apps/workers/src/queue-replay.test.ts` DERIVES
the `at_least_once` partition from which worker files reach
`deliverMessage(`/`sendMessage(` — so adding a send to a worker and
forgetting the catalogue is red, and so is reclassifying a send queue to
slip past the confirm gate — accounts for every file in the workers
directory as either a queue or a named exemption, and holds each
`idempotent` claim to a literal still present in the file it cites.
`platform-drift.test.ts` gains the two F-73 route files, an explicit
`ADMIN_HANDLER_COUNT = 28` (the handler↔contract equality already caught
one side moving; it could not catch both moving together, which is what
adding an endpoint looks like), and **three positive
`has_function_privilege(…, 'EXECUTE') = true` assertions** by exact
signature for the three new definers — the block above it asserted only
what is NOT callable, so a definer that shipped with its REVOKE and
without its GRANT passed every guard in that file and failed at the first
support click instead.
(18) **F-73 adds nothing to `ADMIN_ALLOWED_DURING`** (O-50):
`apps/api/src/impersonation.ts:76-81` is unchanged, so all five F-73
routes answer 409 `impersonation_active` during a live support session.
F-72 set that bar at "an emergency stop the incident itself may require";
reading a usage card and requeueing a job are not that, and a retry filed
inside an impersonated session would carry two audit contexts for one
act.
**Deviations from §6/§9/§11/§12, each deliberate:** no `usage_counters`
and no rollup of any kind; seven §6 metric names cut and four renamed;
`dau`/`wau`/`mau` replaced by one floor; §6's quota bars → three of five
`included_*`, and only for `mtd`; §6's 80%/100% threshold markers
(`admin-console.md:210`) are NOT rendered, because a threshold marker
implies an action at the threshold and `plans.overage` enforces nothing
(*un-cut: ADR-011 layer 3*); §5.1 prices per rooftop but the allowance is
read per tenant, with `store_count` beside it; §9's `tenant_id` →
`organization_id` throughout, since this schema has never had that
column; §9's "bulk requeue scoped by tenant_id" → an explicit list of at
most twenty ids, because `Queue.retryJobs()` takes no id list and no
filter; §9's "recent deploy version" cut with no substitute; §11's four
F-73 endpoints → five, `GET /api/v1/admin/queues` added deliberately as a
fixed unpaginated enumeration on the `GET /admin/plans` precedent, since
a DLQ browser that cannot list its own queues forces ten calls to draw
one page; the repo law "every list endpoint paginates (keyset)" is
honoured for the DLQ with a POSITION cursor and its own codec, declared
in the response as `paging_basis`; §12's "every mutation writes
`activity_events`" → the retry writes `platform_audit_events` alone,
because four of ten queues carry no organization, one call can span
several tenants, and a tenant-scoped row would have to invent an owner;
and the audit event is `queue.retry_requested`, which records the request
rather than the result.
**Deferred, not invented:** `usage_counters`, `usage_monthly`,
`incrementUsage()` and the two jobs that must land with them;
`dau`/`wau`/`mau` and `seats_active` as §6 defines them (un-cut the day a
sign-in record survives sign-out); `ai_voice_minutes` and
`plans.included_ai_minutes` (un-cut the day a call has a duration);
`api_calls_mtd` and `rate_limit_429s` (un-cut with ADR-011 layer 3 —
today the limiter covers four call sites, stores a token LEVEL under a
PEXPIREd key, and fails open); `intake_ack_p99_ms` (un-cut the day the
intake ACK is timed and the timing recorded); `storage_bytes` as total
storage and `plans.included_storage_gb` (un-cut the day every stored
object records its size); the health card's error count and §9's Sentry
deep link (un-cut the day any error sink is wired — F-72 cut the same
claim as O-33); §9's deploy version and release health; §9's Twilio
number status and Resend DKIM status; §9's webhook delivery log and
manual redelivery; §9's comms log with idempotent resend (a resend is a
send and belongs behind the compliance gate, not behind a support
button); §9's DSAR export trigger and register; `admin_reassign_deal_owner`
and any other named data-correction function; per-tenant DLQ depth and
tenant scoping for the four unscoped queues (un-cut the day every payload
carries `organization_id`); `plans.overage` and `plans.features`
rendering; the analytics doc's tenant health score, adoption matrix and
activation funnel; its tenant-facing `/settings/usage` page; closing
`reassignQueue` in `app.ts`'s `onClose` — a pre-existing leak F-73
neither repeats nor fixes, deliberately not ridden into the exact hook
that produced the tick-26 teardown flake; **a console screen for the
tenant snapshot** — the definer, the contract entry and `GET
/api/v1/admin/tenants/:id/snapshot` ship and are tested, but no page
reads them yet (O-51); and §2's `admin.readyloans.app` host split, still
O-8.
**The scope contingency, recorded because it was decided before the
pressure and not under it:** the retry endpoint was built LAST and was
the first and only thing that would have been cut if
`f73-queue-inspector.test.ts` could not be made deterministic on the
first CI run. The DLQ read does not depend on it, and dropping it would
have cost one contract entry, one capability (`queues:retry`), one audit
value (`queue.retry_requested`, which then comes out of
`PLATFORM_AUDIT_EVENTS` and the 0069 CHECK in the same commit — leaving a
declared event with no producer is the dead-vocabulary failure in
miniature), one definer and one migration block — not the slice.
**Decided by:** Claude (implementation), 2026-08-30

## D-073 — 2026-08-30 — Two kill switches that fail closed, and announcements that name no tenant

F-72 (admin-console.md §3, §5.3, §8, §11, §12;
localization-and-legal.md §2; ADR-007/009/019; designed by the same
three-planner + judge workflow as F-69/F-70/F-71, every contested repo
fact verified live before it was written). (1) **The switches are
rows:** `platform_settings` (0068), `setting_key text PRIMARY KEY CHECK
(setting_key IN ('ai_outbound_killswitch','sms_send_killswitch'))`,
both seeded OFF in the migration so a missing row can only mean
tampering. The app role holds `GRANT SELECT` and nothing else — it
reads a switch on the send path and can never flip one. `reason` sits
on the row only while the switch is ON (`CHECK (enabled = false OR
reason IS NOT NULL)`, ten characters minimum in the Zod input, in
`admin_set_platform_setting` and in the column CHECK), and the definer
NULLs it on resume: "why was sending off at 04:00" then survives only
in `platform_audit_events` (O-31). F-72 ships no flip-history route,
and that is a choice, not an omission. (2) **Not
`webhook_delivery_pause`** (O-28): §5.3 names three switches and this
codebase has a chokepoint for two. There is no outbound webhook
deliverer — `apps/api/src/carrier.ts:198` is the only `fetch(` in
server source, the F-49 connectors are INBOUND mappings, and
`f30-deliver.ts` is the SMS carrier handoff — so the third switch would
gate nothing and be dead vocabulary in a table whose whole purpose is
to be obeyed. 0068's closing paragraph carries its un-cut condition:
one forward CHECK swap and one gate line, the day a deliverer lands.
(3) **What the cache promises, and what it does not** (O-29, O-30):
`apps/api/src/platform-settings.ts` is a per-process single-entry
snapshot with `KILL_SWITCH_TTL_MS = 5000` and a coalesced `inFlight`
promise cleared in a `finally` — the `finally` exists only so a FAILED
read does not wedge the process forever; the rejection still
propagates. Two claims, no more. The read can never silently fall back
to OFF: there is no `try`/`catch`, no default-false, and a key with NO
ROW reads as ON. Propagation is bounded by the TTL, in every process,
and by nothing else: there is no invalidation channel, because
`REDIS_URL` is optional in `env.ts` and a pub/sub broadcast would be a
guarantee that is silently not one on a machine without Redis. §5.3's
"read every request via an LRU cache" is honoured as a TTL snapshot of
two booleans, and the console prints the number rather than implying
that a flip is instantaneous. What is NOT claimed: on a cache HIT —
the overwhelming majority of sends — `killSwitches(c)` never touches
`c`, so this is not "read inside the transaction that records the
send"; only a miss is. The console reads uncached through
`admin_list_platform_settings()`, so a staffer who just flipped a
switch sees the truth and not a five-second-old picture of it.
(4) **Where they bite, and where they deliberately do not:**
`BLOCKED_REASONS` gains `platform_sms_paused` and `platform_ai_paused`
(twelve values), `ComplianceFacts` gains the two matching fields, and
both checks go FIRST in `evaluateSend`, above `ai_suspended` — a dealer
refused during an incident is told the platform's own lever before any
of their own. The SMS arm is `req.channel === 'sms' && ...`: the
channel predicate is mandatory, because `evaluateSend` also decides
`voice` / `ai_outbound_call` sends and a switch the console calls
« Arrêt des SMS sortants » may not refuse an ADAD call. The AI arm is
`req.originator === 'ai'`, so a human advisor's replies keep going
under the AI switch and stop under the SMS one — which both scope
sentences say out loud. A belt in `f30-deliver.ts` refuses at the wire
with `carrier_error = 'platform_paused: sms_send_killswitch'`, so the
guarantee survives the redelivery job that does not exist yet. Email is
NOT gated (O-34): `mailer.send(` has EIGHT call sites (auth.ts:63,
f11-dispatch-routes.ts:257/:456/:683, f12-invitation-routes.ts:83,
f70-provisioning-routes.ts:124/:159, f71-impersonation-routes.ts:69)
and five are credential paths — sign-up verification (auth.ts:63),
invitations (f12:83), owner provisioning (f70:124/:159) and the
support-access notice (f71:69) — that a locked-out operator needs during
the very incident the switch is for. Of the remaining three, two are the
driver-company dispatch request (f11:257/:456), an operational notice to
a third-party vendor, and only f11-dispatch-routes.ts:683
(`customerEtaMessage`) is customer-facing — the named next step. An AI
kill stops the SEND, not the model: `runTurn` still spends tokens and
`AI_TRANSPORT=off` remains the spend switch. (5) **A refused drip WAITS, and the decision is now
structural:** `drip-tick.ts` exports four sets — `OPTED_OUT_REASONS`
(3), `BASIS_GONE_REASONS` (4), `WAITING_REASONS` (3) and
`PLATFORM_PAUSE_REASONS` (2) — with an explicit branch each, and the
new `drip-reasons.test.ts` asserts they partition `BLOCKED_REASONS`
exactly. The behaviour was already `waiting`, but by fall-through, and
"we decided" and "nothing happened to be listed" look identical in a
diff; classifying a reversible platform pause as basis-gone would
`expire` every dealer's sequence during a five-minute incident and
nothing would restart them. The remaining fall-through now calls
`deps.warn?.()`, wired in production at `apps/workers/src/index.ts`
where it had never been passed, and a `platform_paused` rejection from
the belt returns `'waiting'` so the tick's `sent` count cannot report a
send that never left. (6) **"Emits a Sentry event + Better Stack
incident" becomes three real artefacts** (O-33): neither service is
wired into this codebase and F-72 invents neither. A flip writes an
immutable `platform_audit_events` row (`settings.flipped`, the subject
in `changes` as `setting_key` and a `{from,to}` pair, `target_user_id`
NULL — no target columns, the 0065/0067 shape), emits
`request.log.warn(..., 'platform_killswitch_flipped')` — WARN, not
ERROR, because an operator's deliberate act is not a failure and
ERROR-level noise for intended acts is how a drain gets ignored — and
raises `<KillSwitchBanner />`, a standing `role="status"` bar in the
console shell naming every switch that is ON. Only the last two are
read by a human: `platform_audit_events` has seven INSERT sites across the
migrations (0065 ×2, 0067 ×2, this slice ×3 — and since 0067 replaces both
0065 bodies, five of them write on the live schema) and ZERO non-test
SELECT sites in the whole repo. It is a forensic register,
exactly as 0065 shipped it, and describing it as the operator-facing
half of a status-page incident would be a claim no code makes true.
(7) **The switches stay reachable during a support session** (O-32):
`ADMIN_ALLOWED_DURING` gains exactly `'GET
/api/v1/admin/platform-settings'` and `'POST
/api/v1/admin/platform-settings/:setting_key'`. A kill switch with a
prerequisite is not a kill switch — the incident that makes a super
admin open a session is the incident in which they may need to stop all
outbound, and ending the session first costs minutes and their place.
The safety properties survive: the platform gate still runs (identity,
mandatory MFA, the 12-hour re-auth clock), `admin_set_platform_setting`
still asserts `platform_super_admin`, the audit row names the STAFFER
and not the target, and the impersonation gate never swaps
`request.session.user` on an `/api/v1/admin/` route. Publishing has no
comparable urgency, so the exemption is exactly two routes wide and an
announcement published during a session still answers 409
`impersonation_active`. (8) **An announcement names no tenant.**
`platform_announcements` deliberately carries no `organization_id`: the
audience is a jsonb predicate, not a tenant key, so
`rls-coverage.test.ts` — whose catalogue query keys on that column —
does not, and must not, conscript it, and the app role holds no grant
on either announcement table. Vocabulary deviation from §8, deliberate:
the spec's arm is `{"type":"tenants","tenant_ids":[…]}`; this repo says
organization and never tenant (`packages/schemas` is the vocabulary
truth and contains no `tenant_id`), so the arm is
`{"type":"organizations","organization_ids":[…]}` and an unknown
organization in it is `PA026` → 422. ONE predicate serves all three
readers — `announcement_matches(p_audience, p_severity, p_org,
p_plan_tier, p_status)`, `IMMUTABLE`, revoked from PUBLIC and granted
to nobody — carrying the three arms, the tenant-status filter
`('offboarding','purged','suspended')` and §8's marketing suppression
(`past_due`, `read_only`; `trial` is operational and DOES receive
marketing). The feed, the dismiss check and the fan-out therefore
cannot disagree about who an announcement is for; the moment the
console can promise a reach the delivery does not make, the feature
lies to the operator. (9) **Publishing IS creating** (O-36):
`published_at timestamptz NOT NULL DEFAULT now()`, no `status` column,
no draft, no amend, no retract, no revisions table. The only legal
mutation is `POST /api/v1/admin/announcements/:id/end`, which moves
`ends_at` to `GREATEST(now(), starts_at)` — that `GREATEST` is what
makes ending a SCHEDULED announcement legal against `CHECK (ends_at IS
NULL OR ends_at >= starts_at)` — and raises `PA025` the second time.
§11 declares a `PATCH` and §12 declares the history immutable; a
`PATCH` whose only legal body is `{ends_at}` is a PATCH in name only,
and the sub-resource names the act. `platform_announcements_immutable()`
refuses every DELETE and freezes every column but `ends_at` by
comparing `to_jsonb(NEW) - 'ends_at'`, and refuses a widening (`PA022`
→ 409 `invalid_window`). `ends_at` stays NULLABLE: an incident with no
known end is the commonest incident, and forcing the publisher to
invent a time is a worse lie than an open window. (10) **`dismissible`
is derived, never chosen** (O-35): `CHECK (dismissible = (severity IN
('info','marketing')))`. §8 lists it as a column the publisher sets,
but "non-dismissible while active" IS the derivation, and an
announcement outside its window is not shown at all.
`PublishAnnouncementInput` is a `strictObject`, so a client that
supplies it gets a 422 for free, and dismissing a maintenance or
incident notice raises `PA023` → 422 `not_dismissible` in SQL rather
than in a screen. (11) **The status page is a URL, not an opaque id:**
one column `status_incident_url` with `CHECK (status_incident_url LIKE
'https://%' ...)` and a biconditional `CHECK ((severity = 'incident') =
(status_incident_url IS NOT NULL))`. §8 says an incident row must link
the Better Stack status-page incident; an id plus a
`STATUS_PAGE_BASE_URL` env nobody sets renders as inert text — dead
vocabulary with extra steps. A URL has a consumer on day one with no
integration at all: the anchor labelled « Voir l'état du service » and
the person who clicks it. (12) **The tenant feed has nothing to get
wrong:** `announcements_for_user()` takes NO parameters. Its whole WHERE clause
is `announcement_visible(a.id)`, and THAT helper reads the person from
`app.user_id` and carries `impersonation_scope_ok(o.id)` in its
membership join, so calling the feed inside `withUser` gets the F-71
scope for free and a later refactor cannot silently drop the argument
that is not there. `LIMIT 20` lives in the definer, not the route, and
the returned row names no organization, no plan and no audience — a
defect in the matcher could leak a platform-authored message, but never
who else is a customer. `announcement_dismiss(p_id)` likewise takes no
user argument: the dismisser is the GUC. That property is exactly what
makes the F-71 interaction invisible, so `IMPERSONATION_BLOCKED_ROUTES`
refuses `POST /api/v1/announcements/:id/dismiss` in BOTH modes — under
a full session `app.user_id` is the target's, and a staffer would
permanently silence a dealer's incident banner in the dealer's own
name, with no undo. (13) **The fan-out writes one bell row per PERSON**
(O-37): `announcement_fanout_batch` scans and inserts in ONE statement
as the definer's owner, so the worker opens no tenant context at all —
"which people, across every tenant, match this audience" is exactly the
question a tenant-scoped connection cannot ask. `DISTINCT ON
(m.user_id)` gives a person in two matching tenants exactly one row,
filed under the LOWEST matching organization id (deterministic on
replay); the walk is a keyset cursor on `m.user_id` and the job re-arms
itself. Idempotence is a database fact rather than a promise:
`idx_notifications_announcement_once` (partial, on `entity_type =
'announcement'`) plus `ON CONFLICT DO NOTHING`, so a crash mid-batch, a
BullMQ redelivery and a double publish all converge on one row.
`params` carries BOTH titles (`title_en`, `title_fr`) and `bell.tsx`
picks at DISPLAY time, which is what 0051's own header demands: the
spec's per-recipient pre-pick would read `users.language_pref`, which
NOTHING in this product writes (no `UPDATE users SET` anywhere), so it
would ship one language to every rooftop; and two locales with
different ICU argument sets fail the i18n parity gate. `link` is NULL
(`bell.tsx` guards it), urgency is incident→`high`,
maintenance→`medium`, else `low`. Recorded because two slices interact:
0067 rewrote `notifications_self_read` to carry
`impersonation_scope_ok(organization_id)`, so while a support session
is scoped to that person's OTHER organization the bell row is invisible
— the BANNER still shows, because the feed matches any in-scope
membership, and the row reappears the moment the session ends.
(14) **Who:** five capabilities, added in the same commit that enforces
them — `announcements:read` and `announcements:publish` → super admin +
support; `announcements:publish_elevated` and `settings:write` → super
admin alone; `settings:read` → super admin + support; billing none,
because §3 gives billing no incident duty and every role in a
capability array is a claim about who may do what. §3's "support
publishes info only" is enforced TWICE: two literal `requirePlatform(
request, '…')` calls in the publish route with no ternary — the drift
guard reads them as written — and a role re-check inside
`admin_publish_announcement` raising the EXISTING `PA009` (403), since
one SQLSTATE maps to exactly one AppError. The `end` route asks
`announcements:publish` and leaves the severity rule to the definer
alone, because the severity is unknowable before the row is read and an
admin route file may not name a role. (15) **Guards:** platform-drift
scans both `f72-announcement-routes.ts` and `f72-killswitch-routes.ts`,
pins the new grants (`platform_settings` SELECT only; nothing on either
announcement table) and puts THREE CHECK vocabularies in lockstep with
the schemas — `platform_settings.setting_key`,
`platform_announcements.severity`, and `PLATFORM_AUDIT_EVENTS` against
the widened `platform_audit_events.event` CHECK (platform-drift.test.ts:162).
That last one is the Zod↔CHECK binding, and it is the only one: the new
`platform-event-vocabulary.test.ts` never names `PLATFORM_AUDIT_EVENTS`
at all. It does the other half — CHECK↔producer, one direction — by
reading the LIVE constraint, stripping the constraint spans out of the
migration corpus (and asserting the strip worked, so the guard cannot go
vacuous) and requiring every value the CHECK declares to appear inside a
surviving `INSERT INTO platform_audit_events`. `outbound-chokepoint.test.ts`
pins the facts the belt argument rests on, over a scan asserted not to be
looking at nothing: `sendMessage` as the only writer of an outbound
`messages` row, `f30-deliver.ts` as the only holder of `carrier.send(`,
each gated stager still reaching the gate, every `deliverMessage`
downstream of a gated send — that one PER CALL SITE, with crash-recovery
redelivery registered as a named exemption rather than waved through —
and `killSwitches(` read in exactly four files. The two `holders()`
checks are file-granular by construction, which is a limit worth knowing
before the next redelivery worker lands;
`drip-reasons.test.ts` pins the partition; `tenant-lifecycle-drift.test.ts`
now also regexes `announcement_matches`, so the status list lives twice
and drifts nowhere; and `contrast.test.ts` gains two pairs that real
components already ship and no test read. Their provenance differs, and
the difference is the interesting part: `['caution-text','caution-bg']`
is the be-back ramp `tokens.ts:59` CLAIMED was "AA-gated ... 8.0:1
light, 10.9:1 dark" — measuring it found 6.38:1 and 9.52:1, and that
comment is corrected in this commit (8.0:1 was never reachable in light;
the best any caution pairing manages is 6.85:1, on card).
`['foreground','muted']` is the neutral status row F-72 gives `info` and
`marketing` announcements — `tokens.ts` never claimed anything about it;
it had simply never been listed. Both found by this slice, not used by
it. F-72 adds NO RLS policy of any kind and no entry to any PRE-EXISTING
exemption registry; the exemptions it does declare live in `EXEMPT_SITES`
inside the chokepoint guard it writes itself, each carrying its reason
and the source literal whose disappearance retires it. **Deviations from
§5.3/§8/§11/§12, each deliberate:** `webhook_delivery_pause` is not
declared; no Sentry event and no Better Stack incident (an audit row, a
WARN line and a console banner); "an LRU cache read every request" → a
5-second per-process TTL snapshot with no invalidation channel;
`tenants` / `tenant_ids` on the wire → `organizations` /
`organization_ids`; §11's `PATCH /:id` → `POST /:id/end`; `dismissible`
derived from severity rather than supplied; the status-page link is a
URL the publisher types, not an incident id resolved from an env var;
the bell row carries both titles and the viewer's locale picks;
§8's display window is "rendered tenant-local" in the spec but renders
through `Intl.DateTimeFormat(i18n.language, …)`, i.e. in the VIEWER'S
browser timezone, not the tenant's `stores.timezone`; the 21st
simultaneous announcement is not returned and the client is given no
"more exist" signal; email is gated by nothing. **Deferred, not
invented:** an outbound webhook deliverer and its pause; an email kill
switch (`Mailer.send` returns a bare boolean and has no decision row or
refusal vocabulary, so a gate would be indistinguishable from an SES
failure); a flip-history route or any console reader of
`platform_audit_events`; an audience-preview endpoint and a recipients
list (the console shows a count of the rows that exist); a
draft/amend/retract lifecycle; a tenant-authored or tenant-scoped
announcement; a Redis invalidation channel; the store timezone in the
banner; a model-spend switch beyond `AI_TRANSPORT=off`; a tenant-facing
kill-switch banner (a `maintenance` announcement is what tells every
dealer the platform is paused).
**Decided by:** Claude (implementation), 2026-08-30

## D-072 — 2026-08-27 — Impersonation with audit: a register row on the staffer's own session, scoped by the database

F-71 (admin-console.md §3, §7, §11, §12; authentication-authorization.md
§3/§12; multi-tenancy.md §6; ADR-006/007/009; designed by the same
three-planner + judge workflow as F-69/F-70, every contested repo fact
verified). (1) **What a session IS:** a row in `impersonation_sessions`
(0067) bound to the staffer's own Better Auth `"session".id`. No session is
minted for the target, no cookie changes hands. An onRequest gate
(`impersonation.ts`, between the session gate and the platform gate) asks
`impersonation_identity(session id)` once per authenticated request; when
a live row exists it applies the refusals, records the session on the
request, then swaps `request.session.user` to the target for every
non-admin route — `sessionUser`, `withUser`, `withTenant`, the membership
gates, `has_permission`, `/api/v1/me` and `recordEvent` all see the target;
`request.session.session` stays the staffer's (the platform gate's identity
and 12-hour clock). (2) **Not the Better Auth `admin` plugin** (O-17),
read from the installed 1.6.25: its authority is a `user.role` column
beside `platform_staff` (D-070 (1)/(3) keep staff identity in one table
and authority in capabilities); it mints a REAL target session and hands
the staffer's own token to the browser in a second cookie, so the target's
`/api/auth/*` (password, 2FA, session revocation) would become reachable
by the staffer and the staffer's socket would mark the target online; it
ships fifteen endpoints this product must not expose; it carries none of
§7 (scope, mode, reason, ticket, TTL, register, owner notification) and
hides impersonated sessions from the target — the inverse of §12.
(3) **Not a signed token:** a client-held claim to forge, expire and
revoke; the row is revoked by one UPDATE. The spec's "session cookie
carries impersonation_id" (§7) is a named deviation: the server-side row
is the claim. (4) **Who:** `impersonation:start_read_only` → super admin +
support; `impersonation:start_full` → super admin (§3, §7); `impersonation:
manage` (register, End, member picker) → super admin + support; billing
none. The route asks two capability literals (no ternary — the drift guard
reads them as written) and the definer re-checks the role per mode.
Reason ≥ 20 characters (Zod AND a column CHECK), ticket ≤ 60, mode default
`read_only`; target must hold an active membership in the named tenant
(else 404 — no oracle), must not be active platform staff (403), tenant
must be `active|trial|past_due|read_only` and undeleted (409); one live
session per staffer session (partial UNIQUE → 409); two staffers may
impersonate the same person at once, separately audited (O-21). Owners
are notified, not asked (O-24): an in-app bell row per active owner inside
the start transaction and an email after commit (O-18). (5) **The
tenancy boundary is decided by the database** (O-22): a new GUC
`app.impersonation_org`, set by `withContext` from a per-request
`connectionScope` (AsyncLocalStorage in `packages/db`), read by
`impersonation_scope_ok()` inside `membership_self_read`,
`membership_isolation`, `notifications_self_read/_update` and
`has_permission` (SECURITY DEFINER bypasses policies, so it carries the
predicate itself). A multi-organization target is impersonated in ONE
organization; `callerOrgIds`, `GET /organizations`, by-id reads,
notifications and `has_permission(otherOrg, …)` all answer "not a member"
for the rest. Belt and braces in the gate: a request naming another
`organization_id` is 403 `impersonation_scope`. Workers open no scope
store and stay unfiltered. (6) **Refusals, and where:** the console is
closed during a session (409 `impersonation_active`) except `GET
/admin/me` and the End (O-27); `POST /organizations` and `POST
/invitations/accept` are refused in both modes (they would move authority
into the target's account); read-only mode refuses every verb outside
GET/HEAD/OPTIONS except the read-only-exempt routes (403
`impersonation_read_only` — the spec's `IMPERSONATION_READ_ONLY` in this
API's envelope vocabulary); `IMPERSONATION_BLOCKED_PERMISSIONS` (O-19:
organization update/delete, invite/roles/revoke, intake keys, pay plans,
document signing, safety sign-off, customer replies) are refused in
EVERY mode by `requirePermission`/`hasPermission` after the membership
gate — wider than §7's four because §7's "PII decrypt / billing / export
without DSAR" have no producer yet (deferred, hook named); a `read_only`
tenant still answers 402 to full-mode writes; the auth mount is public and
never impersonates, so the staffer's credentials stay the staffer's.
(7) **Ends:** 60-minute hard TTL, no refresh (`IMPERSONATION_TTL_MINUTES`
in core, passed INTO the definer; the gate closes an expired row lazily
and answers 403 `impersonation_ended` once); `DELETE …/:id` by the owning
staffer or any super admin (`manual`, `ended_by`); an `AFTER DELETE ON
"session"` SECURITY DEFINER trigger (sign-out, expiry cleanup → `revoked`,
unsigned); `platform_staff_revoke` and `admin_set_tenant_status
(suspended|offboarding)` close explicitly BEFORE their session deletes
(`revoked`, signed); the gate re-proves standing on every request — staff
revoked, tenant deleted or out of status, target's membership gone →
`revoked`. `active` is always computed (`ended_at IS NULL AND expires_at >
now()`). (8) **Audit:** `impersonation_sessions` (tenant-readable through
the org-keyed policy, SELECT grant only, UPDATE may only close a row
once, DELETE refused — trigger); `impersonation_requests` (one row per
request served under a session, refusals included, written from an
onResponse hook, no app grant, immutable — O-23: the URL with its query
is stored, platform-internal); `activity_events.impersonation_id` (+ a
CHECK that it rides only on platform/system rows): `recordEvent` flips a
person's act to `actor_type='platform'` with `actor_user_id` = the
impersonated user and `impersonation_id` = the session — attributed to
BOTH, one register; start/end are `impersonation_session created/updated`
rows (no new verb — the D-071 (7) precedent; the `f10` dead-vocabulary
guard learned `SQL_PRODUCED_ENTITIES` for an entity only SQL writes);
`admin_tenant_events` names the staffer (`impersonator_email`);
`platform_audit_events` untouched. (9) **Realtime and workers:** the
staffer's socket is the staffer's (no membership → `not_a_member`), so no
rooms, no presence, no cascade side effects (O-25); full-mode writes fire
the tenant's normal automations (O-26). (10) **Console and tenant app:**
nav "Sessions de soutien" (register with URL filters, one session's
trail), a "Session de soutien" section on the tenant page (member picker
marking platform staff, mode with its effect spelled out — `full` only
with the capability —, a reason with a live count, ticket), the console
as a wall with the End while a session is live, the §7 banner in the
tenant shell from `/api/v1/me` (which answers as the target), the
register on `/security` ("Accès du soutien" — the spec's
`/settings/security/support-access`, no `/settings` router exists), the
timeline suffix "via une session de soutien" and the journal's
"{staff} (soutien) au nom de {user}"; the "mine" filters on leads and
tasks now read `useMe` (the server's identity) instead of the raw auth
session. (11) **Guards:** platform-drift scans `f71-impersonation-routes.ts`;
rls-coverage classifies user-keyed policies with the scope call stripped
and asserts the registry in BOTH directions (a scoped `membership_self_read`
would otherwise have dropped out silently); dead-column registers the
definer-written register columns; the f71 suite (20 cases, incl. the
body-addressed scope refusal and a mid-session re-role) proves the
gate, the birth and its notifications, acting as the target, read-only
and scope refusals with the raw predicates, full-mode attribution and
blocks, TTL and every revocation path, transparency, immutability, the
definers' actor checks and the core↔schemas lockstep. **Deviations from
§7/§12, each deliberate:** no admin plugin; no cookie claim; `tenant_id`
on the wire → `organization_id`; "every request writes activity_events" →
every MUTATION stamps `activity_events` and every REQUEST writes
`impersonation_requests`; `DELETE` answers 200 + the closed row; the
console is closed during a session; no realtime rooms; a wider blocked
list; in-app notification as well as email; only tenants with standing;
no platform-staff targets; the auth spec's `entity_type='auth'` rows have
no producer; the owner email is bilingual FR-then-EN (the
invitationMessage / Bill 96 precedent), not ordered per tenant locale. (12)
**Amends D-070 (4):** a support session is the ONE place platform staff
hold tenant context, and only through this gate. (13) **The scope belt is a
preHandler** (a request body does not exist in onRequest, so the
body-addressed check lives where the body is parsed); the database scope
(`impersonation_scope_ok` in the policies and `has_permission`) is the
boundary the belt merely names earlier. **Deferred, not invented:** PII decrypt / billing / export
blocks (no producer), `platform_audit_events` impersonation events, the
`'ai'` actor, a purge/retention job for the trail, a tenant-side End, a
rate limit on session starts, a Sentry alert on start, the cookie hint
optimisation, the Playwright journey (e2e-breadth).
**Decided by:** Claude (implementation), 2026-08-27

## D-071 — 2026-08-27 — Tenant provisioning: one birth, the self-serve seeds, an F-12 owner seat, no prospect

F-70 (admin-console.md §4.2–§4.4, §11–§12; ADR-006/007/024/026; designed by
the same three-planner + judge workflow as F-69, every contested repo fact
verified). (1) **No `prospect`.** Provisioning is ONE transaction, so the
state §4.3 calls prospect is never observable without Stripe; adding a
status nothing can hold is the dead-vocabulary bug D-070 (7) named (it
would touch the 0001 CHECK, the core matrix, `tenant_transitions()`,
`refuseByStatus`, `callerOrgIds`, both scans, four `satisfies` maps and
both locales). It arrives when Stripe makes provisioning two-phase; 0066
rewrites the `organizations.status` comment that promised it. (2) **Trial
without Stripe** = status `trial` (already operational) + a new
`organizations.trial_ends_at` stamped `now() + TRIAL_DAYS` (14, in core
beside `GRACE_PERIOD_DAYS`, passed INTO the definer so there is one number).
No expiry job: the console shows the date and an "(ended)" marker;
`trial → active/suspended` stay the manual super-admin transitions;
`activated_at` stays NULL until the first entry into active. (3) **The birth
is one SECURITY DEFINER call on the bare pool** (`admin_provision_tenant`,
0066): organization, stores, role matrix, lost reasons, per-store
checklists, the owner's invitation and the audit rows commit together or
not at all; the route file holds no tenant helper and no tenant-role
literal (`'owner'` lives in SQL). Every organization_id / store_id it writes
comes from RETURNING, never from the payload (mutation-tested). (4) **Seeds =
exactly what self-serve seeds**, fed as jsonb from the canonical TS lists
(`DEFAULT_ROLE_PERMISSIONS`, `LOST_REASON_DEFAULTS`, checklist `CANONICAL`)
so SQL never carries a second copy (the 0055 frozen-copy lesson); a lockstep
test proves an F-70 tenant equals an F-01 organization + F-01 store row for
row. Nothing else: no users/memberships, no `tenant_branding` or
`tenant_comms_config` row (absence IS the default), no business rows, no
intake keys, no rules. (5) **The owner seat is an F-12 invitation** (roles
`{owner}`, org-wide, 7-day TTL, SHA-256 only), sent through the existing
`invitationMessage` AFTER commit; the token mechanism moved to one module
(`invitation-token.ts`) that both issuers import (a lockstep test greps it);
`accept_url` is returned only when the transport cannot reach the invitee
(the CR-05 rule). Acceptance is untouched F-12: the owner lands in a working
tenant with the matrix, the pick-lists and the checklists already there.
(6) **Idempotent on slug** (§4.3): `PA011` with DETAIL = the existing
organization id → 409 `slug_taken`, `details[0] = {path:'slug',
code:'slug_taken', message:<id>}`, and the console links to it. A
soft-deleted organization still holds its slug (UNIQUE regardless of
`deleted_at`, O-13). A lost race on `organizations_slug_key` is converted to
the same PA011 inside the function (proved two ways: two concurrent POSTs
for the outcome, and a held uncommitted row that forces the loser past the
pre-check into the EXCEPTION branch).
(7) **Audit** = `activity_events` rows organization/store×N/invitation
`created` with `actor_type='platform'`, `restricted=false`, `{field:{from,to}}`
shapes — no new verbs (§12): the tenant's own feed renders them as any
other row, and the console journal names the verb and the entity on every
row (review: a revoked seat with empty changes had read as "Système"; it
now names the address that lost the seat); `platform_audit_events`
untouched. (8) **Capability**
`tenants:create` → super admin only (§3 "Create tenants"), enforced by BOTH
endpoints: the second, `POST /admin/tenants/:id/owner-invitation`, re-issues
the seat (revokes every open owner seat and any open invitation to that
address, sends a new link, journals `revoked` + `created{reissued:true}`) and
is refused with 409 `owner_exists` once an owner is active — without it a
mistyped or unopened owner email would orphan the tenant, because F-12's
tenant path needs `member:invite` and a fresh tenant has no members. It is
the same authority finishing a provisioning, not a second one. (9) **The
platform-drift guard owns the admin route file list** (`ADMIN_ROUTE_FILES`)
and asserts that every `f*-routes.ts` serving `/api/v1/admin/` is on it — a
new admin file that silently escaped the guard would be the worse blind
spot. (10) **Deviations from §4.3, each deliberate:** `organizations` IS the
tenant (`display_name` on the wire → `organizations.name`); the 201 returns
`{ tenant: AdminTenantDetail, invitation }` (the F-69 return-the-detail
pattern) rather than the flat `{tenant_id, slug, invite_id}`; the owner
invitation is an F-12 invitation, not a Better Auth org invitation (D-025);
no default `tenant_branding` row; the repo's ten bilingual lost reasons ship,
not the spec's nine keys (O-16); store locale inherits the tenant's (§4.3's
store body has no locale); no Stripe customer/subscription, entitlement
cache or PostHog group identify (§4.3 steps 4–6, 8). (11) **Deferred, not
invented** — every §4.4 catalog without a table or producer today: fee
catalog, F&I product catalog, pipeline colours/aging thresholds, lender
list, message templates, notification/automation rules, store thresholds
(`aging_threshold_days` etc. — write-less columns trip the dead-column
guard); plus Stripe, `prospect`, PostHog, an owner-specific invitation
email, unifying the F-01 seed helpers with the definer through one SQL seed
function (the lockstep test guards the two writers meanwhile), bulk data
onboarding (migrations-operations.md §6.4 — after provisioning, by spec),
the Playwright console journey (e2e-breadth slice). (12) **Console:** one
form in three fieldsets (organization / owner / stores, one nested fieldset
per store, max 20), suggestions the staffer overwrites (slug from the name,
code from the store name, timezone and locale from the province), the
server as the validation layer with every 422 tied to its field — the
timezone check names `stores.<i>.timezone`, the duplicate code names
`stores.<i>.code`, ALL refused fields at once (`ApiError.detailPaths`) —
plus a focused summary that links to each input, blank required fields
refused client-side by their LABEL (never a wire path), a picked timezone
that survives a province change, errors that follow their store row when
one is removed; the
result rendered in place (the accept link exists only in that response);
a capability-gated "New tenant" link and a "Trial ends" column in the
directory; trial-end and owner-seat facts, the reissue dialog and the
accept-link block on the detail page; journal rows show plain facts as
themselves rather than "— → —".
**Decided by:** Claude (implementation), 2026-08-27

## D-070 — 2026-08-26 — Platform console, slice 1: staff identity, tenant lifecycle, and the platform/tenant boundary

F-69 (admin-console.md §2–§5.1, §11–§12; ADR-006/007/024; designed by a
three-lens panel + judge, verified against the repo). (1) Platform staff
are a `platform_staff` row on a Better Auth account — NOT a membership in
a reserved organization: a membership IS tenant RLS context (0003), which
§2 forbids for staff, and the roles CHECK admits only the ten tenant
roles; the platform's own slugs are reserved so no tenant can squat them.
(2) `organizations` IS the tenant (multi-tenancy.md §3): §4.1's columns
(`legal_name`, `province`, privacy officer, `plan_id`, `activated_at`,
`suspended_at`) land there; no 1:1 `tenants` table. `plans` is the §5.1
catalogue seeded with the reference tiers; `plan_tier` becomes a
trigger-maintained cache of `plans.code` because ~60 readers use it.
(3) Authority in routes is a CAPABILITY, never a role name; only the six
capabilities slice 1 enforces exist, and a drift guard fails on one nothing
enforces. (4) Platform staff never receive tenant context OUTSIDE an
impersonation (amended by D-072: inside a live, audited support session the
staffer's request runs AS the target under tenant context, scoped to one
organization by `app.impersonation_org`): every read and write is a
SECURITY DEFINER function on a bare pool connection that re-checks the
actor itself; a lockstep test greps the route file for the tenant-scoped
helpers. The definers rely on the OWNER bypassing FORCE RLS
(superuser locally; BYPASSRLS on RDS — `definer-owner.test.ts` asserts it);
`set_config('app.org_id', …, true)` inside a function was rejected because
it would outlive the function. (5) The gate (identity → MFA enrolment →
session age) runs before any /api/v1/admin handler; non-staff get 404,
never 403. "TOTP on every request" is realised as: enrolment read per
request, sessions minted through the challenge, `trustDevice` refused at
the auth mount for every account (O-1), and a 12-hour re-auth cap
(`ADMIN_SESSION_MAX_AGE_HOURS`, O-2) on `"session"."createdAt"`, which
Better Auth never refreshes. (6) Audit: tenant-scoped platform acts go to
`activity_events` with `actor_type='platform'` (§12 transparency — the
tenant sees them, except rows flagged `restricted`); platform-scope acts
(staff grants) go to an immutable `platform_audit_events`; no new action
verbs. (7) Lifecycle: ONE matrix in core mirrored by `tenant_transitions()`
and diffed by a guard; the definer refuses illegal pairs itself, with a
compare-and-swap on `expected_from`; no `prospect` until provisioning has
a producer, `churned` = `offboarding` then `purged` (the retention job,
never a console act — ADR-024); `suspended → active` and `offboarding →
active` added for wrongful actions; the Stripe-driven pairs are manual
super-admin transitions until the billing slice. (8) Suspension deletes the
tenant's members' sessions (O-6, blunt: multi-org staff re-sign-in), intake
answers 410 AFTER the signature verifies, and a suspended or closing
tenant is invisible to implicit org resolution. (9) `read_only` turns every
mutating VERB into 402 `payment_required` — decided by the method through
an AsyncLocalStorage request context, because five GET routes ask a write
permission — with an exemption list that names its reasons; enforced in
both membership gates AND a preHandler for every request that names an
organization (the F-69 suite showed a suspended owner could still list
leads through a withUser list route). (10) Outbound automation pauses for
non-operational tenants: the definer scans filter in SQL, the event-driven
workers ask `tenantOperational` before spending; `read_only` keeps receiving
intake leads (O-4) and task reminders. (11) Same-origin `/admin/*` until the
host split (O-8); the console shell never mounts BrandStyle. (12) Bootstrap:
`cli.js platform-grant <email>` opens only while no active super admin
exists (O-9). Owner placeholders: storage GB and enterprise price (O-3).
**Review amendments (45 agents, 31 confirmed):** (13) the `trustDevice`
refusal — and the per-email sign-in limiter — match the NORMALISED
pathname, because Better Auth routes on it and `/two-factor/./verify-totp`
walked past a raw-url regex (blocker); verify-otp is covered too. (14) The
last-super-admin rule applies to DEMOTION as well as revocation, with the
surviving rows locked FOR UPDATE (the F-04 discipline) — demoting yourself
locked the console and reopened the bootstrap. (15) The realtime subscribe
authorisation is a membership gate like the HTTP ones: a suspended or
closing tenant's rooms are closed. (16) live-analysis and ai-extraction
gate on `tenantOperational` too — an inbound reply must not buy a model
call for a tenant that is not paying. (17) "Waits" means a retry: a
non-operational tenant's first touch is re-enqueued hourly, and a deferred
send sleeps another hour under the same deferral cap as quiet hours,
instead of being dropped. (18) The directory search is text: `%` and `_`
are escaped. (19) `activated_at` is stamped for organizations born active;
a soft-deleted tenant offers no transition; `seq` crosses the wire as a
number; a malformed staff id is a 404, not a 500; the past_due banner
exists; product copy no longer promises an export that does not exist yet.
(20) Console: URL-keyed filter inputs, an honest "shown" count, no
client-side sorting of a partial page, 409s refetch the tenant, plan
changes confirm in the same dialog as everything else, journal rows spell
out every field as from → to in the reader's words, store/staff statuses
are labelled, self-revocation is explained in text rather than a greyed
button, focus is parked after a transition or a revoke, the MFA wall is
page content rather than an alert, transient probe failures show a retry
instead of ejecting staff, and the re-auth deadline carries its date.
**Decided by:** Claude (implementation), 2026-08-26

## D-069 — 2026-08-26 — Tasks: one table, the subject's permission, and reading as acknowledgement

F-68 (appointments-tasks-communications.md §3.3 Target, §2.4, leads.md
§10.1). (1) ONE `tasks` table with a polymorphic subject replaces the
legacy's two disagreeing systems (`lead_tasks` vs `tasks` — audit defect
#11); the spec's `inventory` subject is spelled `vehicle`, the word every
other vocabulary here already uses for that row. (2) No `task:*`
permission: a task carries no authority of its own, so the permission is
the SUBJECT's — lead/contact work needs lead:update, deal work
deal:update, vehicle work vehicle:update (F-38's precedent). (3)
`store_id` is copied from the subject at creation, so the F-55 store-scope
discipline works on tasks without a join per row; a contact with no store
must be given one. (4) Buckets (overdue / today / week / later / undated)
are computed server-side, per task, in that task's STORE timezone —
"due today" is the store's today, and a Vancouver rooftop in a Montréal
group keeps its own midnight. (5) `completed_at` IS the completion fact
and travels with the status under a CHECK; the trail records
`task_completed` under the subject, so a lead's history shows its
follow-ups. (6) The §2.4 automations run INSIDE the appointment's
transaction (the legacy's "best-effort, failures logged" was a task that
sometimes did not get made), deduped by (appointment, source) rather than
a title `ilike`; titles are written in the store's `default_locale`; "did
a deal result" reads the lead's deals because 0037 appointments carry no
deal; there is no contact auto-promotion because 0037 appointments carry
no contact either. (7) The 15-minute sweep scans through a SECURITY
DEFINER id-only function (the drip precedent) and works one small
transaction per task: overdue → the assignee and the store's sales
managers; ten minutes later, unless SOMEBODY READ an overdue alert for
that task, → the GM (owner where a rooftop has none). Reading is the
acknowledgement — the bell already records it, and a separate button
would be one more thing to forget. `overdue_notified_at` /
`escalated_at` make each alert fire once. The rule (who, and after how
long) is code-seeded until the automation-rules module gives tenants the
dial — the spec calls it a seeded automation rule. (8) Bulk operations
cap at 50 ids and report rows ACTUALLY changed. (9) The board is bounded
(200 + truncated, F-38's precedent), open first, due ascending, undated
last (§3.1).
**Review amendments (same day, 20 confirmed findings):** (10) the store
cut is a BOARD cut — a record's own task list (subject filter) follows the
record's visibility, because leads are org-wide readable and a store-bound
manager scoped out of a lead's follow-ups was minting duplicates behind a
false "no follow-up scheduled"; (11) bulk endpoints prove the caller's
membership BEFORE any query — a 200/404 difference on a body-supplied
organization_id was a task-id and membership oracle for strangers; (12)
revoking a member releases their OPEN tasks in F-04's cascade, and the
sweep's recipients query refuses a non-member assignee outright — a
revoked person's bell must never carry the old organization's customer
names; (13) the definer scan orders by age across tenants, not by
organization, so one tenant's poison rows cannot starve the rest, and the
worker logs each failure; (14) PATCH change detection goes through
activity.diff() (pg returns Dates) so a re-sent due_at is not a change;
bulk complete records the status it actually left; (15) the automation
owes nothing for a soft-deleted lead; (16) the board: selection is
reset/pruned with the list, bulk sends 50-id chunks and adds the counts,
row actions surface errors and park focus on a status line, closed
(completed OR cancelled) rows offer Reopen, the panel uses buttons rather
than a checkbox that snaps back, the alert bar says when it failed, and a
notification's deep link `?task=<id>` opens the whole team's board.
**Spec-fidelity pass (the finder re-run, 23 confirmed):** (17) the sweep's
stamps mark one overdue EPISODE — rescheduling or reopening clears them,
and the definer scan escalates only a task that is still overdue now; (18)
"did a deal result" reads the lead's LIVE deals (a deal lost in June is
not August's visit) and the (appointment, source) dedupe is for ever, not
only while the first task is open; (19) the automation's task lives in
the LEAD's store and is assigned only to an active member — the
appointment's agent, else the lead's owner, else nobody; (20) a lead
merge (F-54) and a contact merge (F-36) re-point tasks with the record,
and deleting a lead cancels its open follow-ups; the sweep also stamps
and skips a task whose subject is gone; (21) the summary CTE is narrowed
to open rows before bucketing so the alert bar uses the open-by-assignee
index; (22) every task carries `subject_label` — the customer's name, the
vehicle, the deal's lead — computed in the read CTE, because a board of
rows that all read "Lead" names nobody; (23) the board: org-aware alert
links (`&org=`), a real session-pending guard, an explanation when the
linked task is not on the cut, meaningful Priority/Due sorts,
indeterminate select-all, and task mutations refresh the lead's History.
**Decided by:** Claude (implementation), 2026-08-26

## D-068 — 2026-08-22 — Heatmap: the store's clock, and only channels that exist

F-67 (reports-analytics.md §11 Target). (1) STORE-level and SQL-side, as
the Target demands — the legacy drew one lead's timeline in the browser.
(2) Bucketed in the STORE's timezone (`created_at AT TIME ZONE
stores.timezone`), because "Tuesday 7pm" is the store's Tuesday; the
response names the zone it used, and a multi-store cut takes the first
store in scope. (3) Best contact times rank by INBOUND volume — when
customers answer is what the outbound-call scheduler (ADR-020/022's
quiet-hours-aware time picking) will read. (4) The filter is the column's
own vocabulary — `inbound / outbound`, absent meaning both; the
enum-vocabulary guard refused an 'all' sentinel on first gate, exactly
as it did in F-53 — and SMS is the one channel that exists, so the
legacy's call/email chips would be dead vocabulary here; they arrive
with the voice and email modules. (5) Cells carry their numbers in an
accessible label; the five-step intensity is a glance, never the fact.
(6) Same report:view + membership store-scope discipline as F-55/65/66.
(7, review) A send the carrier REFUSED (`carrier_error` set) is not
activity — it reached nobody — and is excluded from every cell; inbound
rows have no carrier verdict to fail. (8, review) Store timezones are
region/city IANA names only: `pg_timezone_names` also accepts 'EST',
'MST', 'Factory' and 'Etc/GMT+5', which carry no daylight rule and
would bucket every summer message an hour early — `assertKnownTimezone`
(the F-42 door) now refuses them for every store write. (9, review)
The grid is a real table — headers name the day and hour, busy cells
carry their counts as text, empty cells are empty — rather than 168
`role="img"` sentences; the busiest steps use the `success-foreground`
ink the contrast test gates, and a cut with no replies says so instead
of heading an empty best-times list.
**Decided by:** Claude (implementation), 2026-08-22

## D-067 — 2026-08-22 — Leaderboard: real keys, canonical stages, one speed scale

F-66 (reports-analytics.md §10). The legacy joined salespeople to deals by
case-insensitive NAME and to users by fuzzy scoring ("startsWith + space →
80") — this rebuild ranks over deals.salesperson_id and leads.assigned_to
and ports the INTENT while fixing every defect §10 documents about
itself: closed means the canonical delivered/complete stages; response
time is the F-24 stamp (mean of response_time_seconds) shown in the lead
module's 5/15/30-minute bands, not the leaderboard's contradictory
1h/4h scale; conversion is closed deals over leads assigned in the
period; the page is FR/EN. Money columns sum over the CLOSED subset only
(sales, total_gross, F&I reserve), sorting defaults to delivered gross,
medals are decoration over an explicit rank number, and the report rides
report:view with the F-55 membership store-scoping.
(review, 11 agents, 4 confirmed / 5 refuted) Rank ties break on name
then id — Postgres hash-aggregate order is unspecified and gold/silver
swapped between refreshes. Delivered money and the closed count are
windowed by COALESCE(delivered_at, created_at) — a car delivered in
August is August's, whatever month the paperwork opened — while the
deal COUNT stays on created_at; the two verifiers split on this and
product sense settled it. Names come from the RLS-scoped users table
joined to ACTIVE memberships of this org — reading Better Auth's global
"user" table named a stranger from another dealer group whenever a
foreign id sat on a deal — and non-members never rank; the root cause is
closed too: F-05 now refuses a salesperson_id that is not an active
member (POST and PATCH, 422 not_a_member). The store-scope block has its
own test on this endpoint.
**Decided by:** Claude (implementation), 2026-08-22

## D-066 — 2026-08-22 — Source ROI: cents-native, store-honest, enum-tight

F-65 (expenses-accounting.md §10, reports-analytics.md §8). (1) The spend
ledger is INTEGER CENTS — the legacy stored dollars here and its own gap
table calls the unit-mixing a hazard; the UI converts at the edge. (2)
`source` rides the ONE LeadSource enum, which makes the legacy's seeded
facebook/google_ads-outside-the-CHECK drift impossible by construction.
(3) One row per (source, month, store) via UNIQUE NULLS NOT DISTINCT —
PG16 — so an org-wide row is as unique as a store's; POST is the §10
upsert. (4) The report fixes the legacy's own flagged gap: STORE-scoped,
and STRICTLY so (a store cut counts that store's spend rows only, never
org-wide rows — mixing scopes would double-count the moment both exist).
(5) Revenue is the GROSS sale price (§8's emphasis) of the converted
lead's EARLIEST live deal; ROI is NULL when spend is zero because 0/0 is
not a 0% return; every other zero-denominator guards to 0 per §8. (6) The
page mirrors win/loss (numbers over pictures, band names in text beside
the badge colors) and both report pages carry tabs to each other under
the single Reports nav item.
(7) The review (13 agents, 10 confirmed / 1 refuted) caught two blockers
the golden numbers missed: `?? '90 days'` silently swallowed period=all's
NULL interval (all-time was a quarter), and conversion counting used
status alone where F-55's WON clause is status OR a live deal — the two
reports disagreed about the same lead the moment a deal was linked late
or a status drifted. Also fixed: the report now carries F-55's
membership store-scoping (a store-bound sales manager sees their stores,
a foreign store_id is a 404), the ledger list is keyset-paginated (the
legacy's silent-truncation class), re-posting spend without a note keeps
the note, the editor's month defaults from LOCAL date parts (UTC rolled
to next month at 20:00 Eastern on month-end) and can target a store, and
the ROI badge names its band in text beside the color.
**Decided by:** Claude (implementation), 2026-08-22

## D-065 — 2026-08-22 — The QA judge observes; it cannot act

F-64 (compliance-and-quality.md §9). (1) The nightly judge scores 100% of
the day's closed conversations against the six-dimension rubric — and the
ARITHMETIC is code, not model output: weights, the 2dp mean, and the rule
that a compliance score of 1 caps the overall at 1.00 and forces the
'compliance' flag all live in qaOverall(), because a rubric a judge can
charm its way around is not a rubric. (2) Observation only, structurally:
the worker holds INSERT on conversation_qa_reviews and nothing else — no
send path, no conversation writes, no lead writes. (3) The scan is the
0060 cross-tenant SECURITY DEFINER shape (ids only, 36h self-healing
window, per-conversation idempotency via a partial unique index checked
BEFORE the model spend, §13 metering on the row). (4) Alerts ride the
D-045 escalation ladder's first person: HIGH on any compliance flag,
same-day; MEDIUM when the 7-day tenant average sits under 4.2 with n≥5,
at most once a day — a floor over three conversations is noise. (5)
Deferred to the QA console slice: the human 10%+flagged review surface
(reviewer_type 'human' is ready for it) and the monthly Cohen's-κ
calibration. The judge model is env-selected (AI_JUDGE_MODEL,
Opus-class per §9).
(6) The review (17 agents, 12 confirmed / 3 refuted) rebuilt the judge's
EYES: qaTranscript keeps head AND tail with an omitted-middle marker —
reusing F-62's 20-message window had cut the first-turn disclosure out of
every long conversation, making the compliance dimension wrong in both
directions — and every line is timestamped in the STORE's timezone so the
§9 'quiet-hours clean' anchor is judgeable at all. The scan window is
seven days, ordered oldest-first, and the worker DRAINS it in rounds with
a per-run attempted-set (an invalid verdict is not re-paid within a run,
and a stalled run logs its shortfall instead of hiding it); a session
advisory lock fences overlapping runs from double-paying the judge. The
grounding anchor is honest about not seeing tool results (specific
unverifiable claims → 3 + flag; blatant invention → 1), craft carries the
measurable <160-character bar, language carries the Quebec preference
question, and the weekly floor considers every org the scan touched.
**Decided by:** Claude (implementation), 2026-08-22

## D-064 — 2026-08-22 — Duplicate-as-signal: the resubmission is about the KEEPER

F-63 (leads.md §8.3). (1) The §8.3 auto-reaction fires only on CERTAINTY —
confidence 100 with a phone match; email/name pairs stay pending for a
human, exactly as F-54 shipped them, and the full lead-merge REMAINS a
human verb (D-056): what automates is the backfill (keeper's empty fields
take the submission's values, same COALESCE shape as §8.2 #1) plus a
SAVEPOINT-guarded rescore, atomic with the intake. (2) One person, one
message: the confirming re-engagement goes to the KEEPER's thread as a
bot 're_engagement' through the full gate — the new record gets no
greeting of its own. On an ACTIVE deal (pipeline_stage not delivered/
complete/lost) the machine steps aside entirely and the assigned
salesperson gets a high-urgency notification instead. (3) Reactivation
from nurture/expired uses F-48's comeback shape (fresh ladder, paper
trail via duplicate_resubmission) WITHOUT cascading at intake — the
customer's reply to the confirmation routes through f23, which cascades
an orphan there; the intake ACK budget stays sub-second. (4) The
confirmation rides the first-touch worker as a mode (duplicate_of on the
job, its own jobId) with its own crash-recovery probe scoped to
re_engagement-class messages — the greeting probe would mistake months-old
history for this send.
(5) The review (21 agents, 16 confirmed / 3 refuted) rewrote the seams:
the confirmation finds/adopts/creates a thread the KEEPER owns —
findOrCreateConversation's newest-lead attach would have bound the phone's
one live thread to the duplicate record and the confirmation would have
refused its own conversation, silently, forever (the different-phone test
fixture was hiding a state the phone-match gate cannot produce). The
submission record's chatbot_engaged_at is the replay anchor (delivered-
but-unstamped recovery + at-least-once idempotency), with a 24-hour
person-level cooldown over jobId granularity. The duplicate record is
never assigned and never arms the ladder (§8.3 runs BEFORE routing); the
canonical keeper is the OLDEST lead with phone-matches preferred; the
keeper lock is NOWAIT under a savepoint so the F-54 merge cannot stall
the ACK; email-only certainty joins the gate (backfill + alert; the
confirmation rides the new number's own first touch); reactivation flips
only keepers WITH an agent (orphans stay dormant — their reply cascades
through f23) over F-48's full dormant set including lost; every §8.3
branch writes its reaction to the paper trail; drip rides end on
confirmation; and duplicate_resubmissions joined the win-loss summary.
**Decided by:** Claude (implementation), 2026-08-22

## D-063 — 2026-08-22 — Silent monitoring: a third pass that judges, never speaks

F-62 (appointments-tasks-communications.md §10 post-handoff). (1) Beside
the conversation pass (TONE) and extraction (DATA), a third stateless pass
owns JUDGEMENT — it runs one analysis per message on a HUMAN-held thread
(handed_off/agent_active, re-checked at run time), writes one
conversation_analysis 'live_update' row (the declared-but-dead vocabulary
from 0033, now live), and has no tools and no send path. Its
suggested_response reaches a customer only if a person pastes it into the
composer and sends through the full gate. (2) The realtime event is a
REFRESH HINT like the bell's (D-050): analysis.created carries ids only,
the row is the truth, and the panel refetches the conversation detail. A
worker publishes it through an emit-ONLY Socket.IO server on the same
Redis adapter the API instances share — exactly the f28b fanout topology,
one more server that happens to have no listeners; without Redis it
degrades to silence, never a crash. (3) Enqueue sites are the two places a
human-held thread gains a message: the carrier webhook on a 'to_agent'
route, and f21's agent send. Jobs dedupe per triggering message
(jobId analysis:{message_id}). (4) The analysis schema IS the table's
CHECKs (strict zod, enums identical), the transcript window and model are
extraction's (§5's 20 messages, Haiku-class), and customer text is
spotlighted in the analyst prompt like every other model's view of it.
(5) The review (13 agents, 10 confirmed) hardened the seams: analysis rows
carry message_id + model + tokens (0061) — the idempotency anchor that
makes BullMQ's at-least-once replay a free skip instead of a second model
spend, the §13 meter, and the freshness guard (a stale job that lost the
race to a fresher message declines to top the panel). Transcript speakers
are what the DATABASE recorded — ASSISTANT/AGENT/SYSTEM, never the bot's
words in the human's mouth. Every analysis enqueue is HINT-grade (try/
catch-and-log): it must never hang or fail a response whose SMS already
left, and in the webhook it sits AFTER reassign.arm — nothing may stand
between the commit and the one side effect that cannot heal itself. The
handoff moment itself now emits (conversation.changed + analysis.created
from the turn worker); takeover and deferred agent sends enqueue passes;
the panel renders score_reason; the realtime vocabulary guard scans
apps/workers. Invalid model output rides the job result with its token
cost — the completed-job log is the regression corpus until an analysis
table earns its keep.
**Decided by:** Claude (implementation), 2026-08-22

## D-062 — 2026-08-21 — Drips: due-ness is scheduling, permission is the gate's

F-61 (automation-notifications.md §11). (1) The engine decides only WHEN a
step is due; every send still passes the full f19 compliance gate, and the
hourly tick is the ONLY retry mechanism — a deferred step is simply retried
next hour, never handed to a second scheduler (two schedulers for one
message is two chances to send it). (2) Gate refusals map to honest ride
endings: suppression/DNC → opted_out, consent gone → expired, guard-unsafe
template → expired (deterministic failure would retry forever); frequency
cap and human takeover just wait. (3) The spec's 'paused' status is folded
into 'reactivated' — its only trigger ("positive reply during a drip") IS
the reactivation event; one event, one status. lead.unresponsive and
delivery.completed stay declared in the trigger enum but fire nothing until
their upstream modules exist. (4) Sequences default to the 'conversational'
consent scope (re-engagement about the customer's own inquiry rides the
inquiry basis); 'marketing' is opt-in per sequence and declares
is_solicitation, which demands express consent at the gate. (5) Enrollment
happens INSIDE the f02 lost-transition transaction (loss and ride commit
together); STOP ends rides in f18's atomic act; a positive reply ends them
in f23. (6) The cross-tenant scan is a SECURITY DEFINER function returning
ids only (0036 precedent) — every read and write then re-enters RLS under
withTenant. It also surfaces all-steps-sent rides, a blind spot the worker
suite caught: a finished ride otherwise sat 'active' until expiry. (7) The
dead-column guard's UPDATE matcher no longer crosses template-literal
boundaries — an INSERT with no SET was swallowing the next statement's SET
list and claiming its columns (found because f18's enrollment opt-out
vanished into the platform_suppression INSERT).
(8) The adversarial review (33 agents, 28 confirmed) reshaped the slice:
steps are an FR/EN PAIR (body_fr/body_en, ADR-019) rendered by conversation
language ('en-CA' counts as English); merge fields are §12's exact
vocabulary ({{first_name}} {{last_name}} {{vehicle}} {{salesperson}}
{{store_name}} {{store_phone}}) with unknown tokens stripped, the store
name appended when the body lacks it (CASL identification) and the opt-out
check by whole word (substring read 'financement' as teaching FIN); drips
originate as 'ai' and SPEND the assistant's daily cap (they mapped to
'system' and escaped it — only D-060's SYSTEM notices escape); the tick
finds threads through f23's findOrCreateConversation (never a closed one,
never a second live thread per phone), redelivers a step whose carrier
call never concluded before composing anything new (F-59 discipline), ends
a ride on permanent carrier rejection, waits when the rooftop has no
sms_number or the lead no store, isolates poison rows per enrollment, and
a reply from an enrolled lead ends their rides from ANY branch — 'lost'
now counts as dormant in F-48's comeback (the only firing trigger IS
lead.lost) and a 'reactivated' route gets an assistant answer. Declared
deviation kept: consent scope stays per-sequence (per-step cem_class
arrives with the template module).
**Decided by:** Claude (implementation), 2026-08-21

## D-060 — 2026-08-21 — Handoff: the existing machinery wins; every reason hands off

F-60 (conversation-engine.md §9), rebuilt after review. (1) The rules and
the execution ALREADY EXISTED: core/handoff.ts evaluateHandoff and F-20's
handOff() (FOR UPDATE + status recheck, agent membership validation,
SYSTEM-sender notice so the assistant's own daily cap cannot swallow it) —
the F-60 duplicate was deleted, the worker wires facts into them. The
lesson is procedural: grep core+api for the concept before writing any new
module. (2) EVERY request_human reason starts a handoff — complaint maps
to wants-a-human; the tool told the model a person is coming, so one must
come. (3) Extraction flags align by message_id and are re-validated per
row (invalid snapshots exist by design and contribute nothing); when this
turn's extraction has not landed (it races on another queue), this turn's
flags come from the tools and the streak counts what exists — honest lag,
never a crash. (4) The whole handoff phase is crash-isolated: the reply is
already delivered, so a handoff error may never fail the job (a retry
would double-text); it logs, skips, and the next turn re-evaluates.
(5) Turn cap comes from tenant_comms_config.bot_turn_cap. (6) A handoff
that itself assigned the agent arms the D-046 ladder like every other
machine assignment. (7) No agent available = no handoff, reason recorded —
never promise a person who does not exist. (8) bot_summary quotes the
customer's last messages; scores stay rule-derived so routing and the
be-back sort never depend on prose.

## D-061 — 2026-08-21 — Owner budget phasing for AWS (D-060 reserved for F-60 handoff)

Owner decision (via Hassan, 2026-08-21): AWS spend is phased by RESULTS,
not by calendar. (1) Build phase (now): minimal footprint per
reliability-and-cost.md §9's build-phase paragraph — ~US$30–60/mo.
(2) Pilot phase (launched, one dealership, not yet selling to others):
lean shapes the plan itself documents — Single-AZ db.t4g.small without
Proxy, one Graviton API task, WAF deferred to hardening — AWS
~US$175–230/mo, ceiling US$300. (3) Selling phase (product genuinely
selling leads / onboarding dealer #2): hardening knobs engage — second
API task, WAF, the documented Multi-AZ db.t4g.small option (~$90 DB
line) — AWS ceiling US$500. The full ~$750–1,100 envelope engages at
scale (≈10 rooftops), where the plan's own margin table funds it.

The ONE deferred commitment, named: NFR availability "min 2 tasks /
2 AZs from production launch" moves from launch to the selling phase —
a pilot-period AZ event can mean minutes of downtime. No architecture,
vendor, residency or security change; upgrades are sizing knobs.
Guardrails: AWS Budgets alerts at $250 (pilot) and $450 (selling);
ARM64/Graviton images per ADR-014's stated preference.

## D-059 — 2026-08-21 — First touch: stage, deliver, THEN stamp

F-59 (overview.md §5, §6 templates), shaped by the review's nine confirmed
defect classes. (1) Order is the design: message row commits first, the
carrier delivers second, the SLA stamp (chatbot_engaged_at + forward-only
status) lands ONLY on carrier acceptance — a crash between any two steps
re-runs into redeliver/stamp-only recovery, never a second greeting row.
(2) A gate deferral (tenant turned first_touch_quiet_exempt off) rides a
DeferredSendJob to the window opening — the F-21 shape, re-gated on wake —
never a silent drop. (3) The template is composed through
safeFirstTouchMessage: a price-shaped vehicle_interest from a provider
degrades to the generic phrase instead of tripping the guard the message
must pass as a bot send. (4) The conversation's language is locked at
creation from the lead's preference — an EN lead's later turns cannot
drift French. (5) A phone whose live conversation belongs to ANOTHER lead
is skipped: no barging into somebody's thread, no cross-lead SLA stamps.
(6) The intake ACK never waits on a sick Redis (1.5s race + loud log);
provider-level intake idempotency belongs to the Flow spool when it lands.
(7) The worker gates on the DEPLOYMENT AI switch; the per-tenant switch
arrives with the admin console.

## D-058 — 2026-08-21 — Extraction: every message, every snapshot, throws retry

F-57 (conversation-engine.md §5), shaped by the review's 13 confirmed
findings. (1) The DATA pass rides EVERY recorded client message — including
handed-off threads, where a customer talking numbers with a human is the
window most worth capturing; only the TALK pass is to_assistant-gated.
(2) Every snapshot is stored verbatim, valid or not: off-schema output IS
the eval regression corpus, and §13 meters its tokens either way. One
snapshot per triggering message (partial unique index + ON CONFLICT), so
retries converge instead of appending. (3) Transient model failures THROW —
the queue's attempts/backoff budget exists for exactly that; only schema
mismatch is a value. (4) An amount whose budget_type is unknown is written
NOWHERE (D-043 split the columns so nothing guesses). (5) Language is
never written by extraction — set at creation, locked by the as-is rule.
(6) conversation_flags/consent_signals are snapshot material only until the
handoff-trigger and analysis slices consume them.

## D-057 — 2026-08-21 — Eval harness: deterministic CI core, live tier declared

F-56 (compliance-and-quality.md §10, ADR-023). (1) CI cases are fully
deterministic — the model is a SCRIPT, so what CI proves is the machinery:
spotlighting, defanging, redaction, the guard, the one-regeneration path,
tool-loop bounds. Live-model categories (happy-path 40, objections,
handoff triggers, extraction F1, judge scoring) are DECLARED in the same
jsonl with kind:'live' and counted by CI — never silently dropped — and
run nightly/pre-release once the Anthropic account has credits. (2)
Cross-layer red-team cases (STOP, consent expiry, quiet hours, verbatim
YES/OUI) are 'xlayer' pins: the eval suite asserts the API/core test that
owns the behavior still exists and still names it, so deleting a pinning
suite breaks the release gate here. (3) The suite-only-grows rule is a
count floor plus a required RT-01..23 id set. (4) Building the suite
found and fixed four product gaps before any customer exists: the guard
never blocked ASKING for SIN/banking (new sensitive_request kind, FR+EN);
volunteered SINs/cards were not redacted at intake (now redacted at the
carrier door, before storage and before any model); the compliance block
lacked the minor/steering/self-harm rules (RT-18/19/20); and
"you're basically approved" slipped the approval regex (filler-word gap).

## D-056 — 2026-08-20 — Duplicate merge: what follows the keeper and what stays

F-54 (leads.md §8) interpretations. (1) Re-pointed to the keeper in the
merge transaction: deals, conversations, appointments. (2) Deliberately
NOT re-pointed: consent_ledger (append-only by trigger, and consent keys
on phone/email — the keeper, being the same person, inherits by
identity); lead_assignment_history and conversation_analysis (both
append-only snapshots OF the source — moving them would falsify the
keeper's history; the source survives as a lost lead carrying them).
(3) The source's lead_scores row is deleted per §8.2 #3 — 0056 grants the
app DELETE on lead_scores for exactly this. (4) The 'Merged duplicate'
lost reason (#10) is system vocabulary: merge re-seeds it idempotently if
a tenant deleted it, so the merge path cannot fail on missing config.
(5) §8.3 duplicate-as-signal (auto-message, auto-reactivation) waits for
the AI engine — the PAIR is recorded at webhook arrival today, so no
signal is lost, only the automated response. (6) Detection runs in the
same transaction as every lead create (manual + intake): a duplicate
exists the moment its lead does, or neither exists.

## D-055 — 2026-08-20 — Lost reasons: history keeps its label, retirement beats deletion

F-53 (leads.md §11) interpretations. (1) A reactivated lead KEEPS its
lost_reason — the fields document the last loss, and wiping them on
reactivation would erase exactly what the be-back caller wants to know; a
RE-loss passes without the modal for the same reason. (2) An inactive
reason still resolves on old leads (labels are history) but is refused for
NEW losses and hidden from the pick-list. (3) A reason leads reference
cannot be DELETEd (FK, 409 reason_in_use) — deactivation is the retirement
path. (4) name_fr is NOT NULL by schema — Bill 96 is a constraint, not a
convention; the legacy's nullable name_fr is not carried forward. (5) The
vocabulary list is ordered by display_order and returns one bounded page —
a pick-list, not a feed. (6) The STOP opt-out (f18) still writes
status = 'lost' with NO reason: the spec scopes the requires-reason rule to
the single-update path (a person deciding), and a customer's own opt-out is
neither — putting a staff-picked reason on it would fabricate attribution.
Win/loss analytics must treat reason-less lost leads as opt-outs/system.

## D-054 — 2026-08-20 — Be-back queue: caution token, queue-wide alert, lost_reason deferred

F-52 (leads.md §9) forced three calls. (1) The spec's four-color urgency ramp
(red/orange/yellow/emerald) needed a yellow the token system lacked — added the
`caution-bg`/`caution-text` semantic pair (AA-gated both themes) rather than
collapsing medium into warning's amber or a signal-free gray. (2) The
"N critical" header alert is QUEUE-WIDE state: the search term filters items
and `total` but never `critical`, so a search matching only calm leads cannot
hide the red banner. (3) Spec cards surface `lost_reason`; no such column
exists yet — the card shows the status pill instead, and the field arrives
with the lost-reasons feature (leads.md §11) rather than being faked here.
Adversarial review (3 finders, 13 raw findings, 10 confirmed) drove all three.

## D-053 — F-49 connectors become configuration, with the built-ins as the floor (2026-08-20)

**Context:** FR-LEAD-019 / leads.md §2.3 — "adding a new lead provider means
registering a connector + mapping — no code change, no deploy."

1. **tenant_connectors rows ARE the registration** (0053): source_key, type
   (json_webhook | adf_xml — api_poll ships with its first polling provider),
   field_map (canonical field → provider paths, first non-empty wins),
   default_source, dedupe_fields, and the form's OWN consent basis. The
   webhook resolves a key against the tenant's ACTIVE rows first, then the
   built-in presets, then the historical website_form fallback.
2. **Built-in keys are reserved** — a tenant row shadowing website_form would
   silently rewire every key that names it; 422 reserved_key.
3. **A key must point at a REAL connector at mint time** (422
   unknown_connector) — the enum became a string when tenant keys arrived,
   and the route now carries the check the enum used to.
4. **Deleting an in-use connector is refused (409)** — deactivate instead;
   an INACTIVE connector's keys fall back like an unknown one, loudly
   documented rather than silently rewired at delete.
5. Gated intake_key:manage both ways — a connector shapes what enters the
   front door, the same authority that mints its keys. Admin UI screen is
   the next web slice.

## D-051 — F-48 reactivation: a reply wakes the dead, with a fresh ladder (2026-08-20)

**Context:** FR-LEAD-012 / leads.md:459 — "any client reply at any point
reactivates the lead and re-enters the assignment flow (§7.3)". The inbound
router (F-23) already reactivated drip replies; unresponsive/nurture/expired
leads stayed dormant even mid-conversation.

1. **The hook lives in the ROUTER** (the single inbound spine, per its own
   doctrine), fires whatever branch answers the message, and inside the same
   transaction that recorded the reply.
2. **The comeback gets a FRESH ladder:** previous_agents and
   assignment_attempts reset — a customer who returned deserves the full
   funnel, and the old ladder's story is already in lead_assignment_history.
3. **Still-owned dormant leads go straight back to their holder**
   (status → assigned, no re-funnel, no fresh timer — their clock is not
   fresh); orphans re-enter §7.3 right there, and the caller arms the
   ten-minute timer post-commit (the armReassign value on the route result).
4. **'expired' is reactivatable** — the spec says ANY time, and a customer
   who texts after 90 days is the strongest comeback there is.
5. **No nurture_expires_at column yet** — it arrives with the unresponsive
   EXECUTOR (the 3-attempt flow + 90-day sweep), which is the slice this one
   deliberately does not pretend to be.

## D-050 — F-47 notifications: the row is the truth, the key is the message (2026-08-20)

1. **The notifications ROW is the truth; realtime is a refresh hint.** Routes
   emit `notification.created` post-commit where an emitter is in reach; the
   WORKERS have none (the socket server lives in the API process) and emit
   nothing — the bell's 60-second refetch is the agreed staleness for
   worker-written rows. No delivery state machine until a channel needs one.
2. **Titles are i18n KEYS + ICU params, never rendered text** — the same
   alert reads French to a French user and English to an English one, decided
   at display time by the recipient's client. `NOTIFICATION_TITLE_KEYS` lives
   in @dealpilot/schemas so producers (api) and renderers (web locales)
   lockstep-test without depending on each other.
3. **Addressed, not shared:** RLS is isolation + SELF-read/SELF-update. No
   member_read — a colleague's bell is not the team's business.
4. **Channels this slice: in-app only.** The spec's tier table (medium=email,
   high=SMS) attaches when SES/Twilio credentials exist; channels_sent
   records what actually carried each row. Toasts wait for the same slice.
5. **Producers wired now:** M9 lead.assigned (cascade, rules engine, with
   self-notify suppressed — the actor already knows), the ladder's
   taken-back notice to the silent agent, and the HIGH escalation alerts to
   the manager (closing D-046 #5's in-app half).
6. **read = read_at IS NOT NULL** — the spec's own reconciliation order.

## D-049 — F-45 distribution: the queue empties at arrival, and the rule beats the example (2026-08-19)

**Context:** FR-LEAD-007's central queue + weighted store distribution
(leads.md §3).

1. **Org-level intake keys ARE the central queue's front door**:
   intake_keys.store_id and leads.store_id both went nullable (0050). A lead
   arriving on an org-level key is dealt by the running tally IN THE SAME
   TRANSACTION that created it (FOR UPDATE on the month's rows serializes
   concurrent webhooks); a refusal (no config / no spend / non-ad source) is
   a value and the lead stays queued — store-less, visible, ownable.
2. **The spec's worked example contradicts its own rule** at the 7/5 step
   (store A at 58.3% is still 1.7pp BELOW its 60% target; the example hands
   the lead to B with '≈ target'). The RULE — furthest below target — is
   normative; the golden suite proves it converges on exactly 60/40 over 100
   leads, which is the example's actual point. Ties: larger target, then
   store_id.
3. **The dashboard is a MONEY surface**: organization:update both directions
   (the spec says Owner-only; GM holds organization:update too — accepted,
   a GM who can edit the org can see its ad split). No member_read policy on
   the table, deliberately.
4. **source_platform is now written at intake** (google_ads→google,
   meta_lead_form→meta, else NULL) — the bridge lives in core beside the
   engine.
5. **Known edge, accepted:** a still-queued lead (store NULL) cannot open a
   conversation yet (conversations.store_id stays NOT NULL) — the
   conversation engine is owner-gated anyway; FR-CONV revisits when it lands.
6. **FR-LEAD-008's dashboard UI** is the next web slice; the API
   (read/config/history + deviation) ships now.

## D-048 — F-44 rate limiting: token buckets that fail OPEN (2026-08-19)

**Decision:** one shared token-bucket limiter (Redis + Lua when REDIS_URL is
set — atomic and instance-agnostic; in-memory otherwise), applied to the
surfaces where abuse has a payoff: the intake webhook (30/min per key — the
old fixed window's budget, now burst-tolerant), auth POSTs (60/min per IP,
lethal to spraying, invisible to real sign-in bursts), sign-in additionally
2/min burst 8 per EMAIL (the actual brute-force wall — rotating IPs does not
reset the account's budget), and the invitation preview (30/min per IP — the
one public endpoint that resolves a secret to a fact, i.e. the enumeration
shape). 429 + Retry-After everywhere, per the baseline.

**Fail OPEN, only here:** if Redis dies, requests pass and it is warn-logged.
The auth/signature/consent gates all fail closed; a limiter that turned a
Redis outage into a full API outage would do the attacker's job for them.

**Deliberately NOT limited:** the Twilio webhooks — provider-signed, and
Twilio treats non-2xx as delivery failure with its own retry schedule, so a
429 there would punish real traffic; WAF-level limits cover that surface in
production. GET /api/auth/* (session reads) — cheap, constant, nothing to
guess. TOTP verification — 0048's failedVerificationCount + lockedUntil is
already a stricter per-account wall.

**TRUST_PROXY** env (default false, ON behind the ALB): without it every
production per-IP bucket would be one shared bucket keyed on the ALB's
address.

## D-047 — FR-LEAD-014 presence: subscribe-is-life, and absence of data is not offline (2026-08-19)

**Context:** the cascade's "online" step (§7.3 step 2) needs a presence
source. ADR-004 prescribes Socket.IO connection state + Valkey-backed
heartbeats, superseding the never-built 60s-polling design.

1. **A successful room SUBSCRIBE is the heartbeat.** F-28's subscribe already
   re-verifies the session and membership per org — a socket that subscribed
   in org O is a person actively using O's app. The server refreshes the mark
   every 60s while the socket lives; marks age out after 180s (the spec's
   3-minute auto-offline). No explicit offline write on disconnect — TTL
   handles crashes, sleeping laptops, and clean exits identically.
2. **Tri-state survives (D-045 #1): an org that has NEVER produced presence
   data reads `null`** (filter skipped), while an org that HAS reads a real
   set — possibly empty, which means genuinely nobody online → escalation to
   the manager, exactly the off-hours behavior the spec wants. The
   first-touch marker persists 7 days, so a quiet weekend does not silently
   disable the filter Monday morning.
3. **Store shape:** one sorted set per org (member = user, score = last
   touch), pruned on read; Redis-backed when REDIS_URL is set (multi-instance
   correct), in-memory otherwise (dev/tests, single process). The store is a
   buildApp dependency shared with attachRealtime — injectable, so cascade
   tests state who is online instead of opening sockets.
4. **No presence EVENTS yet** — the contracts' presence room stays
   unsubscribable until a consumer (team-screen green dots) exists; shipping
   an event vocabulary nothing renders would be dead vocabulary by
   construction.

## D-046 — FR-LEAD-010 timer: fire-time verification, not job cancellation (2026-08-19)

**Context:** the 10-minute reassignment ladder (leads.md §5.2, :250-254). The
spec prescribes one BullMQ delayed job per lead keyed
`reassign:{lead_id}:{attempts}` "cancelled when a communication is logged".

1. **No cancellation plumbing — the job VERIFIES at fire time.** Cancelling
   requires every message-write path to reach into Redis; a fired job that
   re-checks the database needs nothing from anybody. The job carries
   `{lead_id, assigned_to, attempt}`; at fire time it no-ops as `obsolete`
   when the lead changed hands (assigned_to differs), attempts moved, the
   lead is terminal/deleted, or as `contacted` when an outbound AGENT message
   (sender_type='agent' — the assistant's sends do not count as the human
   contact the SLA demands) exists since assigned_at. Same behavior as
   cancellation, minus a distributed cache-invalidation problem.
2. **Which assignments start the timer:** every MACHINE assignment — cascade
   (assigned or escalated: leads.md:374 runs the timer after escalation too)
   and the §7.1 rules engine. A MANUAL assignment starts no timer this slice:
   a human chose a human; auto-take-away behind their back is a policy the
   owner should switch on knowingly (parked in OWNER-ACTIONS).
3. **The ladder ends at the 3-strike manager assignment** (method
   'escalation', history `escalation: three_strikes`). The manager does not
   get a fresh 10-minute timer — the spec ends the ladder with "direct
   assignment", and a timer that takes leads away from the person the ladder
   terminates AT would be a loop, not a ladder.
4. **Take-away restores the unowned invariant** (assigned_to/assigned_at/
   method NULL, status assigned→new) and appends
   `{user_id, assigned_at, reassigned_at, reason:'no_response'}` to
   previous_agents; the re-run is cascadeAssignLead with method
   'reassignment', which already excludes previous agents. Nobody eligible →
   the cascade's own escalation assigns the manager.
5. **"HIGH alert to sales manager / notify first agent"** is recorded as
   activity events only — the M9/H-class notification channels do not exist
   yet; they attach here when the notification slice lands.
6. **No queue configured = loud degradation, not failure** (the
   deferred-send precedent): the timer simply does not run, and each skipped
   enqueue is warn-logged with the lead id.

## D-045 — FR-LEAD-009 cascade: interpretations where the spec is silent (2026-08-19)

**Context:** leads.md §7.3 defines the post-handoff funnel (language → online →
on-schedule → least-loaded under `max_active_leads`, else escalate to the sales
manager) but leaves ~10 semantics unstated. This entry records the choices so
the owner can review them as a set; each is also documented at its code site.

1. **Unknown passes, known-false filters.** Presence and schedules are
   TRI-STATE inputs to the engine (`boolean | null`). `null` = the subsystem
   has no data (presence not yet built — FR-LEAD-014; user has no schedule
   rows) and the candidate PASSES that step. `false` = the subsystem
   affirmatively says unavailable → filtered. Rationale: a funnel that
   escalates every lead to the manager because an optional subsystem is not
   deployed is a funnel nobody turns on.
2. **Language is a HARD filter** — Bill 96 is law, not preference. No
   FR-capable agent for an FR lead → escalation, never an EN-only agent.
3. **Tie-break for "fewest active" = first-min in deterministic roster order**
   (membership created_at) — same rule as §7.2 load_balanced; randomness is a
   flake generator.
4. **"Escalate to sales manager" ASSIGNS the lead** (`assignment_method =
   'escalation'`), matching the 3-strike rule's explicit wording — an alerted
   but unowned lead is an unowned lead. Target = first active member holding
   sales_manager (fallback gm, then owner — someone must own it), chosen by
   membership age. Capacity does NOT block escalation.
5. **`assignment_method` mapping:** cascade writes `auto_language` when the
   language step actually narrowed the pool, else `auto_availability`; manual
   PATCH writes `manual`; escalation writes `escalation`; the FR-LEAD-010
   re-run will write `reassignment`. The §7.1 rules engine writes NULL — the
   Target vocabulary has no name for it, and inventing one would be vocabulary
   drift.
6. **`preferred_languages` defaults `'{fr-CA}'`, not the spec's `'{en}'`** —
   the platform is Quebec-first and users.language_pref already defaults
   fr-CA; backfilled from language_pref. Locale vocabulary stays 'fr-CA'/'en-CA'
   (the build's), not the spec's bare 'en'.
7. **The agent profile lives on MEMBERSHIPS, overriding the spec's
   users-level directive** (leads.md:263). The same-day adversarial review
   PROVED (live RLS probe) that users-level columns let one org's admin
   silently rewrite a shared agent's languages/cap and reshape ANOTHER org's
   routing, unaudited there. Org-scoped rows keep the write under the org
   that answers for it. The f04 PATCH writes the profile across ALL of the
   user's membership rows in the org, so a multi-store member never carries
   two competing profiles; the cascade reads one candidate per person
   (DISTINCT ON, oldest row). max_active_leads: default 10, CHECK 1–1000 —
   0 would mean "assign nothing", which is what revocation is for.
8. **Schedules:** rows live against a store (timezone anchor); a user with NO
   active rows is always-available (schedules are opt-in until the grid UI
   ships); windows are same-day only (`end > start`); split shifts = several
   rows. New permission `schedule:manage` (owner, gm, sales_manager,
   admin_office) — the catalogue grows by one, seeded for existing orgs in
   0049.
9. **History rows:** cascade writes `strategy = 'cascade'` (history CHECK
   extended in 0049; RULE CHECK unchanged — a rule cannot BE the funnel),
   `rule_id NULL`, `rule_name` naming the funnel step or escalation reason, so
   "why did Marc get this one" stays a query.
10. **Deferred to FR-LEAD-010 (next slice):** the 10-minute BullMQ timer,
    previous_agents WRITES, attempt counting, timer-cancellation semantics.
    The cascade already READS `previous_agents` and excludes them.
11. **Race rule:** the cascade's UPDATE re-checks `assigned_to IS NULL`; the
    loser of a concurrent assignment returns `already_assigned` and writes no
    history — the auto path never steals, even from itself.
12. **Known divergence, kept:** capacity counts treat `expired` as terminal
    (matching shipped F-40 and the 0047 index) although the spec's §4
    workload table counts it. Flipping it is FR-LEAD-012's call — that slice
    owns the `expired` lifecycle. Store timezones are now validated against
    `pg_timezone_names` at write time, because the cascade's schedule verdict
    would 500 the whole org on one typo'd zone (review finding).

## D-044 — MFA enforcement is deploy configuration, and it binds a named permission set (2026-08-19)

**Decision:** FR-AUTH-006's "MFA required for owner/gm/admin_office" is enforced
server-side inside `requirePermission` — but only for a five-entry blast-radius
set (`organization:update/delete`, `member:update_roles/revoke`,
`intake_key:manage`), and only when `REQUIRE_MFA=true` (default off, ON in the
production deploy config).

**Why a flag:** the same shape as `REQUIRE_EMAIL_VERIFICATION` (D-030 lineage) —
a hard gate with no flag would lock every fresh dev/test owner out of setup the
moment they created an org, and every existing e2e journey with it. Enforcement
is environment policy, not code.

**Why a named set, not all permissions:** gating everything would stop a
salesperson-facing owner from answering a lead until enrolment — punishment, not
security. The set binds exactly the powers that could weaken the policy itself
(change roles, change the org, mint standing intake credentials). The set is
typed `ReadonlySet<PermissionT>`, so a misspelled entry is a compile error, not
a silently dead gate (the dead-vocabulary lesson).

**Refusal contract:** 403 `mfa_enrolment_required` with the remedy named
(enrol at /security) — distinct from `forbidden`, because "your role may not"
and "your role must enrol first" are different conversations.

## D-043 — `fast-xml-parser` pinned to 4.5.7, not the current 5.x (2026-07-27)

**Decision:** add `fast-xml-parser@4.5.7` to `packages/core` for ADF lead
parsing. Owner approved the dependency 2026-07-27.

**Why the older major.** Version 5.10.1 is current, and it fans the package out
into six dependencies — `@nodable/entities`, `is-unsafe`,
`path-expression-matcher`, `xml-naming`, `fast-xml-builder`, `strnum` — all of
them first published within the last two months. Every one is published by the
same maintainer as the parser, so this is a refactor rather than a hijack, and
that was checked rather than assumed.

But six brand-new packages is six times the surface for a parser whose entire
job is reading hostile input from outside. 4.5.7 is the long-stable line, is 42
days old, and carries exactly one dependency (`strnum`, same author). The
lockfile diff was read: both resolutions are integrity hashes from the default
registry.

**Revisit when** the 5.x sub-packages have a year of history, or when 4.x stops
receiving security fixes — whichever comes first.

**Parser hardening.** Entity processing is switched OFF. fast-xml-parser does
not resolve external entities at all, so classic XXE file disclosure is not
reachable, but entity EXPANSION is — the "billion laughs" shape — and ADF leads
have no use for entities, so disabling it costs nothing and removes the class.
A 256 KB ceiling is applied before parsing.

---

## Format

```markdown
## D-NNN: <title> (YYYY-MM-DD)

**Status:** accepted | superseded by D-NNN
**Context:** the problem or force that made a decision necessary
**Decision:** what was chosen (one sentence, imperative)
**Alternatives considered:** what was rejected and why
**Consequences:** what this makes easier / harder; any follow-up work created
**Decided by:** user | claude-proposed-user-approved
```

---

<!-- Entries begin below. Do not delete this line. -->

## D-032: Bigger batches + a standing cross-agent listener (2026-07-25) [AHMAD]

**Status:** accepted — amends D-031 (2-3 slices per round).
**Context:** Owner 2026-07-25: "let the batch of testing be bigger so work is faster — but keep it professional", and "always put a listener between you and him, so when one stops the other continues — efficiently, without burning tokens".
**Decision (batch size):** a batch is now **3-5 feature slices**, still declared up front with per-agent halves, still one combined owner test round at the end. The **quality floor is unchanged and non-negotiable**: TDD red-first, adversarial review per slice before merge, full gate (build/typecheck/lint/tests/i18n parity) before every merge, CI green on develop, contract-first between agents. Bigger batches change how often the OWNER is interrupted — never how carefully the work is checked. A rejected slice never blocks its siblings.
**Decision (listener):** each agent ends a work stretch by arming a **cheap git watcher** on `origin/develop` rather than idling: a background poll (5-minute interval, one `git ls-remote` per tick, no model tokens burned while waiting) that wakes the session only when the other agent pushes. Wake-up rule: on wake, `git pull`, read the newest board rows + the other agent's newest session-log entry, then act on anything addressed to you (CR/HO rows first) before resuming your own queue. This is what already worked in practice — HUSSEIN's monitor woke him when AHMAD's lead routes landed, and his SIGNAL row got F-06 merged minutes after it was ready.
**Consequences:** fewer owner test rounds, no idle agent, and coordination stays in git (no chat dependency between the two accounts). Cost is bounded: polling is a shell loop, not model inference.
**Decided by:** user


## D-031: Batch delivery — ship 2-3 feature slices per owner test round (2026-07-25) [AHMAD]

**Status:** accepted — amends D-018 / TEAM-WORKFLOW §12 (one-slice-at-a-time). Per this log's header, a newer entry supersedes on conflict; **the owner should also update TEAM-WORKFLOW §12 himself when convenient (that file is human-only).**
**Context:** Owner 2026-07-25: "i want u to do more than one step (F-04), because we are slow — we do batches and then we test them, but keeping everything professional and functional". One-slice-per-acceptance made the owner a per-feature bottleneck while both agents idled between rounds.
**Decision:** Work ships in **BATCHES of 2-3 feature slices**. Each batch is declared up front on the board with per-agent halves; both agents build their halves in parallel; the batch reaches **AWAITING-OWNER-TEST only when every slice in it is INTEGRATED and green**, with ONE combined test script covering all of them. The owner accepts/rejects per slice (a rejected slice does not block its siblings).
**Non-negotiables kept (this is speed, not corner-cutting):** TDD red-first, adversarial review per slice before merge, full quality gate (build/typecheck/lint/tests/i18n parity) before every merge, CI green on develop, contract-first between agents, zone ownership, and no owner-visible feature ships untested.
**Alternatives considered:** bigger 5+ slice batches — rejected: a rejection late in a long batch wastes more work than it saves; 2-3 keeps a test round under ~15 minutes for the owner.
**Consequences:** Owner test rounds drop from per-feature to per-batch. The board's feature section now carries a **BATCH-nn** grouping row. First batch = **BATCH-01: F-04 (team members + lead assignment) + F-05 (deal desking on the A-06 money engine)**.
**Decided by:** user


## D-030: No paid AWS infrastructure until launch-adjacent; SES SDK approved (2026-07-25) [AHMAD]

**Status:** accepted
**Context:** A-07 unit 1 (SES identity + OIDC deploy role) costs ~$0/mo and is deployed. Unit 2 (VPC/NAT/ALB/ECS/RDS/ElastiCache staging) is the first real monthly bill — roughly $85-125/mo with VPC endpoints, ~$120-160/mo if a NAT Gateway is used. Nothing in the current build needs a cloud environment: both agents develop against local Docker Postgres, and every feature is owner-tested locally.
**Decision:** Owner reply 2026-07-25 ("use whatever recommended and no need to pay now"): **defer all cost-bearing AWS resources**. Keep building at ~$0/mo (SES identity, Route 53 zone and the OIDC role are free/negligible); revisit staging when a real remote environment is needed (owner demo, external integrator testing, or launch prep). When it lands, prefer VPC endpoints over a NAT Gateway (~$35/mo saved) and consider a stop/start schedule.
**Also decided (same reply):** `@aws-sdk/client-sesv2` is approved as an apps/api dependency — verified official (publisher `amzn-oss`, repo aws/aws-sdk-js-v3), pinned to 3.1092.0 (past the 48h/3-day cooldown per CLAUDE.md supply chain rules).
**Consequences:** Transactional email (sign-up verification) can be built now against the verified 1dealer.ca identity. SES stays in sandbox — real sends go to the SES mailbox simulator or verified addresses; production access is a later owner-visible request. No AWS spend accrues in the meantime.
**Decided by:** user


## D-029: Email provider = Amazon SES, not Resend (2026-07-24) [AHMAD]

**Status:** accepted (supersedes the plan's Resend choice in PROJECT.md/specs)
**Context:** The plan specified Resend (legacy used it). Owner decision 2026-07-24: "i dont want to use resend, lets use ses on aws — better in limit and more stable". Owner provisioned an admin AWS profile ("Dealpilot", account 242626139373) for both agents.
**Decision:** All transactional email (auth verification, invites, notifications, statements) goes through Amazon SES in ca-central-1, provisioned via the A-07 IaC baseline; domain identity for 1dealer.ca with DKIM; start in sandbox, request production access when the domain is verified. Keeps the whole stack inside the AWS/ca-central-1 residency envelope (D-002).
**Alternatives considered:** Resend (plan default) — rejected by owner; third-party SMTP — no reason once SES is in-account.
**Consequences:** No Resend account/key needed (owner stack shrinks). A-05.1's deferred requireEmailVerification lands after SES identity verification. Legacy Resend references in reference/ docs are historical (A-09 sweep note).
**Decided by:** user


## D-028: F-01 backend tenancy model — user-scoped reads, self-serve bootstrap, platform-authority fields (2026-07-24) [AHMAD]

**Status:** accepted
**Context:** F-01 needs "list my organizations" before tenant context exists, an org-creation path under FORCE RLS, and clear write authority.
**Decision:** (1) Migration 0003 adds SELECT-only policies keyed on `app.user_id` (withUser/withContext in @dealpilot/db): membership_self_read, org_member_read, store_member_read, user_self_read — reads only, writes still require `app.org_id`. (2) Org creation is self-serve (spec trial path): app-generated org id, org + domain user + owner membership in ONE dual-GUC transaction; `INSERT..ON CONFLICT` requires the new row to pass SELECT policies — hence user_self_read (proven live). (3) `status`/`plan_tier` are PLATFORM authority — removed from org create/update inputs; DB defaults apply; org `slug` immutable + reserved-word blocklist. (4) Write gates: org=owner, stores=owner/gm; cross-tenant/no-membership → 404 (never leak); role-insufficient → 403; deleted org fully locked down; delete-of-deleted → 404 everywhere. (5) Keyset cursors carry pg-text timestamps (JS Date ms-truncation skipped boundary rows — proven live) with strict re-parse validation.
**Alternatives considered:** SECURITY DEFINER service functions (spec §5) — deferred until the platform console; Better Auth org plugin — rejected in D-025.
**Consequences:** Hussein builds F-01 screens against the updated contract (org inputs slimmed, StoreListQuery selector). 50-agent adversarial review: no isolation bypass; all confirmed findings fixed. Platform console (A-xx later) owns status/plan_tier transitions.
**Decided by:** claude-proposed (AHMAD)


## D-027: Keep the `@dealpilot/*` internal package scope — rebrand user-facing only (2026-07-24) [AHMAD]

**Status:** accepted
**Context:** The product was renamed "Dealpilot" → "1Dealer" (D-023). Engineering
identifiers still use `@dealpilot/*` (npm scopes cannot start with a digit, so a
matching scope would need a spelling like `@onedealer/*`). Open question from
A-09: rename the scope or keep it?
**Decision:** Keep `@dealpilot/*` as the internal package scope permanently.
"1Dealer" appears only in user-facing surfaces (UI text, docs the client sees,
domain). Repo name, package scope, DB role/db names, and other engineering
identifiers stay `dealpilot`.
**Alternatives considered:** rename to `@onedealer/*` — rejected: touches every
import/lockfile for zero user-visible value, and the scope is invisible outside
the repo.
**Consequences:** A-09 shrinks to the plan-doc name sweep; no code churn. Any
future white-label tenant naming is data, not identifiers (per white-labeling
spec).
**Decided by:** user (owner reply, 2026-07-24: "yes do the recommended please")

## D-026: A-02 CI pipeline — push-triggered, SHA-pinned, ephemeral Postgres on 5434 (2026-07-23) [AHMAD]

**Status:** accepted
**Context:** No-PR workflow (D-021) means there is no PR gate; the only automated
quality signal is what runs on push. The db/api integration suites need a real
Postgres and must not silently self-skip in CI.
**Decision:** Single GitHub Actions workflow (`.github/workflows/ci.yml`):
1. **Triggers:** push to `main`/`develop` **and** `ahmad/**`/`hussein/**` (+
   manual `workflow_dispatch`). Feature-branch runs restore the pre-merge
   feedback PRs would have given — push your branch, get a verdict, then
   squash-merge (D-021 unchanged: merges stay terminal-git).
2. **Supply chain:** all actions pinned to full commit SHAs (checkout v7.0.1,
   pnpm/action-setup v6.0.9, setup-node v7.0.0); `pnpm install
   --frozen-lockfile`; lifecycle scripts stay blocked (pnpm v10 default);
   `permissions: contents: read`; no cloud credentials anywhere in CI.
3. **Database job model (ADR-023):** ephemeral `postgres:16-alpine` service
   mapped to host port **5434** so the repo-wide convention (one URL,
   `localhost:5434`, admin `dealpilot`, app role `dealpilot_app`) holds in CI
   unchanged; `db:reset` runs first (proves migrate-from-zero + dev app-role
   bootstrap), then build+typecheck, lint, and tests with **`RLS_REQUIRED=1`**
   so DB-dependent suites fail rather than skip.
4. **Determinism fix:** root vitest sets `fileParallelism: false` — the db
   suite's `beforeAll` drops/rebuilds the schema of the same database the api
   suite uses; parallel test files raced (worked locally by timing luck only).
5. **Node pin:** added `.nvmrc` = 24 (matches `engines >=24`, local v24.11.1);
   PROJECT.md's stale "Node 22 LTS" corrected. CI reads `.nvmrc`.
6. **Not enforced yet:** `format:check` (tree currently not prettier-clean —
   31 files across both zones; adopting enforcement is a joint follow-up), and
   the i18n parity step is an explicit NO-OP notice until H-04 publishes the
   script (HUSSEIN wires it via HO row).
**Alternatives considered:** PR-triggered CI (rejected — no PRs, D-021);
per-package test scripts under turbo (rejected for now — root vitest is the
established runner, 34 tests); running tests against a job container network
alias (rejected — port mapping keeps one URL for local + CI).
**Consequences:** every push to any agent branch or shared branch gets the full
gate; a red `develop` push is visible immediately. Follow-ups created: prettier
enforcement decision, H-04 parity wiring (HO), A-07 will add deploy workflows
with OIDC (no long-lived keys) separately.
**Decided by:** claude-proposed (AHMAD)

## D-025: A-05 auth architecture — Better Auth for identity only; review carve-outs (2026-07-24) [AHMAD]

**Status:** accepted (recorded as D-023 on ahmad/api-auth; renumbered to D-025
after a same-session collision with HUSSEIN's D-023/D-024 which reached origin
first — same convention HUSSEIN used renumbering off my D-022)
**Context:** A-05 wires Better Auth into the Fastify API. Security review (no
critical bypass; gate probed adversarially and held) surfaced 2 MAJOR + minor
items; some are fixed now, some are deliberate deferrals to feature slices.
**Decision:**
1. **Better Auth = identity + sessions ONLY.** No organization plugin — the
   A-04 domain tables (organizations/stores/memberships/roles + RLS) are the
   single source of tenancy truth. Identity ids are uuids for a future 1:1 link
   to `users.id`.
2. **Fixed in A-05 (from review):** M1 — production fails fast if DATABASE_URL/
   BETTER_AUTH_SECRET/BETTER_AUTH_URL/WEB_ORIGIN are left at dev defaults, and
   BETTER_AUTH_URL must be https in prod. M2 — the deny-by-default gate keys on
   the ROUTED pattern (`request.routeOptions.url`), not the raw URL, so path
   traversal cannot bypass it (regression-tested). Fastify error codes mapped to
   canonical API codes; zod/validation errors emit 422-style `details[]`;
   password min length 12 + max 128.
3. **Deliberately deferred (record, not debt-hidden):** Better Auth's own
   `/api/auth/*` error bodies keep BA's native shape (the web client SDK depends
   on it) — a documented carve-out from the canonical envelope. Identity tables
   live in `public` (single-schema for now, not a dedicated `auth` schema).
   `requireEmailVerification`, `cookieCache`, explicit `session` TTLs, CORS
   `allowedHeaders`/`maxAge`, `ipAddressHeaders`, and the `baseURL`-derived host
   in toWebRequest are scheduled for the auth-hardening feature slice / A-05.1.
4. **Entity CRUD endpoints are NOT built here** — the `apiV1` contract exists
   (A-03) but routes land with their feature slices (D-018). A-05 ships only
   health + `/api/v1/me` (session probe) + the BA mount.
**Consequences:** H-03 auth screens are unblocked (session probe + BA client
flows are live). Auth-hardening follow-ups tracked as A-05.1 backlog.
**Decided by:** claude-proposed (AHMAD), from code-review findings

## D-024: H-01 design direction locked — "Nordique" is the token source of truth (2026-07-23) [HUSSEIN]

**Status:** accepted (initially recorded as D-023; renumbered after a same-day
numbering collision with [AHMAD]'s D-022 — his push reached origin first)
**Context:** H-01 (D-009, ADR-017 amended): five design directions were generated
in Google Stitch and presented on a comparison board; the owner picked this
session. Locked values below are the source of truth H-02 encodes in
`packages/ui` (primitive → semantic → component CSS custom properties).
**Decision:** The platform default theme is **Direction 1 "Nordique"** —
light-first, neutral surfaces, blue primary, Inter, 8 px radius.

*Primary ramp (Tailwind blue, OKLCH):* 50 `oklch(0.970 0.014 254.6)` ·
100 `oklch(0.932 0.032 255.6)` · 200 `oklch(0.882 0.057 254.1)` ·
300 `oklch(0.809 0.096 251.8)` · 400 `oklch(0.714 0.143 254.6)` (#60A5FA) ·
500 `oklch(0.623 0.188 259.8)` (#3B82F6) · 600 `oklch(0.546 0.215 262.9)`
(#2563EB) · 700 `oklch(0.488 0.217 264.4)` (#1D4ED8).

*Semantic assignment (light):* `--primary` = blue-600 (interactive fills/links —
white foreground 5.17:1, link on page 4.82:1, both AA); blue-500 = brand accent
(charts, focus ring `--ring`, non-text UI — 3:1 class only, never text on white).
*Dark:* `--primary` = blue-400 with near-black foreground (6.64:1; as link text
6.61–7.42:1 AA). White-on-blue-500 (3.68:1) and white-on-blue-400 (2.54:1) are
forbidden text pairings.

*Neutrals (KIA-Command structure, §3.1 of ui-design-system.md):* light — page
#F5F7FA `oklch(0.975 0 0)`, card #FFFFFF, input #F9FAFB, border #E5E7EB /
subtle #F3F4F6, text #1A1D23 (15.7:1) / secondary #6B7280 (4.50:1 AA) / muted
#9CA3AF; dark — page #0F1117 `oklch(0.178 0.013 270.6)`, sidebar #141720, card
#1A1D27, elevated #232738 (elevation via lighter surfaces, not shadows), border
#2A2D3A / subtle #1F2231, text #F0F2F5 (15.0:1) / secondary #9CA3AF (6.62:1) /
muted #6B7280.

*Status colors (platform, not tenant-themable):* success #10B981/#34D399,
warning #F59E0B/#FBBF24, danger #EF4444/#F87171, info #6366F1/#818CF8
(light/dark). As badge/UI fills only (≥3:1 with computed foregrounds); any
status color used AS text gets a derived `-text` variant meeting 4.5:1 (the
ui-design-system §12 auto-fix pattern) — exact ramp values land in H-02 with
the same contrast script.

*Typography:* **Inter** (300–700), self-hosted WOFF2 (no font CDN — Law 25);
scale per ui-design-system §4; `tabular-nums` mandatory on money/number columns.
*Radius:* **0.5rem (8 px, `md`)**. *Density:* `comfortable` default (44 px
rows) + `compact` mode (34–36 px) as a token swap.

**Alternatives considered:** Boréal (teal, r12 — distinctive but collides with
teal/cyan pipeline-stage chips), Indigo Atelier (primary identical to the info
status color), Ardoise et Ambre (primary identical to the warning token;
dark-first inverts the platform default), Rouge Concession (red primary reads
as danger platform-wide). Nordique is the only direction with zero
semantic-color collisions and the strongest white-label canvas.
**Consequences:** H-02 encodes these as the `packages/ui` token layers, themes
shadcn/ui against them, and proves both themes ≥4.5:1 text contrast; tenant
branding still overrides semantic tokens at runtime (ADR-018). Stitch renders
(projects "ReadyLoans H-01 — Direction 1–5") remain reference only. Comparison
board artifact regenerated on the laptop account:
https://claude.ai/code/artifact/dc86eca3-b71f-452c-a046-24cb54d06b12
**Decided by:** user (owner pick: "go with 1")

## D-023: Product name amended — "Dealpilot" → "1Dealer" (2026-07-23) [HUSSEIN]

**Status:** accepted (amends D-020 §1; D-021 domain unchanged; initially
recorded as D-022 — renumbered after the same-day collision noted in D-024)
**Context:** Owner instruction this session while confirming the H-01 design
pick; verified with the owner that the domain stays `1dealer.ca` (".co" in the
original message was a typo) and the rename is real, not domain-only.
**Decision:** The product/brand name is **"1Dealer"** (domain `1dealer.ca`,
matching D-021). All new user-facing naming (UI wordmark, login page, emails,
docs, AI persona default copy) says "1Dealer"; "Dealpilot" and "ReadyLoans"
are historical.
**Consequences:** White-label default branding (H-02+) uses "1Dealer".
Engineering identifiers are NOT renamed by this entry — package scope
`@dealpilot/*`, repo name `FOURDE1/Dealpilot`, and root package name are
AHMAD's zone; folding the identifier rename into the A-09 doc/rename sweep (or
deciding to keep the scope as-is) is flagged for AHMAD in the session log.
**Decided by:** user

## D-022: A-04 database conventions — tenant key naming, RLS write rules, role credentials (2026-07-24) [AHMAD]

**Status:** accepted
**Context:** Code review of the foundation migration (2 critical findings, both
verified live against Postgres) plus naming divergence between the plan docs
and the A-03 schemas.
**Decision:**
1. **`organization_id` is the canonical tenant key** (GUC `app.org_id`) —
   matching `@dealpilot/schemas` (A-03), superseding the plan docs' `tenant_id`
   naming. Future CI lints/pgTAP templates adapt to this, not vice versa.
2. **`WITH CHECK (true)` is banned in practice as in policy:** every write
   policy requires tenant context at minimum (`app.org_id IS NOT NULL`);
   user visibility flows only through ACTIVE memberships.
3. **Same-org structural integrity by FK:** `memberships(organization_id,
   store_id)` references `stores(organization_id, id)` — a membership can
   never point at another org's store.
4. **No credentials in git:** `dealpilot_app` is created NOLOGIN by the
   migration; LOGIN + password granted per environment (dev: local `db reset`
   bootstrap; staging/prod: Secrets Manager at provision).
5. **User INSERT+RETURNING is impossible by design** (SELECT policy needs a
   not-yet-existing membership) — A-05 creates users with client-generated
   uuids, user + membership in one `withTenant` transaction.
6. Deferred columns noted for later migrations: `organizations.country`,
   `stores.tax_region`, `memberships.invited_by/revoked_at`, `deleted_at` on
   users/memberships.
**Consequences:** RLS suite covers fail-closed reads, cross-tenant
INSERT/UPDATE, membership-gated user visibility; `RLS_REQUIRED=1` makes CI
fail rather than skip when the DB is absent. Local Postgres runs on host port
5434 (5432/5433 occupied by unrelated local projects).
**Decided by:** claude-proposed (AHMAD), from code-review findings

## D-021: Domain = 1dealer.ca; terminal-git workflow, no pull requests (2026-07-24) [AHMAD]

**Status:** accepted (amends D-019/D-020 and TEAM-WORKFLOW §7)
**Context:** Owner decisions after GitHub adoption.
**Decision:** (1) The product domain is **`1dealer.ca`** (not dealpilot.ca) —
use it for the app, tenant subdomains (`<store>.1dealer.ca`), email sending
domain, and API host planning; product name remains Dealpilot. (2) The git
workflow is **terminal-only**: no pull requests, no GitHub UI dependencies, no
server-side branch protection — feature branches are squash-merged into
`develop` locally and pushed; `main` stays release-only by protocol rule.
GitHub is the shared remote (also enables the laptop) and A-02 CI runs on
**push** to develop/main rather than on PRs.
**Consequences:** faster flow, discipline enforced by TEAM-WORKFLOW rules +
quality gates instead of server settings; CI still guards every push once A-02
lands. Domain configuration (Route 53, ACM, Resend, Better Auth URLs) targets
1dealer.ca everywhere.
**Decided by:** user

## D-020: Client answers received — platform is "Dealpilot"; five decisions closed (2026-07-24) [AHMAD]

**Status:** accepted
**Context:** The client (Hassan Al Khansa, 2026-07-23) answered all five open
questions from `reference/kia-tracker-specs/docs/new/00-overview/CLIENT-QUESTIONS.md`.
**Decision:**
1. **Name = "Dealpilot"** — packages renamed `@dealpilot/*`, root `dealpilot`,
   repo `github.com/FOURDE1/Dealpilot`. Plan docs keep "ReadyLoans" historically
   (same product); deep doc rename is backlog task A-09.
2. **Lead volume:** plan for 300+/month per dealership across all sources
   (no exact split available) — sizes AI budget and queue capacity.
3. **Bill of sale:** Merlin & other platforms keep producing it for now;
   Dealpilot's own BOS ships as an optional per-store feature.
4. **Delivery checklist:** per-store BACKEND CONFIGURATION — each store selects
   which checklist items are absolutely necessary (gating) vs optional. Ships
   as store settings; the QC/ON difference is configuration, not code.
5. **Wholesale:** access is granted per-user by the main admin — a grantable
   permission, not a fixed-role assumption.
**Consequences:** GitHub becomes origin (D-019 executed); reference material
(plan + legacy code) imported into the repo at `reference/` so any machine is
self-contained; A-09 doc-rename sweep queued.
**Decided by:** user (client answers relayed by owner)

## D-018: Feature-based delivery with owner acceptance gate (2026-07-24) [AHMAD]

**Status:** accepted
**Context:** The owner wants visible, testable progress and confidence: after
the infrastructure/foundation stage, features must not pile up half-integrated.
**Decision:** After Sprint-1 foundation, all work is organized as vertical
feature slices (`F-nn`): one user-visible feature at a time, both agents build
it together, and it reaches `ACCEPTED` only after the OWNER personally tests
and confirms it. No new feature starts while one awaits owner testing.
Bundles (features that only work together) are declared up front and accepted
as a unit. Full protocol: TEAM-WORKFLOW.md §12.
**Alternatives considered:** free-flowing parallel tracks (rejected — integration
debt and nothing demonstrable); milestone-only demos (rejected — feedback
arrives too late to steer).
**Consequences:** slightly lower raw throughput, much tighter feedback loop;
the board gains F-rows with AWAITING-OWNER-TEST/ACCEPTED statuses; every
feature ships with "how to test" instructions for the owner.
**Decided by:** user

## D-019: GitHub adoption incoming; Stitch on best free-tier model (2026-07-24) [AHMAD]

**Status:** accepted
**Context:** Owner will provide a GitHub repo so HUSSEIN can also work from a
laptop with the same account; and instructed that Stitch (H-01+) should use the
best model available **within the free tier** — never paid options.
**Decision:** When the owner provides the repo URL (+ `gh auth login`), GitHub
becomes `origin` (all branches pushed, `main` protected); the local bare repo
`../readyloans.git` is retired or kept as a mirror. Until then the local bare
remote stays. HUSSEIN: select Stitch's highest-quality mode that is free
(e.g. experimental/Pro mode within free generation limits) and stay inside
free-tier quotas.
**Consequences:** laptop workflow unlocked at GitHub adoption; A-02 (CI)
becomes actionable then. Design quality maximized at zero design-tool cost.
**Decided by:** user

## D-016: ts-rest 3.52 on zod 4 — accepted peer-dependency mismatch (2026-07-24) [AHMAD]

**Status:** accepted (re-evaluate at A-05)
**Context:** `@ts-rest/core@3.52.1` declares `zod ^3.22.3` as a peer, but the
platform standard is Zod 4 (ADR-016). Code review verified empirically that
import, `checkZodSchema`, and error responses all work against the built
`apiV1` contract on zod 4.4.3.
**Decision:** Ship A-03 on ts-rest 3.52 + zod 4; re-verify the pairing when
`@ts-rest/fastify` lands in A-05 and upgrade ts-rest if a zod-4-supporting
release exists then.
**Alternatives considered:** downgrade to zod 3 (rejected — ADR-016 fixes
zod 4 as the shared validation standard); drop ts-rest (rejected — typed
contract between the two agents is load-bearing for the workflow).
**Consequences:** a known-unsupported pairing is in the tree; risk isolated to
`packages/contracts` and surfaced at A-05 integration. Regression tests on the
contract package guard the behavior we rely on.
**Decided by:** claude-proposed (AHMAD), per code-review finding 11

## D-017: A-03 schema conventions — defaults, strictness, spec vocabularies (2026-07-24) [AHMAD]

**Status:** accepted
**Context:** Code review of A-03 found zod defaults leaking through `.partial()`
into PATCH inputs (an empty PATCH reset entities to defaults), strip-mode
inputs accepting unknown keys, and invented status vocabularies.
**Decision:** (1) Create inputs carry defaults; update inputs are explicit,
strict, defaults-free objects — regression-tested. (2) All request inputs are
`z.strictObject`. (3) Vocabularies are spec-exact: org status 7-value +
plan_tier from multi-tenancy.md §3; store status active/paused/closed;
membership status invited/active/revoked; lead source 19-value enum +
source_platform from leads.md §2.1. (4) Locale = `fr-CA`/`en-CA` (resolves the
spec's `fr`/`en` vs `fr-CA`/`en-CA` tension in favor of full BCP-47 tags,
default `fr-CA`). (5) Lead phone is the required contact channel (leads.md §1);
lead `score`/`status` are engine-owned, never client inputs on create.
**Consequences:** A-04 can generate DB CHECK constraints directly from these
enums; H-03 consumes a stable published contract; any vocabulary change is a
deliberate schema-package change, not an ad-hoc edit.
**Decided by:** claude-proposed (AHMAD), from code-review findings 1–10

## D-015: TypeScript backend re-confirmed (2026-07-24)

**Status:** accepted
**Context:** The database-platform re-plan (D-013) prompted the owner to re-check the backend language choice before build start.
**Decision:** Keep the backend on TypeScript — Fastify v5 on Node.js 22, TypeScript 5.9 `strict` across the whole monorepo (ADR-001/003 stand unchanged).
**Alternatives considered:** none seriously — re-confirmation, not a re-opening; the shared Zod contracts and single-language monorepo remain the rationale.
**Consequences:** No change to any plan or task; recorded so the re-confirmation is traceable.
**Decided by:** user

## D-014: Better Auth re-confirmed after Cognito comparison (2026-07-24)

**Status:** accepted
**Context:** With the move to single-vendor AWS (D-013), Amazon Cognito was compared as the AWS-native auth option.
**Decision:** Keep Better Auth 1.3+ (organization plugin, 10 roles, memberships, MFA, HTTPS-only cookies) as the auth stack — re-confirmed by the owner.
**Alternatives considered:** Amazon Cognito (rejected: no native organization/membership model matching Platform → Org → Store, weaker white-label fit, per-MAU pricing; ADR-006 alternatives already rejected Supabase Auth and Clerk).
**Consequences:** Zero auth rework — Better Auth was never Supabase-dependent; its tables simply live in RDS now (ADR-006 consequences note amended 2026-07-24). A-05 scope is unchanged.
**Decided by:** user

## D-013: Amazon RDS for PostgreSQL over Supabase (2026-07-24)

**Status:** accepted
**Context:** ADR-008 had chosen Supabase Postgres; the owner wants single-vendor AWS and VPC-private networking, and RDS was already the documented exit path (ADR-014). Taken before build start, the exit costs nothing — no data, code, or cutover exists to migrate.
**Decision:** Run the database on Amazon RDS for PostgreSQL 16 in `ca-central-1` — VPC-private (no public accessibility; ingress only from ECS task security groups), KMS-encrypted gp3, deletion protection, automated backups + PITR, credentials in Secrets Manager, RDS Proxy pooling at launch (`SET LOCAL` tenant context is proxy-safe); dev = local Docker Postgres, staging = db.t4g.small Single-AZ, prod = Multi-AZ db.t4g.medium (ADR-008 rewritten 2026-07-24).
**Alternatives considered:** Supabase Postgres (previous decision — superseded; its bundled Realtime/Storage/branching move to the documented fallbacks: Socket.IO + Valkey (ADR-004), S3 + sharp + CloudFront (ADR-013), testcontainers + staging snapshot restores (ADR-023)); Neon (better branching, not needed); Aurora (cost/complexity unwarranted at this scale).
**Consequences:** Single-vendor AWS — one region, one jurisdiction, one bill; no service-role key exists at all (workers use scoped DB roles from Secrets Manager); dev DB access via bastion/SSM only; RLS/tenant model unchanged (ADR-007). Cost: build phase ~US$28–30/mo (inside the old Supabase range), production ~US$140–170/mo (+~$95–115) — production envelope restated ~US$750–1,100/mo (ADR-014). A-04 re-scoped: local Docker Postgres + RDS via IaC instead of a Supabase project.
**Decided by:** user

## D-012: Two-agent parallel build — AHMAD & HUSSEIN (2026-07-23)

**Status:** accepted
**Context:** Two Claude Code accounts are available; the build plan has parallelizable tracks.
**Decision:** Execute the build with two parallel agents personified as AHMAD and HUSSEIN: `main` protected, `develop` as integration branch, work branches `ahmad/<slug>` and `hussein/<slug>`.
**Consequences:** Task IDs are prefixed A-nn / H-nn; each agent self-reviews and the other reviews on merge to `develop`; SESSION_LOG entries name the agent.
**Decided by:** user

## D-011: AI error assistant (2026-07-23)

**Status:** accepted
**Context:** Dealership staff are non-technical; raw error surfaces cost support time.
**Decision:** Ship an AI-powered error assistant that turns user-facing errors into plain-language FR/EN explanations and suggested next steps.
**Consequences:** Needs a spec before implementation (scope, model task in `packages/ai`, no PII/secret leakage into prompts); complements — never replaces — the structured `AppError` envelope.
**Decided by:** user

## D-010: Blue-green deploys (2026-07-23)

**Status:** accepted
**Context:** ADR-014/023 defaulted to ECS rolling deploys with a circuit breaker, listing CodeDeploy blue/green as optional later hardening.
**Decision:** Adopt blue-green deployments (CodeDeploy on ECS) with automatic rollback as the production deploy strategy, promoting the ADR's optional path to the default.
**Consequences:** Cleaner instant rollback and traffic-shifted canaries; slightly more CI/CD and IaC setup in Phase 0/infra tasks; supersedes the rolling-deploy default in ADR-014/023.
**Decided by:** user

## D-009: Stitch-first design selection (2026-07-23)

**Status:** accepted
**Context:** The UI needs a professional visual direction before `packages/ui` theming is built; the owner wants to choose from concrete options, not descriptions.
**Decision:** Select the design direction Stitch-first — generate candidate designs in Google Stitch, have the owner pick, and use the selected design to seed the `packages/ui` design system.
**Consequences:** Hussein's first task (H-01) is the Stitch design round; UI build waits on the selection; tokens/themes derive from the chosen design.
**Decided by:** user

## D-008: No Tailwind Plus — professional UI via Tailwind v4 + shadcn/ui (2026-07-23)

**Status:** accepted
**Context:** ADR-017 and open question Q-09 carried Tailwind Plus ($299) as an optional purchase for marketing/site chrome.
**Decision:** Do not purchase Tailwind Plus; achieve the professional UI bar with Tailwind CSS v4 + shadcn/ui (Base UI) alone.
**Consequences:** Closes Q-09; any marketing chrome is built from the same design system; AG Grid Enterprise remains deferred per ADR-017.
**Decided by:** user

## D-007: Commercial VIN decode service (2026-07-23)

**Status:** accepted
**Context:** Free NHTSA vPIC data is weak on Canadian-market vehicles.
**Decision:** Use a commercial Canadian-aware VIN decode service (e.g., DataOne), selected by a short accuracy evaluation; NHTSA vPIC is a development-only fallback, never production (ADR-016 amendment).
**Consequences:** Adds a paid provider + an evaluation task before inventory/desking VIN features ship.
**Decided by:** user

## D-006: Lead intake as a configuration-driven connector framework (2026-07-23)

**Status:** accepted
**Context:** Lead sources churn constantly; hand-coded parsers per source don't scale.
**Decision:** Build `apps/intake` as a generic connector framework — every source is a connector definition (transport, field mappings, auth/signature, dedupe key, consent basis) as data, not code (ADR-005 amendment).
**Consequences:** Known sources ship as built-in definitions; any new source is added via configuration alone.
**Decided by:** user

## D-005: Model-agnostic AI layer (2026-07-23)

**Status:** accepted
**Context:** Model quality/pricing shifts faster than release cycles; hardcoding models creates lock-in.
**Decision:** Make the AI layer model-agnostic — Claude Opus 4.8 (conversation) and Haiku 4.5 (extraction) are launch defaults chosen by a built-in eval/A-B harness in `packages/ai`; model assignments are configuration, swappable per tenant and per task without code changes (ADR-022 amendment).
**Consequences:** The eval harness is a build deliverable, not an afterthought; model choices are re-evaluated as new models ship.
**Decided by:** user

## D-004: Admin-managed pricing (2026-07-23)

**Status:** accepted
**Context:** Pricing changes must not require deploys or hand-edits in the Stripe dashboard.
**Decision:** Manage subscription plans, prices, and entitlements entirely from the platform admin console — Stripe products/prices created/updated via API from the admin UI, with per-tenant overrides and grandfathering; pricing is data, not code (ADR-024 amendment).
**Consequences:** Admin console scope grows (plan editor); billing/entitlement/quota reads all derive from the same tenant record.
**Decided by:** user

## D-003: Clean-start database — no legacy data migration (2026-07-23)

**Status:** accepted
**Context:** The owner confirmed all legacy tracker data is test data with no production value.
**Decision:** Launch production with a clean, empty database plus seed/reference configuration; no ETL, no reconciliation, no dual-run — the legacy system stays a business-rules reference only (ADR-026 amendment).
**Consequences:** Drops an entire migration workstream; commission plans and store config are entered fresh at tenant onboarding and validated against legacy rules; NFR-DATA-011 (migration fidelity) is void.
**Decided by:** user

## D-002: AWS hosting in ca-central-1 (2026-07-23)

**Status:** accepted
**Context:** Earlier topology drafts used Railway/Vercel; those keep compute outside Canada and lack enterprise procurement credibility.
**Decision:** Host all platform compute on AWS `ca-central-1` — CloudFront+S3 SPA, ECR + ECS Fargate behind ALB, WAF, Secrets Manager, KMS, Route 53 — with a minimal footprint during the build phase and the full production envelope (~$650–1,000/mo) only from launch (ADR-014).
**Alternatives considered:** Railway/Fly.io (cheaper, faster, but non-Canadian compute regions).
**Consequences:** Full Canadian residency for compute + data (Law 25); IaC (Terraform/CDK) in the monorepo is mandatory from day one; higher ops effort accepted by the owner.
**Decided by:** user

## D-001: Adopt the 26 founding ADRs as canonical (2026-07-23)

**Status:** accepted
**Context:** The planning phase produced 57 docs; the build needs a single decision authority.
**Decision:** Adopt ADR-001…ADR-026 in `../../kia-tracker-specs/docs/new/00-overview/ARCHITECTURE-DECISIONS.md` (dated 2026-07-21, amended 2026-07-23) as this project's founding decision set — every spec and implementation conforms; deviations require a superseding entry.
**Consequences:** Conflicts between older specs and the ADRs resolve to the ADRs; this log records only adoptions, amendments, and new decisions on top of them.
**Decided by:** user

## D-043: `leads.budget_cents` — monthly or total? (2026-08-14)

**Status:** accepted — two explicitly named columns (owner: "the most recommended and the best")
**Context:** conversation-engine.md §5 extracts `budget.monthly_budget_cents`
alongside `budget_type: 'monthly' | 'total' | null`, and writes back to a lead
column. The column that exists is `leads.budget_cents`, whose name commits to
neither, and the desking screen reads it.
**Options:** (a) `budget_cents` means TOTAL price budget; add
`monthly_budget_cents` for the payment figure. (b) `budget_cents` means the
MONTHLY payment; rename for clarity. (c) keep one column plus a `budget_type`
discriminator, matching the extraction shape exactly.
**Why it is not being guessed:** an extraction that writes a $450 monthly figure
into a column the desking screen reads as a $45,000 total is wrong in a way that
looks plausible on every screen it touches.
**Decision:** option (a), sharpened — `budget_cents` is RENAMED to
`total_budget_cents`, and `monthly_budget_cents` is added beside it (0037). Two
explicit names rather than one column plus a `budget_type` flag: a flag means
every reader must remember to check it, and the failure mode of forgetting is
silent, whereas `monthly_budget_cents` cannot be accidentally read as a total.
**Consequences:** the rename is a breaking change to `CreateLeadInput` /
`UpdateLeadInput` / the `Lead` read model. Safe today because nothing computes
with the column — it is only stored and echoed — and that stops being true the
moment desking reads it. Extraction write-back (§5) is now unblocked.
**Decided by:** user (2026-08-14)

## D-044: BullMQ namespacing — prefix, not a colon in the queue name (2026-08-15)

**Status:** accepted (implementation decision; no owner input needed)
**Context:** `QUEUE_DEFERRED_SEND` and `QUEUE_ASSISTANT_TURN` shipped as
`dealpilot:deferred-send` and `dealpilot:assistant-turn`. BullMQ 5 refuses a
colon in a queue name — a colon is its own Redis key separator — and throws from
the `QueueBase` constructor. The API and the workers therefore both crashed on
startup in any environment with Redis, which is every deployed one.
**Why it went eight commits unnoticed:** `createDeferredSendQueue` returns a
no-op when `REDIS_URL` is unset, and no local process sets it. The `Queue` was
never constructed, so the line never ran. 974 unit tests could not see it. The
new CI e2e job, booting the API against Redis for the first time, is what found
it — on its first run.
**Options:** (a) drop the namespace entirely and accept BullMQ's default `bull:`
keys. (b) keep the intent and move the namespace to BullMQ's `prefix` option.
(c) namespace by Redis logical database instead.
**Decision:** (b). `QUEUE_PREFIX = 'dealpilot'` passed as `prefix`, which
produces exactly the Redis keys the colon was reaching for, by the supported
route. Every `Queue` and `Worker` is constructed through a single `queueOpts()`
helper exported from `@dealpilot/contracts`.
**Why the helper rather than just passing `prefix` at each site:** the
half-applied version is worse than the crash. If one side sets the prefix and
the other does not, both processes are healthy and nothing throws — the API
enqueues under `dealpilot:` while the worker blocks on `bull:`, and every
deferred message waits forever for a consumer listening on different keys. A
crash announces itself; that does not. `queue-naming.test.ts` fails the build if
any call site skips the helper, and asks BullMQ itself whether a name is legal
rather than re-implementing the rule.
**Consequences:** no migration concern — there are no jobs in any Redis to
strand, because the queue has never successfully been created. F-32's
deferred-send path is now reachable for the first time and still unproven
end-to-end; the first real exercise of it is owed a test.
**Decided by:** Claude (implementation), 2026-08-15

## D-045: a contact merge does not move the audit trail (2026-08-15)

**Status:** accepted (implementation decision; deviates from FR-CON-003's wording)
**Context:** FR-CON-003 specifies that merging two customer records "moves
deals/leads/activity" to the survivor. Deals and leads move. Activity does not,
and cannot: `dealpilot_app` holds INSERT and SELECT on `activity_events` and no
UPDATE grant, so `UPDATE activity_events SET entity_id = ...` fails outright.
**Why the grant is right and the requirement bends:** merge is a permission
several roles hold. If it could re-point `entity_id`, anybody able to merge
customers could silently re-attribute past events to a different person — which
is the exact capability an audit trail exists to deny. A log that the
application can rewrite is not a log.
**Options:** (a) grant UPDATE on activity_events so the merge can re-point rows.
(b) leave the history attached to the record it happened to, and record where
that record went. (c) copy the events onto the survivor, leaving both.
**Decision:** (b). Migration 0042 adds `contacts.merged_into_contact_id`, set in
the same statement that soft-deletes the loser — a CHECK refuses a forwarding
address on a live record, so the two facts cannot be written apart. The
survivor's timeline reads its own events plus those of anything merged into it.
Rejected (a) because it trades an audit guarantee for a convenience, and (c)
because duplicated events double-count in any timeline that later follows the
pointer as well.
**Consequences:** identical on screen, opposite guarantee underneath — nothing
is ever rewritten. The merge response reports `activity` as a COUNT of events
that became reachable, not a number of rows changed; the field name is honest
about this only in the schema comment, which is worth revisiting if the number
ever appears in the UI. FR-CON-003's wording should be read as "the survivor can
see the history", not "the rows move".
**Decided by:** Claude (implementation), 2026-08-15

## D-046: `GET/PATCH /contacts/:id` were dead from F-35 to F-36 (2026-08-15)

**Status:** fixed in migration 0041 — recorded because the failure mode will recur
**Context:** both routes resolve the contact's organisation under `withUser`,
which sets `app.user_id` and deliberately not `app.org_id` (the point is to
discover the org before trusting a caller-supplied one). `contacts_isolation`
keys on `app.org_id`, so under withUser its USING clause evaluated
`organization_id = NULL` — never true. No contact was visible to anybody, the
lookup threw not-found, and both routes returned 404 to every caller including
the record's owner, for every contact, always. `leads` and `deals` each carry a
second SELECT policy for exactly this traversal; `contacts` was created without
one.
**Why nothing caught it:** the only F-35 cases touching those routes assert that
a RIVAL receives 404. They passed for the wrong reason — the rival got 404
because nobody can read a contact by id, which is what the owner got too.
**The generalisable rule:** a test that asserts something is FORBIDDEN cannot
distinguish "correctly denied" from "broken for everyone". Every negative
authorization case needs the positive case beside it, in the same suite, or it
is measuring nothing. This is the same shape as the rival-list assertion that
was changed from `toHaveLength(0)` to absence-of-a-known-row earlier in the
build.
**Decided by:** Claude (implementation), 2026-08-15
