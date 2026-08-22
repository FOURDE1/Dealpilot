import { afterAll, beforeAll, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, type Pool } from '@dealpilot/db';

/**
 * Dead-column guard.
 *
 * Three times in one week the same bug arrived wearing different clothes:
 *
 *  - `deals.sold_as_is` — in the input schema, in the migration, read by the
 *    document generator, and in NO insert. The API accepted the value, answered
 *    201, and dropped it (CR-12, found by Hussein).
 *  - `warranty_agreement` / `gap_agreement` / `aftermarket_agreement` — in the
 *    CHECK, the catalogue and eighteen golden tests, producible by no deal
 *    (F-13b, found by the reachability guard).
 *  - `dispatch_assignments.customer_notified_at` — a column since F-11's first
 *    migration with nothing ever writing to it, so the board could report that
 *    a customer had been told when nobody had told them (F-11c).
 *
 * Each was invisible: nothing failed, nothing warned, and the tests covering
 * the feature passed. What they share is a column the application can never
 * write. That is what this checks — against the database catalogue, so a column
 * added tomorrow is included without anybody remembering to add it here.
 *
 * The check is deliberately coarse: it looks for the column name in the places
 * this codebase writes columns from. A false positive costs one line in
 * DELIBERATELY_UNWRITTEN with a reason, which is a fair price — a reason
 * written down is worth more than a column nobody has thought about.
 *
 * BLIND SPOT, now narrowed. This guard used to match by column NAME alone, so a
 * dead column was vouched for by a live column of the same name on another
 * table. That cost two real instances: `stores.esign_platform` hid behind
 * `deal_documents.esign_platform`, and `leads.score` hid behind
 * `conversation_analysis.score` for three weeks until an audit went looking.
 *
 * `INSERT INTO t (…)` and `UPDATE t SET …` both carry their table, so those are
 * attributed properly now (`qualifiedWrites`). What remains unqualified is
 * whitelist and input-schema evidence — a `*_COLUMNS` array or a `Create*Input`
 * does not say which table it belongs to. A name shared across tables is still
 * unchecked THERE, and only there.
 */

const ADMIN_URL = testAdminUrl();
const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', '..', '..', 'packages', 'db', 'migrations');

let admin: Pool;
let dbUp = false;

/** Infrastructure every table carries; never written by name from a route. */
const STRUCTURAL = new Set([
  'id', 'organization_id', 'store_id', 'created_at', 'updated_at', 'deleted_at', 'seq',
]);

/**
 * Columns nothing writes ON PURPOSE. Each needs a reason, because "we meant to"
 * is exactly what the three bugs above would have claimed.
 */
