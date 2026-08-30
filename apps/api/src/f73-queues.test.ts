import { afterEach, afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, testAppUrl, type Pool } from '@dealpilot/db';
import { JOB_QUEUES, JOB_QUEUE_NAMES, type QueueNameT } from '@dealpilot/contracts';
import {
  AdminDlqPage,
  AdminQueueDepthList,
  AdminRetryResult,
  RETRY_MAX_JOBS,
  RetryOutcome,
  type QueueStateT,
  type RetryOutcomeT,
} from '@dealpilot/schemas';
import { buildApp } from './app.js';
import {
  DLQ_POSITION_MAX,
  DLQ_SCAN_MAX,
  FAILED_REASON_MAX,
  redactFailedReason,
  retryOutcomeOf,
  type FailedPage,
  type InspectorJob,
  type QueueDepth,
  type QueueInspector,
} from './queue-inspector.js';
import { enrol, signInWithTotp } from './testing/totp.js';

/**
 * F-73 §9 — the job inspector's READ routes, with the Redis taken out.
 *
 * Every case here runs against an INJECTED inspector, so what is under test is
 * the console's own behaviour rather than BullMQ's: which staffer may look,
 * what a row is allowed to show, what happens when the queue cannot be
 * reached, and whether a page can be paged. The real-Redis half — that a
 * `Queue` handle actually answers, that `getRanges` positions a page, that an
 * unreachable Redis is bounded and closes cleanly — lives in
 * `f73-queue-inspector.test.ts`, which needs a Redis and nothing else.
 *
 * The split is deliberate and is what makes both halves runnable: a console
 * test that needed a message broker would be skipped on every machine that
 * does not set REDIS_URL, which is every developer machine, and a route this
 * dangerous cannot be guarded by a test that usually does not run.
 *
 * The retry half below is the reason that matters. Its subject is ORDER — the
 * register row is filed before any job is put back, and is not filed at all
 * when there is no queue to ask — and order is invisible to a type, to a
 * schema and to a reviewer reading a diff. So the fake records what the
 * register already held at the instant the loop ran, and both mutations the
 * plan names (move the definer after the loop; audit before the unconfigured
 * short-circuit) turn a test red rather than a comment stale.
 */

const ADMIN_URL = testAdminUrl();
const APP_URL = testAppUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'db', 'migrations');
const run = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';

let admin: Pool;
let app: Awaited<ReturnType<typeof buildApp>>['app'] | undefined;
let dbUp = false;

let superCookie = ''; let superId = '';
let supportCookie = '';
let billingCookie = '';
let ownerCookie = ''; let orgId = ''; let colleagueId = '';

/**
 * The injected inspector: a script the test writes and the route reads.
 *
 * Not a stub that always answers the same thing — every interesting case here
 * is about a DIFFERENT answer from the queue layer (unreachable, not
 * configured, a short window, a payload the schema did not promise), and a
 * shared fixture that could only say "ok, here are two jobs" would let a
 * broken route look green in all of them.
 */
interface FakeInspector extends QueueInspector {
  script: {
    configured: boolean;
    depths: QueueDepth[];
    failed: (name: QueueNameT, start: number, count: number) => FailedPage;
    calls: { name: QueueNameT; start: number; count: number }[];
    /** What the attribution read finds, and whether it was asked at all. */
    organizations: string[];
    organizationCalls: { name: QueueNameT; jobIds: readonly string[] }[];
    /** What the requeue answers — every state and every outcome is scriptable. */
    retryState: QueueStateT;
    outcome: (jobId: string) => RetryOutcomeT;
    retryCalls: { name: QueueNameT; jobIds: readonly string[] }[];
    /**
     * How many `queue.retry_requested` rows the register held at the instant
     * the loop ran. This is the audit-first proof: nothing else in the process
     * can see whether the definer was called BEFORE or AFTER, and a fake that
     * merely counted calls would be green under either order.
     */
    auditRowsAtRetry: number | null;
  };
}

const emptyPage: FailedPage = { queue_state: 'ok', jobs: [], scanned: 0 };

const freshScript = (): FakeInspector['script'] => ({
  configured: true,
  depths: JOB_QUEUE_NAMES.map((name) => ({ name, queue_state: 'ok' as const, counts: { failed: 0, waiting: 0 } })),
  failed: () => emptyPage,
  calls: [],
  organizations: [],
  organizationCalls: [],
  retryState: 'ok',
  outcome: () => 'retried',
  retryCalls: [],
  auditRowsAtRetry: null,
});

function fakeInspector(): FakeInspector {
  const script = freshScript();
  return {
    script,
    get configured() {
      return script.configured;
    },
    async depths() {
      return script.depths;
    },
    async failed(name, start, count) {
      script.calls.push({ name, start, count });
      return script.failed(name, start, count);
    },
    async organizationsOf(name, jobIds) {
      script.organizationCalls.push({ name, jobIds });
      return script.organizations;
    },
    async retry(name, jobIds) {
      script.retryCalls.push({ name, jobIds });
      // Read HERE, inside the loop's own moment: what the register already
      // holds is the only observable difference between auditing first and
      // auditing last.
      script.auditRowsAtRetry = await retryEventCount();
      return { queue_state: script.retryState, outcomes: jobIds.map((id) => ({ job_id: id, retry_outcome: script.outcome(id) })) };
    },
    async close() {},
  };
}

const inspector = fakeInspector();

