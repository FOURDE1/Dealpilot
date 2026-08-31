#!/usr/bin/env node
/**
 * F-74 — the ONE way to run the e2e suite, locally and in CI.
 *
 * CI's e2e step is `run: node scripts/e2e.mjs` with no env: block, and the
 * root `pnpm e2e` script is the same call — so the two worlds cannot drift.
 * (REDIS_URL unset locally while set in CI is what made F-72's entire local
 * gate evidence about a program CI does not build; this file is where that
 * class of divergence stops.) Node rather than bash because the owner is on
 * Windows and CI is Ubuntu — a .sh would run in exactly one of the two.
 *
 * The suite runs against its own disposable *_test database (the E2E_DB
 * constant below), rebuilt from migration zero every run. The _test suffix
 * is load-bearing: reset() refuses any other name, so the existing safety
 * guard IS the enforcement, and the reset confirmation escape hatch is never
 * set anywhere on this path (apps/web/e2e/e2e-isolation-guard.test.ts pins
 * that, this file's name literal, and every postgresql:// literal on the path).
 *
 * Ordering is the point of this file: the reset runs BEFORE the API is
 * spawned, so the API pools against a schema that already exists. It must
 * never move into a Playwright globalSetup — see the comment in
 * apps/web/playwright.config.ts for the verified reason (webServer plugins
 * start strictly before globalSetup files in playwright@1.61.1).
 *
 * Style note: eslint.config.js grants **\/scripts/**\/*.mjs exactly four
 * globals — process, console, fetch, AbortSignal. Everything else here is
 * imported from node: modules on purpose; adding a bare setTimeout or URL
 * fails `pnpm lint`.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { URL, fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- the contract: every value the stack needs, computed here, one producer -

/**
 * The e2e database. The ONLY occurrence of this literal in this file — the
 * isolation guard pins that — so everything below derives from the constant
 * and a second spelling cannot drift from it. Point it at a non-_test name
 * and the CLI's disposableDatabaseUrl() refuses before a browser ever starts.
 */
const E2E_DB = 'dealpilot_e2e_test';

/**
 * Single parse of the database host/port (one producer, stated precedence):
 * an explicit DB_ADMIN_URL wins; DEALPILOT_DB_PORT only feeds the default
 * when DB_ADMIN_URL is unset. The default names database `dealpilot` — that
 * is deliberate and it is the e2e path's ONE connection to that database: a
 * host-shaped maintenance target for CREATE DATABASE, never a schema read or
 * write. It doubles as the foreign-cluster refusal: another Postgres squatting
 * on the port has no `dealpilot` database and fails loudly here.
 */
const ADMIN_BASE =
  process.env.DB_ADMIN_URL ??
  `postgresql://dealpilot:dealpilot@localhost:${process.env.DEALPILOT_DB_PORT ?? 5434}/dealpilot`;
const admin = new URL(ADMIN_BASE);
const dbHost = admin.hostname;
const dbPort = admin.port || '5432';

// Both ports live OFF the dev defaults (3001/5173) so the owner's `pnpm dev`
// stack can stay up while the suite runs — and they are constants, not env
// reads. This file is the ports' one producer (playwright.config.ts and
// vite.config.ts receive them from the export further down), so a stray
// DEALPILOT_*_PORT in someone's shell cannot move the probe below onto a dev
// port: the refusal text's "dev ports are never probed" has to be true
// unconditionally. 5176 is also not Vite's next-port hop (5174), where a
// second Vite on this desktop lands by itself.
const API_PORT = 3101;
const WEB_PORT = 5176;

const REDIS_PORT = Number(process.env.DEALPILOT_REDIS_PORT ?? 6381);
const REDIS_URL = `redis://localhost:${REDIS_PORT}`;

// The API's own URL: same cluster as the maintenance target, the RLS-bound
// app role, and the _test database — asserted again right before the spawn.
const DATABASE_URL = `postgresql://dealpilot_app:dealpilot_app_dev@${dbHost}:${dbPort}/${E2E_DB}`;