const DELIBERATELY_UNWRITTEN: Record<string, string> = {
  // F-59: stamped by the first-touch WORKER (apps/workers/src/first-touch.ts);
  // this guard scans apps/api only.
  'leads.chatbot_engaged_at': 'written by the first-touch worker',

  // F-62: the live-analysis WORKER writes these (apps/workers/src/
  // live-analysis.ts) — idempotency anchor and §13 metering (0061); this
  // guard scans apps/api only.
  'conversation_analysis.message_id': 'written by the live-analysis worker',
  'conversation_analysis.input_tokens': 'written by the live-analysis worker',
  'conversation_analysis.output_tokens': 'written by the live-analysis worker',

  // F-64: the nightly QA judge WORKER writes this whole table
  // (apps/workers/src/qa-review.ts); the API only reads it. Human reviews
  // arrive with the QA console slice.
  'conversation_qa_reviews.conversation_id': 'written by the qa-review worker',
  'conversation_qa_reviews.reviewer_type': 'written by the qa-review worker',
  'conversation_qa_reviews.scores': 'written by the qa-review worker',
  'conversation_qa_reviews.overall': 'written by the qa-review worker',
  'conversation_qa_reviews.flags': 'written by the qa-review worker',
  // notes + model need no entry: name-only evidence from sibling tables
  // already counts them (the guard's documented blind spot).
  'conversation_qa_reviews.input_tokens': 'written by the qa-review worker',
  'conversation_qa_reviews.output_tokens': 'written by the qa-review worker',

  // F-61: the hourly drip-tick WORKER advances rides and stamps sends
  // (apps/workers/src/drip-tick.ts); this guard scans apps/api only. The
  // API's own writes (f18 opt-out, f61 reactivation) are attributed above.
  'drip_enrollments.current_step': 'written by the drip-tick worker',
  'drip_enrollments.last_message_sent_at': 'written by the drip-tick worker',

  // F-57: the extraction WORKER writes these (apps/workers/src/ai-extraction.ts)
  // — this guard scans apps/api only, and the worker is the only writer by
  // design (§5: write-back happens in the extraction worker).
  'lead_extractions.conversation_id': 'written by the ai-extraction worker',
  'lead_extractions.message_id': 'written by the ai-extraction worker',
  'lead_extractions.input_tokens': 'written by the ai-extraction worker',
  'lead_extractions.output_tokens': 'written by the ai-extraction worker',

  // F-47: '{in_app}' by default; the email/SMS channel writers arrive with
  // their credentials (D-050) and retire this line.
  'notifications.channels_sent': 'default in_app until the email/SMS channels ship (D-050)',


  // Written by the invitation_accept() SQL function, not by a route: accepting
  // an invitation has to reactivate a membership and stamp acceptance in one
  // indivisible step, or a re-invited colleague ends up with two memberships
  // (F-12).
  'invitations.accepted_at': 'written by invitation_accept()',
  'invitations.accepted_user_id': 'written by invitation_accept()',

  // Stamped by the trigger `leads_stamp_contact` on messages, not by any
  // route — on purpose, and it is the whole point of F-24. The legacy system
  // made first contact a button somebody pressed after a phone call, which
  // measured remembering rather than answering. A contact that happened and
  // was not recorded must not be a thing that can happen.
  'leads.first_contacted_at': 'stamped by trigger leads_stamp_contact',
  'leads.last_contacted_at': 'stamped by trigger leads_stamp_contact',
  'leads.response_time_seconds': 'stamped by trigger leads_stamp_contact',
  'leads.contact_attempts': 'stamped by trigger leads_stamp_contact',

  // AI lead scoring is not built. leads.md §6 makes it rules-engine-owned and
  // never client-writable, so no route will ever write it — the scoring engine
  // will, when it lands with the model runtime.
  //
  // This entry is worth more than the note that preceded it: until the guard
  // learned to attribute writes to a table, `conversation_analysis.score`
  // vouched for this column and no exemption was possible, because an exemption
  // would have claimed a check that was not happening. It is a real check now,
  // and the staleness test below will force this line out the day something
  // writes it.
  //
  // `leads.score` lived here from the day the guard existed — the oldest
  // exemption in the file. F-39 built the engine its note promised
  // (recalculateLeadScore syncs the column), and the staleness test forced
  // this line out exactly as designed. Third time the mechanism has worked.

  // The compliance CHECK endpoint deliberately does not write a decision row:
  // asking whether a message COULD be sent is not sending one, and recording it
  // would inflate the frequency cap with questions nobody acted on. The send
  // layer (F-19) writes every other column on this table.
  'send_decisions.decided_at': 'defaulted by the database at insert',

  // F-33 gave the assistant a way to BOOK an appointment. Managing one after
  // the fact — assigning who takes it, cancelling with a reason — is the
  // console's, and lands with the appointments screen.
  // Postgres maintains it: GENERATED ALWAYS AS … STORED. Nothing can write it
  // and an attempt would be an error, which is the point of generating it
  // rather than keeping a trigger in step with the row.
  'contacts.search_vector': 'generated column, maintained by Postgres',
  // `contacts.customer_since` lived here until F-36. Its exemption said the
  // deal link would write it, the deal link now does (linkPrimaryBuyer), and
  // this guard is what noticed the promise had been kept.

  // The three appointment columns lived here until F-38: the console slice
  // their notes promised now exists (assign PATCH + cancel route), and this
  // guard is what noticed the promises had been kept — same as customer_since.

  // F-19 created the conversation, which is what the send layer needed. The
  // handoff itself — a person taking a conversation, closing it, reading the
  // assistant's summary — is the agent console, and lands next. `evaluateSend`
  // already READS conversations.status to suspend the assistant, which is why
  // the table exists a slice before the screen that fills it in.
};

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
});

