import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyWorkflowError } from '@/lib/actions/workflow-state'

test('classifyWorkflowError marks transient provider failures as retryable', () => {
  assert.deepEqual(classifyWorkflowError('Google API request failed: 503'), {
    retryable: true,
    reconnectRequired: false,
  })
  assert.deepEqual(classifyWorkflowError('Google request timed out.'), {
    retryable: true,
    reconnectRequired: false,
  })
})

test('classifyWorkflowError marks token and scope failures as reconnect-required', () => {
  assert.deepEqual(classifyWorkflowError('Gmail returned 401: refresh token expired.'), {
    retryable: false,
    reconnectRequired: true,
  })
  assert.deepEqual(classifyWorkflowError('Request had insufficient authentication scopes.'), {
    retryable: false,
    reconnectRequired: true,
  })
})
