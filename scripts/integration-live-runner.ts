import type { Integration } from '@prisma/client'
import { prisma } from '../src/lib/db/prisma'
import { getAssistantProfile } from '../src/lib/assistant/store'
import { runAgentTurn } from '../src/lib/agent/v1'
import { getWorkspaceGovernance } from '../src/lib/agent/governance'
import { listKnownContacts } from '../src/lib/contacts'
import { executeAgentToolRequest } from '../src/lib/agent/tool-execution'
import { claimPendingActionIds } from '../src/lib/actions/claim-pending'
import { executePersistedActionBatch } from '../src/lib/actions/execute-persisted-batch'
import { resolveConnectedWorkspaceContext } from '../src/lib/workspace-context/service'
import {
  createGooglePhotosPickerSession,
  deleteGooglePhotosPickerSession,
  deleteGoogleCalendarEvent,
  deleteGoogleDriveFile,
  getValidGoogleAccessToken,
  listGoogleCalendarEvents,
  listRecentGoogleDocs,
  searchGmailMessages,
  searchGoogleDriveFiles,
} from '../src/lib/integrations/google'
import {
  getValidNotionAccessToken,
  searchNotionDatabases,
  searchNotionPages,
} from '../src/lib/integrations/notion'
import { getOptionalEnv, persistLiveTarget, resolveLiveTarget } from './live-targets'

const SUPPORTED_INTEGRATIONS = ['gmail', 'calendar', 'google_docs', 'google_drive', 'google_photos', 'notion'] as const
const setupOnly = process.argv.includes('--setup-only')

async function previewPrompt(params: {
  workspaceId: string
  userId: string
  prompt: string
}) {
  const [assistantProfile, governance, knownContacts, connectedContextResult] = await Promise.all([
    getAssistantProfile(params.workspaceId),
    getWorkspaceGovernance({
      workspaceId: params.workspaceId,
      userId: params.userId,
    }),
    listKnownContacts({
      workspaceId: params.workspaceId,
      userId: params.userId,
    }),
    resolveConnectedWorkspaceContext({
      content: params.prompt,
      workspaceId: params.workspaceId,
      userId: params.userId,
    }),
  ])

  const result = await runAgentTurn(
    params.prompt,
    [],
    knownContacts,
    assistantProfile,
    governance.allowedActionTypes,
    {
      workspaceContext: connectedContextResult?.workspaceContext,
      connectedContextMetadata: connectedContextResult?.metadata,
    }
  )

  return {
    prompt: params.prompt,
    response: result.response,
    proposals: result.proposals,
    disambiguations: result.disambiguations || [],
  }
}

async function executeLiveAction(params: {
  workspaceId: string
  userId: string
  actionType: string
  parameters: Record<string, unknown>
}) {
  const result = await executeAgentToolRequest({
    actionType: params.actionType as never,
    parameters: params.parameters,
    requireApproval: false,
    context: { workspaceId: params.workspaceId, userId: params.userId },
  })

  if (result.mode === 'executed') {
    return result.execution.output
  }

  await claimPendingActionIds(prisma, {
    actionIds: [result.action.id],
    workspaceId: params.workspaceId,
    userId: params.userId,
  })

  const batchResult = await executePersistedActionBatch({
    actions: [{
      id: result.action.id,
      type: result.action.type,
      title: result.action.title,
      description: result.action.description,
      parameters: result.action.parameters,
      workspaceId: params.workspaceId,
      userId: params.userId,
    }],
    trigger: 'approval',
  })

  if (batchResult.failed || batchResult.completed.length === 0) {
    throw new Error(batchResult.failed?.error || `${params.actionType} failed after approval.`)
  }

  return batchResult.completed[0].execution.output
}

