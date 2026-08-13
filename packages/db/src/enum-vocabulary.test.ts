import { afterAll, beforeAll, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, ensureTestDatabase, reset, testAdminUrl, type Pool } from './index.js';

/**
 * Vocabulary guard: no value the code can produce may be one the database refuses.
 *
 * `send_decisions.timezone_source` was declared in 0028 as
 * `CHECK (... IN ('postal_code','store','fallback'))`, while the compliance gate
 * has always produced `postal_code | area_code | store`. So the column permitted
 * a word nothing emits and refused the one most sends resolve to — a lead with a
 * phone number and no postal code resolves by area code, and 514 is Montreal.
 * Every send from a Quebec number would have died on INSERT.
 *
 * It survived because the two ends never met. The endpoint that COMPUTES the
 * value returns it as JSON and writes nothing; the one test that wrote a row
 * hand-picked a legal literal. Nothing asked the column to hold a value the
 * system had actually produced until F-19 tried to send a message.
 *
 * So this compares the two vocabularies directly, in the only direction that
 * crashes: every member of a Zod enum must be accepted by the CHECK on the
 * column of the same name. A narrower schema is fine — a create-input that
 * accepts three of five statuses is a legitimate restriction. A wider one is a
 * runtime failure waiting for its first real row.
 *
 * NOT covered: the reverse direction. A CHECK may still permit a value nothing
 * produces ('fallback' did, for a fortnight). That is the dead-vocabulary guard's
 * job, and it needs a producer catalogue this one does not have.
 *
 * Matched by column NAME, like the dead-column guard, and with the same blind
 * spot: a Zod key that shares a name with a different table's column is compared
 * against whichever CHECKs carry that name — here that is a feature, since the
 * value has to be legal wherever it lands.
 */

const ADMIN_URL = testAdminUrl();
const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');
const schemasDir = join(here, '..', '..', 'schemas', 'src');

let admin: Pool;
let dbUp = false;

/**
 * Values a contract accepts that no column stores, ON PURPOSE — a request-only
 * sentinel expanded before any INSERT, for instance.
 *
 * Empty today, and worth keeping empty: each entry needs a reason, because
 * "we meant to" is what every bug this guard exists to find would also say.
 * Keyed `field:value`.
 */
const DELIBERATELY_WIDER: Record<string, string> = {};

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

