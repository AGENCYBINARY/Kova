import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveActionReferences, resolveActionReferencesDetailed } from '../src/lib/agent/reference-resolution'

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

test('forward, drive move/share, and notion database parent inherit ids from connected context', () => {
  const proposals = resolveActionReferences({
    userInput: 'Transfère le dernier mail de Marie, déplace le contrat final, partage-le avec finance et crée une page dans Sales CRM',
    proposals: [
      {
        type: 'forward_email',
        title: 'Forward email',
        description: 'Forward an email.',
        parameters: { messageId: 'message-id', to: ['finance@client.com'], note: 'FYI' },
        confidenceScore: 0.8,
      },
      {
        type: 'move_google_drive_file',
        title: 'Move file',
        description: 'Move a Drive file.',
        parameters: { fileId: 'file-id', destinationFolderName: 'Archive' },
        confidenceScore: 0.8,
      },
      {
        type: 'share_google_drive_file',
        title: 'Share file',
        description: 'Share a Drive file.',
        parameters: { fileId: '', emails: ['finance@client.com'], role: 'reader' },
        confidenceScore: 0.8,
      },
      {
        type: 'create_notion_page',
        title: 'Create page',
        description: 'Create a Notion page.',
        parameters: { title: 'Follow-up', content: 'Ready', parentDatabaseId: 'database-id' },
        confidenceScore: 0.8,
      },
    ],
    connectedContextMetadata: {
      connectedContextSummary: [
        {
          source: 'gmail',
          messages: [
            {
              messageId: 'msg_marie_latest',
              threadId: 'thread_marie',
              from: 'Marie <marie@client.com>',
              fromEmail: 'marie@client.com',
              subject: 'Contrat final',
              snippet: 'Voici la dernière version du contrat',
              unread: true,
            },
          ],
        },
        {
          source: 'google_drive',
          files: [{ fileId: 'file_contract_final', name: 'contrat-final.pdf', mimeType: 'application/pdf' }],
        },
        {
          source: 'notion',
          databases: [{ databaseId: 'db_sales_crm', title: 'Sales CRM', url: 'https://notion.so/db-sales-crm' }],
        },
      ],
    },
  })

  assert.equal(proposals[0].parameters.messageId, 'msg_marie_latest')
  assert.equal(proposals[1].parameters.fileId, 'file_contract_final')
  assert.equal(proposals[2].parameters.fileId, 'file_contract_final')
  assert.equal(proposals[3].parameters.parentDatabaseId, 'db_sales_crm')
})

test('drive folder creation proposals inherit parent folder ids from connected context', () => {
  const [proposal] = resolveActionReferences({
    userInput: 'Crée un dossier dans Board Ops',
    proposals: [
      {
        type: 'create_google_drive_folder',
        title: 'Create folder',
        description: 'Create a Drive folder.',
        parameters: { name: 'Kova Ops', folderName: 'Board Ops', parentFolderId: 'drive-folder-id' },
        confidenceScore: 0.8,
      },
    ],
    connectedContextMetadata: {
      connectedContextSummary: [
        {
          source: 'google_drive',
          files: [
            {
              fileId: 'folder_board_ops',
              name: 'Board Ops',
              mimeType: 'application/vnd.google-apps.folder',
            },
          ],
        },
      ],
    },
  })

  assert.equal(proposal.parameters.parentFolderId, 'folder_board_ops')
})

test('ambiguous drive parent folders return an explicit disambiguation shortlist', () => {
  const result = resolveActionReferencesDetailed({
    userInput: 'Crée un dossier dans Archive',
    proposals: [
      {
        type: 'create_google_drive_folder',
        title: 'Create folder',
        description: 'Create a Drive folder.',
        parameters: { name: 'Kova Ops', folderName: 'Archive', parentFolderId: 'drive-folder-id' },
        confidenceScore: 0.8,
      },
    ],
    connectedContextMetadata: {
      connectedContextSummary: [
        {
          source: 'google_drive',
          files: [
            {
              fileId: 'folder_archive_ops',
              name: 'Archive',
              mimeType: 'application/vnd.google-apps.folder',
              modifiedTime: '2026-03-26T09:00:00.000Z',
            },
            {
              fileId: 'folder_archive_finance',
              name: 'Archive',
              mimeType: 'application/vnd.google-apps.folder',
              modifiedTime: '2026-03-25T09:00:00.000Z',
            },
          ],
        },
      ],
    },
  })

  assert.equal(result.proposals[0].parameters.parentFolderId, 'drive-folder-id')
  assert.equal(result.disambiguations.length, 1)
  assert.equal(result.disambiguations[0]?.source, 'google_drive')
  assert.equal(result.disambiguations[0]?.field, 'parentFolderId')
  assert.equal(result.disambiguations[0]?.options.length, 2)
})

test('ambiguous gmail matches return an explicit disambiguation shortlist', () => {
  const result = resolveActionReferencesDetailed({
    userInput: 'Archive le mail de Martin',
    proposals: [
      {
        type: 'archive_gmail_thread',
        title: 'Archive',
        description: 'Archive a thread.',
        parameters: { threadId: 'thread-id' },
        confidenceScore: 0.8,
      },
    ],
    connectedContextMetadata: {
      connectedContextSummary: [
        {
          source: 'gmail',
          messages: [
            {
              messageId: 'msg_martin_ops',
              threadId: 'thread_martin_ops',
              from: 'Martin Ops <martin@ops.com>',
              fromEmail: 'martin@ops.com',
              subject: 'Launch plan',
              snippet: 'Plan de lancement',
              unread: true,
            },
            {
              messageId: 'msg_martin_sales',
              threadId: 'thread_martin_sales',
              from: 'Martin Sales <martin@sales.com>',
              fromEmail: 'martin@sales.com',
              subject: 'Sales review',
              snippet: 'Revue commerciale',
              unread: false,
            },
          ],
        },
      ],
    },
  })

  assert.equal(result.proposals[0].parameters.threadId, 'thread-id')
  assert.equal(result.disambiguations.length, 1)
  assert.equal(result.disambiguations[0]?.source, 'gmail')
  assert.equal(result.disambiguations[0]?.options.length, 2)
})

test('explicit shortlist selections resolve the chosen candidate deterministically', () => {
  const result = resolveActionReferencesDetailed({
    userInput: 'Utilise "Martin Sales | Sales review".\n[[kova-ref:gmail:threadId:thread_martin_sales]]',
    proposals: [
      {
        type: 'archive_gmail_thread',
        title: 'Archive',
        description: 'Archive a thread.',
        parameters: { threadId: 'thread-id' },
        confidenceScore: 0.8,
      },
    ],
    connectedContextMetadata: {
      connectedContextSummary: [
        {
          source: 'gmail',
          messages: [
            {
              messageId: 'msg_martin_ops',
              threadId: 'thread_martin_ops',
              from: 'Martin Ops <martin@ops.com>',
              fromEmail: 'martin@ops.com',
              subject: 'Launch plan',
              snippet: 'Plan de lancement',
              unread: true,
            },
            {
              messageId: 'msg_martin_sales',
              threadId: 'thread_martin_sales',
              from: 'Martin Sales <martin@sales.com>',
              fromEmail: 'martin@sales.com',
              subject: 'Sales review',
              snippet: 'Revue commerciale',
              unread: false,
            },
          ],
        },
      ],
    },
  })

  assert.equal(result.proposals[0].parameters.threadId, 'thread_martin_sales')
  assert.equal(result.disambiguations.length, 0)
})
