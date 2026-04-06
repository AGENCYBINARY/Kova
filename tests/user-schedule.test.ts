import assert from 'node:assert/strict'
import test from 'node:test'
import { inferCalendarRangeFromUserText, utcInstantForWallClock } from '@/lib/scheduling/user-schedule'

test('utcInstantForWallClock maps Paris wall time to UTC', () => {
  const t = utcInstantForWallClock(2026, 4, 7, 19, 0, 'Europe/Paris')
  assert.equal(t.toISOString(), '2026-04-07T17:00:00.000Z')
})

test('mardi 19h picks next Tuesday after a Sunday reference date', () => {
  const now = new Date('2026-04-05T10:00:00.000Z')
  const range = inferCalendarRangeFromUserText('reunion mardi a 19h', 30, { now, timeZone: 'Europe/Paris' })
  assert.ok(range)
  assert.equal(range!.start.toISOString(), '2026-04-07T17:00:00.000Z')
  assert.equal(range!.end.toISOString(), '2026-04-07T17:30:00.000Z')
})

test('demain 15h resolves to the next calendar day in Paris', () => {
  const now = new Date('2026-04-05T22:00:00.000Z')
  const range = inferCalendarRangeFromUserText('demain a 15h reunion', 60, { now, timeZone: 'Europe/Paris' })
  assert.ok(range)
  assert.ok(range!.start.getTime() > now.getTime())
})

test('time-only (19h) picks the next 19:00 Europe/Paris after the reference instant', () => {
  const now = new Date('2026-04-05T16:00:00.000Z')
  const range = inferCalendarRangeFromUserText('rdv a 19h avec le client', 45, { now, timeZone: 'Europe/Paris' })
  assert.ok(range)
  assert.equal(range!.start.toISOString(), '2026-04-05T17:00:00.000Z')
})

test('19h30 French glued form parses minutes', () => {
  const now = new Date('2026-04-05T10:00:00.000Z')
  const range = inferCalendarRangeFromUserText('point 19h30', 30, { now, timeZone: 'Europe/Paris' })
  assert.ok(range)
  assert.equal(range!.start.toISOString(), '2026-04-05T17:30:00.000Z')
})
