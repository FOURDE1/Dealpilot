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

  // --- transactional email (A-11, SES per D-029) ---------------------------
  /** ca-central-1 keeps mail inside the Canadian residency envelope (D-002). */
  AWS_REGION: z.string().default('ca-central-1'),
  /** Must be an address on the verified 1dealer.ca identity. */
  EMAIL_FROM: z.string().default('no-reply@1dealer.ca'),
  /**
   * 'ses' actually sends; 'log' prints the message instead — the default
   * outside production so local dev and CI never need AWS credentials and can
   * never emit real mail. Production must set EMAIL_TRANSPORT=ses explicitly.
   */
  EMAIL_TRANSPORT: z.enum(['ses', 'log']).default('log'),
  /**
   * Enforcement is config, not code (A-05.1): the verification email always
   * sends, but blocking unverified sign-in is opt-in so the owner's local test
   * accounts (and SES sandbox limits) don't lock anyone out.
   */
  REQUIRE_EMAIL_VERIFICATION: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
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
