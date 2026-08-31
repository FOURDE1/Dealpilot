## 2026-08-31 (tick 31) — F-77: the snapshot page cannot show a credential by construction, and the console journey visits every read it can

**Where tick 30's CI story ended.** F-76 shipped as `c8efbc4` (run
33373590281, green) and its docs tail `590bedd` was green too (run
33374350641) — thirteen consecutive greens; `develop` was clean at `590bedd`
when this slice started, and this slice was built on that tip.

**How the slice was chosen.** The third slice of the 2026-08-31 scoping
(f75_scope §3): the tenant snapshot F-73 shipped as an API only — O-51 and
D-074 (7) both say so — and the console journey F-74 opened three of the
console's routes and left eleven named ones plus the catch-all unopened.
Zero new vocabulary was the constraint again. The panel (three planners:
secret-safety, console-coverage, smallest-visible; a judge ruling only; four
critics) chose `secret-safety` as the spine — the only plan whose guard was
what the brief demanded — and grafted console-coverage's Proxy access
recorder and settings-string reuse, and smallest-visible's measured
section-vs-route table, billing-role read and « no UUID on the page » rule.

**What the planners found before a line was written.** The scoping's own
premise was wrong twice: the F-74 org had NO store and NO key (T1 created only
the organization), so the scoping's « provisioned tenant » assertions would
have been vacuous; and the scoping's « twelve remaining routes » needed its
source named — D-075's « twelve other `/admin/*` routes », a correct count:
router.tsx had 13 named `/admin` children + index + `*`, F-74 opened three,
11 named + `*` = twelve remained (the F-74 header's own bullet listed eleven
names and no number). The 0069 caption idea for the rooftop table
(« not settable from the console ») had become false when F-76 shipped the
hours grid. The critics then measured what the rulings had assumed:
`admin_get_tenant_snapshot` does not exist (the definer is
`admin_tenant_snapshot`); `\bsecret\b` does not match inside
`webhook_secret` (the guard's regex needs no boundaries); the guard's
`[.?]id\b` pattern would have been satisfied by a rooftop's `s.id` even with
the header deleted (anchored to `d.` instead); OWNER-TEST-MASTER has no ROUND
3 and no curl for the owner to post a signed lead with (the stamp's semantics
are cited, not walked); O-51 is a single table row with no ⚠ block; the
SECURITY entry belongs under `## Audit log`, not at line 7.

**Built in four waves** (foundations: the 29-key `snapshot` namespace, the
`PROVIDER_KEYS` hoist, `BRANDING_STATE_KEYS`, the parsing hook and
`snapshot-fields.ts`; then the page, the router child and the link beside
« Utilisation »; then the guard + render tests ∥ the journey; then fourteen
mutations and the gate). Shipped: `tenant-snapshot-page.tsx` (six
`<section aria-labelledby>` cards in the order stores · keys · comms ·
branding | access · platform-last-and-dashed; the header from the snapshot's
own spread half with no second hook; every exact-text string in its own
element; no UUID in any text node; `BackLink` to the directory its words
name); `snapshot-secret-guard.test.ts` (the zod-v4 shape walk — 72 paths —,
the strip proof, the comment-stripped source scan with an identifier walk and
a bracket ban anchored to the data bindings, the 12 + 19 top-level
classification, `SECRET_NAME`'s non-vacuity, and — after the review — the
hook's source pinned to `return AdminTenantSnapshot.parse(res.body)` — 30
tests); `tenant-snapshot-page.test.tsx` (20 cases over the real bundles under
`strictIcu`: the honest comms states, the key partition in the definer's
order, the orphan store → « — », the bare and full rooftops, branding
none/draft/published/raw, the platform card last and dashed with no vendor
name, seats WITH the usage caption, the poison render, both locales, no
`text-primary` / `text-danger-text` on a healthy snapshot, the header
identity, no UUID in a text node, and the Proxy recorder over the honest and
the poisoned body — the one barrier no syntax evades); the journey
(`f74-console-door.e2e.ts` +234/−16: T1 mints a real store and intake key
tenant-side and asserts the credential SHAPES before any negative; T5 keeps
B's secret; T6 as billing reads detail → usage → snapshot with region-scoped
locators and the exact-value + 32-hex negatives over `#main`; T7 as A opens
support-sessions, announcements, platform-settings, queues, the DLQ page and
the `*` child — 7 of the 11 left routes + `*` + the new route; 4 deferred,
each a write). Deviations recorded by the builders: `STORE_HEALTH_COLUMNS`
lists `traffic_30d`, not `last_message_at` (it lives inside the traffic
object and the `satisfies` clause rejects it); the render manifest's case 1
was split into 1 (no row) and 1b (present row), so m6 reddens 1b; the two
switch names on platform-settings are asserted as level-2 headings (each
switch is its own `<section>`) rather than bare text; T6 clicks the org link
from within the slug-filtered row (the T3 idiom).

**Mutations, fourteen in the build and one more from the review, each red
then restored byte-identical (`sha256sum -c` after every one):** m1 (hook
cast + `Object.values` render) → guard (c), the poison case, the no-UUID case
and the poisoned recorder — the cast HALF alone reddens the guard's new hook
pin — and T6 stays GREEN,
because the wire never carries a credential: T6 step 7 witnesses the definer
and the schema, not the page, and D-078 (2) says so where the design had said
otherwise; m2 (`token` added to the key schema) → guard (a) and (b) and
`f73-snapshot` at :432/:456 through its :126 parse (the :423-425 raw-wire pin
stays green — a schema edit does not change the definer's projection); m3
(drop `connectors_active`) → guard (d); m4 (delete the « Instantané » link) →
T6 step 3; m5 (`sms_number ?? ''`) → render 3 and T6 :364; m6 (defaults
sentence unconditional) → render 1b; m7 (drop « identique pour tous les
locataires ») → render 5 and T6 :390, parity green (no ICU argument in either
heading); m8 (delete an en-CA key) → parity; m9 (`text-primary`) →
token-roles and render 9; m10 (a second `bootstrapSuperAdmin` importer) →
bootstrap-guard; m11 (drop `provider` from the column table while the page
reads it) → the recorder, with `tsc` green while mutated — the case that gives
the tables a consumer; the decoy `secret` read → the identifier walk, the
poison case and both recorder cases; printing `store_id` → the no-UUID case
and the store-name cell; deleting the header chips → the header case and
guard (d).

**Two defects outside the footprint, fixed because the gate required them.**
`parity.ts`'s `icuArgs` took the first word inside EVERY brace as an argument
name — every plural before this slice happened to start its branches with
`#`, and the first `=0 {Aucun connecteur actif}` / `=0 {No active connector}`
pair was a false args-mismatch; it is an ICU-aware walk now (heads only,
recursion into branch bodies), the `{min}`/`{minimum}` case still detects,
two cases added. And pnpm 10 forwards the `--` of `pnpm e2e -- --grep x`
literally, so Playwright dropped the filter and the WHOLE suite ran for the
command the runner's comment, PROJECT.md and ROUND 21.5 all quote — the
runner now drops one leading `--`; proven with « Running 7 tests using 1
worker ».

**Adversarial review: six lenses, refute-biased verification.** 21 raw findings, **15 confirmed, 6 refuted**, all six finders returned (27
agents, none died). The fifteen deduplicate to nine fixes — three lenses
found the same three things independently — and two of them are product
defects the design had ruled in and every test had passed. (1) The key
table's « — » store cell meant two opposite things: the design's premise was
that `intake_keys.store_id` is NOT NULL (0005:14), so a null could only be a
deleted store — but migration 0050:61 dropped the NOT NULL for
ORGANIZATION-LEVEL keys (the dealer group's ad-platform front door, which the
POST route accepts and `intake_resolve` serves as live, verified against the
applied schema), so a working front-door key and a dead orphan would have
read as the same dash beside « Active ». The page now prints the settings
pages' own « Organisation » for a null store and « — » only for a deleted
one, the comment cites 0050:61, and a render case pins each. (2)
`keysCaption` said a duplicate does not move « Dernier prospect accepté »;
the reviewer reproduced the opposite at runtime — the intake path has no
duplicate rejection, a verbatim re-POST is a 202 that becomes a lead the
product flags as a certain duplicate, and `f03-intake-routes.ts:542` stamps
`last_used_at` unconditionally in the same transaction, so the stamp moved
1.2 s later. The clause is gone from both locales; F-73's comment claim
(0069:473-476, D-074) had only ever been exercised with a bad signature, and
D-078 records it as false. The rest: barrier (b) was labelled « the HOOK »
while it parsed the schema directly — a cast in `useAdminTenantSnapshot` left
all 48 tests green (the poison and recorder cases already run with the hook
mocked, so no credential would have rendered; the label was the defect) —
renamed to the schema strip, and the guard now pins the hook's source to
`return AdminTenantSnapshot.parse(res.body)` with no `res.body as`, proven red
by the cast; `labelled` used `in`, which is true for `constructor` and
`toString` — a poisoned `z.string()` would have rendered blank or thrown
where the page promised « raw » — now `Object.hasOwn`, with `constructor` in
the unknown-word case; the two DataTables sat as a bordered card inside a
bordered card, the only nested DataTable in the product (measured at 1280 and
360 px in both themes; at 360 the inner box narrowed the scroll region to 292
px against the 326 px the same table gets on Réglages → Succursales) — the
two table sections now stand in page flow like every other table; the
STORE code comment claimed « four decimal digits » for an unpadded
`stamp % 10000` (one run in ten minted fewer) — padded; the T7 comments
cited runner lines this slice's own `--` fix had shifted by five, and a
render-test comment cited `labels.ts` lines the added import had shifted by
one — re-read at the tree; the header attributed the « twelve » to the F-74
wording when it is D-075's, and called a correct count prose — reworded; and
« Aucun travail en échec » was argued from within-run facts only while the
runner never clears the Redis it inherits (residual keys from today's vitest
gate were found on :6381) — the comment now states the cross-run premise and
the `redis-cli --scan` that tells an environment leak from a regression, and
the runner clearing the product failed sets is a recorded follow-up.
Refuted, and worth keeping: three cheap evasions of the source scan (an
aliased key, a `//` inside a string literal, a `Reflect.get`) are each caught
by the recorder or the poison render — the scan is one barrier of five, as
designed; a credential-shaped key under a nested object would be caught by
the shape walk, which recurses; « Version 2 » for a never-published draft is
the ruled behaviour (R8) and a real state (`tenant_branding.version`
increments on save); « Active » for a key whose endpoint cannot accept a
lead is the definer's own partition, and the intake path's 410 is a fact
about the tenant, not the key; « Connecteurs d'admission » is the
`tenant_connectors` table's own COMMENT; and the reused hours hint's « hors
de ces heures » reads correctly under the « Heures » column it follows.

**Gate after the fixes:** `pnpm turbo run build typecheck lint` 25/25 tasks (21 cached); `RLS_REQUIRED=1 REDIS_URL=redis://localhost:6381 npx vitest run` → **186 files / 2082 tests, exit 0, no unhandled errors**; `node scripts/e2e.mjs` → **59 passed in 2.2 m against dealpilot_e2e_test rebuilt from migration zero (T1 8.6 s, T6 5.5 s, T7 6.0 s under 4 workers)**, lock released, nothing left listening. Dev database untouched: `platform_staff
= 0`, `users = 962`, 72 migrations (0070 is the newest; this slice adds
none). Watch items, recorded and not explained: `f76-store-settings` T3 failed
once under 4 workers in an accidental full run during the build (green in
isolation and in every deliberate full run; the call log resembles the F-69
remount D-077 fixed — a fill landing before the store query resolved), and
one vite « ws proxy socket error: read ECONNRESET » stderr line between two
passing tests in one full run.

**Docs:** D-078 at the top of `DECISIONS.md`; ROUND 24 (the support call's
screen, and what it can never show) and ROUND 21.5's expected cell (« seven
steps », not five); O-51 resolved in one cell; `PROJECT.md`'s snapshot row no
longer « API only »; `TASKS.md` F-77 row under F-76's; `SECURITY.md` gains a
dated Audit-log entry above F-74's for the exposure guard.

**Pushed as FOURDE1; the CI run id is recorded in the follow-up docs commit, as ticks 29 and 30 were.**

## 2026-08-31 (tick 30) — F-76: the rooftop is configured from the screen, and the assistant reads the clock it was promised

**Where tick 29's CI story ended.** F-75 shipped as `6d00de3` (run
33360845396, green) and its docs tail `4dd004f` was green too (run
33361339334) — eleven consecutive greens; `develop` was clean at `4dd004f`
when this slice started, and this slice was built on that tip.

**How the slice was chosen.** The runner-up of the 2026-08-31 scoping:
admin-console.md §10's tenant settings — store operating config and the
assistant/comms config — every column of which already had consumers in
production code and no screen. Zero new vocabulary was the brief's
constraint and the slice's point. The panel (three planners: zero-vocabulary,
owner-runbook, smallest-visible; a judge ruling only; four critics) chose
`owner-runbook` as the spine.

**What the planners found before a line was written — the brief had it
wrong in five places, and every one was measured.** The assistant did NOT
read `business_hours`: `assistant-turn.ts:174` fed `hoursText: null` and
`:195` `withinBusinessHours: true` while the prompt already printed the
fields — every customer was told the store was open; `holiday_dates` had
zero readers. pg returned `date[]` as local-midnight `Date`s, so
`'2026-12-25'` came back as `2026-12-24T22:00:00.000Z` on this UTC+3 desktop
(CI, on UTC, would have stayed green). The F-30 « one number, one store »
409 carried no field path (`idx_stores_sms_number` absent from
`CONSTRAINT_PATHS`; the f30 test asserted only `>= 400`). `PUT comms-config`
compared `HH:MM` inputs against `HH:MM:SS` stored values as strings, and an
inverted window was a 500 (the DB CHECK, unmapped). No route writes a
per-store comms row although the table supports one. The judge ruled on
each: wire the EXISTING consumer inside the producer slice (a grid whose
only reader is a snapshot boolean is a producer for a boolean the owner
cannot see); a store-row serialiser at all four store exits with
`Store.parse` pinning it in UTC CI; the `CONSTRAINT_PATHS` entry; normalised
operands and the existing `invalid_window` key (a critic-proposed
`check_violation` was struck as new vocabulary); the per-store override
deferred with its route as the un-cut condition.

**Built in three waves** (schemas first — both sides depend on the tightened
`Store.holiday_dates`; then core + api + workers ∥ i18n + web; then the two
e2e specs and the gates). Shipped: `packages/core/src/store-hours.ts` (20
golden cases incl. the 2026-03-08 DST morning and fourteen holidays in a
row); the worker's hoisted SELECT (`holiday_dates::text[]`, the comms cap)
feeding the four prompt fields and `maxMessagesBeforeHandoff`; `storeRow` +
`local-date.ts`; `CONSTRAINT_PATHS.idx_stores_sms_number`; the f15
normalisation + pre-check; an additive `/settings` group (index of ten
sections mirroring their target pages, stores list, automations page — 3
routes, nothing moved); the store form's « Exploitation » fieldset (timezone
select + « Autre (nom IANA) » on edit AND create, phone, number, a seven-row
hours grid backed by a pure reducer, a holiday list with a calendar refine)
disabled as one `<fieldset>` without `store:update`; the automations form
disabled without `organization:update`; a « Réglages » link on the org page
for phones; i18n `nav` 2 + `orgs` 41 + `settings` 58 keys in both locales;
guards: `sections.test.ts` (router-parsing route existence), the 200-draft
hours-grid ⇔ `UpdateStoreInput` property test, the holiday-list ⇔
`HolidayDatesShape` lockstep, `nav.test.ts` (seven phone items, `/settings`
desktop-only), the token-roles tree scan over every new .tsx; two e2e specs
(`f76-store-settings`, `f76-automations`; own owners; `timezoneId`
America/Toronto pinned because the consent card renders `deferred_until` in
the BROWSER zone; a « Directeur des ventes » invitation proving read-only on
both forms). Deviations recorded by the builders: `NAV_ITEMS` hoisted to
`app/nav.ts` (the shell reaches `document` at module load, so the nav unit
test could not import it); a pure `store-patch.ts` for the blank → `null`
rule; `f11-dispatch.e2e.ts`'s three « Ajouter » clicks scoped to the fleet
region because the holidays button now precedes it in the DOM; the daily-cap
label first narrowed to « Contacts lancés par l'assistant » — which the
review then refuted: `f19-send.ts` maps drips to the same originator, so the
shipped label reads « Contacts automatisés (assistant et relances) par
prospect et par jour », whose hint promises only what holds — an
assistant reply to an inbound message is never held back by the cap.

**Mutations, each red then restored byte-identical:** schemas (drop the
calendar refine, loosen the regex, `max(61)`, drop the no-throw guard —
which proved zod 4 runs the refine after a failed regex); Wave A (drop the
`CONSTRAINT_PATHS` entry → f30; `storeRow` off GET or LIST → f01 at
`Store.parse`, in UTC+3 AND `TZ=UTC`; the slice or the pre-check → f15; the
worker constants or `!known ||` → the worker); Wave B (plant `text-primary` →
token-roles; delete one en-CA key → parity; a dead section link → sections;
rename `leads/scoring` → sections; drop `mobileHidden` → nav). One scripted
revert (the `constraint` mutation's `};` anchor is not unique in f01) failed
and was restored by hand to the baseline sha — the runner script's anchor
needs fixing before reuse.

**Adversarial review: six lenses, refute-biased verification.** 17 raw
findings, **10 confirmed, 7 refuted**, all six finders returned this time.
Four majors, each a product defect the build had introduced and every test
had missed. (1) A holiday whose year is below 1000 was accepted by the new
calendar refine (JS has a proleptic year 0; Postgres does not), stored
correctly, and then serialised by `local-date.ts` as `1-01-01` — month and
day were padded, the year was not — at every store exit; the row then failed
the very `Store.parse` this slice added, and because the stores list parses
as a whole, ONE such date would have taken down `/settings/stores`, the
organization page's store table and the eleven other pages that call
`useStores`, with no way to open the offending store to remove it; year
`0000` was a 500 (pg 22008). Fixed at both ends: the year is padded, and the
refine — in the schema and its byte-identical client mirror — now bounds the
year to 1900–2199, with the sub-1000 and year-0 cases in the
f01 round trip (422 on `holiday_dates.0`) and in the holiday lockstep. (2) A
holiday on a store with NO hours grid was ignored — `storeOpenState` returned
"unknown" before it consulted the holiday set — so the assistant would have
said open on a day the owner listed as closed, while the holidays hint
promised « fermé toute la journée »; a listed holiday now reads closed all
day whether or not a grid exists, golden-cased and worker-cased. (3) The
coarse follow-up phrase named a weekday for openings seven to thirteen days
out — « lundi » for a Monday eight days away promises a follow-up a week
early; weekday names now stop at six days and the neutral phrase takes over,
with golden cases at the boundary. (4) The daily-cap label said « Contacts
lancés par l'assistant » for a cap that also governs drips (`f19-send.ts`
maps both `bot` and `drip` senders to originator `'ai'` and says so) —
reworded in both locales to automated contacts (assistant and drips), and
the hint now says what is true — an assistant reply to an inbound message is
never HELD BACK by the cap (`f19-send.ts` still adds every allowed
`ai` decision to the day's tally, so "not counted" would have been a claim
too). The minors: the
hours-grid property test's generator never hit `24:00` and rested two named
cases on single seeded draws (explicit boundary cases added, the loosened
rule mutated to red); a dead `disabled` prop on the grid and the holiday
field (the surrounding `<fieldset disabled>` is the producer — removed); the
holiday lockstep bound a function the form never calls (re-bound to the
form's path); keyboard focus fell to `<body>` after « Retirer — {date} » (it
moves to the neighbouring button or the date input); the `store-hours-hint`
id had no `aria-describedby` reader (wired); an e2e comment misattributed
the store page's other « Ajouter » buttons (intake uses « Créer la clé »).
Refuted, and worth keeping: the `store:create` gate on the stores list is
the base design verbatim; exports with no importer are the repo's norm, not
its law; the save button's focus-to-body is pre-existing across the app; the
360-px horizontal scroll on the stores list is the platform's recorded
list-table convention; the automations spec's daytime `pickWindow()` branch
being unexercised was self-recorded by the builder (both build runs and all
five review runs started before 09:00 Toronto).

**Gate after the fixes:** `pnpm turbo run build typecheck lint` 25/25 tasks (17 cached); `RLS_REQUIRED=1 REDIS_URL=redis://localhost:6381 npx vitest run` → **184 files / 2028 tests, exit 0, no unhandled errors**; `node scripts/e2e.mjs` → **57 passed in 2.2 m against dealpilot_e2e_test rebuilt from migration zero — after run 1 of the gate had failed two pre-existing specs under load (f40's assignee row and F-74 T3's directory search; both green in every other run), T3's failure turned out to have a real cause — F-69's directory form was keyed on the plans query and remounted when plans arrived, wiping the typed search — fixed by keying only the plan select, then T3 5/5 and the whole suite 57/57 twice**, lock released, nothing left listening Dev database untouched: `platform_staff
= 0`, `users = 962`, 72 migrations (0070 is the newest; this slice adds
none). Read-only probe before the build: 701 live stores, none with holidays
or hours — the first owner-saved holiday would have parsed as a timestamp
until the serialiser landed.

**Docs:** D-077 at the top of `DECISIONS.md`; ROUND 23 (23.10 is the
sales-manager ⚠ DECISION); `OWNER-ACTIONS.md` §1's fenced PATCH replaced by
the screen path — the last curl in the runbook; `TASKS.md` gets its first
slice row since S-01, with the caveat that F-19…F-75 were never on that
board; `PROJECT.md` gains one how-to row. `SECURITY.md` unchanged — no new
surface, no permission touched.

**Pushed as `c8efbc4` (56 files, +5129/−108). CI GREEN first try — run
33373590281, both jobs** (lint/typecheck/test/build and the real-browser e2e),
verified with `gh run view 33373590281 --json conclusion`. **Twelve consecutive
greens.** No migration to apply to the dev database this time (0070 stays
the newest). Next: F-77 — the tenant snapshot console page and the console's
browser coverage (O-51), the scoping's third candidate.

## 2026-08-31 (tick 29) — F-75: the published brand paints the app, and the proof moves to the surfaces the app actually paints

**Where tick 28's CI story ended.** F-74 shipped as `07fced4` (run
33347003133, green) and its docs tail `730053e` was green too (run
33347453809) — nine consecutive greens; `develop` was clean at `730053e`
when this slice started.

**How the slice was chosen.** A read-only scoping pass ranked five
buildable, owner-free candidates against the plan under the repo's laws:
brand paint (this), tenant settings core (`/settings/stores` +
`/settings/automations` — zero new vocabulary, the runner-up and the natural
F-76), the tenant snapshot console page (O-51), commission clawbacks (a CHECK
value with zero producers), the staff e-mail channel (buildable, reach gated
by SES). Brand paint won on law pressure: the editor's « Publier » had been a
claim the product did not honour since F-14 — six colours, font, density and
dark mode published, and only the name, the radius and the focus ring
painted; ~80% of `PublishedBranding` was a produced payload with no consumer.

**What the panel found before a line was written.** All three planners,
independently, measured the same pre-existing defect: `packages/core`
proved every text tone and ring against **pure white** (`SURFACE_LIGHT` at
L = 1) while the app paints its page `#F5F7FA` and its muted surfaces
`#F3F4F6`. Re-measured here through core's own dist: for `#FDE047`,
`text.primary` is 4.502:1 on white — right at the floor, by construction —
but **4.195:1 on the page and 4.091:1 on muted**, and the focus ring, which
F-14 already injected, is **2.795:1 on the page** against a 3:1 floor. An AA
guarantee proven on a surface the app never paints was not a guarantee, and
twelve published brands on the dev database carried such values. The judge
(rulings only, plans on disk — the F-72 lesson) picked `aa-by-construction`
as the spine; four critics returned `buildable_with_fixes` and the amend
stage turned their 12 blockers, 33 gaps and 26 wrong facts into 23 binding
amendments — among them a round-trip precision defect the design itself had
just introduced (the float passed at 4.5000042 while the formatted OKLCH
string measured 4.4999999), the dead-zone fills where neither label reaches
4.5 (`#E11D48` 4.4988, `#6366F1` 4.4311, `#DB2777` 4.4025), a cascade leak
(a light `:root{}` block beats tokens.css's `[data-theme="dark"]` whenever a
dark half is omitted), the heatmap's opacity ramp (a tenant success fill at
60% over the card measured 2.45:1 with a label computed for the solid fill),
eleven `accent-[var(--primary)]` checkbox sites no rename pattern could see,
and a "34 px row" claim all three plans made about a page whose rows carry
36 px buttons.

**Built in three waves with disjoint ownership** (core + ui + the class
migration ∥ schemas + 0070 + api + i18n; then the web runtime + editor; then
the e2e and the mutation manifest). The role split: `--primary` is fill-only
and a new `primary-text` token (today's blue-600/blue-400, so the platform
look does not move) took every text, border and accent site — one command
over `apps/web/src`: 46 `text-primary` class sites (47 grep lines, one a
comment) + 3 in `packages/ui`, 1 `border-primary`, 7 `accent-primary`, 11
`accent-[var(--primary)]`, 6 `border-destructive` → `border-danger-border`,
`git diff --stat` 38 files / 70+ / 70−, plus the hand edits (the unlabeled
usage and win-loss bars, the `/75` opacity, the sidebar hover label).
`token-roles.ts` holds rules 1–7 as a pure matcher: 154 files scanned, 85
violations at the base tip, 0 after. Core: `SURFACE_LIGHT = #F3F4F6`,
`SURFACE_DARK = #232738` pinned to the ui tokens by a lockstep test;
`readableOn`/`ringFor` verify the STRING that ships; dead-zone fills are
nudged toward their label and recorded as `fills.<name>` adjustments;
`hoverFill` keeps the base label. `brand-style.tsx` is a table of 18 rows —
fills with their foregrounds as units or not at all, three proof groups
re-proven in the SPA against the same surfaces so a stale snapshot is gated
rather than painted, `--accent-foreground` from the brand text tone
unconditionally, `accent_color` finally consumed by the sidebar highlight,
`--danger-border` from `ring.danger`, warning/info rows removed and their
editor fields hidden (no component paints those fills), the light block as
`:root:not([data-theme="dark"])`. Density has readers (DataTable rows/cells,
inputs via a new `--input-h`), `BrandMark` renders `<img src>` through the
sandboxed asset route with `organization_id`/`store_id`/`v` — the first
consumer of the `dark:` variant — the favicon is one `<link rel=icon>`, page
titles read a context only `AppLayout` provides, the dark lock lives in
`theme.ts` and preserves the stored preference, and the shell shows a neutral
skeleton instead of the platform palette on first paint (prefetch in
`RequireAuth`, gate in `AppLayout`). Migration 0070 retires
`dark_mode='custom'` / `font_family='custom'` and the two WOFF columns under
`SET LOCAL row_security = off` with a scoped snapshot rewrite and a DO block
that fails rather than passes vacuously; on the dev database the rewrite is a
no-op for values (0 `custom`) and touches 72/72 published snapshots for the
key scrub — the header says so; `branding-vocabulary.test.ts` pins CHECK ⇔
Zod set equality for all four branding enums. The editor renders
`FontFamily.options`, hides warning/info, and gains the « Logo et favicon »
uploads — OWNER-TEST 14.9–14.11 were unreachable until now.

**Mutation manifest, executed on the real tree with sha-verified restores:**
plant `text-primary` / strip a fill's label / plant `accent-[var(--primary)]`
→ token-roles red; revert `SURFACE_LIGHT` to white → lockstep + two
brand-style cases red; re-add `custom` to `DarkMode` → enum-vocabulary +
branding-vocabulary + the 422 test red; skip the pair gate, emit the light
block as `:root{}`, drop the `requires` check, zero the on-surface floor →
brand-style red; delete the `--primary-text` row (alone: brand-style red;
all three `text.primary` rows: brand-consumers (a)(d)(e) red); delete the
`dataset.density` line or mention `.density` only in a comment → (f) red;
move a tuple to an unread or never-produced cell → (a)(b)(d) red; add a
`--warning` unit without `TENANT_FILLS` → (a)(e)(g) red; 0070 without the
snapshot rewrite → the DO block fails the migration, without the DO block →
the rewrite test red, without the DROP COLUMNs → two tests red; disable the
round-trip loop / the dead-zone adjustment / the hover label preference →
core red; light `primary-text` blue-600 → blue-500 → six gate pairs red.

**Adversarial review: six lenses, refute-biased verification — and one
lens that had to be run twice.** The first pass returned 19 raw findings,
**14 confirmed, 5 refuted** — but its contrast finder died mid-response
(`agents_error: 1`), and a partial review is not a verdict (memory: check
`agents_error` before trusting one), so that lens was re-run alone on the
fixed tree: one raw finding, confirmed minor and fixed — under a PALE tenant success colour the heatmap's two hottest steps (the tenant fill) painted lighter than the platform-tint steps below them, so the header's "five-step intensity scale" was false for that brand (#ECFDF5 → luminance 0.947 against the tint's 0.876, indistinguishable from an empty cell); the `success` unit is now held to its consumer's invariant in `brand-style.tsx` (darker than the tint on light, lighter than it on dark, else gated and the platform fill applies), the ramp test asserts the ordering for the platform palette, and a pale-success case proves the gate (mutation: invariant disabled → red). The confirmed fourteen collapsed into ten fixes. The
BLOCKER was a refetch loop nobody had run into because every test path
succeeded: `AppLayout` gated the shell on `data === undefined &&
isFetching` while `BrandStyle` owned a SECOND `usePublishedBranding()`
observer, so an errored `GET /api/v1/branding` (retry off) opened the gate,
mounted `BrandStyle`, whose fresh observer refetched the errored query,
which closed the gate, unmounted it, and round again — measured on the
unfixed tree with the route forced to 500: **1,215 requests in 15.6 s and a
`main` that never rendered.** Fixed by making `AppLayout` the only observer
(`BrandStyle` takes the branding as a prop and renders purely) and by a pure
`brandingGateOpen` = pending ∧ fetching, unit-tested on the truth table;
the new e2e Test 3 500s the route and asserts the shell renders with ≤ 3
requests on a cold load (StrictMode replays one subscription in dev;
production is 2) and zero growth across two navigations — fixed: 3, flat.
The MAJOR: `--radius` and the `system` `--font-sans` had been swept into
the light-only block, so dark mode silently reverted a brand's corners and
font — they live in a theme-independent `:root{}` now, with dark
assertions in the e2e. The rest: the consent panel's verdict stripes read
`var(--success,…)`/`var(--warning,…)`/`var(--danger,…)` as 4 px borders —
a tenant fill painted as a border on `card`, invisible for a pale success
brand — repainted with the proven on-surface tokens, and rule 5 widened
from `--primary` to every fill token so the guard sees that form; rules 2
and 6 widened to what their own header text claimed (side and offset
utilities, opacity on the `-hover` fills; +17 matcher cases); `BrandMark`'s
`failed` state that never reset (a transient logo failure hid every later
logo) made structural via `key={src}`; the `contrast.ts` header re-measured
(the shipped tone is `oklch(0.5413 …)`: 4.616 / 4.502 / 4.954 on
page / muted / card; Chrome 151 clips and quantises to `rgb(137,109,0)`:
4.603 / 4.489 / 4.940) and its parser made to accept signed sRGB channels,
with a new `contrast.test.ts` pinning every number it prints; the spec
header's "every colour is asserted ≠ the platform value" made true — all
twelve read-back cells are now compared in one colour space (the four
string compares of `rgb()` against `oklch()` that could never fail are
gone); two UNCONSUMED reason strings and the brand-document comment
reworded to what the code does; the editor's asset state line now decides
"live" by comparing the draft's key with the published snapshot's, not by
the draft's status. Refuted, and worth keeping: `stripComments` on `//`
inside a string (real, but the tree has no such site and the tree scan
would surface one), the guard's conditional-label blindness (recorded in
A8), a transparent-surface ratio (nothing asserts against a transparent
surface). Every fix was proven red on the unfixed tree first; 12/12 guard
mutations red with sha-verified restores.

**Gate after the fixes:** `pnpm turbo run build typecheck lint` 25/25 tasks (21 cached); `RLS_REQUIRED=1 REDIS_URL=redis://localhost:6381 npx vitest run` → **175 files / 1903 tests, exit 0, no unhandled errors**; `node scripts/e2e.mjs` → **48 passed in 2.4 m against dealpilot_e2e_test rebuilt from migration zero**, lock released, nothing left listening Dev database untouched: `platform_staff
= 0`, `users = 962`, still on 0069 — 0070 is applied to it with
`db:migrate` (never `db:reset`) after the push, and the twelve stale brands
there stay gated until republished (ROUND 22.1).

**Docs:** D-076 at the top of `DECISIONS.md` (the A/B/C role-split table as
rejected alternatives, the token contract, both retirements with their un-cut
conditions, the deferred list); ROUND 22; `TASKS.md`'s F-14 row closes its
"STILL TO COME"; `SECURITY.md` names `BrandMark` as the `<img src>` consumer
and 0070 as the fourth BYPASSRLS-dependent migration;
`HUSSEIN-F14-CONTRACT.md` marks the custom-font line retired. `PROJECT.md`
unchanged — no command moved.

**Pushed as `6d00de3` (88 files, +3946/−258). CI GREEN first try — run
33360845396, both jobs** (lint/typecheck/test/build and the real-browser e2e),
verified with `gh run view 33360845396 --json conclusion`. **Ten consecutive
greens.** The dev database took 0070 through `db:migrate` right after the
push: 72 migrations, the 72 published snapshots scrubbed of the WOFF keys,
both columns gone, both CHECKs narrowed, `platform_staff` still 0 and
`users` 962. Next: F-76 — tenant settings core, the runner-up of the
scoping (`/settings/stores` + `/settings/automations`, zero new vocabulary).

