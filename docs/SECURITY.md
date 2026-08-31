# SECURITY.md — Security Log & Standards Reference

> Claude: record audit results, threat notes, and accepted risks here. Never record
> secrets, working exploits against this project, or unpatched vulnerability details
> beyond what's needed to track the fix.

## 2026-08-21 — F-61 drip engine: accepted risk on the due-scan definer

`drip_due_enrollments()` (0060) is SECURITY DEFINER and EXECUTE-granted to
`dealpilot_app`, so any request context can invoke it and observe
(organization_id, enrollment_id) uuid pairs across tenants — opaque
identifiers only; RLS makes them unusable for any further read or write.
Accepted for the build phase (same shape as `carrier_resolve_number`,
0036); the fix on file is a dedicated worker DB role at deploy time, when
workers get their own credentials (tracked for the AWS phase, D-061).
Every drip send passes the full f19 compliance gate; the F-61 review
additionally closed a real gap here: drips now originate as 'ai' and are
limited by (and counted against) the per-lead daily frequency cap.

## 2026-08-20 — FR-TEN-006 cost masking shipped

Cross-store cost visibility is now enforced server-side (D-052): masked cost
fields are ABSENT from vehicle payloads (list, read, create, patch) for
callers outside the owning store; view computed per request from org-scoped
memberships (the user-context read path is explicitly org-filtered so a role
in one org cannot unmask another). Persona-tested: salesperson (never),
second-store GM (own store only, both list and single-read), owner (all).

## 2026-08-19 — F-44 production rate limiting shipped

Token buckets (Redis+Lua shared across instances; memory fallback; FAIL-OPEN
with warn — D-048) now guard: intake webhook 30/min per key; auth POSTs
60/min per IP; sign-in 2/min burst 8 per EMAIL (brute-force wall that IP
rotation cannot reset); invitation preview 30/min per IP (token-enumeration
shape). 429 + Retry-After. TRUST_PROXY added for correct client IPs behind
the ALB. Twilio webhooks intentionally unlimited at app level (signed;
retry semantics) — WAF owns that surface in production.

## Baseline for this project

Two layers, both binding:

1. **CLAUDE.md § Security** — the operating baseline for every change (deny-by-default
   authz, parameterized queries, secrets hygiene, fail closed, LLM output as untrusted
   input, `/security-audit` cadence).
2. **The 04-security suite** in the plan — the deep, product-specific design:
   - [authentication-authorization.md](../../kia-tracker-specs/docs/new/04-security/authentication-authorization.md) — Better Auth sessions, MFA, 10-role matrix, memberships
   - [api-security.md](../../kia-tracker-specs/docs/new/04-security/api-security.md) — route auth coverage, rate limiting, webhook signatures, error hygiene
   - [data-protection.md](../../kia-tracker-specs/docs/new/04-security/data-protection.md) — encryption, RLS tenant isolation, retention, residency
   - [security-operations.md](../../kia-tracker-specs/docs/new/04-security/security-operations.md) — secrets management, dependency hygiene, incident response, pen testing

Project-specific hard requirements (from ADR-015 and NFR-SEC/NFR-CMP):

- **Field-level encryption for PII:** SIN, driver's licence number, DOB, income/credit-app
  details, banking/void-cheque data are encrypted with AES-256-GCM envelope encryption
  via **AWS KMS** (per-tenant data keys), with blind HMAC indexes for equality lookup;
  decrypt paths are audited. pgsodium is banned.
- **Tenant isolation:** RLS ENABLED + FORCED on all tenant tables; `USING(true)`
  permanently banned; cross-tenant probe suite runs in CI.
- **Regulatory obligations:** Law 25 (Canadian residency `ca-central-1`, consent,
  automated-decision disclosure s.12.1, breach notification), PIPEDA (sensitive
  credit-app data), CASL/CRTC (consent ledger + expiry, STOP, quiet hours, DNCL,
  ADAD express consent before automated outbound calls), Bill 96 (FR equivalence).
- **Legal review:** deferred by the owner — but **mandatory before the public AI
  launch** (see Accepted risks below). The AI outbound engine must not go live until
  NFR-CMP-005…009 hold.

## Standards this project builds against (current editions, mid-2026)

| Standard | Edition | Use |
| -------- | ------- | --- |
| OWASP Top 10 | **2025** (replaced 2021) | baseline web-risk taxonomy |
| OWASP ASVS | **5.0** (May 2025) | verifiable requirements — L1 minimum, L2 if handling sensitive data |
| OWASP API Security Top 10 | 2023 (still current) | API-specific risks; BOLA is #1 |
| OWASP Top 10 for LLM Apps | 2025 | if the project touches LLMs |
| OWASP Top 10 for Agentic Applications | 2026 | if the project runs AI agents |
| CWE Top 25 | 2025 | weakness classes to prioritize in review |
| CAPEC | v3.9 | attack-pattern catalog for threat modeling |
| CVSS | 4.0 (handle 3.1 too) | vulnerability severity — combine with KEV/EPSS, never base score alone |
| NIST SSDF | SP 800-218 v1.1 (v1.2 draft in progress — adopt when final) | secure development framework |

OWASP Top 10:2025 categories: A01 Broken Access Control (now includes SSRF) ·
A02 Security Misconfiguration · A03 Software Supply Chain Failures ·
A04 Cryptographic Failures · A05 Injection · A06 Insecure Design ·
A07 Authentication Failures · A08 Software or Data Integrity Failures ·
A09 Security Logging & Alerting Failures · A10 Mishandling of Exceptional Conditions.

