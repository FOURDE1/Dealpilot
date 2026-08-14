import { afterAll, beforeAll, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPool, testAdminUrl, type Pool } from './index.js';
import { reset } from './migrate.js';
import { ensureTestDatabase } from './test-db.js';

/**
 * High-sensitivity PII stays out until it can be encrypted (FR-CON-007, ADR-015).
 *
 * ADR-015 requires SIN, driver's licence number, date of birth, income and
 * banking details to be AES-256-GCM envelope-encrypted with per-tenant KMS data
 * keys, with blind HMAC indexes for lookup. It is a P0 requirement and no KMS
 * key is provisioned, because paid AWS has not been authorised.
 *
 * So `contacts` was built without those columns. This is the guard that keeps
 * them out — not because anyone plans to add a plaintext SIN, but because
 * nobody ever plans to. A column gets added "temporarily" during a slice about
 * something else, the encryption lands months later, and by then the plaintext
 * is in every backup taken in between. Backups are the part that cannot be
 * fixed afterwards.
 *
 * When ADR-015 exists: encrypt the field, then delete its name from FORBIDDEN
 * with the migration number in the commit. The failure message says so.
 */

const ADMIN_URL = testAdminUrl();
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

let admin: Pool;
let dbUp = false;

/**
 * Column names that may not exist on ANY tenant table without field-level
 * encryption. Substring-matched, so `dob`, `date_of_birth` and `birth_date` are
 * all caught by their roots.
 */
const FORBIDDEN: { fragment: string; why: string }[] = [
  { fragment: 'sin', why: 'social insurance number (ADR-015)' },
  { fragment: 'social_insurance', why: 'social insurance number (ADR-015)' },
  { fragment: 'licence_number', why: "driver's licence number (ADR-015)" },
  { fragment: 'license_number', why: "driver's licence number (ADR-015)" },
  { fragment: 'date_of_birth', why: 'date of birth (ADR-015)' },
  { fragment: 'birth_date', why: 'date of birth (ADR-015)' },
  { fragment: 'income', why: 'income and credit-application detail (ADR-015)' },
  { fragment: 'bank_account', why: 'banking detail (ADR-015)' },
  { fragment: 'void_cheque', why: 'banking detail (ADR-015)' },
  { fragment: 'routing_number', why: 'banking detail (ADR-015)' },
  { fragment: 'transit_number', why: 'banking detail (ADR-015)' },
];

/**
 * Columns whose NAME matches a fragment but which hold no PII.
 * Each needs a reason, on the usual grounds.
 */
const NOT_ACTUALLY_PII = new Set<string>([
  // `single`, `using`, `business` and friends contain "sin" as a substring.
  // Matched on word boundaries below rather than exempted one by one.
]);

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

it('no tenant table holds high-sensitivity PII in plaintext', async (ctx) => {
  if (!dbUp) return ctx.skip();

  const cols = await admin.query<{ table_name: string; column_name: string }>(
    `SELECT c.table_name, c.column_name
     FROM information_schema.columns c
     JOIN information_schema.tables t
       ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
       AND EXISTS (
         SELECT 1 FROM information_schema.columns o
         WHERE o.table_schema = 'public' AND o.table_name = c.table_name
           AND o.column_name = 'organization_id'
       )`,
  );
  // A schema change that emptied this query would make the assertion vacuous.
  expect(cols.rows.length).toBeGreaterThan(50);

  const offenders: string[] = [];
  for (const row of cols.rows) {
    const qualified = `${row.table_name}.${row.column_name}`;
    if (NOT_ACTUALLY_PII.has(qualified)) continue;
    // Word-boundary parts, so `business_name` does not match `sin`.
    const parts = row.column_name.split('_');
    for (const { fragment, why } of FORBIDDEN) {
      const hit = fragment.includes('_')
        ? row.column_name.includes(fragment)
        : parts.includes(fragment);
      if (hit) offenders.push(`${qualified} — ${why}`);
    }
  }

  expect(
    offenders,
    `these columns hold PII that ADR-015 requires to be AES-256-GCM encrypted with a per-tenant KMS data key, and no encryption exists yet. Plaintext here reaches every backup taken before the fix, and a backup cannot be un-taken. Encrypt the field first, then remove its fragment from FORBIDDEN in the same commit:\n  ${offenders.join('\n  ')}`,
  ).toEqual([]);
});
