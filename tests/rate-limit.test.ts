import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRateLimitHeaders, getRetryAfterSeconds } from '../src/lib/http/request-rate-limit'

test('getRetryAfterSeconds rounds up and never returns less than one second', () => {
  assert.equal(getRetryAfterSeconds(Date.now() + 1200, Date.now()), 2)
  assert.equal(getRetryAfterSeconds(Date.now() - 5000, Date.now()), 1)
})

test('buildRateLimitHeaders exposes retry and reset metadata', () => {
  const headers = buildRateLimitHeaders({
    remaining: 0,
    resetAt: 1_700_000_000_000,
  })

  assert.equal(headers['X-RateLimit-Remaining'], '0')
  assert.equal(headers['X-RateLimit-Reset'], '1700000000000')
  assert.ok(Number(headers['Retry-After']) >= 1)
})
