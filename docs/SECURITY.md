# SECURITY.md — Security Log & Standards Reference

> Claude: record audit results, threat notes, and accepted risks here. Never record
> secrets, working exploits against this project, or unpatched vulnerability details
> beyond what's needed to track the fix.

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

## Accepted risks

> Risks reviewed and consciously accepted by the user, with rationale and revisit date.

| Date | Risk | Rationale | Revisit |
| ---- | ---- | --------- | ------- |
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