async function resolveScenarioDefaults(params: {
  workspaceId: string
  userId: string
  integrations: Array<Pick<Integration, 'id' | 'type' | 'accessToken' | 'refreshToken' | 'expiresAt' | 'metadata'>>
}) {
  const byType = new Map<string, (typeof params.integrations)[number]>()
  for (const integration of params.integrations) {
    if (!byType.has(integration.type)) {
      byType.set(integration.type, integration)
    }
  }

  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { email: true },
  })

  const knownContacts = await listKnownContacts({
    workspaceId: params.workspaceId,
    userId: params.userId,
  })

  let gmailQuery = getOptionalEnv('KOVA_LIVE_GMAIL_QUERY')
  let driveQuery = getOptionalEnv('KOVA_LIVE_DRIVE_QUERY')
  let docsQuery = getOptionalEnv('KOVA_LIVE_DOCS_QUERY')
  let notionPageQuery = getOptionalEnv('KOVA_LIVE_NOTION_PAGE_QUERY')
  let notionDatabaseQuery = getOptionalEnv('KOVA_LIVE_NOTION_DATABASE_QUERY')
  let gmailThreadId: string | null = null
  let gmailMessageId: string | null = null
  let calendarEventQuery = getOptionalEnv('KOVA_LIVE_CALENDAR_QUERY')
  let calendarEventId: string | null = null
  let driveFileId: string | null = null
  let driveFolderId: string | null = null
  let docsDocumentId: string | null = null
  let notionPageId: string | null = null
  let notionDatabaseId: string | null = null

  const gmail = byType.get('gmail')
  if (gmail && !gmailQuery) {
    const accessToken = await getValidGoogleAccessToken(gmail)
    const messages = await searchGmailMessages(accessToken, { query: 'in:inbox', maxResults: 5 })
    gmailQuery = messages[0]?.subject || messages[0]?.from || null
    gmailThreadId = messages[0]?.threadId || null
    gmailMessageId = messages[0]?.id || null
  }

  const drive = byType.get('google_drive')
  if (drive && (!driveQuery || !driveFolderId)) {
    const accessToken = await getValidGoogleAccessToken(drive)
    const files = await searchGoogleDriveFiles(accessToken, { maxResults: 5 })
    const firstFile = files.find((file) => file.mimeType !== 'application/vnd.google-apps.folder') || files[0]
    const firstFolder = files.find((file) => file.mimeType === 'application/vnd.google-apps.folder') || null
    driveQuery = driveQuery || firstFile?.name || null
    driveFileId = firstFile?.id || null
    driveFolderId = firstFolder?.id || null
  }

  const calendar = byType.get('calendar')
  if (calendar && !calendarEventQuery) {
    const accessToken = await getValidGoogleAccessToken(calendar)
    const now = new Date()
    const later = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    const events = await listGoogleCalendarEvents(accessToken, {
      timeMin: now.toISOString(),
      timeMax: later.toISOString(),
      maxResults: 5,
    })
    calendarEventQuery = events[0]?.title || null
    calendarEventId = events[0]?.id || null
  }

  const docs = byType.get('google_docs')
  if (docs && !docsQuery) {
    const accessToken = await getValidGoogleAccessToken(docs)
    const documents = await listRecentGoogleDocs(accessToken, { maxResults: 5 })
    docsQuery = documents[0]?.title || null
    docsDocumentId = documents[0]?.id || null
  }

  const notion = byType.get('notion')
  if (notion && (!notionPageQuery || !notionDatabaseQuery)) {
    const accessToken = getValidNotionAccessToken(notion)
    if (!notionPageQuery) {
      const pages = await searchNotionPages(accessToken, { maxResults: 5 })
      notionPageQuery = pages[0]?.title || null
      notionPageId = pages[0]?.id || null
    }
    if (!notionDatabaseQuery) {
      const databases = await searchNotionDatabases(accessToken, { maxResults: 5 })
      notionDatabaseQuery = databases[0]?.title || null
      notionDatabaseId = databases[0]?.id || null
    }
  }

  return {
    gmailQuery,
    gmailThreadId,
    gmailMessageId,
    gmailLabel: getOptionalEnv('KOVA_LIVE_GMAIL_LABEL') || 'À traiter',
    forwardTo: getOptionalEnv('KOVA_LIVE_FORWARD_TO') || knownContacts[0]?.email || user?.email || null,
    calendarEventQuery,
    calendarEventId,
    driveQuery,
    driveFileId,
    driveFolder: getOptionalEnv('KOVA_LIVE_DRIVE_FOLDER') || 'Kova Live Tests',
    driveFolderId,
    driveShareTo: getOptionalEnv('KOVA_LIVE_DRIVE_SHARE_TO') || knownContacts[0]?.email || user?.email || null,
    docsQuery,
    docsDocumentId,
    notionPageQuery,
    notionPageId,
    notionDatabaseQuery,
    notionDatabaseId,
  }
}

