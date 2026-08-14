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

**Then set the number on the store.** It lives on the store record, not in an
env var, because each rooftop texts from its own number:

```
PATCH /api/v1/stores/{id}   { "sms_number": "+1514XXXXXXX" }
```

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
6. **The e2e gap** — ten merged slices with no browser test since 2026-07-26.

The honest position on completion, measured 2026-08-14 against the plan's own
phase pricing: **~35% of build effort, ~30% of the road to a dealership using it,
and 0 environments running.** The deepest third — multi-tenancy with forced RLS,
RBAC, integer-cents money math, the CASL/CRTC compliance engine, the AI safety
layer — is done and tested. The broad two-thirds is not.
