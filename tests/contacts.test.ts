import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractEmailAddresses,
  extractNameNearEmail,
  extractRecipientName,
  findContactByName,
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
  assert.equal(extractRecipientName('Envoie un mail à Marie Dupont pour le point de demain'), 'Marie Dupont')
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