function jobRow(over: Partial<InspectorJob> = {}): InspectorJob {
  return {
    id: 'job-1',
    // Where the row sat in the range read. The default is 0 because most cases
    // here hand back one window and never page it; the case that DOES page a
    // filtered window sets a real offset per row, because that is the number
    // the cursor is built from.
    scan_offset: 0,
    failed_at_ms: Date.UTC(2026, 7, 30, 12, 0, 30),
    failed_reason: null,
    first_stack_line: null,
    data: {},
    ...over,
  };
}

function cookiesOf(res: { headers: Record<string, unknown> }): string {
  const sc = res.headers['set-cookie'];
  const list = Array.isArray(sc) ? sc : sc ? [String(sc)] : [];
  return list.map((c) => String(c).split(';')[0] ?? '').filter((c) => c !== '' && !c.endsWith('=')).join('; ');
}

async function signUp(email: string, name: string): Promise<string> {
  const res = await app!.inject({ method: 'POST', url: '/api/auth/sign-up/email', payload: { email, password: PASSWORD, name } });
  expect(res.statusCode, res.body).toBe(200);
  return cookiesOf(res);
}

async function userId(email: string): Promise<string> {
  return (await admin.query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [email])).rows[0]!.id;
}

/** Grant + enrol + sign in through TOTP: a console-ready staffer (the F-69 helper). */
async function staffer(email: string, name: string, role: string, actor: string | null): Promise<string> {
  const first = await signUp(email, name);
  await admin.query('SELECT * FROM platform_staff_grant($1, $2, $3, $4)', [actor, email, role, 'test fixture']);
  const { secret } = await enrol(app!, first, PASSWORD);
  return signInWithTotp(app!, email, PASSWORD, secret);
}

/**
 * Every 200 below is parsed by the CONTRACT schema before the case sees it.
 *
 * Without this the Zod schemas in `packages/schemas` and the shapes these
 * routes build are two independent declarations of one wire format with
 * nothing holding them together: the web client parses them, but every web
 * test mocks `./api.js` wholesale, and every case here reads raw JSON. A route
 * that started sending `failed_at` as a Date, or dropped a field the client
 * parses, would be caught by nothing. Parsing HERE makes the schema the source
 * of truth on every request the suite makes, and it costs one line each.
 */
async function listQueues(cookie = superCookie) {
  const res = await app!.inject({ method: 'GET', url: '/api/v1/admin/queues', headers: { cookie } });
  if (res.statusCode === 200) AdminQueueDepthList.parse(JSON.parse(res.body));
  return res;
}

async function dlq(name: string, query = '', cookie = superCookie) {
  const res = await app!.inject({ method: 'GET', url: `/api/v1/admin/queues/${name}/dlq${query}`, headers: { cookie } });
  if (res.statusCode === 200) AdminDlqPage.parse(JSON.parse(res.body));
  return res;
}

const REASON = 'Ticket SUP-7314: the carrier timed out and the send never completed';

async function retryJobs(name: string, payload: Record<string, unknown>, cookie = superCookie) {
  const res = await app!.inject({ method: 'POST', url: `/api/v1/admin/queues/${name}/dlq/retry`, headers: { cookie }, payload });
  if (res.statusCode === 200) AdminRetryResult.parse(JSON.parse(res.body));
  return res;
}

/** The register as the register itself sees it, never the route's word for it. */
async function retryEventCount(): Promise<number> {
  if (!dbUp) return 0;
  const r = await admin.query<{ n: string }>(
    `SELECT count(*) AS n FROM platform_audit_events WHERE event = 'queue.retry_requested'`,
  );
  return Number(r.rows[0]!.n);
}

