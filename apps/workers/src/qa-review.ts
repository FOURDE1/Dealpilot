import { withTenant, type Pool, type PoolClient } from '@dealpilot/db';
import {
  qaOverall,
  QaVerdict,
  QA_JUDGE_RUBRIC,
  qaTranscript,
  type QaJudgeClient,
  type QaLine,
} from '@dealpilot/ai';
import { escalationLadder } from '@dealpilot/api/cascade';
import { notify } from '@dealpilot/api/notifications';

/**
 * F-64 — the nightly QA judge (compliance-and-quality.md §9).
 *
 * Scores 100% of the day's CLOSED conversations against the six-dimension
 * rubric, one small transaction per conversation. Observation only: the
 * judge writes review rows and rings bells — it cannot touch a
 * conversation, a lead, or a send.
 *
 * Alerts, per §9: any compliance flag → HIGH to the escalation ladder's
 * first person, same day. Tenant 7-day average under 4.2 → MEDIUM, at most
 * once a day, because a metric that pages hourly is a metric that gets
 * muted.
 */

export interface QaReviewDeps {
  readonly pool: Pool;
  /** NULL when AI transport is off — the run is then a recorded skip. */
  readonly judge: QaJudgeClient | null;
  readonly model: string;
  readonly now?: () => Date;
  readonly warn?: (message: string, err: unknown) => void;
}

export interface QaRunSummary {
  scanned: number;
  reviewed: number;
  complianceFlags: number;
  invalid: number;
  skipped: number;
  lowAverageAlerts: number;
}

const WEEKLY_FLOOR = 4.2;

/**
 * The WHOLE conversation, oldest first, each line timestamped in the
 * store's local time — §9 judges disclosure (first turn) and quiet hours
 * (send clock), so neither a sliced window nor UTC would do (review
 * blocker: the F-62 20-message window cut the disclosure out of every
 * long conversation). qaTranscript() head/tails past 90 lines itself.
 */
async function transcript(c: PoolClient, conversationId: string, timezone: string): Promise<QaLine[]> {
  const r = await c.query<{ direction: string; sender_type: string; body: string; at: string }>(
    `SELECT direction, sender_type, body,
            to_char(created_at AT TIME ZONE $2, 'HH24:MI') AS at
     FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC, id ASC
     LIMIT 200`,
    [conversationId, timezone],
  );
  return r.rows.map((m) => ({
    speaker:
      m.direction === 'inbound'
        ? ('customer' as const)
        : m.sender_type === 'agent'
          ? ('agent' as const)
          : m.sender_type === 'bot'
            ? ('assistant' as const)
            : ('system' as const),
    content: m.body,
    at: m.at,
  }));
}

export async function runQaReview(deps: QaReviewDeps): Promise<QaRunSummary> {
  const now = deps.now?.() ?? new Date();
  const summary: QaRunSummary = {
    scanned: 0, reviewed: 0, complianceFlags: 0, invalid: 0, skipped: 0, lowAverageAlerts: 0,
  };
  if (deps.judge === null) return summary;
  const judge = deps.judge;

  // One run at a time, fleet-wide: an overlapping replay would pass every
  // per-conversation pre-check simultaneously and pay the judge twice. A
  // session advisory lock held for the run is the cheap fence.
  const fence = await deps.pool.connect();
  try {
    const lock = await fence.query<{ ok: boolean }>(
      `SELECT pg_try_advisory_lock(hashtextextended('qa-review-run', 64)) AS ok`,
    );
    if (!lock.rows[0]!.ok) return summary;

    const touchedOrgs = new Set<string>();
    // A row that failed or came back off-schema stays DUE (no row written) —
    // it must not be re-paid within the same run; the next night retries it.
    const attempted = new Set<string>();
    // Drain, not sample: '100% of the day's closed conversations' means the
    // scan repeats until it returns nothing — each judged row leaves the due
    // set, so this converges; the iteration cap is a runaway fuse, and when
    // it trips the shortfall is LOGGED, never silent.
    for (let round = 0; round < 40; round++) {
      const due = await deps.pool.query<{ organization_id: string; conversation_id: string }>(
        `SELECT organization_id, conversation_id FROM qa_due_conversations($1)`,
        [now],
      );
      const fresh = due.rows.filter((r) => !attempted.has(r.conversation_id));
      if (fresh.length === 0) {
        if (due.rows.length > 0) {
          deps.warn?.(`qa run leaving ${due.rows.length} conversations for the next night`, null);
        }
        break;
      }
      summary.scanned += fresh.length;
      for (const row of fresh) {
        attempted.add(row.conversation_id);
        touchedOrgs.add(row.organization_id);
        try {
          const outcome = await reviewOne(deps.pool, judge, deps.model, row);
          summary[outcome] += 1;
          if (outcome === 'complianceFlags') summary.reviewed += 1;
        } catch (err) {
          deps.warn?.(`qa review for conversation ${row.conversation_id} failed`, err);
          summary.skipped += 1;
        }
      }
    }

    // §9's weekly floor, checked once per touched tenant per run.
    for (const orgId of touchedOrgs) {
      try {
        const alerted = await weeklyFloorCheck(deps.pool, orgId);
        if (alerted) summary.lowAverageAlerts += 1;
      } catch (err) {
        deps.warn?.(`weekly QA floor check failed for org ${orgId}`, err);
      }
    }
    return summary;
  } finally {
    await fence
      .query(`SELECT pg_advisory_unlock(hashtextextended('qa-review-run', 64))`)
      .catch(() => {});
    fence.release();
  }
}

