import assert from 'node:assert/strict'
import test from 'node:test'
import { extractConnectedContextSeed } from '@/lib/agent/chat-state'

test('extractConnectedContextSeed relies on assistant metadata, not raw message text fragments', () => {
  assert.equal(
    extractConnectedContextSeed([
      {
        role: 'assistant',
        content: 'calendar: 0 evenements, 0 creneaux libres',
        metadata: null,
      },
    ]),
    null
  )
})

test('extractConnectedContextSeed keeps explicit connected-context metadata', () => {
  assert.deepEqual(
    extractConnectedContextSeed([
      {
        role: 'assistant',
        content: 'Voici ton agenda.',
        metadata: {
          connectedContextSources: ['calendar'],
          connectedContextTimeframe: 'today',
          connectedContextAvailabilityMode: true,
        },
      },
    ]),
    {
      sources: ['calendar'],
      timeframe: 'today',
      asksForAvailability: true,
      asksForPriorities: false,
    }
  )
})
