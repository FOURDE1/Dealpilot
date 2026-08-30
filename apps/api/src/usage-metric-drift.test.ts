import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, type Pool } from '@dealpilot/db';
import { AdminTenantUsage, USAGE_GAUGES, USAGE_WINDOW_METRICS, type UsageMetricT } from '@dealpilot/schemas';

/**
 * USAGE METRIC DRIFT GUARD (F-73 §6).
 *
 * "A claim in a comment is a claim in the product." A usage card is nothing
 * but claims: every metric name asserts that a real column of a real table was
 * read to produce it. This file is where that assertion is machine-checked, in
 * both directions:
 *
 *   - every shipped metric names a column that EXISTS, and
 *   - THIS metric's own arithmetic is what reads it — proven by matching the
 *     metric's distinguishing `expr` against the live `pg_get_functiondef`,
 *     plus the `alias.column` it claims and the `FROM table alias` that binds
 *     the alias, so the binding itself is proven rather than assumed.
 *
 * Matching the bare column name would be near-vacuous: `created_at`, `status`
 * and `organization_id` appear in that definer for a dozen unrelated reasons.
 * Alias-qualifying alone is not enough either, and that is what `expr` is for:
 * six of these thirteen metrics name an `alias.column` that ANOTHER metric's
 * SQL also puts in the definer (`mb.user_id`, `mb.status`, `l.created_at`,
 * `m.conversation_id`, `m.segments`, `l.chatbot_engaged_at`), so for nearly
 * half the card an `alias.column` match was being satisfied by a neighbour's
 * read. Replacing the `member_count` subquery with the literal `0` left this
 * file green, and so did hard-wiring `ai_first_touch_p95_seconds` to NULL.
 * `expr` closes that. Two structural properties, both held by the "every
 * metric's expression is unique to it" case below, are what make it per-metric
 * rather than per-definer: no two metrics may share an `expr`, and an `expr`
 * must itself contain the `alias.column` its metric claims. And the match runs
 * against the definer with `--` comments STRIPPED — a claim written in a
 * comment must not be able to satisfy a proof about the code.
 *
 * The reverse direction matters just as much, and it is the one this repo has
 * been bitten by: an EXEMPTION that outlives its reason stops describing
 * reality and starts suppressing the report it was written to allow
 * (dead-column.test.ts's stale-exemption case). So `DEAD_PLAN_ALLOWANCES` is
 * checked both ways.
 */

const here = dirname(fileURLToPath(import.meta.url));
const ADMIN_URL = testAdminUrl();
const migrationsDir = join(here, '..', '..', '..', 'packages', 'db', 'migrations');
const localesDir = join(here, '..', '..', '..', 'packages', 'i18n', 'src', 'locales');

/**
 * Where each shipped metric's number comes from, as the card claims it.
 *
 * `alias` is not decoration: 0069 aliases every table (`l`, `d`, `m`, `mb`,
 * `a`, `dd`, `s`, `pl`) precisely so this guard can prove the read. One alias
 * per table, one table per alias — assertion 6 below holds that.
 */
type MetricSource = { table: string; alias: string; column: string; expr: string };

