import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { LeadExtraction, type ExtractionClient } from './lead-extraction.js';

/**
 * The Anthropic extraction adapter (ADR-022) — as thin as the conversation
 * one. The reliable way to force a schema on today's Messages API is a
 * single forced tool call whose input schema IS the extraction schema: the
 * model cannot answer any other shape, and the caller still validates.
 */

export interface AnthropicExtractionOptions {
  readonly apiKey: string;
  /** Selected per task by the eval harness; Haiku-class by default (§1). */
  readonly model: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

const EXTRACTION_TOOL_SCHEMA = z.toJSONSchema(LeadExtraction);

export function createAnthropicExtractionClient(opts: AnthropicExtractionOptions): ExtractionClient {
  const client = new Anthropic({
    apiKey: opts.apiKey,
    timeout: opts.timeoutMs ?? 30_000,
    maxRetries: 2,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });

  return {
    async extract(input) {
      const response = await client.messages.create({
        model: opts.model,
        max_tokens: 1024,
        system: input.system,
        messages: [{ role: 'user', content: input.transcript }],
        tools: [
          {
            name: 'record_extraction',
            description: 'Record the structured facts extracted from the transcript.',
            input_schema: EXTRACTION_TOOL_SCHEMA as Anthropic.Tool['input_schema'],
          },
        ],
        tool_choice: { type: 'tool', name: 'record_extraction' },
      });

      const call = response.content.find(
        (c): c is Anthropic.ToolUseBlock => c.type === 'tool_use' && c.name === 'record_extraction',
      );
      return {
        raw: call?.input ?? null,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    },
  };
}
