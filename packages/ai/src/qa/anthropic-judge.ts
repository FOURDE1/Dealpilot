import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { QaVerdict, type QaJudgeClient } from './judge.js';

/**
 * The Anthropic QA-judge adapter — same thin forced-tool shape as the
 * extraction and analysis adapters (ADR-022). §9 names an Opus-class judge;
 * the model id itself comes from env (AI_JUDGE_MODEL).
 */

export interface AnthropicJudgeOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof globalThis.fetch;
}

const VERDICT_TOOL_SCHEMA = z.toJSONSchema(QaVerdict);

export function createAnthropicJudgeClient(opts: AnthropicJudgeOptions): QaJudgeClient {
  const client = new Anthropic({
    apiKey: opts.apiKey,
    timeout: opts.timeoutMs ?? 60_000,
    maxRetries: 2,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });

  return {
    async judge(input) {
      const response = await client.messages.create({
        model: opts.model,
        max_tokens: 1024,
        system: input.system,
        messages: [{ role: 'user', content: input.transcript }],
        tools: [
          {
            name: 'record_qa_review',
            description: 'Record the rubric scores for this conversation.',
            input_schema: VERDICT_TOOL_SCHEMA as Anthropic.Tool['input_schema'],
          },
        ],
        tool_choice: { type: 'tool', name: 'record_qa_review' },
      });
      const call = response.content.find(
        (c): c is Anthropic.ToolUseBlock => c.type === 'tool_use' && c.name === 'record_qa_review',
      );
      return {
        raw: call?.input ?? null,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    },
  };
}