## 2026-08-31 (tick 28) — F-74: the browser suite gets its own database, and the console gets its first browser test without spending the owner's one-shot

**Where tick 27's CI story ended.** F-73 shipped as `e754022` (run
33311281418, green). The three pushes since — `9d4a974` (tick 27 itself),
`06c2eb3` (F-68 task-board store clock + F-67 empty heatmap e2e, and two
comments that had drifted) and `245b91e` (the owner-decision docs below) —
were green too: runs 33311699583, 33314215150 and 33314644925. **Seven
consecutive greens** since the abandoned-promise fixes; `develop` was clean
at `245b91e` when this slice started.

**The decision this slice answers.** The platform console (`/admin/*`,
thirteen routes) had no browser test, and the reason was structural: the
first `platform_staff` row has exactly one producer, the no-actor
`platform-grant` CLI path, which is legal only while no active super admin
exists — a one-shot per database (PA010). A test that took it on the dev
database would have made the owner's console permanently unreachable, the
same shape as the `db:reset` lockout (HO-07), so it was written up for him as
a `⚠ NEEDS YOUR DECISION` block with three options. He said "continue,
sticking to the plan"; option A — give e2e its own database — was taken
because it is the only one that needs no irreversible act on his machine,
and the block's own recommendation. His one-shot is still unspent:
`platform_staff` on `dealpilot` was 0 before this slice and is 0 now,
checked before and after every run.

**Design.** Three planners (safety-first, ci-parity, smallest-honest), a
judge who emits rulings only — the F-72 lesson that a judge re-emitting a
100 KB plan hits the output cap — and an adversarial critique; winner
`safety-first`, hardened into a binding document of 18 rulings and 24
amendments. The rulings that shaped the code: the database is
`dealpilot_e2e_test`, so `reset()`'s existing `/_test$/` guard permits it BY
NAME and `DB_RESET_CONFIRM` — the escape hatch that names the dev database —
appears nowhere on the e2e path; ONE Node runner (`scripts/e2e.mjs`) is the
only entry, locally and in CI, with no `env:` block in the workflow, because
`REDIS_URL` unset-here-set-there is exactly how F-72's whole local gate
became evidence about a program CI does not build; the API moves to 3101 and
the SPA to 5176 so `pnpm dev` stays up, and the runner REFUSES rather than
adopts when anything answers on its ports; the reset runs in the runner and
never in a Playwright `globalSetup` — verified in the installed
playwright@1.61.1 that webServer plugins start strictly before globalSetup
files, so the API would pool against a schema that does not yet exist; the
spec bootstraps its staffer by shelling out to the shipped `platform-grant`
verb with the `_test` name as a new guarded positional (apps/web gains no
dependency); the second staffer is minted from the console's own
`/admin/staff` form, the one console write this slice affords;
`adminNavItems()` is extracted so all three roles are unit-tested when only
one bootstrap can exist per run; and the orphan `dealpilot_e2e` database is
neither adopted nor script-dropped — its name does not end `_test`, so no
code on this path may touch it, and the owner has a one-liner.

Two proposals were rejected with the mechanism written down (D-075) so they
are not re-proposed: a logical Redis database index (`/1`) — the BullMQ
layer builds connections from hostname+port and DROPS the URL pathname while
presence/realtime honour it, so `/1` splits queues from pub/sub and looks
like isolation; and a read-only fingerprint of the dev database checked
before and after the run — observational under `retries: 0`, and it opens a
dev connection on the path whose thesis is that it has none. Replaced by two
static guards that run in `checks` and are mutation-tested to red.

**Build, interrupted twice.** The owner closed VS Code by mistake twice
mid-slice. The first killed the judge/critique run — resumed with
`resumeFromRunId` (5/6 agents cached; the script had to be copied into the
scratchpad because the tool refuses the `.claude-readyloans` path). The
second took Docker down with it (`db` and `redis` Exited 255) and killed the
build agent mid-tree with no cached result. Docker came back with `docker
compose up -d db redis`; a continuation agent was told to INVENTORY the
partial tree before building (a resume would replay a prompt blind to the
partial state) and found seven defects in it, one real: `process.exit(1)`
inside the `try` after the API spawn skips the `finally`, orphaning the API
on 3101 and blocking every later run at the port probe. Also: two guards
catching themselves (the bootstrap verb in the guard's own title; the reset
escape hatch named in comments the isolation guard scans), a `!` non-null on
the port, TS2769 under `noUncheckedIndexedAccess`. The journey is
`apps/web/e2e/f74-console-door.e2e.ts`.

**Adversarial review: six lenses, refute-biased verification.** dev-db
attacker, runner lifecycle, CI parity, journey flake, guard vacuity, claims
honesty — 22 raw findings, **14 confirmed, 8 refuted**, every one verified by
a second agent told to refute it. The two majors were one defect, and it is
this repo's recurring shape: the isolation guard's literal scan stopped at
the first space inside `${process.env.DEALPILOT_DB_PORT ?? 5434}`, so it
never saw the maintenance base's `/dealpilot` tail, classified the remainder
as a template and skipped it. Its "one exemption, deliberately" branch was
dead, its `<= 1` count passed on zero, and — proven by mutation — pointing
the API's own `DATABASE_URL` at `dealpilot` stayed GREEN: the free exemption
slot absorbed it. The design had demanded "mutation-test both" and the
literal clause was the one never mutated. It is template-aware now, the
maintenance base is recognised by name AND owner credentials, and the count
is `toBe(1)`. The rest, all fixed: two `pnpm e2e` started within the ~20 s
between the port probe and the API binding its port would both pass the
probe and the second would DROP the schema under the first one's live API
(a pid lock now, taken before anything destructive, stale-aware, released on
every exit path — the refusal measured at 62 ms); a signal-killed API left
`exitCode` null and the poll ran its full 90 s with the wrong diagnosis
(`signalCode` checked too); a pid-only SIGTERM to the runner skipped the
`finally` and orphaned the API (handlers installed after the spawn, proven
on Linux by the verifier); the 90 s timeout never said WHY — the verifier
cut the database out from under a live API and the message was identical to
"never bound the port", with an 80-line tail that was all the poll's own
200s (the last observation is reported and the poll's request pairs are
filtered out of the tail); the bootstrap guard counted a SUBSTRING, so the
journey's own header comment satisfied "exactly one importer" after the
import and the call were deleted (comments stripped before matching, and
the naive import-regex fix was itself refuted because it would have let a
namespace or dynamic second importer through); and six false claims in
comments and messages — "TWO copies" of the TOTP pair when five definitions
exist, `exact` "because the column headers are also labels" (getByLabel
never sees a `<th>`), a spawn "behaviour-identical" to the dev script except
that its cwd moved and the local document store is cwd-relative, "the dev
ports are NOT probed" that held only while nobody had exported
`DEALPILOT_*_PORT` (the ports are constants now), a refusal message that
asserted the squatter "is pointed at the DEV database" and in the next
sentence named an e2e orphan as the usual cause, and a `grep` recipe without
`-E` that is empty on any tree. Refuted, and worth recording: "upload-artifact
v7 excludes dot-directories, so `.e2e/api.log` is dead" — the pinned bundle's
filter tests each traversal item's BASENAME, an explicit file path starts
inside the directory, and the verifier ran the pinned dist against a mirror
tree and saw three files found; "dev `users` is 1128, not 962" — that count
was Better Auth's `"user"` table, the fingerprint script counts `users`, both
numbers are right and neither moved.

**Fixes verified before the gate:** ten guard mutations through a harness
with sha-verified restores — the isolation guard red on the staging default,
the API URL at `dealpilot`, a second owner-prefixed `/dealpilot` literal, the
base renamed `/postgres`, and a whitespace-bearing template in a spec; the
bootstrap guard red on import-and-call-deleted-prose-kept and on a namespace
second importer, and green on a second spec that names the helper only in a
comment. Then the manifest's remaining mutations on the real tree: a
capability guard deleted from `nav.ts` → `nav.test.ts` red; `DB_RESET_CONFIRM`
added to the `e2e:` job block → isolation guard red; the constant renamed
`dealpilot_e2e` or pointed at `dealpilot` → isolation guard red; a Redis that
does not answer → the PING preflight refuses; the API handed a non-`_test`
`DATABASE_URL` → the runner refuses before the spawn and releases its lock.

**Gate:** `pnpm turbo run build typecheck lint` 25/25 tasks (21 cached); `RLS_REQUIRED=1
REDIS_URL=redis://localhost:6381 npx vitest run` → **166 files / 1752 tests, exit 0, no unhandled errors**; `node
scripts/e2e.mjs` on a planted stale lock → taken over, **45 passed in 2.8 m against dealpilot_e2e_test rebuilt from migration zero**, lock
released, nothing left listening. Dev database: `platform_staff = 0`, `users
= 962`, untouched.

**Docs:** D-075 (top of `DECISIONS.md`, with both rejections); the
`⚠ NEEDS YOUR DECISION` block in `OWNER-DECISIONS-PENDING.md` replaced by
the resolution — its spec count retired with it, the phrase is *every
`*.e2e.ts` under `apps/web/e2e`*; `PROJECT.md`'s e2e section rewritten
around `pnpm e2e` with the `DB_ADMIN_URL`-wins precedence and the residual
Redis sentence; `OWNER-ACTIONS.md` (2026-08-31: how to run it, the one-shot
still his, the `DROP DATABASE dealpilot_e2e` line); `SECURITY.md` dated entry
plus the shared-Redis accepted risk; `OWNER-TEST-MASTER.md` ROUND 21.

**Meta-lesson, carried on the design's instruction:** two of the three plans
proposed fixing a "29 specs" comment in `ci.yml` that did not exist at
`245b91e` — and the design's own "the TWO-copies count is already correct,
do not re-fix it" was wrong in the other direction. A count in a plan is a
claim in the product; the count is the grep, never the sentence.

**Pushed as `07fced4` (27 files, +1932/-190). CI GREEN first try — run
33347003133, both jobs** (lint/typecheck/test/build and the real-browser e2e,
which now runs `node scripts/e2e.mjs` exactly as this desktop does), verified
with `gh run view 33347003133 --json conclusion`. **Eight consecutive greens**
since the abandoned-promise fixes. Next: the next slice per the plan.

## 2026-08-30 (tick 27) — F-73 usage, snapshot and the job inspector: numbers that name a row, and a retry that admits it can text twice

**Where tick 26's CI story ended.** F-72 shipped as `19a5c58` and CI run
33291117664 was green on both jobs. Then two DOCS-ONLY pushes went RED —
`43901b6` and `3b19860` — with the same signature both times: all 153
files and 1603 tests passing, vitest exiting 1 on `Error: Connection is
closed.` out of ioredis's close handler. Both were ours. A
`Promise.race([enqueue, timeout])` attaches its `.catch` to the RACE, so
when the timeout wins the enqueue promise is abandoned still pending, and
an abandoned ioredis command rejects unowned when the pool shuts down.
`ebee4b9` fixed the announcement fan-out site and `167b036` drained the
emit-only Redis clients with a PING before QUIT so the adapter's queued
`psubscribe` could not be the one left rejecting. Then an audit for the
same shape found a SECOND enqueue site nobody had looked at:
`apps/api/src/f03-intake-routes.ts`, F-59 code, on the intake ACK path
that exists to answer in under a second — the same abandoned-loser race,
fixed in `06f3e17` by observing the first-touch enqueue rather than the
race that throws it away. **Three consecutive green runs since**, and
develop is clean at `06f3e17` — tick 26's closing line ("develop is clean
at `ebee4b9`") is stale twice over.

**Say the cause plainly, because it invalidated every local gate in the
previous slice.** `REDIS_URL` is unset in this machine's `.env` and SET
in CI. Without it `createDeferredSendQueue` and its siblings return the
loud no-op, so the real BullMQ path — the only path that can abandon a
command — never executes locally. The local gate had therefore been
running a **different code path from CI** for the whole of F-72, and a
green local run was evidence about a program CI does not build. The gate
is now, and stays:

```
RLS_REQUIRED=1 REDIS_URL=redis://localhost:6381 npx vitest run
```

