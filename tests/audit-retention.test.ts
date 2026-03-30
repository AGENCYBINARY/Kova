import assert from 'node:assert/strict'
import test from 'node:test'
import { getExecutionLogRetentionCutoff } from '../src/lib/audit/retention'

test('execution log retention cutoff defaults to a 90 day lookback', () => {
  const now = new Date('2026-03-30T12:00:00.000Z')
  const cutoff = getExecutionLogRetentionCutoff(now)

  assert.equal(cutoff.toISOString(), '2025-12-30T12:00:00.000Z')
})
