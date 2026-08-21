import { z } from 'zod';
import { outboundGuard, VIOLATION_KINDS } from '../guards/outbound-guard.js';
import { spotlight, UNTRUSTED_TAGS } from '../guards/spotlight.js';
import { runTurn, type ModelClient, type ModelReply, type ModelRequest } from '../engine/turn.js';
import { TOOLS, type ToolName } from '../tools/definitions.js';
import type { LiveContext, TenantPromptConfig } from '../prompt/system-prompt.js';

/**
 * F-56 — the eval harness (compliance-and-quality.md §10, ADR-023).
 *
 * Cases are DATA (`packages/ai/evals/*.jsonl`), the runner is code, and the
 * split is the point: a new red-team incident becomes one appended line, and
 * the suite-only-grows rule is enforceable as a count.
 *
 * CI cases are fully deterministic — the model is a script, so what is being
 * proven is the MACHINERY: spotlighting, defanging, redaction, the guard, the
 * regeneration path, the tool loop's bounds. Live cases (real model + judge)
 * run nightly and pre-release once an API key with credits exists; in CI they
 * are counted, never silently dropped.
 */

const ScriptStep = z.object({
  text: z.string().default(''),
  tools: z
    .array(z.object({ name: z.string(), input: z.unknown().default({}) }))
    .default([]),
});

export const EvalCase = z.object({
  id: z.string(),
  /** The spec's case number (RT-xx) or golden id — the suite-only-grows key. */
  rt: z.string().optional(),
  kind: z.enum(['turn', 'guard', 'spotlight', 'xlayer', 'live']),
  category: z.enum(['adversarial', 'compliance', 'golden']),
  title: z.string(),
  language: z.enum(['fr', 'en']).default('en'),
  /** turn/spotlight: what the customer sent. */
  message: z.string().optional(),
  tag: z.enum(UNTRUSTED_TAGS).default('lead_message'),
  /** guard: the model draft under test. */
  draft: z.string().optional(),
  allowedStockNumbers: z.array(z.string()).default([]),
  /** turn: the scripted model, one entry per complete() call. */
  script: z.array(ScriptStep).default([]),
  toolResults: z.record(z.string(), z.unknown()).default({}),
  /** xlayer: the test file (repo-relative) that pins this behavior, and a
   * string it must contain — the link breaks loudly if that suite is removed. */
  pinnedBy: z.string().optional(),
  mustContain: z.string().optional(),
  note: z.string().optional(),
  assert: z
    .object({
      outcome: z.enum(['reply', 'fallback']).optional(),
      regenerated: z.boolean().optional(),
      /** Exact SET of violation kinds on the outcome. */
      violations: z.array(z.enum(VIOLATION_KINDS)).optional(),
      finalForbidden: z.array(z.string()).default([]),
      finalRequired: z.array(z.string()).default([]),
      /** Regexes vs EVERYTHING the model was shown (system + messages, all calls). */
      promptForbidden: z.array(z.string()).default([]),
      promptRequired: z.array(z.string()).default([]),
      toolsUsed: z.array(z.string()).optional(),
      sanitizedForbidden: z.array(z.string()).default([]),
      sanitizedRequired: z.array(z.string()).default([]),
      tamperAttempt: z.boolean().optional(),
    })
    .default({
      finalForbidden: [],
      finalRequired: [],
      promptForbidden: [],
      promptRequired: [],
      sanitizedForbidden: [],
      sanitizedRequired: [],
    }),
});
export type EvalCaseT = z.infer<typeof EvalCase>;

export interface EvalResult {
  readonly id: string;
  readonly pass: boolean;
  readonly failures: readonly string[];
}

export const FIXTURE_TENANT: TenantPromptConfig = {
  dealershipLegalName: 'Kia Mont-Laurier',
  personaName: 'Camille',
  storeAddress: '123 rue Principale, Mont-Laurier',
  storePhone: '+18195814440',
  hoursText: 'Mon-Fri 9-19, Sat 10-16',
  askLanguagePreference: true,
  currentOffersText: null,
  brands: ['Kia'],
  complianceFooter: null,
  maxMessagesBeforeHandoff: 15,
  photoLimit: 3,
};

export function fixtureLive(language: 'fr' | 'en'): LiveContext {
  return {
    inventory: [
      { stock_number: 'K-1234', year: 2023, make: 'Kia', model: 'Sportage', trim: 'EX', mileage_km: 21000 },
    ],
    lead: {
      firstName: 'Gilles',
      source: 'website',
      vehicleInterest: 'Kia Sportage',
      isDuplicate: false,
      prefilled: [],
      consentState: 'implied_inquiry (active)',
    },
    localDateTimeText: 'Thursday 14:05',
    withinBusinessHours: true,
    nextOpenPhrase: 'tomorrow morning',
    language,
  };
}

/** The scripted model: one reply per complete() call; when the script runs
 * out it answers with the last step's TEXT and no tools, so loops terminate. */
