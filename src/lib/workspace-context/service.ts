import { prisma } from '@/lib/db/prisma'
import {
  computeCalendarAvailability,
  getGoogleIntegrationCapabilityState,
  getValidGoogleAccessToken,
  listGoogleCalendarEvents,
  listRecentGoogleDocs,
  listTodayGmailMessages,
  searchGmailMessages,
  searchGoogleDriveFiles,
  summarizeGmailThreads,
  type GmailMessageSummary,
  type GoogleCalendarAvailabilityWindow,
  type GoogleCalendarEventSummary,
  type GoogleDocSummary,
  type GoogleDriveFileSummary,
} from '@/lib/integrations/google'
import {
  getValidNotionAccessToken,
  readNotionPagePreview,
  searchNotionPages,
  type NotionPageSummary,
} from '@/lib/integrations/notion'
import {
  resolveConnectedContextRequest,
  type ConnectedContextRequest,
  type ConnectedContextSeed,
  type ConnectedContextSource,
} from '@/lib/workspace-context/intents'

interface SourceContextBlock {
  source: ConnectedContextSource
  lines: string[]
  metadata: Record<string, unknown>
}

interface GmailMessageMetadata {
  from: string
  subject: string
  snippet: string
  unread: boolean
}

interface CalendarEventMetadata {
  title: string
  startTime: string | null
  endTime: string | null
  attendees: string[]
  location: string | null
  meetLink: string | null
  status: string | null
}

interface AvailabilityWindowMetadata {
  startTime: string
  endTime: string
}

interface DriveFileMetadata {
  name: string
  mimeType: string
  modifiedTime: string | null
  owners: string[]
  webViewLink: string | null
}

interface GoogleDocMetadata {
  title: string
  modifiedTime: string | null
  preview: string
  webViewLink: string | null
}

interface NotionPageMetadata {
  title: string
  lastEditedTime: string | null
  preview: string
  url: string | null
}

export interface ConnectedWorkspaceContextResult {
  request: ConnectedContextRequest
  workspaceContext: string
  metadata: Record<string, unknown>
}

function getIntegrationConnectedAccount(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null
  }

  const connectedAccount = (metadata as Record<string, unknown>).connectedAccount
  return typeof connectedAccount === 'string' && connectedAccount.trim() ? connectedAccount.trim() : null
}

function getIntegrationWorkspaceName(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null
  }

  const workspaceName = (metadata as Record<string, unknown>).workspaceName
  return typeof workspaceName === 'string' && workspaceName.trim() ? workspaceName.trim() : null
}

function formatMessageLine(message: GmailMessageSummary) {
  return `${message.from || 'Unknown sender'} | ${message.subject || '(no subject)'} | ${message.unread ? 'unread' : 'read'} | ${message.snippet || ''}`.trim()
}

function formatThreadLine(subject: string, count: number, participants: string[], snippet: string) {
  return `${subject} | ${count} message(s) | ${participants.join(', ') || 'Unknown participants'} | ${snippet}`.trim()
}

function formatEventLine(event: GoogleCalendarEventSummary) {
  return `${event.startTime || 'unknown start'} -> ${event.endTime || 'unknown end'} | ${event.title}${event.attendees.length > 0 ? ` | attendees: ${event.attendees.join(', ')}` : ''}${event.meetLink ? ` | meet: ${event.meetLink}` : ''}`
}

function formatAvailabilityLine(window: GoogleCalendarAvailabilityWindow) {
  return `${window.startTime} -> ${window.endTime}`
}

function formatDriveFileLine(file: GoogleDriveFileSummary) {
  return `${file.name} | ${file.mimeType} | modified ${file.modifiedTime || 'unknown'}${file.owners.length > 0 ? ` | owners: ${file.owners.join(', ')}` : ''}${file.webViewLink ? ` | link: ${file.webViewLink}` : ''}`
}

function formatGoogleDocLine(doc: GoogleDocSummary) {
  return `${doc.title} | modified ${doc.modifiedTime || 'unknown'}${doc.preview ? ` | ${doc.preview}` : ''}${doc.webViewLink ? ` | ${doc.webViewLink}` : ''}`
}

