import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSendEmailScheduledExecution } from '@/lib/actions/execute-persisted-batch'

test('resolveSendEmailScheduledExecution defers future ISO datetimes', () => {
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  const r = resolveSendEmailScheduledExecution({ to: ['a@b.co'], subject: 'x', body: 'y', scheduledSendAt: future })
  assert.equal(r.defer, true)
  if (r.defer) {
    assert.ok(r.when.getTime() > Date.now())
  }
})

test('resolveSendEmailScheduledExecution ignores past or invalid schedule', () => {
  const past = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  assert.equal(resolveSendEmailScheduledExecution({ scheduledSendAt: past }).defer, false)
  assert.equal(resolveSendEmailScheduledExecution({ scheduledSendAt: 'not-a-date' }).defer, false)
  assert.equal(resolveSendEmailScheduledExecution({}).defer, false)
})
