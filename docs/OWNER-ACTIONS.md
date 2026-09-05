# Owner actions — what only Hassan can do

> Companion to `OWNER-DECISIONS-PENDING.md`. That file holds **questions** that
> need your judgement. This one holds **actions** outside the codebase: accounts,
> credentials, purchases, legal sign-off, and data only you have.
>
> Nothing here is engineering-hard. All of it is schedule-real, and some of it
> has lead times no amount of coding compresses.
>
> Claude: update this the moment an item is done or a new external dependency
> appears. Keep the "unblocks" column honest — it is what makes the list
> actionable rather than a wish list.

---

## Start these first — they have lead times

### 1. Twilio account + Canadian A2P/10DLC registration ⏳ WEEKS

**Why first:** carrier registration for sending SMS to Canadian numbers is a
review process measured in weeks, not hours. Every day this waits is a day added
to launch, and no engineering can shorten it.

| Step | Notes |
|---|---|
| Create a Twilio account | Region matters for data residency — see `docs/PROJECT.md` on Canadian residency |
| Buy at least one Canadian number | One per store eventually; one is enough to test |
| Register the brand + campaign (A2P/10DLC) | The slow part. Needs business details, use-case description, sample messages |
| Copy Account SID, Auth Token, and the number | These become env vars — send them to nobody, paste them into `.env` yourself |

**The code is ready (F-30, `35044a6`). When your credentials arrive it is
configuration, not a code change.** Four env vars:

```
SMS_TRANSPORT=twilio
TWILIO_ACCOUNT_SID=AC…
TWILIO_AUTH_TOKEN=…
PUBLIC_WEBHOOK_ORIGIN=https://api.your-domain.ca
```

`PUBLIC_WEBHOOK_ORIGIN` must be the address exactly as Twilio will call it —
the signature covers the URL, so a mismatch rejects every genuine webhook. It
is read from configuration and never from the Host header, which an attacker
chooses.

**Two URLs to paste into the Twilio console** for your number:

| Twilio field | URL |
|---|---|
| A MESSAGE COMES IN | `https://api.your-domain.ca/carrier/v1/sms/inbound` |
| STATUS CALLBACK URL | `https://api.your-domain.ca/carrier/v1/sms/status` |

**Then set the number on the store — from the screen (F-76, 2026-08-31).**
Sign in → **Réglages → Succursales → your store → « Numéro d'expédition des
textos »**, paste the number, **Enregistrer**. It lives on the store record,
not in an env var, because each rooftop texts from its own number. The same
section holds the store's timezone, opening hours and holidays — which the
assistant now reads. Changing a LIVE number moves the next outbound text to
the new number immediately, and replies sent to the old number no longer
reach this store.

One number belongs to exactly one store platform-wide — the database enforces
it, because two stores sharing a number makes an inbound message unroutable and
the wrong guess delivers a customer's reply to a rival.

**Until `sms_number` is set, that store sends nothing.** No error, no crash —
the send path simply has no number to send from. That is deliberate: a store
that has not been given a number is not yet ready to text customers.

**Unblocks:** every real SMS. The whole conversation engine, the STOP pipeline,
handoff notices, speed-to-lead — all built and tested, none of it can send or
receive a single message until this exists.

**Do NOT paste credentials into a chat with me.** Put them in `.env` locally and
in AWS Secrets Manager when we deploy. I have written the code to read them from
the environment and to fail closed in production when they are absent.

---

### 2. Legal review of the consent copy (Q-24) ⏳ DAYS–WEEKS

**Why:** this is a hard gate before a single real customer receives an
AI-generated message. CASL/CRTC exposure is up to $10M and it is binary — the
compliance engine is built to the letter of the plan, but the *wording* shown to
a customer when consent is captured is a legal question, not an engineering one.

**What to hand your lawyer:** the consent-capture copy and the opt-out
confirmation copy. Ask specifically about express vs implied consent wording and
the unsubscribe mechanism.

**Unblocks:** public AI go-live. Until then the assistant can run against your
own numbers only.

---

### 3. Anthropic API key ⏳ MINUTES

Create a key at console.anthropic.com. **The code is ready (F-31, `6099e2f`)** —
two env vars and the assistant is on:

