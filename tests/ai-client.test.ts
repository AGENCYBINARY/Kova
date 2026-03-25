import assert from 'node:assert/strict'
import test from 'node:test'
import { isLowValueAssistantResponse, parseStructuredAnalysisResponse } from '../src/lib/ai/client'

test('generic capability replies are detected as low-value responses', () => {
  assert.equal(
    isLowValueAssistantResponse(
      'Je peux transformer cela en action pour Gmail, Google Calendar, Google Drive, Notion ou Google Docs.'
    ),
    true
  )

  assert.equal(
    isLowValueAssistantResponse(
      'Bonjour. Tu peux me parler normalement, me poser une question, ou me demander d’agir via Gmail.'
    ),
    true
  )
})

test('direct factual replies are not detected as low-value responses', () => {
  assert.equal(
    isLowValueAssistantResponse(
      "Tu as reçu 2 mails aujourd'hui. Le plus récent vient d'Alice au sujet du contrat Q2."
    ),
    false
  )
})

test('structured response parser decodes parameters_json payloads', () => {
  const parsed = parseStructuredAnalysisResponse({
    response: 'C’est prêt.',
    proposals: [
      {
        type: 'send_email',
        title: 'Send email',
        description: 'Draft the email.',
        confidenceScore: 0.92,
        parameters_json: '{"to":["alice@example.com"],"subject":"Point décale","body":"Bonjour Alice"}',
      },
    ],
  })

  assert.equal(parsed.response, 'C’est prêt.')
  assert.deepEqual(parsed.proposals[0]?.parameters, {
    to: ['alice@example.com'],
    subject: 'Point décale',
    body: 'Bonjour Alice',
  })
})
