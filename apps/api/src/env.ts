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
  // --- document storage (F-13c, ADR-013) -----------------------------------
  /**
   * 'local' writes under DOCUMENT_STORAGE_DIR — correct for dev and CI, and
   * refused in production: Fargate tasks have their own ephemeral disks, so a
   * file uploaded to one task is invisible to the next request and gone at the
   * next deploy. Production storage is S3, which is provisioned at launch.
   */
  DOCUMENT_STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  DOCUMENT_STORAGE_DIR: z.string().default('.storage/documents'),

  /**
   * Valkey/Redis, for the Socket.IO adapter (ADR-004).
   *
   * Optional, and optional is the point: one API task fans out perfectly well
   * in-process, and an API that refuses to boot without a message bus is an API
   * that stops taking orders when the message bus is down. Production sets it —
   * with two or more tasks behind the ALB, a message sent by task A must reach a
   * browser connected to task B.
   */
  REDIS_URL: z.string().optional(),

  /**
   * The SMS carrier (F-30, ADR-020).
   *
   * `log` writes a line and delivers nothing — correct for local development
   * and CI, and refused in production by `createCarrier`, because an API that
   * accepts customer conversations and silently delivers none of them is worse
   * than one that will not start.
   */
  SMS_TRANSPORT: z.enum(['twilio', 'log']).default('log'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  /**
   * The public origin the carrier posts webhooks to.
   *
   * Twilio signs the URL it called, so this must be the address as configured
   * at the provider — not the Host header, which an attacker chooses. Same
   * reasoning as BETTER_AUTH_URL (A-05.1).
   */
  PUBLIC_WEBHOOK_ORIGIN: z.string().optional(),

  /**
   * The assistant's model (ADR-022).
   *
   * `AI_TRANSPORT=off` is the default and means the assistant does not run at
   * all — inbound messages are still received, routed, filed and handed to a
   * person; only the automated reply is absent. That is a coherent product
   * (a shared inbox with a compliance engine), which is why it is the default
   * rather than a boot failure.
   *
   * The model id is configuration, never a literal at a call site: PROJECT.md
   * says the layer is model-agnostic and the model is "selected per task by the
   * eval/A-B harness".
   */
  AI_TRANSPORT: z.enum(['anthropic', 'off']).default('off'),
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-sonnet-5'),
  AI_MAX_TOKENS: z.coerce.number().int().min(64).max(8192).default(1024),

  REQUIRE_EMAIL_VERIFICATION: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  /**
   * F-41 slice 2: privileged permissions refuse until an MFA-required caller
   * enrols. Same shape as REQUIRE_EMAIL_VERIFICATION (A-11/D-030): enforcement
   * is configuration, default OFF so dev and test owners never lock out, and
   * the PRODUCTION deployment turns it on — deploy config, not code.
   */
  REQUIRE_MFA: z
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
    // Local disk in production is silent data loss, not a degraded mode: the
    // API runs on at least two Fargate tasks, so a signed contract uploaded to
    // one is invisible to the next request and gone at the next deploy. The
    // upload would answer 201 every time.
    if (env.DOCUMENT_STORAGE_DRIVER === 'local') {
      throw new Error(
        'DOCUMENT_STORAGE_DRIVER=local cannot be used in production — signed documents would be written to one task\'s ephemeral disk. Set it to s3 once the bucket exists (F-13c).',
      );
    }
  }
  return env;
}