```
AI_TRANSPORT=anthropic
ANTHROPIC_API_KEY=sk-ant-…
AI_MODEL=claude-sonnet-5      # optional; configuration, never a literal in code
```

**`AI_TRANSPORT=off` is the default, and it is a real product, not a broken
one.** Inbound messages are still received, matched for STOP, routed, filed and
handed to a person. Only the automated reply is missing — a shared inbox with a
compliance engine in front of it. That is why an absent key does not stop the
API from booting, unlike an absent carrier.

**But `AI_TRANSPORT=anthropic` with no key refuses to start**, on purpose. An
assistant switched on and unable to think would leave you believing your leads
were being answered.

**Unblocks:** the assistant actually thinking.

---

### 4. Let the unattended loop run without stopping ⏳ 30 SECONDS

You asked me to grant myself the Bash permissions so the build continues while
you are away. **I cannot, and the refusal is the tool working correctly** — an
agent that can widen its own permissions has none. It has to be you.

Two things interrupt an unattended run, and neither is the allow list — you
already allow `Bash(*)` globally in `~/.claude/settings.json`:

1. `main-project/.claude/settings.json` has an `ask` list containing
   `Bash(git push *)` and `Bash(rm *)`. `ask` beats `allow`, so every push stops.
2. The session runs in **auto** permission mode, where a classifier judges each
   action individually.

**Quickest:** press `shift+tab` until the mode line reads `acceptEdits`.

**Durable:** delete the `git push` and `rm` lines from the `ask` list above
(keep `npm publish` — nothing in this build needs it), and put this in
`Archive/.claude/settings.local.json`:

```json
{
  "permissions": {
    "defaultMode": "acceptEdits",
    "allow": [
      "Bash(pnpm *)", "Bash(npx *)", "Bash(node *)", "Bash(git *)", "Bash(gh *)",
      "Bash(docker *)", "Bash(psql *)", "Bash(python *)", "Bash(curl *)",
      "Bash(ls *)", "Bash(cat *)", "Bash(grep *)", "Bash(rg *)", "Bash(find *)",
      "Bash(mkdir *)", "Bash(cp *)", "Bash(mv *)", "Bash(sed *)", "Bash(jq *)",
      "Bash(netstat *)", "Bash(taskkill *)", "Bash(cd *)", "Bash(sleep *)"
    ],
    "deny": ["Bash(*db:reset*)"]
  }
}
```

Two deliberate choices, since you are authorizing this without reading every
line. I did **not** suggest `bypassPermissions`: it would also switch off the
deny rules in your global settings that stop `rm -rf`, `git push --force`, and
`git reset --hard`. And I added `Bash(*db:reset*)` to deny — that is the command
that has wiped your seeded dev account four times, and it is the one thing I
least want reachable with nobody watching.

**Unblocks:** me finishing a phase without stopping mid-way for a prompt.

---

## When you are ready to spend on infrastructure

You told me not to create paid AWS resources, so none exist. Everything below is
deliberately not done. The envelope is roughly **$750–1,100/month at launch**
(restated 2026-07-24 for the RDS move).

| Item | Why it is needed |
|---|---|
| RDS PostgreSQL 16, `ca-central-1` | The database. Canadian residency is a requirement, not a preference |
| ECS Fargate + ALB (min 2 tasks) | The API. Two tasks is why the Redis realtime adapter exists |
| S3 bucket + CloudFront | Documents and the SPA. **`storage.ts` throws today on `DOCUMENT_STORAGE_DRIVER=s3` because no bucket is provisioned** — the bill of sale cannot be filed until it is |
| ElastiCache Valkey | Cache, rate limiting, BullMQ, the Socket.IO adapter |
| WAF, Secrets Manager, KMS, Route 53 | Security baseline and DNS |

**A staging environment is worth more than it costs.** Nothing has ever been
deployed. Everything is green against local Postgres on this machine, and the
first contact with RDS Proxy transaction pooling interacting with `SET LOCAL`
tenant context under FORCED RLS is exactly the class of problem that only appears
in the real environment.

---

## Accounts to create (free tiers are fine to start)

