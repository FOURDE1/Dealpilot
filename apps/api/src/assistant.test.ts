import { describe, expect, it } from 'vitest';
import { createAssistant } from './assistant.js';
import { loadEnv } from './env.js';

/**
 * Whether the assistant runs.
 *
 * The failure this guards against is the quiet one: an assistant switched on,
 * unable to think, and nobody told. A dealership would go on believing its
 * leads were being answered while every one of them sat unanswered.
 */

/** A production env that satisfies env.ts's own dev-default checks. */
const PROD = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://app:secret@db.internal:5432/dealpilot',
  BETTER_AUTH_SECRET: 'a-real-secret-at-least-sixteen-chars',
  BETTER_AUTH_URL: 'https://api.dealpilot.ca',
  WEB_ORIGIN: 'https://app.dealpilot.ca',
  DOCUMENT_STORAGE_DRIVER: 's3',
  SMS_TRANSPORT: 'twilio',
  TWILIO_ACCOUNT_SID: 'AC1',
  TWILIO_AUTH_TOKEN: 'tok',
} as const;

describe('with no model configured', () => {
  it('is off by default rather than broken', () => {
    const a = createAssistant(loadEnv({}));
    expect(a).toMatchObject({ enabled: false, reason: 'not_configured' });
  });

  it('is off in production too, without failing the boot', () => {
    // Deliberately unlike the carrier. A dealership running this as a shared
    // inbox — inbound received, STOP honoured, routed to a person, no
    // automated reply — is a coherent product, not a broken one.
    expect(createAssistant(loadEnv(PROD))).toMatchObject({ enabled: false });
  });
});

describe('with the assistant switched on', () => {
  it('refuses to start without a key', () => {
    // The one state that must never boot: on, and unable to think.
    expect(() => createAssistant(loadEnv({ AI_TRANSPORT: 'anthropic' })))
      .toThrow(/requires ANTHROPIC_API_KEY/);
    expect(() => createAssistant(loadEnv({ ...PROD, AI_TRANSPORT: 'anthropic' })))
      .toThrow(/requires ANTHROPIC_API_KEY/);
  });

  it('builds a client when the key is there', () => {
    const a = createAssistant(loadEnv({
      AI_TRANSPORT: 'anthropic',
      ANTHROPIC_API_KEY: 'sk-ant-test-not-a-real-key',
    }));
    expect(a.enabled).toBe(true);
    if (!a.enabled) return;
    expect(typeof a.client.complete).toBe('function');
  });

  it('takes the model from configuration, not from a literal', () => {
    // PROJECT.md commits to a model-agnostic layer "selected per task by the
    // eval/A-B harness". A hard-coded model id is how that stops being true,
    // one call site at a time.
    const a = createAssistant(loadEnv({
      AI_TRANSPORT: 'anthropic',
      ANTHROPIC_API_KEY: 'sk-ant-test-not-a-real-key',
      AI_MODEL: 'claude-opus-5',
    }));
    expect(a.enabled && a.model).toBe('claude-opus-5');
  });
});
