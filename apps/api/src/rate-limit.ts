import { Redis } from 'ioredis';

/**
 * F-44 — production rate limiting (NFR/security baseline; D-048).
 *
 * Token bucket, because the baseline says token bucket: a burst is allowed up
 * to `burst`, then requests drain at `ratePerMinute`. Redis-backed when
 * REDIS_URL is set — one bucket per key across every instance behind the ALB,
 * atomically via Lua — and in-memory otherwise (per-instance, which is what a
 * single dev instance is anyway).
 *
 * FAIL-OPEN, on purpose and only here: if Redis dies, requests pass and the
 * failure is warn-logged. A limiter is an abuse dampener; the authentication,
 * signature, and consent gates all stay fail-CLOSED. Turning a Redis outage
 * into a full API outage would defend against attackers by doing their job
 * for them.
 */

export interface RateVerdict {
  allowed: boolean;
  /** Whole seconds until a single request would fit. 0 when allowed. */
  retryAfterS: number;
}

export interface RateLimiter {
  take(key: string, opts: { ratePerMinute: number; burst: number }): Promise<RateVerdict>;
  close(): Promise<void>;
}

/** Classic token bucket, shared by both stores so the semantics match. */
function drain(
  tokens: number,
  lastMs: number,
  nowMs: number,
  ratePerMinute: number,
  burst: number,
): { tokens: number; verdict: RateVerdict } {
  const refill = ((nowMs - lastMs) / 60_000) * ratePerMinute;
  const filled = Math.min(burst, tokens + Math.max(0, refill));
  if (filled >= 1) {
    return { tokens: filled - 1, verdict: { allowed: true, retryAfterS: 0 } };
  }
  const deficit = 1 - filled;
  return {
    tokens: filled,
    verdict: { allowed: false, retryAfterS: Math.ceil((deficit * 60) / ratePerMinute) },
  };
}

/** Single-process bucket for dev and tests. `now` injectable for the clock. */
export function memoryRateLimiter(now: () => number = Date.now): RateLimiter {
  const buckets = new Map<string, { tokens: number; lastMs: number }>();
  return {
    async take(key, opts) {
      // Opportunistic sweep so a scan of tokens cannot grow the map forever.
      if (buckets.size > 50_000) {
        const floor = now() - 10 * 60_000;
        for (const [k, b] of buckets) if (b.lastMs < floor) buckets.delete(k);
      }
      const nowMs = now();
      const b = buckets.get(key) ?? { tokens: opts.burst, lastMs: nowMs };
      const { tokens, verdict } = drain(b.tokens, b.lastMs, nowMs, opts.ratePerMinute, opts.burst);
      buckets.set(key, { tokens, lastMs: nowMs });
      return verdict;
    },
    async close() {},
  };
}

/**
 * The same bucket in Redis, atomic via Lua — HGET/refill/decide/HSET cannot
 * interleave between instances. Keys expire at twice their refill horizon.
 */
const LUA = `
local tokens = redis.call('HGET', KEYS[1], 't')
local ts = redis.call('HGET', KEYS[1], 'ts')
local burst = tonumber(ARGV[2])
local rate = tonumber(ARGV[1])
local now = tonumber(ARGV[3])
if tokens == false then tokens = burst else tokens = tonumber(tokens) end
if ts == false then ts = now else ts = tonumber(ts) end
local refill = ((now - ts) / 60000) * rate
if refill < 0 then refill = 0 end
local filled = tokens + refill
if filled > burst then filled = burst end
local allowed = 0
local retry = 0
if filled >= 1 then
  filled = filled - 1
  allowed = 1
else
  retry = math.ceil(((1 - filled) * 60) / rate)
end
redis.call('HSET', KEYS[1], 't', filled, 'ts', now)
redis.call('PEXPIRE', KEYS[1], math.ceil((burst / rate) * 60000) * 2)
return {allowed, retry}
`;

export function redisRateLimiter(
  redisUrl: string,
  warn: (obj: Record<string, unknown>, msg: string) => void,
): RateLimiter {
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 2, lazyConnect: false });
  redis.defineCommand('dpTakeToken', { numberOfKeys: 1, lua: LUA });
  const client = redis as Redis & {
    dpTakeToken(key: string, rate: number, burst: number, now: number): Promise<[number, number]>;
  };
  return {
    async take(key, opts) {
      try {
        const [allowed, retry] = await client.dpTakeToken(
          `limiter:${key}`,
          opts.ratePerMinute,
          opts.burst,
          Date.now(),
        );
        return { allowed: allowed === 1, retryAfterS: retry };
      } catch (err) {
        // Fail open, loudly (see the header for why).
        warn({ key, err: err instanceof Error ? err.message : String(err) }, 'rate limiter unreachable — letting the request pass');
        return { allowed: true, retryAfterS: 0 };
      }
    },
    async close() {
      redis.disconnect();
    },
  };
}

export function createRateLimiter(
  env: { REDIS_URL?: string | undefined },
  warn: (obj: Record<string, unknown>, msg: string) => void,
): RateLimiter {
  return env.REDIS_URL ? redisRateLimiter(env.REDIS_URL, warn) : memoryRateLimiter();
}
