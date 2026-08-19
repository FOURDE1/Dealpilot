import { Redis } from 'ioredis';

/**
 * F-43 — agent presence (FR-LEAD-014, ADR-004, D-047).
 *
 * A successful realtime SUBSCRIBE is the heartbeat: F-28 re-verifies session
 * and membership per org on every subscribe, so a mark here is "a verified
 * member of this org is actively holding its app open". Marks are refreshed
 * every 60s by the socket layer and age out after 180s — the spec's 3-minute
 * auto-offline — which handles crashed tabs, sleeping laptops, and clean
 * exits identically, with no offline write anywhere.
 *
 * The read is TRI-STATE on purpose (D-045 #1 / D-047 #2): an org that has
 * NEVER produced presence data returns null and the cascade skips the online
 * filter; an org that has returns a real set — possibly EMPTY, which means
 * genuinely nobody online and the funnel escalates, exactly the off-hours
 * behavior the spec wants. The first-touch marker lives 7 days so a quiet
 * weekend does not silently disable the filter.
 */

/** Auto-offline window: no refresh for this long = not online (spec: 3 min). */
export const PRESENCE_TTL_MS = 3 * 60 * 1000;

/** How long "this org has presence data" is remembered across quiet spells. */
const SEEN_TTL_S = 7 * 24 * 60 * 60;

export interface PresenceStore {
  /** A verified member's socket proved life in this org. */
  touch(organizationId: string, userId: string): Promise<void>;
  /** null = no data for this org, ever (D-047 #2). Empty set = nobody online. */
  onlineIn(organizationId: string): Promise<ReadonlySet<string> | null>;
  close(): Promise<void>;
}

/** Single-process presence for dev and tests. `now` injectable for the clock. */
export function inMemoryPresenceStore(now: () => number = Date.now): PresenceStore {
  const marks = new Map<string, Map<string, number>>();
  return {
    async touch(organizationId, userId) {
      const org = marks.get(organizationId) ?? new Map<string, number>();
      org.set(userId, now());
      marks.set(organizationId, org);
    },
    async onlineIn(organizationId) {
      const org = marks.get(organizationId);
      if (!org) return null;
      const floor = now() - PRESENCE_TTL_MS;
      const live = new Set<string>();
      for (const [user, ts] of org) {
        if (ts >= floor) live.add(user);
        else org.delete(user);
      }
      return live;
    },
    async close() {},
  };
}

/**
 * Multi-instance presence: one sorted set per org (member = user, score =
 * last touch), pruned on read, plus the 7-day first-touch marker. Every
 * instance behind the ALB agrees because Valkey does.
 */
export function redisPresenceStore(redisUrl: string): PresenceStore {
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 3, lazyConnect: false });
  const zkey = (org: string) => `presence:${org}`;
  const seenKey = (org: string) => `presence:seen:${org}`;
  return {
    async touch(organizationId, userId) {
      await redis
        .multi()
        .zadd(zkey(organizationId), Date.now(), userId)
        .set(seenKey(organizationId), '1', 'EX', SEEN_TTL_S)
        .exec();
    },
    async onlineIn(organizationId) {
      const seen = await redis.exists(seenKey(organizationId));
      if (seen === 0) return null;
      const floor = Date.now() - PRESENCE_TTL_MS;
      await redis.zremrangebyscore(zkey(organizationId), '-inf', floor - 1);
      const live = await redis.zrange(zkey(organizationId), 0, -1);
      return new Set(live);
    },
    async close() {
      redis.disconnect();
    },
  };
}
