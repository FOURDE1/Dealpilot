import { withTenant, type Pool, type PoolClient } from '@dealpilot/db';
import { LiveAnalysisJob, type LiveAnalysisJobT } from '@dealpilot/contracts';
import type { Emitter } from '@dealpilot/contracts';
import { runLiveAnalysis, ANALYSIS_WINDOW, type AnalysisClient, type AnalysisLine } from '@dealpilot/ai';

/**
 * F-62 — the silent-monitoring pass (appointments-tasks-communications.md
 * §10 post-handoff: "bot goes silent, keeps analyzing both sides").
 *
 * One pass per message on a human-held thread: re-read the window, judge it,
 * write ONE conversation_analysis 'live_update' row, and nudge the panel
 * over the tenant's conversation room. The row is the truth; the event is a
 * refresh hint — a dropped websocket costs freshness, never data.
 *
 * The analyst has no tools, no send path, and its suggested_response reaches
 * the customer only if a person pastes it — the model output stays behind
 * the human (§10's whole point).
 */

export interface LiveAnalysisDeps {
  readonly pool: Pool;
  /** NULL when AI transport is off — the job is then a recorded skip. */
  readonly analyst: AnalysisClient | null;
  readonly emitter: Emitter;
  /** Named so the row records WHICH model judged (§13 metering, 0061). */
  readonly model: string;
}

export type LiveAnalysisResult =
  | { kind: 'written'; analysisId: string }
  /** Off-schema model output: nothing written, nothing emitted — the panel
   * keeps showing the last GOOD analysis rather than a broken one. The raw
   * output and token spend ride the job result: the completed-job log is
   * the regression corpus until an analysis table earns its keep (D-063). */
  | { kind: 'invalid'; reason: string; raw: unknown; inputTokens: number; outputTokens: number }
  | { kind: 'skipped'; reason: string };

/**
 * The window, with the speaker the database recorded — not a guess from
 * direction. Right after a handoff most outbound turns are the BOT's, and
 * labelling them AGENT put the assistant's words (the Law 25 disclosure
 * included) in the human's mouth (F-62 review).
 */
async function thread(c: PoolClient, conversationId: string): Promise<AnalysisLine[]> {
  const r = await c.query<{ direction: string; sender_type: string; body: string }>(
    `SELECT direction, sender_type, body FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT ${ANALYSIS_WINDOW}`,
    [conversationId],
  );
  return r.rows.reverse().map((m) => ({
    speaker:
      m.direction === 'inbound'
        ? ('customer' as const)
        : m.sender_type === 'agent'
          ? ('agent' as const)
          : m.sender_type === 'bot'
            ? ('assistant' as const)
            : ('system' as const),
    content: m.body,
  }));
}

export async function runLiveAnalysisJob(
  deps: LiveAnalysisDeps,
  raw: unknown,
): Promise<LiveAnalysisResult> {
  const job: LiveAnalysisJobT = LiveAnalysisJob.parse(raw);
  if (deps.analyst === null) {
    return { kind: 'skipped', reason: 'AI transport is off — no analysis model configured' };
  }
  const analyst = deps.analyst;

  const result = await withTenant(deps.pool, job.organization_id, async (c) => {
    const conv = await c.query<{
      id: string; store_id: string; lead_id: string | null; status: string; language: 'fr' | 'en';
    }>(
      `SELECT id, store_id, lead_id, status, language
       FROM conversations WHERE id = $1 AND deleted_at IS NULL`,
      [job.conversation_id],
    );
    const conversation = conv.rows[0];
    if (conversation === undefined) return { kind: 'skipped' as const, reason: 'conversation gone' };
    // Status re-checked at RUN time, not enqueue time: a thread closed or
    // handed back to the bot between the two needs no silent analyst.
    if (conversation.status !== 'handed_off' && conversation.status !== 'agent_active') {
      return { kind: 'skipped' as const, reason: `thread is ${conversation.status}, not human-held` };
    }

    // Idempotency BEFORE the model spend: BullMQ is at-least-once, and a
    // worker killed between commit and ack replays the job. The 0061 unique
    // index is the backstop; this read spares the duplicate model call.
    const done = await c.query(
      `SELECT 1 FROM conversation_analysis WHERE message_id = $1`,
      [job.message_id],
    );
    if (done.rows.length > 0) {
      return { kind: 'skipped' as const, reason: 'message already analyzed' };
    }

    const history = await thread(c, conversation.id);
    if (history.length === 0) return { kind: 'skipped' as const, reason: 'empty thread' };

    const outcome = await runLiveAnalysis(analyst, history, conversation.language);
    if (outcome.analysis === null) {
      return {
        kind: 'invalid' as const,
        reason: outcome.error ?? 'invalid',
        raw: outcome.raw,
        inputTokens: outcome.inputTokens,
        outputTokens: outcome.outputTokens,
      };
    }
    const a = outcome.analysis;

    // Freshness: this judgement read a window ending at job.message_id. If a
    // job for a LATER message already landed while our model call stalled,
    // inserting now would put the STALER judgement on top of the panel's
    // seq ordering — the kind of wrong that looks like nothing at all (0035).
    const fresher = await c.query(
      `SELECT 1
       FROM conversation_analysis ca
       JOIN messages m ON m.id = ca.message_id
       JOIN messages mine ON mine.id = $2
       WHERE ca.conversation_id = $1 AND ca.analysis_type = 'live_update'
         AND (m.created_at, m.id) > (mine.created_at, mine.id)`,
      [conversation.id, job.message_id],
    );
    if (fresher.rows.length > 0) {
      return { kind: 'skipped' as const, reason: 'a fresher analysis already landed' };
    }

    const inserted = await c.query<{ id: string }>(
      `INSERT INTO conversation_analysis
         (organization_id, store_id, conversation_id, lead_id, analysis_type,
          sentiment, buying_signals, concerns, suggested_response, summary, score, score_reason,
          message_id, model, input_tokens, output_tokens)
       VALUES ($1,$2,$3,$4,'live_update',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        job.organization_id, conversation.store_id, conversation.id, conversation.lead_id,
        a.sentiment, a.buying_signals, a.concerns, a.suggested_response, a.summary,
        a.score, a.score_reason,
        job.message_id, deps.model, outcome.inputTokens, outcome.outputTokens,
      ],
    );
    // Lost the race to our own replay: the first run's row stands.
    if (inserted.rows.length === 0) {
      return { kind: 'skipped' as const, reason: 'message already analyzed' };
    }
    return { kind: 'written' as const, analysisId: inserted.rows[0]!.id };
  });

  // Post-commit: the hint must never precede the row it points at — and a
  // hint that fails must never fail the job, because a retry would find the
  // idempotency row and skip, leaving the panel silent forever. Freshness is
  // all the hint carries; the row is safe either way.
  if (result.kind === 'written') {
    try {
      deps.emitter.emit(
        { kind: 'conversation', organizationId: job.organization_id, conversationId: job.conversation_id },
        {
          type: 'analysis.created',
          organization_id: job.organization_id,
          conversation_id: job.conversation_id,
        },
      );
    } catch {
      // The row is committed and the panel refetches on its own next open.
    }
  }
  return result;
}
