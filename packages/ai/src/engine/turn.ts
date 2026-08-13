import { fallbackMessage, outboundGuard, type Violation } from '../guards/outbound-guard.js';
import { spotlight } from '../guards/spotlight.js';
import { buildSystemPrompt, type LiveContext, type TenantPromptConfig } from '../prompt/system-prompt.js';
import { TOOLS, type ToolName } from '../tools/definitions.js';

/**
 * One turn of the assistant (conversation-engine.md §2, §10, §11).
 *
 * Model-agnostic on purpose (ADR-022): the loop talks to a `ModelClient`
 * interface, so it is tested against a stub with no API key and no network, and
 * swapping models is a constructor argument rather than a rewrite. The
 * Anthropic adapter is thirty lines at the edge of this package.
 *
 * The loop's job is not to be clever. It is to make sure that whatever the
 * model returns — helpful, jailbroken, or confidently wrong — the customer
 * receives something the dealership can stand behind:
 *
 *   1. untrusted content is spotlighted before it reaches the model (§11);
 *   2. tool calls run server-side with ids the model never supplied (§4);
 *   3. the draft passes `outboundGuard`, or is regenerated ONCE with the
 *      violation named, or becomes the fallback template (§10 guardrail 3).
 *
 * There is no path out of here that skips step 3.
 */

export interface ModelMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface ModelToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

export interface ModelReply {
  readonly text: string;
  readonly toolCalls: readonly ModelToolCall[];
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ModelRequest {
  readonly system: readonly { readonly text: string; readonly cacheBreakpoint: boolean }[];
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly { readonly name: string; readonly description: string }[];
}

export interface ModelClient {
  complete(request: ModelRequest): Promise<ModelReply>;
}

/**
 * Runs a tool the model asked for.
 *
 * The name is validated against the catalogue before this is called, and the
 * organisation, store and conversation come from the caller's closure — never
 * from `input`. A tool call is the one place a model's output becomes an action,
 * so it is the one place the ids must not be its to choose.
 */
export type ToolRunner = (name: ToolName, input: unknown) => Promise<unknown>;

export interface TurnInput {
  readonly tenant: TenantPromptConfig;
  readonly live: LiveContext;
  /** Prior turns, oldest first. Assistant text as sent, customer text as received. */
  readonly history: readonly ModelMessage[];
  /** What the customer just sent. Untrusted; spotlighted before use. */
  readonly clientMessage: string;
  readonly allowedStockNumbers: readonly string[];
  readonly language: 'fr' | 'en';
  /** §4: at most this many tool calls in one turn, so a loop cannot run away. */
  readonly maxToolCalls?: number;
}

export type TurnOutcome =
  | { kind: 'reply'; text: string; toolsUsed: readonly ToolName[]; regenerated: boolean }
  /**
   * Two drafts in a row broke the rules. The customer gets the fallback and a
   * person is told — §10 guardrail 3's MEDIUM alert to the sales manager.
   */
  | { kind: 'fallback'; text: string; violations: readonly Violation[]; toolsUsed: readonly ToolName[] };

export const MAX_TOOL_CALLS = 4;

const TOOL_NAMES = new Set<string>(TOOLS.map((t) => t.name));

/** The correction the model is given. It NAMES the violation (§10). */
export function correctionPrompt(violations: readonly Violation[], language: 'fr' | 'en'): string {
  const lines = violations.map((v) => `- ${v.kind}: you wrote “${v.matched}”. ${v.reason}`);
  return [
    'That message cannot be sent. It broke these rules:',
    ...lines,
    '',
    'Rewrite it with the offending part removed. Do not restate the number in words,',
    'do not approximate it, and do not promise to send it separately. If the customer',
    `asked for a figure, say a specialist will go through the numbers with them, in ${
      language === 'fr' ? 'French' : 'English'
    }.`,
  ].join('\n');
}

export async function runTurn(
  client: ModelClient,
  runTool: ToolRunner,
  input: TurnInput,
): Promise<TurnOutcome> {
  const system = buildSystemPrompt({ tenant: input.tenant, live: input.live });
  // §11: the customer's words arrive wrapped and defanged, never inline. A model
  // that cannot tell data from instructions is a model that follows the data.
  const wrapped = spotlight(input.clientMessage, 'lead_message');
  const messages: ModelMessage[] = [
    ...input.history,
    { role: 'user', content: wrapped.wrapped },
  ];

  const toolsUsed: ToolName[] = [];
  const budget = input.maxToolCalls ?? MAX_TOOL_CALLS;
  let reply = await client.complete({ system, messages, tools: TOOLS });

  // Tool loop. Bounded, because a model that keeps asking for inventory is a
  // model spending the tenant's money in a circle.
  while (reply.toolCalls.length > 0 && toolsUsed.length < budget) {
    for (const call of reply.toolCalls) {
      if (!TOOL_NAMES.has(call.name)) {
        // Not an exception: an invented tool name is the model being wrong, and
        // telling it so is more useful than failing the turn.
        messages.push({ role: 'assistant', content: `[tool ${call.name}]` });
        messages.push({ role: 'user', content: `There is no tool called ${call.name}.` });
        continue;
      }
      const name = call.name as ToolName;
      const result = await runTool(name, call.input);
      toolsUsed.push(name);
      messages.push({ role: 'assistant', content: `[tool ${name}]` });
      messages.push({ role: 'user', content: JSON.stringify(result) });
      if (toolsUsed.length >= budget) break;
    }
    reply = await client.complete({ system, messages, tools: TOOLS });
  }

  const ctx = { allowedStockNumbers: input.allowedStockNumbers, isServerTemplate: false };

  // A model that spent its whole tool budget and produced no words has not
  // answered anybody. Sending an empty SMS is worse than sending the fallback:
  // the customer sees a blank message from a dealership and the thread looks
  // answered to everyone here.
  if (reply.text.trim() === '') {
    return {
      kind: 'fallback',
      text: fallbackMessage(input.language),
      violations: [{
        kind: 'empty_reply',
        matched: '',
        reason: 'the model returned no text, most often after exhausting its tool budget',
      }],
      toolsUsed,
    };
  }

  let violations = outboundGuard(reply.text, ctx);
  if (violations.length === 0) {
    return { kind: 'reply', text: reply.text, toolsUsed, regenerated: false };
  }

  // One correction, with the violation quoted back. §10 is specific about the
  // count: a model that has broken the same rule twice is not going to get it
  // right on the third attempt, and each retry is another chance to say the
  // number a slightly different way.
  messages.push({ role: 'assistant', content: reply.text });
  messages.push({ role: 'user', content: correctionPrompt(violations, input.language) });
  const second = await client.complete({ system, messages, tools: [] });

  violations = outboundGuard(second.text, ctx);
  if (violations.length === 0) {
    return { kind: 'reply', text: second.text, toolsUsed, regenerated: true };
  }

  return {
    kind: 'fallback',
    text: fallbackMessage(input.language),
    violations,
    toolsUsed,
  };
}
