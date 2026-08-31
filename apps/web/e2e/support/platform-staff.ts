import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * F-74 — the suite's ONE non-UI seeding channel: the first platform staffer.
 *
 * platform_staff has no UI producer for its FIRST row. The no-actor CLI
 * bootstrap (`platform_staff_grant(NULL, …)`) is legal only while no ACTIVE
 * platform_super_admin exists — the re-created grant in migration 0067
 * raises PA010 (0067:630) otherwise — and the database is reset once per
 * `pnpm e2e`, so exactly ONE spec file may call this, once.
 * f74-console-door.e2e.ts owns it; bootstrap-guard.test.ts turns a second
 * importer (or a deleted journey) into a red `checks` build.
 *
 * Note that `platform_assert_actor` does no MFA check, so the CLI COULD mint
 * every later staffer too — which is exactly why the SECOND staffer is
 * granted from the console instead (/admin/staff, in the journey): minting
 * it here would delete the only console-write test this slice affords.
 *
 * Contract (producer: scripts/e2e.mjs, and only it):
 *   DEALPILOT_E2E_DB      the database NAME (must end _test — re-checked here)
 *   DEALPILOT_E2E_DB_CLI  absolute path to packages/db/dist/cli.js
 * A bare `playwright test` has neither, so this helper cannot reach anything
 * outside the runner's stack. DB_ADMIN_URL stays host-shaped (host, port,
 * owner credentials); the CLI's positional-dbname path forces the *_test
 * rule again before opening any connection.
 */
export function bootstrapSuperAdmin(email: string): void {
  const db = process.env['DEALPILOT_E2E_DB'];
  const cli = process.env['DEALPILOT_E2E_DB_CLI'];
  if (!db || !cli) {
    throw new Error(
      'bootstrapSuperAdmin: DEALPILOT_E2E_DB / DEALPILOT_E2E_DB_CLI are unset — run the suite with `pnpm e2e` (scripts/e2e.mjs), the only producer of this contract.',
    );
  }
  // Belt and braces on top of the CLI's own rule: even a hand-exported name
  // must end _test before this process shells out at all.
  if (!/_test$/.test(db)) {
    throw new Error(`bootstrapSuperAdmin: refusing database "${db}" — not a *_test name.`);
  }
  if (!existsSync(cli)) {
    throw new Error(
      `bootstrapSuperAdmin: ${cli} does not exist — run \`pnpm e2e\`, which builds it. (A bare playwright invocation skips the build; this check exists so the failure names the fix instead of MODULE_NOT_FOUND.)`,
    );
  }
  let stdout: string;
  try {
    // Synchronous on purpose: the CLI takes ~1s (fresh node + pg connect) and
    // nothing useful can interleave with it; async would only add moving
    // parts. The 30s timeout makes a hung CLI fail as itself rather than as
    // the 90s test ceiling.
    stdout = execFileSync(process.execPath, [cli, 'platform-grant', email, 'platform_super_admin', db], {
      env: process.env,
      encoding: 'utf8',
      timeout: 30_000,
    });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    const detail = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    if (detail.includes('Bootstrap closed')) {
      throw new Error(
        'bootstrapSuperAdmin hit PA010: the no-actor grant is one per database, and this database already spent it. ' +
          'The reset runs once per `pnpm e2e`, so exactly one spec may bootstrap — a second staffer is granted from ' +
          'the console (/admin/staff), as f74-console-door.e2e.ts does. A --retries run also lands here: the retry ' +
          'attempt finds the one-shot spent (the runner refuses --retries for this reason).',
      );
    }
    throw new Error(`bootstrapSuperAdmin failed: ${e.message}\n${detail}`);
  }
  // CLI spellings (cli.ts prints the raw SQL outcome — the UI's i18n key
  // `roleChanged` never appears on stdout): `reinstated` / `role_changed` /
  // `unchanged` each mean the database was NOT fresh, which must fail loudly
  // rather than pass.
  if (!stdout.includes('granted:')) {
    throw new Error(`bootstrapSuperAdmin: expected a fresh 'granted:' outcome, got:\n${stdout}`);
  }
}