/** Every `IN (...)` vocabulary the database enforces, by column name. */
async function checkVocabularies(): Promise<Map<string, Set<string>[]>> {
  const r = await admin.query<{ table_name: string; def: string }>(
    `SELECT c.relname AS table_name, pg_get_constraintdef(con.oid) AS def
     FROM pg_constraint con
     JOIN pg_class c ON c.oid = con.conrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND con.contype = 'c'`,
  );
  const out = new Map<string, Set<string>[]>();
  for (const row of r.rows) {
    // Postgres renders `col IN ('a','b')` as `col = ANY (ARRAY['a'::text, …])`,
    // adding an explicit `(col)::text` cast only where the column is not text.
    for (const m of row.def.matchAll(/\(?(\w+)\)?(?:::text)?\s*=\s*ANY\s*\(+ARRAY\[(.*?)\]/gs)) {
      const column = m[1]!;
      const values = new Set([...m[2]!.matchAll(/'((?:[^']|'')*)'/g)].map((v) => v[1]!.replace(/''/g, "'")));
      if (values.size === 0) continue;
      const list = out.get(column) ?? [];
      list.push(values);
      out.set(column, list);
    }
  }
  return out;
}

/**
 * Every enum vocabulary the contracts bind to a field name.
 *
 * Two passes, because the schemas are written both ways: `export const
 * ConsentScope = z.enum([...])` used later as `scope: ConsentScope`, and the
 * inline `scope: z.enum([...])`. A one-pass regex would see only the inline
 * form, which is the minority — and silently pass on everything else.
 */
interface Binding {
  readonly key: string;
  readonly values: readonly string[];
  readonly where: string;
}

/**
 * Comments out, before anything reads a quoted word as a value.
 *
 * `DispatchStatus` carries the line `// No 'pending': a run is created
 * assigned` INSIDE its array, and the first version of this guard reported
 * 'pending' as a value the database refuses — which is true, and precisely the
 * reason the comment is there. A guard that reads prose as code manufactures
 * findings, and a manufactured finding costs more than a missed one: it teaches
 * the reader to skim the output.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // Not `://`, so a URL in a schema default survives.
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function zodVocabularies(): Binding[] {
  const sources = readdirSync(schemasDir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => ({ file: f, src: stripComments(readFileSync(join(schemasDir, f), 'utf8')) }));

  const named = new Map<string, string[]>();
  for (const { src } of sources) {
    for (const m of src.matchAll(/const\s+(\w+)\s*=\s*z\s*\.\s*enum\(\s*\[([^\]]*)\]/gs)) {
      named.set(m[1]!, [...m[2]!.matchAll(/'([^']*)'/g)].map((v) => v[1]!));
    }
  }

  // Each binding site stands alone. Merging by key would union every `status` in
  // the product into one impossible vocabulary and report a failure on all of
  // them — an assertion nobody could act on is not a guard.
  const out: Binding[] = [];
  const seen = new Set<string>();
  const bind = (key: string, values: readonly string[], where: string) => {
    if (values.length === 0) return;
    const id = `${key}:${[...values].sort().join('|')}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ key, values, where });
  };
  for (const { file, src } of sources) {
    for (const m of src.matchAll(/(\w+):\s*z\s*\.\s*enum\(\s*\[([^\]]*)\]/gs)) {
      bind(m[1]!, [...m[2]!.matchAll(/'([^']*)'/g)].map((v) => v[1]!), `${file} (inline)`);
    }
    // `channel: ConsentChannel,` / `.optional()` / `.nullable()` / `.default(…)`.
    for (const m of src.matchAll(/(\w+):\s*([A-Z]\w+)\s*(?:\.\w+\([^)]*\)\s*)*[,;)]/g)) {
      const values = named.get(m[2]!);
      if (values) bind(m[1]!, values, `${file} (${m[2]!})`);
    }
  }
  return out;
}

it('no contract accepts a value its column would refuse', async (ctx) => {
  if (!dbUp) return ctx.skip();

  const dbEnums = await checkVocabularies();
  const bindings = zodVocabularies();
  expect(dbEnums.size, 'no CHECK vocabularies parsed — the parser has drifted').toBeGreaterThan(20);
  expect(bindings.length, 'no Zod enums parsed — the parser has drifted').toBeGreaterThan(20);

  const all = [...dbEnums.values()].flat();
  const rejected: string[] = [];
  for (const { key, values, where } of bindings) {
    // The vocabulary needs A HOME: some column able to store all of it. Matching
    // by name alone was too weak — `reason: RevokedReason` is a revoke-consent
    // input bound for `consent_ledger.revoked_reason`, and got compared against
    // `internal_dnc.reason` purely because both are spelled "reason". Asking for
    // a superset column instead trades a little precision for evidence that
    // holds: an enum with nowhere to live is one the database will reject.
    const accepted = values.filter((v) => !(`${key}:${v}` in DELIBERATELY_WIDER));
    if (accepted.length === 0) continue;
    // A key no column is named after is an API-only vocabulary (a sort order, a
    // filter) and has nothing to be checked against.
    if (!dbEnums.has(key)) continue;
    if (all.some((v) => accepted.every((a) => v.has(a)))) continue;

    const sameName = (dbEnums.get(key) ?? []).map((v) => [...v].sort().join('|'));
    const homeless = accepted.filter((a) => !all.some((v) => v.has(a)));
    rejected.push(
      `${where} — ${key} = {${accepted.join(', ')}}: no column can store all of it` +
      (homeless.length > 0 ? `; nothing anywhere permits ${homeless.join(', ')}` : '') +
      (sameName.length > 0 ? `; columns named ${key} allow ${sameName.join(' / ')}` : ''),
    );
  }

  expect(
    rejected,
    `the contracts accept vocabularies no column can hold — a request carrying one of these values is a 500 at INSERT time, not a 400:\n  ${rejected.join('\n  ')}`,
  ).toEqual([]);
});
