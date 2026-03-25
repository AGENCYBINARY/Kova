import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveActionReferences } from '../src/lib/agent/reference-resolution'

test('reply proposals inherit Gmail thread and message references from connected context', () => {
  const [proposal] = resolveActionReferences({
    userInput: 'Réponds au dernier mail de Marie à propos du budget',
    proposals: [
      {
        type: 'reply_to_email',
        title: 'Reply to email',
        description: 'Reply to an existing thread.',
        parameters: {
          threadId: '',
          messageId: '',
          to: [],
          subject: '',
          body: 'Bonjour Marie,\n\nOui, c’est validé.\n',
        },
        confidenceScore: 0.78,
      },
    ],
    connectedContextMetadata: {
      connectedContextSummary: [
        {
          source: 'gmail',
          messages: [
            {
              messageId: 'msg_budget_1',
              threadId: 'thread_budget_1',
              from: 'Marie <marie@client.com>',
              fromEmail: 'marie@client.com',
              subject: 'Budget Q2',
              snippet: 'Peux-tu me confirmer le budget final ?',
              unread: true,
            },
          ],
        },
      ],
    },
  })

  assert.equal(proposal.parameters.threadId, 'thread_budget_1')
  assert.equal(proposal.parameters.messageId, 'msg_budget_1')
  assert.deepEqual(proposal.parameters.to, ['marie@client.com'])
  assert.equal(proposal.parameters.subject, 'Re: Budget Q2')
})

test('calendar update proposals inherit event ids from connected context', () => {
  const [proposal] = resolveActionReferences({
    userInput: 'Décale le point produit avec Martin à demain 15h',
    proposals: [
      {
        type: 'update_calendar_event',
        title: 'Update event',
        description: 'Move an existing event.',
        parameters: {
          eventId: 'event-id',
          startTime: '2026-03-26T14:00:00.000Z',
          endTime: '2026-03-26T14:30:00.000Z',
        },
        confidenceScore: 0.8,
      },
    ],
    connectedContextMetadata: {
      connectedContextSummary: [
        {
          source: 'calendar',
          events: [
            {
              eventId: 'evt_prod_martin',
              title: 'Point produit avec Martin',
              startTime: '2026-03-25T14:00:00.000Z',
              endTime: '2026-03-25T14:30:00.000Z',
            },
          ],
        },
      ],
    },
  })

  assert.equal(proposal.parameters.eventId, 'evt_prod_martin')
})

test('doc, drive, and notion update/delete proposals inherit ids from connected context', () => {
  const proposals = resolveActionReferences({
    userInput: 'Mets à jour le doc Board Update, supprime le fichier contrat-final.pdf et modifie la page Launch Control',
    proposals: [
      {
        type: 'update_google_doc',
        title: 'Update doc',
        description: 'Update an existing Google Doc.',
        parameters: { documentId: '', content: 'New content' },
        confidenceScore: 0.8,
      },
      {
        type: 'delete_google_drive_file',
        title: 'Delete file',
        description: 'Delete a Drive file.',
        parameters: { fileId: '' },
        confidenceScore: 0.8,
      },
      {
        type: 'update_notion_page',
        title: 'Update page',
        description: 'Update a Notion page.',
        parameters: { pageId: 'notion-page-id', content: 'Updated' },
        confidenceScore: 0.8,
      },
    ],
    connectedContextMetadata: {
      connectedContextSummary: [
        {
          source: 'google_docs',
          docs: [{ documentId: 'doc_board_update', title: 'Board Update', preview: 'Q2 launch summary' }],
        },
        {
          source: 'google_drive',
          files: [{ fileId: 'file_contract_final', name: 'contrat-final.pdf', mimeType: 'application/pdf' }],
        },
        {
          source: 'notion',
          pages: [{ pageId: 'page_launch_control', title: 'Launch Control', preview: 'Milestones and risks' }],
        },
      ],
    },
  })

  assert.equal(proposals[0].parameters.documentId, 'doc_board_update')
  assert.equal(proposals[1].parameters.fileId, 'file_contract_final')
  assert.equal(proposals[2].parameters.pageId, 'page_launch_control')
})
