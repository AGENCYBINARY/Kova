import assert from 'node:assert/strict'
import test from 'node:test'
import { executeBatch } from '../src/lib/actions/batch-execution'

test('auto execution keeps completed actions completed when a later action fails', async () => {
  const statusById = new Map<string, string>()

  const result = await executeBatch({
    actions: [
      { id: 'a1', type: 'create_google_doc', title: 'Create doc', description: 'first', parameters: { title: 'Doc' } },
      { id: 'a2', type: 'send_email', title: 'Send email', description: 'second', parameters: { subject: 'Hello' } },
      { id: 'a3', type: 'create_google_drive_file', title: 'Save file', description: 'third', parameters: { name: 'Archive' } },
    ],
    resolveParameters: (parameters) => parameters,
    execute: async (action) => {
      if (action.id === 'a2') {
        throw new Error('gmail outage')
      }

      return {
        details: `${action.id} completed`,
        output: { actionId: action.id },
      }
    },
    onSuccess: async (action) => {
      statusById.set(action.id, 'completed')
    },
    onFailure: async (action) => {
      statusById.set(action.id, 'failed')
    },
    onBlocked: async (action) => {
      statusById.set(action.id, 'pending')
    },
  })

  assert.equal(result.completed.length, 1)
  assert.equal(result.completed[0]?.action.id, 'a1')
  assert.equal(result.failed?.action.id, 'a2')
  assert.deepEqual(result.blocked.map((entry) => entry.action.id), ['a3'])
  assert.equal(statusById.get('a1'), 'completed')
  assert.equal(statusById.get('a2'), 'failed')
  assert.equal(statusById.get('a3'), 'pending')
})

test('group approval preserves prior outputs for blocked follow-up actions after a partial failure', async () => {
  const result = await executeBatch<Record<string, string>, Record<string, string>>({
    actions: [
      {
        id: 'a1',
        type: 'create_google_doc',
        title: 'Create doc',
        description: 'first',
        parameters: { title: 'Doc' },
      },
      {
        id: 'a2',
        type: 'send_email',
        title: 'Send recap',
        description: 'second',
        parameters: { body: 'Doc ready at {{document_id}}' },
      },
      {
        id: 'a3',
        type: 'create_google_drive_file',
        title: 'Archive doc',
        description: 'third',
        parameters: { name: '{{document_id}}-archive' },
      },
    ],
    resolveParameters: (parameters, priorOutputs) => {
      const documentId = priorOutputs[0]?.documentId
      return Object.fromEntries(
        Object.entries(parameters).map(([key, value]) => [
          key,
          typeof value === 'string' && documentId ? value.replaceAll('{{document_id}}', documentId) : value,
        ])
      ) as Record<string, string>
    },
    execute: async (action) => {
      if (action.id === 'a1') {
        return {
          details: 'doc created',
          output: { documentId: 'doc_123', archived: '' },
        }
      }

      if (action.id === 'a2') {
        throw new Error('smtp timeout')
      }

      return {
        details: 'archived',
        output: { documentId: '', archived: 'true' },
      }
    },
  })

  assert.equal(result.completed[0]?.execution.output.documentId, 'doc_123')
  assert.equal(result.failed?.effectiveParameters.body, 'Doc ready at doc_123')
  assert.equal(result.blocked[0]?.effectiveParameters.name, 'doc_123-archive')
})