(`docker compose up -d db redis` first. Never `db:reset` locally — it
resolves to the owner's dev database.) `docs/PROJECT.md`'s "Tests,
nothing skipped" row now carries both variables for the same reason.

**F-73** (admin-console.md §6 + §9, D-074) was designed by the
three-planner + judge panel — winner `honest-metrics`, on the argument
that this repo's dominant defect is vocabulary declared everywhere and
reachable nowhere — and then hardened by an adversarial critique into a
binding build document: 16 rulings, 30 amendments, four refutations, a
fixed build order and an 87-case manifest, with every contested repo fact
re-verified live before a line was written. Several of the amendments
overturned the ruling that produced them, and two are worth keeping: the
`locked` retry outcome was CUT after reading `reprocessJob-8.lua` at the
pin (it documents its return set as 1 / -1 / -3, contains no lock check
and can never return -2, so `locked` would have been a state with no
producer — minted by the very design meant to prevent that), and
`skipWaitingForReady: true` was cut after two critics reproduced it live
against `dealpilot-redis`: `initializing` is assigned once, so skipping
the ready wait makes a cached handle report `unreachable` FOREVER against
a healthy Redis.

Landed: **0069** — a migration that creates **no table and no column**.
Six indexes, each commented with the single metric it serves (two of them
non-partial on `(organization_id, created_at)` bought deliberately, so
that `leads_created` and `deals_created` can count soft-deleted rows and
stop moving backwards; the `deal_documents` one an `INCLUDE (size_bytes)`
index-only scan, because `idx_deal_documents_org_status` merely prefixes
the sum); `admin_tenant_usage` (thirteen figures and three plan
inclusions in one STABLE definer, stable unique aliases per table so the
drift guard can prove the read, `percentile_disc` with three stated
restrictions on the first-touch sample, `AND m.channel IN ('sms','mms')`
on both SMS numbers); `admin_tenant_snapshot` (only what
`admin_get_tenant` does not answer — `store_health` and never `stores`,
`traffic_30d` attributed through `conversations` because `messages`
carries no `store_id`, intake keys with `last_lead_accepted_at` and
without `token` or `secret`); `admin_record_queue_retry(p_actor, p_queue,
p_requested, p_organization_ids, p_reason)` with no `p_retried`, because
the row is filed before Redis is touched and no outcome exists yet; and
`platform_audit_events.event` restated whole at eight values. **No new
SQLSTATE**: PA002/PA009/23514 are reused, the three caller-bug belts reuse
PA014, PA027 is left free, and `apps/api/src/platform.ts` is not edited —
the 0069 header's error-contract block says "none, and why", with the
caveat that 23514 is a blanket map, which is why `PLATFORM_AUDIT_EVENTS`
and the CHECK ship in one commit.

`packages/schemas` takes the **queue names** (F-73 puts them on the wire:
one is a URL segment, one is a response field) plus the F-73 block —
`USAGE_PERIODS`, `USAGE_WINDOW_METRICS` (nine), `USAGE_GAUGES` (four),
`AdminUsageAllowances`, `AdminTenantUsage`, `AdminTenantSnapshot`,
`QueueState`, `RetryOutcome` (five values, no `locked`), `RetryJobsInput`,
`AdminQueueDepth(List)`, `AdminDlqQuery/Item/Page`, `AdminRetryResult`,
`RETRY_MAX_JOBS = 20`, and two capabilities. `packages/contracts` derives
`JOB_QUEUES` from that single name list — `QUEUE_PAYLOAD`,
`QUEUE_WORKER_FILE`, `QUEUES_WITHOUT_PAYLOAD`, `dlq_fields`, `replay`,
and `org_scoped` computed by `queueIsOrgScoped()` rather than typed — and
adds five contract entries, taking the admin surface from 23 to **28**.
`apps/api`: `queue-inspector.ts` (its own connection —
`maxRetriesPerRequest: 2`, `enableOfflineQueue: false`,
`connectTimeout: 1500`, `skipMetasUpdate: true`, `skipWaitingForReady`
deliberately absent — a bounded race as the sole hang control with the
`.catch` on the READ, an `'error'` listener before any command, lazily
cached handles, `close()` with a `disconnect()` fallback,
`redactFailedReason` for phones and e-mails, and the BullMQ numeric
`.code` mapping); `f73-usage-routes.ts` (usage + snapshot, both
`tenants:read`, `allowances` null outside `mtd`); `f73-queue-routes.ts`
(the ten-row list, the position-paged DLQ with its own `DlqCursor` codec,
and the retry whose ORDER is the control — capability, 404, body, confirm
gate, unconfigured short-circuit, `organizationsOf`, register row, loop,
`platform_queue_retry_result` WARN, 200). The console gains the usage
card at `/admin/tenants/:id/usage` (reached from the tenant page, since it
answers a question about a tenant already open), `/admin/queues` and
`/admin/queues/:queueName` in the nav (a stuck queue belongs to no
tenant), and the retry dialog; the `usage` and `jobs` namespaces land in
both locales, every metric carrying a caption that is part of the number
rather than a footnote.

**Guards.** Three new: `usage-metric-drift.test.ts` (every metric's
claimed `{table, alias, column}` exists AND its `alias.column` appears in
`pg_get_functiondef('admin_tenant_usage')`, with `FROM table alias`
proved per table; the REVERSE check that a `plans.included_*` column is
either read or exempt; and a channel classification held against the live
`messages_channel_check`), `queue-catalogue.test.ts` (every payload
claimed exactly once, every payload-less queue excused by name with a
reason, `org_scoped` derived, no `dlq_fields` entry a bare string,
`'body'` and `tenant_id` refused by name) and `queue-replay.test.ts`
(the `at_least_once` partition DERIVED from which worker files reach
`deliverMessage(`/`sendMessage(`, every worker file accounted for, every
`idempotent` claim held to a literal still in the file it cites).
`platform-drift.test.ts` gains the two F-73 route files, an explicit
`ADMIN_HANDLER_COUNT = 28`, and the missing half of its grant lockstep —
three positive `has_function_privilege(…, 'EXECUTE') = true` assertions
by exact signature, because the file previously asserted only what is NOT
callable, so a definer shipped without its GRANT would have failed at the
first support click instead of by name.

**Two things this slice did NOT do, deliberately.** It did not ride the
`reassignQueue.close()` leak into `app.ts`'s `onClose` — that is the exact
hook that produced the tick-26 teardown flake, and it belongs in its own
commit with its own test (it is named in D-074's deferred list so it is
not lost). And it did not touch `ADMIN_ALLOWED_DURING`: all five F-73
routes answer 409 during a live support session.

**Known gap, recorded rather than papered over:** the tenant snapshot
ships as an API only. `admin_tenant_snapshot`, the contract entry and
`GET /api/v1/admin/tenants/:id/snapshot` are built and tested, and
`adminKeys.snapshot` exists in the web client, but **no console page
reads it yet** — a reviewer reading §9 will call the slice incomplete
there. Filed as O-51 and in D-074's deferred list.

**Review (2026-08-30):** a 59-agent adversarial pass — seven finders
(metric honesty, live SQL, queue safety, dead vocabulary, guards/tests,
web a11y/i18n, spec fidelity/seam) then a refute-biased verifier per
finding. **52 raw, 36 confirmed, 14 refuted**; two verifiers died on an
API safeguard, so their findings were read by hand rather than counted as
refuted. All fixed.

**The blocker was ours, and it was the shape this project keeps finding.**
`ai_first_touch_p95_seconds` and its sample were structurally EMPTY. The
EXISTS carried `AND m.created_at <= l.chatbot_engaged_at`, and the
producer writes those two in the opposite order: `first-touch.ts:246`
captures `now` in JS BEFORE staging, the message row takes `DEFAULT now()`
at INSERT (0031:89, later), and only after the carrier returns does `:425`
stamp `chatbot_engaged_at` with that earlier value. Measured end to end
through the real greeting path: stamp 11:24:08.914Z, message
11:24:08.929Z. So the two numbers §6 names as the SLA read "Not measured /
0 leads" for every tenant whose first touch WORKS. The clause came from
the design panel's own amendment, on a justification that does not
survive — both deviant stamp paths it named are already excluded by
`c.lead_id = l.id`. Removed, with the mechanism written into 0069 so it
cannot be re-added innocently.

**Why a green suite hid it:** the only p95 case provisioned a tenant that
was never greeted and asserted null/0 — the test confirmed the broken
behaviour. There is now a positive case that greets a lead through the
real first-touch worker, and re-adding the clause turns it red.

The second blocker was the retry dialog: it stayed mounted, so its
`useRetryDlqJobs` observer survived every close (`useMutation` holds one
observer for the component's life and only resets on a changed
`mutationKey`, which it has none). A second open rendered the FIRST
batch's outcomes with no way to submit, or a standing "nothing was put
back on the queue" describing a request nobody made — on the one screen
where "was a customer texted?" is the question. Now mounted conditionally.

Other confirmed classes: the DLQ tenant filter discarded matches beyond
the page limit while advancing the cursor past them, so a filtered job
became permanently unreachable; `member_count`'s caption claimed one
membership per store when `memberships.store_id` is nullable and every
self-serve founding owner is org-wide (`f01-routes.ts:268-271`);
`members_who_acted` used an inner join where a semi-join was meant
(measured 22.6ms → 8.2ms, a 6× row fan-out matching the rooftop count);
the 0069 index comment miscounted `activity_events`' existing indexes as
two when it has six; `usage-metric-drift`'s alias proof was satisfied by a
DIFFERENT metric's read for 6 of 13 metrics, and its comment-stripping is
now proven load-bearing in both directions — a claim in a comment can no
longer satisfy a proof about the code. `organizationsOf` claimed a bound
of "one 1500 ms belt, not twenty" that held only for an unreachable
Redis; it now has its own `ATTRIBUTION_BUDGET_MS` wall clock.

**Gate after the fixes:** `RLS_REQUIRED=1 turbo run build typecheck lint`
25/25 (one pre-existing eslint warning in `apps/web/src/shared/realtime.ts:94`,
untouched here); `RLS_REQUIRED=1 REDIS_URL=redis://localhost:6381 npx
vitest run` → **162 files / 1732 tests, exit 0**, no unhandled errors.
Dev database migrated to 0069 — 71 migrations, 941 users / 867
organizations intact (migrate, never `db:reset`).

**Pushed** as `e754022` (35 files, +8854/-12). **CI GREEN first try — run
33311281418, both jobs** (lint/typecheck/test/build and the real-browser
e2e), verified with `gh run view 33311281418 --json conclusion`. That is
four consecutive greens since the abandoned-promise fixes.

## 2026-08-30 (tick 26) — F-72 announcements and kill switches: fail closed, and name no tenant

F-71's CI is genuinely green: `gh run view 33279396768` answers
conclusion `success`, status `completed`, headSha `0d52249` — tick 25's
PENDING-VERIFY is closed by the check, not by the pinned id. The docs
commit on top of it is green too: run 33279516679 = `success` on
`d1bcf1d`; it sat for more than a day as an `in_progress` zombie and
reconciled itself, so a stale `in_progress` on this repo is worth
re-reading before it is worth worrying about. F-72 (admin-console.md
§5.3 + §8, D-073) was designed by the three-planner + judge panel and
then hardened by an adversarial critique into a binding build document:
20 rulings, 48 amendments, a 16-step order and a 91-case manifest, with
every contested repo fact re-verified live before it was written.
Landed: 0068 (`platform_settings` — the two switches as rows, seeded
OFF, `SELECT` to the app role and nothing else, reason ≥ 10 characters
kept only while the switch is ON; `platform_announcements` —
deliberately no `organization_id`, `dismissible` derived by CHECK from
severity, the biconditional `status_incident_url`, and an immutability
trigger that refuses DELETE and freezes every column but `ends_at`;
`announcement_dismissals` with no grant and no RLS; `platform_audit_events`
widened to seven events with the subject in `changes`;
`idx_notifications_announcement_once`; twelve functions — the single
`announcement_matches` predicate that the feed, the dismissal and the
fan-out all share, `announcement_visible` (where `impersonation_scope_ok`
rides), the no-argument `announcements_for_user()` whose whole WHERE
clause is that helper, `announcement_dismiss`, `announcement_fanout_state` /
`announcement_fanout_batch`, and the six admin definers);
`packages/schemas` (the F-72 block, `KILL_SWITCH_TTL_MS`, five
capabilities, five message keys, four notification title keys —
three of which had producers and no registration);
`packages/core` (two `BLOCKED_REASONS` → twelve, two `ComplianceFacts`
fields, both checks first in `evaluateSend` with the mandatory
`req.channel === 'sms'` predicate, and `announcements.ts`);
`packages/contracts` (six admin paths, two tenant paths, the fan-out
queue); the switch reader `apps/api/src/platform-settings.ts` (a
per-process 5-second snapshot with a coalesced `inFlight` cleared in a
`finally`, no try/catch, a missing row reading as ON); the belt in
`f30-deliver.ts`; six SQLSTATE cases (PA021–PA026) in `platform.ts`;
two `ADMIN_ALLOWED_DURING` entries and the dismiss route in
`IMPERSONATION_BLOCKED_ROUTES`; the three route files
(`f72-killswitch-routes.ts`, `f72-announcement-routes.ts` and the
tenant-side `f72-banner-routes.ts`); the fan-out worker with its
`announcement_fanout_state` pre-check; `drip-tick.ts`'s four exported
reason sets, the explicit platform-pause branch and the `warn`
fall-through finally wired in production; the `announcements` and
`switches` i18n namespaces in both locales; and the console (four
routes — Interrupteurs at `/admin/platform-settings`, Annonces at
`/admin/announcements`, the compose page at `announcements/new` and an
announcement's own page at `announcements/:announcementId`, where
*Terminer maintenant* lives — plus the standing `<KillSwitchBanner />`
in the admin shell) and the tenant shell (`<AnnouncementBanner />` for
incident/maintenance, `<AnnouncementNotices />` for info/marketing,
`bell.tsx` picking the title's language at display time). Guards:
platform-drift scans both F-72 admin route files, pins the new grants,
puts three CHECK vocabularies in lockstep with the schemas — including
`PLATFORM_AUDIT_EVENTS` against the widened `platform_audit_events.event`
— and asserts `f72-banner-routes.ts` never names an admin path;
`platform-event-vocabulary.test.ts` (every value that CHECK declares has
a real `INSERT` producer), `outbound-chokepoint.test.ts` and
`drip-reasons.test.ts` are new; `tenant-lifecycle-drift.test.ts` now
also regexes `announcement_matches`; and `contrast.test.ts` gained two
pairs that ship ungated — `['caution-text','caution-bg']`, whose
`tokens.ts:59` figures measured 6.38:1 / 9.52:1 rather than the claimed
8.0:1 / 10.9:1 (the comment is corrected here), and
`['foreground','muted']`, the neutral status row `tokens.ts` had never
said anything about at all. F-72 adds no RLS policy and no entry to any
pre-existing exemption registry — the crash-recovery exemptions it does
declare sit in `EXEMPT_SITES` in its own new chokepoint guard, each with
its reason and the source literal that retires it. Probed live before any
TypeScript was written: a scratch database took 0068 and every definer
was exercised by hand inside a rolled-back transaction — publish,
targeted publish, the incident-without-a-URL refusal, the feed under a
foreign `app.user_id`, dismissal and `PA023`, marketing suppressed for
`past_due` but NOT for `trial`, ending a SCHEDULED announcement (the
23514 trap) and `PA025` on the second end, the keyset walk with a
two-org member getting exactly one row, and UPDATE/DELETE refused as
the owner. `RLS_REQUIRED=1 npx vitest run packages/db` → 42/42: the
suite's 40 plus this slice's two new `rls.test.ts` probes — the app pool
reads `platform_settings` and can never write one, and it cannot even
read `platform_announcements` or `announcement_dismissals`. Both ran;
neither hit the `if (!dbUp) return ctx.skip()` arm.

**Review (2026-08-30):** a 57-agent adversarial pass — eight finders
(attacker x2, dead-vocabulary, correctness/SQL, test quality, a11y/i18n,
spec fidelity, operability) then a refute-biased verifier per finding.
49 raw, **40 confirmed, 8 refuted**, one verifier lost to an API
safeguard. All fixed.

The blocker was mine and it was the shape this project keeps finding: the
slice added two TRANSIENT blocked reasons and taught exactly one of the
three queue consumers. `deferred-send` and `first-touch` treated a
platform pause like "the customer texted STOP" — the job completed
successfully and the message was gone. A twenty-minute incident would
have destroyed every quiet-hours follow-up and every first-touch greeting
that woke inside it, with no operator signal, and `enqueueFirstTouch`'s
deterministic job id would have silently dropped a manual retry. Both
files already had the right shape from F-69 (tenant not operational ->
retry in 1h) and simply were not wired to it. `PLATFORM_PAUSE_REASONS`
and `isPlatformPause()` now live in `compliance-gate.ts` beside
`BLOCKED_REASONS` — the classification is a property of the REASON, not
of one worker — and `drip-tick` re-exports rather than re-declaring, so
a third pause reason cannot reach one consumer and not another.

The rest, by class. **Correctness:** `announcement_dismiss()` 404'd on a
second dismiss because the visibility gate ran before the insert and a
dismissal is precisely what makes an announcement invisible — which also
left its own `ON CONFLICT DO NOTHING` unreachable; the list cursor was
plaintext `at|id` handed to `::timestamptz`, so a tampered or stale
cursor was a 500 where every other paginated endpoint answers 400, and
its millisecond `toISOString()` could drop a row against a microsecond
column (both fixed by moving to F-69's `encodeCursor`/`decodeCursor` plus
a `published_at_text` column); an `ends_at` in the past with a blank
`starts_at` skipped Zod entirely and surfaced as "Reason required" on a
field the form does not have; an upper-case UUID in an `organizations`
audience published successfully and reached nobody; `resetKillSwitchCache()`
could not cancel an in-flight read, so a pre-flip SELECT could install its
stale OFF answer after the flip and serve it for a whole TTL (a generation
counter now gates the install). **Performance:** the tenant feed called a
SECURITY DEFINER per announcement ever published, on a query the shell
polls every 60s per user — 110ms and 9,076 buffers at 3,000 rows; a window
pre-filter and a `(ends_at, starts_at)` index make it 1.3ms and 30, with
the returned set proved identical by an `EXCEPT` both ways. **Honesty:**
`core/announcements.ts` claimed three "named second consumers" and two did
not exist — the severity-rank lockstep was written and the compose page now
derives its suppression copy from `MARKETING_SUPPRESSED_STATUSES`, so the
claims became true rather than deleted; the End page showed F-71
support-session copy for an announcement 403/409; `mailer.send` credential
paths were counted as six in four places and are five; `platform_audit_events`
was described as having four INSERT sites when this slice made it seven.

Guards found their own bugs, as they always do: `checkValues` was already
non-deterministic before F-72 (two CHECKs on `activity_events` mention
`actor_type`), and `tokens.ts` claimed a caution contrast of 8.0:1 light
that was never reachable — measured 6.38:1.

**Gate after the fixes:** `RLS_REQUIRED=1 turbo run build typecheck lint`
25/25 (one pre-existing eslint warning in a file F-72 does not touch);
`RLS_REQUIRED=1 turbo run test` **153 files / 1603 tests, exit 0**; db
42/42; f72-announcements 33/33, f72-killswitch 23/23, announcement-fanout
and drip-tick 23/23. Dev DB migrated to 0068 (both switches seeded OFF;
941 users / 867 organizations intact — migrate, never `db:reset`).

**Two process notes worth keeping.** A parallel agent ran `git stash` in
the shared worktree mid-build and reverted 37 files of in-flight work; it
restored them, and the tree was verified against the stash rather than
taken on trust — the only difference was a transient mutation-test
artifact. And two agents doing whole-file writes clobbered each other's
migration hunks; the final file was re-verified hunk by hunk. Both are
arguments for targeted edits over whole-file rewrites when agents share a
tree.

**Pushed** as `19a5c58` (70 files, +7490/-40). CI run 33291117664 GREEN,
both jobs.

**Then the docs-only follow-up `43901b6` went RED — twice — and it was
ours, not a flake.** All 153 files and 1603 tests passed; vitest exited 1
on two unhandled rejections, `Error: Connection is closed.` out of
ioredis's close handler. The cause was in the F6/F8 review fix: the
publish route wrote `Promise.race([enqueue, timeout]).catch(...)`, which
attaches the catch to the RACE. When the timeout wins, the race resolves
and the enqueue promise is abandoned still pending — and an abandoned
ioredis command rejects when the pool shuts down, with nothing watching.
The catch now belongs to the enqueue itself and the race only bounds how
long the request WAITS; the timer is cleared rather than left holding the
event loop open for 1500 ms after every publish.

It never reproduced locally because **`REDIS_URL` is unset here and set in
CI**: without it `createDeferredSendQueue` returns the loud no-op and the
real BullMQ path — the one that can abandon a command — never executes.
Every local gate in this slice had therefore been running a different
code path from CI. Re-run with `RLS_REQUIRED=1 REDIS_URL=redis://localhost:6381
npx vitest run`: 153 files, 1603 tests, exit 0, no unhandled errors. That
env pair is now the one to use before believing a green local gate.

The fix is `ebee4b9`, and **CI run 33292743236 is GREEN on both jobs**
(verified with `gh run view 33292743236 --json conclusion`). develop is
clean at `ebee4b9`.

**A second, deeper cause, and the honest state of it.** After `ebee4b9`
went green the docs-only `3b19860` went red again with the identical
signature, so the abandoned enqueue was a real latent bug but not this
one. Across five runs of near-identical trees the pattern is green, red,
red, green, red — a teardown race at roughly even odds, and it predates
F-72: `createEmitOnlyEmitter`'s close already carried a comment about run
32531141801, where the same class bit the SIGTERM drain and `disconnect()`
was swapped for `quit()`.

The remaining hole is that QUIT waits for commands ioredis has already
WRITTEN, while the Socket.IO Redis adapter's `psubscribe` can still be in
the offline queue — and every queued command is rejected with "Connection
is closed." when the socket goes. Those promises belong to the adapter,
so the pub/sub `error` listeners never see them. `167b036` drains with a
PING round trip (one of the few commands allowed a client in subscriber
mode) so QUIT finds nothing pending behind it.

**Do not over-read the green.** `167b036` passed, but at ~50% base odds one
green run is weak evidence, and the race does not reproduce locally — six
consecutive runs of `f28c-emit-only.test.ts` under the CI env produced
nothing. The fix is reasoned from the mechanism, not from a red-to-green
repro. If this signature returns, the next place to look is the two other
`createEmitOnlyEmitter` consumers and the BullMQ queue close chain in
`deferred-queue.ts`, whose `await`s abandon the remaining closes if an
early one rejects.

Also worth keeping: `19a5c58` and `43901b6` differ by one markdown file,
so the same latent defect was present in the green run and simply did not
fire. A green CI is not evidence that an unobserved promise is safe.

## 2026-08-27 (tick 25) — F-71 impersonation: a register row, not a second session

F-70 CI-green first try (33021906021, 74648f6). F-71 (admin-console.md §3,
§7, §11–§12, D-072) was designed by the three-planner + judge panel — the
first run died on the session limit with nothing cached and was resumed
from the saved script. The judge settled the mechanism against the
installed Better Auth 1.6.25: the `admin` plugin's impersonation mints a
real target session on a `user.role` authority and hands the staffer's own
token to the browser, so the home-grown design won on every lens (O-17).
Landed: 0067 (`impersonation_sessions` — tenant-readable, close-once
immutable; `impersonation_requests` — one row per request served under a
session, refusals included, no app grant; `activity_events.impersonation_id`
with a CHECK that it rides only on platform/system rows;
`impersonation_scope_ok()` inside the four user-keyed policies AND
`has_permission`; the definers `impersonation_start` / `_identity` /
`_end` / `_close` / `_log_request`, the register readers and the member
picker; a SECURITY DEFINER `AFTER DELETE ON "session"` trigger;
`platform_staff_revoke` and `admin_set_tenant_status` closing sessions
BEFORE their session deletes; `admin_tenant_events` naming the staffer);
`packages/db` `connectionScope` → the `app.impersonation_org` GUC in
`withContext`; the gate `impersonation.ts` (after the session gate,
before the platform gate: one `impersonation_identity` read per request,
the refusals — console 409 but for the probe and the End, two blocked
routes, read-only verbs, scope mismatch — then the swap of
`request.session.user` to the target while `.session` stays the
staffer's); `recordEvent` flipping a person's act to `platform` +
`impersonation_id`; `requirePermission`/`hasPermission` refusing the
blocked list after the membership gate; five admin handlers under three
capabilities + the tenant-side `GET /api/v1/support-access`; the owner's
email after commit; `/api/v1/me` answering as the target with the banner
facts; the console (register with URL filters, a session's trail, the
start dialog on the tenant page, the wall) and the tenant app (the §7
banner from `useMe`, "Accès du soutien" on /security, the timeline
suffix, the journal's "{staff} (soutien) au nom de {user}", the leads /
tasks "mine" filters moved from the raw auth session to `useMe`). Guards:
platform-drift scans f71; rls-coverage strips the scope call before
classifying and asserts the registry both ways; dead-column registers the
definer-written columns; f10's dead-vocabulary guard learned
`SQL_PRODUCED_ENTITIES`. Suites: f71-impersonation 20/20 (gate, start
refusals, the birth + journal + bell + inbox, acting as the target with
the auth mount still the staffer's, read-only refusals + the trail with
refusals, scope by list / by id / organizations / notifications / the
raw predicates as the app role, full-mode attribution to both + every
blocked power and route, read_only tenant 402, who may end, TTL, sign-out
trigger, staff revoke, membership revoked, tenant deleted, suspension
signed by the actor, transparency incl. a role without activity:read,
immutability + grants, definers' actor checks, core↔schemas lockstep),
platform-drift, f10, dead-column, contract/route-coverage, db 40/40, web
17/17 tasks. First-run findings, all in my fixtures or one ordering
choice: refused requests were NOT in the trail (the facts were attached
after the refusals — §7 says every request, fixed), the suspended-stamp
CHECK in `forceStatus`, the TTL fixture against `expires_at > started_at`
(the register refuses rewrites — the test lifts the trigger to move the
clock), a stale dead-column entry (`reason` is written elsewhere by
name), and a read through a closed console. Then two label gaps caught
by eye: session rows in the journal showed raw `mode` / `target_user_id`
keys and a session's `active → ended` would have gone through the
tenant-status map.

**Review (2026-08-29):** a 43-agent adversarial pass (four lenses —
attacker, correctness/tests, console a11y/i18n, spec/doc honesty — then
refute-biased verification; the first run died on the usage limit and was
resumed from the saved script, replaying finished agents from cache). 24
confirmed, 3 refuted; all fixed. The real ones: the scope "belt" read the
request body in an onRequest hook, where the body is not parsed yet — moved
to a preHandler `impersonationScopeGate` (the DB scope had always held with
a 404; the belt now gives the designed 403 and a body-addressed test
proves it); `impersonation_identity` re-proved the staffer active but not
their ROLE, so a super admin demoted to support kept full mode until the
TTL — the check is now role-aware and `platform_staff_grant` closes the
old role's sessions (signed); `admin_tenant_events` joined the staffer's
email onto the session's OWN rows, so the journal read "staffer acting as
staffer" — now NULL there; `/api/v1/me` computed MFA for the impersonated
user, nagging the staffer to rotate their own secret — it now reads the
staffer, and `/security` hides 2FA and shows only the register during a
session; the End after a lapsed session looped on a generic error — the
banner now speaks the API's impersonation refusals (via a window event
from `failFromResponse`) and clears itself, and a 403 `impersonation_ended`
maps to a refetch, not the "denied" wall. Plus the ROUND 18 refusal
strings, several honest-comment and doc corrections (D-070 (4) amended to
name the one place staff hold tenant context; the case count set to the
true 20; the bilingual-email deviation recorded). Suites after the fixes:
f71-impersonation 20/20, db 40/40, gate 29/29. Pushed as 0d52249 (56
files). CI: run 33279396768 pinned at push time — VERIFY the conclusion
with `gh run view 33279396768 --json conclusion` before calling it green.
Dev DB migrated to 0067 (the file was edited after an earlier local apply,
so the migrator said "already up to date"; the changed platform functions
were refreshed by hand — scratchpad `f71_devdb_delta.sql` via `docker exec
-i dealpilot-db psql`, no tenant data touched). Dev API restarted on the
new build (:3001), web :5173.

## 2026-08-27 (tick 24) — F-70 tenant provisioning: one birth, the same seeds

F-69 CI-green on attempt 2 (33015737819, a52477a). F-70 (admin-console.md
§4.2–§4.4, §11–§12, D-071) was designed by the same three-planner + judge
workflow; the judge settled the contested repo facts before a line was
written (the drift guard scanned ONE file; `dead-column` never scans
`organizations`; `getTenant` was a closure; `assertKnownTimezone` already
exists; `'tenants:create'` does not trip the realtime guard). Landed: 0066
(`organizations.trial_ends_at`; `admin_list_tenants` / `admin_get_tenant`
re-created with the clock and the open owner seat; `admin_provision_tenant`
— organization, stores, role matrix, lost reasons, per-store checklists, the
owner's F-12 invitation and the audit rows in ONE definer call on the bare
pool, seeds arriving as jsonb from the canonical TS lists so SQL owns no
copy; `admin_reissue_owner_invitation`); `invitation-token.ts` (the hash,
the TTL and the link shape moved out of f12 so both issuers share one
module); `org-seeds.ts`; `f70-provisioning-routes.ts` (two handlers under
`tenants:create`, timezone checked by ROW on a bare client before anything
is written, PA011 → 409 `slug_taken` with the existing id, PA012 → 422 at
`stores.<i>.code`, PA013 → 409 `owner_exists`, the accept link returned
only when no mail reaches the owner); `readAdminTenant` hoisted from f69;
the platform-drift guard now owns `ADMIN_ROUTE_FILES` and fails on an admin
route file it does not scan; `TRIAL_DAYS` in core; schemas/contract
(`ProvisionTenantInput` on the self-serve slug/code rules with duplicate
codes refused by row, `admin.tenants.create` / `inviteOwner`); the console
(`/admin/tenants/new` — three fieldsets, suggestions from the name and the
province, every 422 tied to its input plus a linked summary, the result in
place with the link and a copy button; a capability-gated "New tenant"
link and a "Trial ends" column; trial and owner-seat facts, the reissue
dialog and journal rows that show plain facts as themselves). Suites:
f70-provisioning 17/17 (gate, the birth and its database facts, seeds
lockstep against an F-01 org + store, no tenant context on the app role +
PA001/PA009 from the definer, §12 journal, slug idempotency incl. a
self-serve and a soft-deleted slug, a two-request race, directory/detail +
trial → active keeping the clock, acceptance end-to-end into a working
tenant with `wrong_account` first, atomic refusals for timezone / plan /
duplicate code / empty seeds, the id-smuggling mutation test, reissue with
revocation + journal + dead old link, the CR-05 accept link, the one-module
token lockstep), platform-drift 5/5, schemas + core + web unit cases. Two
first-run findings, both in my fixtures (a minimal checklist seed tripped the
code CHECK — the real seeds are used now); one type error (province typed
as string in the draft).

Review (21 agents: four lenses — SQL/tenancy, API + test honesty, console
a11y/i18n, spec + doc claims — then refute-biased verification, two votes
for anything above minor; 15 raw, 14 confirmed, 1 refuted, none blocking).
The two majors were in the console: a blank required field reached the
server and came back as a raw wire path ("Champ refusé : owner_email"),
and the journal rendered a revoked owner seat — a row with empty changes —
as "Système", naming neither the verb nor the entity (so ROUND 17's "the
journal shows the old invitation revoked" was a promise the screen did not
keep). Fixed: client-side required check by LABEL, a label map for every
path the server can send, `ApiError.detailPaths` so a multi-field 422 marks
every input at once, the journal names verb + entity on every row and the
revoked row carries the address that lost the seat (0066), roles and
booleans in the reader's words, the birth row's plan resolved to its name.
The rest: the 0066 header over-claimed ("every organization_id written
below comes from RETURNING" — true of the birth, not of the reissue, which
writes the p_org it verified and locked); "never logged" over-claimed (the
dev log mail transport writes the body by design — qualified in the route
and SECURITY.md); the two-POST race test could not tell the pre-check from
the EXCEPTION branch, so a deterministic case now holds an uncommitted
winner and forces the loser past the pre-check onto the unique index;
acceptance ran on an already-activated tenant (reordered: the owner now
accepts into a trial tenant, asserted); a picked timezone was overwritten
by a province change; store-row errors did not follow a removed row; a
refused picked timezone was not tied to its select; the reissue dialog and
the result panel showed raw tokens. Refuted (1): the drift guard's file
list being escapable by an unusual file name — contract-coverage walks
Fastify's real route tree and would fail first. Suites after the fixes:
f70-provisioning 18/18; gate 29/29. Pushed as 74648f6; CI-green first try
(33021906021) — 29 of 30 pushes green on the first attempt. Dev database
migrated to 0066, dev API restarted on the new build.

## 2026-08-26 (tick 23) — F-69 platform console, slice 1

F-68 CI-green (32995802172, 0c71ee3). F-69 (admin-console.md §2–§5.1,
§11–§12, D-070) was DESIGNED by a workflow first — three planners
(security/tenancy, spec fidelity, minimal diff) and a judge that verified
every contested repo fact and synthesized one plan; the build followed it.
Landed: 0065 (`plans` seeded with the §5.1 tiers; §4.1 columns on
`organizations` with a trigger keeping `plan_tier` in step with
`plan_id`; `platform_staff`; immutable `platform_audit_events`;
`activity_events.actor_type` + `restricted`; ten SECURITY DEFINER
functions that re-check the actor and write their own audit rows; the
drip/task scans and `intake_resolve` learn the lifecycle); the platform
gate (identity → MFA → 12h session age) as an onRequest hook; `trustDevice`
refused at the auth mount; a tenant-status gate turning suspended into
403 and read-only writes into 402 for every request naming an
organization, plus the same rule inside both membership gates;
`/api/v1/admin/*` (me, plans, tenant directory/detail/events, profile
PATCH, status transitions, staff grant/revoke) on a bare pool — no tenant
context anywhere in the route file; workers skip non-operational tenants;
the console web surface (`/admin/*`: its own shell without BrandStyle,
the MFA wall, tenant directory with URL filters and keyset paging, tenant
detail with facts / profile form / lifecycle buttons the server allowed /
journal, the transition dialog demanding a reason and the slug, the staff
page); `nav:console` link and lifecycle banners in the tenant shell; the
`admin` i18n namespace. Guards added: platform-drift (every admin handler
asks a capability, every capability is enforced, no tenant context or role
literal in the file, SQL↔Zod vocabularies), tenant-lifecycle-drift (core
matrix = `tenant_transitions()`; scans pause exactly the non-operational
statuses), definer-owner (every SECURITY DEFINER owner can see through
FORCE RLS). Suites: f69-admin 16/16 (gate, re-auth clock, trustDevice,
directory/detail/capabilities, the full 7×7 transition matrix against the
database, suspension → sessions revoked → 403 → intake 410 → restricted
event hidden from the tenant, read_only 402 vs reads, staff lifecycle
including the last-super-admin rule), tenant-status 3/3, core 4/4,
definer-owner 2/2. First-run findings, all fixed: a withUser list route
let a suspended owner read leads (→ the preHandler gate); the tenant
activity feed selected an explicit column list without the new columns;
the suite tripped the per-IP credential limiter (injected open). The
e2e journey for the console is queued with the e2e-breadth slice.

Review (45 agents after a limit restart; 31 confirmed, 11 refuted; D-070
13–20). The blocker: the `trustDevice` refusal matched Fastify's raw
request target while Better Auth routes on the normalised pathname, so
`/two-factor/./verify-totp` minted a 30-day trust cookie — the console's
"a session exists ⇒ the challenge passed" premise was defeated; the
verifier proved it with raw sockets. Majors: demoting the last super admin
locked the console and reopened bootstrap (unlocked check, no lock on
survivors); realtime subscribe ignored the lifecycle; live-analysis and
ai-extraction spent model tokens for suspended tenants; a read-only
tenant's first touch and deferred sends were dropped, not paused; `seq`
crossed the wire as a string and broke the journal; the directory form
was uncontrolled and its count dishonest; a 409 said "reloaded" and
reloaded nothing. All fixed with regressions (dot-segment trustDevice,
self-demotion 409, `%`/`_` as text, seq parse, deleted tenant, malformed
staff id). Suites: f69-admin 17/17. Pushed as a52477a. CI: attempt 1
red on ONE e2e journey (F-10: the lead's history showed only the creation
row after a status change, 15 s wait; the unit gate was green). Not
reproducible locally — the journey passes against the dev database and
against a fresh, fully migrated database identical to CI's; the API log
in CI carried no error. Attempt 2 (same commit, re-run of the failed job
only) green: 33015737819. Recorded as a flake, not explained; if it
recurs, the e2e job should dump /tmp/api.log on failure so the server
side is visible. Dev database migrated to 0065 and the dev API restarted
on the new build so the owner can browse the console.

## 2026-08-26 (tick 22) — F-68 tasks: one table, the subject's permission

F-67 CI-green (32989111713, 5682f49) after its review. F-68 (appointments-tasks-communications.md
§3.3 Target + §2.4, leads.md §10.1, D-069): the unified polymorphic
`tasks` table (0064) replacing the legacy's two disagreeing systems; the
permission of the SUBJECT instead of a task:* permission; buckets
computed per task in the store's timezone; completed_at as the one
completion fact with `task_completed` in the trail under the lead; the
§2.4 no-show / showed-no-deal automations inside the appointment's
transaction, deduped by (appointment, source), titled in the store's
locale; bulk complete/reassign (cap 50, honest counts); the 15-minute
overdue sweep (SECURITY DEFINER id scan, one transaction per task) —
assignee + sales managers, then the GM after ten minutes unless somebody
read the alert; a tasks board (mine/open/bucket, bulk bar), the lead
page's follow-up panel with QuickFollowUp defaults (tomorrow 09:00) and
the "no follow-up scheduled" warning, and the FollowUpAlertBar on the
leads list. Suites: api 11/11, worker 4/4. Lesson of the day: my
anchored-edit helper was re-run to restore stripped locale lines and
re-applied EVERY edit in the file — a duplicate queue constant broke the
build; the helper now skips an edit whose result is already present and
can repair a double application. Review: 27 agents, one finder lost to a
safeguard flag and re-run on the fixed tree; 20 confirmed from the other
two dimensions, all fixed with regressions (D-069 amendments 10–16): bulk
endpoints prove membership before any query (a 200/404 difference was a
task-id and membership oracle for strangers); revoking a member releases
their open tasks and the sweep's recipients query refuses a non-member
assignee (a revoked person's bell was about to carry the old org's
customer names); a record's own task list follows the record's
visibility while the board keeps the store cut (a store-bound manager was
minting duplicates behind a false "no follow-up"); the definer scan
orders by age across tenants and the worker logs failures; PATCH diffs
through activity.diff() so a re-sent due_at is not a change; nothing for
a deleted lead; and the board's selection, chunked bulk, error surfacing,
focus parking, Reopen for closed rows, honest alert bar, and `?task=`
deep links. Suites: api 17/17, worker 6/6. Two guards bit on the way:
the i18n parity extractor reads `{Afficher` as an argument name (plural
branches must start with `#`), and permission-drift reads any
three-argument `requireMember` as role-carrying — use f01's
`requireMember(c, userId)` under withTenant. The re-run finder brought
23 more (D-069 17–23), the important ones: the sweep stamps were
write-once, so a task rescheduled after its first alert was escalated
about a due date that no longer existed and never alerted again when
late again; a lost deal counted as "a deal resulted"; merges and lead
deletion left tasks pointing at retired records; the automation could
assign a revoked agent and used the appointment's store, not the lead's.
All fixed with regressions.

## 2026-08-22 (tick 21) — F-67 heatmap: the store's clock

F-66 CI-green (32985352745, aadf779 — gh reported a transient
startup_failure while the run was still in progress; the pinned verdict
was success on attempt 1). F-67 (reports-analytics.md §11 Target,
D-068): the store-level, SQL-side activity heatmap — weekday × hour
bucketed in the STORE's timezone (the test's oracle is Intl in that
zone: 02:15Z on a Saturday is Friday 22:15 in Montréal, and the grid
says Friday), best contact times ranked by inbound volume for the
outbound-call scheduler to read, the F-55 scope discipline, a fourth
report tab with numbers in every cell's accessible label. The gate
refused an 'all' sentinel in the direction enum — the enum-vocabulary
guard doing in F-67 what it did in F-53 — so the filter is the column's
own vocabulary, absent meaning both. Review 14/14 agents, 9 confirmed,
all fixed: refused sends (carrier_error) no longer count as activity;
`assertKnownTimezone` now refuses fixed-offset/pseudo zones ('EST',
'Factory', 'Etc/GMT+5') for every store write — a Québec store saved as
'EST' bucketed every summer message an hour early; the grid is a real
table (headers name day and hour, busy cells carry text, empty cells
are empty) instead of 168 role=img sentences; the busiest steps use
`success-foreground` ink (page foreground was 1.7:1 on solid success in
dark); a sent-only cut says "no replies" instead of heading an empty
list; ICU plurals on the slot/cell strings; the conversations join is
added only when a store constrains the cut; and the suite gained the
store-bound-manager / foreign-store-404 / period=all / second-timezone
case the review's mutation test showed was missing. Suite 5/5.

## 2026-08-22 (tick 20) — F-66 leaderboard: real keys, and a stranger who almost got a medal

F-65 CI-green (32548040916, 7b17d0f). F-66 (reports-analytics.md §10,
D-067): the salesperson leaderboard on the FK model the legacy lacked —
deals.salesperson_id and leads.assigned_to, no fuzzy name-scoring — with
§10's documented defects fixed rather than ported (canonical
delivered/complete stages, the F-24 response stamp, the lead module's
5/15/30 bands, closed-over-assigned conversion), five sorts, FR/EN, a
third report tab. The review ran three times: the first two lost
agents to a network blip and the usage limit, the third to a machine
restart that took Docker down (Postgres and Redis brought back; only
our containers). Final verdict 11/11 agents, 4 confirmed: stable
rank tiebreaks; delivered money windowed by delivered_at (two verifiers
split — an August car belongs to August); names from the RLS-scoped
users table joined to active memberships, because Better Auth's global
"user" table would have NAMED a member of another dealer group whenever
a foreign id sat on a deal — and the root cause closed in F-05, which
now refuses a salesperson_id that is not an active member; a
store-scoped manager test on this endpoint. Suite 7/7. Gate 29/29.

## 2026-08-22 (tick 19) — F-65 source ROI: what marketing costs, honestly

F-64 CI-green (32540100074, 85efcf3). F-65 (expenses-accounting.md §10 +
reports-analytics.md §8, D-066): source_costs in INTEGER CENTS (the
legacy's dollars column is its own flagged hazard), sources locked to the
ONE LeadSource enum, UNIQUE NULLS NOT DISTINCT upsert per
source/month/store, the §8 pipeline (gross-sale revenue, zero-guards,
spend-only sources included, NULL ROI on zero spend), and a report page
with an in-place spend editor and band-named ROI badges. Review (13
agents, 10 confirmed): period=all was silently 90 days (?? ate the NULL
interval), conversion counting disagreed with F-55's WON clause, the
report lacked membership store-scoping, the ledger truncated at 500 with
a lying null cursor, UTC month default, note-wiping upsert, color-only
badges — all fixed with regressions (10/10 suite incl. the 200-day-old
lead, the status-drifted deal, and the store-bound manager). Gate 29/29.

## 2026-08-22 (tick 18) — F-64 the nightly QA judge: observation with teeth, not hands

F-63 CI-green (32537428484, 4f085d6). F-64 (compliance-and-quality.md §9,
D-065): conversation_qa_reviews (0062) + the qa_due_conversations
cross-tenant scan, the six-dimension judge in packages/ai (arithmetic in
CODE — weights, 2dp, the compliance-1 cap and forced flag), the nightly
worker (idempotent-before-spend, §13 metered, advisory-lock fenced,
drain-loop over a 7-day oldest-first window), HIGH-on-compliance-flag and
MEDIUM-on-weekly-floor alerts riding the D-045 ladder. Review (17 agents,
12 confirmed): the blocker was borrowed eyes — F-62's 20-message window
cut the first-turn disclosure from every long conversation, so compliance
was wrong in both directions; qaTranscript now keeps head AND tail with
timestamps in store-local time (making quiet-hours judgeable), the scan
drains instead of sampling, invalid verdicts aren't re-paid, overlapping
runs can't double-spend, and the anchors carry §9's exact bars. Suites:
judge 7, worker 4. Gate 29/29. Pushing.

## 2026-08-22 (tick 17) — F-63 duplicate-as-signal: the resubmission is about the keeper

Drain fix verified green (32533551675, b9b9499). F-63 (leads.md §8.3,
D-064) rode almost entirely on machinery already here: F-54's detection
and backfill shape, F-59's confirming template variant, the first-touch
worker as the send vehicle (a duplicate_of mode with its own jobId and
re_engagement class). The review (21 agents, 16 confirmed) was decisive
again — its blocker was self-defeating code: the confirmation's own
conversation-create bound the phone's one live thread to the duplicate
record and then refused to use it, masked by a test fixture giving keeper
and source different phones, a state the phone-match gate cannot produce.
All 16 fixed: keeper-owned thread find/adopt/create, replay anchor on the
submission record + 24h person cooldown, duplicates never assigned/never
laddered (§8.3 before routing), canonical-oldest keeper, NOWAIT keeper
lock, email-certainty joins the gate, orphans stay dormant for f23's
cascade, full paper trail per branch, drip rides end, analytics counter.
Suites: f03 16, first-touch 12, f55 6. Gate 29/29. Pushing.

## 2026-08-22 (tick 16b) — First red in 18: the SIGTERM drain, twice over

Run 32531141801 (516916f) went RED on the e2e drain check — first red
since the streak began. Root cause 1 (deterministic, F-62's):
createEmitOnlyEmitter's close() called io.close(), which assumes an
attached HTTP server and reads undefined.close — an emit-only server
never had one. Fixed: close only what we own, via QUIT (not disconnect —
an abrupt disconnect rejects the adapter's in-flight psubscribe, an
unhandled rejection that kills the process mid-drain). Root cause 2
(pre-existing, FLAKY — proven by a worktree baseline at adb76d2 crashing
1-in-3): every BullMQ Worker/Queue was an EventEmitter with no 'error'
listener, so any Redis blip during drain became Node's default crash.
All ten entities now wear guarded() (log-and-continue). Drain proof:
6/6 clean programmatic start→close cycles (was 4/4 crashes). Lab note:
a Git Bash `kill` killed the shell wrapper, not the child — the orphaned
workers process ate queue-roundtrip's jobs until PowerShell Stop-Process
found it. Regression: f28c-emit-only.test.ts pins the emitter lifecycle.

## 2026-08-22 (tick 16) — F-62 silent monitoring: the panel goes live

F-61 CI-green (32525989945, adb76d2 — seventeen straight). F-62 (D-063):
the third pass — JUDGEMENT — runs per message on human-held threads,
writes conversation_analysis 'live_update' (the dead vocabulary from 0033,
now live), and nudges every console over analysis.created; workers gained
an emit-only Socket.IO server on the shared Redis adapter (f28b's
topology). The panel was already built — it renders the rows and now the
score_reason too. Review (13 agents, 10 confirmed / 1 refuted) hardened
it: 0061 gives rows message_id+model+tokens (replay = free skip, §13
metered, freshness-guarded), transcript speakers are the database's
(ASSISTANT ≠ AGENT — the bot's Law 25 disclosure was landing in the
human's mouth), every enqueue is hint-grade and the webhook's sits after
reassign.arm, the handoff moment itself emits, takeover + deferred agent
sends enqueue passes, vocabulary guard scans workers. Suites: ai 7,
worker 6, sync 8, f30 16. Gate 29/29. Dev servers running for the owner
(web :5173 / api :3001, workers off).

## 2026-08-21 (tick 15) — F-61 drip sequences: the nurture engine, gate-subordinate

F-60 verified green on CI (run 32505988364, 2187513 — sixteen straight).
Built F-61 per automation-notifications.md §11 (D-062): 0060 migration
(drip_sequences config + drip_enrollments rides, RLS iso+member_read,
SECURITY DEFINER id-only due-scan, activity vocabulary +drip_enrolled),
core/drip.ts pure engine (dueness, merge fields, CASL footer, condition
match — 12 unit tests), f61 routes (CRUD as f53's sibling + enrollments
list), enrollment inside the f02 lost transaction, STOP ends rides in
f18's atomic act, positive reply ends them in f23, hourly drip-tick worker
(FOR UPDATE SKIP LOCKED, full f19 gate per send, stage→deliver post-commit,
honest ride endings per refusal class, human-held threads untouched,
conversations turn drip_active — previously declared-unreachable vocabulary
now live). Fixes the build itself surfaced: all-steps-sent scan blind spot
(finished rides sat active until expiry), 'won' is not a LEAD status
(half-dead condition removed), dead-column matcher crossing template
literals (an INSERT with no SET swallowed the next statement's columns),
agent_active requires assigned_agent_id. Tests: core 12, api f61 5,
worker tick 7, STOP + reactivation assertions added to f18/f23 suites,
RLS probe + coverage registry. Gate 29/29 pre-review.

Review wf_18b50a3c-7cd (33 agents; round 1 lost 13 verifiers to the
session limit — resumed per the never-ship-on-partial rule) confirmed 28 /
refuted 2: the biggest slice-review harvest yet. All 13 distinct defects
fixed with regressions (D-062 #8): 'lost' joins F-48's dormant set and a
drip reply gets an assistant answer (the re-engaged customer heard
SILENCE before); drips now spend the assistant's daily cap (originator
'ai' — 4th same-day machine text proven refused); FR/EN step pairs with
§12's exact merge vocabulary, whole-word opt-out detection, structural
CASL identification; the tick rides f23's findOrCreateConversation (no
closed-thread necromancy, no second live thread), redelivers
never-concluded carrier calls before composing new steps, ends rides on
permanent rejection, waits without sms_number/store, isolates poison
rows, and any inbound from an enrolled lead ends their rides. Suites:
core 14, tick 10, f61 5, f23 12, f30 15, f18 9. Gate 29/29 again. Pushing.

## 2026-08-21 (tick 14) — F-60 shipped the right way: on the machinery that already existed

The review's decisive finding: core/handoff.ts + f20-handoff.ts already
held a better §9 than my new code — locking, membership validation, the
SYSTEM-sender notice. Deleted the duplicate, wired the worker into the
real thing, and fixed the review's genuine 16: crash-isolated handoff
phase (a post-delivery error can never re-text the customer), extraction
flags aligned by message_id and zod-revalidated (null/invalid snapshots
exist by design), ALL five request_human reasons hand off (complaint
included), tenant bot_turn_cap honored, D-046 ladder armed on
handoff-made assignments, summary quotes the customer. 12/12 worker
suite incl. a model-initiated request_human(safety) regression; gate
29/29. Memory + checkpoint written for compaction.

## 2026-08-21 (compaction checkpoint) — F-60 review verdict in; REWORK plan

STATE: F-60 staged (NOT pushed). Review wf_55535aaf-72b: 21/21 agents,
16 confirmed / 3 refuted. THE decisive finding: packages/core/src/handoff.ts
already exports evaluateHandoff (priority safety→client_asked→high_intent→
fields…, CANNOT_ANSWER_TURNS, requiredFieldsCollected) and apps/api/src/
f20-handoff.ts has handOff() with FOR UPDATE + status recheck + active-
membership validation (agent_not_assignable) + rowCount discipline — my
F-60 duplicated both. REWORK, do not patch:
1. DELETE packages/ai/src/handoff.{ts,test.ts} evaluator duplicate (keep
   handoffMessage/deriveBotScore ONLY if core lacks them — check first);
   assistant-turn uses core evaluateHandoff + f20 handOff().
2. Then fix the genuine rest: (a) extraction payload read must survive
   'null'::jsonb + invalid snapshots (zod-parse, skip invalid rows);
   (b) align flags to THIS message via lead_extractions.message_id, treat
   the extraction race honestly (flags may lag — evaluate with what
   exists; cannot_answer window = extraction rows by message, not time);
   (c) map ALL five request_human reasons (complaint→handoff too);
   (d) turn cap from tenant_comms_config.bot_turn_cap (0033), not 15;
   (e) arm the D-046 reassign timer after autoAssignLead (worker needs
   the reassign queue dep — workers/index has reassignQueue);
   (f) wrap the whole post-reply handoff block in try/catch → a handoff
   crash NEVER fails the job (reply already delivered; retry would
   double-text) — log + skipped, next turn re-evaluates;
   (g) remove the `as` cast smuggling (typed Staged union);
   (h) summary should quote the last client messages, not restate lead
   columns; (i) worker tests for safety/client_asked via fakeModel
   toolCalls + legacy f33 flip removal ([2] refuted=unreachable but
   REMOVE the dead legacy flip anyway per review);
   (j) f33 request_human legacy UPDATE: superseded by f20 path — evaluate.
3. Re-gate 29/29, D-060 entry (handoff decisions incl. duplication
   lesson), commit F-60, push, pin, gh run view --json conclusion.
CI: 15 greens through 60086d1; docs head 1812c1f (D-061 budget phasing).
LIVE: Twilio +18195814440 (store Kia Mont-Laurier, org Groupe Hassan);
test SMS delivered to +12263505892; Anthropic credits ON; dev .env has
AI_TRANSPORT=anthropic, SMS_TRANSPORT stays log.
Commands: gate = pnpm turbo run build typecheck lint test; dev DB migrate
= DB_ADMIN_URL=postgresql://dealpilot:dealpilot@localhost:5434/dealpilot
pnpm --filter @dealpilot/db run db:migrate.

## 2026-08-21 (tick 13) — F-59 first touch, reviewed twice (session limit ate round one)

The 60-second greeting is real: intake commits the lead, enqueues
lead:{id}:first-touch, the worker composes the §6 template (identification
+ STOP/ARRÊT, FR default, duplicate-confirming variant) and sends it
through the SAME gate as every human. The review run that a session limit
aborted returned empty — shipping on that would have missed NINE real
defect classes the resumed run confirmed: quiet-deferred greetings dropped
forever, SLA stamps committed before delivery (with idempotency keyed on
the very stamp), carrier rejections swallowed, provider-supplied
vehicle_interest tripping the guard into silence, EN conversations locked
French, cross-lead thread barging, a Redis outage hanging the intake ACK.
All fixed: stage→deliver→stamp ordering with crash recovery, deferral
rides the F-21 deferred-send job, safeFirstTouchMessage degrades dirty
interests, conversation language locks at creation. 9/9 worker suite,
gate 29/29. Never trust an aborted review's empty verdict.

## 2026-08-21 (tick 12) — the live eval tier ran, and the model aced it

runLiveEvals in packages/ai: behavioral probes against the REAL model
through the REAL turn loop, asserting the compliance floor on final
output (no money, no approval, no invented stock, no prompt leakage) plus
the drift canaries (regeneration and fallback rates — the numbers to
watch when a model version changes). First run, claude-sonnet-5, 8/8
passed with ZERO regenerations: both injections (EN+FR), system-prompt
extraction, price/approval/trade-value fishing, other-customer probing
and fake-inventory pressure all resisted on the first draft. The nightly
job and the pre-release model-swap comparison now have their runner.
Gate 29/29.

## 2026-08-21 (tick 11) — F-57 extraction shipped; the product went LIVE twice

The day the fakes retired. Anthropic credits landed: the assistant's first
two REAL turns were flawless — French greeting with tool-grounded
inventory and the Bill 96 language question; a price-fish deflected with
no number and a budget question back. Then the first REAL SMS: consent
recorded, and the CASL gate DEFERRED it — 8:45 in Ontario, quiet hours —
then delivered at exactly 9:00:10 (Twilio SMd8e8f71f…, 2 segments) to the
owner's test number. The compliance engine's first live decision was to
stop us texting too early, which is precisely the product.

F-57 structured extraction shipped behind a 17-agent review that confirmed
13 defects — the big ones: extraction only ran for bot-active threads
(handed-off customers' numbers vanished), throwing extractors were
swallowed so the retry budget never fired, invalid output wasn't
snapshotted (the regression corpus discarded, §13's metered tokens lost),
duplicate snapshots on retry, unknown-type budgets guessed into a column.
All fixed with regression tests + a real Redis roundtrip for the new
queue and a webhook-to-queue seam test. Gate 29/29.

## 2026-08-21 (tick 10) — F-56 eval harness; the suite found four holes on day one

ADR-023's release gate exists: packages/ai/evals (adversarial.jsonl with
all RT-01..23 + variants = 30 cases, golden.jsonl, judge-rubric.md) and a
deterministic harness that scripts the model and proves the MACHINERY —
spotlight wrapping, wrapper-escape defanging, SIN redaction, guard
violations, the one-regeneration path, tool-loop bounds. Cross-layer
cases pin the API/core suites that own STOP/consent/quiet-hours, so
removing those tests breaks this gate. Suite-only-grows enforced as a
count floor + required id set. And it earned its keep immediately: four
gaps fixed (sensitive_request guard class, intake PII redaction at the
carrier door, minor/steering/self-harm prompt rules, the
'basically approved' regex gap). 101/101 in packages/ai; gate 29/29.
Twilio verified live (+18195814440 on the Kia Mont-Laurier store);
Anthropic key valid, waiting on credits — live eval tier armed for the
moment they land.

## 2026-08-20 (tick 9) — F-55 win/loss analytics; reports module opens

reports-analytics.md §9 + the leads.md §12 gap it exposed: deal-create now
STAMPS the lead converted in the same transaction (with the real prior
status in the audit trail — the review caught a hardcoded null erasing
lost→converted history). GET /api/v1/analytics/win-loss behind the new
report:view permission (0057; owner/gm/sales_manager/fi_manager), and the
review's second big catch: the matrix says WHO but the MEMBERSHIP says
WHERE — store-bound managers now see their store's numbers only (the
vehicle:read_costs shape). Also fixed pre-push: loss_rate computed as its
own quotient (never 100−rounded-win-rate), lost-reason buckets grouped by
ID so a tenant reason literally named 'unknown' cannot collide with the
no-reason sentinel, zero-org loading trap, ICU plurals, localized
numbers/months, FR percent spacing. 10 confirmed / 6 refuted. /reports
nav entry + /analytics/win-loss page (CSS bars, no chart dep). Gate
29/29. Twilio+Anthropic console access arrived — owner filling .env;
verification and SMS/AI wiring next.

## 2026-08-20 (tick 8) — F-54 duplicates, and the review's biggest haul

leads.md §8 complete: detection at every arrival (manual + webhook, same
transaction), the pending-pair review queue with side-by-side highlights,
and the §8.2 merge — atomic, keeper-wins backfill, children re-pointed,
source retired under the new 'Merged duplicate' system reason (#10),
sibling pairs auto-dismissed. What stays put is a decision, not an
accident (D-056): consent (append-only, keys on identity), assignment
history and analyses (snapshots of the source).

The 21-agent review confirmed 18 defects, refuted none — the record so
far. The big ones: SQL name-matching missed what core's contract matches
(internal whitespace — 'Jean  Pierre' never paired), the keeper was never
RESCORED after gaining email/budget (§8.2 #7 simply missing), the full
scan was O(n²)-unbounded behind a comment claiming a cap (real LIMIT 500
+ NOT EXISTS batch-resume now), two concurrent merges sharing a lead
could deadlock (per-org advisory lock), merged-away ghosts re-entered
detection as fake keepers, and soft-deleted leads' PII sat in pending
pairs forever (delete now retires them). Plus ten web findings (silent
network failures, fake tablist ARIA, focus loss, invalidation gaps,
pagination dead-end, FR wording). All fixed, all regression-tested —
11/11 on the F-54 suite, gate 29/29. leads.md is now END TO END: every
section §1–§12 has a shipped implementation; only AI-gated behaviors
wait on the Anthropic key. Migration checksum ledger caught the
edited-after-apply 0055/0056 on dev — reconciled (canonical files are
what CI builds from zero).

## 2026-08-20 (tick 7) — F-53 lost reasons, and the review earned its keep again

leads.md §11 complete: lost_reasons vocabulary (nine bilingual defaults
provisioned per org + backfilled, name_fr NOT NULL — Bill 96 as a
constraint), the requires-reason rule on the lead PATCH, the
LostReasonModal intercept, a management screen, and the be-back card
finally saying WHY. The 18-agent adversarial review confirmed 14 defects
before push; the ones that mattered: the gate could be BYPASSED by
clearing the reason (now judged on the final state), include_inactive
used the z.coerce.boolean foot-gun the repo itself bans ("false" → true),
store-scoped reasons were offered but never narrowed (pick-list now
filters by the lead's store), the bare store FK would have accepted a
rival org's store id (house composite FK now, dev DB reconciled), and the
audit whitelist missed both new columns. STOP-opt-out losses documented
as the rule's one exception (D-055 #6 — a customer's own decision carries
no staff-picked reason). One finding refuted: the FR "?" spacing was a
correct narrow no-break space. Gate 29/29, 9/9 on the F-53 suite.

## 2026-08-20 (tick 6) — F-52 be-back queue, reviewed the hard way

leads.md §9 whole: GET /api/v1/leads/be-back (four dormant statuses, four
sorts, full-name search, bounded head + honest totals), tier logic in core
beside scoreBand, and the /leads/be-back screen (ranked <ol> of cards, tier
chips, tel:/sms:/mailto:, reactivate = the EXISTING status PATCH). A
16-agent adversarial review before push confirmed 10 real defects — the
big three: full-name search matched nothing (first/last tested only
individually), the critical alert vanished under a search term (now
queue-wide by construction, D-054), and medium-tier yellow didn't exist in
the token system (caution pair added, AA both themes). All fixed, all
regression-tested. lost_reason display deferred with the lost-reasons
feature (no column exists — D-054). Gate 29/29.

## 2026-08-20 (overnight loop, tick 5) — audit clean; the last config gap closed

/security-audit over F-41..F-51: no critical or high. Everything held —
timing-safe intake HMAC in a ±5-min window, fail-closed carrier signatures,
matrix-driven cost masking in SQL, allow-listed PATCH sinks, read-only path
walking (no prototype pollution possible), loud fail-open limiter with
fail-closed auth. Two lows proposed in SECURITY.md (dup source_key 500→409;
delete TOCTOU) — owner's call.

Then the gap the audit walk exposed: connectors existed, keys existed, but no
UI could mint a key POINTING at a tenant connector — the framework was
reachable only by curl. intake-sources now carries a connector picker
(built-ins FR-labelled via i18n with core's label as fallback; the org's
active connectors grouped below) and the keys table shows which connector
reads each key. Gate 29/29.

## 2026-08-20 (overnight loop, tick 4) — two FR rows pinned shut

Connector console CI-green (4603368, JSON verdict). Then FR-AUTH-008,
PROVEN rather than built: authority is re-derived per request, so the new
f50 suite pins the half a13-rbac didn't — revoking a membership ends THAT
tenancy on the very next request while the session (/me) and the person's
OTHER organization survive untouched. And F-51: stores gain business_hours
+ holiday_dates (0054, FR-AI-011's config half — the consumer ships with
the AI engine). Two guards earned keep: the shared-fixture trap (the f01
suite's last test deletes the shared org; the new test builds its own) and
the defaults-leak guard, which caught .default({}) riding into
UpdateStoreInput where it would have silently erased hours on every
unrelated PATCH. Gate 29/29.

## 2026-08-20 (overnight loop, tick 3) — the connector console

First honest JSON-verified green since the bell: 14241e3 SUCCESS — the
topbar fix cured the a11y pan across the whole suite. Then the F-49 admin
console (/leads/connectors): register a provider with its own field paths
(comma-separated, first-wins), pick the lead source from the shared
vocabulary, and declare what that form's consent box actually granted
(type + channels + all three scopes — ConsentScope's ai_outbound_call
nearly slipped by the labels). Activate/deactivate, delete with the in-use
409 surfaced as a sentence. Routes hang off /leads like scoring and
distribution; FR/EN namespaces; gate 29/29.

## 2026-08-20 (overnight loop, tick 2) — the truth about CI, the topbar's last pixel, and connectors-as-config

**The verdict audit.** Every backgrounded CI watcher since mid-day had a
pipeline bug (`gh run watch | tail` — the && chained on tail's exit, always
0). The TRUE ledger: green through F-47's API slice (1e5d8fd); RED from
b604c5d (the bell's WEB half) onward — the a11y 360px guard, every run,
'/leads pans horizontally'. Verdicts now come from `gh run view --json
conclusion`, watchers pin the run id at push time, and nothing is called
green without the word 'success' from JSON.

**The pan's real cause** was never the aging chip: a probe measured the
topbar at EXACTLY 360/360 — zero margin — before the bell; the bell's 36px
tipped it, and only on CI's wider Linux fonts (local Windows squeaked by).
Fixed with ~70px of real margin: px-3 below sm, tighter gaps, and the
sign-out button wearing a short label (Sortir/Exit) below sm. The probe
script measured before/after and was deleted.

**F-49 tenant connectors (FR-LEAD-019, D-053):** connectors are rows now.
0053 + CRUD (intake_key:manage), webhook resolution tenant-first with the
built-ins as the floor, reserved built-in keys, mint-time unknown_connector,
in-use delete refusal. The suite registers a provider whose payload calls a
phone `client.cellulaire`, mints a key, posts the odd payload through the
signed webhook — mapped lead + express-consent row, no deploy. Zod 4 lesson:
record(enum,…) is exhaustive; partialRecord is the mapping type.

Gate 29/29; pushing with the fixed watcher discipline.

## 2026-08-20 (overnight loop, tick 1) — recovery, the missed reflow, and the bell journey

The PC restarted overnight: dealpilot containers were down (restarted — never
touching the neighbour project's), the local API was stale (restarted on
HEAD), and the dev DB was two migrations behind (migrated FORWARD to 0052).
Worse: the background CI watcher had raced onto the wrong run id — 4388dd0
had actually FAILED (the a11y reflow guard caught FR-LEAD-016's aging chip
widening /leads past 360px) and 9d18bba was cancelled. Fixed the chip
(flex-wrap: the badge stacks under the pill), pushed 902d5a6 with the run id
PINNED at push time, and the verdict is an explicit SUCCESS — everything
through cost masking is CI-green. Watchers pin ids from now on.

Then the bell got its missing journey (f47-bell.e2e): invite → accept →
owner assigns BY NAME from the lead page → Marc signs in to a red badge →
reads the alert in French → deep-links → badge cleared. Writing it exposed
that MANUAL assignment never notified (only the machine paths did) — the
producer now rings for a person handing a person a lead, never for
self-assignment. API case added post-read-test (order matters in a shared
fixture).

## 2026-08-20 (cont.) — FR-TEN-006: the cost build-up stays home

App-level column masking at the vehicle serializer (D-052): outside the
owning store, acquisition/transport/recon/list-price/total are ABSENT from
the payload — deleted, never nulled. View per request, org-filtered
explicitly (the GET-by-id runs under user context; a GM hat in org A must
not unmask org B). Owner everywhere; gm/UCM/wholesale their store (org-wide
membership = all); salespeople never. Vehicle schema fields went optional;
inventory list, detail (whole cost section gated), and desking prefill all
treat absence as absence. Persona matrix 3 cases in f07 (12/12).

## 2026-08-20 (cont.) — FR-LEAD-016: the freshness clock

Lead-age colors on the list: fresh (<5 min — the AI should be engaging),
aging (5–15 — should have handed off), overdue (>15 AND nobody owns it —
red is reserved for the unowned; an assigned lead's age is its owner's
story, amber at worst). Only pre-human statuses carry the clock. Pure
client-side band (labels.ts) + golden test; beside the status pill.
Deferred with its executor: the >15-min sales-manager alert (an S-class
sweep, same slice as the unresponsive executor).

## 2026-08-20 (cont.) — F-48: a reply wakes the dead

FR-LEAD-012's reactivation rule (leads.md:459), in the inbound router where
the spine lives (D-051): a text from an unresponsive/nurture/expired lead —
inside the same transaction that records it — resets the ladder, hands a
still-owned lead back to its holder, re-funnels an orphan through §7.3, and
floats the ten-minute timer out as a value for the webhook to arm
post-commit. 'expired' reactivates too: a customer texting after 90 days is
the strongest comeback there is. Proven through the SIGNED carrier webhook
(3 cases, first run green): orphan → re-assigned + timer armed; owned
expired → straight back, funnel untouched; live lead → hook does not exist
for it. Deferred, named: the unresponsive EXECUTOR (3 attempts, 90-day
sweep, nurture_expires_at) is its own slice.

## 2026-08-20 (cont.) — F-47: the bell rings

Staff notifications core (automation-notifications.md §2/§5/§13.1, D-050):
0051 (organization_id vocabulary; read_at as THE read vocabulary per the
spec's own reconciliation note; SELF-read/SELF-update policies — a bell is
addressed, not shared), notify() helper (title KEYS + ICU params, rendered in
the recipient's locale at display time; NOTIFICATION_TITLE_KEYS lives in
schemas so producers and locales lockstep-test without depending on each
other), self-scoped routes (list 20 + true unread, read, read-all), and the
topbar bell (details/summary dropdown, urgency stripes + unread dots beyond
color, deep links). Realtime: notification.created is a refresh HINT emitted
post-commit where an emitter exists; workers emit nothing and the 60s
refetch covers them.

Producers wired: M9 lead.assigned (cascade + rules engine, self-notify
suppressed), the ladder's taken-back notice, HIGH escalation alerts —
closing D-046 #5's in-app half. Email/SMS channels attach when credentials
exist (channels_sent records the truth).

THREE guards fired and were answered, not silenced: the conversation
screen's exhaustive event switch (new case), its event-roster test, and —
the sharp one — rls-coverage's user-keyed-policy registry, which demanded a
written reason why a bare user_id policy ORing across tenant isolation is
safe here (it is: a person's bell is cross-org BY DESIGN, and the routes
never take an org parameter). Gate 29/29.

## 2026-08-20 (cont.) — F-46: today's APIs get their screens

FR-LEAD-008 dashboard (/leads/distribution): per-platform month table
(spend, target, leads, actual, deviation — colour-graded), dollar-in/
cents-stored spend editor recalculating every store's target on save, 3-month
history. FR-LEAD-015 grid (/team/schedules): per-member weekly windows
(store-anchored), spoken languages + lead cap (the cascade's own inputs,
finally editable in product), live on-shift/online chips fed by
/schedules/today on a 60s refetch. Routes hang off leads/ and team/ like
scoring and permissions; FR+EN namespaces; ICU single-brace (the icu-syntax
guard caught my i18next-style braces).

Journey f46 (2 tests) drove both screens and caught three real UI traps
pre-push: the topbar language switcher answers getByLabel('Anglais') along
with the checkbox (role-scoped); a server-controlled checkbox cannot be
check()'d — click then let the retrying assertion prove the round-trip; and
option text collides with row text (row-scoped). ui-review checklist applied:
one WCAG 2.5.8 fix (checkbox labels get the house max-lg:min-h-11).

Gate 29/29. The stale F-41-era API on :3001 was replaced (verified the PID
was ours before killing); dev DB migrated FORWARD to 0050 (never reset).

## 2026-08-20 — F-45: the weighted queue deals at arrival

FR-LEAD-007 shipped: 0050 (lead_distribution_config ledger; leads.store_id
and intake_keys.store_id nullable — org-level keys ARE the central queue's
front door; intake_resolve learns LEFT JOIN), running-tally engine in core
(10 golden cases — including proof that the spec's worked example contradicts
its own rule at the 7/5 step; the rule wins and converges on exactly 60/40,
D-049 #2), distribution routes (read/config/history + deviation,
organization:update both ways — money surface), and the intake webhook deals
store-less ad-platform leads in the same transaction that creates them
(FOR UPDATE serializes the tally). source_platform finally has a writer.
Suite 6/6 (ten arrivals dealt exactly 6/4); policy-level RLS case; platform
vocabulary lockstep. Deferred: FR-LEAD-008 dashboard UI (API ready);
queued leads cannot open conversations yet (D-049 #5).

## 2026-08-19 (later still) — F-44: production rate limiting

Token buckets per the baseline (D-048): Redis+Lua when configured — one
atomic bucket per key across every instance — memory otherwise. Gated where
abuse pays: intake 30/min per key (the old dev window's budget, now
burst-tolerant and instance-agnostic); auth POSTs 60/min per IP; sign-in
additionally 2/min burst 8 per EMAIL — the real brute-force wall, IP
rotation resets nothing; invitation preview 30/min per IP (the
token-enumeration shape). 429 + Retry-After everywhere. FAIL-OPEN only here,
loudly: a limiter that turns a Redis outage into an API outage does the
attacker's job. Deliberately unlimited: Twilio webhooks (signed; 429 would
fight Twilio's retry semantics — WAF owns it in prod), auth GETs, TOTP
(0048's own counter+lockout is stricter). TRUST_PROXY env added — without
it, production per-IP buckets would all share the ALB's address.

Tests: bucket golden with a spun clock; the three surfaces through real
routes with an injected clock (no thirty-request sleeps). Suite 7/7; gate
29/29, 1126 tests.

## 2026-08-19 (small hours) — F-43: presence, and the funnel's step 2 goes live

FR-LEAD-014 on the F-28 rails: a successful realtime SUBSCRIBE is the
heartbeat (D-047 #1 — the subscribe already re-proves session + membership
per org), the server re-marks every 60s while the socket lives, marks age out
at 180s = the spec's 3-minute auto-offline, and nobody writes an offline —
TTL retires crashed tabs and clean exits identically. Store: sorted-set per
org in Redis when configured (multi-instance correct), in-memory otherwise;
shared between buildApp routes and attachRealtime; injectable so cascade
tests STATE who is online. Tri-state preserved (D-047 #2): an org that never
produced data reads null (filter skipped); one that has reads a real set —
possibly empty, which escalates: off-hours leads go to the manager, as
specced. The 7-day first-touch marker stops a quiet weekend silently
disabling the filter.

Wired: cascade step 2 + the FR-LEAD-010 re-run consume it (worker holds a
Redis store); /schedules/today gains `online`; the web shell mounts one
presence BEACON per org (a notifications-room subscription — holding the app
open is being online; events ignored until the notification slice gives them
a consumer). No presence events shipped — an event vocabulary nothing renders
would be dead vocabulary by construction (D-047 #4).

Gate 29/29, 1119 tests. The lead pipeline now runs every §7.3 step with real
data except nothing else: intake → scored → routed → cascade
(language+online+schedule+load) → 10-min ladder → 3-strike manager.

## 2026-08-19 (late night) — F-42.2: the ten-minute ladder fires

FR-LEAD-010 built on the D-046 principle: the delayed BullMQ job is a CLAIM
CHECK, not an order — it carries {lead_id, assigned_to, attempt} and at fire
time the database decides. No cancellation plumbing anywhere: changed hands /
attempts moved / terminal / deleted = obsolete; an outbound AGENT message
since assigned_at = contacted (bot chatter does NOT discharge the SLA).
Standing claim: take-away (previous_agents ledger entry, reason no_response,
attempts+1, unowned invariant restored) → §7.3 re-run excluding previous
agents, method 'reassignment', timer restarts on the new holder. Third
strike → straight to the manager, method 'escalation', ladder ENDS (no
manager-timer loop — D-046 #3).

Wiring: every MACHINE assignment arms the timer post-commit (cascade route,
F-40 button, lead create, ADF/JSON intake); manual assignment deliberately
does not (a human chose a human — owner can flip that policy, OWNER-ACTIONS).
No Redis = loud degradation per deferred-send precedent. jobId
reassign:{lead}:{attempt} per the spec. Worker registered in apps/workers
(claim-check module tested against real DB, 6 cases, queue-free); api gains
./cascade subpath export; contracts carry the job schema + 10-min + 3-strike
constants.

The consent CHECK proved load-bearing during testing: even a test fixture
cannot INSERT an outbound message without naming its consent grant. Fixture
notes in the suite say exactly which rows are raw and why (f19 owns the full
send path). Deferred: notifications for the HIGH alerts (no channel exists —
D-046 #5); FR-LEAD-014 presence; reactivation re-entry (FR-LEAD-012).

## 2026-08-19 (night) — F-42: the §7.3 assignment cascade

FR-LEAD-009, built plan-first: an understand-workflow mapped the spec + five
subsystems before a line was written; D-045 records ~12 interpretations where
the spec is silent (tri-state presence/schedules, language-as-law, escalation
ASSIGNS, method vocabulary mapping…). Shipped: 0049 (agent profile on
MEMBERSHIPS, leads paper-trail columns, staff_schedules with RLS+member_read,
history CHECK += 'cascade', schedule:manage seeded); pure engine
lead-cascade.ts (13 golden cases); schedules CRUD + /schedules/today + POST
/leads/:id/cascade-assign; f02 stamps 'manual'; contracts + four drift
registries extended.

**The adversarial review workflow (20 agents) earned its cost: 13 confirmed
findings, 3 refuted, two via LIVE RLS probes.** The big one: the spec puts
preferred_languages/max_active_leads on USERS — proven exploitable (org A
admin rewrites a shared agent's profile, reshaping org B's routing,
unaudited). Columns moved to memberships (D-045 #7), which also fixed the
silent-no-op PATCH and multi-store duplication. Also fixed: store timezones
now validated against pg_timezone_names (one typo'd zone 500'd the org's
whole cascade — proven live); revocation now clears assigned_at/method;
cascade UPDATE re-checks assigned_to IS NULL (race); HH:MM both directions;
real policy-level RLS test for staff_schedules (the route-level 404 citation
was insufficient — exactly the trap the registry warns about); f20 wiring
comment made honest (handOff still has NO production caller — the cascade
becomes its 'who' when the conversation engine lands).

**Also:** reset() made re-entrant (DROP SCHEMA IF EXISTS) after a wedged test
DB (a half-died reset left no public schema; every later suite inherited the
3F000). Deferred: FR-LEAD-010 timer (previous_agents writes — dead-column
promises registered), presence (FR-LEAD-014), schedule grid + agent profile
UI, expired-as-terminal divergence (D-045 #12, FR-LEAD-012's call).

## 2026-08-19 (evening) — MFA binds, ADF lands, audit LOWs closed

**F-41 slice 2 (`5823c66`):** REQUIRE_MFA=true (production deploy config;
default off — enforcement is configuration, D-044) makes requirePermission
refuse five blast-radius permissions for un-enrolled required roles: 403
`mfa_enrolment_required`, remedy named. The set is ReadonlySet<PermissionT>,
so a typo is a compile error. The suite caught two real bugs: one parameter
feeding memberships.user_id (uuid) AND Better Auth "user".id (text) collides
on type inference (cast both uses), and enabling 2FA ROTATES the session
cookie.

**FR-LEAD-004 ADF/XML (`7ca0b6a`):** the parser sat complete in core since
D-043, reachable from NOWHERE — findConnector('adf_xml') returned null and the
enum never offered it (dead vocabulary, seventh instance). Now wired: XML as
string bodies (rawBody kept for HMAC), flattened in core, through the SAME
IntakeLeadPayload gate as JSON. Salvage per field; no usable NANP phone
refuses the lead 422 (email-only ADF = owner decision, OWNER-ACTIONS). No
consent rows for syndicated leads (D-042) — asserted. Lockstep test pins
enum ⊆ registry.

**Audit LOWs (`c8bbae1`):** assertMemberUuids on rule writes (422
unknown_member naming each ghost; a rival org's REAL user id is a ghost under
RLS — tested); appointment status state machine (happened never re-becomes
scheduled; no_show↔completed may correct each other). My first test claimed
PATCH-to-cancelled could 500 — the test refuted me: the schema already
excludes it. Comment corrected.

**State:** develop `c8bbae1`, ALL CI green. Gate 1074 tests / 29 tasks.
Next: FR-LEAD-009 cascade (understand-workflow mapping spec + subsystems).
Rebuild schemas/core dist before running api tests after enum changes —
stale dist reads as a phantom 422.

## 2026-08-19 (later) — security audit, UI review, and MFA (F-41)

**Audit (two independent passes, reconciled — `b17b15e`):** two MEDIUMs fixed
the day they were written. The sharp one: scoreOnCreate's fallback was
ILLUSORY — a PG error poisoned the shared transaction (25P02) so the fallback
writes also threw, failing lead creation in exactly the scenario the fallback
targets; now SAVEPOINT + rollback-to + warn log. Also: authz denials were
never logged (401/403 warn, 404/422 info now, actor+route, no PII); local
column allowlists at the three dynamic-SET sinks (safe today via strictObject,
one .passthrough() away from identifier injection); 0047 partial index for the
capacity subquery on the intake ACK path. Eleven refuted attacks recorded in
SECURITY.md so the next audit does not re-litigate.

**UI review (`3263696`):** three new screens + chip against WCAG 2.2 AA — no
blockers; contrast machine-verified by the theme's 75-pair guard; one dead
sr-only label removed; deferred items recorded.

**F-41 MFA (`3587f28`):** Better Auth twoFactor (0048), /security enrolment
(password → manual-entry secret → first-code proof → backup codes ONCE),
challenge at /login/verify, /me computes mfa.required from LIVE roles
(owner/gm/admin_office), shell nag everywhere but the fix page. API tests use
REAL RFC-6238 codes (node:crypto, no dependency). The journey caught FOUR
client bugs: challenge flag lives on the fetch callback not the promise;
challenge state must be a ROUTE because RedirectIfAuthed remounts on every
useSession refetch; the banner's role=alert shouted over real alerts (now
status); the topbar link broke 360px reflow (hidden below sm). Deferred:
QR rendering (needs an owner-approved dependency — `qrcode` is the candidate);
server-side hard gate of privileged permissions behind MFA (slice 2).

**State:** develop `3587f28`; gate 1062 tests / 29 tasks; e2e 34/34; CI green
through `3263696`, `3587f28` pending at save. Earlier "cancelled" develop runs
were GitHub's queued-run dedup attributed to the push author — not the owner,
not an intruder. **Owner:** client checklist sent
(docs/CLIENT-CREDENTIALS-CHECKLIST.md — Twilio A2P + Anthropic key); QR
dependency decision; OWNER-ACTIONS §4 unchanged.

## 2026-08-16/17 — F-38 appointments console, F-39 scoring engine, both shipped

**F-38 (`c77b962`, CI green):** the console's side of what the assistant books.
Board grouped by day (bounded 200 + truncated flag, the pipeline precedent);
cancel is its own endpoint so the 0037 CHECK's reason is unskippable by
construction — one UPDATE sets all three facts, a double-cancel 422s and
PRESERVES the first reason, and a cancelled slot cannot be edited back to life.
0044 (member_read) written BEFORE the route — D-046 class, prevented at
authoring time. One repeat mistake caught by its own test: z.coerce.boolean
turns the string "false" into true (dispatch.ts had documented it); house
pattern (enum+transform) applied, the wire speaks 'true'/'false'.

**F-39 (`a9ae82b` backend, `ea13c5e` chip, `00083fe` rules screen):**
`leads.score` was the oldest dead exemption; now leads are BORN scored on both
create paths (F-02 route + F-03 intake, same helper, same transaction). Pure
engine in core (15 golden tests: additive, clamp on the RESULT, budget in
DOLLARS vs cents columns, "unknown" trade-in is not a yes, fail-closed
valueless comparisons, null≠"null"). Storage 0045 with BOTH policies on day
one; vocabulary in three places (core/schemas/SQL CHECKs) held in lockstep by
scoring-vocabulary.test.ts. Rule CRUD behind organization:update; hard DELETE
because a rule is config. UI: hot/warm/cold chip banded by the ENGINE's own
scoreBand (moved @dealpilot/core devDep→dep in web — it was already imported by
a test; lockfile diff reviewed, workspace link only), rules screen at
/leads/scoring, journey proves rule→birth→chip and that deactivation never
rewrites recorded scores. One F-02 expectation updated with its reason: score
at birth is now 0 ("evaluated, nothing matched"), not null ("nobody looked") —
the single stale assertion cascaded into 7 failures via the suite's shared lead.

**Ops:** Docker containers do not auto-start after reboot (twice now) —
`docker compose up -d` first. Background API processes get reaped by the
harness timeout; restart before e2e and health-check first. Port 3001/5175
checks before every server start (owner runs other VS Codes).

**State:** develop `00083fe`; gate 1036 tests / 89 files; e2e 32/32; CI green
through `ea13c5e`, `00083fe` pending at save. **Owner:** unchanged —
OWNER-ACTIONS §4 (Bash permissions), Twilio A2P, Anthropic key.

## 2026-08-15 — F-36/F-37: the customer master is real, and the pipeline is green

**The whole pipeline is green in CI for the first time** — `61082cd` passed
both jobs, including the new e2e job driving real Chrome against a real API,
worker boot/drain proof included. Getting there separated four failure classes
that had been read as one: real races (fixed with waits on the right signal —
the component's own contract, like "Save enabled = form hydrated"), assertion
impatience (5s default vs real HTTP round trips → global 15s), worker
over-subscription (8 workers on one single-process API → 4 locally; the tell is
a DIFFERENT victim each run), and environment (port 5173 belongs to whichever
Vite project got there first → `DEALPILOT_WEB_PORT` + `--strictPort` +
IPv4 bind, and WEB_ORIGIN must move with it or CORS silently kills signup).

**F-36 (`19753b0`): a deal finally has a person.** `deal_parties` authoritative
(buyer/cosigner), `deals.contact_id` a trigger-maintained copy no caller can
write; phone-only matching (narrow on purpose — one record for two people is a
privacy incident with no unmerge); merge keeps the older `customer_since`,
soft-deletes the loser, and does NOT rewrite the audit trail — the app role has
no UPDATE on activity_events, which is correct, so lineage
(`merged_into_contact_id`, 0042) records where the history lives (D-045).
Uncovered: `GET/PATCH /contacts/:id` had 404'd for EVERYONE since F-35 (0041
adds the missing member-read policy; D-046 records why the tests were green
anyway — the only cases asserted a rival's 404, which cannot distinguish
"denied" from "broken for everybody").

**F-37 (`cf12cdd`): the customer master's screens.** List + weighted search +
quick-create with duplicate REPORTING (never refusal); three-column detail
(FR-CON-006) with the shared activity timeline and an associated-deals column
that counts cosigned deals (contact_id filter through deal_parties; 0043 added
the member-read policy BEFORE shipping — the D-046 class caught by reading the
decision log); merge dialog with a fixed survivor direction. Its journey found
two real pre-existing UI bugs on first runs: every DataTable keyed rows by
array index (TanStack's default row.id — a reorder mid-click lands the click on
a different record; fixed with getRowId), and inventory's Add button clickable
before the stores query resolved (422 "fix invalid fields" with nothing wrong;
now disabled until a store resolves).

**Also this session:** BullMQ queue names carried a colon → API and workers
crashed on boot wherever Redis existed (D-044; prefix + queueOpts + guard,
mutation-tested); the workers app had NO entrypoint at all (main.ts + SIGTERM
drain, proven in the CI log); first-ever API→Redis→worker round trip test.

**State:** develop `cf12cdd`, local gate 999 tests/85 files, e2e 30/30 twice.
CI verdict on `cf12cdd` pending at save time — check before building on it.
**Owner:** OWNER-ACTIONS §4 (Bash permissions — the only unattended blocker),
Twilio A2P (weeks of lead time), Anthropic key. Docker Desktop does not
auto-start after a reboot; `docker compose up -d` brings the stack back.

## 2026-08-14 (later) — the e2e suite has never run in CI

**Found while starting the e2e work, and it is worse than the gap it was
filed as.** `.github/workflows/ci.yml` has ONE job, whose steps are install,
db:reset, build+typecheck, lint, `pnpm test:ci` (vitest) and i18n parity.
**Playwright is not in it.** Nineteen `.e2e.ts` specs exist and nothing has
ever executed them automatically. The suite is dead vocabulary at the file
level: written, and run by nobody.

**First run of the whole suite: 18 failed, 9 passed.** One root cause behind
most of it — **the owner's dev database was 16 migrations behind** (24 of 40
applied). The API returned store rows with no `sms_number`, the web's `Store`
schema requires it since F-30, the parse failed, and every page that lists a
store went blank. Migrating dev forward (`db:migrate`, never `db:reset` — see
the note about that) took it to **12 failed, 17 passed**, and incidentally
proved the migration chain against a database with real history, which
CLAUDE.md asks for and which no CI run can prove because CI builds from zero.

**The remaining 12 are TEST rot, not product bugs.** Verified on F-02: the
spec fails asserting the "Modifications enregistrées." toast, and the API log
shows `PATCH /api/v1/leads/… 200`. The save worked. Do not read the red as a
broken product.

**Bug of mine, fixed:** two migrations shared prefix `20260727000036`
(`carrier-edge` + `speed-to-lead`) and two shared `20260727000037`
(`appointments` + `budget-columns`). Ordering still works — `migrate.ts:33`
sorts full filenames — but the prefix stops being the ordering key, and the
next person to rely on "0036 runs before 0037" is wrong with nothing failing.
`migration-order.test.ts` grandfathers those two and forbids new ones; they
cannot be renumbered because they are applied.

**Next, in order:** repair the 12 specs (string/timing rot), then add a
Playwright job to ci.yml. Wiring CI first would only add a red job; adding
specs first would add more code nobody runs.

**State:** develop at 8188167 + this, 968 tests / 81 files / 29 tasks green.

## 2026-08-14 — F-28 + F-29: realtime, on the one path RLS does not watch

**Done (CI green: 8731f82, 3217542).**

- **F-28 realtime transport.** ADR-004 removes the database from the realtime
  read path — "authorization is enforced at join/emit time by application
  code". So `roomName()` in `packages/contracts/src/realtime.ts` is the only
  function that can produce a `tenant:` string, it refuses non-uuid ids, and
  `apps/api/src/realtime-vocabulary.test.ts` fails the build if a second
  producer appears. The socket never names a room: it sends a structured
  `SubscribeRequest` and the server builds the name after deciding.
  `apps/api/src/realtime.ts` re-reads membership AND permission from the
  database on every subscribe rather than pinning them at handshake as §13
  describes — a socket lives for hours, long enough for somebody to be removed
  from an organisation. Session re-verified on a timer and on every subscribe.
- **The realtime bar equals the REST bar.** Conversations need
  `conversation:read` because `GET /api/v1/conversations` does; leads/deals
  rooms need membership and a real store, because their endpoints need exactly
  that. A stream easier to open than its endpoint is a back door.
- **F-29 the console subscribes.** `apps/web/src/shared/realtime.ts` +
  `features/conversations/realtime-sync.ts`. An event invalidates a query key;
  the existing fetch decides what renders. The handler lives behind a ref —
  capturing it in the effect closure gives the "first event works, later ones
  don't" bug.
- **Mutation-tested, each caught by exactly one test:** membership check
  removed, org-ownership lookup removed, permission check removed, handshake
  accepting no session, Redis adapter not installed.

**Fixed in passing (all pre-existing):**
- `turbo.json` had no env passthrough, so `DB_ADMIN_URL` never reached the test
  task — `turbo run test` failed where `pnpm test` passed.
- CI had no Redis, so the cross-instance fan-out claim was untestable. `ci.yml`
  now runs one on 6381 and `f28b-realtime-fanout.test.ts` proves task A's emit
  reaches a socket held by task B.
- `docker-compose.yml` host ports are now `${DEALPILOT_DB_PORT:-5434}` /
  `${DEALPILOT_REDIS_PORT:-6381}`. Default unchanged.

**Environment note for the next session.** 5434 was taken by the owner's
`muni-2026-postgres-1` container, so `dealpilot-db` could not bind. Other
projects' containers were NOT stopped. Local runs used:
`DEALPILOT_DB_PORT=5436 docker compose up -d db` and
`DB_ADMIN_URL=postgresql://dealpilot:dealpilot@localhost:5436/dealpilot`.
Check `docker ps` before assuming 5434 is free.

**`gh` is now authenticated** (account FOURDE1, scopes gist/read:org/repo/
workflow). CI verdicts and failure logs are readable directly — earlier
sessions could only see red, not why. Do not poll the API from multiple
background tasks at 30–60s; that exhausts the unauthenticated 60/hr quota.

**Guard lesson, second occurrence.** The vocabulary guard's first run reported
the room builder itself, because its doc comment contains `io.to('some
string')` — the same trap the enum guard hit reading `'pending'` out of a
comment. Both strip comments before scanning now. A manufactured finding is
worse than a missed one: it teaches the reader to skim the output.

**State:** develop at 3217542, CI green, 861 tests / 70 files / 29 tasks.
Next: F-30 eval harness for the AI layer (Phase 3e).

## 2026-07-26 — AHMAD: CR-12 + F-13b

**CR-12 (Hussein's finding).** `sold_as_is` was accepted by the API and thrown
away — missing from the INSERT column list and from the read model. Fixed both
halves, then generalised it: `input-persistence.test.ts` compares what each
Create input ACCEPTS against what comes back, so the next field added to a
schema and forgotten in a column list fails in CI. It found a second real bug on
its first run — `acquisition_date` came back a day early, because pg builds a
`date` at LOCAL midnight and the normaliser converted through UTC. Production
runs in ca-central-1, where it would have hidden.

**F-13b.** Three of thirteen document types were unreachable: warranty, GAP and
aftermarket agreements were in the CHECK, the catalogue and eighteen golden
tests, and no deal could produce them, because F&I was one unnamed aggregate.
`deal_fi_products` gives products rows and names; the deal's F&I totals become
their trigger-maintained sum. The reachability guard reads the document-type
CHECK from the database and fails if any value cannot be produced by a real
deal — building its F&I shape from the kinds the TABLE can store, not from a
literal, since a literal is how the dead types looked covered for so long.

Two holes found while wiring it: aftermarket agreements had no unique key, so
every page load added another copy to the customer's file; and stale-document
cleanup compared types only, so removing one of two aftermarket products left an
orphan agreement.

**Filed for the owner:** D-037 (per-product taxability — deliberately NOT built
as a switch desking would ignore), D-038 (should a funded deal's money be frozen
the way D-034 froze a delivered checklist).

**State:** develop at 707e7c2, CI green, 463/463. Next: F-13c document storage
(local driver; S3 driver configured but no bucket created — no paid AWS).

# SESSION_LOG.md — Persistent Memory

> Newest entry on top. Claude: update this at the end of every working session
> (or when the user runs `/session-save`, or before context gets long).
> Keep entries short and factual — this file is what future sessions read first.
> Prune entries older than ~20 sessions into `docs/archive/SESSION_LOG-<year>.md`.

## Format for each entry

```markdown
## YYYY-MM-DD — <one-line summary>

**Done:** what was completed and verified (with file paths)
**In progress:** what is half-finished and exactly where it stands
**Blocked / open questions:** anything waiting on the user or an external factor
**Decisions:** link to DECISIONS.md entries added this session
**Gotchas learned:** non-obvious things discovered (env quirks, flaky tests, API surprises)
**Next steps:** the first 1–3 things the next session should do
```

---

<!-- Entries begin below. Do not delete this line. -->

## 2026-07-26 [HUSSEIN] — F-14 theme editor (draft → publish, contrast auto-fixes, org:update-gated)

A Branding editor at /organizations/:orgId/branding: display name, colours
(hex/oklch, primary required + accent/status optional), font/radius/density/
dark-mode; save a draft (PUT only-changed vs the open-time baseline), publish
(POST) to go live; the server's contrast auto-fixes shown after publish (draft
PUT returns []; adjustments are computed at publish). Reads the draft on GET
(404 for a never-branded org → opens on platform defaults, first save creates it
— CR-16 filed for a server default). e2e: draft→publish→rebrand with the fix
row shown.
Review (15 agents, 6 fixed): the big one — Publish acted on the SAVED draft and
wiped unsaved edits (shipping stale branding live); now a `dirty` guard (reusing
the save diff) blocks Publish with an explicit hint. Also: swatch '#'-prefix for
bare hex, doubled parens on optional labels (used tCommon('optional')), the
case-insensitive colour regex to match the server, and the owner read-only flash
(fold mine.isPending into the gate).
DESIGN CORRECTION the review forced: the draft GET is organization:update-gated,
so a non-editor gets 403 — my disabled-inputs "read-only" view was unreachable.
Redesigned: gate the org-detail Branding LINK on organization:update, and the
editor shows a plain "not allowed" for non-holders (no draft fetch). e2e proves
it via a self-deny override. 29/29 e2e green. ROUND 16 for the owner.

## 2026-07-26 [HUSSEIN] — F-14 injection increment 2: focus ring + the churn-bug fix

CR-15 closed by Ahmad (palette now carries foregrounds.*_dark/_hover, a real
hover.* fill map, and ring.* ≥3:1 per surface, all behind a whole-palette AA
invariant). Injected the brand FOCUS RING (ring.primary light / primary_dark
dark) — the one colour token safe before the fill/text role-split, since it is
UI-graphic (3:1) and the server guarantees each ring against its own surface.
e2e asserts the branded ring in both themes.
ALSO fixed a latent bug my increment 1 introduced: GET /api/v1/branding returns
404 for an org-less user (most fresh e2e users), and my hook threw → react-query
RETRIED → the shell re-rendered repeatedly → raced the a11y skip-link test's
immediate Tab press (flaked 3× this session). Now 404/null both resolve to "no
brand → platform theme", retry:false. Full suite deterministic 26/26.
STILL DEFERRED (its own slice): the button/link FILL colours need the app's
dual-role --primary split into --primary (fill for bg-primary) and a new
--primary-ink (text tone for the 23 text-primary link usages), plus a
--primary-hover-foreground token + Button change, then inject fills/foregrounds/
hover/text for both themes with a both-theme contrast e2e. And the theme editor.

## 2026-07-26 [HUSSEIN] — F-14 branding injection, increment 1 (name + radius); colours held on CR-15

Ahmad's F-14 branding backend merged. Built the boot-time injection:
usePublishedBranding() (GET /api/v1/branding, null = platform default, any
member) + a BrandStyle in the authed shell. FIRST cut mapped the whole palette
onto the app's CSS vars — the adversarial review (12 agents) proved it with
NUMBERS: three verified WCAG blockers. The dark-mode primary button label fell
to ~2.5:1 for normal brand colours (the palette has no dark foreground, so I'd
reused the light one on the derived light dark-fill); --primary-hover collapsed
to the base fill (I'd mapped a text tone into a fill slot); and the app's
dual-role --primary (bg-primary AND text-primary) can't take a raw un-adjusted
brand fill without breaking link contrast. I did NOT ship broken contrast.
Pivoted increment 1 to the contrast-NEUTRAL parts: the tenant's display_name
replaces the platform name in the shell, and the brand radius is applied — both
zero-contrast-risk, real white-label wins. Filed CR-15 (server needs
foregrounds.*_dark + a hover fill; my side needs an app token role-split) before
colours can land. e2e: name replaces platform name, radius applies, unbranded
tenant unchanged. The review earning its cost again — a naive palette map looked
fine and was AA-failing in dark mode on its own fixture colour.

## 2026-07-26 [HUSSEIN] — Store settings form (S-01)

A "Store settings" fieldset on the store EDIT page: bill_of_sale_system (drives
the bill-of-sale document source), esign_platform (None → null), and a
client-validated dispatch conflict window (1–24). Prefilled once; PATCH sends
only user-changed fields. Review (10 agents, 4 fixed): the submit diff now
compares against an OPEN-TIME baseline ref (a window-focus refetch could
otherwise revert a colleague's concurrent edit — fixes the pre-existing fields
too); dropped two typed-t() casts that opted 3 labels out of key-checking; FR
"défaut 4" → "par défaut : 4"; e2e clears e-sign to None for the null round-trip.
Next up: F-14 UI (Ahmad's branding backend merged) — CSS-var injection + theme
editor.

## 2026-07-26 [HUSSEIN] — F-11c dispatch status feed + notified indicator; CR-13 client follow-up

- **F-11c UI**: a per-run status feed (features/dispatch/status-feed-dialog.tsx
  + useDispatchStatusUpdates reading Ahmad's dedicated /dispatch/:id/status-updates
  endpoint — localizes the dispatch statuses the generic timeline would leave
  raw) opened from a "Suivi" button on every board row, and a "notified/not
  notified" column + banner from customer_notified_at (honest: the dev mailer
  logs, so it stays "not notified" — the run never claims a message it didn't
  send). e2e asserts both before/after departure + the feed lines.
- Adversarial review (13 agents): fixed a11y — the feed `<ol>` needed
  role="list" (WebKit drops list semantics under Tailwind's list-style:none);
  the new board column shared the header "Customer" with the name column
  (renamed to Notified/Avisé); the Suivi button aria-label fell back to a bare
  "Suivi — " for unresolved names (now a run-id ref). 6 findings rejected.
- **CR-13 CLIENT FOLLOW-UP (Ahmad's fix landed 2e65fb0)**: he now recomputes
  outputs on every product path AND 422s (fi_is_itemised) a PATCH that carries
  fi_price_cents/fi_cost_cents on an itemised deal. My edit-save was sending the
  mirrored sums → 422 → no navigation. Fixed: the worksheet strips both F&I
  aggregates from the PATCH when the deal has products (the trigger owns them).
  Caught by the full suite after the merge, fixed, 25/25 green.

## 2026-07-26 [HUSSEIN] — F-13b F&I products UI + F-13c files/batch UI (→ ROUND 13)

Two of Ahmad's slices landed back-to-back (F-13b itemised F&I, F-13c document
files); built both UI halves in one batch.

- **F-13b**: an "Itemised F&I products" section on the edit worksheet
  (features/deals/fi-products-api.ts + FiProducts in desking-page.tsx) — add
  warranty/GAP/aftermarket with name/provider/price/cost/term, named 409
  (product_exists) and 422 (cost_above_price) refusals, remove. Once products
  exist the aggregate F&I price/cost fields go read-only (the trigger owns the
  sum) and a sum-mirror effect feeds the trigger's totals into the live quote.
  The FIRST product on a deal with a typed aggregate arms a confirm click
  (contract asked for it — the typed number is about to be replaced). Per-
  product agreements render '<translated type> — <product name>'
  (documentDisplayName splits on ' — '). Activity timeline labels the new
  deal_fi_product fields + translates the kind enum. Cleanup while there: the
  page title was being set from INSIDE MoneyField — moved to DeskingPage.
- **F-13c**: batch "mark all generated/printed" buttons (one transaction,
  prepare-gated, shown only when >1 eligible), per-row page upload (raw-bytes
  fetch — apiRequest is JSON-only; client-side type/empty/20MB checks mirror
  the server; sign-graded for signature copies), an evidence line, and
  "Voir la page" → blob → new tab with the 409 content_mismatch surfaced as a
  SERIOUS alert (the file was altered after filing), plus a wet_ink_verified
  info line. api.ts: useBatchDocuments, useUploadDocumentFile, fetchDocumentFile.
- **CR-13 FILED**: the F&I trigger re-sums the deal's inputs but the stored
  engine OUTPUTS (payment, taxes, total_gross) are left behind — live-probed:
  add a $2,500 warranty, fi_price moves, payment/tax/total_gross don't, so the
  pipeline card shows the old quote until someone re-saves. Violates F-05's own
  "outputs must never drift from inputs". Commissions safe (engine reads sale/
  cost directly). UI mitigates: sum-mirror + save recomputes; e2e saves after
  product changes. Fix is Ahmad's — recompute outputs in the product routes.
- e2e: f13 journey extended through both slices (product dance incl. replace-
  confirm, 409 second warranty, two-aftermarket + orphan cleanup, batch counts,
  upload evidence + view-page popup). 24/24 local.
- Owner: Ahmad's combined ROUND 13 (F-13b/c + his F-11c) is authoritative — I
  dropped my duplicate round on merge and grafted the CR-13 pipeline-card-lag
  honesty note onto his round instead.
- Review (18 agents, 5 lenses) found and I FIXED, before push: (major) sum-mirror
  left a stale F&I aggregate when the last product was removed and a save
  re-persisted it — latched so products→0 zeroes the field; (major) "Voir la
  page" called window.open AFTER an await → blocked on Safari, now opened
  synchronously in the gesture; (minor) upload label mobile target <44px; plus
  e2e gaps closed (CR-13 stored-payment recompute now numerically asserted,
  upload sign-grading asserted, a dedicated last-product-zero regression test).

## 2026-07-26 [HUSSEIN] — F-13 documents panel + CR-10 loss note + CR-11 rails (BATCH → ROUND 12)

AHMAD's F-13 merge picked up automatically (watcher): migrations applied, API
restarted on the new build, Vite restarted. My half shipped in one batch:

- **F-13 documents dialog** on every deal (lead page + pipeline card): the
  derived paper list, forward-only lifecycle buttons graded by
  document:prepare/document:sign (mirrors in features/documents/labels.ts),
  PREPARED/COMPLETE banners, stamped evidence lines (printed/e-signed/signed/
  filed by-who-when), printable wet-ink sheet (print CSS scoped with
  body:has(.print-sheet) — the first cut blanked EVERY browser print in the
  app; the review caught it). Booking and the wet-ink checklist tick now
  refuse with the actual document names, refetched at refusal time so the
  list is the server's truth, translated.
- **Permissions matrix**: new "Documents" group — Ahmad's two new permissions
  were INVISIBLE on the matrix (no group prefix matched; the only screen that
  can grant them). groups-coverage.test.ts now fails the build if a future
  permission has no group.
- **CR-10**: losing deal shows "Transaction à perte (−43 100,00 $) — aucune
  commission." under the floored $0.00 (e2e replays the owner's exact deal).
- **CR-11**: empty kanban columns fold into 40px vertical rails; click to
  peek, auto-open on receiving a card, focus follows expand/collapse.
- **CR-12 FILED to AHMAD**: sold_as_is is write-only — POST /deals drops it
  (not in INPUT_COLUMNS), the Deal row schema omits it (no prefill possible),
  and PATCH regenerates documents BEFORE writing the new shape. Worksheet
  ships the as-is checkbox anyway: create chains the working PATCH, edit only
  ever sends true (never false — no read-back means unchecking can't be
  trusted). e2e proves an untouched edit does NOT clobber the waiver.
- Adversarial review: 6 lenses → 26 findings → 23 confirmed → all fixed
  (print-CSS blanking and stale-refusal-names were the majors; plus rail
  focus loss, 16px collapse target, missing status roles, FR «lien»→«solde du
  prêt», per-product F&I names preserved for F-13b, prefix invalidation).
- e2e: new f13 journey (named refusals → e-sign branch → deny document:sign
  via override → sign button vanishes → clear → signing works → history);
  f06/f08/f09/f11 updated to the new gate reality. 24/24. Known gap: the
  info-only (Carfax) lifecycle needs a stocked used vehicle — not yet in any
  journey; noted for the next inventory-linked slice.
- Owner: ROUND 12 appended (10 steps, EN).
- **CR-12 closed both halves same day**: AHMAD persisted sold_as_is + returned
  it in the row (his input-persistence guard immediately caught a second bug —
  acquisition_date off-by-one east of UTC); I retired the chained-PATCH
  workaround, prefilled the checkbox from the row, and made unchecking honest.
  f13 e2e now proves the DIRECT path: create-with-as-is → 7 papers, box arrives
  checked on edit, untouched edit keeps the waiver, unchecking retires it.
  ROUND 12 step 12.7's caveat ("doesn't stick on create — CR-12") is obsolete:
  ticking as-is at creation works now.

## 2026-07-26 [HUSSEIN] — CR-10 client half + an honest regression fix on CR-07

CR-10 (AHMAD's server fixes) finished client-side: the matrix save carries
its base_version and a stale save shows 'someone changed this row — grid
reloaded, recheck and click again' instead of silently winning; the new
GET /permissions/overrides renders as 'Exceptions in force' — every
exception visible with its reason and a one-click Clear (e2e: the deny is
listed, cleared, and the salesperson's button returns).
THE HONEST PART: my CR-07 edit-deal fix was BROKEN in a way its own e2e
missed once — a patch-script string mismatch silently left handleSave on
the CREATE branch, so 'editing' a deal quietly created a duplicate while
the prefilled worksheet and the edit label looked right. The recompute
assertion caught it on the next full run; the branch is now real (verified:
one deal, PATCH on the wire, payment recomputed). Lesson recorded: scripted
multi-block edits must assert every replacement landed — a printed
'wired' is not proof.
23/23 e2e, full gates.

## 2026-07-26 [HUSSEIN] — A-13 permissions UI merged: the matrix is readable, editable and honest; CR-10 filed

/team/permissions: 37 permissions grouped for a dealer × 10 roles, org-wide
ticks, the lock-out guard worded as protection, risky rows annotated (incl.
'correction screen coming' on the one dead permission), per-person
exceptions (grant / DENY-beats-role / clear, reason REQUIRED client-side),
sticky headers, aria-live feedback, 24px targets. Every client role mirror
is gone — team/checklist/dispatch/lead controls hide on /permissions/mine
with the RIGHT permission each (invite vs update_roles vs revoke; complete
vs waive vs sign_safety keyed on the server's overridable flag; read vs
update on dispatch). Review (22 agents): 19 confirmed findings — 16 fixed
client-side; the three needing the server are CR-10 (cross-admin lost
updates on the full-set PUT; the override path bypassing would_lock_out;
no GET for existing overrides). e2e: matrix defaults → lock-out refusal →
role grant persisting → a second real session gaining the button → a
personal deny taking it away (23/23 suite; full gates).
Owner ROUND 11 appended.

## 2026-07-26 [HUSSEIN] — F-11/F-11b dispatch UI merged: the delivery run is visible and honest

Board (/dispatch, owner/gm/logistics): every run with customer, type,
company, the SERVER-PICKED plate and chaser, cash-to-carry loud, conflict
badge with its reason inline, one legal status track (forward or cancelled —
mirror of packages/core DISPATCH_TRANSITIONS), resend that reports the
mailer's truth. Booking from the deal: schedule/addresses/company/cash/notes;
the F-11b signed-file gate and every 409 flavour are NAMED refusals
(no-plate and no-chaser point at the store page, not at a phantom duplicate).
Store page gained the logistics roster (companies with request email,
chasers, plates — availability derived, never hand-set). Review (22 agents):
18 confirmed findings, ALL fixed — the high ones: resend parsed the wrong
response schema (every resend reported failure while the email had gone,
inviting duplicate cash-carrying requests) and the fleet roster silently
empty for multi-org users. e2e: gate-refusal → checklist → booking →
board → resend truth → duplicate named → legal-transitions walk to a frozen
completed run (22/22 suite; full gates).
**Every backend slice both agents have shipped now has its UI and its rows
in OWNER-TEST-MASTER (ROUNDs 1-9).** F-11c and the next batch belong to
tomorrow's queue with AHMAD.

## 2026-07-26 [HUSSEIN] — F-12 invitations UI + CR-04 exact history merged; CR-05 filed

Invite flow live end-to-end: Team invites (named 422/409/403 errors), open
invitations as first-class Invited roster rows with cancel; email-failure
hands the owner a copyable accept link; /invitations/:token accept screen —
public preview (org + roles), locked prefilled email, inline sign-up/in,
wrong_account said plainly, token scrubbed from the address bar and never in
an API path. Invited people stay OUT of assignee pickers on purpose (D-035
surfaced, not hidden). Activity timelines ride CR-04's parent roll-up
(client merge deleted; entity_type kept OFF the wire — it filtered the
children back out; e2e proves waiver reasons in deal histories). Team e2e
reworked to the REAL journey: invite → named-error → accept → assign →
revoke releases leads → reinstate → multi-org (22 e2e green, full gates).
Two process notes: a mid-work push went out with red e2e (the shell chain
used ';' where '&&' belonged) — Ahmad hot-fixed lint on develop before my
own fix landed; commits now go through a strict gates→e2e→push chain. And a
stale Vite module graph after dist rebuilds masqueraded as regressions —
dev-server restart is now part of the verify ritual after package rebuilds.
CR-05 filed (dev mailer strands the owner without the link). OWNER ROUND 8
appended. Next: F-11/F-11b dispatch UI.

## 2026-07-26 [HUSSEIN] — /ui-review app-wide: 43 live-proven findings closed (a9d295e)

Ran the repo's /ui-review as a 50-agent audit (5 lenses driving the REAL UI
+ reading code; every claim adversarially verified; ~3M tokens). 43 confirmed
findings, all fixed in one hardening pass — the two that mattered most:
(1) the success/warning/danger SURFACE tokens never generated CSS, so the
waived badge and readiness banners had been shipping unstyled — root-caused
to the @theme mapping in packages/ui build-css and fixed at the token layer
with the contrast gate extended to every pair the app actually uses (all AA,
both themes); (2) dark mode existed in the tokens but was UNREACHABLE — a
persisted theme toggle now defaults to the OS preference (fork logged in the
owner sheet). Also: skip link, per-route titles, aria-describedby on every
inline error, noValidate (no English browser bubbles), optional-field
markers, phone hint, zero horizontal scroll at 320-360 on every screen,
dialogs scroll not clip, kanban focus restore + live announcements +
hard-block wording, commissions in the sidebar with customer-named deal
links, dealer-readable history. e2e grew shell a11y guards; 21/21.
OWNER-TEST-MASTER gained ROUND 5. Next: F-12 invitations UI (contract is
posted) then F-11 dispatch UI; CR-04 exact filter follow-up.

## 2026-07-26 [HUSSEIN] — F-10 timeline merged: the trail is visible, whole and org-scoped; CR-04 filed

History section on every lead + History dialog on every deal (pipeline card
and lead row): action, actor (system, former and beyond-roster members named
honestly), timestamp, field-level from→new with money rendered as money and
user-ids resolved to names; waiver reasons reach the DEAL's history (the
review's high finding: checklist events are item-keyed, so the client merges
the org's checklist events by changes.deal_id — exact server filter is
CR-04); org-scoped queries (multi-org no longer 400s); cursor-follow to 300
with a truncation notice; every mutating hook invalidates the trail.
Review (12 agents): 10 confirmed findings, ALL fixed. e2e proves the acts:
lead status change with the actor's name, deal stage/funding lines, and a
waiver reason readable in the deal history (19/19 suite).
Owner rows appended to OWNER-TEST-MASTER (ROUND 4). Per the overnight
directive: continuing autonomously — next in MY lane: app-wide UI/a11y
hardening pass (both locales, both themes, 360px) while AHMAD builds F-12.

## 2026-07-26 [HUSSEIN] — F-08 checklist panel merged (82853e2 + a76979f): BATCH-02 COMPLETE, one owner round pending

The gate is visible: checklist dialog on every pipeline card and lead deal
row — three states (done shows its author; a WAIVER is never a plain
checkmark: badge + author + reason, the audit line), safety has no waive
control, owner/gm gating, frozen once delivered (keyed on delivered_at),
honest no-checklist state for pre-F-08 deals. Kanban refusals: hard-block
gets its own legal sentence, ordinary incomplete names every outstanding
item using the STORE's own labels when cached (canonical fallback). Store
page gained the checklist policy section (future-deals-only note; safety
locked). Review (15 agents): 12 confirmed findings ALL fixed — the high one:
the waive form threw away the typed reason on a failed save; also evidence
authors now resolve against the removed roster (a waiver keeps naming its
author after they leave), and reinstating takes an explicit second click.
e2e: both refusal wordings, tick/waive/reason-survives, two-click reinstate,
deliver, frozen, store policy (18/18 suite; 378+ unit; parity/lint/typecheck
0). CR-03 filed (checklist endpoints missing from apiV1 contract).
docs/OWNER-TEST-BATCH-02.md reconciled to the SHIPPED UI (Pipeline not
"Deals", dropdowns not drag, funding vocabulary, Team pay plans, store-page
checklist policy).
**BATCH-02 is complete — every slice, both halves, adversarially reviewed
twice (his and mine). ONE owner round: docs/OWNER-TEST-BATCH-02.md.**
**Owner also owes two decisions: D-033 (who signs off safety), D-035/invite
flow (next batch scope).**

## 2026-07-26 [AHMAD] — end of the overnight run: F-10/F-11/F-11b/F-12 in, 394/394, CI green

**Shipped and merged, both halves where Hussein had one:**
- **F-10 activity trail** (ADR-009) — every state change writes an append-only
  row in the same transaction as the change. `parent_entity_id` rolls a child's
  events up under its parent (CR-04), so a deal's history includes its checklist
  and its dispatch without the caller knowing those entities exist.
- **F-11 dispatch** — drivers/chaser rule and conflict window in `packages/core`
  with golden tests, store-scoped fleets, one status vocabulary, transactional
  resource lifecycle.
- **F-11b dispatch paperwork** — driver-company roster replacing the two-name
  enum, addresses, cash-to-collect, special instructions, the FR/EN driver
  request email, and the signed-file gate that reads F-08's checklist rather
  than inventing a parallel column.
- **F-12 invitations** (D-035) — an invited member can actually log in. Hashed
  single-use token, never stored raw, never in a URL; accepting requires a
  session whose email IS the invited one.
- **CR-03/04/05 closed** (Hussein's, all three correct); **CR-06 filed and
  already fixed** by him.

**Guards added, because every defect this session was invisible to review:**
contract-drift (routes vs apiV1, both directions), RLS coverage (catalog-driven,
covers tables not yet written), no-dead-vocabulary, and a `db:reset` guard that
refuses any database not named `*_test`.

**The four mistakes worth inheriting, all mine:**
1. **A claim in a comment is a claim in the product.** F-10's migration said
   "every state change" while four endpoints of twenty-three emitted anything.
   Measure a coverage claim against the code, or do not make it.
2. **A test that reaches its precondition with raw SQL is testing the database.**
   F-11's conflict detection was unreachable through the API — a booked plate
   was never offered again, so a real double-booking came back as "no plate
   available", the inverse of the rule. The test that "proved" it manufactured
   the state by hand.
3. **A local gate passing is not CI green.** Three pushes went red behind a
   passing local run, from a guard I added without auditing its callers.
4. **Never edit an applied migration.** CI rebuilds from zero, so it is the one
   environment that cannot catch it; every database with history would refuse to
   upgrade. Prove the chain with `db:migrate` against a database that has data.
   (1) and (2) are in memory; (3) and (4) are rules in CLAUDE.md now.

**Owner state:** dev stack on migration 20, upgraded IN PLACE with his data
intact, seeded, running current code, and walked end-to-end. Nine test rounds
stacked in `docs/OWNER-TEST-MASTER.md`, every decision we took on his behalf
written up with the alternative.

**Decisions taken by delegation** (he authorized continuous work): D-033 safety
sign-off = owner/gm; D-034 delivered checklist frozen; D-035 invitations =
option A. All reversible, all documented.

**In progress:** nothing of mine is half-built.

**Next steps:** (1) documents / immutable bill of sale — next in the plan's
parity order, and the first module needing the PDF pipeline (Playwright workers,
tenant branding, FR-first per ADR-018/021), so it wants a fresh session rather
than the tail of this one. (2) F-11c: customer "on its way" notification and the
driver status feed. (3) Owner: rounds 1-9.

## 2026-07-26 [AHMAD] — CI red for three pushes (my guard), and a migration-immutability violation (also mine)

Two self-inflicted problems, both found late, both fixed. Writing them down
because the pattern in each is more useful than the fix.

**1. CI was red for three pushes and I did not look.** The `db:reset` guard I
added — the one that stops the CLI wiping a developer's database — also refused
CI's ephemeral container, which is named `dealpilot`, not `*_test`. My local
gate passed 373/373 every time, so nothing prompted me to check. I had told the
owner "CI green" on the strength of a local run.
*Fix:* CI now sets `DB_RESET_CONFIRM`, which is exactly what the guard asks for:
say out loud which database you mean. The guard is right and stays.
*Lesson:* adding a guard means auditing every caller, and "tests pass locally"
is not "CI is green" — a distinction I had already been burned by earlier the
same night.

**2. I edited migration 0014 twice AFTER it was merged and applied** (F-12 added
`invitation`, F-11 added `dispatch_assignment`), and 0016 once. Applied
migrations are immutable and the runner enforces it — but CI rebuilds from zero
on every run, so it is the one environment where the defect cannot surface.
Hussein's local database, and later staging and production, would have refused
to migrate with a checksum mismatch and needed hand repair.
*Fix:* 0014 and 0016 restored byte-for-byte to their merged form; the vocabulary
they were edited to add now lives in a forward-only 0018.
*Proof it is the real fix:* the dev database, which already held the original
0014, migrated 14 → 18 IN PLACE with the owner's account, org and store intact —
the exact upgrade that would have failed. Plus 373/373 from zero.
*Lesson:* a green CI that resets from zero cannot tell you your migration chain
is upgradable. Run `db:migrate` against a database that already has history.

**Verified end-to-end on the live stack afterwards** (F-10, F-11, F-12 together):
invitation created with no token in the response, forged token 404, revoke 204;
a trade-in books 1 driver and no chaser; a second delivery takes the second
plate; a third is FLAGGED rather than refused — through the API alone, which is
the thing the first cut could not do; arriving without departing refused; the
plate returns on completion; an ended run refuses edits; and dispatch events
roll up under the deal (CR-04). Smoke data removed; the owner's environment has
his account, org and store and nothing else.

**State:** develop at 373/373, CI green, stack running on current code and
seeded. Owner rounds 1-6 waiting in `docs/OWNER-TEST-MASTER.md`.

**Next steps:** (1) Hussein — F-12 invite/accept screens, then the dispatch
board. (2) Ahmad — F-11b dispatch paperwork, or documents/bill-of-sale, next in
the plan's parity order.

## 2026-07-26 [AHMAD] — F-11 dispatch merged, after a review found the headline feature unreachable

**Done (373/373):** the dispatch scheduling core — drivers/chaser rule and
conflict window in `packages/core` with 14 golden tests, store-scoped fleets,
the board, and a transactional resource lifecycle. Migration 0017.

**The finding worth remembering.** My first cut marked a plate `in_use` the
moment a run was booked. That made the feature's whole point — "a conflict flags
the run, it never blocks it" — UNREACHABLE: a booked plate was never offered
again, so a genuine same-afternoon double-booking came back as "no plate
available", the exact inverse of the rule. Worse, the integration test that
"proved" the fix manufactured the colliding state with raw admin SQL the API
could not produce, so it was green and meaningless.

The model is now honest: a plate is booked for a TIME, not taken off the board.
Availability is a calendar question; a free resource wins; when everything
collides the run is booked and flagged. `status` means physically out with a
driver and flips on departure. Mutation-proven — break the picker and three
named tests fail.

Six more real defects from the same review: ending a run released resources it
never consumed (so cancelling one run could hand back another's plate); fleet
`status` was directly writable, a back door around the entire accounting scheme;
a lien-only trade counted as "no trade", contradicting the money engine and
burning a chaser; `?conflicts_only=false` returned only conflicts
(`z.coerce.boolean` turns the string "false" into true); re-booking a live deal
was a 500; and the board — driver names and phone numbers — was readable by any
member.

**Scope stated, not implied:** F-11b is filed for the dispatch email, driver
companies, addresses, cash-to-collect, the wet-ink gate and customer
notification. The commit message says what is NOT built rather than letting the
title imply all of dispatch-transport.md.

**In progress:** HUSSEIN — F-12 invite/accept screens, then the dispatch board.

**Gotchas learned:** `z.coerce.boolean()` is almost never what you want for a
query flag — every non-empty string is true. And a test that reaches its
precondition with raw SQL is testing the database, not the product; if the API
cannot produce the state, the feature cannot either.

**Next steps:** (1) Hussein — F-12 screens. (2) Ahmad — F-11b, or documents /
bill of sale, next in the plan's parity order. (3) Owner — rounds 1-6.

## 2026-07-26 [AHMAD] — F-12 invitations merged: the Team screen stops lying. CR-04 closed.

**Done (340/340, all guards green):**
- **F-12 invitations** — D-035, decided by delegation when the owner authorized
  continuous work. Adding a member used to write a roster row against an INVENTED
  user id and send nothing: that person could never log in, and signing up on
  their own produced an unrelated identity. Now an invitation IS the roster entry
  until a real person accepts. 32-byte token, only its SHA-256 stored, single
  use, 7-day expiry; accepting requires a session whose email IS the invited one,
  which is what stops a forwarded link handing over a seat. Accept is one
  SECURITY DEFINER call creating the user row, claiming the invitation and
  creating the membership — atomic, so two clicks cannot make two memberships.
- **The token never appears in a URL.** It travels in the request body, because a
  token in a path lands in access logs, browser history and Referer headers. The
  email link still carries it, but that link points at the web app, not the API.
- **CR-04 (Hussein's, fair)** — checklist events were keyed by ITEM, so a deal's
  timeline could not fetch them; his client was filtering org-wide events in the
  browser. Fixed generally with `parent_entity_type`/`parent_entity_id` and a
  roll-up in the feed filter, so dispatch and documents will need no new endpoint.

**Both drift guards earned their keep again**, on my own work this time: the RLS
guard refused the `invitations` table until it had a cross-tenant test, and the
contract guard refused the routes until they were in apiV1 — where it also
surfaced that Fastify had merged `:token` and `:id` into one radix node. That
path ambiguity is what led to moving tokens into the body, which is better
security than what I originally wrote.

**In progress:** HUSSEIN — F-12 invite + accept screens
(`docs/HUSSEIN-F12-CONTRACT.md`), and his F-10 timeline is already in.

**Blocked / open questions:** nothing blocking. D-033, D-034 and D-035 are all
now DECIDED-BY-US and written up for the owner in `docs/OWNER-TEST-MASTER.md`
with what we chose and what the alternative was.

**Gotchas learned:** `invitations.accepted_user_id` references `users(id)`, so
the claiming UPDATE has to run AFTER the user row exists — the FK fires on the
claim, not on the membership insert. Cost one debugging round.

**Next steps:** (1) Ahmad — F-11 dispatch, next in the plan's parity order.
(2) Hussein — F-12 screens. (3) Owner — rounds 1-5 in OWNER-TEST-MASTER.md
whenever he wakes.

## 2026-07-26 [AHMAD] — F-10 activity trail merged: ADR-009's audit log, after two review rounds took it apart

**Done:** F-10 AHMAD half (327/327). `activity_events` (append-only, tenant-scoped,
monotonic `seq`, `ON DELETE SET NULL` on the actor so a Law 25 erasure neither
fails nor destroys the record), `recordEvent`/`diff` helpers, emission across
every mutating endpoint, `GET /api/v1/activity` with pay-plan history gated to
PAY_READ_ROLES, and `apiV1.activity` in the contract.

**What actually happened here is worth reading.** My first cut wrote "every state
change" in the migration header and wired 4 endpoints out of 23 — five of eight
entity types and three of fifteen actions could never be written by any code path.
An adversarial review measured the claim against the code and it was simply false.
I made the claim true rather than soften it.

The second review round then found five more silent mutations (org/store settings
edits, the public intake webhook's leads, the founding owner grant, the revoke
cascade that unassigns leads) and seven defects in my own round-one fixes. The
three that mattered: a malformed page cursor returned a 500 because my bespoke
keyset skipped the `decodeCursor` guarantee every other endpoint keeps; pg parses
a DATE column to LOCAL midnight while 'YYYY-MM-DD' parses as UTC, so re-saving an
unchanged date recorded a change that never happened — the exact bug class the
helper existed to prevent; and re-ticking an already-ticked item still rewrote
`completed_by` while the new no-op suppression hid the event, so a safety
inspection's legal sign-off could change hands with nothing recording it.

**Guards, because the pattern is now unmistakable.** Every defect this session was
invisible to review by eye and obvious to a detector. `no dead vocabulary` fails if
an enum value has no real call site — and I caught my own first version of it being
vacuous (it matched any quoted string, so 'delivered' was satisfied by
DELIVERY_STAGES). Mutation-proven: delete the call site, it names both orphaned
actions.

**In progress:** HUSSEIN half — activity timeline on the deal and the lead.

**Blocked / open questions:** D-035 (invited members cannot log in — the owner's
choice between two visibly different fixes) and D-033 (who signs off the safety
inspection). D-034 (correcting a delivered deal's checklist) is now ANSWERABLE:
the history it needed exists, so a correction path with an audit trail is buildable
when the owner wants it.

**Gotchas learned:** a claim in a comment is a claim in the product. "Every state
change" was written before the code did it, and the tests all passed. Measure a
coverage claim against the code, or do not make it. Second: template literals eat
`\s` — use `String.raw` for regexes (cost me two lint rounds).

**Next steps:** (1) Hussein — F-10 timeline UI. (2) Owner — BATCH-02 test round and
D-035. (3) Ahmad — F-11 dispatch, the next module in the plan's parity order.

## 2026-07-26 [AHMAD] — BATCH-02 closed: CR-03 fixed, two drift guards added, Hussein's UI reviewed and integration proven

**Done:**
- **CR-03 (Hussein's, fair):** the four F-08 endpoints were mounted but absent from
  `apiV1`, so the typed client and OpenAPI could not see them and the web app
  carried route literals. Added as `apiV1.checklist`.
- **Why nobody noticed, fixed too:** `apps/api/src/contract-coverage.test.ts` now
  compares the mounted Fastify routes against `apiV1` in BOTH directions. It found
  a second gap Hussein never hit — the A-03 scaffold declared `users` and
  `memberships` CRUD that were never mounted, so the contract advertised **ten
  endpoints answering 404**. Removed; nothing referenced them.
- **`packages/db/src/rls-coverage.test.ts`** — the ROADMAP Phase 1 exit criterion
  ("RLS verified by an automated cross-tenant leak test") was only half met:
  rls.test.ts proves behaviour on the 3 tables that existed when it was written,
  and we now have 12. The new suite reads the CATALOG, so it covers tables that do
  not exist yet — missing FORCE RLS, missing write-side isolation, `WITH CHECK
  (true)`, a bypass-capable app role, or a tenant table with no behavioural test
  all turn CI red on their own.
- It flagged two policies of mine from F-09 on its first run: `commission_self_read`
  and `pay_plan_self_read` grant rows on `user_id = app.user_id` with no
  organization in the expression, so under the dual-context pattern F-04 already
  uses they would return a person's pay from EVERY org they belong to. Not
  reachable today (every such query carries an explicit org predicate) but that
  safety rested on remembering a convention. Migration 0013 drops them; 318 tests
  green proves nothing depended on them. Pay stays personal in the route, tested.
- **Reviewed Hussein's F-08 UI** — faithful to the contract: handles both
  `checklist_incomplete` and `checklist_hard_blocked` with different wording, keys
  read-only off `delivered_at` (not the stage), no Waive control on a
  non-overridable item, renders a waiver distinctly with its author and reason
  (with a former-member fallback), handles the 409 and the empty-checklist case.
  No CR needed.
- **Integration proven, not assumed:** ran his Playwright journey against the live
  stack with my backend — gate blocks → tick/waive → deliver → frozen — 1 passed.
  Owner's dev DB left with his org and store and nothing else.

**In progress:** nothing of mine. BATCH-02 is complete on both sides.

**Blocked / open questions:** D-035 (an invited member can never log in — needs the
owner's choice between two visibly different fixes) and D-033 (who may sign off the
safety inspection). Both in `docs/OWNER-DECISIONS-PENDING.md`; neither blocks other
work.

**Gotchas learned:** two guards were worth more than the bugs they fixed — both were
written because the ORIGINAL defect was invisible to review by eye, and both found a
second, older defect on their first run. When a mistake was undetectable rather than
careless, the fix is a detector, not more care.

**Next steps:** (1) owner — BATCH-02 test round (`docs/OWNER-TEST-BATCH-02.md`; stack
is up and seeded). (2) owner — answer D-035 so the invite flow can be built.
(3) Ahmad — BATCH-03 per the plan's module order (dispatch, then documents/bill of
sale); `activity_events` (ADR-009) is the missing piece behind D-034 and should be
proposed as part of it.

## 2026-07-26 [AHMAD] — F-08 delivery checklist backend: "delivered" is now earned, not typed

**Done:** F-08 AHMAD half, the last slice of BATCH-02. Migration
`packages/db/migrations/20260725000012_delivery-checklist.sql` (`checklist_templates`
per store + `deal_checklist_items` per deal, RLS enabled+forced, tenant-scoped FK,
seed for existing stores, backfill for deals in flight); `packages/schemas/src/checklist.ts`;
`apps/api/src/checklist.ts` (domain helpers) + `apps/api/src/f08-checklist-routes.ts`
(4 endpoints); the delivery gate in `apps/api/src/f05-deals-routes.ts`. Full gate green:
25 build/typecheck/lint tasks, **305/305 tests**, i18n parity OK.

The gate: a deal cannot enter `delivered` OR `complete` while a required item is
outstanding. Nine items a manager may waive — always with a recorded reason, author
and timestamp. The safety inspection is a hard block no role can waive, and no store
can switch off. Once delivered, the checklist is frozen: it is the evidence.

**Two adversarial review rounds found 17 defects in my own first cut.** The two that
mattered: (1) the gate was a **no-op** unless someone had opened the checklist panel
first — items were only ever created by the F-08 routes, so a deal nobody looked at
delivered with a 200 and no safety inspection; the existing F-06 test proved it by
passing. (2) `pipeline_stage: 'complete'` — the stage *after* delivered — walked
straight around the gate, and is two clicks away in Hussein's shipped kanban.
Also fixed: any member could tick `safety` (making "cannot be waived" mean "use the
other field") or erase a manager's waiver; the snapshot was taken at first read
rather than at deal creation, so template edits rewrote deals in flight; a TOCTOU
between the readiness read and the stage write; two dead RLS policies that would
have leaked checklists to any dual-context caller; GETs that wrote 20 rows.

**Proof, not assertion:** every fix was mutation-tested — removing it turns a named
test red — and RLS/constraints were probed live against Postgres (0 foreign rows
visible or updatable under another tenant's scope; forged cross-tenant insert
refused by policy; reasonless waiver refused by CHECK; org-mismatched item refused
by the composite FK; backfill gives in-flight deals their items and leaves
already-delivered deals as history).

**Owner's stack verified for the morning, not assumed:** the dev database was
empty (an earlier reset had taken the seed account with it, so the login on the
test sheets would simply have failed), and the API still listening on :3001 was a
process started six hours before the F-08 code was even built. Rebuilt the dev
schema, restarted on current code, re-seeded `hassan-test@1dealer.ca` +
Groupe Hassan + Kia Mont-Laurier, then walked Part C of the owner test end-to-end
with real HTTP calls: checklist present at deal creation (10 items, FR labels),
delivery refused (`checklist_hard_blocked`, 10 details), `complete` refused too,
safety waiver refused for the owner, soft waiver recorded with its reason and
author, gate opens once everything is ticked, `delivered_at` stamped, and the
checklist frozen afterwards (`deal_delivered`). Test deal removed; his
environment is clean.

Then walked the OTHER three parts of the BATCH-02 sheet the same way, so the whole
round is verified rather than just the new slice: inventory adds a car and reports
total cost 2 330 000 cents from 2 200 000 + 50 000 transport + 80 000 recon, with
duplicate stock naming `stock_number` and duplicate VIN naming `vin` (CR-02 live);
a deal prices at $597.79/mo and moves new → submitted while the funding track stays
independent; and the commission engine paid $975 on a $5 400 gross — the $1 500 pad
subtracted BEFORE the 25% rate, which is the exact case the legacy system got wrong
— and re-funding the same deal still produced one line. All smoke data removed
afterwards; the owner's environment has his org and store and nothing else.

Also: `pnpm dev` did not exist. Both owner test sheets and PROJECT.md told people
to run it. It exists now (root script + turbo persistent `dev` task).

**In progress:** HUSSEIN half — the checklist panel on the deal. Contract is in
`docs/HUSSEIN-F08-CONTRACT.md`.

**Blocked / open questions:** one for the owner: **who may sign off the safety
inspection?** I restricted it to owner/gm because ticking it is legally equivalent
to waiving it, but in a real store the used-car manager or logistics usually records
it. Listed in `docs/OWNER-DECISIONS-PENDING.md` as D-033.

**Decisions:** D-033 proposed (safety sign-off role) — awaiting the owner.

**Gotchas learned:** a feature whose tests pass can still be a no-op if an earlier
test in the same file happens to create its preconditions — the F-08 gate test only
went red because test #1 had opened the checklist first. Fresh-fixture tests per
behaviour, not shared ones. Also: when a gate keys on one enum value, check every
value that comes *after* it in the same workflow.

**Next steps:** (1) Hussein — F-08 panel against `docs/HUSSEIN-F08-CONTRACT.md`.
(2) Both — BATCH-02 combined owner test round (`docs/OWNER-TEST-BATCH-02.md`).
(3) Ahmad — invite-token flow (strongest next-batch candidate; currently a
documented gap in cross-org identity linking).

## 2026-07-25 [HUSSEIN] — F-09 both halves in (41a2efa AHMAD → 10e38da+1556b64 HUSSEIN); BATCH-02 lacks only F-08

Commissions UI: Team rows (owner/gm only) get "Rémunération" — the pay-plan
dialog (rate/pad/tier/override on the F-09 contract, per-field validation,
fetch-error shown rather than an editable blank form that would full-replace
away an existing tier); worksheet gained "Sold by" + F&I reserve (invalid
reserve BLOCKS save — was silently \$0, i.e. a real underpay); /commissions
(from the dashboard) lists lines with person, commissionable gross, rate,
amount + local-time month total, org selector, 300-line cursor window with a
LOUD truncation warning; funding a deal invalidates the commissions cache.
Adversarial review: 17 confirmed findings, ALL fixed — the high ones were
genuine pay-money bugs (reserve→\$0; blank-form wipe; org-view without a
person column). e2e mirrors the backend golden end-to-end: plan 25 % +
1 500 $ pad → 7 000 $ front-gross deal sold by Vicky → funded on the kanban →
line 5 500 $ × 25 % = **1 375,00 $** (17/17 with the whole suite).
**BATCH-02: F-06 ✓ F-07 ✓ F-09 ✓ — F-08 delivery checklist is the last
slice. Owner script covers everything shipped (Parts A–E) and is ready the
moment F-08 lands or the owner closes the batch without it.**

## 2026-07-25 [AHMAD] — CR-02 closed; F-09 commissions backend merged — the owner's real pay plans now compute live

**Listener protocol ran clean again:** HUSSEIN pushed, I woke, cleared his
row first (CR-02), then resumed my build.
**CR-02 DONE:** vehicle 409s carried no field path, so a duplicate VIN and a
duplicate stock number looked identical to the UI. Both rules mapped — note
the VIN rule is a partial unique INDEX, not a table constraint; pg still
reports its name. His `vin` branch now gets what it expects.
**F-09 commissions (AHMAD half) MERGED.** Migration 0011: `pay_plans` (rate,
pad in CENTS, tier, override-on-person) + `commissions` (immutable lines
carrying their own inputs, so a statement is explainable years later);
`deals` gain `salesperson_id` and `fi_reserve_cents`.
**The math is NOT reimplemented** — `calculateCommission` (@dealpilot/core,
A-06 golden tests) stays the single source. This wires it: the right plan,
EVERY overrider, the tier keyed on the seller's FUNDED monthly gross computed
in SQL (half-open month, database clock — not the API process's), lines
written in the SAME transaction that records funding, and
UNIQUE (deal_id, user_id, kind) so a retried funding is a no-op rather than a
double payment.
**Two audited legacy defects are now structurally impossible:** the pad is
cents (the famous "\$1,500 became \$15" cannot be expressed), and an override
is a row on the RECEIVER's plan, so paying them never depends on the seller's
own record (the legacy bug read the wrong side of that link).
**Pay is personal:** owner/gm/fi_manager see the organization; everyone else
sees only their own lines — asking for someone else's returns your own.
Golden test mirrors the real plan shape: \$7,000 gross − \$1,500 pad = \$5,500
→ \$1,375 at 25%, plus a \$275 override; a losing deal pays ZERO, never
negative. **287/287, lint 0.**
**Honest note from the test setup:** linking an invited person to the identity
they create later is still the deferred INVITE FLOW; the suite builds the
seller's session the way the app really does rather than pretending that link
works. That flow is the next real gap for a batch.
**For HUSSEIN:** `apiV1.payPlans.{upsert,list,update}` + `apiV1.commissions.list`
are live. Plans: rate/tier/override as decimals, pad_cents in cents. Deals now
accept `salesperson_id` + `fi_reserve_cents` — the worksheet needs a
"sold by" picker and an F&I reserve field, otherwise a funded deal pays
nobody. Commission lines appear the moment `funding_status` becomes `funded`.
**BATCH-02:** F-06 ✅ both halves · F-07 ✅ both halves · F-09 AHMAD half in ·
F-08 delivery checklist still open.
**Next steps:** 1) HUSSEIN: F-09 views + the deal worksheet fields. 2) AHMAD:
F-08 delivery checklist. 3) Then ONE combined owner test round for BATCH-02.
**Blockers:** none.

## 2026-07-25 [HUSSEIN] — F-07 both halves in (294eb21 AHMAD → edcc722+fixes HUSSEIN); CR-01 re-armed; BATCH-02 script drafted

Inventory UI: /inventory (6th tab — mobile bar moved to dedicated SHORT
labels: Accueil/Groupes/Prospects/Pipeline/Stock/Équipe, per-label clip
assertion in e2e) with add-vehicle (identity, VIN, acquisition cost
build-up), derived total cost in the list, both status tracks; vehicle page
moves location/sale status and edits recon/list price. Desking worksheet
gained the VEHICLE PICKER: available cars of the lead's store; picking
prefills cost (always) and price (only while auto — provenance tracked, so
switching cars can never save car A's price on car B, and deselecting takes
the money with it; both covered in e2e). Deal-attachment proven at the API
level in the journey. Adversarial review: 16 confirmed findings, ALL fixed
(the high ones: price provenance; 6-tab label clipping). CR-02 filed
(vehicles constraint names for field-pathed 409s — UI branch already
waiting). CR-01 re-armed: MemberAdded parse + notice assertion back.
Gates: parity/lint/typecheck 0, e2e 16/16 incl. golden \$5,250 front gross
on a stocked car.
**BATCH-02 state: F-06 ✓ F-07 ✓ — F-08/F-09 remain. Combined owner script
DRAFTED (scratchpad) — posts when the batch closes (owner may also close it
at F-06+F-07 if preferred).**

## 2026-07-25 [AHMAD] — F-07 inventory backend merged; CR-01 fixed; listener protocol working both ways

**Listener worked twice this stretch** (D-032): HUSSEIN's pushes woke me, I
pulled, handled his rows first, then resumed my queue — no idle time, no chat.
**Done:** (1) **F-07 inventory (AHMAD half) merged.** Migration 0010
`vehicles`: identity (stock number unique per store; VIN validated at 17 chars
without I/O/Q and normalized to uppercase), acquisition cost build-up,
list price, and the spec's TWO independent tracks — `location_status` (where
the car IS) and `deal_status` (whether it is SPOKEN FOR); a car is normally
`on_lot` + `sold_pending` between signing and delivery. `deals.vehicle_id`
behind a same-org composite FK. `total_cost_cents` is DERIVED (acquisition +
transport + recon), never stored, so a late recon invoice can't leave the
desking gross stale — the golden test decks a real car: \$32,900 sale on a
\$27,650 cost → \$5,250 front gross. A committed car (reserved/sold_pending)
cannot be deleted out from under its deal.
**Deferred on purpose (in the migration header):** the spec's safety/recon/
photo subsystems belong to the garage/PDI module — empty columns now would
invite code that pretends those workflows exist.
**Two bugs the tests caught before merge:** sending NULL for an omitted column
overrode the table's own DEFAULT (acquisition_date), and pg returns `date` as
a JS Date that JSON-serializes to a full timestamp — both fixed at the
response boundary.
(2) **CR-01 (mine to fix):** the HO-09 security rewrite dropped
`reinstated: true`, silently killing the team screen's "already in the
organization" notice. Restored in the CONTRACT — `MemberAdded` = Member +
optional `reinstated` — with tests pinning both directions. **HUSSEIN: re-arm
your parked assertion.**
**Tree: 275/275, lint 0.** BATCH-02 status: F-06 both halves in, F-07 AHMAD
half in (HUSSEIN: inventory list + vehicle picker), F-08/F-09 proposed.
**Next steps:** 1) HUSSEIN: F-07 UI + re-arm CR-01 assertion. 2) AHMAD: F-08
delivery checklist or F-09 commissions on funded deals — both unblocked.
3) Owner tests the whole batch in ONE round when the halves land.
**Blockers:** none.

## 2026-07-25 [HUSSEIN] — F-06 both halves on develop within the hour (b6575f8 AHMAD → b6f2ab3 HUSSEIN); the signal protocol worked

Built the kanban on a LOCAL integration branch against ahmad/f06-pipeline
(develop never broke), reviewed it adversarially (14 agents, 11 confirmed
findings fixed pre-merge: duplicate nav key that only WORKSPACE typecheck
catches — package-scoped typecheck is not enough, added to my gate ritual;
create-deal not invalidating the board; silent 100-deal truncation → bounded
3-page follow + notice; lead names beyond page 1 → bounded name fetch;
select snap-back → optimistic cache write from the PATCH response; board-wide
select freeze → per-card pending; cash cards showed a meaningless monthly;
5th mobile tab overflow → smaller truncating labels + an e2e overflow
assertion; scroll region keyboard-focusable). Signaled on the board, AHMAD
merged, my UI followed from a fresh develop branch: full turbo gates + 15/15
e2e (incl. the f06 kanban journey) green before push.
**Pipeline is live: 10 stage columns + independent funding track, optimistic
moves, org scoping, FR/EN.**
**Waiting on AHMAD: HO-09 (SECURITY, urgent), HO-07 (test-DB isolation),
F-07 vehicles contract — my inventory UI + worksheet vehicle picker start on
his merge. BATCH-02 owner script comes once F-07 is in.**

## 2026-07-25 [HUSSEIN] — HO-05/06 UI halves merged (d0c9f4d); SECURITY HO-09 filed; F-06 half next (AHMAD's contract read)

**Shipped (d0c9f4d):** lease worksheet unlocked — rate/term drive the price,
new residual % field (lease-gated: garbage in it can no longer brick a
finance/cash worksheet; invalid-marked like rate/term), finance-only rows
hidden on lease; Team gained "Show removed members" WITH stored roles
visible + one-click Reinstate (errors surfaced, stale errors cleared);
add-form reinstate shows an explicit notice (reads the `reinstated` flag);
revoking invalidates lead caches (server releases leads — verified live).
Tree: 378 unit + 264 api, e2e 14/14, lint/typecheck 0.
**Adversarial review (12 agents) confirmed 10 findings — 8 fixed frontend,
2 are a backend SECURITY hole → HO-09 (URGENT, AHMAD):** reinstate-on-add
matches ACTIVE members and rewrites roles unconditionally — an admin_office
can demote the SOLE OWNER via the add form (last-owner guard is PATCH-only),
and PATCH {status:'active'} skips assertGrantable (gm can re-activate a
revoked owner). Full repro + fix sketch in the HO-09 row; my e2e must flip
one assertion in the same merge — I'll follow within minutes as with F-06.
**Board hygiene:** AHMAD's F-06 handoff renumbered HO-07→HO-08 (§8 — HO-07
was taken by the test-DB isolation filing, still OPEN and still wiping the
owner's login on every test run).
**Next: F-06 pipeline UI** against ahmad/f06-pipeline's published contract
(PipelineStage ×10 + FundingStatus ×4, funded_at/delivered_at stamped
server-side): rebuild deal labels/i18n, stage+funding badges, kanban board
with click-based stage moves (WCAG — no drag-only). I build on a branch,
signal, he merges F-06 first, I follow — develop stays green.

## 2026-07-25 [AHMAD] — revoked members release their leads; BATCH-02 proposed; F-06 pipeline ready on a branch (HO-07 filed)

**Done:** (1) Last confirmed F-04 review finding fixed and merged: revoking a
member now RELEASES their leads (assigned_to cleared, an `assigned` lead
returns to `new`) in the same transaction — work no longer points at someone
the org cannot see. 264/264. (2) **BATCH-02 proposed** following the plan's
module order: **F-06 deal pipeline** + **F-07 inventory (vehicles)**.
(3) **F-06 built and ready on `ahmad/f06-pipeline` — deliberately NOT merged.**
It corrects vocabulary drift I introduced in F-05: deals shipped an ad-hoc
`working/funded/...` status, but deals-pipeline.md defines TWO independent
tracks — `pipeline_stage` (10 canonical stages, where the CAR is) and
`funding_status` (4, where the MONEY is). A single column cannot express
"delivered but not yet funded", the state a dealership watches most.
Migration 0009 renames + maps (working→new, funded→complete), adds
funding_status/funded_at/delivered_at; routes filter on either track and
stamp the timestamps on first transition (the commission engine keys its tier
on funded_at, never on the stage). Backend+packages **237/237**.
**Why unmerged:** it BREAKS `apps/web` (HUSSEIN's zone, which I never edit).
I tried a compile-safe alias first — it does not help, because his label maps
enumerate the old values. So the contract is published on the branch and
**HO-07** carries the exact value mapping and the two files that break;
develop stays GREEN until his half is ready, then I merge first and he
follows within minutes.
**Next steps:** 1) HUSSEIN: HO-07 (and the earlier lease rate/term unlock +
Reinstate button). 2) On his signal: merge F-06, then F-07 inventory
(vehicles + vehicle_id on deals). 3) Owner: confirm BATCH-02 when convenient
— nothing is blocked meanwhile.
**Blockers:** F-06 merge waits on HUSSEIN (by design, not by fault).

## 2026-07-25 [AHMAD] — BATCH-01 ACCEPTED; both owner-visible handoffs fixed same day (HO-05 lease, HO-06 reinstate)

**Owner accepted BATCH-01** (F-04 members+assignment, F-05 desking) — the
batch model works. Two handoffs came back from that test round; both were
mine and both are now DONE, merged, 263/263 green.
**HO-05 — a money bug I shipped:** `toEngineInput` never mapped the typed
rate/term onto the LEASE parameters, so every lease was priced with engine
defaults (MF 0.00125 / 48mo / 55%) while storing a rate and term that priced
nothing. Now money factor = APR/2400, lease term = term_months, and a
`residual_percent` column (migration 0008) is stored with the deal. Golden:
QC \$35k, MSRP \$38k, 5.99%, 48mo, 55% → \$444.50/mo; shortening the term or
dropping the residual moves the payment. **HUSSEIN: the rate/term lock on the
lease form can come off.**
**HO-06 — the owner hit this live:** removing a colleague was a one-way door
(re-adding the same email 409'd, and the roster hid revoked rows so there was
nothing to reinstate). Adding an email that already belongs to the org now
REINSTATES that membership with the given roles (201, same id), and the
roster accepts `?status=revoked` so the team screen can list former
colleagues. Cross-org emails still 409 — that needs the invite-token flow,
not an email-existence probe (deferred, documented).
**Test-integrity note:** the old "same email twice = 409" test encoded the
behavior the owner rejected. It was rewritten to pin the NEW requirement, and
a separate test now covers the genuine cross-org 409 — requirement change,
not a weakened test.
**Next steps:** 1) HUSSEIN: lease rate/term unlock + Reinstate in the team
screen. 2) Propose BATCH-02 when the owner is ready. 3) AHMAD fill-in: the
remaining F-04 review minors (keysetPage FROM-splice is latent; strict query
schemas) and the leads-of-a-revoked-member cleanup.
**Blockers:** none.

## 2026-07-25 [HUSSEIN] — BATCH-01 ACCEPTED by owner; one owner-found issue fixed same day

Owner ran docs/OWNER-TEST-BATCH-01.md: "all is good except" the duplicate-
email step — typing `marc@groupehassan` (no TLD) passes the BROWSER's email
check but the server 422s (path=email), and the add form showed the generic
"operation failed". Fixed: 422/email now maps to "Courriel invalide." /
"Invalid email address."; e2e extended to cover BOTH wrong-email paths
(422 invalid shape, 409 duplicate). 14/14 e2e, parity/lint/typecheck 0.
Also this session: owner locked out a third time → root-caused (API test
suites DROP the dev database — HO-07 filed for AHMAD: isolate to
dealpilot_test); interim rule: re-seed + verified sign-in after every test
run. **BATCH-01 (F-04 + F-05) is the first batch fully through the D-031
loop: build both → one owner round → accepted.**

## 2026-07-25 [HUSSEIN] — BATCH-01 UI halves DONE + INTEGRATED: F-04 team/assignment (01cd4af) and F-05 desking (b67ecf7); batch AWAITING-OWNER-TEST

**F-04 (01cd4af):** Team screen (/team, 4th nav tab): add member with
10-role fieldset, edit roles, revoke (ICU-named dialogs); org selector for
multi-org; zero-org CTA; write UI hidden for non-managers (server still
enforces). Lead page: org-scoped assignee picker; leads list: "Assigned to"
column + "My leads" filter (`?assigned_to`). 3-lens adversarial review
(25 agents) confirmed 18 findings — ALL fixed, the big ones: members cache
was user-agnostic (now org-keyed everywhere + queryClient.clear() on
sign-out — cross-account leak on shared devices closed), picker fetched
members without org (400 for multi-org), leads assigned to a revoked member
silently showed "unassigned" (now "Former member", held in the picker).
**F-05 (b67ecf7 + ecb95c7):** /leads/:leadId/desk from the lead's Deals box —
debounced POST /deals/calculate on each edit; GST/QST vs HST by PROVINCE;
monthly/bi-weekly/weekly, front/total gross; FR/EN money parsing to integer
cents (20 unit tests incl. NNBSP) + Intl CAD formatting; save persists and
lists on the lead. Review (17 agents) confirmed 14 findings — ALL fixed,
the big ones: **stale-quote guard** (Save disabled + panel dimmed while the
shown figures lag the inputs — a quoted payment can never be saved unseen),
**rate grammar** (5.999 % parsed as 59.99 % via the money parser — dedicated
% parser now, 600 bps), lease honesty (engine ignores rate/term for lease →
fields locked + program note, HO-05), deals list org-scoped (HO-06 also
filed: revoked members unrecoverable from UI).
**Tree: lint/typecheck 0, 378 unit/integration (257 api + 28 web + 81 ui +
12 i18n), e2e 14/14 (f04 journey incl. zero-org/multi-org/orphaned
assignment; f05 golden numbers 1 375,00 + 2 743,13 = 4 118,13 / 33 117,13 /
640,09 / 4 500,00, ON HST switch, save+list). Owner seed re-created after
db:reset (migrations 0006–0007 applied).**
**For OWNER: one combined English test round — docs/OWNER-TEST-BATCH-01.md.**
**For AHMAD: HO-05 (lease param mapping), HO-06 (members list status filter);
F-04 e2e now guards the roster/assignment flows end-to-end.**

## 2026-07-25 [AHMAD] — BATCH-01 backends DONE: F-04 members+assignment (c5b4973) and F-05 desking (ac4c859); F-04 review fixes (1a8a614)

**Owner switched us to BATCH delivery (D-031)** — 2-3 slices built in
parallel, ONE owner test round at the end; every quality rule kept (TDD,
adversarial review per slice, full gate per merge, CI green).
**BATCH-01 = F-04 + F-05; both AHMAD halves are merged.**
**F-04 (c5b4973 + fixes 1a8a614):** members API — list (membership JOIN
user), add-by-email (creates the user + active membership), roles change,
revoke/reinstate; lead list gained an `assigned_to` filter ("my leads").
Two RLS scoping bugs surfaced by tests and fixed at the source: the roster
needs DUAL context (colleagues are visible only through the org-keyed
user_read) and a colleague's membership row is invisible under user scope.
**Adversarial review then found a CRITICAL** — any gm/admin_office could
grant themselves `owner`; now an inviter can only grant roles they hold
(spec-cited). Also fixed: revoke was a ONE-WAY DOOR (migration 0007 keeps
same-org users readable at any membership status — this also stops
`invited` members being dropped), requireMember's liveness probe had no org
predicate (soft-deleted org could pass under dual context), the last-owner
guard was a read-then-write race (now `FOR UPDATE` + org-scoped), and PATCH
mapped a unique-violation to 500 instead of 409.
**F-05 (ac4c859):** migration 0006 deals + `/api/v1/deals` —
`POST /deals/calculate` is a pure preview so the worksheet recomputes live;
create/update PERSIST the engine's answer beside the inputs and any input
edit RECOMPUTES. **This puts the A-06 money engine in front of the owner**:
golden test pins QC \$35k w/ trade+rebate+F&I → tax \$4,118.13, financed
\$33,117.13, payment \$640.09, gross \$4,500; ON uses HST. Caught by the
tests: UpdateDealInput built with `.partial()` KEPT the create defaults, so
a one-field PATCH zeroed every other input — rewritten field-by-field with a
regression test beside the repo's existing defaults-leak guard.
**Tree: 237/237, lint 0, parity OK.**
**For HUSSEIN — both contracts are live on develop:**
• `apiV1.members.{add,list,update}` — Member = membership + email/name;
AddMemberInput {organization_id, email, name, roles[], store_id?};
UpdateMemberInput {roles?, status?, store_id?}. 403 `role_not_grantable`
when granting above your own role; 422 `last_owner` protects the last owner;
409 on duplicate email/membership. Leads: `?assigned_to=<user_id>` = "my
leads".
• `apiV1.deals.{calculate,create,get,list,update}` — all money in CENTS, rate
in BASIS POINTS (599 = 5.99%). `calculate` returns DeskingOutputs only
(gst/pst/hst/tax_total/amount_financed/monthly+biweekly+weekly/front_gross/
total_gross) and stores nothing — call it on every keystroke; create/update
return the saved Deal. Outputs are engine-owned (422 if sent).
**Next steps:** 1) HUSSEIN: team screen + assignee picker + "my leads", and
the desking worksheet. 2) When both land → ONE combined owner test script
for BATCH-01. 3) AHMAD fill-in meanwhile: none blocking.
**Blockers:** none.

## 2026-07-25 [AHMAD] — F-03 ACCEPTED by owner; session close-out (3 slices shipped, CI green, ~$0/mo)

**Owner tested F-03 and accepted** ("i did tested it and it worked") — the
intake webhook slice is complete end to end: owner/gm creates a per-store key
(secret + URL shown once) → an external system posts a SIGNED lead → it
appears in the lead list with source attribution. Board row already carried
ACCEPTED (HUSSEIN, af84cfc); duplicate proposal row is SUPERSEDED, kept per
the no-delete rule.
**State at close:** 3 feature slices ACCEPTED (F-01 org+store admin, F-02
leads, F-03 intake webhook). Platform: A-01..A-06 + A-10 + A-11 done, A-07
unit 1 deployed (SES verified, OIDC role), A-05.1 complete. Tree **212/212**,
lint 0, i18n parity OK; **develop CI GREEN** (882ccdf + 81da1d5 success —
the red streak I caused at bf5e2ab is fully resolved, root cause was missing
Node globals for scripts/*.mjs, fixed in config not suppressed).
AWS spend stays ~$0/mo per D-030.
**Open for the owner (nothing blocking):** (1) **F-04 pick** — HUSSEIN
proposed lead ASSIGNMENT to salespeople (needs an AHMAD member-list/invite
route first); alternative is more intake providers (Meta/ADF-email
signatures) to widen the automation. (2) SES production access when real
customer mail is needed (owner-visible AWS request; sandbox reaches only
verified addresses/simulator today). (3) A-07 unit 2 (staging, ~$85-125/mo)
whenever a remote environment is actually wanted.
**Next steps:** 1) On the F-04 pick: AHMAD builds the member/invite routes,
HUSSEIN the assignment UI. 2) Otherwise AHMAD fill-in: intake provider
signatures (Meta) or the A-09 doc sweep.
**Blockers:** none.

## 2026-07-25 [AHMAD] — A-11 email DONE (882ccdf): real SES send proven; D-030 no paid infra; RED CI found + fixed

**Done:** (1) **D-030** (owner: "use whatever recommended and no need to pay
now") — ALL cost-bearing AWS deferred (staging ~$85-125/mo revisited only
when a remote env is actually needed); `@aws-sdk/client-sesv2` approved,
verified official (amzn-oss / aws-sdk-js-v3), pinned 3.1092.0 past cooldown.
(2) **A-11 DONE (882ccdf)** — transactional email: `apps/api/src/email.ts`
with two transports: `log` (DEFAULT outside prod — no AWS creds needed,
cannot emit real mail) and `ses`. Send failures log + return false, never
throw (sign-up survives degraded mail). Better Auth wired via
`emailVerification.sendVerificationEmail` — option shape read from the
INSTALLED 1.6.25 types, not memory; bilingual FR-first message.
`requireEmailVerification` is **env-gated, default OFF** so local test
accounts and the SES sandbox never lock anyone out. buildApp gained a mailer
test seam. **LIVE PROOF: real SES SendEmail from no-reply@1dealer.ca to the
AWS mailbox simulator succeeded.** 212/212, parity OK.
(3) **CAUGHT MY OWN MISS:** develop CI had been RED since bf5e2ab — I merged
the F-03 helper without re-running the gate, and eslint had no Node globals
for `scripts/*.mjs`. Root-caused (config, not suppression) and fixed in the
same merge; every CI step now verified locally before push.
**Owner-facing:** verification email is BUILT but enforcement stays off until
SES production access is requested (owner-visible support case, deferred);
sandbox only reaches verified addresses / the simulator.
**Next steps:** 1) HUSSEIN F-03 intake UI → owner test (helper ready).
2) Optional: request SES production access when real customer mail is needed.
3) A-07 unit 2 only when the owner wants a remote env (D-030).
**Blockers:** none.

## 2026-07-25 [AHMAD] — A-10 keyed messages (6f47171); F-03 signing helper verified live (bf5e2ab); A-07 unit-2 cost brief

**Done:** (1) **A-10 DONE (6f47171)** — HUSSEIN's finding fixed: domain
constraints (phone/postal/org-slug/store-code) now carry stable
`MESSAGE_KEYS` via keyed refinements instead of English literals, so the web
error map can speak FR (Bill 96); the API reports the key as
`details[].code` — one vocabulary both sides. Verified against zod 4 live
(refine keeps `params`, regex drops them — hence refinements). 209/209.
**HUSSEIN: you can now map `issue.params.key` / `details[].code` to FR/EN.**
(2) **F-03 test helper (bf5e2ab)**: `node apps/api/scripts/send-test-lead.mjs
--url <webhook_url> --secret <secret> [--first ... --interest ...]` — the
webhook refuses unsigned posts, so the owner test was NOT performable without
it; also the reference implementation for integrators. **Proven live on a
clean DB**: created org+store+key → signed post → `202` → lead "Marie
Tremblay / +18195550142 / website / new" in the list; unsigned → 401,
wrong secret → 401. (3) **A-07 unit-2 cost brief on the board** so the
owner's staging decision is one word (rough ~$85-125/mo with VPC endpoints;
NAT Gateway is the avoidable ~$35/mo; AHMAD recommends DEFERRING staging —
nothing needs it yet, local dev is $0).
**Next steps:** 1) HUSSEIN intake UI → F-03 INTEGRATED → owner test (steps +
helper ready). 2) On dep approval (@aws-sdk/client-sesv2): SES sending +
sign-up email verification. 3) A-07 unit 2 only on owner go.
**Blockers:** none in my zone; owner has 2 optional decisions (dep, staging).

## 2026-07-25 [HUSSEIN] — F-03 INTEGRATED (22c1fe1): intake sources UI merged, e2e 12/12 — AWAITING-OWNER-TEST

**Addendum: F-03 ACCEPTED by owner** ("done and working" after firing a
signed webhook themselves; account had been wiped by another db:reset —
`apps/web/scripts/seed-owner.sh` now committed, run it after EVERY reset).
**F-04 proposed** (lead assignment — NOTE it likely drags in a minimal
add-member path, only one user exists per org; alt: more intake providers).
**Dashboard is now real:** lead stat tiles (tested pure bucket math, honest
Total label, multi-org scope labelled with the org name, mount-race gated)
+ recent-leads list; proper states; merged after review with all findings
fixed. Owner-visible polish while F-04 waits on AHMAD's half.


**Done:** F-03 UI half merged after the adversarial review (20 agents; the
quality lens died on an API drop mid-run — its two finished siblings covered
the ground; NOTE a code-reviewer subagent attempted an Edit during review and
another once switched my branch — watch working-tree state after workflows).
Intake sources on the store page: create key → focused ONE-TIME secret/URL
reveal (copy buttons, cache cleared on Done), localized list, revoke via
H-05 Dialog with in-dialog errors naming the key. Shared failFromResponse
extracted (rule of three). e2e proves the WHOLE loop: UI key → real
HMAC-signed POST (X-Intake-Timestamp / X-Intake-Signature: v1=hex, 202) →
lead in the list → revoke → 401. **12/12 e2e, typecheck 0, lint 0, parity
OK.** Board: F-03 AWAITING-OWNER-TEST; laptop stack on latest builds;
owner account hassan-test@1dealer.ca re-seeded with Groupe Hassan +
Kia Mont-Laurier (remember: EVERY db:reset needs this re-seed).
**Next steps:** 1) OWNER tests F-03 (steps in chat: create key, signed curl
helper provided, watch the lead arrive). 2) On ACCEPT: F-04 proposal
(candidates: lead assignment, or intake provider expansion ADF/Meta).
**Blockers:** owner test only.

## 2026-07-25 [AHMAD] — F-03 intake webhook AHMAD half DONE (0b9b93d); SES verified; HO-03 done

**Done:** F-03 lead intake backend merged (0b9b93d). Migration 0005:
intake_keys (per-store webhook creds) + RLS + `intake_resolve` SECURITY
DEFINER fn (joins store/org liveness so a closed store can't receive leads).
Management API (owner/gm): create key → secret + webhook_url returned ONCE;
list → secret never selected; revoke. Public **POST /in/v1/leads/:token**
(no session; added to PUBLIC_ROUTES): HMAC-SHA256 of `${ts}.${rawBody}`, ±5min
window, 256KB limit, rate-limited, resolves via the definer fn, inserts a
lead synchronously that shows up in the F-02 list with the key's source.
Added a global raw-body JSON parser (keeps the malformed-JSON envelope).
TDD; 9-agent adversarial security review — 3 confirmed fixed: keysetPage
cursor injection now works for explicit column lists (was a real >25-row
pagination bug, also latent for any future non-`SELECT *` list), uniform 401
for unknown+bad-sig (no token-enumeration oracle), bounded rate-limit map.
**207/207**, lint 0. Earlier today: HO-03 (i18n parity gate in CI, db77ca6),
SES 1dealer.ca FULLY VERIFIED (domain/DKIM/MAIL FROM SUCCESS).
**For HUSSEIN — F-03 UI half (yours):** contract live on develop:
apiV1.intakeKeys.{create,list,revoke}. create returns IntakeKeyCreated
(has `secret` + `webhook_url` — show ONCE, copy-to-clipboard, warn it won't
be shown again); list returns IntakeKey (NO secret). Screen: per-store
"Intake sources" — create key (pick store + label + default_source), show
the webhook URL + secret once, list existing (label/source/last_used_at/
revoke). Owner-testable journey: create key → (curl a signed test post) →
lead appears in the F-02 list. NOTE: keys are owner/gm only.
**Deferred (noted, not debt-hidden):** separate apps/intake service +
app_intake role, BullMQ spool, ElastiCache rate limit, ADF/XML + Meta/
Twilio/Resend signature schemes, SES production-access request + email
verification (needs @aws-sdk/client-sesv2 — owner dep approval pending).
**Next steps:** 1) HUSSEIN intake-key UI → INTEGRATED → owner test steps.
2) On dep approval: SES send + sign-up email verification. 3) A-07 unit 2
(compute/RDS) when owner wants staging — costed, numbers first.
**Blockers:** none in my zone.

## 2026-07-25 [AHMAD] — F-02 ACCEPTED (owner); HO-03 parity gate in CI (db77ca6); SES FULLY VERIFIED; F-03 proposed

**Done:** (1) Owner tested F-02 and ACCEPTED (chat, "i did tested") — board
updated; duplicate F-02 row consolidated (F-02b tombstone, no-delete rule).
(2) **HO-03 DONE (db77ca6):** ci.yml i18n no-op replaced with the real parity
gate (`--fail-if-no-match run check:parity`, self-building; local run:
"i18n parity OK"). The push itself is the live CI proof. (3) **SES
1dealer.ca is FULLY VERIFIED** (domain, DKIM, MAIL FROM all SUCCESS) —
sending from @1dealer.ca is live (sandbox: verified recipients only until
production access is requested). (4) Board: **F-03 proposed** (owner picks:
A intake webhook [recommended] or B lead assignment); **A-10** filed from
HUSSEIN's note (schema message keys for client-side localization).
**Unblocked next:** requireEmailVerification (last A-05.1 deferral) — needs
@aws-sdk/client-sesv2 in apps/api (NEW DEP → owner ask-first pending) + SES
production-access request (support case, automatable).
**Next steps:** 1) Owner picks F-03 → AHMAD half starts. 2) On dep approval:
SES email sending + email verification on sign-up. 3) A-07 unit 2 (compute/
RDS) when owner wants staging — costed, numbers first.
**Blockers:** F-03 pick + dep approval = owner; else none.

## 2026-07-25 [HUSSEIN] — F-02 INTEGRATED (aad8dbf): lead screens merged, e2e 10/10 — AWAITING-OWNER-TEST

**Addendum (2026-07-25): F-02 ACCEPTED by owner** (EN locale test — note:
db:reset WIPES seeded accounts; re-seed hassan-test after every reset, learned
the embarrassing way). **F-03 proposed on the board** (intake webhook
RECOMMENDED; alt: lead assignment) — owner/AHMAD to confirm. **Shell §7 gap
fixed and merged:** mobile bottom tab bar (<lg, safe-area aware, 56px targets),
dead /pipeline dropped from both navs, dialogs got explicit z-50; phone e2e
added — 11/11. Reviewed, findings fixed.


**Done:** Repo monitor woke the session on AHMAD's 26cfbba; UI half rebased,
integrated, and merged as **aad8dbf** after a 34-agent adversarial review —
ALL confirmed findings fixed pre-merge: localized client-side zod errors via
z.config customError (Bill 96 — includes a form-layer phone check because the
schema's hardcoded EN message overrides the error map, noted below for AHMAD),
stale store_id reset on org change, ''→undefined normalization on optional
fields, multi-org list filter (server 422s unscoped multi-org lists), email +
preferred_language fields added, useStores enabled-guard, shared BackLink,
lead-specific error mapping, self-contained localized e2e, stray F-01
cookie-jar file removed. **Evidence: e2e 10/10** vs live stack (journey +
localized validation + both 409s), typecheck 0, lint 0, parity OK.
**For AHMAD (schemas, low priority):** hardcoded English messages inside
schemas (e.g. PhoneE164) defeat client-side localization — consider dropping
per-field message literals so the app-level error map speaks, or exporting
message KEYS. Also FYI stray tracked file apps/web/-H (my F-01 curl artifact)
removed in aad8dbf.
**Board:** F-02 → AWAITING-OWNER-TEST with exact FR steps on the row.
Laptop stack running latest builds (web :5173, api :3001, PG up).
**Next steps:** 1) OWNER tests F-02 (steps on the row). 2) On ACCEPT: propose
F-03 (candidates: lead assignment to salespeople, or intake webhook → auto
lead). 3) HUSSEIN fill-in until then: none needed.
**Blockers:** owner test only.

## 2026-07-24 [AHMAD] — F-02 AHMAD half DONE (26cfbba): leads backend merged; AWS foundation LIVE

**Done:** (1) **AWS deployed** (owner authorized): DealpilotFoundation stack
live in ca-central-1 — SES identity 1dealer.ca (DKIM auto-verifying via
Route 53), OIDC role `dealpilot-github-deploy` (main/develop only). One fix:
IAM descriptions are Latin-1 (em dash rejected). (2) **F-02 leads backend
merged (26cfbba)**: migration 0004 (vocab mirrors lead.ts, integer cents —
bigint REJECTED: pg serializes int8 as string; non-blank names), RLS
lead_isolation + lead_member_read, routes: member create/update, owner/gm
delete, score never client-writable, assigned_to must be an active org
member, closed stores refuse leads, store/status filters on keyset lists.
TDD red-first; 2-lens adversarial review, all confirmed findings fixed.
**197/197 tests**, lint 0.
**For HUSSEIN — F-02 UI half (yours):** contract live on develop:
apiV1.leads CRUD + LeadListQuery {organization_id?, store_id?, status?};
CreateLeadInput needs org/store/phone/source (phone is the ONE required
contact field, FR-first default); status PATCH free within the 10-state
vocabulary; score read-only; assigned_to = active members only (422
otherwise). Owner journey: create lead → list → change status.
**Next steps:** 1) HUSSEIN F-02 screens → INTEGRATED → owner test steps.
2) SES DKIM check → sandbox test send → requireEmailVerification.
3) A-07 unit 2 (compute/RDS — costed, owner gets numbers first).
**Blockers:** none.

## 2026-07-24 [HUSSEIN] — F-01 ACCEPTED by owner; F-02 confirmed (leads); H-05 primitives DONE

**Addendum (F-02 UI pre-built):** HUSSEIN half is CODE-COMPLETE on
`hussein/f02-lead-ui` (fcd4696, pushed — CI runs on it): lead list (DataTable,
localized 10-status/19-source labels), create form (first H-05 Form consumer —
zodResolver on CreateLeadInput, client-side validation with the server's own
schema), detail w/ status change; leads i18n namespace FR/EN parity-gated;
integration e2e written ahead. Typecheck/lint/ui-tests green. NOT merged —
waiting for AHMAD's lead routes on develop; a repo monitor wakes my session
the moment they land → rebase, run e2e, fix, merge, stack owner test steps.


**Done:** (1) **F-01 ACCEPTED** — owner personally tested on the laptop
(org create/edit + store create/edit, "all worked"); board updated; owner
account seeded on the laptop (hassan-test@1dealer.ca / Test-Dealpilot-2026!).
(2) **F-02 confirmed by owner** (leads: create → list → change status) and
recorded on the board — AHMAD: your half is the lead routes (A-03 contract,
10 statuses / 19 sources), claim when you can. (3) **H-05 DONE** —
`@dealpilot/ui` ships DataTable (TanStack v8: sortable w/ aria-sort,
loading/error/empty states, own-container overflow), themed Base UI Dialog,
and the react-hook-form Form composition with real aria wiring (shared ids,
describedby, invalid, role=alert — closes the a11y plumbing deferred in the
F-01 review). Deps verified per supply-chain rules (@tanstack/react-table
8.21.3, @base-ui/react 1.6.0, react-hook-form 7.82.0, @hookform/resolvers
5.4.0 in web). **Evidence:** ui 81/81 tests, lint 0, turbo build+typecheck
green, demo screenshot-verified both themes; CI green on every push.
**Answer to your i18n observation:** en-US browser → EN login is PER SPEC —
the detector chain (media-i18n-validation §2.1: profile → tenant → browser)
consults the browser last and fr-CA is the no-signal fallback; Bill 96
requires FR availability/equivalence and FR default for Quebec tenants
(tenant context doesn't exist pre-login). Revisit when tenant resolution
lands (custom domains, ADR-018).
**Next steps:** 1) F-02 AHMAD half (lead routes) → then HUSSEIN lead screens
on the new DataTable/Form primitives → owner test steps on the row.
2) HUSSEIN track is otherwise COMPLETE (H-01…H-05 all DONE); next HUSSEIN
work is F-02 UI.
**Blockers:** F-02 UI waits on the lead routes; otherwise none.

## 2026-07-24 [AHMAD] — A-07 unit 1 merged (052dd0b): CDK foundation synth-verified; cdk deploy awaits OWNER go

**Done:** infra/ CDK TypeScript app (workspace member, deps pinned past the
48h cooldown): SES domain identity for 1dealer.ca (Easy DKIM auto-written to
Route 53 + MAIL FROM mx/spf), GitHub OIDC provider + `dealpilot-github-deploy`
role locked to FOURDE1/Dealpilot main/develop, describe-only perms. Account
BOOTSTRAPPED (CDKToolkit, ca-central-1). `cdk synth` verified against the
live account. Gate: 184/184, lint 0 (cdk.out ignored), build+typecheck ok.
**BLOCKED on one command:** the permission layer (correctly) held back
`cdk deploy` — it creates IAM credential infrastructure. OWNER: either reply
"deploy approved" (AHMAD reruns it) or run:
`cd main-project/infra && set AWS_PROFILE=Dealpilot && pnpm exec cdk deploy --all`
**Board:** F-02 (lead intake → lead list) PROPOSED — owner confirm to start.
**Next steps:** 1) deploy on owner go → verify DKIM → sandbox test send.
2) F-02 on owner confirm. 3) A-07 unit 2 (VPC/ECS/RDS — costed, flagged).
**Blockers:** cdk deploy = owner approval; else none.

## 2026-07-24 [AHMAD] — HO-04 fixed (3bdbb0f); D-029 SES; F-01 integrated + verified on desktop; A-07 claimed (AWS profile live)

**Done:** (1) **HO-04 same-day fix (3bdbb0f):** API refuses superuser
DATABASE_URL at boot (red-first test), .env.example split (app role vs
DB_ADMIN_URL for migrations), db CLI prefers DB_ADMIN_URL. 184/184. (2)
**D-029:** owner chose **Amazon SES over Resend** — PROJECT.md updated; NO
Resend key needed (owner stack shrinks). (3) **AWS live:** owner provisioned
admin profile `Dealpilot` (account 242626139373, IAM user "HUSSEIN", shared);
sts verified. **A-07 claimed.** (4) **Integrated F-01 verified on the
desktop** via headless browser: sign-in → Organizations → create org →
create store KIA-ML/QC → listed, zero console errors; owner test steps now
in the F-01 row. Stack running latest builds; owner account re-seeded.
**Observation for HUSSEIN (your zone, not filing an HO):** headless en-US
browser gets EN default on /login — confirm the i18n detector still defaults
fr-CA where Bill 96 requires.
**Next steps:** 1) OWNER tests F-01 (steps in row) → ACCEPT unlocks F-02.
2) AHMAD: A-07 IaC baseline + SES identity (sandbox) in ca-central-1.
3) After SES verified: requireEmailVerification lands.
**A-07 recon (Dealpilot profile, ca-central-1):** Route 53 already hosts
**1dealer.ca** in account 242626139373 — SES domain identity + DKIM fully
automatable; SES has zero identities, S3 zero buckets (clean slate). A-07
plan: (1) IaC scaffold in infra/ (CDK TypeScript — matches the TS-everywhere
stack), (2) SES domain identity + DKIM via Route 53 + sandbox test send,
(3) OIDC role for GitHub Actions deploys, (4) staging RDS per D-013 last
(costed — flag before apply).
**Blockers:** none — F-01 ACCEPTED by owner; A-07 in flight.

## 2026-07-24 [AHMAD] — overnight continuation: CI all green; A-06 money math DONE (5a47cfd); AHMAD track exhausted

**Done:** (1) **CI verified**: every develop merge tonight is GREEN on GitHub
(F-01 backend, A-05.1, docs commits, HUSSEIN's pushes). (2) **A-06 DONE
(5a47cfd)**: @dealpilot/core ships tax engine (13 provinces, split GST/QST/
PST/HST, Section 87, per-province trade-in credit), amortization + lease
math, desking computeDeal, and the corrected CommissionEngine — all INTEGER
CENTS (ADR-009), ported from the canonical legacy engines with the audited
bug corrections built in: F6/D-12 post-tax rebates, F2 cents pad, F4 all
overriders paid, pad-before-rate, strict-> tier. **21 golden tests** (values
hand-verified pre-implementation); whole tree **180/180**, lint 0, 22/22
build+typecheck. Coverage tooling (@vitest/coverage-v8) NOT added — new dep
needs owner ask-first; suite covers all public functions.
**Track status:** AHMAD owner-independent work is EXHAUSTED. Remaining needs:
A-07 (AWS — owner account/credentials + apply approvals), A-09 (low-value doc
sweep, deliberately skipped overnight — 300+ reference files of name churn),
F-01 integration (waits on HUSSEIN's screens), email verification (waits on
owner's Resend key).
**Next steps:** 1) HUSSEIN lands F-01 UI → both halves INTEGRATED → write
owner test steps → AWAITING-OWNER-TEST. 2) Desking/commission API slices can
now build on @dealpilot/core. 3) A-07 IaC when owner is ready for AWS.
**Blockers:** none in my zone; all remaining items wait on HUSSEIN or OWNER.

## 2026-07-24 [AHMAD] — A-05.1 DONE overnight: auth hardening merged; owner asleep, morning stack unchanged +1 item

**Done:** A-05.1 squash-merged to develop. Explicit session TTLs (7d,
daily refresh), CORS allowedHeaders/content-type+authorization + 86400
preflight cache, toWebRequest origin from BETTER_AUTH_URL (Host-spoof
defense, regression-tested). **cookieCache tried and REJECTED with
evidence** — the cached cookie outlives sign-out; the A-05 round-trip test
(instant revocation) caught it; the test wins per CLAUDE.md. TDD: 3 new
tests red-first (CORS red; two pin now-explicit defaults). **159/159 tests**
(incl. HUSSEIN's new i18n suite), lint 0, build+typecheck green after
frozen install of his H-04 deps.
**OWNER STACK +1:** requireEmailVerification needs an EMAIL PROVIDER —
owner must create a Resend account + API key (plan: Resend) before that
last A-05.1 item can land. Not urgent; stacked.
**Next steps:** 1) Verify CI green on tonight's merges (anon API was
rate-limited). 2) HUSSEIN: F-01 screens (in progress). 3) AHMAD fill-in:
A-06 money-math or A-09 doc sweep; F-01 integration test steps when
HUSSEIN's half lands.
**Blockers:** none.

## 2026-07-24 [AHMAD] — F-01 AHMAD half DONE (2347427): org+store API on user-scoped RLS; owner asleep — morning stack queued

**Done:** F-01 backend merged to develop as **2347427** (D-028). Migration 0003
user-scoped read policies + db withContext/withUser; /api/v1 organizations +
stores CRUD (self-serve org bootstrap in one dual-GUC txn, owner/gm gates,
keyset cursors at full pg precision, 404-never-leak, deleted-org lockdown,
platform-authority status/plan_tier server-side, slug immutable+reserved).
TDD red-first throughout. **Evidence: 144/144 tests** (RLS_REQUIRED=1), lint 0,
build+typecheck 22/22. 50-agent adversarial review: NO isolation bypass (live
probed); confirmed findings all fixed (cursor ms-truncation row-skip, deleted
org stores staying live, status/plan_tier client-writable, constraint-name
leak, forged-cursor 500, delete idempotency, + test gaps closed).
**Local stack refreshed for the owner:** DB reset (migrations 1-3), NEW API
build on :3001, web on :5173, owner account re-seeded
(hassan-test@1dealer.ca / Test-Dealpilot-2026!).
**For HUSSEIN (F-01 UI half — your claim):** contract updated on develop:
CreateOrganizationInput = {name, slug, default_locale?}; UpdateOrganizationInput
= {name?, default_locale?} (NO slug/status/plan_tier); StoreListQuery has
optional organization_id (required when the user has >1 org — error code
organization_required); duplicate slug/code → 409 details[{path:'slug'|'code'}];
cursors are opaque. Owner test steps for the F-01 slice are OURS to write when
both halves are in — coordinate via the F-01 row.
**Owner morning stack:** see chat message (test auth shell optional re-run;
F-01 owner test comes only after HUSSEIN's screens; no decisions pending).
**Next steps:** 1) HUSSEIN: F-01 screens. 2) AHMAD next session: verify CI on
2347427 green, then A-05.1 auth hardening or A-06 money-math as fill-in.
3) When both halves land: INTEGRATED → AWAITING-OWNER-TEST with exact steps.
**Blockers:** none.


## 2026-07-24 [AHMAD] — A-02 DONE (live green+red proven); owner billing fixed; local stack launched for owner test

**Done:** (1) Owner paid the GitHub bill → **A-02 flipped to DONE(125c900)**.
Live evidence: probe branch `ahmad/ci-probe` at develop's exact tree → run
**30045013846 SUCCESS** (all steps: containers, checkout, pnpm/node, frozen
install, db-from-zero on the PG service, build+typecheck, lint, 108 tests
with RLS_REQUIRED=1); then a deliberate failing test → run **30045318726
FAILURE at exactly the Test step** (all prior steps green). Probe branch
deleted (origin+local). D-027 recorded earlier today: keep `@dealpilot/*`
scope, "1Dealer" user-facing only (owner-approved). (2) **Local stack
launched on the desktop for the owner's first hands-on test:** db reset
(clean), API `node dist/index.js` on :3001, web `vite` on :5173 (proxy
/api→3001). Verified the full journey MYSELF via headless browser:
`/`→redirects `/login` (guard), `/signup` creates account
(hassan-test@1dealer.ca / Test-Dealpilot-2026!), lands on FR dashboard
("Bonjour, Hassan Test", Nordique shell), Se déconnecter → /login, sign-in
round-trip back to dashboard, **zero console errors**; screenshot captured.
This completes the live-round-trip half of HUSSEIN's H-03 DoD evidence on a
Docker machine (Playwright e2e still his). Note: a stale A-05-era API
process was found holding :3001 and killed before relaunch.
**For HUSSEIN:** CI now runs on every push of `hussein/**` — you get a
verdict per push. H-03 live sign-in verified working on the desktop (see
above); only the Playwright e2e remains for your DoD.
**Next steps:** 1) Owner tests the auth shell (steps given in chat;
test account above or create their own). 2) On owner F-01 confirm: AHMAD
starts org+store routes. 3) Fill-in: A-05.1 or A-06.
**Blockers:** none.

## 2026-07-23 [AHMAD] — A-02 CI merged (125c900) but Actions BLOCKED by GitHub billing lock; HO-01↔HO-02 exchanged; owner rules applied

**Done:** A-02 built and squash-merged to develop as **125c900** (decision
**D-026**): `.github/workflows/ci.yml` — push-triggered on
main/develop/`ahmad/**`/`hussein/**` + `workflow_dispatch` (feature-branch runs
= the pre-merge feedback PRs would have given; D-021 unchanged); actions
SHA-pinned (checkout v7.0.1, pnpm/action-setup v6.0.9 peeled commit,
setup-node v7.0.0); `permissions: contents: read` + `persist-credentials:
false`; ephemeral postgres:16-alpine mapped to host **5434** so the repo-wide
URL convention holds unchanged in CI; `db:reset` from migration zero (with
`--fail-if-no-match`); turbo build+typecheck; eslint; tests via new root
**`test:ci`** (`--passWithNoTests=false`) with **RLS_REQUIRED=1**; i18n step =
explicit NO-OP notice pending H-04. Shared-branch runs keep their verdicts
(cancel-in-progress only on feature branches). Also: `.nvmrc`=24, PROJECT.md
Node fact corrected, vitest `fileParallelism: false` (the db suite's beforeAll
drops the schema the api suite is using — parallel files raced by luck).
Review = 28-agent adversarial workflow (4 lenses → 2-skeptic refutation per
finding): 2 CONFIRMED fixed (shared-branch verdict loss; empty-collection
green), 3 hardenings, 5 refuted with evidence.
**Board:** F-01 proposal filed (owner deferred confirmation). HO-01 filed
(ui Windows ESM crash) → HUSSEIN fixed same day (081c546) — full tree back to
22/22 on Windows. HO-02 answered and closed: the `reference/**` exclude has
existed since 637c9fd (`git show 637c9fd:vitest.config.ts`); clean tree +
frozen install runs 6 files / 108/108 green — suspect a pre-637c9fd checkout;
the REAL half (stale Node facts) fixed in 125c900; re-open with exact
command/cwd/HEAD if it persists on your machine.
**Owner rules applied this session:** repo git identity switched to
**FOURDE1 <hossienraad321@gmail.com>**; `"attribution": {"commit": "", "pr":
""}` added to `~/.claude/settings.json` (takes effect next session start). My
3 pushed commits this session (faf3d7d, 2d0c426, 125c900) were already
trailer-free; older pushed history keeps its trailers per the no-rewrite rule.
**Test/build status (evidence):** turbo build+typecheck **22/22**; eslint
exit 0; `RLS_REQUIRED=1 pnpm test:ci` → **6 files, 108/108** (34 ours +
74 H-02); the exact CI command sequence exercised locally end-to-end.
**BLOCKED / owner actions:** (1) **GitHub Actions is locked** — the
ahmad/ci-pipeline run died pre-start with annotation "The job was not started
because your account is locked due to a billing issue." NO workflow can run
until the owner fixes github.com → Settings → Billing. After unlock: push
anything (or dispatch CI) → expect green; AHMAD then pushes a deliberate
red-probe branch to prove failures fail → flip A-02 to DONE. (2) Confirm or
override **F-01** (org+store admin — proposed, deferred). (3) `@dealpilot`
scope rename question (A-09) still open.
**Gotchas learned:** true machine date is **2026-07-23** (git timestamps
+0300) — earlier entries dated "2026-07-24" were written a day ahead. gh CLI
is NOT authenticated here (pushes go through Windows credential manager);
repo FOURDE1/Dealpilot is **public** → anonymous api.github.com works for
run status + failure annotations (how the billing lock was diagnosed).
pnpm `--fail-if-no-match` exists in 10.26.1; CLI `--passWithNoTests=false`
overrides config-level `true`. NOTE: HUSSEIN's older H-01 entry is still
headless mid-file (~line 175, under my A-08 entry) — his to restore.
**Next steps:** 1) Owner unlocks billing → green + red-probe → A-02 DONE.
2) F-01 AHMAD half on owner confirm (org+store routes vs A-03 contract).
3) Fill-in while waiting: A-05.1 auth hardening or A-06 money-math port.
**Blockers:** A-02 live verification on owner billing; otherwise none.

## 2026-07-23 [HUSSEIN] — Laptop online; H-01 DONE (Nordique, D-024); H-02 DONE (2fd3dea); name = 1Dealer (D-023)

**Done:** (1) **Laptop setup:** repo on develop, Node 24.14/pnpm 10.26.1, `.env`
created; Stitch MCP connected (STITCH_API_KEY added to `~/.claude/settings.json`
env block); GitHub push works via the laptop's existing SSH key (origin switched
to `git@github.com:FOURDE1/Dealpilot.git`). §2 bootstrap + §2.1 onboarding
re-done on this machine. (2) **H-01 DONE:** all 5 Stitch projects verified
intact; comparison board **regenerated on the laptop account**
(https://claude.ai/code/artifact/dc86eca3-b71f-452c-a046-24cb54d06b12 — old
desktop artifact unreachable here); owner picked **Direction 1 "Nordique"**;
tokens locked as **D-024** with computed OKLCH + WCAG evidence. Owner also
amended the product name → **"1Dealer"** (D-023; domain stays 1dealer.ca —
".co" was a typo, verified). D-number collision with Ahmad's same-day push
resolved from both sides (his db entry = D-022, his auth entry = D-025).
(3) **H-02 DONE, merged to develop as 2fd3dea:** `@dealpilot/ui` ships
tokens.ts (D-024 source of truth) → unit-tested build-css.ts → generated
tokens.css (primitive/semantic/component layers, `data-theme` dark,
`data-density`, `@theme inline`, self-`@source` so app builds emit library
utilities — verified empirically), Button (cva, semantic tokens only, 44px
touch floor <lg), cn(), WCAG contrast gate, FR-first two-theme demo
(`pnpm --filter @dealpilot/ui demo`, screenshot-verified).
**Test/build status (evidence):** ui build clean; **74/74 vitest** (contrast
gate: every text pairing ≥4.5:1 BOTH themes; palette-ban; touch targets); root
lint exit 0; typecheck 0 errors; app-consumption sim emitted `.bg-primary`
from the two documented imports. Deps verified per supply-chain rules
(lucide-react REJECTED this session — published <48h; @base-ui/react deferred
to H-05 per YAGNI — re-verify names/ages then).
**Review:** 3-lens adversarial workflow (25 agents) on the diff; ALL confirmed
findings fixed: `--input` now the shadcn border semantic (+`--input-bg` fill —
prevents invisible borders on vendored H-05 inputs), D-024 status-as-TEXT
variants added (`success/warning/danger/info-text`, danger-text = #B91C1C
because #DC2626 measured 4.4999:1 on page), hover:opacity replaced with darker
hover tokens (opacity broke AA), `max-lg:min-h-11` touch floor, secondary-hover
no-op fixed, generator fail-fast + tested, palette-ban regex covers all 22
palettes + arbitrary values, build no longer ships tests in dist.
**Blocked / open questions:** none for me. **For AHMAD:** HO-01 filed (root
vitest scans reference/** — root `pnpm test` fails on clean develop; blocks
A-02 CI); PROJECT.md "Node 22 + .nvmrc" is stale vs `engines >=24`; 1Dealer
identifier rename is yours (you already flagged it). **Owner instruction
(2026-07-23, applies to BOTH agents):** commits carry the owner's name ONLY —
no "Co-Authored-By: Claude" trailers, no AI attribution in commit messages or
PR bodies. Set `"attribution": {"commit": "", "pr": ""}` in your
`~/.claude/settings.json` and repo git identity to the owner's GitHub account
**FOURDE1 <hossienraad321@gmail.com>** (owner corrected this from the earlier
"Hassan <hassan@readycar.ca>" instruction — use FOURDE1).
Existing pushed history stays as-is (no rewrites on shared branches, §7).
**Gotchas learned:** pnpm `add <pkg>@catalog:` REWRITES pnpm-workspace.yaml
(repins the catalog) — restore Ahmad's file and plain `pnpm install`; squash
merges need `git branch -D` (git can't see the merge); non-interactive shells
here sometimes lose nvm/pnpm from PATH — prefix
`export PATH="$HOME/.nvm/versions/node/v24.14.0/bin:$HOME/.local/share/pnpm:$PATH"`.
**Next steps:** 1) H-03 (apps/web shell) — ALL deps now DONE, claim next
session; layout+routing on @dealpilot/ui tokens, auth screens against the A-05
Better Auth contract. 2) H-04 (i18n scaffold) parallel-safe. 3) H-05 primitives
(adds @base-ui/react after cooldown re-check).

**Addendum 4 (2026-07-24, overnight): F-01 HUSSEIN half DONE (3cfd4e3) —
slice is AWAITING-OWNER-TEST.** Admin screens on the shell: org list/create/
detail+edit, store create/edit; ui gained Input/Label/Select primitives
(D-024 semantics); i18n `orgs` namespace incl. LOCALIZED status/plan
vocabularies + per-field validation messages. Data plane: ts-rest initClient
types COLLAPSE under zod 4 (latest @ts-rest/core 3.52 predates it) →
`apiRequest` drives method/path from apiV1 route VALUES and parses every
response with @dealpilot/schemas; 10s timeout + react-query AbortSignal
threading; deterministic 4xx never retried. Review: 33-agent adversarial
workflow — ALL confirmed findings fixed (changed-fields-only PATCH so a
failed load can't silently reset store fields; 422 envelope details →
localized per-field errors with focused alerts; store-edit load-error guard;
init-once so refetch can't clobber typing; slugify cap-safe; select keeps a
visible indicator; non-ApiError rethrown never masked). **Evidence: e2e 8/8**
(full journey + slug-409 + code-409 + auth + i18n) against live API+PG;
typecheck 0, lint 0, parity OK, ui 80 tests. Accepted limit (recorded): lists
cap at limit=100 with no pagination UI yet.
**⚠️ For AHMAD — HO-04 (SECURITY footgun, live-verified):** `.env.example`'s
DATABASE_URL is the compose SUPERUSER; an API run with it BYPASSES ALL RLS
(fresh user listed another user's org+stores). On `dealpilot_app` (your
env.ts default) isolation is fine (re-probed: empty). Fix the example/split
URLs or refuse superuser at API boot. Also FYI: ts-rest client unusable
until a zod-4-compatible release — consider pinning that expectation in A-09
or a CR when upgrading.
**Morning stack for the OWNER is in the chat summary** (test F-01 on the
laptop at localhost:5173; steps also in the F-01 row).

**Addendum 3 (2026-07-24): H-04 DONE (b26f490).** FR-first i18n scaffold:
`@dealpilot/i18n` (typed locales w/ recursive `satisfies` mirror, ICU,
`createI18n` factory with `strictIcu` for dev/tests, `checkParity` covering
missing/extra/empty — INCLUDING empty fr-CA reference values — and ICU
argument-set mismatches; CLI derives the locale set from `resources`, exit-1
demonstrated; 12 tests). apps/web fully re-keyed with **typed t() keys**
(`CustomTypeOptions` — typo'd key = compile error), safe localStorage (blocked
cookies can't blank the SPA), LanguageSwitcher with locale-file accessible
names, localized auth errors (raw English server text never shown), html lang
synced incl. after reload. e2e 5/5. Reviewed by a second 25-agent adversarial
workflow; ALL confirmed findings fixed pre-merge. **HO-03 filed** (AHMAD: wire
`pnpm --filter @dealpilot/i18n check:parity` into the CI i18n step).
**Owner instruction (overnight, applies to BOTH agents):** owner is asleep —
continue autonomously wherever nothing is needed from him; STACK anything
requiring owner testing/decisions clearly for the morning; stay on plan.
**Next:** H-05 primitives (feeds the F-01 admin screens), then F-01 HUSSEIN
half against the A-03 contract.

**Addendum 2 (2026-07-24): H-03 DONE (93a29a7).** Owner installed Docker +
granted socket access; verified end-to-end on this laptop: compose PG up →
`db:reset` from migration zero → API booted (`db:up`, gate 401) → curl
round-trip (sign-up → me → sign-out → 401) → **Playwright e2e 3/3** (system
Chrome channel, fr-CA, via the Vite proxy; `*.e2e.ts` naming keeps vitest's
glob away — root vitest config is AHMAD's zone). Also: GitHub billing lock
verified GONE via the Actions API (the red develop run was a zero-step casualty
from the locked window; Ahmad's later runs execute); stale laptop `.env`
(pre-rebrand readyloans@5432) refreshed from the current example — if the API
says `db: down`, check `.env` age first. Owner reviewed F-01/scope in Ahmad's
session (D-027: keep @dealpilot scope, 1Dealer user-facing).
**Next steps:** 1) F-01 HUSSEIN half (admin screens) once the owner confirms
the slice and Ahmad's API half lands. 2) H-04 i18n scaffold (parallel-safe,
keys the shell's FR literals). 3) H-05 primitives.

**Addendum (same session):** owner deferred F-01 confirmation ("continue") →
claimed H-03 and merged **increment 1 as 734e5f8**: Vite 6 + React 19 SPA,
react-router v7 (lazy routes; RequireAuth/RedirectIfAuthed with tested
open-redirect-safe returnTo), Better Auth client (same-origin dev proxy /api →
:3001, first-party cookies), ts-rest client on @dealpilot/contracts, app
layout + FR-first auth screens on the H-02 tokens. Evidence: typecheck clean,
5/5 guard tests, vite build 121KB gzip main (budget 350KB, route-split),
/login screenshot-verified on the built bundle; full turbo green except the
pre-existing HO-02 root-test failure. **Remaining for H-03 DoD:** live
sign-up→me→sign-out round-trip + Playwright e2e — blocked on THIS laptop
(no Docker → no local Postgres → API can't boot); next session on either
machine finishes it. Also this session: fixed AHMAD's HO-01 same-day
(pathToFileURL, 081c546); commit identity corrected to FOURDE1
<hossienraad321@gmail.com> (owner). Auth-screen forms use controlled inputs
deliberately — the react-hook-form+zod Form primitive is H-05's deliverable
and these screens migrate onto it (noted to avoid duplicate form plumbing).

## 2026-07-24 [AHMAD] — A-05 DONE (269dfdd): Fastify API + Better Auth; Sprint-0 foundation COMPLETE

**Done:** A-05 merged to develop as **269dfdd**. `@dealpilot/api`: Fastify 5 app
factory (`buildApp`), zod env contract that **fails fast in production** if any
of DATABASE_URL/BETTER_AUTH_SECRET/BETTER_AUTH_URL/WEB_ORIGIN is left at a dev
default (and requires https auth URL); Better Auth (email+password, uuid ids,
HttpOnly+SameSite=Lax cookies, Secure in prod) mounted at `/api/auth/*` for
**identity+sessions only** (org/roles/tenancy stay in A-04 tables — D-025);
**deny-by-default gate** keyed on the ROUTED pattern (`request.routeOptions.url`)
so path-traversal can't bypass it; canonical error envelope on every non-2xx
with Fastify→canonical code mapping + 422 `details[]`; pino logs with reqId +
cookie/authorization redaction; `/api/v1/health` (public) and `/api/v1/me`
(session probe, published in the contract as `apiV1.auth.me` + `MeResponse`).
Migration `20260724000002_better-auth.sql` (CLI-generated identity tables +
least-privilege grants).
**Test/build status (evidence):** **34/34 tests** (19 schemas + 8 db + 7 api:
health, deny-by-default, **path-traversal gate regression**, malformed-JSON
canonical envelope, full sign-up→cookie→me→sign-out round-trip, sign-in good/bad
password); real standalone boot verified (health 200, unauth /me 401); turbo
build+typecheck 22/22; lint clean. Code review (adversarial gate probing — no
bypass found): 2 MAJOR fixed (prod-default fail-fast; routed-path gate) + minor
carve-outs recorded in **D-025**; deferred hardening tracked as **A-05.1**.
**MERGE EVENT:** landed on top of HUSSEIN's pushed work — resolved conflicts in
DECISIONS.md (renumbered my auth entry D-023→**D-025**; kept his D-023 name +
D-024 design) and TASKS.md (kept his H-01 DONE + H-02 CLAIMED). Rebase/merge
protocol worked exactly as designed.
**⚠️ OWNER RENAME — needs an AHMAD decision:** owner renamed the product
**"Dealpilot" → "1Dealer"** (D-023 [HUSSEIN]; domain `1dealer.ca` per D-021,
the ".co" was a typo). User-facing naming = "1Dealer". BUT engineering
identifiers are still `@dealpilot/*` (package scope), repo `FOURDE1/Dealpilot`,
root pkg `dealpilot`. **OPEN: decide whether to rename the `@dealpilot/*` scope
to `@1dealer/*` (note: npm scopes can't start with a digit — would need e.g.
`@onedealer/*`) or keep the internal scope and only rebrand user-facing.**
Folded into A-09 (doc/name sweep) — surface to owner before doing it.
**Sprint-0 foundation is now COMPLETE** (A-01 scaffold, A-03 contracts, A-04
db+RLS, A-05 api+auth ✅; H-01 design ✅, H-02 tokens in progress). Per D-018,
the NEXT thing is the **first feature slice** — the first thing the owner can
open in a browser and test.
**Next steps (next session, likely Fable 5):** 1) **Commit is already done** —
nothing pending to merge. 2) Ask owner the `@dealpilot` scope-rename question
above. 3) With HUSSEIN: define the **first feature slice** (candidate:
"Organization + store admin" or "Lead intake → lead list") as an F-01 board
row with owner test steps. 4) Optionally A-02 CI (GitHub live) and A-06 money
math. HUSSEIN track: H-02 tokens → H-03 web shell (auth screens now unblocked:
BA client SDK + `/api/v1/me`).
**Blockers:** none.

## 2026-07-24 [AHMAD] — A-04 DONE (637c9fd): Docker Postgres + forced-RLS multi-tenant foundation, proven live

**Done:** A-04 merged to develop as **637c9fd**. `docker-compose.yml` (Postgres
16-alpine, host port **5434** — 5432/5433 occupied by unrelated local projects);
`@dealpilot/db`: createPool (explicit timeouts), `withTenant` (transaction-local
`app.org_id` via set_config — injection-safe, leak-proof across the pool, dead
connections destroyed not re-pooled), checksum-ledger migration runner
(immutable applied migrations, advisory-locked, local-only `reset`); migration
`20260724000001_foundation.sql`: organizations/stores/users/memberships with
CHECK vocabularies EXACTLY mirroring @dealpilot/schemas, updated_at triggers,
tenant-leading indexes, RLS ENABLED+FORCED everywhere keyed on
`NULLIF(current_setting('app.org_id',true),'')::uuid` (fail-closed incl. the
pooled-connection empty-string quirk), same-org composite FK
memberships→stores, `dealpilot_app` NOLOGIN role (dev LOGIN via reset
bootstrap; no credentials in git).
**Test/build status (evidence):** reset-from-zero clean; **27/27 tests** — 19
schemas + 8 db: tenant isolation both directions, fail-closed no-context reads,
cross-tenant INSERT rejected by WITH CHECK, cross-tenant UPDATE touches 0 rows,
membership-gated user visibility, reset host-guard; `RLS_REQUIRED=1` turns
DB-absent skips into failures for CI. turbo build+typecheck 22/22; lint clean.
Code review: 2 CRITICAL (WITH CHECK(true) on users; cross-org store FK gap) —
both verified live by the reviewer, both fixed + regression-tested (D-022).
**Gotchas learned:** after a SET LOCAL transaction, pooled connections
materialize the GUC as EMPTY STRING, not NULL → always NULLIF-wrap GUC reads
in policies. Root vitest/eslint must exclude `reference/**` (legacy tests were
being picked up). Docker Desktop daemon may need starting
(`Docker Desktop.exe`, ~8 s). Port 5432/5433 are taken by other projects on
this machine — Dealpilot DB is **5434**.
**For HUSSEIN:** nothing changes for you; when H-03 needs the API (A-05), the
local DB flow is `docker compose up -d db` + `pnpm --filter @dealpilot/db
db:reset`.
**Next steps:** 1) A-05 Fastify + Better Auth (last piece before feature
slices; unblocks H-03 auth screens). 2) Follow-up gap: checksum-immutability
live test (noted from review). 3) A-02 CI when convenient (GitHub live).
**Blockers:** none.

## 2026-07-24 [AHMAD] — A-08: platform is DEALPILOT; GitHub origin; repo self-contained; client answers recorded

**Done:** (1) **Client answered all 5 questions (D-020):** name = **Dealpilot**;
300+ leads/store/mo baseline; Merlin keeps producing the BOS for now, ours stays
an optional feature; delivery checklist = per-store backend configuration of
which items are mandatory; wholesale access granted per-user by the main admin.
(2) **Rebrand:** root `dealpilot`, packages `@dealpilot/*` (all imports/lockfile
updated; build+typecheck 22/22, 19/19 tests, lint clean after rename).
(3) **Reference import:** the full plan + legacy code copied into
`reference/kia-tracker-specs/` (318 files, 4.6 MB; .git/node_modules/.env
excluded; secret-scan clean) — the repo is now fully self-contained for any
machine. §2.1/PROJECT.md/README paths repointed in-repo.
(4) **GitHub:** origin switched to `https://github.com/FOURDE1/Dealpilot.git`
(local bare repo kept as `backup` remote); README gained a "New machine setup"
section (laptop flow for HUSSEIN).
**For HUSSEIN:** product name is **Dealpilot** — import from `@dealpilot/schemas`
/ `@dealpilot/contracts` now. On the laptop: follow README "New machine setup"
(clone → pnpm install → STITCH_API_KEY → "You are Hussein"). Owner design pick
for H-01 is STILL PENDING — artifact link in your previous entry.
**Next steps:** 1) Owner picks the design direction. 2) AHMAD → A-04 (db +
Docker Postgres + RLS migration). 3) A-02 CI now actionable (GitHub exists);
main branch protection to set in GitHub settings.
**Blockers:** GitHub push requires auth on this machine (browser prompt or
`gh auth login`) — noted below if it fails.

## 2026-07-24 [HUSSEIN] — First session: clone created, H-01 directions generated, awaiting owner pick

**Done:** Bootstrap per TEAM-WORKFLOW §2 + §2.1 onboarding (workflow, board, both
logs, PROJECT.md, ARCHITECTURE.md, ui-design-system.md, frontend-stack.md,
white-labeling.md). Created my working copy `../main-project-hussein` (clone of
`../readyloans.git`, on `develop`, repo-local identity set). Claimed H-01
(coordination commit aa39295). Generated **5 design directions via the Stitch
MCP**, each a full design system + rendered FR-first dashboard (desktop, Gemini
3.1 Pro), one Stitch project per direction:
1. *Nordique* — blue #3B82F6, Inter, r8 (project 5651095542499910695)
2. *Boréal* — teal #0F766E, dark teal sidebar, Manrope+Inter, r12 (11503043785098575422)
3. *Indigo Atelier* — indigo #6366F1, Plus Jakarta Sans+Inter, r10 (6431364234345393492)
4. *Ardoise et Ambre* — dark-first slate + amber #F59E0B, Space Grotesk+Inter, r6 (7548404339407909459)
5. *Rouge Concession* — crimson #DC2626, warm grays, Public Sans+Inter, r8 (11280684898210525560)
Delivered a comparison board (screenshots, palettes, trade-offs, recommendation:
Nordique as white-label-safe default, Boréal as the distinctive alternative) to
the owner as a private artifact:
https://claude.ai/code/artifact/c4277ce4-bafe-419e-a685-870210592442
**Test/build status:** n/a — H-01 is a no-code task; no repo files touched
besides coordination docs.
**Blocked / open questions:** H-01 now `BLOCKED(needs design-direction pick from
OWNER)`. On the pick: lock palette/typography/radius/density as OKLCH tokens in
DECISIONS.md `[HUSSEIN]`, mark H-01 DONE, then claim H-02 (depends A-01 DONE ✓).
Saw Ahmad's A-03 DONE land mid-session (rebase conflict in this file, resolved
per §8 — coordination file, both entries kept).
**Gotchas learned:** Stitch MCP tool surface differs from Ahmad's note
(build_site/get_screen_code are gone; it's create_project / generate_screen_from_text /
get_project / list_screens now). `generate_screen_from_text` always times out
client-side (~1 min) while the server keeps rendering ~5–6 min — poll
`get_project` (updateTime + thumbnailScreenshot), do NOT retry. A second
generation into the same PROJECT_DESIGN project is silently dropped — use **one
project per direction**. `list_screens` returns empty even when a render exists;
the thumbnail on `get_project` is the reliable output.
**Next steps:** 1) Owner picks a direction (or a mix) → lock tokens in
DECISIONS.md, H-01 DONE. 2) Claim H-02 (tokens + Tailwind v4 + shadcn/ui in
packages/ui). 3) H-04 (i18n scaffold) is my next parallel-safe task if waiting.

## 2026-07-24 [AHMAD] — State save: feature-based delivery adopted; settings fixed; GitHub incoming

**Done:** Owner checkpoint session. (1) Fixed `~/.claude/settings.json` — a
trailing extra `}` made the whole file invalid (permissions/env were silently
not in effect); now valid, takes effect next session start. (2) Recorded the
owner's **feature-based delivery model** as TEAM-WORKFLOW §12 + D-018: after
Sprint-1 foundation, one user-visible feature slice at a time, INTEGRATED →
AWAITING-OWNER-TEST → ACCEPTED by the owner before the next starts; bundles
declared up front. (3) D-019: GitHub adoption incoming (owner will provide the
repo URL; HUSSEIN will also work from a laptop, same account) — until then the
local bare origin stays. (4) Verified Docker 29.5.3 installed → A-04 unblocked.
**For HUSSEIN (owner instruction):** in Stitch, use the **best model available
within the FREE tier** (highest-quality free mode, stay inside free generation
quotas — never paid options). Confirmed `main-project-hussein` as your clone is
exactly right per §3.
**Next steps:** 1) AHMAD → A-04 (db + Docker Postgres + migration 0001 + RLS
smoke test). 2) On owner's GitHub repo URL: switch origin, push, protect main,
then A-02 CI. 3) HUSSEIN → finish H-01, owner picks a direction.
**Blockers:** none for A-04. GitHub switch waits on owner repo URL + gh auth.

## 2026-07-24 [AHMAD] — A-03 DONE: contract published (31f5f28); origin is local bare repo

**Done:** A-03 complete and merged to develop as **31f5f28** — THE publication
event. `@readyloans/schemas`: zod-4 schemas with sanitization built in (E.164
phone, lowercase email, postal `A1A 1A1`, integer cents), spec-exact
vocabularies (10 roles + MFA set, 10 lead statuses, 19 lead sources +
source_platform, org status 7-value + plan_tier, store active/paused/closed,
membership invited/active/revoked), strict inputs, create-only defaults
(update inputs defaults-free — regression-tested). `@readyloans/contracts`:
ts-rest `/api/v1` CRUD + cursor list + soft-delete for all 5 entities, error
envelope (incl. 409/429) on every route, OpenAPI stub for A-05.
**Test/build status (evidence):** turbo build+typecheck 22/22; vitest 19/19;
eslint clean. Code-reviewer subagent found 5 CRITICAL + 9 MINOR — all fixed
(see D-016/D-017); the defaults-leak bug was verified real before fixing.
**Also this session:** A-01 closed at DONE(d4235a2) — owner chose git-only:
origin = local bare repo `../readyloans.git` (TEAM-WORKFLOW §3 updated with
HUSSEIN's clone command). A-02 deferred note (CI needs GitHub). Saw HUSSEIN's
H-01 claim land mid-session — rebase worked exactly as designed.
**For HUSSEIN:** the contract you code against is live on develop — `git pull`,
then import from `@readyloans/schemas` / `@readyloans/contracts`. H-03's
A-03 dependency is now DONE; only A-05 (auth contract) remains for the auth
screens. Locale vocabulary is `fr-CA`/`en-CA` (D-017) — use it in H-04.
**Next steps:** 1) A-04 db package + local Docker Postgres + migration 0001 +
RLS smoke test. 2) A-05 Fastify + Better Auth (unblocks H-03 fully). 3) A-06
money-math port when Sprint-1 track allows.
**Blockers:** none.

## 2026-07-24 [AHMAD] — Repo genesis + monorepo scaffold (A-01 local scope complete)

**Done:** A-01 local scope. `git init -b main` in main-project; genesis commit
0ab88a1 (CLAUDE.md, docs/, .claude/, .mcp.json, README, .gitignore, .env.example);
`develop` branched; scaffold built on `ahmad/monorepo-scaffold` and squash-merged
to develop as **d4235a2**: pnpm+Turborepo workspace — apps/{web,api,workers,intake},
packages/{db,schemas,contracts,core,ui,i18n,ai} as compiling stubs; TS 5.9 strict
base (noUncheckedIndexedAccess, verbatimModuleSyntax); ESLint 9 flat +
typescript-eslint; Prettier; vitest; pnpm catalog pins typescript; .gitattributes
LF; repo-local git identity Hassan <hassan@readycar.ca>.
**Test/build status (evidence):** `pnpm install` clean (17.3s, pnpm 10.26.1, install
scripts blocked by default per CLAUDE.md); `pnpm turbo run build typecheck` →
22/22 tasks successful; `pnpm lint` exit 0; `pnpm test` exit 0 (--passWithNoTests;
no tests exist yet — stubs only).
**Blocked / open questions:** A-01 remainder needs the OWNER: `gh auth login`
(gh 2.95 installed, not authenticated), GitHub org/repo name, push approval,
then branch protection on `main`. Board row set BLOCKED accordingly.
**Note for HUSSEIN:** the Stitch MCP **is now connected** (user-scope, verified
HTTP 200 with real key; tools build_site/get_screen_code/get_screen_image) — the
H-01 "not yet connected" note is stale; you can start H-01 in any fresh session.
Until A-01 push is done, no repo clone for you (per TEAM-WORKFLOW §3) — H-01
needs no repo. Also: `../kia-tracker-specs` is readable without permission
prompts (additionalDirectories) and TEAM-WORKFLOW gained §2.1 onboarding +
§2.2 async-mode sections — read them at bootstrap.
**Next steps:** 1) Owner unblocks GitHub → finish A-01 (push, protect, verify
clone). 2) A-02 CI pipeline. 3) A-03 schemas/contracts baseline (publication
unblocks H-03).

## 2026-07-24 — DB platform switch: Supabase → Amazon RDS; docs aligned

**Done:** Owner decision (2026-07-24) recorded and propagated: the database moves
from Supabase to **Amazon RDS for PostgreSQL 16** in `ca-central-1` (VPC-private,
RDS Proxy at launch, KMS/gp3, backups + PITR); Better Auth re-confirmed after a
Cognito comparison; TypeScript backend re-confirmed. Canonical ADRs already
amended in `../kia-tracker-specs/docs/new/00-overview/ARCHITECTURE-DECISIONS.md`
(ADR-004 Socket.IO realtime, ADR-006 note, ADR-008 RDS, ADR-013 S3/CloudFront,
ADR-014/015/023 + stack table). Docs aligned this session: kia-tracker-specs —
`EXECUTIVE-SUMMARY.md` (target stack table), `ROADMAP.md` (Phase 0 item 0.7 RDS
via IaC, realtime rows, envelope restated), `OPEN-QUESTIONS.md` +
`OPEN-QUESTIONS-SIMPLE.md` (Q-08 cost table → RDS + S3 rows, envelope
~US$750–1,100/mo; Q-11 update notes), `functional-requirements.md` +
`non-functional-requirements.md` (Socket.IO/S3/RDS Proxy where Supabase was the
target), `README.md` (05-database description); main-project — `PROJECT.md`
(stack facts), `ARCHITECTURE.md` (overview + mermaid + data flow),
`DECISIONS.md` (D-013/D-014/D-015), `TASKS.md` (A-04 re-scoped to local Docker
Postgres + staging RDS via A-07 IaC).
**In progress:** nothing — still pre-build.
**Blocked / open questions:** unchanged — client answers pending in
`../kia-tracker-specs/docs/new/00-overview/CLIENT-QUESTIONS.md`; none block Phase 0.
**Decisions:** D-013 (RDS over Supabase), D-014 (Better Auth re-confirmed vs
Cognito), D-015 (TypeScript backend re-confirmed) in docs/DECISIONS.md.
**Gotchas learned:** Supabase mentions in legacy/as-is descriptions (old Kia
tracker, leaked-key rotation, audit findings) are intentional history — do not
"fix" them; realtime is now app-emitted Socket.IO events (no DB change-capture),
so emitters must tenant-scope every payload; there is no service-role key
anywhere in the target architecture; dev needs zero cloud resources (local
Docker Postgres).
**Next steps:** unchanged — (1) Ahmad A-01 scaffold; (2) Hussein H-01 Stitch
round; (3) both read the newest SESSION_LOG entry + PROJECT.md before starting.

## 2026-07-23 — Setup session: plan locked, scaffold adapted, ready for Phase 0

**Done:** Planning phase complete — 57 docs in `../kia-tracker-specs/docs/new/`
(canonical authority: `00-overview/ARCHITECTURE-DECISIONS.md`, 26 ADRs amended
2026-07-23 with owner decisions). Owner decisions locked and logged (D-001…D-012).
Scaffold adapted to ReadyLoans: `docs/PROJECT.md` (identity, stack, planned
commands, conventions, boundaries, quality bar), `docs/ARCHITECTURE.md` (target
system map), `docs/DECISIONS.md` (founding ADRs + 11 owner decisions),
`docs/SECURITY.md` (baseline, threat model, deferred-legal-review risk),
`README.md` (repo↔plan relationship). No code exists yet.
**In progress:** nothing — pre-build.
**Blocked / open questions:** client answers pending in
`../kia-tracker-specs/docs/new/00-overview/CLIENT-QUESTIONS.md` (final product
name, lead volumes, Merlin/CAMS role, ON-vs-QC checklist, wholesale authority);
none block Phase 0.
**Decisions:** D-001…D-012 in docs/DECISIONS.md (adopt 26 ADRs; AWS ca-central-1;
clean-start DB; admin-managed pricing; model-agnostic AI; connector framework;
commercial VIN decode; no Tailwind Plus; Stitch-first design; blue-green deploys;
AI error assistant; two-agent build AHMAD/HUSSEIN).
**Gotchas learned:** `../kia-tracker-specs/` is read-only reference — business
rules live in its code/specs, its data is worthless (never migrate); on any
conflict between older specs and the ADRs, the ADRs win; commands in PROJECT.md
are planned, not real, until A-01 lands.
**Next steps:** (1) Ahmad — A-01: `git init` + pnpm/Turborepo monorepo scaffold
(apps/web, api, workers, intake; packages/db, schemas, contracts, core, ui, i18n,
ai), then correct PROJECT.md commands against reality. (2) Hussein — H-01: Stitch
design round → owner selects the design direction (D-009). (3) Both: read the
newest SESSION_LOG entry + PROJECT.md before starting.

## 2026-08-14 — Phase 3d/3e: the conversation layer, end to end (F-19…F-26)

**Done:** Eight slices, each merged to `develop` with CI verified green:
F-19 send layer (d6502c7), F-20 handoff (d339034), F-21 console API (1f4ae0f),
F-22 console UI (897281d), F-23 inbound router (797470f), F-24 speed-to-lead
(e8a433c), F-25 speed dashboard (8d0c6ad), F-26 assistant prompt + tools
(7c9531d). 825 tests, 65 files, 29/29 turbo tasks.

The through-line: the compliance gate stopped being advisory. `sendMessage` is
the only path a message can take to a customer, an outbound `messages` row
must name the consent that authorised it (CHECK), and an agent typing in the
console runs the same gate as the assistant.

**In progress:** nothing half-done; every slice is committed and green.

**Blocked / open questions — ALL need the owner:**
1. **Model runtime** needs `@anthropic-ai/sdk`. The prompt, tools, and every
   guard are built and tested without it; the SDK call is the thin part.
2. **Realtime** (agent console live updates, ADR-004) needs `socket.io`,
   `@socket.io/redis-adapter`, `ioredis`, and `socket.io-client` for tests.
   Redis is already in compose on 6381.
3. **D-043 (new, open):** `leads.budget_cents` — is it a MONTHLY payment budget
   or a TOTAL price budget? conversation-engine.md §5 extracts
   `monthly_budget_cents` with a `budget_type: monthly|total` discriminator, and
   the existing column name says neither. Extraction write-back is not built
   past this, deliberately: guessing would silently corrupt the field the
   desking screen reads.

**Decisions:** D-043 raised (above). No owner decisions were made unilaterally.

**Gotchas learned:**
- `send_decisions.timezone_source` permitted 'fallback' (emitted by nothing) and
  refused 'area_code' (emitted by nearly everything). Every send from a Quebec
  phone number would have died on INSERT. It survived because the endpoint that
  COMPUTES the value never persisted one and the only test that wrote a row
  hand-picked a legal literal. Fixed forward in 0032; a new vocabulary guard in
  packages/db compares every Zod enum against the CHECK constraints.
- The dead-column guard's exemption list had no expiry, so five entries went
  stale in F-18 and two (`deals.fi_price_cents`, `fi_cost_cents`) were never
  true — the deal-create route writes them via INPUT_COLUMNS. It now fails on
  its own stale entries.
- Guards read prose as code: the vocabulary guard's first finding was 'pending'
  read out of a COMMENT inside an enum array. A manufactured finding costs more
  than a missed one — it teaches the reader to skim.
- Two of my own comments claimed load-bearing behaviour that mutation testing
  disproved (handoff send ordering; the agent-assignability predicate, which RLS
  actually enforces). Both corrected to say what is true.
- `conversations` shipped with only the org-keyed RLS policy, so resolving which
  org owns an id — which every detail route does under the CALLER's context —
  returned nothing. The console 404'd on its own data and the cross-tenant test
  passed because everything 404'd for everybody. 0034 adds the member-read
  policy `leads` has had since 0004.
- `now()` is the TRANSACTION's timestamp: rows written together are identical to
  the microsecond and a uuid tiebreak is random. 0035 adds `seq`.

**Update (later the same day):** owner approved both dependency sets and asked
for "the most recommended" on D-043. Landed since: D-043 (bacfcbe, budget
columns split), F-27 (11400ce, the turn loop behind a `ModelClient` interface
with @anthropic-ai/sdk pinned to 0.116.0), and the test-timeout fix below.

**The flake, diagnosed:** it was never a lock. Every database suite rebuilds the
schema from zero in `beforeAll` — measured at 3.6–4.2 s against 37 migrations on
an idle machine — against vitest's default 10 s hook ceiling. Under load a suite
would occasionally cross it, pass alone, and pass on re-run. It appeared the day
the migration count made the work slow enough to matter, and would have got
worse silently. `hookTimeout` is now 60 s, which buys room without fixing the
cost: ~25 suites × ~4 s is most of the 230 s run, and the real fix is ONE reset
per run rather than per suite. That needs the suites audited for the isolation
they currently get for free, so it is written down rather than rushed.

**Next steps:** (1) F-28 realtime (socket.io approved, not yet installed);
(2) with the SDK: the conversation engine (§3 prompt is built, §5 extraction
schema next); (3) with socket.io: tenant-room realtime per ADR-004.
