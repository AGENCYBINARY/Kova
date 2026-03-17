import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import type { DashboardAction } from '@/lib/dashboard-data'
import type { IntegrationExecutionResult, IntegrationProvider } from '@/lib/integrations/types'
import {
  createGoogleCalendarEvent,
  createGoogleDoc,
  createGoogleDriveFile,
  getValidGoogleAccessToken,
  sendGmailMessage,
  updateGoogleDoc,
} from '@/lib/integrations/google'
import {
  createNotionPage,
  getValidNotionAccessToken,
  updateNotionPage,
} from '@/lib/integrations/notion'

function providerForAction(type: DashboardAction['type']): IntegrationProvider {
  switch (type) {
    case 'send_email':
      return 'gmail'
    case 'create_calendar_event':
      return 'calendar'
    case 'create_google_doc':
    case 'update_google_doc':
      return 'google_docs'
    case 'create_google_drive_file':
      return 'google_drive'
    case 'create_notion_page':
    case 'update_notion_page':
      return 'notion'
    default:
      return 'gmail'
  }
}

function asParameters(parameters: Prisma.JsonValue): Record<string, unknown> {
  return parameters && typeof parameters === 'object' && !Array.isArray(parameters)
    ? (parameters as Record<string, unknown>)
    : {}
}

export async function executePersistedAction(params: {
  action: {
    id: string
    type: DashboardAction['type']
    title: string
    description: string
    parameters: Prisma.JsonValue
    workspaceId: string
    userId: string
  }
}): Promise<IntegrationExecutionResult> {
  const provider = providerForAction(params.action.type)
  const integration = await prisma.integration.findFirst({
    where: {
      type: provider,
      workspaceId: params.action.workspaceId,
      userId: params.action.userId,
      status: 'connected',
    },
  })

  if (!integration) {
    throw new Error(`Integration "${provider}" is not connected.`)
  }

  const parameters = asParameters(params.action.parameters)

  if (provider === 'gmail') {
    const accessToken = await getValidGoogleAccessToken(integration)
    return sendGmailMessage(accessToken, parameters)
  }

  if (provider === 'calendar') {
    const accessToken = await getValidGoogleAccessToken(integration)
    return createGoogleCalendarEvent(accessToken, parameters)
  }

  if (provider === 'google_docs') {
    const accessToken = await getValidGoogleAccessToken(integration)
    return params.action.type === 'update_google_doc'
      ? updateGoogleDoc(accessToken, parameters)
      : createGoogleDoc(accessToken, parameters)
  }

  if (provider === 'google_drive') {
    const accessToken = await getValidGoogleAccessToken(integration)
    return createGoogleDriveFile(accessToken, parameters)
  }

  const accessToken = getValidNotionAccessToken(integration)
  return params.action.type === 'update_notion_page'
    ? updateNotionPage(accessToken, parameters)
    : createNotionPage(accessToken, parameters)
}
