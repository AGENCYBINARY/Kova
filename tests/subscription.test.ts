import assert from 'node:assert/strict'
import test from 'node:test'
import { getMonthlyResetAnchor, needsMonthlyReset } from '../src/lib/subscription'

test('monthly reset anchor is pinned to the first day of the current UTC month', () => {
  const anchor = getMonthlyResetAnchor(new Date('2026-03-30T14:42:00.000Z'))
  assert.equal(anchor.toISOString(), '2026-03-01T00:00:00.000Z')
})

test('needsMonthlyReset only resets when the stored anchor is before the current month window', () => {
  assert.equal(
    needsMonthlyReset(
      new Date('2026-02-01T00:00:00.000Z'),
      new Date('2026-03-01T09:30:00.000Z')
    ),
    true
  )

  assert.equal(
    needsMonthlyReset(
      new Date('2026-03-01T00:00:00.000Z'),
      new Date('2026-03-30T09:30:00.000Z')
    ),
    false
  )
})
