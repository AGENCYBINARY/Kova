import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultAssistantProfile } from '../src/lib/assistant/profile'
import { inferRiskLevel, resolveExecutionDecision } from '../src/lib/agent/execution-governance'

test('auto mode with auto_low_risk approves low-risk single-recipient send_email', () => {
  const decision = resolveExecutionDecision({
    requestedMode: 'auto',
    assistantProfile: {
      ...defaultAssistantProfile,
      executionPolicy: 'auto_low_risk',
      confidenceThreshold: 0.8,
    },
    proposals: [
      {
        type: 'send_email',
        confidenceScore: 0.95,
        parameters: {
          to: ['alice@company.com'],
          subject: 'Hello',
          body: 'Short note',
        },
      },
    ],
  })

  assert.equal(decision.effectiveMode, 'auto')
  assert.equal(decision.reason, 'auto_approved')
})

test('always_ask profile forces review even when chat toggle is auto', () => {
  const decision = resolveExecutionDecision({
    requestedMode: 'auto',
    assistantProfile: {
      ...defaultAssistantProfile,
      executionPolicy: 'always_ask',
    },
    proposals: [
      {
        type: 'send_email',
        confidenceScore: 0.95,
        parameters: {
          to: ['alice@company.com'],
          subject: 'Hello',
          body: 'Short note',
        },
      },
    ],
  })

  assert.equal(decision.effectiveMode, 'ask')
  assert.equal(decision.reason, 'profile_requires_review')
})

test('direct API execution cannot bypass manual review when policy blocks medium-risk actions', () => {
  const decision = resolveExecutionDecision({
    requestedMode: 'auto',
    assistantProfile: {
      ...defaultAssistantProfile,
      executionPolicy: 'auto_low_risk',
      confidenceThreshold: 0.8,
    },
    proposals: [
      {
        type: 'send_email',
        confidenceScore: 0.95,
        parameters: {
          to: ['alice@company.com', 'bob@company.com'],
          subject: 'Launch recap',
          body: 'Ready to send',
        },
      },
    ],
  })

  assert.equal(decision.effectiveMode, 'ask')
  assert.equal(decision.reason, 'medium_risk_requires_review')
})

test('destructive actions stay high risk', () => {
  assert.equal(
    inferRiskLevel('delete_calendar_event', {
      eventId: 'evt_123',
    }),
    'high'
  )

  assert.equal(
    inferRiskLevel('delete_google_drive_file', {
      fileId: 'file_123',
    }),
    'high'
  )

  assert.equal(
    inferRiskLevel('share_google_drive_file', {
      fileId: 'file_123',
      emails: ['ops@company.com'],
    }),
    'high'
  )

  assert.equal(
    inferRiskLevel('archive_notion_page', {
      pageId: 'notion_123',
    }),
    'high'
  )
})
