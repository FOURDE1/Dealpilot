---
name: deps-check
description: Scan project dependencies for known vulnerabilities and supply-chain red flags in any ecosystem (npm, pnpm, pip/uv, cargo, go, composer, etc.). Use when adding a new package, weekly or before releases, or when the user says "check dependencies", "vulnerability scan", "audit packages", or "is this package safe".
---

# Dependency & Supply-Chain Check

## 1. Detect the ecosystem

Look for lockfiles/manifests: `package-lock.json`/`pnpm-lock.yaml`/`yarn.lock`,
`requirements.txt`/`uv.lock`/`poetry.lock`/`pylock.toml`, `Cargo.lock`, `go.sum`,
`composer.lock`, `Gemfile.lock`, `*.csproj`. A repo may have several — check all.

## 2. Run scanners (best available, in order)

- **Cross-ecosystem:** `osv-scanner scan -r .` if installed (recursive, so nested
  lockfiles in monorepos are included; best coverage, low false
  positives). Offer to install it if missing rather than silently skipping.
- **Native:** `npm audit` / `pnpm audit` · `pip-audit` · `cargo audit` (or
  `cargo deny check` if `deny.toml` exists) · `govulncheck ./...` ·
  `composer audit` · `dotnet list package --vulnerable`.
- npm ecosystems: also `npm audit signatures` (registry signatures + provenance).

Record the exact commands in `docs/PROJECT.md` (Dependency vuln scan row) if TBD.

## 3. Hygiene checks (things scanners miss)

- Lockfile committed? CI installs frozen (`npm ci`, `--frozen-lockfile`, `--locked`)?
- Any lockfile `resolved` URLs pointing off the official registry? (lockfile
  injection — treat as an incident, alert the user immediately)
- Install scripts: npm <12 / pnpm <10 without `--ignore-scripts` or an explicit
  allowlist? Flag it.
- CI workflow files: third-party actions pinned to full commit SHAs (not tags)?
- Cooldown: any dependency updated to a version published in the last 48h? Flag it —
  malicious releases are usually caught and pulled within days. Recommend
  Dependabot/Renovate cooldowns (3–7 days) if no update automation exists.

## 4. When ADDING a new package (extra diligence)

- Verify the EXACT name on the registry — one typo installs an attacker's package,
  and AI-hallucinated names get registered by attackers (slopsquatting). Confirm
  publisher, linked repo, download history, last release date.
- Check: does the package need install scripts? Does it have few/no dependencies of
  its own (fewer transitive deps = smaller attack surface)?
- Is it even needed? Prefer the standard library or existing deps for small utilities.
- Present findings to the user BEFORE installing (CLAUDE.md rule: new dependencies
  are a user decision).

## 5. Report

- Vulnerabilities: package · installed version · severity (note whether CVSS 3.1 or
  4.0) · fixed version · whether the vulnerable code path is actually used (if
  determinable — say so honestly if not).
- Recommend the smallest safe upgrade path; call out breaking major bumps.
- Hygiene findings with concrete fixes.
- Log the run (date + summary) in `docs/SESSION_LOG.md`; anything serious goes in
  `docs/SECURITY.md`.
- Do not upgrade anything without the user's go-ahead unless they pre-approved.
