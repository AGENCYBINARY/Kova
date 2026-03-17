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
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive.file',
]

const GOOGLE_PROVIDER_TYPES = ['gmail', 'calendar', 'google_docs'] as const

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
  const response = await fetch('https://oauth2.googleapis.com/token', {
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
  })

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
  const response = await fetch('https://oauth2.googleapis.com/token', {
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
  })

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
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

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
}) {
  const encryptedAccessToken = encryptSecret(params.accessToken)
  const encryptedRefreshToken = params.refreshToken ? encryptSecret(params.refreshToken) : null
  const expiresAt = new Date(Date.now() + params.expiresIn * 1000)

  await Promise.all(
    GOOGLE_PROVIDER_TYPES.map((type) =>
      prisma.integration.updateMany({
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
          },
        },
      })
    )
  )
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

  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      raw: toBase64Url(mime),
    }),
  })

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
    const listResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&q=${encodeURIComponent(query)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )

    if (!listResponse.ok) {
      continue
    }

    const listData = await listResponse.json() as {
      messages?: Array<{ id: string }>
    }

    for (const message of listData.messages || []) {
      const detailResponse = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
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

  const response = await fetch(url.toString(), {
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
  })

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
  const getResponse = await fetch(`https://docs.googleapis.com/v1/documents/${documentId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!getResponse.ok) {
    throw new Error(`Google Docs read failed: ${getResponse.status}`)
  }

  const document = await getResponse.json() as { body?: { content?: Array<{ endIndex?: number }> } }
  const endIndex = document.body?.content?.[document.body.content.length - 1]?.endIndex || 1

  const updateResponse = await fetch(`https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`, {
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
  })

  if (!updateResponse.ok) {
    throw new Error(`Google Docs write failed: ${updateResponse.status}`)
  }
}

export async function createGoogleDoc(accessToken: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  const response = await fetch('https://docs.googleapis.com/v1/documents', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: parameters.title || 'Kova document',
    }),
  })

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
