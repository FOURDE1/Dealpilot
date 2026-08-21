import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { LiveAnalysis, type AnalysisClient } from './live-analysis.js';

/**
 * The Anthropic analysis adapter — same thin shape as the extraction one
 * (ADR-022): a single forced tool call whose input schema IS the analysis
 * schema, so the model cannot answer any other shape and the caller still
 * validates.
 */

export interface AnthropicAnalysisOptions {
  readonly apiKey: string;
  /** Selected per task by the eval harness; Haiku-class by default (§1). */
  readonly model: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

const ANALYSIS_TOOL_SCHEMA = z.toJSONSchema(LiveAnalysis);

export function createAnthropicAnalysisClient(opts: AnthropicAnalysisOptions): AnalysisClient {
  const client = new Anthropic({
    apiKey: opts.apiKey,
    timeout: opts.timeoutMs ?? 30_000,
    maxRetries: 2,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });

  return {
    async analyze(input) {
      const response = await client.messages.create({
        model: opts.model,
        max_tokens: 1024,
        system: input.system,
        messages: [{ role: 'user', content: input.transcript }],
        tools: [
          {
            name: 'record_analysis',
            description: 'Record the live conversation analysis for the agent panel.',
            input_schema: ANALYSIS_TOOL_SCHEMA as Anthropic.Tool['input_schema'],
          },
        ],
        tool_choice: { type: 'tool', name: 'record_analysis' },
      });

      const call = response.content.find(
        (c): c is Anthropic.ToolUseBlock => c.type === 'tool_use' && c.name === 'record_analysis',
      );
      return {
        raw: call?.input ?? null,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    },
  };
}
