import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMcpError, buildMcpSuccess, mcpRequestSchema } from '../src/lib/mcp/protocol'
import { resolveStandaloneMcpContext } from '../src/lib/mcp/standalone-auth'

test('mcp protocol helpers build stable json-rpc payloads', () => {
  const success = buildMcpSuccess(1, { ok: true })
  const error = buildMcpError(2, -32601, 'Method not found')

  assert.deepEqual(success, {
    jsonrpc: '2.0',
    id: 1,
    result: { ok: true },
  })

  assert.deepEqual(error, {
    jsonrpc: '2.0',
    id: 2,
    error: {
      code: -32601,
      message: 'Method not found',
    },
  })
})

test('mcp request schema accepts standard tool calls', () => {
  const parsed = mcpRequestSchema.parse({
    jsonrpc: '2.0',
    id: 'call-1',
    method: 'tools/call',
    params: {
      name: 'gmail.send_email',
      arguments: {
        to: ['alice@company.com'],
      },
    },
  })

  assert.equal(parsed.method, 'tools/call')
})

test('standalone mcp context resolves from headers', () => {
  const previousSecret = process.env.KOVA_STANDALONE_SHARED_SECRET
  const previousWorkspace = process.env.KOVA_STANDALONE_WORKSPACE_ID
  const previousUser = process.env.KOVA_STANDALONE_USER_ID

  process.env.KOVA_STANDALONE_SHARED_SECRET = 'secret'
  delete process.env.KOVA_STANDALONE_WORKSPACE_ID
  delete process.env.KOVA_STANDALONE_USER_ID

  const context = resolveStandaloneMcpContext({
    authorization: 'Bearer secret',
    'x-kova-workspace-id': 'ws_123',
    'x-kova-user-id': 'user_456',
  })

  assert.deepEqual(context, {
    workspaceId: 'ws_123',
    userId: 'user_456',
  })

  if (previousSecret === undefined) delete process.env.KOVA_STANDALONE_SHARED_SECRET
  else process.env.KOVA_STANDALONE_SHARED_SECRET = previousSecret
  if (previousWorkspace === undefined) delete process.env.KOVA_STANDALONE_WORKSPACE_ID
  else process.env.KOVA_STANDALONE_WORKSPACE_ID = previousWorkspace
  if (previousUser === undefined) delete process.env.KOVA_STANDALONE_USER_ID
  else process.env.KOVA_STANDALONE_USER_ID = previousUser
})

test('standalone mcp context fails closed when the shared secret is missing', () => {
  const previousSecret = process.env.KOVA_STANDALONE_SHARED_SECRET
  delete process.env.KOVA_STANDALONE_SHARED_SECRET

  assert.throws(
    () =>
      resolveStandaloneMcpContext({
        'x-kova-workspace-id': 'ws_123',
        'x-kova-user-id': 'user_456',
      }),
    /KOVA_STANDALONE_SHARED_SECRET is missing/
  )

  if (previousSecret === undefined) delete process.env.KOVA_STANDALONE_SHARED_SECRET
  else process.env.KOVA_STANDALONE_SHARED_SECRET = previousSecret
})
