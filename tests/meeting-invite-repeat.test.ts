import assert from 'node:assert/strict'
import test from 'node:test'
import {
  augmentContentForMeetingInviteRepeat,
  composeBundledMeetingRequestFromPrior,
  looksLikeRepeatMeetingInviteBundle,
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
})