/** A cursor as a CLIENT would present one — including one nobody should mint. */
function forgeCursor(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

beforeAll(async () => {
  await ensureTestDatabase();
  admin = createPool({ connectionString: ADMIN_URL, max: 2 });
  try {
    await admin.query('SELECT 1');
    dbUp = true;
  } catch {
    if (process.env['RLS_REQUIRED']) throw new Error('RLS_REQUIRED set but database unreachable');
    return;
  }
  await reset(admin, migrationsDir, ADMIN_URL);
  ({ app } = await buildApp(
    { DATABASE_URL: APP_URL, NODE_ENV: 'test' },
    {
      queueInspector: inspector,
      // A dozen TOTP sign-ins in a few seconds is far past the F-44 per-IP
      // budget; the limiter is its own suite's concern and is injected open.
      rateLimiter: { take: async () => ({ allowed: true, retryAfterS: 0 }), close: async () => {} },
    },
  ));

  const superEmail = `f73q-super-${run}@dealpilot.test`;
  superCookie = await staffer(superEmail, 'Super Admin', 'platform_super_admin', null);
  superId = await userId(superEmail);
  supportCookie = await staffer(`f73q-support-${run}@dealpilot.test`, 'Soutien', 'platform_support', superId);
  billingCookie = await staffer(`f73q-billing-${run}@dealpilot.test`, 'Facturation', 'platform_billing', superId);

  // A real tenant, provisioned through the real routes — the impersonation
  // case needs somebody to impersonate, and a hand-written organizations row
  // would be testing the database.
  ownerCookie = await signUp(`f73q-owner-${run}@dealpilot.test`, 'Patronne');
  const org = await app!.inject({
    method: 'POST', url: '/api/v1/organizations', headers: { cookie: ownerCookie },
    payload: { name: 'Groupe File d’attente', slug: `groupe-file-${run}` },
  });
  expect(org.statusCode, org.body).toBe(201);
  orgId = (JSON.parse(org.body) as { id: string }).id;
  const colleagueEmail = `f73q-vendeur-${run}@dealpilot.test`;
  await signUp(colleagueEmail, 'Vendeur');
  colleagueId = await userId(colleagueEmail);
  const added = await app!.inject({
    method: 'POST', url: '/api/v1/members', headers: { cookie: ownerCookie },
    payload: { organization_id: orgId, email: colleagueEmail, name: 'Vendeur', roles: ['salesperson'] },
  });
  expect(added.statusCode, added.body).toBe(201);
});

afterAll(async () => {
  await app?.close();
  await admin?.end();
});

// Nothing may carry a scripted queue state into the next case.
afterEach(() => {
  // Wholesale, not field by field: a script that grows a key nobody remembers
  // to reset is how one test's queue state leaks into the next one's verdict.
  Object.assign(inspector.script, freshScript());
});

describe('who may look at a queue (§3, §11)', () => {
  it('support may read the queues; billing may not, and is told which capability', async (ctx) => {
    if (!dbUp) return ctx.skip();
    expect((await listQueues(supportCookie)).statusCode).toBe(200);
    const refused = await listQueues(billingCookie);
    expect(refused.statusCode, refused.body).toBe(403);
    // MUTATION: add 'platform_billing' to queues:read in platform.ts → red.
    expect(JSON.parse(refused.body)).toMatchObject({
      error: { code: 'forbidden', details: [{ path: 'capability', message: 'queues:read' }] },
    });
    expect((await dlq('deferred-send', '', billingCookie)).statusCode).toBe(403);
  });

  it('the queue routes are closed during a live support session', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const opened = await app!.inject({
      method: 'POST', url: '/api/v1/admin/impersonation-sessions', headers: { cookie: superCookie },
      payload: { tenant_id: orgId, target_user_id: colleagueId, mode: 'read_only', reason: 'Ticket SUP-7301: the assistant never answered this thread' },
    });
    expect(opened.statusCode, opened.body).toBe(201);
    const sessionId = (JSON.parse(opened.body) as { id: string }).id;
    try {
      // Reading a queue is not an emergency stop, so it does not join
      // ADMIN_ALLOWED_DURING: a look filed during a session would carry two
      // audit contexts for one act.
      const requeue = await retryJobs('deferred-send', { job_ids: ['1'], reason: REASON, confirm_queue_name: 'deferred-send' });
      for (const res of [await listQueues(), await dlq('deferred-send'), requeue]) {
        expect(res.statusCode, res.body).toBe(409);
        expect(JSON.parse(res.body)).toMatchObject({ error: { code: 'impersonation_active' } });
      }
      // The mutation matters most on this one: a requeue filed during a
      // support session would carry two audit contexts for one act, and the
      // one that sent a customer a second SMS is the one that must not be
      // ambiguous about who did it.
      expect(inspector.script.retryCalls, 'a job was requeued from inside a support session').toEqual([]);
    } finally {
      await app!.inject({ method: 'DELETE', url: `/api/v1/admin/impersonation-sessions/${sessionId}`, headers: { cookie: superCookie } });
    }
  });
});

describe('the queue list says whether it could ask (§9)', () => {
  it('lists every queue with whether it can be filtered by tenant', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const body = JSON.parse((await listQueues()).body) as { items: { name: string; org_scoped: boolean }[] };
    expect(body.items.map((i) => i.name).sort()).toEqual([...JOB_QUEUE_NAMES].sort());
    const scoped = Object.fromEntries(body.items.map((i) => [i.name, i.org_scoped]));
    // Derived from each payload's Zod shape, never hand-typed — the four
    // without an organization_id are the three payload-less queues and the
    // fan-out, which deliberately belongs to no tenant.
    expect(scoped['deferred-send']).toBe(true);
    expect(scoped['drip-tick']).toBe(false);
    expect(scoped['qa-review']).toBe(false);
    expect(scoped['task-sweep']).toBe(false);
    expect(scoped['announcement-fanout']).toBe(false);
  });

  it('an unreachable Redis is said out loud, with null counts — never zeros, never a 503', async (ctx) => {
    if (!dbUp) return ctx.skip();
    inspector.script.depths = JOB_QUEUE_NAMES.map((name) => ({ name, queue_state: 'unreachable' as const, counts: null }));
    const res = await listQueues();
    // MUTATION: answer 503 here and the console loses the only screen that can
    // tell a stuck queue from a quiet one.
    expect(res.statusCode, res.body).toBe(200);
    const body = JSON.parse(res.body) as { items: { queue_state: string; counts: unknown }[] };
    for (const item of body.items) {
      expect(item.queue_state).toBe('unreachable');
      expect(item.counts).toBeNull();
      expect(item.counts).not.toEqual({});
    }
  });

  it('with no queue configured the console says so, never an empty DLQ', async (ctx) => {
    if (!dbUp) return ctx.skip();
    inspector.script.configured = false;
    inspector.script.depths = JOB_QUEUE_NAMES.map((name) => ({ name, queue_state: 'not_configured' as const, counts: null }));
    inspector.script.failed = () => ({ queue_state: 'not_configured', jobs: [], scanned: 0 });

    const list = JSON.parse((await listQueues()).body) as { items: { queue_state: string }[] };
    expect(new Set(list.items.map((i) => i.queue_state))).toEqual(new Set(['not_configured']));

    // MUTATION: return the empty list with queue_state 'ok' → red. An empty
    // list under 'ok' is the console asserting nothing has failed, which it
    // has no way of knowing.
    const page = JSON.parse((await dlq('deferred-send')).body) as { queue_state: string; items: unknown[] };
    expect(page.queue_state).toBe('not_configured');
    expect(page.items).toEqual([]);
  });
});

