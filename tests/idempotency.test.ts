import assert from 'node:assert/strict'
import test from 'node:test'
import { executeIdempotentJsonRequest, clearIdempotencyStore } from '../src/lib/http/idempotency'

test('idempotent requests replay the cached response for the same key and fingerprint', async () => {
  clearIdempotencyStore()

  let executions = 0
  const request = new Request('https://kova.app/api/chat', {
    method: 'POST',
    headers: {
      'Idempotency-Key': 'chat-1',
    },
  })

  const first = await executeIdempotentJsonRequest({
    request,
    namespace: 'chat',
    userId: 'user_1',
    fingerprint: JSON.stringify({ content: 'hello' }),
    execute: async () => {
      executions += 1
      return {
        body: { ok: true, execution: executions },
      }
    },
  })

  const second = await executeIdempotentJsonRequest({
    request,
    namespace: 'chat',
    userId: 'user_1',
    fingerprint: JSON.stringify({ content: 'hello' }),
    execute: async () => {
      executions += 1
      return {
        body: { ok: true, execution: executions },
      }
    },
  })

  assert.equal(executions, 1)
  assert.equal(first.status, 200)
  assert.equal(second.headers.get('X-Idempotent-Replay'), 'true')
  assert.deepEqual(await second.json(), { ok: true, execution: 1 })
})

test('idempotent requests reject key reuse with a different fingerprint', async () => {
  clearIdempotencyStore()

  const request = new Request('https://kova.app/api/agent/execute', {
    method: 'POST',
    headers: {
      'Idempotency-Key': 'agent-1',
    },
  })

  await executeIdempotentJsonRequest({
    request,
    namespace: 'agent-execute',
    userId: 'user_1',
    fingerprint: JSON.stringify({ actionType: 'send_email' }),
    execute: async () => ({
      body: { ok: true },
    }),
  })

  const conflict = await executeIdempotentJsonRequest({
    request,
    namespace: 'agent-execute',
    userId: 'user_1',
    fingerprint: JSON.stringify({ actionType: 'create_calendar_event' }),
    execute: async () => ({
      body: { ok: true },
    }),
  })

  assert.equal(conflict.status, 409)
  assert.deepEqual(await conflict.json(), {
    error: 'Idempotency-Key already used with a different request.',
  })
})

test('idempotency does not cache non-success responses', async () => {
  clearIdempotencyStore()

  let executions = 0
  const request = new Request('https://kova.app/api/chat', {
    method: 'POST',
    headers: {
      'Idempotency-Key': 'chat-rate-limit',
    },
  })

  const first = await executeIdempotentJsonRequest({
    request,
    namespace: 'chat',
    userId: 'user_1',
    fingerprint: JSON.stringify({ content: 'hello again' }),
    execute: async () => {
      executions += 1
      return {
        body: { error: 'rate_limit_exceeded' },
        status: 429,
      }
    },
  })

  const second = await executeIdempotentJsonRequest({
    request,
    namespace: 'chat',
    userId: 'user_1',
    fingerprint: JSON.stringify({ content: 'hello again' }),
    execute: async () => {
      executions += 1
      return {
        body: { ok: true },
        status: 200,
      }
    },
  })

  assert.equal(first.status, 429)
  assert.equal(second.status, 200)
  assert.equal(executions, 2)
  assert.equal(second.headers.get('X-Idempotent-Replay'), null)
})
