import assert from 'node:assert/strict'
import test from 'node:test'
import { injectExecutionOutputsIntoParameters } from '@/lib/actions/parameter-resolution'

test('injectExecutionOutputsIntoParameters replaces meet_link from calendar output', () => {
  const resolved = injectExecutionOutputsIntoParameters(
    { body: 'Join: {{meet_link}}' },
    [
      {
        provider: 'google_calendar',
        eventId: 'evt1',
        meetLink: 'https://meet.google.com/abc-defg-hij',
        meet_link: 'https://meet.google.com/abc-defg-hij',
      },
    ]
  )
  assert.equal(resolved.body, 'Join: https://meet.google.com/abc-defg-hij')
})

test('injectExecutionOutputsIntoParameters substitutes a bilingual fallback when Meet is still missing', () => {
  const resolved = injectExecutionOutputsIntoParameters(
    { body: 'Lien: {{meet_link}}' },
    [{ provider: 'google_calendar', eventId: 'evt1', meetLink: null, meet_link: null }]
  )
  assert.match(String(resolved.body), /Google Meet|calendar invite/i)
  assert.doesNotMatch(String(resolved.body), /\{\{\s*meet_?link\s*\}\}/i)
})
