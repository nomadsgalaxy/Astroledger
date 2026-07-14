// In-memory sliding-window rate limiter. Astroledger runs as a single
// container, so a process-local store is sufficient (no Redis needed). State is
// hoisted onto globalThis so it survives Next.js dev HMR module reloads.
//
// Not a security boundary on its own — it throttles abuse/runaway clients on
// the externally-reachable surfaces (/api/mcp via MCP_TOKEN, /api/chat) so a
// leaked token or a buggy agent can't hammer the box or burn the LLM budget.

type Store = Map<string, number[]>; // key → sorted hit timestamps (ms)
const g = globalThis as unknown as { __astroRateStore?: Store; __astroRateSweep?: number };
const store: Store = g.__astroRateStore ??= new Map();

export type RateResult = { ok: boolean; remaining: number; retryAfterSec: number };

/**
 * Allow up to `limit` events per `windowMs` for `key`. Records the event when
 * allowed. Returns retryAfterSec (seconds until the oldest hit ages out) when
 * blocked.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now();
  const cutoff = now - windowMs;
  const hits = (store.get(key) ?? []).filter(t => t > cutoff);

  // Opportunistic sweep of stale keys so the map can't grow unbounded across
  // many distinct actors (cheap; at most once a minute).
  if (!g.__astroRateSweep || now - g.__astroRateSweep > 60_000) {
    g.__astroRateSweep = now;
    for (const [k, arr] of store) {
      const live = arr.filter(t => t > cutoff);
      if (live.length === 0) store.delete(k); else store.set(k, live);
    }
  }

  if (hits.length >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000));
    store.set(key, hits);
    return { ok: false, remaining: 0, retryAfterSec };
  }
  hits.push(now);
  store.set(key, hits);
  return { ok: true, remaining: limit - hits.length, retryAfterSec: 0 };
}
