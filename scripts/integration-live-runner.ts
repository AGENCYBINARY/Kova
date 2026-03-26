import type { Integration } from '@prisma/client'
import { prisma } from '../src/lib/db/prisma'
import { getAssistantProfile } from '../src/lib/assistant/store'
import { runAgentTurn } from '../src/lib/agent/v1'
import { getWorkspaceGovernance } from '../src/lib/agent/governance'
import { listKnownContacts } from '../src/lib/contacts'
import { executeAgentToolRequest } from '../src/lib/agent/tool-execution'
import { resolveConnectedWorkspaceContext } from '../src/lib/workspace-context/service'
import {
  getValidGoogleAccessToken,
  searchGmailMessages,
  searchGoogleDriveFiles,
} from '../src/lib/integrations/google'
import {
  getValidNotionAccessToken,
  searchNotionDatabases,
  searchNotionPages,
} from '../src/lib/integrations/notion'
import { getOptionalEnv, persistLiveTarget, resolveLiveTarget } from './live-targets'

const SUPPORTED_INTEGRATIONS = ['gmail', 'calendar', 'google_docs', 'google_drive', 'notion'] as const
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
  let notionPageQuery = getOptionalEnv('KOVA_LIVE_NOTION_PAGE_QUERY')
  let notionDatabaseQuery = getOptionalEnv('KOVA_LIVE_NOTION_DATABASE_QUERY')
  let gmailThreadId: string | null = null
  let gmailMessageId: string | null = null
  let driveFileId: string | null = null
  let driveFolderId: string | null = null
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
    driveQuery,
    driveFileId,
    driveFolder: getOptionalEnv('KOVA_LIVE_DRIVE_FOLDER') || 'Kova Live Tests',
    driveFolderId,
    driveShareTo: getOptionalEnv('KOVA_LIVE_DRIVE_SHARE_TO') || knownContacts[0]?.email || user?.email || null,
    notionPageQuery,
    notionPageId,
    notionDatabaseQuery,
    notionDatabaseId,
  }
}

