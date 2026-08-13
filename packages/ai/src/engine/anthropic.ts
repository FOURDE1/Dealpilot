import Anthropic from '@anthropic-ai/sdk';
import type { ModelClient, ModelReply, ModelRequest } from './turn.js';

/**
 * The Anthropic adapter (ADR-022).
 *
 * Deliberately the thinnest thing in this package. Every decision worth
 * arguing about — what the assistant may know, which tools exist, what happens
 * to a draft that breaks the rules — lives in `runTurn`, behind the
 * `ModelClient` interface, where it is tested without a network. This file only
 * translates shapes.
 *
 * `cacheBreakpoint` becomes an ephemeral `cache_control` marker: §3's blocks
 * 1–3 are stable and read at a discount, block 4 changes every turn and is
 * never marked.
 */

export interface AnthropicClientOptions {
  readonly apiKey: string;
  /** Selected per task by the eval harness; never hard-coded at a call site. */
  readonly model: string;
  readonly maxTokens?: number;
  /** Every external call gets an explicit timeout. */
  readonly timeoutMs?: number;
}

export function createAnthropicClient(opts: AnthropicClientOptions): ModelClient {
  const client = new Anthropic({
    apiKey: opts.apiKey,
    timeout: opts.timeoutMs ?? 30_000,
    maxRetries: 2,
  });

  return {
    async complete(request: ModelRequest): Promise<ModelReply> {
      const response = await client.messages.create({
        model: opts.model,
        max_tokens: opts.maxTokens ?? 1024,
        system: request.system.map((block) => ({
          type: 'text' as const,
          text: block.text,
          ...(block.cacheBreakpoint ? { cache_control: { type: 'ephemeral' as const } } : {}),
        })),
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      });

      const text = response.content
        .filter((c): c is Anthropic.TextBlock => c.type === 'text')
        .map((c) => c.text)
        .join('');
      const toolCalls = response.content
        .filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use')
        .map((c) => ({ id: c.id, name: c.name, input: c.input }));

      return {
        text,
        toolCalls,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    },
  };
}