afterAll(async () => {
  await admin?.end();
});

/** Every non-test source file in a directory. */
function sourceIn(dir: string): string {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n');
}

/**
 * The places this codebase writes a column from:
 *  - an INSERT's column list
 *  - a `SET col = ...` clause
 *  - a `*_COLUMNS` whitelist (Set or plain array), which is how the generic
 *    update routes decide what may be written
 *  - `sets.push('col = ...')` / `setEntries.push(['col', …])` builders
 *  - a `Create*Input` / `Update*Input` SCHEMA, because the generic routes write
 *    whatever those accept, via Object.entries(input)
 *
 * READ models are deliberately excluded. `DispatchAssignment` has listed
 * `customer_notified_at` since the day it was written — counting a field
 * because something can DISPLAY it is precisely how a column nothing writes
 * goes on looking alive.
 */
/**
 * Writes whose TABLE is knowable, as `table.column`.
 *
 * This is the fix for the blind spot in the header. `INSERT INTO x (...)` and
 * `UPDATE x SET ...` both carry their table, so those columns can be attributed
 * properly instead of being thrown into one bag of names where
 * `conversation_analysis.score` vouches for `leads.score` and
 * `deal_documents.esign_platform` vouches for `stores.esign_platform`.
 *
 * Both of those were real. The second was found by reading the output rather
 * than by the assertion, and the first was invisible until an audit went
 * looking — which is the whole failure mode of a guard that reports the wrong
 * thing confidently.
 */
function qualifiedWrites(apiSrc: string): Set<string> {
  const out = new Set<string>();
  const add = (table: string, columns: string) => {
    for (const c of columns.matchAll(/\b([a-z_][a-z0-9_]*)\b/g)) out.add(`${table}.${c[1]!}`);
  };
  // INSERT INTO t (a, b, c)
  for (const m of apiSrc.matchAll(/INSERT\s+INTO\s+(\w+)\s*\(([^)]*)\)/gis)) add(m[1]!, m[2]!);
  // UPDATE t SET a = …, b = …    (and the ON CONFLICT DO UPDATE SET of an insert)
  // The span must not cross a template-literal boundary: SQL statements live
  // one per literal, and letting the match run past a backtick let an INSERT
  // with no SET of its own swallow the NEXT statement's SET list and claim
  // its columns (found when f18's drip_enrollments UPDATE vanished into the
  // platform_suppression INSERT above it).
  for (const m of apiSrc.matchAll(
    /(?:UPDATE|INSERT\s+INTO)\s+(\w+)[^`]{0,600}?\bSET\s+([\s\S]{0,400}?)(?:WHERE|RETURNING|`|;)/gis,
  )) {
    const table = m[1]!;
    for (const pair of m[2]!.matchAll(/(\w+)\s*=/g)) add(table, pair[1]!);
  }
  return out;
}

/**
 * Writes whose table is NOT knowable from the text: whitelists and input
 * schemas, which the generic routes apply to whatever table they belong to.
 * These keep the old name-only matching, and keep its blind spot with it —
 * documented rather than pretended away.
 */