type ReviewOutcome = 'reviewed' | 'complianceFlags' | 'invalid' | 'skipped';

async function reviewOne(
  pool: Pool,
  judge: QaJudgeClient,
  model: string,
  row: { organization_id: string; conversation_id: string },
): Promise<ReviewOutcome> {
  return withTenant(pool, row.organization_id, async (c): Promise<ReviewOutcome> => {
    const conv = (
      await c.query<{ id: string; store_id: string; status: string; timezone: string }>(
        `SELECT cv.id, cv.store_id, cv.status, s.timezone
         FROM conversations cv JOIN stores s ON s.id = cv.store_id
         WHERE cv.id = $1 AND cv.deleted_at IS NULL`,
        [row.conversation_id],
      )
    ).rows[0];
    if (!conv || conv.status !== 'closed') return 'skipped';
    // Idempotency BEFORE the judge spend (the 0062 unique index backstops it).
    const done = await c.query(
      `SELECT 1 FROM conversation_qa_reviews
       WHERE conversation_id = $1 AND reviewer_type = 'model'`,
      [conv.id],
    );
    if (done.rows.length > 0) return 'skipped';

    const lines = await transcript(c, conv.id, conv.timezone);
    if (lines.length === 0) return 'skipped';

    const { raw, inputTokens, outputTokens } = await judge.judge({
      system: QA_JUDGE_RUBRIC,
      transcript: qaTranscript(lines),
    });
    const parsed = QaVerdict.safeParse(raw);
    if (!parsed.success) return 'invalid';
    const verdict = parsed.data;
    const { overall, complianceFail } = qaOverall(verdict.scores);
    const flags = complianceFail
      ? [...new Set(['compliance', ...verdict.flags])]
      : verdict.flags;

    const inserted = await c.query<{ id: string }>(
      `INSERT INTO conversation_qa_reviews
         (organization_id, store_id, conversation_id, reviewer_type, scores, overall,
          flags, notes, model, input_tokens, output_tokens)
       VALUES ($1,$2,$3,'model',$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (conversation_id) WHERE reviewer_type = 'model' DO NOTHING
       RETURNING id`,
      [
        row.organization_id, conv.store_id, conv.id, JSON.stringify(verdict.scores),
        overall.toFixed(2), flags, verdict.notes, model, inputTokens, outputTokens,
      ],
    );
    if (inserted.rows.length === 0) return 'skipped';

    if (complianceFail) {
      // §9: any compliance flag → HIGH, same day, to whoever owns quality
      // here (the D-045 ladder: sales_manager, then gm, then owner).
      const ladder = await escalationLadder(c, row.organization_id);
      const target = ladder[0];
      if (target) {
        await notify(c, {
          organizationId: row.organization_id,
          userId: target,
          urgency: 'high',
          titleKey: 'notif_qa_compliance_flag',
          params: { flags: flags.slice(0, 3).join(', ') },
          link: `/conversations/${conv.id}`,
          entityType: 'conversation',
          entityId: conv.id,
        });
      }
      return 'complianceFlags';
    }
    return 'reviewed';
  });
}

/** MEDIUM when the 7-day tenant average sits under 4.2 — at most once a day. */
async function weeklyFloorCheck(pool: Pool, organizationId: string): Promise<boolean> {
  return withTenant(pool, organizationId, async (c) => {
    const avg = await c.query<{ avg: string | null; n: string }>(
      `SELECT avg(overall)::text AS avg, count(*)::text AS n
       FROM conversation_qa_reviews
       WHERE organization_id = $1 AND reviewer_type = 'model'
         AND created_at >= now() - interval '7 days'`,
      [organizationId],
    );
    const n = Number(avg.rows[0]?.n ?? '0');
    const value = avg.rows[0]?.avg === null ? null : Number(avg.rows[0]!.avg);
    // A floor over three conversations is noise, not a trend.
    if (value === null || n < 5 || value >= WEEKLY_FLOOR) return false;

    const ladder = await escalationLadder(c, organizationId);
    const target = ladder[0];
    if (!target) return false;
    const recent = await c.query(
      `SELECT 1 FROM notifications
       WHERE user_id = $1 AND title_key = 'notif_qa_weekly_low'
         AND created_at > now() - interval '20 hours' LIMIT 1`,
      [target],
    );
    if (recent.rows.length > 0) return false;
    await notify(c, {
      organizationId,
      userId: target,
      urgency: 'medium',
      titleKey: 'notif_qa_weekly_low',
      params: { average: value.toFixed(2) },
      link: `/conversations`,
      entityType: 'organization',
      entityId: organizationId,
    });
    return true;
  });
}
