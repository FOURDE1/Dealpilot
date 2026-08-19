-- 0048 — TOTP two-factor (F-41, FR-AUTH-006, ADR-006).
--
-- Better Auth's twoFactor plugin schema, expressed as OUR forward migration —
-- same treatment as 0002: the library owns these tables' shape (camelCase,
-- text ids), we own their existence and history. Column names must match what
-- better-auth@1.6.25 generates, verified against the plugin docs on
-- 2026-08-19, or every 2FA call 500s on a missing column.
--
-- Who MUST enrol is not in this file on purpose: "required for owner, GM and
-- admin office" (FR-AUTH-006) is a DOMAIN rule about roles, enforced in the
-- API and the shell — the auth layer only knows whether a user has a secret.

alter table "user" add column "twoFactorEnabled" boolean;

create table "twoFactor" (
  "id" text not null primary key,
  "userId" text not null references "user" ("id") on delete cascade,
  "secret" text not null,
  "backupCodes" text not null,
  "verified" boolean,
  "failedVerificationCount" integer,
  "lockedUntil" timestamptz
);

create index "twoFactor_userId_idx" on "twoFactor" ("userId");

-- Same grants shape as the other Better Auth tables in 0002: the app role
-- reads and writes through the library only.
GRANT SELECT, INSERT, UPDATE, DELETE ON "twoFactor" TO dealpilot_app;
