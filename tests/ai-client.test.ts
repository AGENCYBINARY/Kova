import assert from 'node:assert/strict'
import test from 'node:test'
import { isLowValueAssistantResponse } from '../src/lib/ai/client'

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
