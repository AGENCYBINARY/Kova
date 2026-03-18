import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDashboardScopeWhere } from '../src/lib/dashboard/query'

test('dashboard queries are always scoped to the current workspace and user', () => {
  assert.deepEqual(buildDashboardScopeWhere({ workspaceId: 'ws_123', userId: 'user_456' }), {
    workspaceId: 'ws_123',
    userId: 'user_456',
  })
})
