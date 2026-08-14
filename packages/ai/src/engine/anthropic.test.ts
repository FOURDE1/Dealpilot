import { describe, expect, it } from 'vitest';
import { MODEL_TOOL_SPECS, TOOLS } from '../tools/definitions.js';
import { createAnthropicClient } from './anthropic.js';

/**
 * What actually goes on the wire.
 *
 * The adapter had never been called by anything but a type-checker. It sent the
 * system blocks and the messages and NO tools — so seven audited tools, a
 * `ToolRunner`, a name whitelist and a call budget all sat behind a model that
 * had never been told a tool existed. Every test passed, because the fake
 * `ModelClient` in turn.test.ts returns tool calls whenever a test asks it to.
 *
 * These assert the request body itself, through an injected `fetch`, because
 * that is the only thing the provider ever sees.
 */

/** Capture the outgoing request and answer with a minimal valid reply. */
function captureFetch(): { calls: { url: string; body: Record<string, unknown> }[]; fetch: typeof globalThis.fetch } {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const fetch = (async (input: unknown, init?: { body?: unknown }) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    });
    return new Response(
      JSON.stringify({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'test',
        content: [{ type: 'text', text: 'Bonjour!' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof globalThis.fetch;
  return { calls, fetch };
}

function client(fetch: typeof globalThis.fetch) {
  return createAnthropicClient({ apiKey: 'sk-ant-test-not-a-real-key', model: 'claude-test', fetch });
}

const REQUEST = {
  system: [{ text: 'You are an assistant.', cacheBreakpoint: true }],
  messages: [{ role: 'user' as const, content: 'Bonjour' }],
  tools: MODEL_TOOL_SPECS,
};

describe('the tools the model is told about', () => {
  it('sends every tool in the catalogue', async () => {
    const { calls, fetch } = captureFetch();
    await client(fetch).complete(REQUEST);

    const tools = calls[0]!.body['tools'] as { name: string }[];
    expect(tools).toBeDefined();
    // Not "some tools" — all of them. A tool in the catalogue that never
    // reaches the model is a capability the assistant is documented to have
    // and cannot use.
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());
  });

  it('gives every tool an input schema', async () => {
    const { calls, fetch } = captureFetch();
    await client(fetch).complete(REQUEST);

    const tools = calls[0]!.body['tools'] as { name: string; input_schema: Record<string, unknown> }[];
    for (const tool of tools) {
      // Without this the provider either rejects the tool or accepts one the
      // model cannot call correctly — and the second failure is silent.
      expect(tool.input_schema, tool.name).toBeDefined();
      expect(tool.input_schema['type'], tool.name).toBe('object');
    }
  });

  it('describes the arguments a real tool takes', async () => {
    const { calls, fetch } = captureFetch();
    await client(fetch).complete(REQUEST);

    const tools = calls[0]!.body['tools'] as { name: string; input_schema: Record<string, unknown> }[];
    const inventory = tools.find((t) => t.name === 'lookup_inventory')!;
    const props = inventory.input_schema['properties'] as Record<string, unknown>;
    expect(Object.keys(props)).toContain('vehicle_type');
    expect(Object.keys(props)).toContain('limit');
    // And still nothing that would let a model choose whose inventory to read.
    expect(Object.keys(props)).not.toContain('organization_id');
    expect(Object.keys(props)).not.toContain('store_id');
  });

  it('omits the tools key entirely when there are none', async () => {
    // The correction pass deliberately offers no tools: the model is being
    // asked to rewrite a sentence, not to go and do something.
    const { calls, fetch } = captureFetch();
    await client(fetch).complete({ ...REQUEST, tools: [] });
    expect(calls[0]!.body['tools']).toBeUndefined();
  });
});

describe('the rest of the request', () => {
  it('marks the cache breakpoint and nothing else', async () => {
    const { calls, fetch } = captureFetch();
    await client(fetch).complete({
      ...REQUEST,
      system: [
        { text: 'stable block', cacheBreakpoint: true },
        { text: 'changes every turn', cacheBreakpoint: false },
      ],
    });
    const system = calls[0]!.body['system'] as { text: string; cache_control?: unknown }[];
    expect(system[0]!.cache_control).toEqual({ type: 'ephemeral' });
    // Marking the volatile block would cost a cache write every single turn
    // and never produce a hit.
    expect(system[1]!.cache_control).toBeUndefined();
  });

  it('reports token usage back to the caller', async () => {
    const { fetch } = captureFetch();
    const reply = await client(fetch).complete(REQUEST);
    // The cost model in §13 is per-turn; a caller that cannot see tokens
    // cannot price anything.
    expect(reply).toMatchObject({ inputTokens: 10, outputTokens: 5, text: 'Bonjour!' });
  });
});