function formatNotionPageLine(page: NotionPageSummary) {
  return `${page.title} | edited ${page.lastEditedTime || 'unknown'}${page.preview ? ` | ${page.preview}` : ''}${page.url ? ` | ${page.url}` : ''}`
}

function buildTimeRange(timeframe: ConnectedContextRequest['timeframe']) {
  const now = new Date()
  const start = new Date(now)
  const end = new Date(now)

  if (timeframe === 'today') {
    start.setHours(0, 0, 0, 0)
    end.setHours(23, 59, 59, 999)
    return { start, end }
  }

  if (timeframe === 'week') {
    const day = start.getDay()
    const mondayDelta = (day + 6) % 7
    start.setDate(start.getDate() - mondayDelta)
    start.setHours(0, 0, 0, 0)
    end.setTime(start.getTime())
    end.setDate(start.getDate() + 7)
    return { start, end }
  }

  start.setDate(start.getDate() - 7)
  return { start, end }
}

async function buildGmailContext(params: {
  request: ConnectedContextRequest
  accessToken: string
  connectedAccount: string | null
}) {
  const messages =
    params.request.timeframe === 'today' || !params.request.searchQuery
      ? await listTodayGmailMessages(params.accessToken, { maxResults: params.request.asksForPriorities ? 8 : 12 })
      : await searchGmailMessages(params.accessToken, {
          query: params.request.searchQuery,
          maxResults: 10,
        })

  const threads = await summarizeGmailThreads(messages)
  const unreadCount = messages.filter((message) => message.unread).length

  return {
    source: 'gmail',
    lines: [
      `Gmail${params.connectedAccount ? ` (${params.connectedAccount})` : ''}`,
      `- messages loaded: ${messages.length}`,
      `- unread count: ${unreadCount}`,
      ...(messages.length > 0 ? messages.slice(0, 6).map((message) => `- ${formatMessageLine(message)}`) : ['- no matching messages']),
      ...(threads.length > 0 ? ['- thread highlights:'] : []),
      ...threads.slice(0, 4).map((thread) => `- ${formatThreadLine(thread.subject, thread.messageCount, thread.participants, thread.latestSnippet)}`),
    ],
    metadata: {
      source: 'gmail',
      connectedAccount: params.connectedAccount,
      messageCount: messages.length,
      unreadCount,
      messages: messages.slice(0, 8).map((message) => ({
        from: message.from,
        subject: message.subject,
        snippet: message.snippet,
        unread: message.unread,
      } satisfies GmailMessageMetadata)),
    },
  } satisfies SourceContextBlock
}

async function buildCalendarContext(params: {
  request: ConnectedContextRequest
  accessToken: string
}) {
  const { start, end } = buildTimeRange(params.request.timeframe)
  const events = await listGoogleCalendarEvents(params.accessToken, {
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    maxResults: params.request.timeframe === 'week' ? 20 : 12,
    query: params.request.searchQuery || undefined,
  })
  const availability = params.request.asksForAvailability
    ? computeCalendarAvailability(events, {
        rangeStart: start.toISOString(),
        rangeEnd: end.toISOString(),
      }).slice(0, 8)
    : []

  return {
    source: 'calendar',
    lines: [
      `Google Calendar`,
      `- events loaded: ${events.length}`,
      ...(events.length > 0 ? events.slice(0, 8).map((event) => `- ${formatEventLine(event)}`) : ['- no matching events']),
      ...(availability.length > 0 ? ['- availability windows:'] : []),
      ...availability.map((window) => `- ${formatAvailabilityLine(window)}`),
    ],
    metadata: {
      source: 'calendar',
      eventCount: events.length,
      availabilityCount: availability.length,
      events: events.slice(0, 8).map((event) => ({
        title: event.title,
        startTime: event.startTime,
        endTime: event.endTime,
        attendees: event.attendees,
        location: event.location,
        meetLink: event.meetLink,
        status: event.status,
      } satisfies CalendarEventMetadata)),
      availability: availability.slice(0, 8).map((window) => ({
        startTime: window.startTime,
        endTime: window.endTime,
      } satisfies AvailabilityWindowMetadata)),
    },
  } satisfies SourceContextBlock
}

