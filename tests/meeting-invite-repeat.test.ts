import assert from 'node:assert/strict'
import test from 'node:test'
import {
  augmentContentForMeetingInviteRepeat,
  augmentContentForMeetingScheduleFollowUp,
  composeBundledMeetingRequestFromPrior,
  looksLikeRepeatMeetingInviteBundle,
  looksLikeSchedulingSlotReplyOnly,
} from '@/lib/agent/meeting-invite-repeat'

const priorFr =
  'Ecrit moi un mail a Tristan Massarelli trouve son mail dans gmail et redige un mail en lui disant que il y\'a reunion mardi a 19h pour les objectif de notre agence'

test('looksLikeRepeatMeetingInviteBundle detects short continuation lines', () => {
  assert.equal(
    looksLikeRepeatMeetingInviteBundle('maintenant une invitation exactement pareil a Maxime NEVEU stp'),
    true
  )
  assert.equal(looksLikeRepeatMeetingInviteBundle('bonjour ca va'), false)
})

test('augmentContentForMeetingInviteRepeat expands using the prior user turn', () => {
  const expanded = augmentContentForMeetingInviteRepeat({
    content: 'maintenant une invitation exactement pareil a Maxime NEVEU stp',
    previousMessages: [{ role: 'user', content: priorFr }],
    defaultLanguage: 'fr',
  })
  assert.match(expanded, /Maxime Neveu/i)
  assert.match(expanded, /mardi/i)
  assert.match(expanded, /19h/i)
  assert.match(expanded, /objectif/i)
  assert.doesNotMatch(expanded, /Dis-moi ce qu'il faut faire/i)
})

test('composeBundledMeetingRequestFromPrior keeps schedule hints from the reference message', () => {
  const out = composeBundledMeetingRequestFromPrior(priorFr, 'Claire Durand', 'fr')
  assert.match(out, /Claire Durand/)
  assert.match(out, /mardi/i)
  assert.match(out, /Prépare une invitation Google Calendar/i)
  assert.doesNotMatch(out, /Écris-moi un mail/i)
})

const inviteHelpFr =
  "Tu peux stp m'aider a rediger un mail d'invitation pour un meeting a un collègue et apres on lui envoie"

test('looksLikeSchedulingSlotReplyOnly detects short schedule answers', () => {
  assert.equal(looksLikeSchedulingSlotReplyOnly('oui mardi à 19h pendant 1h'), true)
  assert.equal(looksLikeSchedulingSlotReplyOnly('envoie un mail à bob demain 10h'), false)
})

test('augmentContentForMeetingScheduleFollowUp merges prior invite request after assistant asked for time', () => {
  const assistantFr = "Oui. Je peux le préparer. Il me manque juste la date et l'heure exacte."
  const expanded = augmentContentForMeetingScheduleFollowUp({
    content: 'oui mardi à 19h pendant 1h',
    previousMessages: [
      { role: 'user', content: inviteHelpFr },
      { role: 'assistant', content: assistantFr },
    ],
  })
  assert.match(expanded, /mail d'invitation/i)
  assert.match(expanded, /meeting/i)
  assert.match(expanded, /mardi/i)
  assert.match(expanded, /19h/i)
  assert.doesNotMatch(expanded, /Dis-moi ce qu'il faut faire/i)
})