const USAGE_METRIC_SOURCES: Record<UsageMetricT, MetricSource> = {
  // Gauges — standing totals, no window.
  seats_provisioned: {
    table: 'memberships',
    alias: 'mb',
    column: 'user_id',
    expr: 'count(DISTINCT mb.user_id)::integer',
  },
  member_count: {
    table: 'memberships',
    alias: 'mb',
    column: 'status',
    // The whole subquery, because `count(*)::integer` on its own is four metrics.
    expr: "count(*)::integer FROM memberships mb WHERE mb.organization_id = p_org AND mb.status = 'active'",
  },
  store_count: {
    table: 'stores',
    alias: 's',
    column: 'deleted_at',
    expr: 'count(*)::integer FROM stores s WHERE s.organization_id = p_org AND s.deleted_at IS NULL',
  },
  document_bytes: {
    table: 'deal_documents',
    alias: 'dd',
    column: 'size_bytes',
    expr: 'COALESCE(sum(dd.size_bytes), 0)',
  },
  // Window metrics.
  members_who_acted: {
    table: 'activity_events',
    alias: 'a',
    column: 'actor_user_id',
    expr: 'count(DISTINCT a.actor_user_id)::integer',
  },
  leads_created: {
    table: 'leads',
    alias: 'l',
    column: 'created_at',
    expr: 'count(*)::integer FROM leads l WHERE l.organization_id = p_org AND l.created_at >= v_from AND l.created_at < v_to',
  },
  deals_created: {
    table: 'deals',
    alias: 'd',
    column: 'created_at',
    expr: 'count(*)::integer FROM deals d WHERE d.organization_id = p_org AND d.created_at >= v_from AND d.created_at < v_to',
  },
  deals_delivered: {
    table: 'deals',
    alias: 'd',
    column: 'delivered_at',
    expr: 'count(*)::integer FROM deals d WHERE d.organization_id = p_org AND d.delivered_at >= v_from AND d.delivered_at < v_to',
  },
  ai_conversations_engaged: {
    table: 'messages',
    alias: 'm',
    column: 'conversation_id',
    expr: 'count(DISTINCT m.conversation_id)::integer',
  },
  // The two SMS metrics share `m.segments`; only `expr` tells them apart.
  sms_segments: {
    table: 'messages',
    alias: 'm',
    column: 'segments',
    expr: 'COALESCE(sum(m.segments), 0)',
  },
  sms_messages_unsegmented: {
    table: 'messages',
    alias: 'm',
    column: 'segments',
    expr: 'count(*) FILTER (WHERE m.segments IS NULL)::integer',
  },
  // As do the two first-touch metrics. percentile_disc is IN the expression on
  // purpose: swapping it for percentile_cont would report a latency no lead
  // ever lived, and this is the only place in the repo that would notice.
  ai_first_touch_p95_seconds: {
    table: 'leads',
    alias: 'l',
    column: 'chatbot_engaged_at',
    expr: 'percentile_disc(0.95) WITHIN GROUP ( ORDER BY extract(epoch FROM (l.chatbot_engaged_at - l.created_at))) AS p95',
  },
  // The sample count's own arithmetic is `count(*)`, which distinguishes
  // nothing, so its expr carries the window predicates that define WHICH rows
  // are counted — the clause that makes this number a sample size rather than
  // a lead count.
  ai_first_touch_sample_count: {
    table: 'leads',
    alias: 'l',
    column: 'chatbot_engaged_at',
    expr: 'count(*)::integer AS sample FROM leads l WHERE l.organization_id = p_org AND l.chatbot_engaged_at >= v_from AND l.chatbot_engaged_at < v_to',
  },
};

/**
 * The definer's SQL with `--` comments removed and whitespace flattened.
 *
 * Both halves are load-bearing. STRIPPING COMMENTS: 0069 argues for this card
 * at length, and several of its comments quote the very fragments proved here
 * (":425 stamp chatbot_engaged_at", "`m.created_at <= l.chatbot_engaged_at` …
 * must not be re-added") — a proof a prose paragraph can satisfy proves nothing
 * about the query. FLATTENING WHITESPACE: an `expr` spans the lines the SQL is
 * formatted across, so re-wrapping the migration must not turn this guard red
 * for a reason that is not drift.
 *
 * `--` inside a string literal is not a comment; the quote counter handles it.
 * There is no such literal in this definer today — the counter is here so that
 * a future one cannot silently truncate the body and make every match vacuous.
 */
function sqlOnly(definer: string): string {
  const stripped = definer.split('\n').map((line) => {
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      if (line[i] === "'") quoted = !quoted;
      else if (!quoted && line[i] === '-' && line[i + 1] === '-') return line.slice(0, i);
    }
    return line;
  });
  return stripped.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * `plans.included_*` columns the card deliberately does NOT read, with the
 * condition that would un-cut each.
 *
 * These are not oversights: a bar needs a numerator, and neither of these has
 * one. Rendering them would divide a real number by an imaginary one.
 */
const DEAD_PLAN_ALLOWANCES: Record<string, string> = {
  included_ai_minutes:
    'Nothing dials and nothing answers — no call has a duration anywhere in this repo, so this allowance has no numerator. Un-cut: the day voice exists and a minute can be counted.',
  included_storage_gb:
    "The only byte column in the schema is deal_documents.size_bytes, so the numerator would be documents alone and the bar would read as the tenant's total storage. Un-cut: the day every stored object records its size.",
};

/**
 * `messages.channel`, classified. Both `sms_segments` and
 * `sms_messages_unsegmented` filter to the two the carrier segments; the other
 * two are not SMS at all, and counting a web-chat reply as "SMS the carrier
 * never segmented" would report a fake undercount on the card.
 *
 * A fifth channel added to the CHECK and classified nowhere fails assertion 7.
 */
const MESSAGE_CHANNELS_COUNTED = ['sms', 'mms'] as const;
const MESSAGE_CHANNELS_NOT_COUNTED = ['voice_transcript', 'web_chat'] as const;

let admin: Pool;
let dbUp = false;
let definition = '';

