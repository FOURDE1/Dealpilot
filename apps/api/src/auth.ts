import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import type { Pool } from '@dealpilot/db';
import type { Env } from './env.js';
import { verificationMessage, type Mailer } from './email.js';

/**
 * Better Auth (A-05, ADR-006/D-023): identity + sessions ONLY.
 * Authorization (organizations, memberships, roles, RLS tenancy) lives in OUR
 * domain tables (A-04) — Better Auth's organization plugin is deliberately not
 * used, so there is exactly one source of truth for tenancy. Identity ids are
 * uuids so the future link auth user -> domain users.id is 1:1.
 * Sessions: HTTPS-only secure cookies in production; HttpOnly + SameSite=Lax
 * always (authentication-authorization.md §Sessions).
 */
export function createAuth(env: Env, pool: Pool, mailer: Mailer) {
  return betterAuth({
    database: pool,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    trustedOrigins: [env.WEB_ORIGIN],
    session: {
      // Explicit (A-05.1, D-025 item 3): 7-day sessions, refreshed daily.
      // cookieCache was tried and REJECTED: a cached cookie outlives sign-out,
      // breaking the round-trip test's instant-revocation requirement.
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      /**
       * A-11: enforcement is configuration, not code. The verification mail
       * always goes out; blocking unverified sign-in is opt-in so local test
       * accounts and the SES sandbox never lock anyone out (D-030).
       */
      requireEmailVerification: env.REQUIRE_EMAIL_VERIFICATION,
    },
    emailVerification: {
      sendOnSignUp: true,
      // A failed send must not fail sign-up — the mailer already swallows and
      // logs transport errors and reports a boolean.
      sendVerificationEmail: async ({ user, url }) => {
        await mailer.send(verificationMessage(user.email, url));
      },
    },
    advanced: {
      database: {
        generateId: () => randomUUID(),
      },
      useSecureCookies: env.NODE_ENV === 'production',
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
