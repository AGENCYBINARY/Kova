import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractEmailAddresses,
  extractGmailLookupNameQuery,
  extractNameNearEmail,
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
  assert.equal(extractGmailLookupNameQuery('trouve toi le mail de tristan massarelli regarde mes mails envoyes'), 'Tristan Massarelli')
  assert.equal(extractGmailLookupNameQuery('cherche le mail de Marie Dupont sur gmail'), 'Marie Dupont')
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
