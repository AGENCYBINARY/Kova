import assert from 'node:assert/strict'
import test from 'node:test'
import { sortBatchActionsForExecution } from '@/lib/actions/batch-order'

test('sortBatchActionsForExecution moves calendar before meet-placeholder email when indices are wrong', () => {
  const ordered = sortBatchActionsForExecution([
    {
      type: 'send_email',
      parameters: { proposalIndex: 0, body: 'Hi\n{{meet_link}}', to: ['a@b.com'] },
    },
    {
      type: 'create_calendar_event',
      parameters: { proposalIndex: 1, title: 'Call' },
    },
  ])
  assert.deepEqual(
    ordered.map((a) => a.type),
    ['create_calendar_event', 'send_email']
  )
})

test('sortBatchActionsForExecution keeps calendar-first order when proposalIndex is already sorted', () => {
  const ordered = sortBatchActionsForExecution([
    { type: 'send_email', parameters: { proposalIndex: 1, body: 'Hi', to: ['a@b.com'] } },
    { type: 'create_calendar_event', parameters: { proposalIndex: 0, title: 'Call' } },
  ])
  assert.deepEqual(
    ordered.map((a) => a.type),
    ['create_calendar_event', 'send_email']
  )
})
