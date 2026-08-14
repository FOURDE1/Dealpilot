import { createAnthropicClient, type ModelClient } from '@dealpilot/ai';
import type { Env } from './env.js';

/**
 * Whether the assistant runs, and against what (F-31, ADR-022).
 *
 * Three states, and the middle one is the interesting one:
 *
 *  - `off` (the default) — no model is called. Inbound messages are still
 *    received, matched for STOP, routed, filed and handed to a person. What is
 *    absent is only the automated reply. That is a coherent product on its own
 *    — a shared inbox with a compliance engine in front of it — which is why it
 *    is the default rather than a boot failure the way a missing carrier is.
 *  - `anthropic` with no key — a boot failure, deliberately. Asking for the
 *    assistant and silently not getting it is the worst of the three: the
 *    dealership believes leads are being answered.
 *  - `anthropic` with a key — the real thing.
 *
 * The model id is configuration. PROJECT.md commits to a model-agnostic layer
 * "selected per task by the eval/A-B harness", and a literal at a call site is
 * how that becomes untrue one call site at a time.
 */

export type Assistant =
  | { readonly enabled: false; readonly reason: 'not_configured' }
  | { readonly enabled: true; readonly client: ModelClient; readonly model: string };

export function createAssistant(env: Env): Assistant {
  if (env.AI_TRANSPORT === 'off') {
    return { enabled: false, reason: 'not_configured' };
  }

  if (!env.ANTHROPIC_API_KEY) {
    throw new Error(
      'AI_TRANSPORT=anthropic requires ANTHROPIC_API_KEY. Refusing to start: an assistant that is switched on and cannot think would leave a dealership believing its leads are being answered.',
    );
  }

  return {
    enabled: true,
    model: env.AI_MODEL,
    client: createAnthropicClient({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.AI_MODEL,
      maxTokens: env.AI_MAX_TOKENS,
    }),
  };
}