function withReference(prompt: string, reference?: {
  source: 'gmail' | 'google_drive' | 'notion'
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
  const scenarios: Array<{ name: string; prompt: string }> = []

  if (defaults.gmailQuery) {
    scenarios.push({ name: 'gmail-archive-preview', prompt: withReference(`Archive le thread Gmail "${defaults.gmailQuery}"`, { source: 'gmail', field: 'threadId', id: defaults.gmailThreadId }) })
    scenarios.push({ name: 'gmail-unarchive-preview', prompt: withReference(`Remets le thread Gmail "${defaults.gmailQuery}" dans la boîte de réception`, { source: 'gmail', field: 'threadId', id: defaults.gmailThreadId }) })
    scenarios.push({ name: 'gmail-label-preview', prompt: withReference(`Ajoute le label "${defaults.gmailLabel}" au thread Gmail "${defaults.gmailQuery}"`, { source: 'gmail', field: 'threadId', id: defaults.gmailThreadId }) })
    scenarios.push({ name: 'gmail-unread-preview', prompt: withReference(`Marque le thread Gmail "${defaults.gmailQuery}" comme non lu`, { source: 'gmail', field: 'threadId', id: defaults.gmailThreadId }) })
    scenarios.push({ name: 'gmail-star-preview', prompt: withReference(`Ajoute une étoile au thread Gmail "${defaults.gmailQuery}"`, { source: 'gmail', field: 'threadId', id: defaults.gmailThreadId }) })
    scenarios.push({ name: 'gmail-trash-preview', prompt: withReference(`Mets le thread Gmail "${defaults.gmailQuery}" dans la corbeille`, { source: 'gmail', field: 'threadId', id: defaults.gmailThreadId }) })
  }

  if (defaults.gmailQuery && defaults.forwardTo) {
    scenarios.push({ name: 'gmail-forward-preview', prompt: withReference(`Transfère le mail Gmail "${defaults.gmailQuery}" à ${defaults.forwardTo}`, { source: 'gmail', field: 'messageId', id: defaults.gmailMessageId }) })
    scenarios.push({ name: 'gmail-draft-preview', prompt: `Prépare un brouillon Gmail pour ${defaults.forwardTo} à propos de "${defaults.gmailQuery}"` })
  }

  if (defaults.driveQuery) {
    scenarios.push({
      name: 'drive-folder-preview',
      prompt: withReference(
        `Crée un dossier Google Drive "Kova Live Folder ${new Date().toISOString().slice(0, 10)}" dans "${defaults.driveFolder}"`,
        { source: 'google_drive', field: 'parentFolderId', id: defaults.driveFolderId }
      ),
    })
    scenarios.push({ name: 'drive-move-preview', prompt: withReference(`Déplace le fichier Google Drive nommé "${defaults.driveQuery}" dans le dossier "${defaults.driveFolder}"`, { source: 'google_drive', field: 'fileId', id: defaults.driveFileId }) })
    scenarios.push({ name: 'drive-rename-preview', prompt: withReference(`Renomme le fichier Google Drive nommé "${defaults.driveQuery}" en "kova-live-renamed"`, { source: 'google_drive', field: 'fileId', id: defaults.driveFileId }) })
    scenarios.push({ name: 'drive-copy-preview', prompt: withReference(`Duplique le fichier Google Drive nommé "${defaults.driveQuery}" dans le dossier "${defaults.driveFolder}"`, { source: 'google_drive', field: 'fileId', id: defaults.driveFileId }) })
  }
  if (defaults.driveQuery && defaults.driveShareTo) {
    scenarios.push({ name: 'drive-share-preview', prompt: withReference(`Partage le fichier Google Drive sélectionné avec ${defaults.driveShareTo}`, { source: 'google_drive', field: 'fileId', id: defaults.driveFileId }) })
    scenarios.push({ name: 'drive-unshare-preview', prompt: withReference(`Retire l'accès au fichier Google Drive sélectionné pour ${defaults.driveShareTo}`, { source: 'google_drive', field: 'fileId', id: defaults.driveFileId }) })
  }

  if (defaults.notionPageQuery) {
    scenarios.push({ name: 'notion-properties-preview', prompt: withReference(`Mets à jour le statut de la page Notion "${defaults.notionPageQuery}" à Done`, { source: 'notion', field: 'pageId', id: defaults.notionPageId }) })
    scenarios.push({ name: 'notion-archive-preview', prompt: withReference(`Archive la page Notion "${defaults.notionPageQuery}"`, { source: 'notion', field: 'pageId', id: defaults.notionPageId }) })
  }
  if (defaults.notionDatabaseQuery) {
    scenarios.push({ name: 'notion-database-preview', prompt: withReference(`Crée une page dans la base de données Notion sélectionnée avec le titre "Live Runner"`, { source: 'notion', field: 'parentDatabaseId', id: defaults.notionDatabaseId }) })
  }

  for (const scenario of scenarios) {
    try {
      const preview = await previewPrompt({
        workspaceId: target.workspaceId,
        userId: target.userId,
        prompt: scenario.prompt,
      })
      results.push({
        name: scenario.name,
        ok: true,
        detail: `${preview.proposals.length} proposal(s) | types=${preview.proposals.map((proposal) => proposal.type).join(', ') || 'none'} | ${(preview.disambiguations || []).length} clarification(s) | ${preview.response}`,
      })
    } catch (error) {
      results.push({
        name: scenario.name,
        ok: false,
        detail: error instanceof Error ? error.message : 'unknown error',
      })
    }
  }

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
        }
      } catch (error) {
        results.push({ name: 'gmail-archive-execute', ok: false, detail: error instanceof Error ? error.message : 'unknown error' })
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
        }
      } catch (error) {
        results.push({ name: 'drive-rename-execute', ok: false, detail: error instanceof Error ? error.message : 'unknown error' })
      }
    }

    const notion = byType.get('notion')
    if (notion && defaults.notionDatabaseQuery) {
      try {
        const accessToken = getValidNotionAccessToken(notion)
        const databases = await searchNotionDatabases(accessToken, { query: defaults.notionDatabaseQuery, maxResults: 2 })
        const firstDatabase = databases[0]
        if (firstDatabase?.id) {
          await executeAgentToolRequest({
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
          results.push({ name: 'notion-database-execute', ok: true, detail: `page created in database ${firstDatabase.id}` })
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