function scriptedClient(steps: z.infer<typeof ScriptStep>[], seen: ModelRequest[]): ModelClient {
  let i = 0;
  return {
    complete(request: ModelRequest): Promise<ModelReply> {
      seen.push(request);
      const step = steps[Math.min(i, steps.length - 1)] ?? { text: '', tools: [] };
      const last = i >= steps.length - 1;
      i += 1;
      return Promise.resolve({
        text: step.text,
        toolCalls: (last && i > steps.length ? [] : step.tools).map((t, n) => ({
          id: `call_${i}_${n}`,
          name: t.name,
          input: t.input,
        })),
        inputTokens: 0,
        outputTokens: 0,
      });
    },
  };
}

function everythingModelSaw(requests: readonly ModelRequest[]): string {
  return requests
    .flatMap((r) => [...r.system.map((s) => s.text), ...r.messages.map((m) => m.content)])
    .join('\n');
}

function checkPatterns(
  failures: string[],
  haystack: string,
  forbidden: readonly string[],
  required: readonly string[],
  where: string,
): void {
  for (const f of forbidden) {
    if (new RegExp(f, 'iu').test(haystack)) failures.push(`${where} matches forbidden /${f}/`);
  }
  for (const r of required) {
    if (!new RegExp(r, 'iu').test(haystack)) failures.push(`${where} is missing required /${r}/`);
  }
}

export async function runEvalCase(
  c: EvalCaseT,
  readFile?: (repoRelativePath: string) => string,
): Promise<EvalResult> {
  const failures: string[] = [];
  const a = c.assert;

  if (c.kind === 'guard') {
    const violations = outboundGuard(c.draft ?? '', {
      allowedStockNumbers: c.allowedStockNumbers,
      isServerTemplate: false,
    });
    const kinds = [...new Set(violations.map((v) => v.kind))].sort();
    if (a.violations && kinds.join(',') !== [...a.violations].sort().join(',')) {
      failures.push(`guard kinds [${kinds.join(', ')}] ≠ expected [${a.violations.join(', ')}]`);
    }
  } else if (c.kind === 'spotlight') {
    const lit = spotlight(c.message ?? '', c.tag);
    checkPatterns(failures, lit.wrapped, a.sanitizedForbidden, a.sanitizedRequired, 'sanitized');
    if (a.tamperAttempt !== undefined && lit.tamperAttempt !== a.tamperAttempt) {
      failures.push(`tamperAttempt ${lit.tamperAttempt} ≠ expected ${a.tamperAttempt}`);
    }
  } else if (c.kind === 'turn') {
    const seen: ModelRequest[] = [];
    const toolNames = new Set<string>(TOOLS.map((t) => t.name));
    const outcome = await runTurn(
      scriptedClient(c.script, seen),
      (name: ToolName) => Promise.resolve(c.toolResults[name] ?? { ok: true }),
      {
        tenant: FIXTURE_TENANT,
        live: fixtureLive(c.language),
        history: [],
        clientMessage: c.message ?? '',
        allowedStockNumbers: c.allowedStockNumbers,
        language: c.language,
      },
    );
    if (a.outcome && outcome.kind !== a.outcome) {
      failures.push(`outcome ${outcome.kind} ≠ expected ${a.outcome}`);
    }
    if (a.regenerated !== undefined && outcome.kind === 'reply' && outcome.regenerated !== a.regenerated) {
      failures.push(`regenerated ${outcome.regenerated} ≠ expected ${a.regenerated}`);
    }
    if (a.violations && outcome.kind === 'fallback') {
      const kinds = [...new Set(outcome.violations.map((v) => v.kind))].sort();
      if (kinds.join(',') !== [...a.violations].sort().join(',')) {
        failures.push(`violations [${kinds.join(', ')}] ≠ expected [${a.violations.join(', ')}]`);
      }
    }
    checkPatterns(failures, outcome.text, a.finalForbidden, a.finalRequired, 'final text');
    checkPatterns(failures, everythingModelSaw(seen), a.promptForbidden, a.promptRequired, 'model-visible content');
    if (a.toolsUsed) {
      const used = outcome.toolsUsed.join(',');
      if (used !== a.toolsUsed.join(',')) failures.push(`toolsUsed [${used}] ≠ expected [${a.toolsUsed.join(',')}]`);
      for (const t of a.toolsUsed) {
        if (!toolNames.has(t)) failures.push(`case expects unknown tool ${t}`);
      }
    }
  } else if (c.kind === 'xlayer') {
    if (!readFile) {
      failures.push('xlayer case run without a readFile hook');
    } else if (!c.pinnedBy || !c.mustContain) {
      failures.push('xlayer case missing pinnedBy/mustContain');
    } else {
      try {
        const content = readFile(c.pinnedBy);
        if (!content.includes(c.mustContain)) {
          failures.push(`${c.pinnedBy} no longer contains "${c.mustContain}" — the pinning suite moved or was weakened`);
        }
      } catch {
        failures.push(`${c.pinnedBy} does not exist — the behavior this case pins is untested`);
      }
    }
  }
  // kind 'live': nothing to run here — counted by the caller, executed by the
  // nightly/pre-release runner once credits exist.

  return { id: c.id, pass: failures.length === 0, failures };
}
