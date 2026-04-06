import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveActionPlanStatus, deriveActionPlanStepStatus } from '@/lib/actions/action-plans'

test('deriveActionPlanStatus marks all-success batches as completed', () => {
  assert.equal(deriveActionPlanStatus(['completed', 'completed']), 'completed')
  assert.equal(deriveActionPlanStatus(['completed', 'compensated']), 'completed')
})

test('deriveActionPlanStatus keeps partial failures visible', () => {
  assert.equal(deriveActionPlanStatus(['completed', 'failed']), 'partial_failure')
  assert.equal(deriveActionPlanStatus(['failed']), 'failed')
})

test('deriveActionPlanStepStatus keeps unreveiwed steps pending until actions move', () => {
  assert.equal(deriveActionPlanStepStatus([]), 'pending')
  assert.equal(deriveActionPlanStepStatus(['pending']), 'pending_review')
  assert.equal(deriveActionPlanStepStatus(['executing']), 'executing')
})
