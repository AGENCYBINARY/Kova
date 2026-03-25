import { decryptSecret, encryptSecret } from '@/lib/security/crypto'
import type { IntegrationExecutionResult } from '@/lib/integrations/types'
import { prisma } from '@/lib/db/prisma'

const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
]

const GOOGLE_PROVIDER_TYPES = ['gmail', 'calendar', 'google_docs', 'google_drive'] as const
const GOOGLE_READ_TIMEOUT_MS = 8_000
const GOOGLE_WRITE_TIMEOUT_MS = 12_000
const GOOGLE_AUTH_TIMEOUT_MS = 10_000
const GOOGLE_REQUIRED_SCOPES = {
  gmail: [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly',
  ],
  calendar: [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.readonly',
  ],
  google_docs: [
    'https://www.googleapis.com/auth/documents',
  ],
  google_drive: [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/drive.metadata.readonly',
  ],
} as const

async function wait(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function shouldRetryGoogleRequest(status?: number) {
  return status === 429 || (typeof status === 'number' && status >= 500)
}

async function googleFetch(
  url: string,
  init: RequestInit,
  options: {
    timeoutMs: number
    retries?: number
  }
) {
  const retries = options.retries || 0

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs)

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      })

      if (attempt < retries && shouldRetryGoogleRequest(response.status)) {
        await wait(250 * (attempt + 1))
        continue
      }

      return response
    } catch (error) {
      const isAbortError = error instanceof Error && error.name === 'AbortError'
      if (attempt >= retries) {
        throw isAbortError ? new Error('Google request timed out.') : error
      }
      await wait(250 * (attempt + 1))
    } finally {
      clearTimeout(timeout)
    }
  }

  throw new Error('Google request failed.')
}

export interface GoogleIntegrationCapabilityState {
  grantedScopes: string[]
  missingScopes: string[]
  needsReconnect: boolean
}

function getGoogleRedirectUri() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) {
    throw new Error('NEXT_PUBLIC_APP_URL is missing.')
  }

  return `${appUrl}/api/integrations/callback/google`
}

function getGoogleClientConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth credentials are missing.')
  }

  return { clientId, clientSecret }
}

export function buildGoogleOAuthUrl(state: string) {
  const { clientId } = getGoogleClientConfig()
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', getGoogleRedirectUri())
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('scope', GOOGLE_SCOPES.join(' '))
  url.searchParams.set('state', state)
  return url.toString()
}

export async function exchangeGoogleCodeForTokens(code: string) {
  const { clientId, clientSecret } = getGoogleClientConfig()
  const response = await googleFetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: getGoogleRedirectUri(),
      grant_type: 'authorization_code',
    }),
  }, { timeoutMs: GOOGLE_AUTH_TIMEOUT_MS })

  if (!response.ok) {
    throw new Error(`Google token exchange failed: ${response.status}`)
  }

  return response.json() as Promise<{
    access_token: string
    refresh_token?: string
    expires_in: number
    token_type: string
    scope: string
    id_token?: string
  }>
}

async function refreshGoogleAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = getGoogleClientConfig()
  const response = await googleFetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  }, { timeoutMs: GOOGLE_AUTH_TIMEOUT_MS })

  if (!response.ok) {
    throw new Error(`Google token refresh failed: ${response.status}`)
  }

  return response.json() as Promise<{
    access_token: string
    expires_in: number
    token_type: string
    scope: string
  }>
}

export async function fetchGoogleAccountEmail(accessToken: string) {
  const response = await googleFetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  }, { timeoutMs: GOOGLE_READ_TIMEOUT_MS, retries: 1 })

  if (!response.ok) {
    throw new Error(`Google userinfo fetch failed: ${response.status}`)
  }

  const data = await response.json() as { email?: string }
  return data.email || null
}