describe('addressing a queue (§9)', () => {
  it('an unknown queue name is 404 and the body names no queue', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const res = await dlq('deferred-sends');
    expect(res.statusCode, res.body).toBe(404);
    // A 422 enumerating the ten valid names would tell a caller what this
    // platform runs. The PlatformSettingKey precedent.
    for (const name of JOB_QUEUE_NAMES) expect(res.body).not.toContain(name);
    expect(inspector.script.calls).toEqual([]);
  });

  it('a queue whose jobs carry no organization refuses a tenant filter, and never answers an empty page', async (ctx) => {
    if (!dbUp) return ctx.skip();
    for (const name of ['drip-tick', 'qa-review', 'task-sweep', 'announcement-fanout']) {
      const res = await dlq(name, `?organization_id=${orgId}`);
      expect(res.statusCode, `${name}: ${res.body}`).toBe(422);
      expect(JSON.parse(res.body)).toMatchObject({
        error: { code: 'validation_failed', details: [{ path: 'organization_id', code: 'queue_not_org_scoped', message: name }] },
      });
    }
    // MUTATION: ignore the filter and return the unfiltered page → red. The
    // queue was never asked at all, which is the point: an empty page on these
    // four reads as "this tenant has no failures" and is a lie by construction.
    expect(inspector.script.calls).toEqual([]);
    // The same filter on a queue that carries organization_id is honoured.
    expect((await dlq('deferred-send', `?organization_id=${orgId}`)).statusCode).toBe(200);
    expect(inspector.script.calls).toHaveLength(1);
  });

  it('filters by tenant on the raw payload, and scans the ceiling rather than the page size', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const mine = jobRow({ id: 'mine', data: { organization_id: orgId, conversation_id: orgId } });
    const theirs = jobRow({ id: 'theirs', data: { organization_id: '00000000-0000-4000-8000-000000000001' } });
    inspector.script.failed = () => ({ queue_state: 'ok', jobs: [theirs, mine, theirs], scanned: 3 });

    const body = JSON.parse((await dlq('deferred-send', `?organization_id=${orgId}&limit=2`)).body) as {
      items: { job_id: string }[]; scanned: number;
    };
    expect(body.items.map((i) => i.job_id)).toEqual(['mine']);
    // `scanned` is the ids the range read returned, not the rows shown — so
    // the filter's cost is visible instead of hiding behind a short page.
    expect(body.scanned).toBe(3);
    expect(inspector.script.calls[0]).toEqual({ name: 'deferred-send', start: 0, count: DLQ_SCAN_MAX });
  });
});

describe('what a DLQ row may show (§9, the PII rule)', () => {
  it('never carries a message body, whatever the payload holds', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const CUSTOMER_TEXT = 'Bonjour, je passe demain 14h pour la Corolla — merci!';
    inspector.script.failed = () => ({
      queue_state: 'ok',
      scanned: 1,
      jobs: [jobRow({
        data: {
          organization_id: orgId,
          conversation_id: '00000000-0000-4000-8000-000000000002',
          send_decision_id: '00000000-0000-4000-8000-000000000003',
          body: CUSTOMER_TEXT,
          sender_type: 'bot',
          message_class: 'inbound_reply',
          attempt: 2,
        },
      })],
    });
    const res = await dlq('deferred-send');
    const body = JSON.parse(res.body) as { items: { fields: { key: string; value: string }[] }[] };
    const keys = body.items[0]!.fields.map((f) => f.key);
    // MUTATION: add 'body' to JOB_QUEUES['deferred-send'].dlq_fields → this
    // and packages/contracts/src/queue-catalogue.test.ts both go red. (This
    // half needs `tsc -p packages/contracts` first: apps/api resolves
    // @dealpilot/contracts to its dist, so a src-only edit is invisible here.)
    expect(keys).not.toContain('body');
    expect(keys.sort()).toEqual(['attempt', 'conversation_id', 'message_class', 'organization_id', 'send_decision_id', 'sender_type']);
    // The ROW's own key set, asserted whole: `AdminDlqPage.parse` in the helper
    // above strips a field the schema does not declare rather than failing, so
    // this is the only thing that notices a value going back on the wire with
    // no screen reading it. `job_name`, `attempts_made` and `enqueued_at` were
    // exactly that and are gone.
    expect(Object.keys(body.items[0]!).sort()).toEqual(['failed_at', 'failed_reason', 'fields', 'first_stack_line', 'job_id']);
    // The serialized response, not just the projection: a customer's SMS must
    // not reach a platform staffer by ANY field.
    expect(res.body).not.toContain(CUSTOMER_TEXT);
    expect(res.body).not.toContain('Corolla');
  });

  it('drops a value that is not a scalar rather than stringifying it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    inspector.script.failed = () => ({
      queue_state: 'ok',
      scanned: 1,
      // An older deploy's payload. Nothing parses a job on the way out
      // (apps/workers/src/index.ts), so an allow-listed KEY guarantees nothing
      // about the runtime VALUE.
      jobs: [jobRow({ data: { organization_id: { nested: 'x', body: 'secret text' }, conversation_id: ['a'], attempt: true, message_class: 'drip' } })],
    });
    const res = await dlq('deferred-send');
    const body = JSON.parse(res.body) as { items: { fields: { key: string; value: string }[] }[] };
    expect(body.items[0]!.fields).toEqual([{ key: 'message_class', value: 'drip' }]);
    expect(res.body).not.toContain('[object Object]');
    expect(res.body).not.toContain('secret text');
  });

  it('a failed reason gives up its phone number and its email, and is capped', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // The helper is tested directly because it is the ONLY control over a
    // field no allow-list can reach: this text is written by whatever threw.
    const carrier = "The 'To' number +15145550188 is not a valid phone number.";
    expect(redactFailedReason(carrier)).toBe("The 'To' number [phone redacted] is not a valid phone number.");
    const pg = 'duplicate key value violates unique constraint: Key (email)=(marc.tremblay@concessionnaire.qc.ca) already exists.';
    expect(redactFailedReason(pg)).toContain('[email redacted]');
    expect(redactFailedReason(pg)).not.toContain('marc.tremblay');
    expect(redactFailedReason(null)).toBeNull();
    expect(redactFailedReason('   ')).toBeNull();

    // And the route hands through what the inspector already redacted and cut.
    const capped = 'x'.repeat(FAILED_REASON_MAX);
    inspector.script.failed = () => ({
      queue_state: 'ok', scanned: 1,
      jobs: [jobRow({ failed_reason: capped, first_stack_line: 'at runDeferredSend (deferred-send.ts:131)' })],
    });
    const body = JSON.parse((await dlq('deferred-send')).body) as { items: { failed_reason: string; first_stack_line: string }[] };
    expect(body.items[0]!.failed_reason).toHaveLength(FAILED_REASON_MAX);
    expect(body.items[0]!.first_stack_line).toBe('at runDeferredSend (deferred-send.ts:131)');
  });
});

