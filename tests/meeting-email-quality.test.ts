import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMeetingEmailFollowupProposal } from '../src/lib/agent/v1-deterministic'

test('meeting email follow-up for a reschedule stays aligned with the request', () => {
  const proposal = buildMeetingEmailFollowupProposal(
    "est-ce que tu peux me rédiger un mail s'il te plaît pour envoyer à Maxime neveu et lui dire que j'ai un rendez-vous jeudi donc on va être obligé d'annuler notre réunion pour la reporter à vendredi si tu peux également lui mettre un événement calendrier et dans le mail et dans l'événement calendrier lui mettre une réunion Google meet",
    {
      name: 'Maxime Neveu',
      email: 'maxime.neveu@example.com',
      aliases: ['Maxime', 'Neveu'],
    },
    {
      assistantName: 'Kova',
      roleDescription: 'EA',
      defaultLanguage: 'fr',
      writingTone: 'warm',
      writingDirectness: 'direct',
      signatureName: 'AGENCY BINARY',
      signatureBlock: 'AGENCY BINARY',
      executionPolicy: 'ask',
      confidenceThreshold: 0.7,
      autoResolveKnownContacts: true,
      executiveMode: true,
    }
  )

  assert.equal(proposal.parameters.to?.[0], 'maxime.neveu@example.com')
  assert.match(String(proposal.parameters.subject), /Report/)
  assert.match(String(proposal.parameters.body), /jeudi/i)
  assert.match(String(proposal.parameters.body), /vendredi/i)
  assert.match(String(proposal.parameters.body), /Google Meet/i)
  assert.doesNotMatch(String(proposal.parameters.body), /dimanche|Sunday/i)
})
