import test from 'node:test'
import assert from 'node:assert/strict'
import { inputHasDemainWeekdayConflict } from '@/lib/agent/demain-weekday-conflict'

/** 2026-04-05 is a Sunday in Europe/Paris; the next calendar day is Monday. */
const sunday20260405Paris = new Date('2026-04-05T14:00:00.000Z')

test('demain + weekday that is not tomorrow (Paris) is a conflict', () => {
  assert.equal(inputHasDemainWeekdayConflict('demain vendredi à 11h', sunday20260405Paris), true)
})

test('demain + weekday matching tomorrow (Paris) is not a conflict', () => {
  assert.equal(inputHasDemainWeekdayConflict('demain lundi à 11h', sunday20260405Paris), false)
})

test('weekday without demain does not trigger conflict', () => {
  assert.equal(inputHasDemainWeekdayConflict('vendredi 10 avril 2026 à 11h', sunday20260405Paris), false)
})
