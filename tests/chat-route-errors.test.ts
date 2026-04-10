import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { getChatRouteErrorPayload } from '@/lib/http/chat-route-errors'

describe('getChatRouteErrorPayload', () => {
  it('maps missing OpenAI key to 503 and bilingual messages', () => {
    const { status, body } = getChatRouteErrorPayload(new Error('OPENAI_API_KEY (or OPENAI_KEY) is missing.'))
    assert.equal(status, 503)
    assert.equal(body.error, 'ai_not_configured')
    assert.ok(body.messageFr.includes('clé'))
    assert.ok(body.messageEn.toLowerCase().includes('openai'))
  })

  it('maps timeout-ish errors to 504', () => {
    const { status, body } = getChatRouteErrorPayload(new Error('fetch failed: ETIMEDOUT'))
    assert.equal(status, 504)
    assert.equal(body.error, 'ai_timeout')
  })

  it('maps OpenAI HTTP failures to provider bucket', () => {
    const { status, body } = getChatRouteErrorPayload(new Error('OpenAI Responses request failed: 502'))
    assert.equal(status, 503)
    assert.equal(body.error, 'ai_provider_error')
  })
})
