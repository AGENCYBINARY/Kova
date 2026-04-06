import assert from 'node:assert/strict'
import test from 'node:test'
import { isEmailCompositionAssistanceRequest } from '../src/lib/agent/v1-deterministic'

test('detects French meta-request to help formulate an email', () => {
  assert.equal(
    isEmailCompositionAssistanceRequest(
      "Je veux que tu m'aide a formuler un mail a envoyer un collegue pour un meeting"
    ),
    true
  )
})

test('detects help me write email (English)', () => {
  assert.equal(isEmailCompositionAssistanceRequest('Can you help me write an email to my manager?'), true)
})

test('literal send request is not composition assistance', () => {
  assert.equal(
    isEmailCompositionAssistanceRequest('Envoie un mail à alice@corp.com pour confirmer le RDV de demain 15h'),
    false
  )
})

test('named recipient plus send intent is not meta composition (agent should plan actions)', () => {
  assert.equal(
    isEmailCompositionAssistanceRequest(
      'je veux que tu me redige un mail a tristan massarelli et que tu lui envoie le mail avec une invite google meet'
    ),
    false
  )
})

test('detects j aimerais bien que tu m aide a rediger un mail', () => {
  assert.equal(
    isEmailCompositionAssistanceRequest("j'aimerai bien que tu m'aide a rediger un mail a un collègue"),
    true
  )
})