function writeEvidence(apiSrc: string, schemaSrc: string): string {
  const parts: string[] = [];
  for (const m of apiSrc.matchAll(/_COLUMNS\s*=\s*(?:new Set\()?\[([\s\S]*?)\]/gis)) parts.push(m[1]!);
  for (const m of apiSrc.matchAll(/(?:sets|setEntries|stamps)\.push\(([\s\S]{0,200}?)\);/gis)) parts.push(m[1]!);
  for (const m of schemaSrc.matchAll(
    /export const (?:Create|Update)\w*Input\s*=([\s\S]*?)\n(?=export |\/\*\*)/gis,
  )) {
    parts.push(m[1]!);
  }
  return parts.join('\n');
}

it('every column the app is expected to write, it can write', async (ctx) => {
  if (!dbUp) return ctx.skip();

  // Tenant-scoped business tables only: auth tables belong to Better Auth and
  // the migration bookkeeping table belongs to the migrator.
  const cols = await admin.query<{ table_name: string; column_name: string; has_default: boolean }>(
    `SELECT c.table_name, c.column_name, (c.column_default IS NOT NULL) AS has_default
     FROM information_schema.columns c
     JOIN information_schema.tables t
       ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public'
       AND t.table_type = 'BASE TABLE'
       AND EXISTS (
         SELECT 1 FROM information_schema.columns o
         WHERE o.table_schema = 'public' AND o.table_name = c.table_name
           AND o.column_name = 'organization_id'
       )
     ORDER BY c.table_name, c.ordinal_position`,
  );
  expect(cols.rows.length).toBeGreaterThan(50);

  const apiSrc = sourceIn(here);
  const written = qualifiedWrites(apiSrc);
  const evidence = writeEvidence(
    apiSrc,
    sourceIn(join(here, '..', '..', '..', 'packages', 'schemas', 'src')),
  );
  const dead: string[] = [];
  for (const row of cols.rows) {
    const qualified = `${row.table_name}.${row.column_name}`;
    if (STRUCTURAL.has(row.column_name)) continue;
    if (qualified in DELIBERATELY_UNWRITTEN) continue;
    // Attributed to THIS table by an INSERT or an UPDATE — the strong signal.
    if (written.has(qualified)) continue;
    // A column with a DEFAULT has a value without anyone writing it; it is only
    // dead if it is also never set, which the same check covers.
    if (new RegExp(`\\b${row.column_name}\\b`).test(evidence)) continue;
    dead.push(qualified);
  }

  expect(
    dead,
    `these columns exist in the database and NOTHING in the API can write them — either wire them up, or register them in DELIBERATELY_UNWRITTEN with the reason: ${dead.join(', ')}`,
  ).toEqual([]);
});

/**
 * The exemption list has to expire, or it becomes the bug it was built to find.
 *
 * Every entry above says "nothing writes this, ON PURPOSE". Most of them said
 * "…yet — the slice that writes it is coming". When that slice lands, the entry
 * stops describing reality and starts doing the opposite of its job: if the
 * write path is later deleted or refactored away, the column goes dead again
 * and the stale exemption suppresses the report. F-18 left five such entries
 * behind and nothing noticed until F-19 went looking.
 *
 * Same coarse name matching as above, with the same blind spot — a hit here may
 * be a live column or a same-named column on another table. Either way the
 * entry no longer protects anything, so removing it is right in both cases.
 */
it('no exemption outlives the reason it was written for', async (ctx) => {
  if (!dbUp) return ctx.skip();

  const apiSrc = sourceIn(here);
  // BOTH sources of evidence, and the first one matters most.
  //
  // This test read only `writeEvidence` until the guard was made table-aware,
  // at which point SQL parsing moved into `qualifiedWrites` and this check
  // silently stopped seeing INSERT and UPDATE entirely — an exemption for a
  // column that later got a real SQL write would never have been reported
  // stale again. The guard that catches dead columns had briefly lost its own
  // guard, which is a neat illustration of why this test exists at all.
  const written = qualifiedWrites(apiSrc);
  const evidence = writeEvidence(
    apiSrc,
    sourceIn(join(here, '..', '..', '..', 'packages', 'schemas', 'src')),
  );
  const stale = Object.keys(DELIBERATELY_UNWRITTEN).filter((qualified) => {
    if (written.has(qualified)) return true;
    const column = qualified.split('.')[1]!;
    return new RegExp(`\\b${column}\\b`).test(evidence);
  });

  expect(
    stale,
    `these columns ARE written now, so their DELIBERATELY_UNWRITTEN entries are stale and are masking future regressions — delete them: ${stale.join(', ')}`,
  ).toEqual([]);
});
