import { withTenant, type Pool, type PoolClient } from '@dealpilot/db';
import { AiExtractionJob } from '@dealpilot/contracts';
import {
  extractionWriteback,
  runExtraction,
  type ExtractionClient,
  type WritebackCurrent,
} from '@dealpilot/ai';
import type { ModelMessage } from '@dealpilot/ai';

/**
 * The data pass (F-57, conversation-engine.md §5).
 *
 * Reads the thread from the database, re-derives the qualification facts,
 * stores the snapshot verbatim, and patches the lead through an allow-list —
 * never blanking a known value with a null. Transient model failures THROW
 * so the queue's retry budget fires; off-schema output is snapshotted
 * verbatim (the eval regression corpus) and writes nothing.
 */

export interface AiExtractionDeps {
  readonly pool: Pool;
  /** NULL when AI_TRANSPORT is off — the job is then a recorded skip. */
  readonly extractor: ExtractionClient | null;
  readonly model: string;
}

export type AiExtractionResult =
  | { kind: 'written'; patched: readonly string[] }
  /** The model answered but off-schema: snapshotted verbatim (§5 — that IS
   * the regression corpus, and §13 meters the tokens), nothing written. */
  | { kind: 'invalid_snapshotted'; reason: string }
  | { kind: 'skipped'; reason: string };

/** §5: the columns the write-back table names — the ONLY columns this worker
 * may touch. Re-bounded at the sink like every dynamic SET in this codebase. */
const PATCHABLE = new Set([
  'monthly_budget_cents', 'total_budget_cents', 'vehicle_interest',
  'trade_in_status', 'trade_in_year', 'trade_in_make', 'trade_in_model',
  'trade_in_mileage_km', 'trade_in_condition', 'purchase_timeline', 'credit_band',
]);

async function thread(c: PoolClient, conversationId: string): Promise<ModelMessage[]> {
  const r = await c.query<{ direction: string; body: string }>(
    `SELECT direction, body FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT 20`,
    [conversationId],
  );
  return r.rows
    .reverse()
    .map((m) => ({ role: m.direction === 'inbound' ? ('user' as const) : ('assistant' as const), content: m.body }));
}

export async function runAiExtraction(deps: AiExtractionDeps, raw: unknown): Promise<AiExtractionResult> {
  const job = AiExtractionJob.parse(raw);
  if (deps.extractor === null) {
    return { kind: 'skipped', reason: 'AI transport is off — no extraction model configured' };
  }
  const extractor = deps.extractor;

  return withTenant(deps.pool, job.organization_id, async (c) => {
    const conv = await c.query<{ id: string; store_id: string | null; lead_id: string | null }>(
      `SELECT id, store_id, lead_id FROM conversations WHERE id = $1 AND deleted_at IS NULL`,
      [job.conversation_id],
    );
    const conversation = conv.rows[0];
    if (conversation === undefined) return { kind: 'skipped', reason: 'conversation gone' };
    if (conversation.lead_id === null) return { kind: 'skipped', reason: 'no lead attached yet' };

    const history = await thread(c, job.conversation_id);
    if (history.length === 0) return { kind: 'skipped', reason: 'empty thread' };

    // A throwing extractor propagates from here: BullMQ's attempts/backoff
    // exist for exactly that transient failure, and a swallowed throw would
    // complete the job and lose the message's extraction forever.
    const outcome = await runExtraction(extractor, history);

    // §5: EVERY snapshot is stored verbatim — the invalid ones are the eval
    // regression corpus, and §13 meters the tokens either way. ON CONFLICT:
    // one snapshot per triggering message, so a retry after a commit cannot
    // append a duplicate.
    await c.query(
      `INSERT INTO lead_extractions
         (organization_id, store_id, lead_id, conversation_id, message_id, payload, model, input_tokens, output_tokens)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING`,
      [
        job.organization_id, conversation.store_id, conversation.lead_id,
        job.conversation_id, job.message_id, JSON.stringify(outcome.raw ?? null),
        deps.model, outcome.inputTokens, outcome.outputTokens,
      ],
    );
    if (outcome.extraction === null) {
      return { kind: 'invalid_snapshotted', reason: outcome.error ?? 'extraction failed' };
    }

    const leadRow = await c.query<WritebackCurrent>(
      `SELECT monthly_budget_cents, total_budget_cents, vehicle_interest,
              trade_in_status, trade_in_year, trade_in_make, trade_in_model,
              trade_in_mileage_km, trade_in_condition, purchase_timeline,
              credit_band, preferred_language
       FROM leads WHERE id = $1 AND deleted_at IS NULL`,
      [conversation.lead_id],
    );
    const current = leadRow.rows[0];
    if (current === undefined) return { kind: 'written', patched: [] };

    const { patch } = extractionWriteback(outcome.extraction, current);
    const keys = Object.keys(patch);
    if (keys.length === 0) return { kind: 'written', patched: [] };

    const sets: string[] = [];
    const params: unknown[] = [conversation.lead_id];
    for (const [key, value] of Object.entries(patch)) {
      if (!PATCHABLE.has(key)) throw new Error(`unpatchable column reached the SQL sink: ${key}`);
      params.push(value);
      sets.push(`${key} = $${params.length}`);
    }
    await c.query(`UPDATE leads SET ${sets.join(', ')} WHERE id = $1 AND deleted_at IS NULL`, params);

    return { kind: 'written', patched: keys };
  });
}