/** The one vocabulary CHECK on a column, as its literal values (platform-drift's idiom). */
async function checkValues(table: string, column: string): Promise<string[]> {
  const r = await admin.query<{ def: string }>(
    `SELECT pg_get_constraintdef(con.oid) AS def
       FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
      WHERE c.relname = $1 AND con.contype = 'c'`,
    [table],
  );
  const anchored = new RegExp(`^CHECK \\(\\(${column}(::text)? = ANY`);
  const defs = r.rows.map((x) => x.def).filter((d) => anchored.test(d));
  expect(defs, `expected exactly one vocabulary CHECK on ${table}.${column}`).toHaveLength(1);
  return [...defs[0]!.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]!).sort();
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
  definition = (
    await admin.query<{ def: string }>(`SELECT pg_get_functiondef('admin_tenant_usage'::regproc) AS def`)
  ).rows[0]!.def;
});

afterAll(async () => {
  await admin?.end();
});

describe('usage metric drift (F-73 §6)', () => {
  it('the response shape carries exactly the declared metrics — no more, no fewer', () => {
    // The two lists are the vocabulary; the schema is what the client sees. A
    // metric added to one and not the other is either a number nothing renders
    // or a field nothing computes.
    expect(Object.keys(AdminTenantUsage.shape.window_metrics.shape).sort()).toEqual(
      [...USAGE_WINDOW_METRICS].sort(),
    );
    expect(Object.keys(AdminTenantUsage.shape.gauges.shape).sort()).toEqual([...USAGE_GAUGES].sort());
    expect(Object.keys(USAGE_METRIC_SOURCES).sort()).toEqual(
      [...USAGE_WINDOW_METRICS, ...USAGE_GAUGES].sort(),
    );
  });

  it('every metric names a real column of a real base table', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const r = await admin.query<{ qualified: string }>(
      `SELECT c.table_name || '.' || c.column_name AS qualified
         FROM information_schema.columns c
         JOIN information_schema.tables t
           ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'`,
    );
    const live = new Set(r.rows.map((x) => x.qualified));
    const missing = Object.entries(USAGE_METRIC_SOURCES)
      .map(([metric, src]) => ({ metric, qualified: `${src.table}.${src.column}` }))
      .filter((x) => !live.has(x.qualified));
    expect(
      missing,
      `these metrics claim a column that does not exist: ${missing.map((x) => `${x.metric} → ${x.qualified}`).join(', ')}`,
    ).toEqual([]);
  });

  it('each metric is computed by its OWN expression, which reads the column it claims', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const sql = sqlOnly(definition);
    for (const [metric, src] of Object.entries(USAGE_METRIC_SOURCES)) {
      // The per-metric half. Because every `expr` is unique across the card
      // (the assertion below), only THIS metric's SQL can satisfy this line:
      // replace this subquery with a constant and this is the assertion that
      // goes red, whether or not any behaviour test happens to cover it.
      expect(
        sql,
        `${metric} is no longer computed by \`${src.expr}\` — admin_tenant_usage does not contain that expression, so either the metric was rewritten (update this entry, and say why in 0069) or its arithmetic was deleted and the card is printing a number nothing computes`,
      ).toContain(src.expr);
      // …and the column half, still asserted separately so the failure message
      // names the column when the read is what moved. Against the stripped SQL,
      // not the raw definer: 0069's comments quote several of these.
      expect(
        sql,
        `${metric} claims ${src.table}.${src.column}, but admin_tenant_usage never reads ${src.alias}.${src.column}`,
      ).toContain(`${src.alias}.${src.column}`);
    }
    // The alias binding itself, once per distinct table: without this, the
    // check above would be satisfied by any `x.column` no matter what `x` is.
    for (const table of new Set(Object.values(USAGE_METRIC_SOURCES).map((s) => s.table))) {
      const alias = Object.values(USAGE_METRIC_SOURCES).find((s) => s.table === table)!.alias;
      expect(sql, `no FROM ${table} ${alias} in admin_tenant_usage`).toContain(`FROM ${table} ${alias}`);
    }
  });

  it("every metric's expression is unique to it, and names the column it claims", () => {
    // The two structural properties that make the proof above per-metric
    // rather than per-definer. Neither needs the database: they are about
    // whether this file's OWN table can distinguish thirteen metrics.
    //
    // (1) A shared expr means metric A's proof is satisfied by metric B's
    // read, which is the hole `expr` was added to close. Six entries already
    // share an `alias.column`, so without this the table would quietly drift
    // back into that state the first time a metric is added or reworded.
    const byExpr = new Map<string, string[]>();
    for (const [metric, src] of Object.entries(USAGE_METRIC_SOURCES)) {
      byExpr.set(src.expr, [...(byExpr.get(src.expr) ?? []), metric]);
    }
    const shared = [...byExpr.entries()].filter(([, ms]) => ms.length > 1);
    expect(
      shared.map(([expr, ms]) => `${ms.join(' and ')} share ${expr}`),
      'two metrics claim the same expression, so neither one is actually proved — give each the fragment that distinguishes its own arithmetic',
    ).toEqual([]);

    // (2) An expr that does not mention the claimed column would let the two
    // halves of the proof drift apart: the metric could be proved to compute
    // SOMETHING while claiming a column that something never touches.
    const disconnected = Object.entries(USAGE_METRIC_SOURCES)
      .filter(([, src]) => !src.expr.includes(`${src.alias}.${src.column}`))
      .map(([metric, src]) => `${metric} (expr does not mention ${src.alias}.${src.column})`);
    expect(
      disconnected,
      "a metric's expression must contain the alias-qualified column it claims, or the column claim and the arithmetic claim are about different things",
    ).toEqual([]);
  });

  it('one alias per table and one table per alias', () => {
    // A shared alias would make every proof above ambiguous: `m.segments`
    // matching would no longer tell you WHICH table was read.
    const pairs = [
      ...new Set(Object.values(USAGE_METRIC_SOURCES).map((s) => `${s.alias}=${s.table}`)),
    ].map((p) => p.split('='));
    expect(new Set(pairs.map((p) => p[0])).size, 'an alias is used for two tables').toBe(pairs.length);
    expect(new Set(pairs.map((p) => p[1])).size, 'a table is read under two aliases').toBe(pairs.length);
  });

  it('every metric has a non-empty label in BOTH locale bundles', () => {
    // Read as source text rather than imported: apps/api carries no dependency
    // on @dealpilot/i18n and does not need one to check a key exists
    // (brand-leak.test.ts reads the same directory the same way).
    for (const locale of ['fr-CA', 'en-CA']) {
      const bundle = readFileSync(join(localesDir, `${locale}.ts`), 'utf8');
      for (const metric of Object.keys(USAGE_METRIC_SOURCES)) {
        const label = new RegExp(`\\bmetric_${metric}: '([^']+)'`).exec(bundle);
        expect(label, `${locale} has no non-empty usage.metric_${metric}`).not.toBeNull();
        expect(label![1]!.trim(), `${locale}'s metric_${metric} is blank`).not.toBe('');
      }
    }
  });

  it('every plans.included_* column is either read by the card or a live exemption', async (ctx) => {
    if (!dbUp) return ctx.skip();
    const r = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'plans' AND column_name LIKE 'included\\_%'`,
    );
    const columns = r.rows.map((x) => x.column_name);
    expect(columns.length, 'no included_* columns found — the query is wrong, not the schema').toBeGreaterThan(0);

    // sqlOnly, not the raw definer: `included_ai_minutes` appears in 0069's
    // COMMENT saying it is deliberately NOT read, so matching the raw text
    // would conclude the exact opposite of what the comment says. (The
    // alias-qualification below was already guarding against the bare name.)
    const sql = sqlOnly(definition);
    const read = (column: string) => sql.includes(`pl.${column}`);
    const unaccounted = columns.filter((c) => !read(c) && !(c in DEAD_PLAN_ALLOWANCES));
    expect(
      unaccounted,
      `these plan allowances are neither rendered nor registered as deliberately dead — wire them up or give them an entry with its un-cut condition: ${unaccounted.join(', ')}`,
    ).toEqual([]);

    // The reverse, and the one that rots: an exemption the card now reads is
    // no longer protecting anything, and leaving it there hides the next time
    // the read is removed.
    const stale = Object.keys(DEAD_PLAN_ALLOWANCES).filter((c) => read(c));
    expect(
      stale,
      `admin_tenant_usage now reads these, so their DEAD_PLAN_ALLOWANCES entries are stale — delete them: ${stale.join(', ')}`,
    ).toEqual([]);
    // And an exemption for a column that no longer exists protects nothing either.
    const gone = Object.keys(DEAD_PLAN_ALLOWANCES).filter((c) => !columns.includes(c));
    expect(gone, `DEAD_PLAN_ALLOWANCES names columns plans no longer has: ${gone.join(', ')}`).toEqual([]);
    for (const reason of Object.values(DEAD_PLAN_ALLOWANCES)) {
      expect(reason, 'an exemption without an un-cut condition is a shrug').toContain('Un-cut:');
    }
  });

  it('every message channel is classified, and the card counts only the two the carrier segments', async (ctx) => {
    if (!dbUp) return ctx.skip();
    expect(
      [...MESSAGE_CHANNELS_COUNTED, ...MESSAGE_CHANNELS_NOT_COUNTED].sort(),
      'a channel exists in the database that this file has not decided about — classify it before the card counts it, or silently does not',
    ).toEqual(await checkValues('messages', 'channel'));
    // The classification is only worth anything if the definer agrees with it.
    expect(sqlOnly(definition), 'admin_tenant_usage no longer filters the SMS metrics by channel').toContain(
      `IN (${MESSAGE_CHANNELS_COUNTED.map((c) => `'${c}'`).join(',')})`,
    );
  });
});
