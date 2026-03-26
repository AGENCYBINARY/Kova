import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCalendarRedoFollowUp } from '../src/lib/agent/follow-up'

test('calendar redo follow-up rebuilds the previous event with a new title', () => {
  const result = buildCalendarRedoFollowUp({
    input: "Tu peux le refaire en disant que c'est une raclette chez Maxime ?",
    recentActions: [
      {
        type: 'create_calendar_event',
        title: 'Create meeting invite for Maxime',
        description: 'Create a Google Calendar invite.',
        parameters: {
          title: 'Rendez-vous avec Maxime',
          startTime: '2026-03-27T14:00:00.000Z',
          endTime: '2026-03-27T14:30:00.000Z',
          attendees: ['maxime@example.com'],
          createMeetLink: true,
        },
      },
    ],
    language: 'fr',
  })

  assert.ok(result)
  assert.equal(result?.proposals[0]?.type, 'create_calendar_event')
  assert.equal(result?.proposals[0]?.parameters.title, 'Raclette chez Maxime')
  assert.equal(result?.response, 'Je t’en ai préparé un autre : "Raclette chez Maxime".')
})

test('calendar redo follow-up returns null without a recent calendar action', () => {
  const result = buildCalendarRedoFollowUp({
    input: "Refais-le en disant que c'est une raclette chez Maxime",
    recentActions: [],
    language: 'fr',
  })

  assert.equal(result, null)
})