// WEB_ORIGIN derives from the SAME constant handed to Playwright, so the
// CORS trap (SPA port moved, origin not) cannot be armed by an override.
const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
const BETTER_AUTH_URL = `http://localhost:${API_PORT}`;

const CLI = join(root, 'packages', 'db', 'dist', 'cli.js');
const LOG_DIR = join(root, '.e2e');
const LOG_PATH = join(LOG_DIR, 'api.log');
const LOCK_PATH = join(LOG_DIR, 'lock');

// --- helpers ----------------------------------------------------------------

/** Run one shell command string (pnpm/turbo resolve through the shell on Windows). */
function run(cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    // A single command STRING with shell:true — an args array plus shell
    // triggers Node 24's DEP0190 warning on every spawn.
    const child = spawn(cmd, { shell: true, stdio: 'inherit', cwd: root, ...opts });
    child.once('error', reject);
    child.once('exit', (code) => (code === 0 ? resolve(undefined) : reject(new Error(`\`${cmd}\` exited ${code}`))));
  });
}

/**
 * The node child currently running under runNode(), so the signal handler
 * installed after the API spawn can take it down too (Playwright owns the
 * SPA's Vite on 5176; a pid-only signal to this runner would otherwise leave
 * that pair running against a dead API).
 */
let activeChild = null;

/** Run node directly (no shell, no pnpm grandchild) and resolve its exit code. */
function runNode(args, env, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit', cwd: root, env, ...opts });
    activeChild = child;
    child.once('error', (err) => {
      activeChild = null;
      reject(err);
    });
    child.once('exit', (code) => {
      activeChild = null;
      resolve(code ?? 1);
    });
  });
}