describe('paging the failed set by position (§9)', () => {
  it('hands back a cursor only while the window came back full, and says the basis', async (ctx) => {
    if (!dbUp) return ctx.skip();
    inspector.script.failed = (_n, start, count) => ({
      queue_state: 'ok',
      scanned: count,
      jobs: Array.from({ length: count }, (_v, i) => jobRow({ id: `job-${start + i}` })),
    });
    const first = JSON.parse((await dlq('deferred-send', '?limit=3')).body) as {
      paging_basis: string; next_cursor: string; items: { job_id: string }[];
    };
    expect(first.paging_basis).toBe('position');
    expect(first.items.map((i) => i.job_id)).toEqual(['job-0', 'job-1', 'job-2']);
    expect(first.next_cursor).not.toBeNull();

    const second = JSON.parse((await dlq('deferred-send', `?limit=3&cursor=${first.next_cursor}`)).body) as {
      items: { job_id: string }[]; next_cursor: string | null;
    };
    // The position advanced by the ids READ, so the second page repeats none
    // of the first — which is exactly what getJobs' backfill cursor cannot
    // promise, and why the inspector uses getRanges.
    expect(second.items.map((i) => i.job_id)).toEqual(['job-3', 'job-4', 'job-5']);

    // A short window is the end of the failed set: no cursor.
    inspector.script.failed = () => ({ queue_state: 'ok', scanned: 1, jobs: [jobRow()] });
    const last = JSON.parse((await dlq('deferred-send', '?limit=3')).body) as { next_cursor: string | null };
    expect(last.next_cursor).toBeNull();
  });

  it('pages every match in a window it read, when more match than fit on the page', async (ctx) => {
    if (!dbUp) return ctx.skip();
    /*
     * The bug this exists for: with a tenant filter the window is the SCAN
     * CEILING and the page is `limit`, so a dense tenant's window holds more
     * matches than one page shows. Advancing the cursor by the whole window
     * discarded the rest AND stepped over them — unreachable at every page,
     * under a `scanned` that read as thoroughness.
     *
     * MUTATION: set `nextStart = start + page.scanned` unconditionally in
     * f73-queue-routes.ts and this goes red — the walk returns 25 of the 40.
     */
    const MINE = 40;
    const THEIRS = '00000000-0000-4000-8000-000000000001';
    // Interleaved, so a match is never at the position the naive arithmetic
    // would guess: this tenant's rows sit at every even position.
    const zset = Array.from({ length: MINE * 2 }, (_v, i) =>
      jobRow({
        id: i % 2 === 0 ? `mine-${i / 2}` : `theirs-${(i - 1) / 2}`,
        data: { organization_id: i % 2 === 0 ? orgId : THEIRS },
      }),
    );
    inspector.script.failed = (_n, start, count) => {
      const read = zset.slice(start, start + count);
      // `scan_offset` is the row's place in THIS range read, which is what the
      // real inspector records and what the cursor is built from.
      return { queue_state: 'ok', scanned: read.length, jobs: read.map((j, i) => ({ ...j, scan_offset: i })) };
    };

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query = `?organization_id=${orgId}&limit=25${cursor === null ? '' : `&cursor=${cursor}`}`;
      const res = await dlq('deferred-send', query);
      expect(res.statusCode, res.body).toBe(200);
      const body = JSON.parse(res.body) as { items: { job_id: string }[]; next_cursor: string | null };
      seen.push(...body.items.map((i) => i.job_id));
      cursor = body.next_cursor;
      pages += 1;
      expect(pages, 'the walk never terminated').toBeLessThan(10);
    } while (cursor !== null);

    // Every matching failed job reachable by paging, exactly once and in
    // order: none discarded, none repeated, and the walk ends.
    expect(seen).toEqual(Array.from({ length: MINE }, (_v, i) => `mine-${i}`));
    expect(pages).toBeGreaterThan(1);
  });

  it('a cursor minted on another queue, or under another filter, is a 400', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const elsewhere = forgeCursor({ n: 'assistant-turn', o: 25, f: null });
    const other = await dlq('deferred-send', `?cursor=${elsewhere}`);
    expect(other.statusCode, other.body).toBe(400);
    expect(JSON.parse(other.body)).toMatchObject({ error: { code: 'invalid_cursor' } });

    const filtered = forgeCursor({ n: 'deferred-send', o: 25, f: orgId });
    const mismatched = await dlq('deferred-send', `?cursor=${filtered}`);
    expect(mismatched.statusCode, mismatched.body).toBe(400);
    // A position under one filter addresses different rows under another, so
    // honouring it would page a caller through rows they did not ask for.
    expect(inspector.script.calls).toEqual([]);
  });

  it('a forged position beyond the console’s ceiling is a 400 before any Redis read', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const forged = forgeCursor({ n: 'deferred-send', o: DLQ_POSITION_MAX + 1, f: null });
    const res = await dlq('deferred-send', `?cursor=${forged}`);
    expect(res.statusCode, res.body).toBe(400);
    expect(inspector.script.calls, 'a forged position must never reach a range read').toEqual([]);

    for (const junk of ['not-base64', forgeCursor({ n: 'deferred-send', o: -1, f: null }), forgeCursor({ o: 0 })]) {
      expect((await dlq('deferred-send', `?cursor=${junk}`)).statusCode, junk).toBe(400);
    }
    // A tampered cursor is a 400 and never a 500 — the shared codec's rule,
    // kept even though the payload is this route's own.
    expect(inspector.script.calls).toEqual([]);
  });

  it('never reads past the ceiling, even from a cursor sitting on it', async (ctx) => {
    if (!dbUp) return ctx.skip();
    inspector.script.failed = (_n, _s, count) => ({ queue_state: 'ok', scanned: count, jobs: [] });
    const atCeiling = forgeCursor({ n: 'deferred-send', o: DLQ_POSITION_MAX, f: null });
    const res = await dlq('deferred-send', `?cursor=${atCeiling}&limit=10`);
    expect(res.statusCode, res.body).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ items: [], next_cursor: null, scanned: 0 });
    expect(inspector.script.calls).toEqual([]);
  });
});
/**
 * F-73 §9/§11 — the retry, and the five things standing between a support
 * click and a second text message to a real person.
 *
 * `deferred-send`, `assistant-turn`, `first-touch` and `drip-tick` are
 * `at_least_once` because their workers stamp `provider_ref` only after the
 * carrier answers: a carrier timeout leaves the message DELIVERED with a null
 * ref, which is one of the likeliest reasons the job is sitting in the failed
 * set, and re-running it sends the text again. Nothing on that path dedupes.
 * So the controls are the capability, the typed-back queue name, the 20-id
 * cap, the ten-character reason, and the register row filed first — and each
 * one is a test here rather than a sentence in a comment.
 */