async function buildDriveContext(params: {
  request: ConnectedContextRequest
  accessToken: string
  connectedAccount: string | null
}) {
  const files = await searchGoogleDriveFiles(params.accessToken, {
    query: params.request.searchQuery || undefined,
    maxResults: 10,
  })

  return {
    source: 'google_drive',
    lines: [
      `Google Drive${params.connectedAccount ? ` (${params.connectedAccount})` : ''}`,
      `- files loaded: ${files.length}`,
      ...(files.length > 0 ? files.slice(0, 8).map((file) => `- ${formatDriveFileLine(file)}`) : ['- no matching files']),
    ],
    metadata: {
      source: 'google_drive',
      connectedAccount: params.connectedAccount,
      fileCount: files.length,
      files: files.slice(0, 8).map((file) => ({
        name: file.name,
        mimeType: file.mimeType,
        modifiedTime: file.modifiedTime,
        owners: file.owners,
        webViewLink: file.webViewLink,
      } satisfies DriveFileMetadata)),
    },
  } satisfies SourceContextBlock
}

async function buildDocsContext(params: {
  request: ConnectedContextRequest
  accessToken: string
  connectedAccount: string | null
}) {
  const docs = await listRecentGoogleDocs(params.accessToken, {
    query: params.request.searchQuery || undefined,
    maxResults: 8,
  })

  return {
    source: 'google_docs' as const,
    lines: [
      `Google Docs${params.connectedAccount ? ` (${params.connectedAccount})` : ''}`,
      `- documents loaded: ${docs.length}`,
      ...(docs.length > 0 ? docs.map((doc) => `- ${formatGoogleDocLine(doc)}`) : ['- no matching documents']),
    ],
    metadata: {
      source: 'google_docs',
      connectedAccount: params.connectedAccount,
      docCount: docs.length,
      docs: docs.map((doc) => ({
        title: doc.title,
        modifiedTime: doc.modifiedTime,
        preview: doc.preview,
        webViewLink: doc.webViewLink,
      } satisfies GoogleDocMetadata)),
    },
  } satisfies SourceContextBlock
}

async function buildNotionContext(params: {
  request: ConnectedContextRequest
  accessToken: string
  connectedAccount: string | null
  workspaceName: string | null
}) {
  const pages = await searchNotionPages(params.accessToken, {
    query: params.request.searchQuery || undefined,
    maxResults: 6,
  })
  const enrichedPages = await Promise.all(
    pages.slice(0, 4).map(async (page) => ({
      ...page,
      preview: await readNotionPagePreview(params.accessToken, page.id, { maxBlocks: 4 }).catch(() => ''),
    }))
  )

  return {
    source: 'notion',
    lines: [
      `Notion${params.workspaceName ? ` (${params.workspaceName})` : ''}${params.connectedAccount ? ` / ${params.connectedAccount}` : ''}`,
      `- pages loaded: ${pages.length}`,
      ...(enrichedPages.length > 0 ? enrichedPages.map((page) => `- ${formatNotionPageLine(page)}`) : ['- no matching pages']),
    ],
    metadata: {
      source: 'notion',
      connectedAccount: params.connectedAccount,
      workspaceName: params.workspaceName,
      pageCount: pages.length,
      pages: enrichedPages.map((page) => ({
        title: page.title,
        lastEditedTime: page.lastEditedTime,
        preview: page.preview,
        url: page.url,
      } satisfies NotionPageMetadata)),
    },
  } satisfies SourceContextBlock
}

