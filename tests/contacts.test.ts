import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractEmailAddresses,
  extractGmailLookupNameQuery,
  extractNameNearEmail,
  extractRecipientFromSameInviteFollowUp,
  extractRecipientName,
  findContactByName,
  findContactCandidatesByName,
  looksLikeContactCorrection,
} from '../src/lib/contacts-utils'

test('extractEmailAddresses returns normalized unique emails', () => {
  assert.deepEqual(
    extractEmailAddresses('Utilise Marie@Client.com et copie marie@client.com'),
    ['marie@client.com']
  )
})

test('looksLikeContactCorrection detects recipient correction phrasing', () => {
  assert.equal(looksLikeContactCorrection("non c'est pas le bon mail, utilise marie@client.com"), true)
  assert.equal(looksLikeContactCorrection('envoie un mail à Marie'), false)
})

test('extractNameNearEmail and extractRecipientName capture likely recipient names', () => {
  assert.equal(extractNameNearEmail('utilise Marie Dupont marie@client.com', 'marie@client.com'), 'Marie Dupont')
  assert.equal(extractNameNearEmail("non c'est pas ce mail, utilise marie@client.com", 'marie@client.com'), null)
  assert.equal(extractRecipientName('Envoie un mail à Marie Dupont pour le point de demain'), 'Marie Dupont')
  assert.equal(
    extractRecipientName(
      "Écris-moi un mail à Madame Paula Massarelli, trouve son adresse dans Gmail et prépare aussi l'invitation agenda"
    ),
    'Paula Massarelli'
  )
  assert.equal(
    extractRecipientName(
      'je veux que tu me redige un mail a tristan massarelli et que tu lui envoie le mail avec une invite google meet'
    ),
    'Tristan Massarelli'
  )
  assert.equal(
    extractRecipientName(
      'Tu peux me rediger un mail a tristan massarelli chercher son adresse mail dans gmail et lui dire reunion mardi 19h'
    ),
    'Tristan Massarelli'
  )
  assert.equal(
    extractRecipientName(
      "est-ce que tu peux me rédiger un mail s'il te plaît pour envoyer à Maxime neveu et lui dire que j'ai un rendez-vous jeudi donc on va être obligé d'annuler notre réunion pour la reporter à vendredi si tu peux également lui mettre un événement calendrier et dans le mail et dans l'événement calendrier lui mettre une réunion Google meet"
    ),
    'Maxime Neveu'
  )
  assert.equal(
    extractRecipientName(
      "Tu peux me rediger un mail pour maxime neveu s'il te plait je voudrais lui dire evenement lundi 10h palais de tokyo pour que je lui envoie"
    ),
    'Maxime Neveu'
  )
  assert.equal(extractGmailLookupNameQuery('trouve toi le mail de tristan massarelli regarde mes mails envoyes'), 'Tristan Massarelli')
  assert.equal(extractGmailLookupNameQuery('cherche le mail de Marie Dupont sur gmail'), 'Marie Dupont')
  assert.equal(extractGmailLookupNameQuery('trouve le mail de Madame Paula Massarelli dans Gmail'), 'Paula Massarelli')
})

test('extractRecipientFromSameInviteFollowUp catches pareil à / invitation pour lines', () => {
  assert.equal(
    extractRecipientFromSameInviteFollowUp('maintenant une invitation exactement pareil a Maxime NEVEU stp'),
    'Maxime Neveu'
  )
  assert.equal(
    extractRecipientFromSameInviteFollowUp('meme invitation pour Jean-Pierre Martin'),
    'Jean-pierre Martin'
  )
  assert.equal(extractRecipientFromSameInviteFollowUp('pareil pour Marie-Claire Dubois stp'), 'Marie-claire Dubois')
})

test('findContactCandidatesByName returns ranked matches', () => {
  const contacts = [
    { name: 'Tristan Massarelli', email: 'tristan@corp.com', aliases: ['Tristan'] },
    { name: 'Tristan Martin', email: 't.martin@corp.com', aliases: ['Tristan'] },
  ]
  const ranked = findContactCandidatesByName('Tristan', contacts)
  assert.equal(ranked.length, 2)
  assert.equal(ranked[0].score, ranked[1].score)
})

test('findContactByName resolves aliases and partial names', () => {
  const contact = findContactByName('Dupont', [
    {
      name: 'Marie Dupont',
      email: 'marie@client.com',
      aliases: ['Marie', 'Dupont'],
    },
  ])

  assert.equal(contact?.email, 'marie@client.com')
})
