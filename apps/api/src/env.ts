import { z } from 'zod';

/**
 * Environment contract (A-05). Parse, don't validate (CLAUDE.md): the process
 * fails fast at startup on bad config; interior code trusts these types.
 */
const DEV_DATABASE_URL = 'postgresql://dealpilot_app:dealpilot_app_dev@localhost:5434/dealpilot';
const DEV_SECRET = 'dev-only-secret-change-me';
const DEV_AUTH_URL = 'http://localhost:3001';
const DEV_WEB_ORIGIN = 'http://localhost:5173';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().default(DEV_DATABASE_URL),
  BETTER_AUTH_SECRET: z.string().min(16).default(DEV_SECRET),
  BETTER_AUTH_URL: z.string().default(DEV_AUTH_URL),
  /** The web app origin allowed to call this API with credentials (H-03). */
  WEB_ORIGIN: z.string().default(DEV_WEB_ORIGIN),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * In production, every dev fallback is a boot-blocking error — the process must
 * fail fast rather than silently run on localhost defaults (CLAUDE.md;
 * api-security.md §4 A05). A leftover dev value points at the wrong database or
 * serves an http baseURL under Secure cookies, so treat it as unset.
 */
const PROD_REQUIRED: { key: keyof Env; devValue: string }[] = [
  { key: 'DATABASE_URL', devValue: DEV_DATABASE_URL },
  { key: 'BETTER_AUTH_SECRET', devValue: DEV_SECRET },
  { key: 'BETTER_AUTH_URL', devValue: DEV_AUTH_URL },
  { key: 'WEB_ORIGIN', devValue: DEV_WEB_ORIGIN },
];

export function loadEnv(overrides: Partial<Record<keyof Env, string>> = {}): Env {
  const parsed = EnvSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${detail}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    const missing = PROD_REQUIRED.filter((r) => env[r.key] === r.devValue).map((r) => r.key);
    if (missing.length) {
      throw new Error(`These must be set explicitly in production: ${missing.join(', ')}`);
    }
    if (!env.BETTER_AUTH_URL.startsWith('https://')) {
      throw new Error('BETTER_AUTH_URL must be https:// in production');
    }
  }
  return env;
}
