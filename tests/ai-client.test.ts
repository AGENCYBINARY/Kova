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
    plan: [
      {
        title: 'Préparer le mail',
        detail: 'Je rédige le message avant envoi.',
        app: 'Gmail',
      },
    ],
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
  assert.deepEqual(parsed.plan, [
    {
      title: 'Préparer le mail',
      detail: 'Je rédige le message avant envoi.',
      app: 'Gmail',
    },
  ])
  assert.deepEqual(parsed.proposals[0]?.parameters, {
    to: ['alice@example.com'],
    subject: 'Point décale',
    body: 'Bonjour Alice',
  })
})

test('structured response parser accepts strict-schema null plan fields and normalizes them away', () => {
  const parsed = parseStructuredAnalysisResponse({
    response: 'Je te l’ai préparé en deux temps.',
    plan: [
      {
        title: 'Préparer le mail',
        detail: 'Je rédige le message avant envoi.',
        app: 'Gmail',
        kind: null,
        waitUntil: null,
        retryLimit: null,
        retryBackoffSeconds: null,
        conditionType: 'always',
        conditionKey: null,
      },
    ],
    proposals: [
      {
        type: 'create_gmail_draft',
        title: 'Create Gmail draft',
        description: 'Prepare the draft.',
        confidenceScore: 0.9,
        parameters_json: '{"to":["alice@example.com"],"subject":"Sujet","body":"Bonjour Alice"}',
      },
    ],
  })

  assert.deepEqual(parsed.plan, [
    {
      title: 'Préparer le mail',
      detail: 'Je rédige le message avant envoi.',
      app: 'Gmail',
    },
  ])
})
