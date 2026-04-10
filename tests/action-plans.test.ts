import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveActionPlanStatus, deriveActionPlanStepStatus, planUsesWorkflowControls } from '@/lib/actions/action-plans'

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

test('deriveActionPlanStatus surfaces waiting workflows', () => {
  assert.equal(deriveActionPlanStatus(['completed', 'waiting']), 'waiting')
  assert.equal(deriveActionPlanStepStatus(['waiting']), 'waiting')
})

test('deriveActionPlanStatus treats deferred Gmail sends like waiting', () => {
  assert.equal(deriveActionPlanStatus(['completed', 'scheduled']), 'waiting')
  assert.equal(deriveActionPlanStepStatus(['scheduled']), 'waiting')
})

test('planUsesWorkflowControls detects waits, retries, and conditions', () => {
  assert.equal(planUsesWorkflowControls([{ title: 'A', detail: 'B' }]), false)
  assert.equal(planUsesWorkflowControls([{ title: 'A', detail: 'B', waitUntil: '2026-04-07T10:00:00.000Z' }]), true)
  assert.equal(planUsesWorkflowControls([{ title: 'A', detail: 'B', retryLimit: 3 }]), true)
  assert.equal(
    planUsesWorkflowControls([{ title: 'A', detail: 'B', condition: { type: 'if_previous_output_exists', key: 'meetLink' } }]),
    true
  )
})
