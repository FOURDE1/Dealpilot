import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Pool } from '@dealpilot/db';
import { JOB_QUEUES, QueueName, type QueueNameT } from '@dealpilot/contracts';
import { AdminDlqQuery, RetryJobsInput, type QueueStateT } from '@dealpilot/schemas';
import { AppError, notFound, parseOrThrow } from './errors.js';
import { definer } from './f69-admin-routes.js';
import { requirePlatform } from './platform.js';
import { DLQ_POSITION_MAX, DLQ_SCAN_MAX, FIELD_VALUE_MAX, type InspectorJob, type QueueInspector } from './queue-inspector.js';

/**
 * F-73 §9 — the job inspector, read half (admin-console.md §9/§11).
 *
 * Two handlers: the ten-row queue list, and one position-addressed page of a
 * queue's failed set. Both are reads, and both are honest about three things
 * the obvious implementation gets wrong.
 *
 * WHAT A DLQ ROW SHOWS. Not the payload — an allow-list of identifiers per
 * queue, `JOB_QUEUES[name].dlq_fields`, checked against each queue's own Zod
 * shape by `packages/contracts/src/queue-catalogue.test.ts`. The contracts
 * header claims a payload never carries a message body and
 * `DeferredSendJob.body` is exactly that: up to 1600 characters of a real
 * dealer customer's SMS, carried because it cannot be re-derived. A generic
 * payload viewer would render dealer customers' text messages into the
 * platform console, and a DENYlist would fail open on the next queue somebody
 * adds. `failed_reason` is the one field an allow-list structurally cannot
 * cover, so it goes through `redactFailedReason` and a length cap instead.
 *
 * WHAT A TENANT FILTER MEANS. Four of the ten queues carry no
 * `organization_id` at all — `drip-tick`, `qa-review` and `task-sweep` have no
 * payload, and `announcement-fanout` deliberately has none because an
 * announcement belongs to no tenant. Asking those for one tenant's failures is
 * REFUSED, never answered with an empty page: an empty page reads as "this
 * tenant has no failures", which on those four is a lie by construction.
 *
 * WHAT A PAGE IS. The failed set is a live capped zset with no stable sort key
 * the client can carry, so paging is by POSITION and the response says so
 * (`paging_basis`). Entries genuinely shift between pages as jobs are retried
 * or evicted; the i18n caption states it. `scanned` reports how many ids the
 * range read actually returned, so the tenant filter's cost — it runs here, in
 * TypeScript, because a queue is not indexed by organization — is visible
 * rather than hidden behind a short page. And the invariant the scan window
 * makes easy to break: EVERY MATCHING FAILED JOB IS REACHABLE BY PAGING. One
 * window can hold more matches than a page shows, so the cursor is built from
 * the last row actually returned rather than from the window — `nextStart`
 * below is where that is done and why.
 *
 * AND ONE MUTATION. `POST /api/v1/admin/queues/:name/dlq/retry` is the third
 * handler and the dangerous one: a retry on `deferred-send`, `assistant-turn`,
 * `first-touch` or `drip-tick` can put a SECOND SMS in front of a real dealer
 * customer, because those workers stamp `provider_ref` only after the carrier
 * answers — so a carrier timeout leaves a message DELIVERED with a null ref,
 * which is one of the likeliest reasons the job is in this queue at all, and
 * re-running it sends the text again. Nothing on that path dedupes. The five
 * controls are all here and all mechanical: the `queues:retry` capability, the
 * queue name typed back on those four queues, twenty ids at most, a reason of
 * ten characters, and the register row filed BEFORE anything is requeued.
 */

/**
 * The DLQ's own cursor, and why it is not `encodeCursor`/`decodeCursor`.
 *
 * The shared codec (`f01-routes.ts:125`) parses `{ c: PG_TIMESTAMPTZ, id: Uuid }`
 * BEFORE the caller sees anything, and a DLQ cursor is neither: the key is a
 * zset POSITION and a BullMQ job id is not a uuid (`lead:{uuid}:first-touch`,
 * or plain `"42"`). Every second page would have come back 400 `invalid_cursor`.
 * Same base64url-JSON envelope, same rule that a tampered cursor is a 400 and
 * never a 500 — a different payload, because the paging basis is different.
 *
 * `n` and `f` are carried so a cursor cannot be replayed against another queue
 * or under a different tenant filter, where the position it names would
 * address rows nobody asked for. `o` is bounded HERE so a forged position is
 * refused before any Redis command is issued.
 */
