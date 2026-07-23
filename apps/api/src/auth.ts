import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import type { Pool } from '@dealpilot/db';
import type { Env } from './env.js';

/**
 * Better Auth (A-05, ADR-006/D-023): identity + sessions ONLY.
 * Authorization (organizations, memberships, roles, RLS tenancy) lives in OUR
 * domain tables (A-04) — Better Auth's organization plugin is deliberately not
 * used, so there is exactly one source of truth for tenancy. Identity ids are
 * uuids so the future link auth user -> domain users.id is 1:1.
 * Sessions: HTTPS-only secure cookies in production; HttpOnly + SameSite=Lax
 * always (authentication-authorization.md §Sessions).
 */
export function createAuth(env: Env, pool: Pool) {
  return betterAuth({
    database: pool,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    trustedOrigins: [env.WEB_ORIGIN],
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
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
