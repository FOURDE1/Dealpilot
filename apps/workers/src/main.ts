import { start } from './index.js';

/**
 * The thing that actually runs the workers.
 *
 * There was no entrypoint. `start()` was exported and called by nothing: no bin,
 * no start script, no Dockerfile. The whole process — deferred sends and
 * assistant turns, F-32 and F-34 — could not be launched, which is also why the
 * BullMQ queue-name bug survived eight commits. Code nobody can run is code
 * nobody finds the bugs in.
 *
 * Kept separate from `index.ts` on purpose: importing the module must not start
 * a worker, or every test that imports `runDeferredSend` would open Redis
 * connections. `index.ts` builds, `main.ts` runs.
 */

/**
 * pino-shaped JSON so these lines sit alongside the API's in whatever collects
 * them. Written directly rather than through pino because pino is not a
 * dependency of this app and adding one is the owner's call, not mine — and
 * `console.*` is banned for the reason this satisfies anyway: logs are
 * structured records on stdout, not printing.
 */
function log(level: 30 | 40 | 50 | 60, msg: string, extra: Record<string, unknown> = {}): void {
  process.stdout.write(
    `${JSON.stringify({ level, time: Date.now(), pid: process.pid, name: 'workers', ...extra, msg })}\n`,
  );
}

/**
 * How long a shutdown may take before we stop being polite.
 *
 * ECS sends SIGTERM and then SIGKILLs 30s later, so a drain that runs longer
 * than that is not a graceful shutdown — it is the same hard kill with extra
 * steps, and the job it was protecting dies mid-flight regardless. Exiting at 25
 * means the last word in the log is ours.
 */
const SHUTDOWN_GRACE_MS = 25_000;

let stopping = false;

async function main(): Promise<void> {
  const worker = await start();
  log(30, 'workers up');

  async function shutdown(signal: string): Promise<void> {
    if (stopping) {
      // A second signal means somebody is impatient, and they are entitled to
      // be. Stop draining and go.
      log(40, 'second signal during shutdown — exiting now', { signal });
      process.exit(1);
    }
    stopping = true;
    log(30, 'draining', { signal });

    // BullMQ's close() waits for jobs already running, which is the whole point
    // — a deferred send interrupted between "sent to the carrier" and "recorded
    // in Postgres" is a message the customer received and the database denies.
    const timer = setTimeout(() => {
      log(50, 'drain exceeded the grace period — exiting with work in flight', {
        graceMs: SHUTDOWN_GRACE_MS,
      });
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    timer.unref();

    try {
      await worker.close();
      clearTimeout(timer);
      log(30, 'workers down');
      process.exit(0);
    } catch (err) {
      clearTimeout(timer);
      log(60, 'shutdown failed', { err: err instanceof Error ? err.message : String(err) });
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

// Fail loudly and exit non-zero rather than limping. A worker that stays alive
// after losing its queue connection consumes nothing while looking healthy to
// the orchestrator, which is the failure this project keeps writing guards
// against: present, reachable by nothing.
process.on('unhandledRejection', (reason) => {
  log(60, 'unhandled rejection', { err: reason instanceof Error ? reason.message : String(reason) });
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  log(60, 'uncaught exception', { err: err.message });
  process.exit(1);
});

try {
  await main();
} catch (err) {
  // Includes the deliberate refusal to boot without REDIS_URL.
  log(60, 'workers failed to start', { err: err instanceof Error ? err.message : String(err) });
  process.exit(1);
}