const DlqCursor = z.object({
  n: QueueName,
  o: z.number().int().min(0).max(DLQ_POSITION_MAX),
  f: z.uuid().nullable(),
});
type DlqCursorT = z.infer<typeof DlqCursor>;

function encodeDlqCursor(cursor: DlqCursorT): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeDlqCursor(raw: string): DlqCursorT {
  try {
    return DlqCursor.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
  } catch {
    throw new AppError(400, 'invalid_cursor', 'The pagination cursor is not valid');
  }
}

interface DlqField {
  key: string;
  value: string;
}

/**
 * What a DLQ row puts on the wire — and no more.
 *
 * `job_name`, `attempts_made` and `enqueued_at` were here and are gone. The
 * screen renders the job id, the failed instant, the allow-listed fields, the
 * failed reason and the first stack line; nothing anywhere read the other
 * three, and a field with a producer and no consumer is the dead vocabulary
 * this repo bans. `job_name` was the worst of them: every producer in the repo
 * passes the queue-name constant as the job name, so it was a second copy of
 * the path segment the caller just addressed — the duplication `AdminRetryResult`
 * refuses by name. If the retry screen later wants an attempt count, it comes
 * back together with the column that renders it, not before.
 */
interface DlqItem {
  job_id: string;
  failed_at: string | null;
  failed_reason: string | null;
  first_stack_line: string | null;
  fields: DlqField[];
}

const instantOf = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

/**
 * The allow-list applied, with the runtime type checked rather than assumed.
 *
 * The allow-list guarantees the KEY set; it says nothing about what is at that
 * key at runtime. This route reads the RAW Redis hash — `getJob` hands back
 * exactly what some producer, possibly an older deploy's, wrote — so NO parse
 * has run on this path, whatever is done with the same bytes elsewhere.
 *
 * Which is worth stating that way round, because the workers DO parse: six of
 * the seven payload-carrying queues open their runner with
 * `Schema.parse(job.data)` — `deferred-send.ts:71`, `assistant-turn.ts:90`,
 * `ai-extraction.ts:58`, `first-touch.ts:245`, `live-analysis.ts:70`,
 * `announcement-fanout.ts:58` — so `packages/contracts/src/queues.ts`'s
 * "payloads are Zod-parsed on BOTH sides" is honoured on the consuming side
 * for all of them. The one exception is `lead-reassign`, whose runner takes a
 * pre-typed `LeadReassignJobT` (`lead-reassign.ts:50`) and parses nothing;
 * that single queue is where the contracts header is actually untrue. None of
 * it helps here, because none of it has happened yet to the hash this handler
 * is reading.
 *
 * So: a string or a number is emitted, and every other runtime type — object,
 * array, boolean, null, undefined — is DROPPED. Not `String(v)`, which renders
 * an object as `[object Object]`, and certainly not `JSON.stringify`, which
 * would leak the object the allow-list exists to keep out.
 */
function fieldsOf(name: QueueNameT, data: unknown): DlqField[] {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return [];
  const raw = data as Record<string, unknown>;
  const fields: DlqField[] = [];
  for (const key of JOB_QUEUES[name].dlq_fields) {
    const value = raw[key];
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    fields.push({ key, value: String(value).slice(0, FIELD_VALUE_MAX) });
  }
  return fields;
}

/** The tenant filter reads the RAW payload: the projection has already dropped types. */
function belongsTo(job: InspectorJob, organizationId: string): boolean {
  const data = job.data;
  if (typeof data !== 'object' || data === null) return false;
  return (data as Record<string, unknown>)['organization_id'] === organizationId;
}

const itemOf = (name: QueueNameT, job: InspectorJob): DlqItem => ({
  job_id: job.id,
  failed_at: instantOf(job.failed_at_ms),
  failed_reason: job.failed_reason,
  first_stack_line: job.first_stack_line,
  fields: fieldsOf(name, job.data),
});