export async function persistGoogleTokens(params: {
  userId: string
  workspaceId: string
  accessToken: string
  refreshToken?: string
  expiresIn: number
  connectedAccount: string | null
  grantedScopes?: string[]
}) {
  const encryptedAccessToken = encryptSecret(params.accessToken)
  const encryptedRefreshToken = params.refreshToken ? encryptSecret(params.refreshToken) : null
  const expiresAt = new Date(Date.now() + params.expiresIn * 1000)

  await Promise.all(
    GOOGLE_PROVIDER_TYPES.map(async (type) => {
      const result = await prisma.integration.updateMany({
        where: {
          type,
          userId: params.userId,
          workspaceId: params.workspaceId,
        },
        data: {
          accessToken: encryptedAccessToken,
          refreshToken: encryptedRefreshToken,
          expiresAt,
          status: 'connected',
          lastSyncAt: new Date(),
          metadata: {
            connectedAccount: params.connectedAccount,
            provider: 'google',
            grantedScopes: params.grantedScopes || [],
          },
        },
      })

      if (result.count === 0) {
        await prisma.integration.create({
          data: {
            type,
            accessToken: encryptedAccessToken,
            refreshToken: encryptedRefreshToken,
            expiresAt,
            status: 'connected',
            lastSyncAt: new Date(),
            metadata: {
              connectedAccount: params.connectedAccount,
              provider: 'google',
              grantedScopes: params.grantedScopes || [],
            },
            workspaceId: params.workspaceId,
            userId: params.userId,
          },
        })
      }
    })
  )
}

export function getGoogleGrantedScopes(metadata: unknown) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return []
  }

  const grantedScopes = (metadata as Record<string, unknown>).grantedScopes
  if (!Array.isArray(grantedScopes)) {
    return []
  }

  return grantedScopes.filter((scope): scope is string => typeof scope === 'string')
}

export function getGoogleIntegrationCapabilityState(
  provider: typeof GOOGLE_PROVIDER_TYPES[number],
  metadata: unknown
): GoogleIntegrationCapabilityState {
  const grantedScopes = getGoogleGrantedScopes(metadata)
  const requiredScopes = GOOGLE_REQUIRED_SCOPES[provider] || []
  const missingScopes = requiredScopes.filter((scope) => !grantedScopes.includes(scope))

  return {
    grantedScopes,
    missingScopes,
    needsReconnect: missingScopes.length > 0,
  }
}

export async function getValidGoogleAccessToken(integration: {
  id: string
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
}) {
  if (!integration.expiresAt || integration.expiresAt.getTime() > Date.now() + 30_000) {
    const accessToken = decryptSecret(integration.accessToken)
    if (!accessToken) {
      throw new Error('Missing Google access token.')
    }
    return accessToken
  }

  const refreshToken = decryptSecret(integration.refreshToken)
  if (!refreshToken) {
    throw new Error('Missing Google refresh token.')
  }

  const refreshed = await refreshGoogleAccessToken(refreshToken)
  const encryptedAccessToken = encryptSecret(refreshed.access_token)
  const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000)

  await prisma.integration.updateMany({
    where: {
      id: integration.id,
    },
    data: {
      accessToken: encryptedAccessToken,
      expiresAt,
      lastSyncAt: new Date(),
      status: 'connected',
    },
  })

  return refreshed.access_token
}

function toBase64Url(value: string) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function encodeMimeHeader(value: string) {
  const plain = value.trim()
  if (!plain) {
    return ''
  }

  return /[^\x20-\x7E]/.test(plain)
    ? `=?UTF-8?B?${Buffer.from(plain, 'utf8').toString('base64')}?=`
    : plain
}

function extractEmailAddress(value: string) {
  const match = value.match(/<([^>]+)>/)
  if (match?.[1]) {
    return match[1].trim().toLowerCase()
  }

  const directMatch = value.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[A-Za-z]{2,}/)
  return directMatch?.[0]?.trim().toLowerCase() || null
}

function decodeMimeWords(value: string) {
  return value.replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, encoded) =>
    Buffer.from(encoded, 'base64').toString('utf8')
  )
}

function getHeaderValue(headers: Array<{ name?: string; value?: string }>, name: string) {
  const header = headers.find((item) => item.name?.toLowerCase() === name.toLowerCase())
  return decodeMimeWords(header?.value || '')
}

export interface GmailMessageSummary {
  id: string
  threadId: string | null
  from: string
  subject: string
  snippet: string
  internalDate: string | null
  unread: boolean
}

export interface GmailThreadSummary {
  threadId: string
  subject: string
  participants: string[]
  messageCount: number
  latestSnippet: string
}

export interface GoogleCalendarEventSummary {
  id: string
  title: string
  startTime: string | null
  endTime: string | null
  attendees: string[]
  location: string | null
  htmlLink: string | null
  meetLink: string | null
  status: string | null
}

export interface GoogleCalendarAvailabilityWindow {
  startTime: string
  endTime: string
}

export interface GoogleDriveFileSummary {
  id: string
  name: string
  mimeType: string
  modifiedTime: string | null
  owners: string[]
  webViewLink: string | null
}

function getStartOfDay(date = new Date()) {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  return start
}

