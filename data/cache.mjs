// Generic TTL cache. Two independent instances are used by the providers
// (see data/providers/index.mjs) with different TTLs: quotes change by the
// minute, fundamentals are a once-a-day scrape, so they shouldn't share a
// staleness budget.
export class TtlCache {
  constructor(ttlMs) {
    this.ttlMs = ttlMs;
    this.store = new Map();
  }
  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.saved > this.ttlMs) { this.store.delete(key); return undefined; }
    return entry.value;
  }
  set(key, value) {
    this.store.set(key, { saved: Date.now(), value });
  }
}

// Wraps an async fn(key) with cache-or-fetch semantics, including in-flight
// de-duplication so concurrent requests for the same key don't trigger
// redundant fetches.
export function memoize(cache, fn) {
  const inFlight = new Map();
  return async (key) => {
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    if (inFlight.has(key)) return inFlight.get(key);
    const promise = fn(key).then(value => { cache.set(key, value); inFlight.delete(key); return value; },
      error => { inFlight.delete(key); throw error; });
    inFlight.set(key, promise);
    return promise;
  };
}