function withReference(prompt: string, reference?: {
  source: 'gmail' | 'calendar' | 'google_docs' | 'google_drive' | 'notion'
  field: string
  id: string | null
}) {
  if (!reference?.id) {
    return prompt
  }

  return `${prompt}\n[[kova-ref:${reference.source}:${reference.field}:${reference.id}]]`
}

async function main() {
  const execute = process.env.KOVA_LIVE_EXECUTE === 'true'
  const target = await resolveLiveTarget()
  if (setupOnly || process.env.KOVA_LIVE_WRITE_ENV === 'true') {
    await persistLiveTarget({
      workspaceId: target.workspaceId,
      userId: target.userId,
      providers: target.providers,
    })
  }

  console.log(`LIVE_TARGET ${target.autodiscovered ? 'discovered' : 'env'} workspace=${target.workspaceId} user=${target.userId}`)

  const integrations = await prisma.integration.findMany({
    where: {
      workspaceId: target.workspaceId,
      userId: target.userId,
      status: 'connected',
      type: {
        in: [...SUPPORTED_INTEGRATIONS],
      },
    },
    orderBy: [{ updatedAt: 'desc' }],
  })

  const defaults = await resolveScenarioDefaults({
    workspaceId: target.workspaceId,
    userId: target.userId,
    integrations,
  })

  if (setupOnly) {
    console.log('LIVE_SETUP_READY')
    return
  }

  const byType = new Map<string, (typeof integrations)[number]>()
  for (const integration of integrations) {
    if (!byType.has(integration.type)) {
      byType.set(integration.type, integration)
    }
  }

  const results: Array<{ name: string; ok: boolean; detail: string }> = []
  const scenarios: Array<{ name: string; prompt: string; expectedTypes?: string[] }> = []
  const previewStart = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
  previewStart.setUTCHours(9, 0, 0, 0)
  const previewEnd = new Date(previewStart.getTime() + 30 * 60 * 1000)

  if (defaults.gmailQuery) {
    scenarios.push({ name: 'gmail-archive-preview', prompt: withReference(`Archive le thread Gmail "${defaults.gmailQuery}"`, { source: 'gmail', field: 'threadId', id: defaults.gmailThreadId }), expectedTypes: ['archive_gmail_thread'] })
    scenarios.push({ name: 'gmail-unarchive-preview', prompt: withReference(`Remets le thread Gmail "${defaults.gmailQuery}" dans la boîte de réception`, { source: 'gmail', field: 'threadId', id: defaults.gmailThreadId }), expectedTypes: ['unarchive_gmail_thread'] })
    scenarios.push({ name: 'gmail-label-preview', prompt: withReference(`Ajoute le label "${defaults.gmailLabel}" au thread Gmail "${defaults.gmailQuery}"`, { source: 'gmail', field: 'threadId', id: defaults.gmailThreadId }), expectedTypes: ['label_gmail_thread'] })
    scenarios.push({ name: 'gmail-unread-preview', prompt: withReference(`Marque le thread Gmail "${defaults.gmailQuery}" comme non lu`, { source: 'gmail', field: 'threadId', id: defaults.gmailThreadId }), expectedTypes: ['mark_gmail_thread_unread'] })
    scenarios.push({ name: 'gmail-star-preview', prompt: withReference(`Ajoute une étoile au thread Gmail "${defaults.gmailQuery}"`, { source: 'gmail', field: 'threadId', id: defaults.gmailThreadId }), expectedTypes: ['star_gmail_thread'] })
    scenarios.push({ name: 'gmail-trash-preview', prompt: withReference(`Mets le thread Gmail "${defaults.gmailQuery}" dans la corbeille`, { source: 'gmail', field: 'threadId', id: defaults.gmailThreadId }), expectedTypes: ['trash_gmail_thread'] })
  }

  if (defaults.gmailQuery && defaults.forwardTo) {
    scenarios.push({ name: 'gmail-forward-preview', prompt: withReference(`Transfère le mail Gmail "${defaults.gmailQuery}" à ${defaults.forwardTo}`, { source: 'gmail', field: 'messageId', id: defaults.gmailMessageId }), expectedTypes: ['forward_email'] })
    scenarios.push({ name: 'gmail-draft-preview', prompt: `Crée un nouveau brouillon Gmail pour ${defaults.forwardTo} avec pour objet "Kova live draft" et un message court`, expectedTypes: ['create_gmail_draft'] })
  }

  if (byType.has('calendar')) {
    scenarios.push({
      name: 'calendar-create-preview',
      prompt: 'Crée un événement Google Calendar demain à 9h pendant 30 minutes intitulé "Kova Live Preview"',
      expectedTypes: ['create_calendar_event'],
    })
  }
  if (byType.has('calendar') && defaults.calendarEventQuery) {
    scenarios.push({
      name: 'calendar-update-preview',
      prompt: withReference("Mets à jour l'événement Google Calendar sélectionné en le décalant de 30 minutes", { source: 'calendar', field: 'eventId', id: defaults.calendarEventId }),
      expectedTypes: ['update_calendar_event'],
    })
    scenarios.push({
      name: 'calendar-delete-preview',
      prompt: withReference("Supprime l'événement Google Calendar sélectionné", { source: 'calendar', field: 'eventId', id: defaults.calendarEventId }),
      expectedTypes: ['delete_calendar_event'],
    })
  }

  if (defaults.driveQuery) {
    scenarios.push({
      name: 'drive-folder-preview',
      prompt: withReference(
        `Crée un dossier Google Drive "Kova Live Folder ${new Date().toISOString().slice(0, 10)}" dans "${defaults.driveFolder}"`,
        { source: 'google_drive', field: 'parentFolderId', id: defaults.driveFolderId }
      ),
      expectedTypes: ['create_google_drive_folder'],
    })
    scenarios.push({ name: 'drive-move-preview', prompt: withReference(`Déplace le fichier Google Drive sélectionné dans le dossier "${defaults.driveFolder}"`, { source: 'google_drive', field: 'fileId', id: defaults.driveFileId }), expectedTypes: ['move_google_drive_file'] })
    scenarios.push({ name: 'drive-rename-preview', prompt: withReference('Renomme le fichier Google Drive sélectionné en "kova-live-renamed"', { source: 'google_drive', field: 'fileId', id: defaults.driveFileId }), expectedTypes: ['rename_google_drive_file'] })
    scenarios.push({ name: 'drive-copy-preview', prompt: withReference(`Duplique le fichier Google Drive sélectionné dans le dossier "${defaults.driveFolder}"`, { source: 'google_drive', field: 'fileId', id: defaults.driveFileId }), expectedTypes: ['copy_google_drive_file'] })
  }
  if (defaults.driveQuery && defaults.driveShareTo) {
    scenarios.push({ name: 'drive-share-preview', prompt: withReference(`Partage le fichier Google Drive sélectionné avec ${defaults.driveShareTo}`, { source: 'google_drive', field: 'fileId', id: defaults.driveFileId }), expectedTypes: ['share_google_drive_file'] })
    scenarios.push({ name: 'drive-unshare-preview', prompt: withReference(`Retire l'accès au fichier Google Drive sélectionné pour ${defaults.driveShareTo}`, { source: 'google_drive', field: 'fileId', id: defaults.driveFileId }), expectedTypes: ['unshare_google_drive_file'] })
  }

  if (defaults.notionPageQuery) {
    scenarios.push({ name: 'notion-properties-preview', prompt: withReference(`Mets à jour le statut de la page Notion "${defaults.notionPageQuery}" à Done`, { source: 'notion', field: 'pageId', id: defaults.notionPageId }), expectedTypes: ['update_notion_page_properties'] })
    scenarios.push({ name: 'notion-archive-preview', prompt: withReference(`Archive la page Notion "${defaults.notionPageQuery}"`, { source: 'notion', field: 'pageId', id: defaults.notionPageId }), expectedTypes: ['archive_notion_page'] })
  }
  if (defaults.notionDatabaseQuery) {
    scenarios.push({ name: 'notion-database-preview', prompt: withReference(`Crée une page dans la base de données Notion sélectionnée avec le titre "Live Runner"`, { source: 'notion', field: 'parentDatabaseId', id: defaults.notionDatabaseId }), expectedTypes: ['create_notion_page'] })
  }

  if (byType.has('google_docs')) {
    scenarios.push({
      name: 'docs-create-preview',
      prompt: 'Crée un Google Doc intitulé "Kova Live Preview Doc" avec un résumé exécutif et des prochaines étapes.',
      expectedTypes: ['create_google_doc'],
    })
  }
  if (byType.has('google_docs') && defaults.docsQuery) {
    scenarios.push({
      name: 'docs-update-preview',
      prompt: withReference('Ajoute une section "Décisions" dans le Google Doc sélectionné', { source: 'google_docs', field: 'documentId', id: defaults.docsDocumentId }),
      expectedTypes: ['update_google_doc'],
    })
  }

  if (byType.has('google_photos')) {
    scenarios.push({ name: 'photos-picker-preview', prompt: 'Ouvre Google Photos pour que je choisisse des images', expectedTypes: ['create_google_photos_picker_session'] })
  }

  if (scenarios.length === 0) {
    console.log('LIVE_RUNNER_NO_SCENARIOS')
    console.log(`No connected integrations were available for workspace=${target.workspaceId} user=${target.userId}.`)
    return
  }

  for (const scenario of scenarios) {
    try {
      const preview = await previewPrompt({
        workspaceId: target.workspaceId,
        userId: target.userId,
        prompt: scenario.prompt,
      })
      const proposalTypes = preview.proposals.map((proposal) => proposal.type)
      const hasActionOrClarification = preview.proposals.length > 0 || (preview.disambiguations || []).length > 0
      const matchesExpectedTypes =
        scenario.expectedTypes && scenario.expectedTypes.length > 0
          ? proposalTypes.length === scenario.expectedTypes.length &&
            scenario.expectedTypes.every((expectedType, index) => proposalTypes[index] === expectedType)
          : true
      results.push({
        name: scenario.name,
        ok: hasActionOrClarification && matchesExpectedTypes,
        detail: `${preview.proposals.length} proposal(s) | types=${proposalTypes.join(', ') || 'none'} | expected=${scenario.expectedTypes?.join(', ') || 'any'} | ${(preview.disambiguations || []).length} clarification(s) | ${preview.response}`,
      })
    } catch (error) {
      results.push({
        name: scenario.name,
        ok: false,
        detail: error instanceof Error ? error.message : 'unknown error',
      })
    }
  }

  for (const result of results) {
    console.log(`${result.ok ? 'OK' : 'FAIL'} ${result.name}: ${result.detail}`)
  }

  const failed = results.filter((result) => !result.ok)
  if (failed.length > 0) {
    throw new Error(`Live runner failed for ${failed.map((item) => item.name).join(', ')}`)
  }

  console.log(`LIVE_RUNNER_OK ${results.length}`)

  if (execute) {
    const gmail = byType.get('gmail')
    if (gmail && defaults.gmailQuery) {
      try {
        const accessToken = await getValidGoogleAccessToken(gmail)
        const messages = await searchGmailMessages(accessToken, { query: defaults.gmailQuery, maxResults: 2 })
        const firstMessage = messages[0]
        if (firstMessage?.threadId) {
          await executeAgentToolRequest({
            actionType: 'archive_gmail_thread',
            parameters: { threadId: firstMessage.threadId },
            requireApproval: false,
            context: { workspaceId: target.workspaceId, userId: target.userId },
          })
          results.push({ name: 'gmail-archive-execute', ok: true, detail: `thread ${firstMessage.threadId} archived` })

          await executeLiveAction({
            workspaceId: target.workspaceId,
            userId: target.userId,
            actionType: 'label_gmail_thread',
            parameters: {
              threadId: firstMessage.threadId,
              labelNames: [defaults.gmailLabel],
            },
          })
          await executeLiveAction({
            workspaceId: target.workspaceId,
            userId: target.userId,
            actionType: 'remove_gmail_thread_labels',
            parameters: {
              threadId: firstMessage.threadId,
              labelNames: [defaults.gmailLabel],
            },
          })
          results.push({ name: 'gmail-label-cycle-execute', ok: true, detail: `thread ${firstMessage.threadId} labeled then cleaned up` })

          await executeLiveAction({
            workspaceId: target.workspaceId,
            userId: target.userId,
            actionType: 'mark_gmail_thread_unread',
            parameters: { threadId: firstMessage.threadId },
          })
          await executeLiveAction({
            workspaceId: target.workspaceId,
            userId: target.userId,
            actionType: 'mark_gmail_thread_read',
            parameters: { threadId: firstMessage.threadId },
          })
          results.push({ name: 'gmail-read-cycle-execute', ok: true, detail: `thread ${firstMessage.threadId} unread/read cycle ok` })

          await executeLiveAction({
            workspaceId: target.workspaceId,
            userId: target.userId,
            actionType: 'star_gmail_thread',
            parameters: { threadId: firstMessage.threadId },
          })
          await executeLiveAction({
            workspaceId: target.workspaceId,
            userId: target.userId,
            actionType: 'unstar_gmail_thread',
            parameters: { threadId: firstMessage.threadId },
          })
          results.push({ name: 'gmail-star-cycle-execute', ok: true, detail: `thread ${firstMessage.threadId} star/unstar cycle ok` })
        }
      } catch (error) {
        results.push({ name: 'gmail-archive-execute', ok: false, detail: error instanceof Error ? error.message : 'unknown error' })
      }
    }

    if (gmail && defaults.forwardTo) {
      try {
        const draftOutput = await executeLiveAction({
          workspaceId: target.workspaceId,
          userId: target.userId,
          actionType: 'create_gmail_draft',
          parameters: {
            to: [defaults.forwardTo],
            subject: `Kova live draft ${Date.now()}`,
            body: 'Draft created by Kova live runner.',
          },
        })
        const draftId = typeof draftOutput.draftId === 'string' ? draftOutput.draftId : ''
        if (!draftId) {
          throw new Error('Gmail draft create did not return a draftId.')
        }
        await executeLiveAction({
          workspaceId: target.workspaceId,
          userId: target.userId,
          actionType: 'update_gmail_draft',
          parameters: {
            draftId,
            body: 'Draft updated by Kova live runner.',
          },
        })
        results.push({ name: 'gmail-draft-write-execute', ok: true, detail: `draft ${draftId} created and updated` })
      } catch (error) {
        results.push({ name: 'gmail-draft-write-execute', ok: false, detail: error instanceof Error ? error.message : 'unknown error' })
      }
    }

    const drive = byType.get('google_drive')
    if (drive && defaults.driveQuery) {
      try {
        const accessToken = await getValidGoogleAccessToken(drive)
        const files = await searchGoogleDriveFiles(accessToken, { query: defaults.driveQuery, maxResults: 2 })
        const firstFile = files[0]
        if (firstFile?.id) {
          await executeAgentToolRequest({
            actionType: 'rename_google_drive_file',
            parameters: { fileId: firstFile.id, name: `kova-live-${Date.now()}` },
            requireApproval: false,
            context: { workspaceId: target.workspaceId, userId: target.userId },
          })
          results.push({ name: 'drive-rename-execute', ok: true, detail: `file ${firstFile.id} renamed` })

          const folderOutput = await executeLiveAction({
            workspaceId: target.workspaceId,
            userId: target.userId,
            actionType: 'create_google_drive_folder',
            parameters: {
              name: `Kova Live Folder ${Date.now()}`,
              ...(defaults.driveFolderId ? { parentFolderId: defaults.driveFolderId } : {}),
            },
          })
          const createdFolderId = typeof folderOutput.fileId === 'string' ? folderOutput.fileId : ''
          if (!createdFolderId) {
            throw new Error('Drive folder create did not return a fileId.')
          }
          await deleteGoogleDriveFile(accessToken, { fileId: createdFolderId })
          results.push({ name: 'drive-folder-execute', ok: true, detail: `folder ${createdFolderId} created and cleaned up` })

          const copyOutput = await executeLiveAction({
            workspaceId: target.workspaceId,
            userId: target.userId,
            actionType: 'copy_google_drive_file',
            parameters: {
              fileId: firstFile.id,
              name: `kova-live-copy-${Date.now()}`,
              ...(defaults.driveFolderId ? { destinationFolderId: defaults.driveFolderId } : {}),
            },
          })
          const copiedFileId = typeof copyOutput.fileId === 'string' ? copyOutput.fileId : ''
          if (!copiedFileId) {
            throw new Error('Drive copy did not return a fileId.')
          }
          await deleteGoogleDriveFile(accessToken, { fileId: copiedFileId })
          results.push({ name: 'drive-copy-execute', ok: true, detail: `copied file ${copiedFileId} cleaned up` })

          if (defaults.driveShareTo) {
            await executeLiveAction({
              workspaceId: target.workspaceId,
              userId: target.userId,
              actionType: 'share_google_drive_file',
              parameters: {
                fileId: firstFile.id,
                emails: [defaults.driveShareTo],
                notify: false,
              },
            })
            await executeLiveAction({
              workspaceId: target.workspaceId,
              userId: target.userId,
              actionType: 'unshare_google_drive_file',
              parameters: {
                fileId: firstFile.id,
                emails: [defaults.driveShareTo],
              },
            })
            results.push({ name: 'drive-share-cycle-execute', ok: true, detail: `file ${firstFile.id} shared then unshared` })
          }
        }
      } catch (error) {
        results.push({ name: 'drive-rename-execute', ok: false, detail: error instanceof Error ? error.message : 'unknown error' })
      }
    }

    const calendar = byType.get('calendar')
    if (calendar) {
      try {
        const calendarOutput = await executeLiveAction({
          workspaceId: target.workspaceId,
          userId: target.userId,
          actionType: 'create_calendar_event',
          parameters: {
            title: `Kova Live ${new Date().toISOString()}`,
            startTime: previewStart.toISOString(),
            endTime: previewEnd.toISOString(),
            attendees: defaults.forwardTo ? [defaults.forwardTo] : [],
            createMeetLink: false,
            description: 'Created by Kova integration live runner.',
          },
        })
        const eventId = typeof calendarOutput.eventId === 'string' ? calendarOutput.eventId : ''
        if (!eventId) {
          throw new Error('Calendar create did not return an eventId.')
        }
        const accessToken = await getValidGoogleAccessToken(calendar)
        await deleteGoogleCalendarEvent(accessToken, { eventId })
        results.push({ name: 'calendar-create-execute', ok: true, detail: `event ${eventId} created and cleaned up` })
      } catch (error) {
        results.push({ name: 'calendar-create-execute', ok: false, detail: error instanceof Error ? error.message : 'unknown error' })
      }
    }

    const docs = byType.get('google_docs')
    if (docs) {
      try {
        const createDocOutput = await executeLiveAction({
          workspaceId: target.workspaceId,
          userId: target.userId,
          actionType: 'create_google_doc',
          parameters: {
            title: `Kova Live Doc ${new Date().toISOString()}`,
            sections: ['Résumé exécutif', 'Décisions', 'Prochaines étapes'],
            sourcePrompt: 'Validation live Kova',
            content: 'Document créé automatiquement pour valider les write-paths Google Docs.',
          },
        })
        const documentId = typeof createDocOutput.documentId === 'string' ? createDocOutput.documentId : ''
        if (!documentId) {
          throw new Error('Google Doc create did not return a documentId.')
        }

        await executeLiveAction({
          workspaceId: target.workspaceId,
          userId: target.userId,
          actionType: 'update_google_doc',
          parameters: {
            documentId,
            content: 'Ajout automatique de validation live Kova.',
          },
        })

        const drive = byType.get('google_drive')
        if (drive) {
          const accessToken = await getValidGoogleAccessToken(drive)
          await deleteGoogleDriveFile(accessToken, { fileId: documentId })
        }

        results.push({ name: 'docs-write-execute', ok: true, detail: `document ${documentId} created, updated and cleaned up` })
      } catch (error) {
        results.push({ name: 'docs-write-execute', ok: false, detail: error instanceof Error ? error.message : 'unknown error' })
      }
    }

    const notion = byType.get('notion')
    if (notion && defaults.notionDatabaseQuery) {
      try {
        const accessToken = getValidNotionAccessToken(notion)
        const databases = await searchNotionDatabases(accessToken, { query: defaults.notionDatabaseQuery, maxResults: 2 })
        const firstDatabase = databases[0]
        if (firstDatabase?.id) {
          const result = await executeAgentToolRequest({
            actionType: 'create_notion_page',
            parameters: {
              title: `Live Runner ${new Date().toISOString()}`,
              content: 'Created by Kova integration live runner.',
              parentDatabaseId: firstDatabase.id,
              properties: {
                Status: 'Todo',
              },
            },
            requireApproval: false,
            context: { workspaceId: target.workspaceId, userId: target.userId },
          })
          const createdPageId =
            result.mode === 'executed' && typeof result.execution.output.pageId === 'string'
              ? result.execution.output.pageId
              : null
          if (!createdPageId) {
            throw new Error('Notion create did not return a pageId.')
          }
          await executeLiveAction({
            workspaceId: target.workspaceId,
            userId: target.userId,
            actionType: 'archive_notion_page',
            parameters: {
              pageId: createdPageId,
            },
          })
          results.push({ name: 'notion-database-execute', ok: true, detail: `page ${createdPageId} created then archived` })
        }
      } catch (error) {
        results.push({ name: 'notion-database-execute', ok: false, detail: error instanceof Error ? error.message : 'unknown error' })
      }
    }

    if (notion && defaults.notionPageQuery) {
      try {
        const accessToken = getValidNotionAccessToken(notion)
        const pages = await searchNotionPages(accessToken, { query: defaults.notionPageQuery, maxResults: 2 })
        const firstPage = pages[0]
        if (firstPage?.id) {
          await executeAgentToolRequest({
            actionType: 'update_notion_page_properties',
            parameters: {
              pageId: firstPage.id,
              properties: {
                Status: 'Done',
              },
            },
            requireApproval: false,
            context: { workspaceId: target.workspaceId, userId: target.userId },
          })
          results.push({ name: 'notion-properties-execute', ok: true, detail: `page ${firstPage.id} updated` })
        }
      } catch (error) {
        results.push({ name: 'notion-properties-execute', ok: false, detail: error instanceof Error ? error.message : 'unknown error' })
      }
    }

    const photos = byType.get('google_photos')
    if (photos) {
      try {
        const accessToken = await getValidGoogleAccessToken(photos)
        const session = await createGooglePhotosPickerSession(accessToken, {
          requestId: `live-${Date.now()}`,
        })
        await deleteGooglePhotosPickerSession(accessToken, session.sessionId)
        results.push({ name: 'photos-picker-execute', ok: true, detail: `picker session ${session.sessionId} created` })
      } catch (error) {
        results.push({ name: 'photos-picker-execute', ok: false, detail: error instanceof Error ? error.message : 'unknown error' })
      }
    }
  }

  for (const result of results) {
    console.log(`${result.ok ? 'OK' : 'FAIL'} ${result.name}: ${result.detail}`)
  }

  const failures = results.filter((result) => !result.ok)
  if (failures.length > 0) {
    throw new Error(`Live runner failed for ${failures.map((item) => item.name).join(', ')}`)
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