async function listGmailMessageMetadata(accessToken: string, query: string, maxResults: number) {
  const listResponse = await googleFetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&q=${encodeURIComponent(query)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    { timeoutMs: GOOGLE_READ_TIMEOUT_MS, retries: 1 }
  )

  if (!listResponse.ok) {
    throw new Error(`Gmail inbox read failed: ${listResponse.status}`)
  }

  const listData = await listResponse.json() as {
    messages?: Array<{ id: string; threadId?: string }>
  }

  const detailedMessages = await Promise.all(
    (listData.messages || []).map(async (message) => {
      const detailResponse = await googleFetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
        { timeoutMs: GOOGLE_READ_TIMEOUT_MS, retries: 1 }
      )

      if (!detailResponse.ok) {
        return null
      }

      const detailData = await detailResponse.json() as {
        id: string
        threadId?: string
        internalDate?: string
        snippet?: string
        labelIds?: string[]
        payload?: {
          headers?: Array<{ name?: string; value?: string }>
        }
      }

      const headers = detailData.payload?.headers || []

      return {
        id: detailData.id,
        threadId: detailData.threadId || message.threadId || null,
        from: getHeaderValue(headers, 'From'),
        subject: getHeaderValue(headers, 'Subject'),
        snippet: decodeMimeWords(detailData.snippet || ''),
        internalDate: detailData.internalDate || null,
        unread: Array.isArray(detailData.labelIds) ? detailData.labelIds.includes('UNREAD') : false,
      } satisfies GmailMessageSummary
    })
  )

  return detailedMessages
    .filter((message): message is GmailMessageSummary => message !== null)
    .sort((left, right) => Number(right.internalDate || 0) - Number(left.internalDate || 0))
}

