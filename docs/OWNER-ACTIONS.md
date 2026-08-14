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

Create a key at console.anthropic.com. It becomes `ANTHROPIC_API_KEY`.

**Unblocks:** the assistant actually thinking. The prompt, the seven tools, both
safety guards and the turn loop are built and tested against a fake model; the
key is the last piece.

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

1. **Carrier edge** — the Twilio webhook and outbound adapter, behind an
   interface, with a fake carrier so it is fully tested with no account. When
   your credentials arrive it is a config change, not a code project.
2. **Model key path** — same shape for Anthropic.
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