describe('who may put a job back on the queue (§3, §11)', () => {
  it('support may retry and billing may not, each told which capability', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // Fresh staffers, granted inside this test. The shared fixtures above
    // would let this pass on a role somebody else's test happened to leave
    // enrolled, which is exactly how a blocked-behaviour test goes quiet.
    const stamp = `${run}-gate`;
    const canRetry = await staffer(`f73r-support-${stamp}@dealpilot.test`, 'Soutien 2', 'platform_support', superId);
    const cannot = await staffer(`f73r-billing-${stamp}@dealpilot.test`, 'Facturation 2', 'platform_billing', superId);

    const allowed = await retryJobs('qa-review', { job_ids: ['1'], reason: REASON }, canRetry);
    expect(allowed.statusCode, allowed.body).toBe(200);

    const refused = await retryJobs('qa-review', { job_ids: ['1'], reason: REASON }, cannot);
    expect(refused.statusCode, refused.body).toBe(403);
    // MUTATION: add 'platform_billing' to queues:retry in platform.ts → red
    // here, and red again at the definer's own role array in 0069.
    expect(JSON.parse(refused.body)).toMatchObject({
      error: { code: 'forbidden', details: [{ path: 'capability', message: 'queues:retry' }] },
    });
    expect(inspector.script.retryCalls).toHaveLength(1);
  });

  it('an unknown queue name is a 404 that asks nothing and records nothing', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const before = await retryEventCount();
    const res = await retryJobs('deferred-sends', { job_ids: ['1'], reason: REASON, confirm_queue_name: 'deferred-sends' });
    expect(res.statusCode, res.body).toBe(404);
    for (const name of JOB_QUEUE_NAMES) expect(res.body).not.toContain(name);
    expect(inspector.script.retryCalls).toEqual([]);
    expect(await retryEventCount()).toBe(before);
  });
});