export async function sendGmailMessage(accessToken: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  const recipients = Array.isArray(parameters.to) ? parameters.to.join(', ') : String(parameters.to || '')
  const subject = String(parameters.subject || 'Kova message')
  const body = String(parameters.body || '')
  const mime = [
    `To: ${recipients}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    'MIME-Version: 1.0',
    `Subject: ${encodeMimeHeader(subject)}`,
    '',
    body,
  ].join('\r\n')

  const response = await googleFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      raw: toBase64Url(mime),
    }),
  }, { timeoutMs: GOOGLE_WRITE_TIMEOUT_MS })

  if (!response.ok) {
    throw new Error(`Gmail send failed: ${response.status}`)
  }

  const data = await response.json() as { id: string }
  return {
    details: 'Email sent through Gmail.',
    output: {
      provider: 'gmail',
      messageId: data.id,
      recipients,
      subject,
    },
  }
}

export async function findGoogleContactEmail(accessToken: string, name: string) {
  const queries = [
    `"${name}"`,
    `to:"${name}"`,
    `from:"${name}"`,
  ]

  for (const query of queries) {
    const listResponse = await googleFetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&q=${encodeURIComponent(query)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      { timeoutMs: GOOGLE_READ_TIMEOUT_MS, retries: 1 }
    )

    if (!listResponse.ok) {
      continue
    }

    const listData = await listResponse.json() as {
      messages?: Array<{ id: string }>
    }

    for (const message of listData.messages || []) {
      const detailResponse = await googleFetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
        { timeoutMs: GOOGLE_READ_TIMEOUT_MS, retries: 1 }
      )

      if (!detailResponse.ok) {
        continue
      }

      const detailData = await detailResponse.json() as {
        payload?: {
          headers?: Array<{ name?: string; value?: string }>
        }
      }

      const headers = detailData.payload?.headers || []
      const decodedValues = headers
        .map((header) => decodeMimeWords(header.value || ''))
        .filter(Boolean)

      for (const value of decodedValues) {
        if (!value.toLowerCase().includes(name.toLowerCase())) {
          continue
        }

        const email = extractEmailAddress(value)
        if (email && !email.endsWith('@example.com')) {
          return email
        }
      }
    }
  }

  return null
}

export async function listTodayGmailMessages(
  accessToken: string,
  options: {
    maxResults?: number
  } = {}
) {
  const maxResults = Math.max(1, Math.min(options.maxResults || 12, 25))
  const startOfDay = getStartOfDay()
  return listGmailMessageMetadata(accessToken, `in:inbox after:${Math.floor(startOfDay.getTime() / 1000)}`, maxResults)
}

export async function searchGmailMessages(
  accessToken: string,
  options: {
    query: string
    maxResults?: number
  }
) {
  const maxResults = Math.max(1, Math.min(options.maxResults || 10, 20))
  const query = options.query.trim()
  if (!query) {
    return []
  }

  return listGmailMessageMetadata(accessToken, query, maxResults)
}

export async function summarizeGmailThreads(messages: GmailMessageSummary[]) {
  const byThread = new Map<string, GmailThreadSummary>()

  for (const message of messages) {
    const threadId = message.threadId || message.id
    const existing = byThread.get(threadId)
    const participants = Array.from(new Set([...(existing?.participants || []), message.from].filter(Boolean)))

    byThread.set(threadId, {
      threadId,
      subject: existing?.subject || message.subject || '(sans objet)',
      participants,
      messageCount: (existing?.messageCount || 0) + 1,
      latestSnippet: existing?.latestSnippet || message.snippet,
    })
  }

  return Array.from(byThread.values())
}

export async function listGoogleCalendarEvents(
  accessToken: string,
  options: {
    timeMin: string
    timeMax: string
    maxResults?: number
    query?: string
  }
) {
  const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events')
  url.searchParams.set('singleEvents', 'true')
  url.searchParams.set('orderBy', 'startTime')
  url.searchParams.set('timeMin', options.timeMin)
  url.searchParams.set('timeMax', options.timeMax)
  url.searchParams.set('maxResults', String(Math.max(1, Math.min(options.maxResults || 20, 50))))

  if (options.query?.trim()) {
    url.searchParams.set('q', options.query.trim())
  }

  const response = await googleFetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  }, { timeoutMs: GOOGLE_READ_TIMEOUT_MS, retries: 1 })

  if (!response.ok) {
    throw new Error(`Calendar read failed: ${response.status}`)
  }

  const data = await response.json() as {
    items?: Array<{
      id: string
      summary?: string
      status?: string
      location?: string
      htmlLink?: string
      attendees?: Array<{ email?: string }>
      start?: { dateTime?: string; date?: string }
      end?: { dateTime?: string; date?: string }
      hangoutLink?: string
      conferenceData?: {
        entryPoints?: Array<{ entryPointType?: string; uri?: string }>
      }
    }>
  }

  return (data.items || []).map((item) => ({
    id: item.id,
    title: item.summary || '(untitled event)',
    startTime: item.start?.dateTime || item.start?.date || null,
    endTime: item.end?.dateTime || item.end?.date || null,
    attendees: (item.attendees || []).map((attendee) => attendee.email || '').filter(Boolean),
    location: item.location || null,
    htmlLink: item.htmlLink || null,
    meetLink:
      item.hangoutLink ||
      item.conferenceData?.entryPoints?.find((entryPoint) => entryPoint.entryPointType === 'video')?.uri ||
      null,
    status: item.status || null,
  } satisfies GoogleCalendarEventSummary))
}

export function computeCalendarAvailability(
  events: GoogleCalendarEventSummary[],
  options: {
    rangeStart: string
    rangeEnd: string
  }
) {
  const windows: GoogleCalendarAvailabilityWindow[] = []
  const sortedEvents = events
    .filter((event) => event.startTime && event.endTime)
    .sort((left, right) => new Date(left.startTime || 0).getTime() - new Date(right.startTime || 0).getTime())
  let cursor = new Date(options.rangeStart)
  const rangeEnd = new Date(options.rangeEnd)

  for (const event of sortedEvents) {
    const eventStart = new Date(event.startTime || cursor.toISOString())
    const eventEnd = new Date(event.endTime || eventStart.toISOString())

    if (eventStart > cursor) {
      windows.push({
        startTime: cursor.toISOString(),
        endTime: eventStart.toISOString(),
      })
    }

    if (eventEnd > cursor) {
      cursor = eventEnd
    }
  }

  if (cursor < rangeEnd) {
    windows.push({
      startTime: cursor.toISOString(),
      endTime: rangeEnd.toISOString(),
    })
  }

  return windows.filter((window) => new Date(window.endTime).getTime() > new Date(window.startTime).getTime())
}

function escapeDriveQueryValue(value: string) {
  return value.replace(/'/g, "\\'")
}

export async function searchGoogleDriveFiles(
  accessToken: string,
  options: {
    query?: string
    maxResults?: number
  } = {}
) {
  const url = new URL('https://www.googleapis.com/drive/v3/files')
  const clauses = ["trashed=false"]

  if (options.query?.trim()) {
    const escapedQuery = escapeDriveQueryValue(options.query.trim())
    clauses.push(`(name contains '${escapedQuery}' or fullText contains '${escapedQuery}')`)
  }

  url.searchParams.set('q', clauses.join(' and '))
  url.searchParams.set('orderBy', 'modifiedTime desc')
  url.searchParams.set('pageSize', String(Math.max(1, Math.min(options.maxResults || 12, 30))))
  url.searchParams.set('fields', 'files(id,name,mimeType,modifiedTime,owners(displayName,emailAddress),webViewLink)')

  const response = await googleFetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  }, { timeoutMs: GOOGLE_READ_TIMEOUT_MS, retries: 1 })

  if (!response.ok) {
    throw new Error(`Google Drive read failed: ${response.status}`)
  }

  const data = await response.json() as {
    files?: Array<{
      id: string
      name?: string
      mimeType?: string
      modifiedTime?: string
      webViewLink?: string
      owners?: Array<{ displayName?: string; emailAddress?: string }>
    }>
  }

  return (data.files || []).map((file) => ({
    id: file.id,
    name: file.name || 'Untitled',
    mimeType: file.mimeType || 'application/octet-stream',
    modifiedTime: file.modifiedTime || null,
    owners: (file.owners || []).map((owner) => owner.displayName || owner.emailAddress || '').filter(Boolean),
    webViewLink: file.webViewLink || null,
  } satisfies GoogleDriveFileSummary))
}

export async function replyToGmailMessage(accessToken: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  const threadId = String(parameters.threadId || '')
  const to = Array.isArray(parameters.to) ? parameters.to.join(', ') : String(parameters.to || '')
  const subject = String(parameters.subject || '')
  const body = String(parameters.body || '')

  let inReplyTo = ''
  let references = ''

  if (threadId) {
    const threadResponse = await googleFetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      { timeoutMs: GOOGLE_READ_TIMEOUT_MS, retries: 1 }
    )
    if (threadResponse.ok) {
      const threadData = await threadResponse.json() as {
        messages?: Array<{ payload?: { headers?: Array<{ name?: string; value?: string }> } }>
      }
      const messages = threadData.messages || []
      const lastMessage = messages[messages.length - 1]
      if (lastMessage) {
        const headers = lastMessage.payload?.headers || []
        inReplyTo = getHeaderValue(headers, 'Message-ID')
        const existingRefs = getHeaderValue(headers, 'References')
        references = existingRefs ? `${existingRefs} ${inReplyTo}` : inReplyTo
      }
    }
  }

  const mime = [
    `To: ${to}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    'MIME-Version: 1.0',
    `Subject: ${encodeMimeHeader(subject)}`,
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`] : []),
    ...(references ? [`References: ${references}`] : []),
    '',
    body,
  ].join('\r\n')

  const response = await googleFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      raw: toBase64Url(mime),
      ...(threadId ? { threadId } : {}),
    }),
  }, { timeoutMs: GOOGLE_WRITE_TIMEOUT_MS })

  if (!response.ok) {
    throw new Error(`Gmail reply failed: ${response.status}`)
  }

  const data = await response.json() as { id: string; threadId?: string }
  return {
    details: 'Reply sent via Gmail.',
    output: {
      provider: 'gmail',
      messageId: data.id,
      threadId: data.threadId || threadId,
      to,
      subject,
    },
  }
}

export async function readGmailMessageBody(accessToken: string, messageId: string): Promise<string> {
  const response = await googleFetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    { timeoutMs: GOOGLE_READ_TIMEOUT_MS, retries: 1 }
  )
  if (!response.ok) throw new Error(`Gmail message read failed: ${response.status}`)

  const data = await response.json() as {
    payload?: {
      mimeType?: string
      body?: { data?: string }
      parts?: Array<{
        mimeType?: string
        body?: { data?: string }
        parts?: Array<{ mimeType?: string; body?: { data?: string } }>
      }>
    }
  }

  function extractText(payload: typeof data.payload): string {
    if (!payload) return ''
    if (payload.mimeType === 'text/plain' && payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64').toString('utf-8')
    }
    for (const part of payload.parts || []) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8')
      }
      for (const sub of part.parts || []) {
        if (sub.mimeType === 'text/plain' && sub.body?.data) {
          return Buffer.from(sub.body.data, 'base64').toString('utf-8')
        }
      }
    }
    return ''
  }

  return extractText(data.payload).trim()
}

export async function updateGoogleCalendarEvent(accessToken: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  const eventId = String(parameters.eventId || '')
  if (!eventId) throw new Error('eventId is required to update a calendar event.')

  const body: Record<string, unknown> = {}
  if (parameters.title) body.summary = parameters.title
  if (parameters.description || parameters.notes) body.description = String(parameters.description || parameters.notes || '')
  if (parameters.startTime) body.start = { dateTime: parameters.startTime }
  if (parameters.endTime) body.end = { dateTime: parameters.endTime }
  if (Array.isArray(parameters.attendees) && parameters.attendees.length > 0) {
    body.attendees = parameters.attendees.map((email) => ({ email }))
  }

  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`)
  if (Array.isArray(parameters.attendees) && parameters.attendees.length > 0) {
    url.searchParams.set('sendUpdates', 'all')
  }

  const response = await googleFetch(url.toString(), {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }, { timeoutMs: GOOGLE_WRITE_TIMEOUT_MS })

  if (!response.ok) {
    throw new Error(`Calendar event update failed: ${response.status}`)
  }

  const data = await response.json() as { id: string; htmlLink?: string; summary?: string }
  return {
    details: 'Calendar event updated.',
    output: {
      provider: 'google_calendar',
      eventId: data.id,
      title: data.summary || null,
      link: data.htmlLink || null,
    },
  }
}