| Service | For | Blocking? |
|---|---|---|
| **SES production access** | Email. Code shipped (A-11); the account is in sandbox, so it can only mail verified addresses | Blocks inviting real colleagues |
| **Domain purchase + DNS** | The product URL, and ACM certificate validation | Blocks any deploy |
| **Sentry** | Error tracking | Not blocking, but you are flying blind in production without it |
| **PostHog (EU)** | Product analytics | Not blocking |
| **Better Stack** | Log destination | Not blocking |
| **Stripe** | Billing. Products, prices, Stripe Tax registration for GST/QST/HST | Not blocking — billing is not built yet |

---

## Data only you have

These are hours of your time, not engineering time, and they cannot be guessed.

- **The 12 commission pay plans.** Entered fresh, then validated against the
  legacy rules with your sign-off. The commission engine has golden tests; it
  needs your real numbers to be right about your business.
- **Fee catalogue, tax profiles, document templates** per store.
- **Store configuration** — hours, quiet-hours windows, the AI daily contact cap
  and turn cap per tenant.

---

## Decisions still open

Seven compliance questions, `OWNER-DECISIONS-PENDING.md` D-042 #2–#8. **Today the
system refuses to send in those scenarios** — it fails closed, which is the safe
direction, but it means some paths are simply off until you answer.

At least one is a build and not a config: **D-042 #8** — the stop-word machinery
is entirely text-message based, and email has no equivalent path yet.

Also open: D-036, D-037 (insurance F&I — you parked it), D-038, D-039, D-041.

**New (2026-08-19): email-only ADF leads.** AutoTrader/Kijiji ADF intake is live,
but a lead whose document carries no usable phone number is refused (the core
schema is SMS-first: every lead has a phone). Some real enquiries arrive
email-only. Options: (a) keep refusing — the provider dashboard shows the
rejects; (b) relax the schema so phone-less leads land and are email-worked.
(b) is a database change with wide blast radius, so it waits for your call.

**New (2026-08-19): a QR-code library for /security.** MFA enrolment currently
shows the secret for manual entry (works everywhere); a QR code is the smoother
path. Candidate: `qrcode` npm — needs your dependency approval + the 48h
release cooldown check before I add it.

---

## Before the first tenant who is not you

- **External penetration test** (NFR-SEC-015). Required before a non-owner
  dealership is on the platform.
- **Backup and restore drill** — RPO ≤ 5 min, RTO ≤ 4 h, quarterly (NFR-AVL-008).
  A backup nobody has restored is a hope.
- **Staff training and cutover**, then legacy Express shutdown sign-off.

---

## What I am doing meanwhile

Everything on this list is *yours*. Everything else is mine, and I am building it
in this order:

1. ~~**Carrier edge**~~ — **DONE (F-30, `35044a6`).** Webhook, signature
   verification, outbound adapter, delivery receipts, segment counting. 40 new
   tests; the signature check is mutation-tested against a replayed signature
   with the body swapped to STOP. Waiting only on your Twilio account.
2. ~~**Model key path**~~ — **DONE (F-31, `6099e2f`).** It also uncovered a
   real defect: the adapter was never sending the tool definitions to the
   model, so all seven audited tools were unreachable. Fixed and
   mutation-tested.
3. **Queue layer** (BullMQ) — `apps/workers` is a stub today and everything
   designed async runs inside the HTTP request.
4. **Appointments** — the assistant already offers a tool for it that points at
   nothing.
5. **Contacts / customer master** — a dealer CRM currently has no customer record.
6. ~~**The e2e gap**~~ — **narrowed (F-74, 2026-08-31).** The browser suite runs on
   its own database with one command (`pnpm e2e`) and the platform console has
   its first browser test; the twelve other `/admin/*` routes are still
   uncovered and are named in that journey's header.

The honest position on completion, measured 2026-08-14 against the plan's own
phase pricing: **~35% of build effort, ~30% of the road to a dealership using it,
and 0 environments running.** The deepest third — multi-tenancy with forced RLS,
RBAC, integer-cents money math, the CASL/CRTC compliance engine, the AI safety
layer — is done and tested. The broad two-thirds is not.

---

