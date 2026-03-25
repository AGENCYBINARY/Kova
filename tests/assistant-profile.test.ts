import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultAssistantProfile,
  executiveAssistantSkillIds,
  resolveEnabledAssistantSkills,
} from '../src/lib/assistant/profile'

test('default assistant profile enables the full executive skill set', () => {
  assert.deepEqual(defaultAssistantProfile.enabledSkills, executiveAssistantSkillIds)
})

test('empty or invalid skill selections fall back to the full assistant skill set', () => {
  assert.deepEqual(resolveEnabledAssistantSkills([]), executiveAssistantSkillIds)
  assert.deepEqual(resolveEnabledAssistantSkills(['unknown-skill']), executiveAssistantSkillIds)
})

test('assistant skill selection keeps only valid skills when at least one is present', () => {
  assert.deepEqual(
    resolveEnabledAssistantSkills(['gmail_thread_responder', 'unknown-skill', 'calendar_rescheduler']),
    ['gmail_thread_responder', 'calendar_rescheduler']
  )
})