export async function deleteGoogleCalendarEvent(accessToken: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  const eventId = String(parameters.eventId || '')
  if (!eventId) throw new Error('eventId is required to delete a calendar event.')

  const response = await googleFetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    { timeoutMs: GOOGLE_WRITE_TIMEOUT_MS }
  )

  if (!response.ok && response.status !== 204) {
    throw new Error(`Calendar event deletion failed: ${response.status}`)
  }

  return {
    details: 'Calendar event deleted.',
    output: { provider: 'google_calendar', eventId, deleted: true },
  }
}

export async function deleteGoogleDriveFile(accessToken: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  const fileId = String(parameters.fileId || '')
  if (!fileId) throw new Error('fileId is required to delete a Drive file.')

  const response = await googleFetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    { timeoutMs: GOOGLE_WRITE_TIMEOUT_MS }
  )

  if (!response.ok && response.status !== 204) {
    throw new Error(`Google Drive file deletion failed: ${response.status}`)
  }

  return {
    details: 'File deleted from Google Drive.',
    output: { provider: 'google_drive', fileId, deleted: true },
  }
}

export async function createGoogleCalendarEvent(accessToken: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  const shouldCreateMeetLink = Boolean(parameters.createMeetLink)
  const hasAttendees = Array.isArray(parameters.attendees) && parameters.attendees.length > 0
  const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events')

  if (shouldCreateMeetLink) {
    url.searchParams.set('conferenceDataVersion', '1')
  }

  if (hasAttendees) {
    url.searchParams.set('sendUpdates', 'all')
  }

  const response = await googleFetch(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      summary: parameters.title || 'Kova event',
      description: parameters.description || parameters.notes || '',
      start: { dateTime: parameters.startTime },
      end: { dateTime: parameters.endTime },
      attendees: Array.isArray(parameters.attendees)
        ? parameters.attendees.map((email) => ({ email }))
        : [],
      ...(shouldCreateMeetLink
        ? {
            conferenceData: {
              createRequest: {
                requestId: `kova-${Date.now()}`,
                conferenceSolutionKey: {
                  type: 'hangoutsMeet',
                },
              },
            },
          }
        : {}),
    }),
  }, { timeoutMs: GOOGLE_WRITE_TIMEOUT_MS })

  if (!response.ok) {
    throw new Error(`Calendar event creation failed: ${response.status}`)
  }

  const data = await response.json() as {
    id: string
    htmlLink?: string
    hangoutLink?: string
    conferenceData?: {
      entryPoints?: Array<{ entryPointType?: string; uri?: string }>
    }
  }

  const meetLink =
    data.hangoutLink ||
    data.conferenceData?.entryPoints?.find((entryPoint) => entryPoint.entryPointType === 'video')?.uri ||
    null

  return {
    details: 'Event created in Google Calendar.',
    output: {
      provider: 'google_calendar',
      eventId: data.id,
      link: data.htmlLink || null,
      meetLink,
      meet_link: meetLink,
    },
  }
}