## 2026-08-26 — F-69 platform console: make yourself the first super admin

1. Sign up (or use your existing account) on the web app.
2. From `main-project`, with the dev database:
   `DB_ADMIN_URL=postgresql://dealpilot:dealpilot@localhost:5434/dealpilot pnpm --filter @dealpilot/db exec node dist/cli.js platform-grant <your email>`
   (it prints the target database first — check it is the dev one).
   *Still unspent on 2026-08-31: the e2e suite mints its own first staffer on
   its own database (F-74), so this command remains yours.*
3. Enrol TOTP on `/security` if you have not (mandatory for the console).
4. Sign in again (the console needs a session minted through the TOTP
   challenge) and open **Console** in the topbar → `/admin/tenants`.
5. On RDS, before the first deploy: `ALTER ROLE <migration role> BYPASSRLS`
   (docs/SECURITY.md, accepted risk of 2026-08-26).


## 2026-08-31 — F-74: the browser suite has its own database; your one-shot is still yours

1. **Run the whole browser suite with one command:** `pnpm e2e` (Docker up
   first: `docker compose up -d`). The first line it prints names the database
   it will reset — `dealpilot_e2e_test` — and the ports it will use (API 3101,
   SPA 5176), so your `pnpm dev` can stay up. Anything already on those two
   ports makes it refuse rather than adopt, and a second `pnpm e2e` while one
   is running is refused too.
2. **Your dev database is untouched, and so is its one-shot.** The suite mints
   the console's first staffer on ITS database through the same
   `platform-grant` verb, with the `_test` name as an extra argument; nothing
   on that path can name `dealpilot`, and the 2026-08-26 command above is still
   yours to run when you want the console on your machine (`platform_staff`
   there is still empty — checked before and after every run of this slice).
3. **One orphan to drop yourself, once.** `dealpilot_e2e` was created empty
   while option A was being designed, before the `_test` rule was applied. Its
   name does not end `_test`, so nothing in the repo is allowed to touch it —
   which is exactly why it is yours:
   `docker exec -i dealpilot-db psql -U dealpilot -d postgres -c 'DROP DATABASE IF EXISTS dealpilot_e2e'`
4. The old way — `DEALPILOT_WEB_PORT=… pnpm --filter @dealpilot/web test:e2e`
   against your dev database — is gone: the Playwright config refuses to load
   outside the runner.

## 2026-09-04 — F-82a: the old roster's names are out of this repository; two things are yours

| What | Why only you | Unblocks |
|---|---|---|
| **Scrub your upstream `kia-tracker-specs` repository the same way.** The copy in this repo (`reference/kia-tracker-specs/`) now says « Vendeur NN » in the nine files that named people — `docs/new/01-business-logic/commissions-clawbacks.md`, `discussions/PROJECT-HANDOFF.md`, `KIA-DEAL-TRACKER-COMPLETE-SPECS.md`, `discussions/lead-manager-spec.md`, `docs/new/02-product-requirements/gap-analysis.md`, `docs/new/00-overview/OPEN-QUESTIONS.md`, `docs/new/01-business-logic/platform-admin-domains.md`, `docs/new/01-business-logic/reports-analytics.md`, `client/src/components/SalespeopleManager.jsx` — and its `supabase-migration.sql` (the roster INSERT with every pay term) and `server/seed-test-deals.js` are deleted. Your upstream still has all eleven as they were. At minimum, env-guard or delete `server/seed-test-deals.js` there: it runs three `.delete()` statements against whatever `SUPABASE_URL` in its `.env` points at, with no check that it is not production. | Only you hold that repository; nothing here can push to it. | ROADMAP 0.3 closed on both copies, not one. |
| **Decide whether this repository's history is rewritten** — `OWNER-DECISIONS-PENDING.md` D-083. The names are out of the working tree and a guard keeps them out, but every commit before F-82a still carries them, on GitHub and in the `backup` bare repository. | A rewrite changes every commit hash after the first affected one: everyone re-clones, open branches are rebased, `backup` is force-pushed. Only you can weigh that against twelve people's names in a private repository's past. | Nothing is blocked either way; until you decide, the state is « history as it is, tree guarded ». |