describe('the shape of one retry request (§9)', () => {
  it('refuses more than twenty ids', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const ids = Array.from({ length: RETRY_MAX_JOBS + 1 }, (_v, i) => String(i));
    const res = await retryJobs('qa-review', { job_ids: ids, reason: REASON });
    expect(res.statusCode, res.body).toBe(422);
    expect(JSON.parse(res.body)).toMatchObject({ error: { code: 'validation_failed', details: [{ path: 'job_ids' }] } });
    // Twenty is a blast radius a person can read back before they click, and
    // `Queue.retryJobs()` — no id list, no filter, every tenant's failures at
    // once — is never reachable from here.
    expect((await retryJobs('qa-review', { job_ids: ids.slice(0, RETRY_MAX_JOBS), reason: REASON })).statusCode).toBe(200);
  });

  it('refuses a reason too short to explain anything, measured after trimming', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const before = await retryEventCount();
    const res = await retryJobs('qa-review', { job_ids: ['1'], reason: '   short  ' });
    expect(res.statusCode, res.body).toBe(422);
    expect(JSON.parse(res.body)).toMatchObject({ error: { code: 'validation_failed', details: [{ path: 'reason' }] } });
    // Refused by Zod at the edge, so the definer's own 23514 belt is never
    // reached and no half-request touches the register.
    expect(await retryEventCount()).toBe(before);
    expect(inspector.script.retryCalls).toEqual([]);
  });

  it('answers one outcome per requested id, in the order asked, inside a 200', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const outcomes: Record<string, RetryOutcomeT> = { a: 'retried', b: 'gone', c: 'not_failed', d: 'not_attempted', e: 'error' };
    inspector.script.outcome = (id) => outcomes[id] ?? 'error';
    const res = await retryJobs('qa-review', { job_ids: ['a', 'b', 'c', 'd', 'e'], reason: REASON });
    // Five different answers to one request: there is no status code for that,
    // so the per-id list IS the answer and the transport stays 200.
    expect(res.statusCode, res.body).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      queue_state: 'ok',
      outcomes: [
        { job_id: 'a', retry_outcome: 'retried' },
        { job_id: 'b', retry_outcome: 'gone' },
        { job_id: 'c', retry_outcome: 'not_failed' },
        { job_id: 'd', retry_outcome: 'not_attempted' },
        { job_id: 'e', retry_outcome: 'error' },
      ],
    });
  });

  it('maps BullMQ by its numeric code, and declares no state that script can never return', () => {
    // The pure helper, tested directly: `reprocessJob-8.lua` documents its own
    // return set as 1 / -1 / -3 and contains no lock check at all, and
    // `finishedErrors` copies that number onto `err.code`. Matching the English
    // message would break the day BullMQ rewords a string.
    expect(retryOutcomeOf({ code: -1 })).toBe('gone');
    expect(retryOutcomeOf({ code: -3 })).toBe('not_failed');
    // A job a WORKER is holding sits in `active`, so the ZREM on the failed set
    // finds nothing and the script returns -3 — `not_failed` inside a 200. It
    // never returns -2, which is why there is no `locked` outcome to declare;
    // if one ever arrived it would be an honest `error`, not an invented state.
    expect(retryOutcomeOf({ code: -2 })).toBe('error');
    expect(retryOutcomeOf(new Error('ECONNRESET'))).toBe('error');
    expect(retryOutcomeOf(null)).toBe('error');
    expect(RetryOutcome.options, 'a state with no producer is dead vocabulary').not.toContain('locked');
    expect(RetryOutcome.options).toHaveLength(5);
  });
});

describe('the confirm gate, on every queue that can duplicate a customer’s SMS', () => {
  it('refuses ONE job on an at_least_once queue until the queue name is typed back', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const before = await retryEventCount();
    // MUTATION: gate at n > 1 instead of n >= 1 → red. Under CASL the harm is
    // one duplicated text to one real person, so there is no free first job.
    const res = await retryJobs('deferred-send', { job_ids: ['1'], reason: REASON });
    expect(res.statusCode, res.body).toBe(422);
    expect(JSON.parse(res.body)).toMatchObject({
      error: { code: 'validation_failed', details: [{ path: 'confirm_queue_name', code: 'key_mismatch' }] },
    });
    // Refused BEFORE the register and before the queue: a request that never
    // happened must not leave a row saying it did.
    expect(await retryEventCount()).toBe(before);
    expect(inspector.script.retryCalls).toEqual([]);

    // A near miss is still a miss — the point of typing it is reading it.
    expect((await retryJobs('deferred-send', { job_ids: ['1'], reason: REASON, confirm_queue_name: 'deferred_send' })).statusCode).toBe(422);
    expect((await retryJobs('deferred-send', { job_ids: ['1'], reason: REASON, confirm_queue_name: 'assistant-turn' })).statusCode).toBe(422);
    expect(inspector.script.retryCalls).toEqual([]);

    const done = await retryJobs('deferred-send', { job_ids: ['1'], reason: REASON, confirm_queue_name: 'deferred-send' });
    expect(done.statusCode, done.body).toBe(200);
    expect(inspector.script.retryCalls).toHaveLength(1);
  });

  it('asks nothing of a queue whose worker cannot re-send', async (ctx) => {
    if (!dbUp) return ctx.skip();
    // MUTATION: reclassify deferred-send as `idempotent` in JOB_QUEUES → the
    // case above goes red here, and apps/workers/src/queue-replay.test.ts goes
    // red against the worker file that would then have to prove it.
    for (const name of JOB_QUEUE_NAMES.filter((n) => JOB_QUEUES[n].replay === 'idempotent')) {
      const res = await retryJobs(name, { job_ids: ['1'], reason: REASON });
      expect(res.statusCode, `${name}: ${res.body}`).toBe(200);
    }
  });

  it('covers exactly the four queues whose worker re-enters the send path', () => {
    // Not a vacuous loop above, and not a hand-typed list here: the four are
    // the send-path workers, and queue-replay.test.ts holds each `idempotent`
    // claim to a literal in the worker file that makes it true.
    expect(JOB_QUEUE_NAMES.filter((n) => JOB_QUEUES[n].replay === 'at_least_once').sort()).toEqual(
      ['assistant-turn', 'deferred-send', 'drip-tick', 'first-touch'],
    );
  });
});