export function registerF73QueueRoutes(app: FastifyInstance, pool: Pool, inspector: QueueInspector): void {
  app.get('/api/v1/admin/queues', async (request, reply) => {
    requirePlatform(request, 'queues:read');
    const depths = await inspector.depths();
    return reply.send({
      items: depths.map((d) => ({
        name: d.name,
        // The client cannot know which queues accept a tenant filter, and
        // guessing costs it a 422. It is derived from the payload shape, so
        // this is a fact about the queue, not a second declaration of one.
        org_scoped: JOB_QUEUES[d.name].org_scoped,
        queue_state: d.queue_state,
        counts: d.counts,
      })),
    });
  });

  app.get('/api/v1/admin/queues/:name/dlq', async (request, reply) => {
    requirePlatform(request, 'queues:read');
    // An unknown queue is a 404 and the body names nothing — the
    // `PlatformSettingKey` precedent (`f72-killswitch-routes.ts:59`). A 422
    // listing the ten valid names would tell an attacker what this platform
    // runs.
    const parsed = QueueName.safeParse((request.params as { name?: string }).name);
    if (!parsed.success) throw notFound();
    const name: QueueNameT = parsed.data;
    const query = parseOrThrow(AdminDlqQuery, request.query);
    const filter = query.organization_id ?? null;

    if (filter !== null && !JOB_QUEUES[name].org_scoped) {
      throw new AppError(422, 'validation_failed', 'This queue’s jobs carry no organization, so they cannot be filtered by tenant', [
        { path: 'organization_id', code: 'queue_not_org_scoped', message: name },
      ]);
    }

    let start = 0;
    if (query.cursor !== undefined) {
      const cursor = decodeDlqCursor(query.cursor);
      // A cursor is a position IN one queue UNDER one filter. Replayed
      // anywhere else the position is meaningless, and silently honouring it
      // would return rows the caller did not ask for.
      if (cursor.n !== name || cursor.f !== filter) {
        throw new AppError(400, 'invalid_cursor', 'The pagination cursor is not valid');
      }
      start = cursor.o;
    }

    // With no filter the window is the page. With one, every projected payload
    // has to be read to know whether it matches, so the window is the scan
    // ceiling and the page is honestly "the first matches within it".
    const window = Math.min(filter === null ? query.limit : DLQ_SCAN_MAX, DLQ_POSITION_MAX - start);
    const page = window > 0
      ? await inspector.failed(name, start, window)
      : { queue_state: 'ok' as QueueStateT, jobs: [] as readonly InspectorJob[], scanned: 0 };

    const matched = filter === null ? page.jobs : page.jobs.filter((j) => belongsTo(j, filter));
    const shown = matched.slice(0, query.limit);
    const items = shown.map((j) => itemOf(name, j));

    /*
     * THE CURSOR MAY NEVER OUTRUN THE ROWS THE CALLER WAS SHOWN.
     *
     * Under a tenant filter the window is the SCAN CEILING and the page is
     * `limit`, so one window can hold more matches than fit on it. Advancing by
     * `page.scanned` there — the whole window — discards every match already
     * read past the limit AND steps the next cursor over it, so no page can
     * ever address it again: a tenant with forty failed sends inside the first
     * five hundred positions is shown twenty-five and paged straight to
     * position five hundred, with `scanned: 500` reading as thoroughness.
     * Worse on a short failed set, where `page.scanned === window` is false and
     * the response then also says `next_cursor: null` — the console asserting
     * there is nothing more, over rows it had just discarded.
     *
     * So when matches were held back, the next position is the one after the
     * last row actually returned (`scan_offset` is that row's real place in the
     * range read, evicted ids counted), and there IS more, whatever the window
     * did. Otherwise nothing was held back and the old rule stands: a full
     * window means more zset behind it, a short one is the end of the failed
     * set, and the position ceiling is the end of what this console pages at
     * all. Every match is therefore reachable: a page either shows a matching
     * row or leaves the cursor before it.
     */
    const resumeAfter = matched.length > shown.length ? shown[shown.length - 1] : undefined;
    const nextStart = resumeAfter === undefined ? start + page.scanned : start + resumeAfter.scan_offset + 1;
    const more =
      page.queue_state === 'ok' &&
      nextStart < DLQ_POSITION_MAX &&
      (resumeAfter !== undefined || page.scanned === window);

    return reply.send({
      queue: name,
      queue_state: page.queue_state,
      org_scoped: JOB_QUEUES[name].org_scoped,
      /** Not keyset: the failed set has no stable key a client can carry. */
      paging_basis: 'position',
      scanned: page.scanned,
      items,
      next_cursor: more ? encodeDlqCursor({ n: name, o: nextStart, f: filter }) : null,
    });
  });

  /**
   * Put named failed jobs back on the queue (admin-console.md §9, §11; D-074).
   *
   * THE ORDER BELOW IS THE CONTROL, and it is the whole reason this handler
   * reads the way it does:
   *
   *   capability -> queue name (404) -> body -> the typed-back confirm ->
   *   the unconfigured short-circuit -> the register row -> the loop ->
   *   the WARN line -> 200
   *
   * The register row is filed BEFORE any job is touched, and the event is
   * named `queue.retry_requested` for that reason: at the moment it is written
   * no outcome is known, and it would be a false claim to say otherwise.
   * Redis and Postgres cannot commit together, so one of the two windows has to
   * exist — either a retry that no row records, or a row recording a retry that
   * did not happen. §9 requires actions to be audited, so the fail-closed
   * direction is over-recording, which is what D-073 already chose for the kill
   * switches. The `not_attempted` outcome is what makes that honest on the way
   * back out.
   *
   * `not_configured` is the one path that writes NO row: with no REDIS_URL
   * nothing was attempted and nothing was even asked. A configured queue that
   * does not ANSWER is the opposite case and IS recorded — a request was made
   * against a queue that exists, every id comes back `not_attempted`, and the
   * register says it was asked for.
   *
   * 200 whatever happened. Twenty ids can land on five different outcomes in
   * one request and there is no status code for that; the per-id list is the
   * answer, and `queue_state` says whether the queue could be reached at all.
   */
  app.post('/api/v1/admin/queues/:name/dlq/retry', async (request, reply) => {
    const actor = requirePlatform(request, 'queues:retry');
    const parsed = QueueName.safeParse((request.params as { name?: string }).name);
    if (!parsed.success) throw notFound();
    const name: QueueNameT = parsed.data;
    const input = parseOrThrow(RetryJobsInput, request.body);

    // The confirm gate, at n >= 1 and not n > 1: under CASL the harm is ONE
    // duplicated text to a real person, so there is no free first job. Which
    // queues need it is `replay`, derived nowhere and asserted everywhere —
    // apps/workers/src/queue-replay.test.ts holds each `idempotent` claim to a
    // literal in the worker file that makes it true, so reclassifying a send
    // queue to slip past this gate turns that guard red.
    if (JOB_QUEUES[name].replay === 'at_least_once' && input.confirm_queue_name !== name) {
      throw new AppError(422, 'validation_failed', 'Type the queue name to confirm — a retry here can send a customer a second message', [
        { path: 'confirm_queue_name', code: 'key_mismatch', message: 'The name does not match' },
      ]);
    }

    if (!inspector.configured) {
      // The same fields under the same token whatever happened: a drain that
      // alerts on `retried` or on `queueState` must not have to know which of
      // two shapes this line took.
      request.log.warn(
        {
          queue: name,
          requested: input.job_ids.length,
          retried: 0,
          organizations: 0,
          queueState: 'not_configured',
          staffUserId: actor.userId,
          role: actor.role,
        },
        'platform_queue_retry_result',
      );
      // No register row: nothing was attempted, and §12's register records
      // acts. An event here would be an audit trail of a button press.
      return reply.send({ queue_state: 'not_configured' as QueueStateT, outcomes: [] });
    }

    // Read before the row is written, because the row has to carry it: the
    // register's `organizations` is what answers "whose customer got the second
    // SMS", and it cannot be asked for after the fact or taken from the client.
    // Empty on the four queues whose jobs name no tenant, and empty again when
    // Redis is unreachable — never a guess, and never a reason not to audit.
    const organizationIds = await inspector.organizationsOf(name, input.job_ids);

    await definer(() =>
      pool.query('SELECT admin_record_queue_retry($1::uuid, $2::text, $3::text[], $4::uuid[], $5::text)', [
        actor.userId,
        name,
        input.job_ids,
        organizationIds,
        input.reason,
      ]),
    );

    const result = await inspector.retry(name, input.job_ids);
    const retried = result.outcomes.filter((o) => o.retry_outcome === 'retried').length;

    // A stable token a log drain can alert on, the `platform_killswitch_flipped`
    // precedent — and named `_result` rather than `_jobs_retried` because the
    // request and its result are two different facts, filed at two different
    // moments, and only this one knows what happened.
    request.log.warn(
      {
        queue: name,
        requested: input.job_ids.length,
        retried,
        organizations: organizationIds.length,
        queueState: result.queue_state,
        staffUserId: actor.userId,
        role: actor.role,
      },
      'platform_queue_retry_result',
    );

    return reply.send({ queue_state: result.queue_state, outcomes: result.outcomes });
  });
}
