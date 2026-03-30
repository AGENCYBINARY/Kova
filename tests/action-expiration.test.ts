import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getPendingActionExpiryCutoff,
  isPendingActionExpired,
} from '../src/lib/actions/pending-expiration'

test('pending action expiry cutoff uses the configured trailing approval window', () => {
  const now = new Date('2026-03-30T12:00:00.000Z')
  const cutoff = getPendingActionExpiryCutoff(now)

  assert.equal(cutoff.toISOString(), '2026-03-27T12:00:00.000Z')
})

test('pending action expiry can be evaluated against an explicit timeout window', () => {
  const now = new Date('2026-03-30T12:00:00.000Z')

  assert.equal(isPendingActionExpired(new Date('2026-03-27T11:59:59.000Z'), now, 72 * 60 * 60), true)
  assert.equal(isPendingActionExpired(new Date('2026-03-29T12:00:01.000Z'), now, 72 * 60 * 60), false)
})
