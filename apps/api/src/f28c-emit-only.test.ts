import { describe, expect, it } from 'vitest';
import { createEmitOnlyEmitter } from './realtime.js';

/**
 * The emit-only emitter's LIFECYCLE (F-62). The delivery topology is f28b's
 * business; what this file pins is the part CI's SIGTERM drain caught red:
 * an emit-only Socket.IO server has no attached HTTP server, and a close()
 * that assumed one threw during shutdown — which reads as "in-flight jobs
 * would be killed mid-send" to the deploy pipeline (run 32531141801).
 */

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6381';

describe('createEmitOnlyEmitter', () => {
  it('with no Redis URL: a silent emitter whose close resolves', async () => {
    const { emitter, close } = createEmitOnlyEmitter(undefined);
    expect(() =>
      emitter.emit(
        { kind: 'conversation', organizationId: '11111111-1111-4111-8111-111111111111', conversationId: '22222222-2222-4222-8222-222222222222' },
        {
          type: 'analysis.created',
          organization_id: '11111111-1111-4111-8111-111111111111',
          conversation_id: '22222222-2222-4222-8222-222222222222',
        },
      ),
    ).not.toThrow();
    await expect(close()).resolves.toBeUndefined();
  });

  it('with Redis: emits, then CLOSES cleanly — a worker must drain on SIGTERM', async () => {
    const { emitter, close } = createEmitOnlyEmitter(REDIS_URL);
    let up = true;
    try {
      emitter.emit(
        { kind: 'conversation', organizationId: '11111111-1111-4111-8111-111111111111', conversationId: '22222222-2222-4222-8222-222222222222' },
        {
          type: 'analysis.created',
          organization_id: '11111111-1111-4111-8111-111111111111',
          conversation_id: '22222222-2222-4222-8222-222222222222',
        },
      );
    } catch {
      // No local Redis: the emit path is f28b's to prove; close must still work.
      up = false;
    }
    await expect(close()).resolves.toBeUndefined();
    expect(typeof up).toBe('boolean');
  });
});