/** Node sets exactly ONE of exitCode / signalCode when a child ends. */
function childDead(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

/** Kill a child and everything under it; a no-op for a child already gone. */
function killTree(child) {
  if (!child || childDead(child)) return;
  if (process.platform === 'win32') {
    // taskkill /T takes the whole tree; plain kill() cannot on Windows.
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

/** True when something answers TCP on host:port. */
function answers(host, port, timeoutMs = 750) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (result) => {
      sock.destroy();
      resolve(result);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

/** Raw PING/+PONG so the preflight needs no redis dependency. */
function redisAnswers(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: 'localhost', port });
    let buf = '';
    const done = (result) => {
      sock.destroy();
      resolve(result);
    };
    sock.setTimeout(2_000);
    sock.once('connect', () => sock.write('PING\r\n'));
    sock.on('data', (d) => {
      buf += d.toString();
      if (buf.includes('+PONG')) done(true);
    });
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

/** True when a pid is alive. ESRCH means gone; EPERM means alive but not ours. */
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/**
 * One runner per checkout. The port probe below cannot serialize two
 * runners: the API binds its port only AFTER the build and the from-zero
 * reset (~20 s on this desktop), so two `pnpm e2e` started inside that window
 * both pass the probe, and the second one DROPs the schema under the first
 * one's live API mid-suite — every spec then fails on missing tables and
 * reads as a product bug, and the second run truncates the first run's API
 * log on top. A pid file taken before anything destructive closes it; a lock
 * whose holder is dead (a crashed run) is stale and taken over. Released on
 * every exit path via the 'exit' event, which fires for process.exit() too.
 */
function acquireRunLock() {
  mkdirSync(LOG_DIR, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(LOCK_PATH, String(process.pid), { flag: 'wx' });
      process.on('exit', releaseRunLock);
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    let holder = NaN;
    try {
      holder = Number(readFileSync(LOCK_PATH, 'utf8').trim());
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      continue; // vanished between the two calls — try to take it again
    }
    if (Number.isInteger(holder) && holder > 0 && pidAlive(holder)) {
      fail(
        `another \`pnpm e2e\` (pid ${holder}) holds ${LOCK_PATH}. Two runners would reset ${E2E_DB} under each other's API ` +
          `mid-suite — wait for it to finish. (If pid ${holder} is not a runner, delete the lock file.)`,
      );
    }
    try {
      unlinkSync(LOCK_PATH); // stale: its holder is gone
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  fail(`could not take ${LOCK_PATH}: another runner won the race twice — retry.`);
}

function releaseRunLock() {
  try {
    if (readFileSync(LOCK_PATH, 'utf8').trim() === String(process.pid)) unlinkSync(LOCK_PATH);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

/** The last 80 log lines that are NOT the health poll's own traffic. */
function tailLog() {
  try {
    const lines = readFileSync(LOG_PATH, 'utf8').split(/\r?\n/);
    // Under NODE_ENV=development Fastify logs every request as an `incoming
    // request` / `request completed` pair sharing a reqId, and the poll below
    // produces one pair a second — 80 raw lines would be 40 s of the runner's
    // own 200s with the boot output long scrolled away. Drop both halves of
    // every /api/v1/health pair.
    const pollIds = new Set();
    for (const line of lines) {
      if (!line.includes('"url":"/api/v1/health"')) continue;
      const id = line.match(/"reqId":"([^"]+)"/)?.[1];
      if (id) pollIds.add(id);
    }
    const kept = lines.filter((line) => {
      const id = line.match(/"reqId":"([^"]+)"/)?.[1];
      return !(id && pollIds.has(id));
    });
    console.error(`--- last ${Math.min(80, kept.length)} lines of ${LOG_PATH} (health-poll traffic removed) ---`);
    console.error(kept.slice(-80).join('\n'));
  } catch {
    console.error(`(no API log at ${LOG_PATH})`);
  }
}

function fail(message) {
  console.error(`\ne2e: ${message}`);
  process.exit(1);
}

// --- 0. say what will be built, before anything is destroyed ----------------

console.log(
  `e2e stack: db=${dbHost}:${dbPort}/${E2E_DB} (maintenance via ${admin.pathname.slice(1)}) | ` +
    `api=http://localhost:${API_PORT} | spa=${WEB_ORIGIN} | redis=${REDIS_URL}`,
);

// --- 1. forwarded Playwright argv (pnpm e2e -- --headed --grep console) -----

const forwarded = process.argv.slice(2);
for (const arg of forwarded) {
  if (/^--(retries|repeat-each)(=|$)/.test(arg)) {
    // The console journey is serial against a once-reset database whose
    // platform_staff bootstrap one-shot is spent by the FIRST attempt: a
    // retried run hits PA010, which is unrecoverable and reads as a product
    // bug. Retry policy lives in playwright.config.ts (retries: 0).
    fail(`refusing ${arg}: a retry re-runs the console bootstrap against a database whose one-shot is already spent (PA010). Re-run \`pnpm e2e\` instead — every run starts from a fresh reset.`);
  }
}

// --- 2. Redis preflight (the F-72 divergence killer) ------------------------

if (!(await redisAnswers(REDIS_PORT))) {
  fail(
    `Redis is not answering on localhost:${REDIS_PORT}. The suite requires the same REDIS_URL CI sets — ` +
      'an unset REDIS_URL locally is exactly the divergence that made F-72’s local gate test a program CI does not build. Start it: `docker compose up -d`',
  );
}

// --- 3. one runner at a time, then the e2e ports must be OURS ---------------

acquireRunLock();

// Never adopt, never touch dev ports. Both address families: this desktop has
// already produced an orphaned server bound to IPv6-only [::1] (see the
// history in apps/web/playwright.config.ts), which an IPv4-only probe misses
// while Chrome still finds it.
for (const [label, port] of [
  ['API', API_PORT],
  ['SPA', WEB_PORT],
]) {
  for (const host of ['127.0.0.1', '::1']) {
    if (await answers(host, port)) {
      fail(
        `something is already listening on ${host}:${port} (${label}). This runner never adopts a server it did not start — ` +
          'it could be anything (an orphan of this runner, your dev stack on a moved port, a server on the DEV database) ' +
          'and the runner cannot tell which. Most often it is an orphan from a crashed `pnpm e2e` run: find it with ' +
          '`netstat -ano | findstr :' + port + '` (Windows) / `lsof -i :' + port + '` and kill it. ' +
          'The dev ports (3001/5173) are never probed — your dev stack can stay up.',
      );
    }
  }
}

// --- 4. build the full graph ------------------------------------------------

// Full graph, not --filter: apps/api's tsconfig.build.json has no project
// references, so its workspace dependencies resolve from whatever dist/ holds;
// and packages/db/dist/cli.js is what the reset below and the bootstrap helper
// execute. Turbo-cached — in CI this repeats the Build step for ~1s.
try {
  await run('pnpm turbo run build');
} catch (err) {
  fail(String(err instanceof Error ? err.message : err));
}

// --- 5. the database: created + reset from migration zero, EVERY run --------

// Unconditional (also in CI, where an earlier step already reset it for the
// workers probe): a runner that trusts a previous step to have prepared the
// database behaves differently when run alone — the divergence this file
// exists to kill. Direct node spawn of the built CLI: `reset <dbname>` routes
// the name through disposableDatabaseUrl(), whose *_test rule is the guard,
// and creates the database when missing. DB_ADMIN_URL is passed through
// host-shaped; the NAME is this file's literal, never an env var.
{
  const code = await runNode([CLI, 'reset', E2E_DB], { ...process.env, DB_ADMIN_URL: ADMIN_BASE });
  if (code !== 0) {
    fail(
      `database reset failed (exit ${code}). If Postgres is not running on ${dbHost}:${dbPort}: \`docker compose up -d\``,
    );
  }
}

// --- 6. belt and braces: the API may only ever pool a *_test database -------

// env.ts makes DATABASE_URL optional with the DEV database as its default, and
// the health endpoint says db:"up" for ANY reachable database — so a dropped
// or mistyped URL would boot the API on dev and every spec would run green
// against it. Refuse here, before the process exists.
if (!new URL(DATABASE_URL).pathname.endsWith('_test')) {
  fail(`refusing to start the API: DATABASE_URL names "${new URL(DATABASE_URL).pathname.slice(1)}", not a *_test database.`);
}

// --- 7. spawn the API (direct node child — no pnpm, no shell, no grandchild) -

// apps/api's dev script is `pnpm build && node dist/index.js`; after the full
// turbo build a direct spawn runs the same program, with ONE difference: cwd
// is the repo root here and apps/api under pnpm. The API's only cwd-relative
// read is the local document store (apps/api/src/storage.ts resolves
// DOCUMENT_STORAGE_DIR against process.cwd()), so e2e uploads land in
// <repo>/.storage/documents — gitignored at any depth, keyed by per-run
// organization ids. The direct spawn is what makes teardown reach the actual
// listener (SIGTERM to a pnpm wrapper can orphan the grandchild on POSIX — an
// orphan on the API port then blocks every later run at the probe above).
const logFd = openSync(LOG_PATH, 'w');
const api = spawn(process.execPath, [join(root, 'apps', 'api', 'dist', 'index.js')], {
  cwd: root,
  env: {
    ...process.env,
    DATABASE_URL,
    REDIS_URL,
    WEB_ORIGIN,
    BETTER_AUTH_URL,
    // Generated, not written down (and not `openssl rand` — this must run on
    // a stock Windows box the same as on the CI runner).
    BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
    PORT: String(API_PORT),
    NODE_ENV: 'development',
  },
  stdio: ['ignore', logFd, logFd],
});

function killApi() {
  killTree(api);
}

// A signal aimed at THIS process alone (`kill <pid>`, `pkill -f e2e.mjs`, a
// wrapper terminating its direct child) takes Node's default action — an
// immediate exit that runs no `finally` — and would leave the API listening:
// the orphan the probe above then reports on every later run. Ctrl-C already
// reaches the whole foreground group on both OSes; this makes the pid-only
// case behave the same. (A SIGKILL / `taskkill /F` on this pid cannot be
// trapped by anything — the probe stays the last line of defence.)
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, () => {
    killTree(activeChild);
    killApi();
    process.exit(130);
  });
}

// From here on, failures THROW instead of calling fail(): process.exit()
// inside the try would skip the finally below and leave the API child
// listening on its port — the orphan that then blocks every later run at
// the probe above. The catch prints the message; the finally kills the child.
let exitCode = 1;
try {
  // --- 8. health poll: parse the body, not just the status code -------------
  // GET /api/v1/health returns 200 with db:"down" when its database is
  // unreachable — a bare `curl -fsS` (the old CI line) accepted that. Require
  // {status:"ok",db:"up"}; catch an early death (exit OR signal — Node sets
  // exactly one of the two) with its log attached instead of surfacing as
  // every spec failing to reach the server; and report the LAST observation
  // on timeout, because "db":"down" for 90 s and "never bound the port" need
  // different fixes and the API logs nothing for a failed SELECT 1.
  let healthy = false;
  let last = 'no response';
  for (let i = 0; i < 90; i++) {
    if (childDead(api)) throw new Error(`the API exited (${api.exitCode ?? api.signalCode}) before becoming healthy`);
    try {
      const res = await fetch(`http://localhost:${API_PORT}/api/v1/health`, { signal: AbortSignal.timeout(2_000) });
      const text = await res.text();
      last = `${res.status} ${text}`;
      if (res.ok) {
        let body = null;
        try {
          body = JSON.parse(text);
        } catch {
          // not JSON — `last` already carries the raw text for the report
        }
        if (body && body.status === 'ok' && body.db === 'up') {
          healthy = true;
          break;
        }
      }
    } catch (err) {
      // not up yet — keep polling, and remember why for the timeout report
      last = err instanceof Error ? err.message : String(err);
    }
    await sleep(1_000);
  }
  if (!healthy) throw new Error(`the API never reported {status:"ok",db:"up"} within 90s — last seen: ${last}`);
  console.log('e2e: API healthy');

  // --- 9. Playwright (webServer starts the SPA only) ------------------------
  // Direct node spawn of the CLI keeps the forwarded argv an ARRAY — no shell
  // re-quoting of `pnpm e2e -- --grep "…"` on either OS.
  const playwrightCli = join(root, 'apps', 'web', 'node_modules', '@playwright', 'test', 'cli.js');
  if (!existsSync(playwrightCli)) throw new Error(`Playwright CLI not found at ${playwrightCli} — run \`pnpm install\` first.`);
  exitCode = await runNode(['--', playwrightCli, 'test', ...forwarded], {
    ...process.env,
    // The config refuses to load without this — a bare `playwright test`
    // pointing a browser at the dev stack is a refusal, not an accident.
    DEALPILOT_E2E: '1',
    DEALPILOT_WEB_PORT: String(WEB_PORT),
    DEALPILOT_API_PORT: String(API_PORT),
    // The bootstrap helper's contract (apps/web/e2e/support/platform-staff.ts):
    // the database NAME and the CLI to shell out to. DB_ADMIN_URL stays
    // host-shaped; the helper re-checks the /_test$/ rule before spawning.
    DEALPILOT_E2E_DB: E2E_DB,
    DEALPILOT_E2E_DB_CLI: CLI,
    DB_ADMIN_URL: ADMIN_BASE,
  }, { cwd: join(root, 'apps', 'web') });
} catch (err) {
  console.error(`\ne2e: ${err instanceof Error ? err.message : String(err)}`);
  exitCode = 1;
} finally {
  killApi();
  if (exitCode !== 0) tailLog();
}

process.exit(exitCode);
