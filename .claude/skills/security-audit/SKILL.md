---
name: security-audit
description: Run a structured security review of the codebase against OWASP Top 10:2025, covering authorization, injection, secrets, configuration, error handling, and logging. Use after building auth, input handling, file uploads, or payment features, before releases, or when the user says "security audit", "security review", or "is this secure".
---

# Security Audit

Review the code the way an attacker reads it. Report findings honestly — a finding
the user dislikes is worth more than a clean report that's wrong.

## Scope

Default: code changed since the last audit entry in `docs/SECURITY.md` plus every
auth/input/upload/payment path. Say what the scope was in the report. If the user
named a scope, use theirs.

## Sweep — organized by OWASP Top 10:2025

1. **A01 Broken Access Control** (includes SSRF): find every endpoint/route/handler;
   verify server-side authz on each; check object-level ownership (can user A read
   record B by changing an ID?); user-supplied URLs fetched by the server; missing
   deny-by-default.
2. **A02 Security Misconfiguration:** debug flags, default credentials, verbose
   errors reaching users, permissive CORS, missing security headers (CSP, HSTS,
   X-Content-Type-Options, frame-ancestors), directory listings, open cloud buckets.
3. **A03 Supply Chain:** run `/deps-check` if not done recently; unpinned CI actions;
   install scripts from untrusted packages.
4. **A04 Crypto Failures:** custom crypto, MD5/SHA-1 for passwords, HTTP anywhere,
   sensitive data unencrypted at rest, secrets in tokens.
5. **A05 Injection:** string-built SQL/NoSQL/shell/LDAP; HTML rendering that bypasses
   auto-escaping (`dangerouslySetInnerHTML`, `v-html`, `|safe`, `innerHTML`); template
   injection; path traversal in file operations.
6. **A06 Insecure Design:** missing rate limits on auth/expensive endpoints,
   enumeration (user exists / doesn't-exist responses), business-logic abuse
   (negative quantities, replayable coupons), missing threat model in docs/SECURITY.md.
7. **A07 Authentication Failures:** weak password rules, missing brute-force
   protection, session tokens in URLs, missing session invalidation on
   logout/password change, JWT alg confusion / unvalidated claims.
8. **A08 Software/Data Integrity:** unsigned/unverified updates or plugins,
   deserialization of untrusted data, CI/CD steps that execute untrusted input.
9. **A09 Logging & Alerting:** auth failures and authz denials not logged; secrets
   or PII in logs; nothing anyone would act on (alerts count, dashboards don't).
10. **A10 Mishandling of Exceptional Conditions:** paths that fail OPEN (access
    granted when a check throws), empty catch blocks around security decisions,
    stack traces to users, resource leaks on error paths.

Plus, always:

- **Secrets sweep:** grep for hardcoded keys/tokens/passwords (`api[_-]?key`,
  `secret`, `password\s*=`, `BEGIN.*PRIVATE KEY`, base64 blobs in config); verify
  `.env*` is gitignored EXCEPT the committed `.env.example` (pattern `.env*` plus
  `!.env.example`); check `git log -p` history if a leak is suspected.
- **LLM features (if any):** model output treated as untrusted; prompt-injection
  exposure wherever untrusted content enters context; tool scopes least-privilege;
  no secrets in system prompts.

## Report

Write findings to `docs/SECURITY.md` (Audit log section, newest on top) and summarize
to the user:

- Per finding: **severity** (critical / high / medium / low) · location
  (`file:line`) · what an attacker can do · recommended fix.
- For critical/high findings, dispatch the **security-auditor** subagent to
  independently verify before reporting — cut anything it refutes.
- Order by severity. State clearly if scope was limited.
- Do NOT auto-fix. Propose fixes; let the user prioritize. Exception: if the user
  already asked you to fix, fix critical/high first, one at a time, with tests.
- If a finding involves a leaked secret: recommend rotation FIRST — removing it
  from code does not un-leak it.
