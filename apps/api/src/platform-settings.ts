import { KILL_SWITCH_TTL_MS, PLATFORM_SETTING_KEYS, type PlatformSettingKeyT } from '@dealpilot/schemas';

/**
 * F-72 — reading the platform kill switches (admin-console.md §5.3; D-073).
 *
 * §5.3 says "read every request via an LRU cache". Honestly, in this system,
 * that is a per-process TTL snapshot of two booleans, and two claims — no
 * more:
 *
 *  1. **The read can never silently fall back to OFF.** There is no
 *     `try`/`catch`, no default-false, and a key with NO ROW reads as ON. A
 *     database that cannot answer "is sending paused?" makes the send fail
 *     rather than proceed. That is the one property a kill switch may not get
 *     wrong.
 *  2. **Propagation is bounded by {@link KILL_SWITCH_TTL_MS}, in every
 *     process, and by nothing else.** There is no invalidation channel:
 *     `REDIS_URL` is optional in `env.ts`, so a pub/sub broadcast would be a
 *     guarantee that is silently not one on a machine without Redis. The
 *     console prints the TTL beside the switch instead of implying that a
 *     flip is instantaneous.
 *
 * What this is NOT: on a cache HIT — which is the overwhelming majority of
 * sends — `killSwitches(c)` never touches `c`, so this is not "read inside the
 * transaction that records the send". Only a miss is.
 *
 * The console reads through `admin_list_platform_settings()` instead, never
 * through here, so a staffer who just flipped a switch sees the truth rather
 * than a five-second-old picture of it.
 *
 * **Module identity matters in tests.** `apps/workers` resolves
 * `@dealpilot/api/platform-settings` to `./dist/platform-settings.js`, while
 * `apps/api`'s own suites import `./platform-settings.js` from source — two
 * distinct instances of the state below. Each suite is internally consistent
 * (worker suites reach the API only through `@dealpilot/api/app`, i.e. dist),
 * so the rule is: an `apps/api` suite resets through `./platform-settings.js`,
 * an `apps/workers` suite through `@dealpilot/api/platform-settings`, and no
 * suite mixes the two.
 */

/** The minimum of `pg`'s Pool and PoolClient this module needs. */
export interface Queryable {
  query<R extends Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
}

export type KillSwitches = Record<PlatformSettingKeyT, boolean>;

let snapshot: { at: number; value: KillSwitches } | null = null;
let inFlight: Promise<KillSwitches> | null = null;
/**
 * Bumped on every reset. A read that was already in flight when the switch was
 * flipped is carrying pre-flip rows, so it may answer its own callers but must
 * not INSTALL what it read — otherwise the flipping process serves the stale
 * value, freshly stamped, for a whole TTL.
 */
let generation = 0;

/**
 * Drop the snapshot. Called by the flip route so the flipping process obeys
 * its own switch immediately, and by `beforeEach` in every suite that sends.
 */
export function resetKillSwitchCache(): void {
  snapshot = null;
  inFlight = null;
  generation += 1;
}

export async function killSwitches(db: Queryable, now: () => number = Date.now): Promise<KillSwitches> {
  const t = now();
  if (snapshot && t - snapshot.at <= KILL_SWITCH_TTL_MS) return snapshot.value;
  // Coalesce a burst after expiry into ONE query. The `finally` is not a
  // catch: the rejection still reaches every waiter of this attempt. It exists
  // so a FAILED read does not leave a rejected promise parked in `inFlight`,
  // which would make every later call reject forever — under fail-closed that
  // is "no message can ever be sent again until the process restarts", long
  // after the database recovered.
  if (inFlight) return inFlight;
  const mine = generation;
  inFlight = (async () => {
    const r = await db.query<{ setting_key: PlatformSettingKeyT; enabled: boolean }>(
      'SELECT setting_key, enabled FROM platform_settings WHERE setting_key = ANY($1::text[])',
      [[...PLATFORM_SETTING_KEYS]],
    );
    const value = Object.fromEntries(
      // A missing row reads as ON. The rows are seeded in 0068 and the app
      // role holds no DELETE, so absence means tampering — and the safe
      // answer to "has someone tampered with the kill switches?" is "stop".
      PLATFORM_SETTING_KEYS.map((k) => [k, r.rows.find((x) => x.setting_key === k)?.enabled ?? true]),
    ) as KillSwitches;
    // Only this attempt's own generation may install. A flip that happened
    // while the SELECT was open already invalidated these rows.
    if (mine === generation) snapshot = { at: now(), value };
    return value;
  })().finally(() => {
    // Likewise: a reset already nulled `inFlight` and a later attempt may
    // have parked its own promise there. Only clear what is still ours.
    if (mine === generation) inFlight = null;
  });
  return inFlight;
}