The LLM and Agentic lists apply to this project: the AI lead-automation layer converses
with untrusted members of the public over SMS/voice — prompt injection via lead content
is an expected input, and every model output is untrusted.

Per-topic implementation reference: OWASP Cheat Sheet Series
(https://cheatsheetseries.owasp.org/).

## Threat model

- **Assets worth protecting:** customer PII incl. credit applications (SIN, licence,
  DOB, income, banking), deal/financial records and commission data, the consent
  ledger (CASL due-diligence defense), per-tenant business data (cross-tenant leak =
  worst case), platform/provider credentials (AWS, Twilio, Resend, Stripe,
  Anthropic keys).
- **Entry points / trust boundaries:** public SPA + `/api/v1`; auth endpoints; lead
  intake webhooks (JSON, ADF/XML, inbound email — attacker-controllable content);
  provider webhooks (Twilio, Resend, Stripe, Meta); file uploads (photos, documents);
  platform admin console; the AI conversation channel (SMS/voice — prompt injection
  surface); outbound webhook receivers.
- **Who attacks this and why:** opportunistic scanners and credential stuffers;
  malicious or curious tenant users probing cross-tenant access; prompt-injection
  attempts through lead messages; spammers abusing intake endpoints; ex-employees
  with stale access.
- **Blast radius of full compromise:** multi-tenant PII breach → Law 25 notification
  to the Commission d'accès à l'information + affected individuals, CASL exposure,
  loss of every dealership customer's trust; financial-record tampering across tenants.

## Audit log

> One entry per `/security-audit` run, newest on top:
> date, scope, findings (severity · location · status), decisions.

<!-- Entries begin below. -->

### 2026-08-31 — F-74 e2e isolation: the suite's database, the runner, the bootstrap

**Scope:** `scripts/e2e.mjs`; the guarded `[dbname]` positional on `reset`
and `platform-grant` in `packages/db/src/cli.ts` with
`disposableDatabaseUrl()` / `ensureDatabase()`; the two vitest guards under
`apps/web/e2e/`; the console journey and its `support/platform-staff.ts`
bootstrap; the `e2e:` job of `ci.yml`. No route, no table, no policy, no
column.

- **The dev database is unreachable from the e2e path by construction, not
  by care.** Every path that can drop a schema or mint a staffer routes the
  database NAME through `/^[a-z][a-z0-9_]*_test$/` before a connection
  exists; the name is a code literal, never an env var, so a shell whose
  `DB_ADMIN_URL` points at dev still cannot aim a reset or a grant at it.
  `DB_RESET_CONFIRM` appears nowhere on the path (guarded, including the
  `e2e:` job block of `ci.yml`). The one literal ending `/dealpilot` is the
  host-shaped maintenance base — `CREATE DATABASE` only — exempted by name
  AND by owner credentials and asserted to occur exactly once; the API's own
  `DATABASE_URL` is asserted to end `_test` before the process exists.
  Adversarial mutations, each red now: the API URL pointed at `dealpilot` by
  literal; the maintenance default renamed to a staging database; a second
  smuggled `/dealpilot` literal; a whitespace-bearing template ending
  `/dealpilot` in a spec. The first three were GREEN before the review — the
  scan stopped at the first space inside `${…}` and never examined the tail
  — which is the reason the guard is template-aware and its count is
  `toBe(1)`, not `<= 1` ✔
- **`CREATE DATABASE` interpolates an identifier.** The whitelist is the
  rule itself (bare lowercase identifier ending `_test`), and the maintenance
  host must be local (`localhost`, `127.0.0.1`, `db`), mirroring `reset()`'s
  own refusal, so a hostile `DB_ADMIN_URL` cannot make a remote host receive
  the statement ✔
- **The bootstrap one-shot is owned by exactly one spec** through the shipped
  `platform-grant` verb with the `_test` positional; the guard strips
  comments before matching, so prose cannot stand in for the import in either
  direction. The dev database's one-shot remains unspent — `platform_staff =
  0` before and after every run of this slice ✔
- **The runner never adopts a server** on its ports, takes a pid lock so a
  second runner cannot drop the schema under the first one's API, and on a
  pid-only SIGINT/SIGTERM kills its children before exiting. The API log it
  writes carries pino's redaction of `authorization` and `cookie` headers and
  is uploaded as a CI artifact on failure only ✔
- **Secrets:** the e2e API's `BETTER_AUTH_SECRET` is generated per run from
  `node:crypto`; no string in the repo looks like a secret. The e2e
  database's app-role password is the dev-only literal the `checks` job
  already carries ✔

**Accepted (see below):** the e2e API shares Redis with the dev stack; a
hand-started worker would consume e2e jobs.

### 2026-08-30 — F-73 per-tenant usage, tenant snapshot, job inspector / DLQ (§6, §9)

**Scope:** `GET /api/v1/admin/tenants/:id/usage`, `GET
/api/v1/admin/tenants/:id/snapshot`, `GET /api/v1/admin/queues`, `GET
/api/v1/admin/queues/:name/dlq`, `POST
/api/v1/admin/queues/:name/dlq/retry`, migration 0069's three definers
(`admin_tenant_usage`, `admin_tenant_snapshot`,
`admin_record_queue_retry`) and its widened
`platform_audit_events_event_check`, the Redis reader
(`apps/api/src/queue-inspector.ts`), the two route files
(`apps/api/src/f73-usage-routes.ts`, `apps/api/src/f73-queue-routes.ts`),
the queue catalogue in `packages/contracts/src/queues.ts`, the queue-name
vocabulary and the F-73 block in `packages/schemas/src/platform.ts`, and
the console pages (`tenant-usage-page.tsx`, `queues-page.tsx`,
`retry-jobs-dialog.tsx`).

- **A01 access control** — two new capabilities, `queues:read` and
  `queues:retry`, both `[platform_super_admin, platform_support]`, each
  spent by a literal `requirePlatform(request, '…')` the drift guard
  reads as written; usage and snapshot reuse `tenants:read` rather than
  minting a capability with no refusal of its own. All three definers
  re-assert the actor's role themselves through `platform_assert_actor`,
  so a route mistake cannot widen what the database allows, and all
  three run on the bare pool — a platform staffer never holds tenant RLS
  context. `platform-drift.test.ts` now also asserts the POSITIVE
  direction, that `dealpilot_app` may EXECUTE each of the three by exact
  signature: a definer shipped with its REVOKE and without its GRANT
  previously passed every guard and failed at the first support click.
  F-73 adds no RLS policy, no table and no column. All five routes are
  refused with 409 during a live support session —
  `ADMIN_ALLOWED_DURING` is unchanged ✔
- **A02 cryptographic failures / A01 data exposure** — the snapshot's
  intake-key projection excludes `token` and `secret` BY NAME in the
  definer, mutation-tested (adding either back turns the guard red), and
  a second assertion proves the serialized response body contains
  neither the created key's token nor its secret ✔
- **A03 injection** — `p_period` is parsed by Zod before the database is
  asked and is never interpolated into SQL; the queue name is validated
  against `QueueName` and answers 404 for anything else, so the definer's
  own shape belt (`^[a-z][a-z0-9-]{2,40}$`) is only ever reached by a
  code bug; the DLQ cursor is base64url JSON parsed through a Zod schema
  whose position field is BOUNDED in the codec, so a forged offset is a
  400 before any Redis command is issued, and a cursor minted on another
  queue or under another tenant filter is a 400 rather than a page of
  rows nobody asked for ✔
- **A04 insecure design — the one place this slice can hurt someone.**
  Retrying a failed job on `deferred-send`, `assistant-turn`,
  `first-touch` or `drip-tick` re-enters the send path and can put a
  SECOND SMS in front of a real dealer customer; `provider_ref` is
  written only after the carrier answers, so a carrier timeout leaves a
  message delivered and unmarked. That is not mitigated by a comment: the
  `replay` classification is DERIVED by
  `apps/workers/src/queue-replay.test.ts` from which worker files reach
  `deliverMessage(`/`sendMessage(`, every `idempotent` claim cites a
  literal that must still exist in the file it names, the route demands
  the queue name typed back for ANY retry on an `at_least_once` queue
  (n ≥ 1, not n > 1), `job_ids` is capped at 20, the reason is ten
  characters after trimming, and `Queue.retryJobs()` — no id list, no
  filter, every tenant's failures at once — is never called. Accepted as
  a named risk below, not claimed as safe ✔
- **A01 excessive data exposure (the DLQ's payloads)** — a failed job is
  projected through a per-queue ALLOW-list, never a payload viewer and
  never a redaction denylist: `packages/contracts/src/queue-catalogue.test.ts`
  requires every listed key to exist in that queue's own Zod shape and to
  unwrap to a uuid, a number or an enum, refuses `'body'` by name, and
  refuses any scoping field called `tenant_id`. `DeferredSendJob.body` is
  up to 1600 characters of a real customer's SMS and never leaves the
  worker. At runtime the projection additionally drops any value that is
  not a string or a number, so a payload written by an older deploy
  cannot render an object into the console. `failed_reason` and
  `first_stack_line` are the one surface an allow-list structurally
  cannot cover — free text from whatever threw, routinely quoting a
  person — so both pass through `redactFailedReason`, which strips `+1`
  E.164 numbers and e-mail addresses BEFORE truncation (500 / 300
  characters; allow-listed values 120) ✔
- **A09 logging** — the one mutation writes an immutable
  `platform_audit_events` row (`queue.retry_requested`, the actor, the
  reason, and in `changes` the queue, the full requested id list and the
  distinct organizations those ids named) BEFORE any job is touched,
  because Redis and Postgres cannot commit together and §9 forbids an
  unaudited act; the event is named for the request rather than the
  result precisely because no outcome is known at that moment. Both
  orderings are mutation-tested. No row is written when no queue is
  configured — nothing was attempted. A WARN line with the stable token
  `platform_queue_retry_result` carries the same fields whatever
  happened, so a drain does not have to know which shape the line took.
  The three read routes write no audit event: §12 audits mutations and
  every admin request already writes the `platform_access` line ✔
- **A05 security misconfiguration / availability** — the inspector opens
  its OWN Redis connection (`maxRetriesPerRequest: 2`,
  `enableOfflineQueue: false`, `connectTimeout: 1500`, plus
  `skipMetasUpdate: true` so a console page that only looks cannot write
  to every queue it looked at), attaches an `'error'` listener to every
  handle before issuing any command, bounds every read at 1500 ms with
  the `.catch` on the READ rather than on the race, and closes each
  cached handle in its own try/catch with a `disconnect()` fallback. An
  absent or unreachable Redis is reported as `queue_state` with `counts:
  null` inside a 200 — never zeros, never a bare empty list, never a 503
  widening the shared `errorResponses` ✔
- **Tenant isolation** — a queue whose payload carries no
  `organization_id` REFUSES an `?organization_id=` filter with 422
  `queue_not_org_scoped` rather than answering an empty page that would
  read as "this tenant has no failures"; four of the ten queues are in
  that position and `org_scoped` is derived from the payload shape, not
  hand-typed ✔

**Accepted (see below):** a retry on an `at_least_once` queue can send a
real customer a second SMS; and that retry is invisible to the dealer
whose customer received it, because F-73's only mutation writes
`platform_audit_events` alone. Both bullets are already recorded in
*Accepted risks*.

### 2026-08-30 — F-72 announcements and platform kill switches (§5.3, §8)

**Scope:** `GET /api/v1/admin/platform-settings`, `POST
/api/v1/admin/platform-settings/:setting_key`, `POST|GET
/api/v1/admin/announcements[/:id][/end]`, the tenant-side `GET
/api/v1/announcements` and `POST /api/v1/announcements/:id/dismiss`, the
0068 tables, definers and triggers, the switch reader
(`apps/api/src/platform-settings.ts`), the gate additions in
`packages/core/src/compliance-gate.ts`, the wire belt in
`apps/api/src/f30-deliver.ts`, the fan-out worker
(`apps/workers/src/announcement-fanout.ts`) and the two
`ADMIN_ALLOWED_DURING` entries in `apps/api/src/impersonation.ts`.

- **A01 access control** — the app role may only SELECT
  `platform_settings` and holds NO grant at all on `platform_announcements`
  or `announcement_dismissals`, so every path runs through a definer;
  `admin_set_platform_setting` asserts `platform_super_admin` and
  `admin_publish_announcement` re-checks the severity/role rule the route
  already asked for, so a route mistake cannot widen what the database
  allows; the tenant feed and the dismissal take NO user argument (the
  person is the `app.user_id` GUC) and carry `impersonation_scope_ok`, and
  the dismissal route is refused in BOTH impersonation modes so a staffer
  can never silence a dealer's notice in the dealer's name ✔
- **A04 insecure design** — the kill switch fails CLOSED by construction:
  no `try`/`catch` around the read, no default-false, and a key with no
  row reads as ON, so a database that cannot answer "is sending paused?"
  refuses the send instead of guessing; both checks run FIRST in
  `evaluateSend`, and a second belt at the carrier handoff refuses at the
  wire with `platform_paused` for any future path that reaches it ✔
- **A09 logging** — a flip writes an immutable `platform_audit_events` row
  (`settings.flipped`, actor, reason, `{from,to}`) and a WARN line with
  the stable token `platform_killswitch_flipped`; publishing and ending
  write `announcement.published` / `announcement.ended`. The register is
  forensic: seven INSERT sites across the migrations (0065 ×2, 0067 ×2 and
  this slice's three; 0067 replaces both 0065 bodies, so five write on the
  live schema) and no product reader, so the console banner and the log
  line — not the table — are what an operator sees ✔
- **A10 SSRF** — `status_incident_url` is typed by a publisher, stored
  behind `CHECK (... LIKE 'https://%' ...)`, never fetched by the server,
  and rendered only as an anchor with `target="_blank" rel="noreferrer"` ✔

**Accepted (see below):** email is ungated; propagation is a five-second
TTL rather than an invalidation channel; an AI kill stops the send, not
the model spend; `webhook_delivery_pause` stays undeclared.

### 2026-08-27 — F-71 impersonation with audit (support sessions)

**Scope:** `POST/GET/DELETE /api/v1/admin/impersonation-sessions[/:id]`,
`GET /api/v1/admin/tenants/:id/members`, `GET /api/v1/support-access`, the
impersonation gate (`apps/api/src/impersonation.ts`), the 0067 definers,
policies and trigger, the scope GUC in `packages/db`, `recordEvent`,
`requirePermission`.

- **A01 access control** — a session is a register row on the STAFFER's own
  Better Auth session (no target session, no cookie change); the gate
  re-proves standing on every request (staff active IN A ROLE THAT COULD
  OPEN THIS MODE — a demotion ends a full session — tenant with standing,
  target still a member, TTL) and closes a row that lost it; the console
  is closed during a session but for the probe and the End; two routes and
  ten permissions are refused in every mode; read-only refuses every
  mutating verb. The tenancy boundary is the DATABASE's: the scope GUC
  narrows the user-keyed policies and `has_permission` to one
  organization (proved with the raw predicates as the app role). ✔
- **A07 auth** — the auth mount is public and never impersonates: the
  staffer's credentials act on the staffer (asserted); the target's
  password / 2FA / sessions are unreachable by construction. Sign-out,
  staff revocation, suspension and membership loss all end the session
  (trigger + explicit closes + per-request re-proof). ✔
- **A09 logging** — every request under a session writes an immutable
  trail row (method, route, URL, status), refusals included; every mutation
  carries `impersonation_id` with `actor_type='platform'` and the
  impersonated user as actor — attributed to both; pino carries ids and
  the routed URL, never the reason. ✔
- **A10** — `impersonation_identity` fails closed (unknown session → nobody;
  a closed row → 403 once); the trail write failing is logged, never hidden
  behind the response. ✔

**Accepted (see below):** the request trail stores URLs with their query;
the owner email is sent after commit; no realtime for the impersonator;
full-mode writes fire automations.

### 2026-08-27 — F-70 tenant provisioning (the birth of a tenant from the platform side)

**Scope:** `POST /api/v1/admin/tenants`, `POST /api/v1/admin/tenants/:id/owner-invitation`,
the 0066 definers `admin_provision_tenant` / `admin_reissue_owner_invitation`,
the shared invitation-token module.

- **A01 access control** — both endpoints start with `tenants:create` (super
  admin only); both definers re-check the actor (PA001 → 404, PA009 → 403);
  the route file holds no tenant helper and no tenant-role literal (guard);
  the platform-drift guard now owns the list of admin route files and fails
  on one it does not scan. Every organization_id / store_id the definer
  writes comes from RETURNING — an id smuggled into the payload is ignored
  (mutation-tested). ✔
- **A04 crypto** — the owner-seat token is 32 random bytes, SHA-256 only in
  the database, ONE hashing module for both issuers (a lockstep test greps
  it); the route logs ids and the send outcome, never the token. The dev
  `log` mail transport writes the message BODY — the link included — to pino
  on purpose (email.ts, so the link is reachable locally); it is never the
  production transport, and F-12's invitations have the same property. ✔
- **A05 injection** — jsonb parameters throughout; the seeds are built from
  constants, never from the request body; the slug/code/email rules are the
  self-serve Zod rules (reserved names included). ✔
- **A06 design** — idempotent on slug with the existing id in the envelope;
  a lost race is converted inside the function; every refusal is atomic
  (timezone, plan, duplicate code, empty seeds — nothing written). ✔
- **A10** — `PA014` (empty stores/seeds) is a caller bug deliberately left as
  a 500; the definer refuses rather than births an organization nobody can
  enter. ✔

**Accepted (see below):** the send happens after commit — a crash between
them loses the email, not the tenant (the detail shows the open seat and the
reissue endpoint is the recovery); the seeds trust the API's constants the
same way F-01 trusts `seedPermissions` (the lockstep test keeps both births
equal).

### 2026-08-26 — F-69 platform console, slice 1 (the platform/tenant boundary)

**Scope:** `/api/v1/admin/*`, the platform gate, the 0065 SECURITY DEFINER
surface, the tenant lifecycle hooks (403/402/410), the auth mount.

- **A01 access control** — non-staff receive 404 on every admin path (never
  403: the console does not exist for them); each handler starts with a
  capability, each definer re-checks the actor; platform staff never hold
  tenant context (bare pool + definers; a guard greps the route file). ✔
- **A07 auth** — MFA enrolment mandatory for staff regardless of REQUIRE_MFA;
  `trustDevice` refused at the auth mount for every account (O-1); console
  sessions expire after 12 h from `"session"."createdAt"` (O-2). ✔
- **A01/A04 tenancy** — suspension deletes the tenant's members' sessions in
  the transition's transaction; `read_only` refuses mutating verbs with 402;
  a suspended tenant is invisible to implicit org resolution. Found and
  fixed while testing: a `withUser` list route let a suspended owner read
  leads after re-sign-in → a preHandler gate for every request that names an
  organization. ✔
- **A09 logging** — every admin request logs actor, role, route; 402s join
  the refused log; the staff register is append-only by trigger AND grant. ✔
- **A10** — definers fail closed (PA001 → 404); the bootstrap grant closes
  itself once a super admin exists. ✔

**Accepted (see below):** definer owner must bypass FORCE RLS on RDS;
session revocation is per person (multi-org staff re-sign-in); reads of rows
a suspended tenant's member already holds by id remain possible after
re-sign-in until a mutation-coverage guard lands.

### 2026-08-20 — F-41..F-51 surface (presence, rate limits, cost masking, notifications, reactivation, connectors, revocation, business hours)

Scope: everything since the F-38/40 entry — f42 cascade + staff-schedule routes,
f43 presence, f44/rate-limit.ts, f45 distribution, f47 notifications, f48
reactivation (via f30 inbound), f49 connectors (routes + resolveConnector +
core readPath), f50 revocation proof, F-51 store business-hours PATCH, and the
connectors web screen. Checked by reading code and re-running the relevant
suites; no live probe beyond the existing behavioural tests.

**No critical or high findings.** What held under attack-reading:

- Intake webhook: constant-time signature compare (`timingSafeEqual`), HMAC over
  `${ts}.${raw}` with a ±5-min window (replay-bounded), uniform 401 for
  unknown-token vs bad-signature, 256KB body cap, per-key rate limit.
- Carrier inbound (reactivation's trigger): Twilio signature verified
  FAIL-CLOSED (403 + warn log) before any row is touched.
- Connectors: CRUD behind intake_key:manage, list behind membership; PATCH uses
  the house allow-list-at-the-sink pattern; delete refuses while an active
  intake key references the connector (409). `readPath` is read-only walking —
  no assignment, so tenant-authored paths cannot pollute prototypes.
- Cost masking: `vehicle:read_costs` resolved in SQL from the matrix — the
  server never sends masked figures for the client to hide.
- Rate limiter: fails OPEN by design (D-048) but warn-logs every pass-through;
  authn/signature/consent gates all remain fail-closed.
- Notifications: self-scoped under withUser + 0051 self-only policies; foreign
  ids are indistinguishable from absent (404 either way).
- Secrets sweep clean; `.env*` ignored with `!.env.example`.

Low / accepted:

- **low** · f49-connector-routes.ts POST — a duplicate `source_key` in the same
  org surfaces as a raw unique-violation 500 instead of a 409. Same-org only
  (RLS), no leak; cosmetic robustness. Proposed: catch 23505 → 409.
- **low** · f49 DELETE — TOCTOU between the in-use check and the delete: a key
  minted in the same instant could reference a just-deleted connector and fall
  back to website_form's mapping. Soft reference by design; window is
  milliseconds; consequence is a mapping fallback, not access.
- **info** · core readPath resolves inherited properties (`constructor`,
  `toString`) — read-only, config is already privilege-gated; hardening would
  be an own-property guard.
- **info** · f49 POST checks the reserved-key collision before the permission
  check, so a plain member sees 422 vs 403 ordering; built-in keys are public
  product vocabulary, nothing learned.

### 2026-08-19 — F-38/F-39/F-40 surface (appointments, scoring, assignment)

**Scope:** the three route files, both core engines, migrations 0044–0046, the
three new web screens, plus their trust boundaries (permissions.ts, f01
helpers, db wrappers, the app.ts error handler). Two independent passes — the
author's and the security-auditor subagent's — reconciled; the subagent also
listed eleven attempted-and-refuted attacks (cross-tenant IDOR via body ids,
SET-key injection, jsonb/array injection, tenant-create bypass, privilege
escalation to automation config, XSS in all three screens, double-cancel,
cursor manipulation, score/priority abuse, wrong-org writes, list DoS).

| Sev | Finding | Location | Status |
| --- | ------- | -------- | ------ |
| MED | `scoreOnCreate` fallback is illusory: a PG error poisons the shared txn (25P02), so the catch's own fallback writes ALSO throw and lead creation fails — the exact scenario the fallback targets. Also wrote no log. | f39-scoring-routes.ts | **fixed same day** (savepoint + warn log) |
| MED | Authz denials, cross-tenant 404 probes and validation failures return to the client with no server-side log; recordEvent fires only on success. CLAUDE.md baseline requires logging them. | app.ts error handler | **fixed same day** (structured warn on 401/403, info on 422) |
| LOW (latent) | Dynamic `SET ${key}` in the three PATCH routes is safe only because the Zod schemas are strictObject — the invariant lives three packages from the sink; one `.passthrough()` refactor away from identifier injection. | f38/f39/f40 PATCH | **fixed same day** (local column allowlist at each sink) |
| LOW | `active_count` correlated subquery on the intake ACK path has no supporting index (no index on leads.assigned_to); O(members × leads) on a p99<1s budget. | f40 autoAssignLead | **fixed same day** (0047 partial index) |
| LOW | F-40 rule writes accept member uuids (`included/excluded/source_mappings`) without membership validation — runtime-inert (engine intersects with the real roster) but a rule can silently reference nobody. | f40 create/update | **fixed 2026-08-19** (`assertMemberUuids` on POST+PATCH: 422 `unknown_member` naming each ghost; RLS scope makes cross-tenant ids ghosts by construction — tested with a rival org's real user id) |
| LOW | Appointment status transitions unconstrained: completed/no_show can be flipped back to booked (intra-tenant, lead:update-gated). | f38 PATCH | **fixed 2026-08-19** (transition table: happened never re-becomes scheduled; completed↔no_show may correct each other; 'cancelled' was already schema-excluded from PATCH) |
| INFO | Automation config (rules incl. exclusion lists, capacities) and the appointment board are readable by every active member — member_read by design; writes stay owner/GM. Role-scoped READ is inexpressible in the current permission catalogue. | 0044–0046 policies | accepted (below) |

**Clean:** secrets sweep on all new files; `.env*`/`!.env.example` gitignore;
parameterized values throughout; React escaping holds on all three screens.

## Accepted risks

- **2026-08-31 (F-74) — the e2e API shares Redis with the dev stack.** A
  logical database index (`/1`) was rejected because the BullMQ layer builds
  its connections from hostname+port and DROPS the URL pathname while
  presence/realtime honour it — `/1` would split queues from pub/sub and look
  like isolation (D-075). So with `REDIS_URL` set, a job the e2e API enqueues
  would be consumed by any worker process on the same Redis. Accepted
  because `apps/workers` has no dev script — `pnpm dev` never starts one — so
  the exposure needs a hand-run `pnpm --filter @dealpilot/workers start`, and
  because the runner prints the Redis it uses on its first line. Revisit if a
  worker ever joins `pnpm dev`.
- **2026-08-30 (F-73) — retrying a failed job on an `at_least_once` queue
  sends a second SMS to a real customer.** `deferred-send`, `assistant-turn`,
  `first-touch` and `drip-tick` all stamp `provider_ref` only AFTER the carrier
  answers, so a carrier timeout leaves a message DELIVERED with a null ref —
  one of the likeliest reasons the job is in the dead-letter queue at all — and
  `runDeferredSend` re-runs the whole compliance gate and calls `sendMessage`
  again with no `provider_ref`, `send_decision_id` or job-level dedupe anywhere
  on the path. What is proven is that the gate is not bypassed; what is NOT
  true is that no duplicate is sent. Controls: the `replay` classification with
  `apps/workers/src/queue-replay.test.ts`'s evidence registry holding every
  `idempotent` claim to a literal in its worker file, the queue name typed back
  before ANY retry (n >= 1, not n > 1 — under CASL one duplicated text is the
  harm), the 20-id cap, a reason of ten characters, and one immutable
  `platform_audit_events` row per request filed BEFORE the first job is
  touched. *Un-cut: the day those workers carry a per-job dedupe key.*
- **2026-08-30 (F-73) — a DLQ retry is invisible to the dealer whose customer
  received the message twice.** §12 makes platform-actor events visible to the
  tenant, and F-73's only mutation writes `platform_audit_events` alone: no
  `activity_events` row, because a retry names a queue and a list of job ids
  rather than one owning organization, and four of the ten queues carry no
  organization at all. So the dealer has no surface on which the second SMS
  appears as a platform act. Controls: the confirm gate, the 20-id cap, and the
  immutable platform register — which does record the distinct organizations
  the requested ids named, read from the payloads before the row is written.
  *Un-cut: the day a DLQ retry can name one owning tenant — the same absence
  that made it write no `activity_events` row.*
- **2026-08-26 (F-69) — SECURITY DEFINER owner must bypass FORCE RLS.** Every
  definer (has_permission, intake_resolve, invitation_accept, the 0065
  console surface, the drip/task scans) reads tenant tables as its owner;
  FORCE RLS applies to owners, so the migration role must be a superuser
  (local) or hold BYPASSRLS (RDS: `ALTER ROLE <migration role> BYPASSRLS`).
  `packages/db/src/definer-owner.test.ts` fails the suite otherwise.
  Rejected alternative: `set_config('app.org_id', …, true)` inside the
  functions — transaction-scoped, it would hand the API tenant context.
- **2026-08-26 (F-69) — suspension revokes sessions per PERSON (O-6).** A
  staffer who spans organizations loses their session everywhere and signs
  in again; the other organizations keep working. Realtime sockets live
  until their next session recheck.
- **2026-08-27 (F-71) — platform staff hold tenant context ONLY inside a
  support session.** The F-69 sentence "platform staff never receive tenant
  RLS context" now reads: never outside a live, audited, time-boxed
  impersonation bound to their own session, scoped by the database to one
  organization, with every request logged and every mutation attributed to
  both people. The admin route files still never open tenant context (the
  drift guard); the swap happens in one gate.
- **2026-08-27 (F-71) — the request trail stores the URL with its query
  string** (`impersonation_requests`, platform-only, no app grant,
  immutable). A query can carry a search term; the trail exists to show
  exactly what support looked at (§7 "every request"), and the table is
  retained with the audit trail.
- **2026-08-27 (F-71) — full-mode writes fire the tenant's automations** (a
  lead created by support is assigned, first-touched, notified as any
  other). Mitigations: read-only by default, full mode is a super admin's
  alone, the blocked-permission list, the trail. Suppression is deferred.
- **2026-08-27 (F-70) — the owner invitation email is sent after commit.** A
  crash between the definer's commit and the send loses the email, not the
  tenant: the console's `owner_invitation` fact and the reissue endpoint are
  the recovery, and the send outcome is logged (F-12 parity), not audited.
- **2026-08-27 (F-70) — seeds arrive as a jsonb parameter.** The definer
  trusts the API for catalogue content — the trust F-01 already extends to
  `seedPermissions`; `f70-provisioning.test.ts` proves the two births equal
  row for row, so a drift between them fails the suite.
- **2026-08-26 (F-69) — by-id reads under withUser after re-sign-in.** A
  suspended tenant's member can still GET a record they hold by id (no
  organization named, no membership gate) until the mutation/membership
  coverage guard lands; every list and every mutation is closed.
- **2026-08-30 (F-72) — email (SES) is a fourth outbound surface that no
  kill switch covers.** `mailer.send(` has EIGHT call sites: `auth.ts:63`,
  `f11-dispatch-routes.ts:257`, `:456`, `:683`,
  `f12-invitation-routes.ts:83`, `f70-provisioning-routes.ts:124`, `:159`,
  `f71-impersonation-routes.ts:69`. Five are credential paths — sign-up
  verification (`auth.ts:63`), member and owner invitations (`f12:83`,
  `f70:124`, `:159`) and the support-access notice (`f71:69`) — that a
  locked-out operator needs during the very incident a switch is for.
  `f11:257` and `:456` are the driver-company dispatch request, an
  operational notice to a third-party vendor that is neither; only
  `f11-dispatch-routes.ts:683` (`customerEtaMessage`) is customer-facing,
  and it is the named next step. `Mailer.send` returns a
  bare boolean today with no decision row and no refusal vocabulary, so a
  gate would be indistinguishable from an SES failure: giving email a
  switch is a slice, not a line.
- **2026-08-30 (F-72) — a flipped switch reaches other processes within
  five seconds, not instantly.** The guarantee is a per-process TTL
  (`KILL_SWITCH_TTL_MS = 5000`), not an invalidation channel, because
  `REDIS_URL` is optional in `apps/api/src/env.ts` and a pub/sub broadcast
  would be a guarantee that is silently not one on a machine without
  Redis. The flipping process obeys immediately
  (`resetKillSwitchCache()`), the console reads uncached through
  `admin_list_platform_settings()`, and the screen prints the number
  rather than implying the flip is instantaneous. The failure direction is
  bounded: a stale snapshot can only be up to five seconds old, and it can
  never be stale in the OFF direction on error — an unreadable switch
  refuses the send.
- **2026-08-30 (F-72) — the AI kill switch stops the SEND, not the model
  spend.** `ai_outbound_killswitch` refuses at `evaluateSend` when
  `originator === 'ai'`; `runTurn` still calls the model and still spends
  tokens. The deployment-level `AI_TRANSPORT=off` remains the spend
  switch, and the two are deliberately separate: an incident that requires
  silence does not require abandoning drafts in progress.
- **2026-08-30 (F-72) — `webhook_delivery_pause` is not declared.** §5.3
  names it, and there is no outbound webhook deliverer in this codebase to
  stop (`apps/api/src/carrier.ts:198` is the only `fetch(` in server
  source; the F-49 connectors are inbound mappings). A switch that gates
  nothing is a promise the console cannot keep. Un-cut condition, recorded
  in 0068: one forward CHECK swap on `platform_settings.setting_key` plus
  one gate line, the day a deliverer lands.

> Risks reviewed and consciously accepted by the user, with rationale and revisit date.

| Date | Risk | Rationale | Revisit |
| ---- | ---- | --------- | ------- |
| 2026-08-19 | Any active member can READ automation config (scoring/assignment rules, exclusion lists, caps) and the whole appointment board | Matches the codebase's member_read convention; writes stay owner/GM (organization:update). The permission catalogue has no per-feature read grants, so role-scoped reads are currently inexpressible. | When the permission catalogue next grows (FR-AUTH-005 row-level visibility work) |
| 2026-07-23 | Formal legal review (Law 25 / PIPEDA / CASL / Bill 96 counsel sign-off) deferred | Owner decision — prioritize the build; compliance engine is designed in from day one per the ADRs | **Mandatory before public AI launch** — the AI outbound engine does not go live without it |

---

## Audit — file upload and tenant-supplied content (2026-07-26, AHMAD)

Triggered by CLAUDE.md's rule to audit after upload work. Two upload paths
shipped this session: scanned documents (F-13c) and brand assets (F-14b), plus a
route that serves tenant-supplied bytes from the application's own origin.

### The one that mattered: stored XSS via a brand logo

An SVG is a document that can carry script. A tenant uploads their logo; the app
serves it from its own origin; if a browser ever treats it as a document rather
than an image, that script runs with the application's origin — in **every**
tenant's header, since the same deployment serves everyone.

Mitigated in `GET /api/v1/branding/assets/:slot`:
`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`,
`X-Content-Type-Options: nosniff`, and an explicit content type. `sandbox` strips
script even if the response is opened directly in a tab.

**The residual risk is on the client, and is documented rather than mitigated in
code:** these headers protect the asset as a *resource*. Inlining the SVG into
the DOM (`dangerouslySetInnerHTML`, `<svg>{...}</svg>`) bypasses every one of
them. The contract note tells HUSSEIN to render brand assets with `<img src>`
and never inline them. That is a convention, not an enforcement — if this
codebase grows an inline-SVG helper, this is the reason it must not be pointed
at tenant assets.

### Fixed here: buffering an upload the route was always going to refuse

The raw-body parser accepted 20 MB for every binary route, including brand
assets whose largest slot is 1 MB. An authenticated caller could make the
process hold 19 MB per concurrent request that was certain to be rejected. The
branding upload now carries a route-level `bodyLimit` at the largest slot, so
Fastify stops reading there. Outcome was a 413 either way; the difference is
memory.

### Checked and found sound

- **Storage keys are server-built** from ids the server already trusts, never
  from a request, and the local driver additionally refuses a resolved path
  outside its root. The traversal check cannot fire today; it stays because the
  day a key is built from user input, "cannot" becomes "did not".
- **Tenant isolation on every branding route.** Naming another organisation's
  `organization_id` is a 404 — membership is checked inside the tenant
  transaction, not by whether the caller could type an id. Asserted for the
  published read, the draft read, PUT, publish, and both asset routes.
- **Content-type allowlists are per-purpose**, not shared: a signed contract may
  not be an SVG and a logo may not be a PDF. One shared list would have
  permitted both.
- **`Cache-Control: private`** on assets — a shared cache must never be able to
  hand one dealership's logo to another.
- **Content-addressed keys**: re-uploading identical bytes is idempotent, and a
  corrected scan lands beside the original rather than overwriting evidence.
- **Document integrity**: every read recomputes the SHA-256 and refuses to serve
  bytes that no longer match, so an altered contract is refused rather than
  laundered into evidence.

### Accepted, with reasons

- **No image dimension or EXIF validation.** §2 wants max 512×160 logos and EXIF
  stripped from the login background; both need `sharp`, a new dependency, which
  is the owner's decision. Today the size ceiling and content-type allowlist are
  the whole check. A wrongly-sized logo is a cosmetic problem; the EXIF gap
  means a login background could carry the photographer's GPS coordinates, which
  is worth closing before that field is used in anger.
- **No rate limit on upload endpoints.** They require a session and are bounded
  per request; a per-tenant quota belongs with the billing work.
- **The local storage driver is dev/CI only.** `loadEnv` refuses to boot
  production on it, because two Fargate tasks with their own disks would accept
  a signed contract and lose it.
