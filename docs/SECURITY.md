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
