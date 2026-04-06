import assert from 'node:assert/strict'
import test from 'node:test'
import { findGoogleContactEmail } from '@/lib/integrations/google-gmail'

function jsonResponse(payload: unknown, init: { status?: number } = {}) {
  return {
    ok: (init.status || 200) >= 200 && (init.status || 200) < 300,
    status: init.status || 200,
    json: async () => payload,
  } as Response
}

test('findGoogleContactEmail does not return a surname-only false positive for a different first name', async () => {
  const originalFetch = global.fetch
  const fetchedMessageIds = new Set<string>()

  global.fetch = (async (url: string | URL) => {
    const href = String(url)
    if (href.includes('/messages?')) {
      return jsonResponse({
        messages: [{ id: 'msg_tristan' }],
      })
    }

    if (href.includes('/messages/msg_tristan?format=metadata')) {
      fetchedMessageIds.add('msg_tristan')
      return jsonResponse({
        payload: {
          headers: [
            { name: 'To', value: 'Tristan Massarelli <massarelli.tristan@gmail.com>' },
            { name: 'From', value: 'contact@agencybinary.fr' },
          ],
        },
      })
    }

    throw new Error(`Unexpected fetch call: ${href}`)
  }) as typeof fetch

  try {
    const email = await findGoogleContactEmail('token', 'Paula Massarelli')
    assert.equal(email, null)
    assert.equal(fetchedMessageIds.has('msg_tristan'), true)
  } finally {
    global.fetch = originalFetch
  }
})

test('findGoogleContactEmail returns the matching contact when the first name anchor is present', async () => {
  const originalFetch = global.fetch

  global.fetch = (async (url: string | URL) => {
    const href = String(url)
    if (href.includes('/messages?')) {
      return jsonResponse({
        messages: [{ id: 'msg_paula' }],
      })
    }

    if (href.includes('/messages/msg_paula?format=metadata')) {
      return jsonResponse({
        payload: {
          headers: [
            { name: 'To', value: 'Paula Massarelli <paula.massarelli@gmail.com>' },
            { name: 'From', value: 'contact@agencybinary.fr' },
          ],
        },
      })
    }

    throw new Error(`Unexpected fetch call: ${href}`)
  }) as typeof fetch

  try {
    const email = await findGoogleContactEmail('token', 'Paula Massarelli')
    assert.equal(email, 'paula.massarelli@gmail.com')
  } finally {
    global.fetch = originalFetch
  }
})