describe('the register is written first, and only when something was asked (§12)', () => {
  it('files ONE row naming the queue, the ids, the tenants and the reason', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const orgs = [orgId, '00000000-0000-4000-8000-000000000009'];
    inspector.script.organizations = orgs;
    const before = await retryEventCount();

    const res = await retryJobs('deferred-send', {
      job_ids: ['job-a', 'job-b'],
      reason: REASON,
      confirm_queue_name: 'deferred-send',
    });
    expect(res.statusCode, res.body).toBe(200);
    // MUTATION: drop the admin_record_queue_retry call → red. An unaudited
    // requeue is the one thing §9's "actions audited" forbids outright.
    expect(await retryEventCount()).toBe(before + 1);

    const row = (await admin.query<{
      actor_user_id: string; actor_type: string; target_user_id: string | null; changes: Record<string, unknown>; reason: string;
    }>(
      `SELECT actor_user_id, actor_type, target_user_id, changes, reason
       FROM platform_audit_events WHERE event = 'queue.retry_requested' ORDER BY seq DESC LIMIT 1`,
    )).rows[0]!;
    expect(row.actor_user_id).toBe(superId);
    expect(row.actor_type).toBe('platform');
    // The subject is a queue and a list of jobs, not a person — the 0065/0067
    // convention puts it in `changes` and leaves target_user_id null.
    expect(row.target_user_id).toBeNull();
    expect(row.reason).toBe(REASON);
    expect(row.changes).toEqual({ queue: 'deferred-send', requested: ['job-a', 'job-b'], organizations: orgs });
    // Read from the payloads before the row was written, because after it the
    // answer no longer exists: this is what lets the register say WHOSE
    // customer got the second message.
    expect(inspector.script.organizationCalls).toEqual([{ name: 'deferred-send', jobIds: ['job-a', 'job-b'] }]);
  });

  it('files it BEFORE the first job is put back', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const before = await retryEventCount();
    const res = await retryJobs('qa-review', { job_ids: ['1'], reason: REASON });
    expect(res.statusCode, res.body).toBe(200);
    // MUTATION: move the definer after the loop → this reads `before` and goes
    // red. Redis and Postgres cannot commit together, so one window has to
    // exist; over-recording is the fail-closed side, and the `not_attempted`
    // outcome is what keeps the response honest about it.
    expect(inspector.script.auditRowsAtRetry, 'the loop ran before the register row existed').toBe(before + 1);
  });

  it('files nothing at all when there is no queue configured', async (ctx) => {
    if (!dbUp) return ctx.skip();
    inspector.script.configured = false;
    const before = await retryEventCount();
    const res = await retryJobs('deferred-send', { job_ids: ['1', '2'], reason: REASON, confirm_queue_name: 'deferred-send' });
    expect(res.statusCode, res.body).toBe(200);
    // No outcomes, because there were none: an empty list under an explicit
    // state, never a list of `error`s that would read as twenty failures.
    expect(JSON.parse(res.body)).toEqual({ queue_state: 'not_configured', outcomes: [] });
    // MUTATION: audit before the unconfigured short-circuit → red. Nothing was
    // attempted and nothing was even asked; a row here would be a register of
    // button presses.
    expect(await retryEventCount()).toBe(before);
    expect(inspector.script.retryCalls).toEqual([]);
    expect(inspector.script.organizationCalls).toEqual([]);
  });

  it('files it for a configured queue that does not answer, and calls every id not_attempted', async (ctx) => {
    if (!dbUp) return ctx.skip();
    inspector.script.retryState = 'unreachable';
    inspector.script.outcome = () => 'not_attempted';
    // An unreachable Redis cannot be attributed either, so the register row
    // carries no tenants — and is still written.
    inspector.script.organizations = [];
    const before = await retryEventCount();

    const res = await retryJobs('deferred-send', { job_ids: ['1', '2'], reason: REASON, confirm_queue_name: 'deferred-send' });
    expect(res.statusCode, res.body).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      queue_state: 'unreachable',
      outcomes: [
        { job_id: '1', retry_outcome: 'not_attempted' },
        { job_id: '2', retry_outcome: 'not_attempted' },
      ],
    });
    // The difference from `not_configured` is the whole ruling: a queue that
    // EXISTS was asked, so the register records the request even though the
    // answer never came.
    expect(await retryEventCount()).toBe(before + 1);
    const changes = (await admin.query<{ changes: Record<string, unknown> }>(
      `SELECT changes FROM platform_audit_events WHERE event = 'queue.retry_requested' ORDER BY seq DESC LIMIT 1`,
    )).rows[0]!.changes;
    expect(changes).toEqual({ queue: 'deferred-send', requested: ['1', '2'], organizations: [] });
  });
});
