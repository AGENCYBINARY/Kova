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

function requireEnv(name: string) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required.`)
  }
  return value
}

function optionalEnv(name: string) {
  const value = process.env[name]
  return value && value.trim() ? value.trim() : null
}

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
  }
}

async function main() {
  const workspaceId = requireEnv('KOVA_SMOKE_WORKSPACE_ID')
  const userId = requireEnv('KOVA_SMOKE_USER_ID')
  const execute = process.env.KOVA_LIVE_EXECUTE === 'true'

  const integrations = await prisma.integration.findMany({
    where: {
      workspaceId,
      userId,
      status: 'connected',
      type: {
        in: ['gmail', 'calendar', 'google_docs', 'google_drive', 'notion'],
      },
    },
    orderBy: [{ updatedAt: 'desc' }],
  })

  const byType = new Map<string, (typeof integrations)[number]>()
  for (const integration of integrations) {
    if (!byType.has(integration.type)) {
      byType.set(integration.type, integration)
    }
  }

  const results: Array<{ name: string; ok: boolean; detail: string }> = []
  const scenarios: Array<{ name: string; prompt: string }> = []

  const gmailQuery = optionalEnv('KOVA_LIVE_GMAIL_QUERY')
  const gmailLabel = optionalEnv('KOVA_LIVE_GMAIL_LABEL') || 'À traiter'
  const forwardTo = optionalEnv('KOVA_LIVE_FORWARD_TO')

  if (gmailQuery) {
    scenarios.push({ name: 'gmail-archive-preview', prompt: `Archive le mail Gmail ${gmailQuery}` })
    scenarios.push({ name: 'gmail-label-preview', prompt: `Ajoute le label "${gmailLabel}" au mail Gmail ${gmailQuery}` })
    scenarios.push({ name: 'gmail-unread-preview', prompt: `Marque le mail Gmail ${gmailQuery} comme non lu` })
  }

  if (gmailQuery && forwardTo) {
    scenarios.push({ name: 'gmail-forward-preview', prompt: `Transfère le mail Gmail ${gmailQuery} à ${forwardTo}` })
  }

  const driveQuery = optionalEnv('KOVA_LIVE_DRIVE_QUERY')
  const driveFolder = optionalEnv('KOVA_LIVE_DRIVE_FOLDER') || 'Kova Live Tests'
  const driveShareTo = optionalEnv('KOVA_LIVE_DRIVE_SHARE_TO')
  if (driveQuery) {
    scenarios.push({ name: 'drive-move-preview', prompt: `Déplace le fichier Drive ${driveQuery} dans ${driveFolder}` })
    scenarios.push({ name: 'drive-rename-preview', prompt: `Renomme le fichier Drive ${driveQuery} en "kova-live-renamed"` })
  }
  if (driveQuery && driveShareTo) {
    scenarios.push({ name: 'drive-share-preview', prompt: `Partage le fichier Drive ${driveQuery} avec ${driveShareTo}` })
  }

  const notionPageQuery = optionalEnv('KOVA_LIVE_NOTION_PAGE_QUERY')
  const notionDatabaseQuery = optionalEnv('KOVA_LIVE_NOTION_DATABASE_QUERY')
  if (notionPageQuery) {
    scenarios.push({ name: 'notion-properties-preview', prompt: `Mets à jour le statut de la page Notion ${notionPageQuery} à Done` })
  }
  if (notionDatabaseQuery) {
    scenarios.push({ name: 'notion-database-preview', prompt: `Crée une page Notion dans la base ${notionDatabaseQuery} avec le titre Live Runner` })
  }

  for (const scenario of scenarios) {
    try {
      const preview = await previewPrompt({
        workspaceId,
        userId,
        prompt: scenario.prompt,
      })
      results.push({
        name: scenario.name,
        ok: true,
        detail: `${preview.proposals.length} proposal(s) | ${preview.response}`,
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
    if (gmail && gmailQuery) {
      try {
        const accessToken = await getValidGoogleAccessToken(gmail)
        const messages = await searchGmailMessages(accessToken, { query: gmailQuery, maxResults: 2 })
        const firstMessage = messages[0]
        if (firstMessage?.threadId) {
          await executeAgentToolRequest({
            actionType: 'archive_gmail_thread',
            parameters: { threadId: firstMessage.threadId },
            requireApproval: false,
            context: { workspaceId, userId },
          })
          results.push({ name: 'gmail-archive-execute', ok: true, detail: `thread ${firstMessage.threadId} archived` })
        }
      } catch (error) {
        results.push({ name: 'gmail-archive-execute', ok: false, detail: error instanceof Error ? error.message : 'unknown error' })
      }
    }

    const drive = byType.get('google_drive')
    if (drive && driveQuery) {
      try {
        const accessToken = await getValidGoogleAccessToken(drive)
        const files = await searchGoogleDriveFiles(accessToken, { query: driveQuery, maxResults: 2 })
        const firstFile = files[0]
        if (firstFile?.id) {
          await executeAgentToolRequest({
            actionType: 'rename_google_drive_file',
            parameters: { fileId: firstFile.id, name: `kova-live-${Date.now()}` },
            requireApproval: false,
            context: { workspaceId, userId },
          })
          results.push({ name: 'drive-rename-execute', ok: true, detail: `file ${firstFile.id} renamed` })
        }
      } catch (error) {
        results.push({ name: 'drive-rename-execute', ok: false, detail: error instanceof Error ? error.message : 'unknown error' })
      }
    }

    const notion = byType.get('notion')
    if (notion && notionDatabaseQuery) {
      try {
        const accessToken = getValidNotionAccessToken(notion)
        const databases = await searchNotionDatabases(accessToken, { query: notionDatabaseQuery, maxResults: 2 })
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
            context: { workspaceId, userId },
          })
          results.push({ name: 'notion-database-execute', ok: true, detail: `page created in database ${firstDatabase.id}` })
        }
      } catch (error) {
        results.push({ name: 'notion-database-execute', ok: false, detail: error instanceof Error ? error.message : 'unknown error' })
      }
    }

    if (notion && notionPageQuery) {
      try {
        const accessToken = getValidNotionAccessToken(notion)
        const pages = await searchNotionPages(accessToken, { query: notionPageQuery, maxResults: 2 })
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
            context: { workspaceId, userId },
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
