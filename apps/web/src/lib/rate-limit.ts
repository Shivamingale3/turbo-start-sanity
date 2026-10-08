import { createHash, randomUUID } from "node:crypto";
import { env } from "@workspace/env/server";
import { Logger } from "@workspace/logger";

const logger = new Logger("RateLimit");

// Upstash is a network call; a slow Redis must not slow every request.
const REDIS_TIMEOUT_MS = 500;

// Cap the in-memory fallback so rotating IPs can't grow it without bound.
const MAX_MEMORY_KEYS = 5000;

export type RateLimitResult = {
  allowed: boolean;
  // Blocked attempts are counted too, so waiting one full window with no
  // attempts is the only guaranteed reset. Conservative, but always correct.
  retryAfterSeconds: number;
  store: "redis" | "memory";
};

type RateLimitOptions = {
  key: string;
  limit: number;
  windowMs: number;
};

/**
 * Sliding-window log. Every attempt is recorded, including blocked ones, so
 * a script that keeps hammering stays blocked until it stops for a window.
 * Upstash is the shared store across instances; when it is unset, slow or
 * down we fall back to a per-instance memory log instead of failing open.
 */
export async function rateLimit(
  options: RateLimitOptions
): Promise<RateLimitResult> {
  const now = Date.now();
  const scoped = { ...options, key: `ratelimit:${options.key}` };

  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) {
    try {
      return await redisRateLimit(
        scoped,
        now,
        env.UPSTASH_REDIS_REST_URL,
        env.UPSTASH_REDIS_REST_TOKEN
      );
    } catch (error) {
      logger.warn("Upstash unavailable, using in-memory rate limit", {
        reason: error instanceof Error ? error.name : "unknown",
      });
    }
  }
  return memoryRateLimit(scoped, now);
}

/** Hashed client IP, so raw IPs never reach Redis or logs. */
export function clientKey(request: Request, scope: string): string {
  // Vercel sets x-real-ip and overwrites x-forwarded-for, so clients can't
  // spoof them there. Locally both are missing and everyone shares one key.
  const ip =
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const hashed = createHash("sha256").update(ip).digest("hex").slice(0, 16);
  return `${scope}:${hashed}`;
}

async function redisRateLimit(
  { key, limit, windowMs }: RateLimitOptions,
  now: number,
  url: string,
  token: string
): Promise<RateLimitResult> {
  // One MULTI/EXEC transaction: prune old entries, record this attempt,
  // count, refresh expiry. Atomic, so parallel requests can't both slip in.
  const response = await fetch(`${url}/multi-exec`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify([
      ["ZREMRANGEBYSCORE", key, 0, now - windowMs],
      ["ZADD", key, now, `${now}-${randomUUID()}`],
      ["ZCARD", key],
      ["PEXPIRE", key, windowMs],
    ]),
    signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Upstash responded ${response.status}`);
  }

  const results = (await response.json()) as Array<{ result?: unknown }>;
  const count = results[2]?.result;
  if (typeof count !== "number") {
    throw new Error("Unexpected Upstash response");
  }
  return toResult(count, limit, windowMs, "redis");
}

// Per-instance fallback. Map keeps insertion order, so re-inserting a key on
// every hit makes the first key the least recently used one to evict.
const memoryLog = new Map<string, number[]>();

function memoryRateLimit(
  { key, limit, windowMs }: RateLimitOptions,
  now: number
): RateLimitResult {
  const hits = (memoryLog.get(key) ?? []).filter((t) => t > now - windowMs);
  hits.push(now);
  memoryLog.delete(key);
  memoryLog.set(key, hits);

  if (memoryLog.size > MAX_MEMORY_KEYS) {
    const leastRecent = memoryLog.keys().next().value;
    if (leastRecent !== undefined) {
      memoryLog.delete(leastRecent);
    }
  }
  return toResult(hits.length, limit, windowMs, "memory");
}

function toResult(
  count: number,
  limit: number,
  windowMs: number,
  store: RateLimitResult["store"]
): RateLimitResult {
  return {
    allowed: count <= limit,
    retryAfterSeconds: Math.ceil(windowMs / 1000),
    store,
  };
}