async function insertTextIntoGoogleDoc(accessToken: string, documentId: string, text: string) {
  const getResponse = await googleFetch(`https://docs.googleapis.com/v1/documents/${documentId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  }, { timeoutMs: GOOGLE_READ_TIMEOUT_MS, retries: 1 })

  if (!getResponse.ok) {
    throw new Error(`Google Docs read failed: ${getResponse.status}`)
  }

  const document = await getResponse.json() as { body?: { content?: Array<{ endIndex?: number }> } }
  const endIndex = document.body?.content?.[document.body.content.length - 1]?.endIndex || 1

  const updateResponse = await googleFetch(`https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [
        {
          insertText: {
            location: { index: Math.max(1, endIndex - 1) },
            text,
          },
        },
      ],
    }),
  }, { timeoutMs: GOOGLE_WRITE_TIMEOUT_MS })

  if (!updateResponse.ok) {
    throw new Error(`Google Docs write failed: ${updateResponse.status}`)
  }
}

export interface GoogleDocSummary {
  id: string
  title: string
  modifiedTime: string | null
  webViewLink: string | null
  preview: string
}

export async function readGoogleDocContent(accessToken: string, documentId: string): Promise<string> {
  const response = await googleFetch(`https://docs.googleapis.com/v1/documents/${documentId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  }, { timeoutMs: GOOGLE_READ_TIMEOUT_MS, retries: 1 })

  if (!response.ok) {
    throw new Error(`Google Docs read failed: ${response.status}`)
  }

  const doc = await response.json() as {
    title?: string
    body?: {
      content?: Array<{
        paragraph?: {
          elements?: Array<{
            textRun?: { content?: string }
          }>
        }
        table?: {
          tableRows?: Array<{
            tableCells?: Array<{
              content?: Array<{
                paragraph?: {
                  elements?: Array<{ textRun?: { content?: string } }>
                }
              }>
            }>
          }>
        }
      }>
    }
  }

  const lines: string[] = []
  for (const block of doc.body?.content || []) {
    if (block.paragraph) {
      const text = (block.paragraph.elements || [])
        .map((el) => el.textRun?.content || '')
        .join('')
        .trimEnd()
      if (text) lines.push(text)
    } else if (block.table) {
      for (const row of block.table.tableRows || []) {
        const cells = (row.tableCells || []).map((cell) =>
          (cell.content || [])
            .flatMap((p) => (p.paragraph?.elements || []).map((el) => el.textRun?.content || ''))
            .join('')
            .trim()
        )
        if (cells.some(Boolean)) lines.push(cells.join(' | '))
      }
    }
  }

  return lines.join('\n').trim()
}

export async function listRecentGoogleDocs(
  accessToken: string,
  options: { query?: string; maxResults?: number } = {}
): Promise<GoogleDocSummary[]> {
  const url = new URL('https://www.googleapis.com/drive/v3/files')
  const clauses = [
    "trashed=false",
    "mimeType='application/vnd.google-apps.document'",
  ]

  if (options.query?.trim()) {
    const escaped = escapeDriveQueryValue(options.query.trim())
    clauses.push(`(name contains '${escaped}' or fullText contains '${escaped}')`)
  }

  url.searchParams.set('q', clauses.join(' and '))
  url.searchParams.set('orderBy', 'modifiedTime desc')
  url.searchParams.set('pageSize', String(Math.max(1, Math.min(options.maxResults || 8, 20))))
  url.searchParams.set('fields', 'files(id,name,modifiedTime,webViewLink)')

  const response = await googleFetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  }, { timeoutMs: GOOGLE_READ_TIMEOUT_MS, retries: 1 })

  if (!response.ok) {
    throw new Error(`Google Drive Docs list failed: ${response.status}`)
  }

  const data = await response.json() as {
    files?: Array<{
      id: string
      name?: string
      modifiedTime?: string
      webViewLink?: string
    }>
  }

  const files = data.files || []

  const enriched = await Promise.all(
    files.slice(0, 4).map(async (file) => {
      let preview = ''
      try {
        const content = await readGoogleDocContent(accessToken, file.id)
        preview = content.slice(0, 300).replace(/\n+/g, ' ').trim()
      } catch {
        preview = ''
      }
      return {
        id: file.id,
        title: file.name || 'Untitled',
        modifiedTime: file.modifiedTime || null,
        webViewLink: file.webViewLink || null,
        preview,
      } satisfies GoogleDocSummary
    })
  )

  const rest = files.slice(4).map((file) => ({
    id: file.id,
    title: file.name || 'Untitled',
    modifiedTime: file.modifiedTime || null,
    webViewLink: file.webViewLink || null,
    preview: '',
  } satisfies GoogleDocSummary))

  return [...enriched, ...rest]
}

export async function createGoogleDoc(accessToken: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  const response = await googleFetch('https://docs.googleapis.com/v1/documents', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: parameters.title || 'Kova document',
    }),
  }, { timeoutMs: GOOGLE_WRITE_TIMEOUT_MS })

  if (!response.ok) {
    throw new Error(`Google Docs create failed: ${response.status}`)
  }

  const document = await response.json() as { documentId: string; title: string }
  const sections = Array.isArray(parameters.sections) ? parameters.sections : []
  const sourcePrompt = typeof parameters.sourcePrompt === 'string' ? parameters.sourcePrompt : ''
  const text = `${sections.map((section) => `${section}\n`).join('\n')}\n${sourcePrompt}\n`
  await insertTextIntoGoogleDoc(accessToken, document.documentId, text)

  return {
    details: 'Document created in Google Docs.',
    output: {
      provider: 'google_docs',
      documentId: document.documentId,
      title: document.title,
    },
  }
}

export async function updateGoogleDoc(accessToken: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  const documentId = String(parameters.documentId || '')
  if (!documentId) {
    throw new Error('documentId is required to update a Google Doc.')
  }

  const text = typeof parameters.content === 'string' ? parameters.content : JSON.stringify(parameters.content || '', null, 2)
  await insertTextIntoGoogleDoc(accessToken, documentId, `\n${text}\n`)

  return {
    details: 'Document updated in Google Docs.',
    output: {
      provider: 'google_docs',
      documentId,
    },
  }
}

async function ensureDriveFolder(accessToken: string, folderName: string) {
  const query = `mimeType='application/vnd.google-apps.folder' and trashed=false and name='${folderName.replace(/'/g, "\\'")}'`
  const lookupResponse = await googleFetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=10`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    { timeoutMs: GOOGLE_READ_TIMEOUT_MS, retries: 1 }
  )

  if (lookupResponse.ok) {
    const lookupData = await lookupResponse.json() as { files?: Array<{ id: string; name: string }> }
    const existingFolder = lookupData.files?.find((file) => file.name === folderName)
    if (existingFolder) {
      return existingFolder.id
    }
  }

  const createResponse = await googleFetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  }, { timeoutMs: GOOGLE_WRITE_TIMEOUT_MS })

  if (!createResponse.ok) {
    throw new Error(`Google Drive folder creation failed: ${createResponse.status}`)
  }

  const folder = await createResponse.json() as { id: string }
  return folder.id
}

export async function createGoogleDriveFile(accessToken: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  const name = String(parameters.name || 'Kova file')
  const mimeType = String(parameters.mimeType || 'text/plain')
  const content = typeof parameters.content === 'string' ? parameters.content : ''
  const folderName = typeof parameters.folderName === 'string' ? parameters.folderName.trim() : ''
  const parentFolderId = folderName ? await ensureDriveFolder(accessToken, folderName) : null

  const metadata = {
    name,
    mimeType,
    ...(parentFolderId ? { parents: [parentFolderId] } : {}),
  }

  const isFolder = mimeType === 'application/vnd.google-apps.folder'

  const response = await googleFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink,parents,mimeType', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'multipart/related; boundary=kova_drive_boundary',
    },
    body: isFolder
      ? [
          '--kova_drive_boundary',
          'Content-Type: application/json; charset=UTF-8',
          '',
          JSON.stringify(metadata),
          '--kova_drive_boundary--',
        ].join('\r\n')
      : [
          '--kova_drive_boundary',
          'Content-Type: application/json; charset=UTF-8',
          '',
          JSON.stringify(metadata),
          '--kova_drive_boundary',
          `Content-Type: ${mimeType}`,
          '',
          content,
          '--kova_drive_boundary--',
        ].join('\r\n'),
  }, { timeoutMs: GOOGLE_WRITE_TIMEOUT_MS })

  if (!response.ok) {
    throw new Error(`Google Drive file creation failed: ${response.status}`)
  }

  const data = await response.json() as {
    id: string
    name: string
    webViewLink?: string
    webContentLink?: string
    mimeType?: string
    parents?: string[]
  }

  return {
    details: isFolder ? 'Folder created in Google Drive.' : 'File created in Google Drive.',
    output: {
      provider: 'google_drive',
      fileId: data.id,
      name: data.name,
      mimeType: data.mimeType || mimeType,
      folderId: parentFolderId,
      folderName: folderName || null,
      link: data.webViewLink || data.webContentLink || null,
    },
  }
}