async function resolveSourceContext(params: {
  source: ConnectedContextSource
  request: ConnectedContextRequest
  userId: string
  workspaceId: string
}) {
  const integrationType = params.source === 'google_docs' ? 'google_docs' : params.source === 'calendar' ? 'calendar' : params.source
  const integration = await prisma.integration.findFirst({
    where: {
      type: integrationType,
      userId: params.userId,
      workspaceId: params.workspaceId,
      status: 'connected',
    },
  })

  if (!integration) {
    return {
      source: params.source,
      lines: [`${params.source}: not connected`],
      metadata: {
        source: params.source,
        connected: false,
      },
    } satisfies SourceContextBlock
  }

  if (params.source === 'notion') {
    const accessToken = getValidNotionAccessToken(integration)
    return buildNotionContext({
      request: params.request,
      accessToken,
      connectedAccount: getIntegrationConnectedAccount(integration.metadata),
      workspaceName: getIntegrationWorkspaceName(integration.metadata),
    })
  }

  if (
    integrationType === 'gmail' ||
    integrationType === 'calendar' ||
    integrationType === 'google_drive' ||
    integrationType === 'google_docs'
  ) {
    const capabilityState = getGoogleIntegrationCapabilityState(integrationType as 'gmail' | 'calendar' | 'google_drive' | 'google_docs', integration.metadata)
    if (capabilityState.needsReconnect) {
      return {
        source: params.source,
        lines: [`${params.source}: reconnect required`, '- latest permissions are not granted on this Google token'],
        metadata: {
          source: params.source,
          connected: true,
          needsReconnect: true,
          missingScopes: capabilityState.missingScopes,
        },
      } satisfies SourceContextBlock
    }
  }

  const accessToken = await getValidGoogleAccessToken(integration)
  const connectedAccount = getIntegrationConnectedAccount(integration.metadata)

  if (params.source === 'gmail') {
    return buildGmailContext({
      request: params.request,
      accessToken,
      connectedAccount,
    })
  }

  if (params.source === 'calendar') {
    return buildCalendarContext({
      request: params.request,
      accessToken,
    })
  }

  if (params.source === 'google_docs') {
    return buildDocsContext({
      request: params.request,
      accessToken,
      connectedAccount,
    })
  }

  return buildDriveContext({
    request: params.request,
    accessToken,
    connectedAccount,
  })
}

function buildWorkspaceContext(request: ConnectedContextRequest, blocks: SourceContextBlock[]) {
  return [
    'Connected workspace context:',
    `- mode: ${request.mode}`,
    `- timeframe: ${request.timeframe}`,
    `- asks for availability: ${request.asksForAvailability ? 'yes' : 'no'}`,
    `- asks for priorities: ${request.asksForPriorities ? 'yes' : 'no'}`,
    `- search query: ${request.searchQuery || 'none'}`,
    ...blocks.flatMap((block) => block.lines),
    'Instruction: use this live connected-app context first. Answer directly if the request is informational. If the user asks you to execute something, use this context to prepare the right action instead of guessing.',
  ].join('\n')
}

export async function resolveConnectedWorkspaceContext(params: {
  content: string
  userId: string
  workspaceId: string
  contextSeed?: ConnectedContextSeed | null
}) {
  const request = resolveConnectedContextRequest(params.content, params.contextSeed)
  if (!request) {
    return null
  }

  const blocks = await Promise.all(
    request.sources.map((source) =>
      resolveSourceContext({
        source,
        request,
        userId: params.userId,
        workspaceId: params.workspaceId,
      }).catch((error) => ({
        source,
        lines: [`${source}: read failed`, `- error: ${error instanceof Error ? error.message : 'unknown error'}`],
        metadata: {
          source,
          connected: true,
          error: error instanceof Error ? error.message : 'unknown error',
        },
      } satisfies SourceContextBlock))
    )
  )

  return {
    request,
    workspaceContext: buildWorkspaceContext(request, blocks),
    metadata: {
      connectedContextSources: request.sources,
      connectedContextMode: request.mode,
      connectedContextTimeframe: request.timeframe,
      connectedContextSearchQuery: request.searchQuery,
      connectedContextPriorityMode: request.asksForPriorities,
      connectedContextAvailabilityMode: request.asksForAvailability,
      connectedContextSummary: blocks.map((block) => block.metadata),
    },
  } satisfies ConnectedWorkspaceContextResult
}
