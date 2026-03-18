/**
 * Simple in-memory rate limiter.
 * For production at scale, replace with a Redis-backed solution (e.g. Upstash).
 */

interface RateLimitEntry {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()

// Purge expired entries every 5 minutes to avoid memory leaks
setInterval(
  () => {
    const now = Date.now()
    for (const [key, entry] of Array.from(store.entries())) {
      if (entry.resetAt < now) {
        store.delete(key)
      }
    }
  },
  5 * 60 * 1000
)

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now()
  const entry = store.get(key)

  if (!entry || entry.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs }
  }

  if (entry.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt }
  }

  entry.count++
  return { allowed: true, remaining: limit - entry.count, resetAt: entry.resetAt }
}
