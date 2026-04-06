import type { IntegrationExecutionResult } from '@/lib/integrations/types'
import {
  googleFetch,
  GOOGLE_READ_TIMEOUT_MS,
  GOOGLE_WRITE_TIMEOUT_MS,
} from '@/lib/integrations/google-http'

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

function buildPlainTextMimeMessage(params: {
  to?: string
  cc?: string
  bcc?: string
  subject?: string
  body?: string
  headers?: string[]
}) {
  return [
    ...(params.to ? [`To: ${params.to}`] : []),
    ...(params.cc ? [`Cc: ${params.cc}`] : []),
    ...(params.bcc ? [`Bcc: ${params.bcc}`] : []),
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    'MIME-Version: 1.0',
    `Subject: ${encodeMimeHeader(params.subject || '')}`,
    ...(params.headers || []),
    '',
    params.body || '',
  ].join('\r\n')
}

function getEmailList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.includes('@'))
    : []
}

function getEmailHeader(value: unknown) {
  return getEmailList(value).join(', ')
}

function extractEmailAddress(value: string) {
  const match = value.match(/<([^>]+)>/)
  if (match?.[1]) {
    return match[1].trim().toLowerCase()
  }

  const directMatch = value.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[A-Za-z]{2,}/)
  return directMatch?.[0]?.trim().toLowerCase() || null
}

/** All addresses in a From/To/Cc header (comma-separated). */
function extractAllEmailAddressesFromHeader(value: string): string[] {
  const parts = value.split(',').map((p) => p.trim()).filter(Boolean)
  const out: string[] = []
  for (const part of parts) {
    const email = extractEmailAddress(part)
    if (email && !email.endsWith('@example.com')) out.push(email)
  }
  return out
}

function decodeMimeWords(value: string) {
  return value.replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, encoded) =>
    Buffer.from(encoded, 'base64').toString('utf8')
  )
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  return Buffer.from(padded, 'base64').toString('utf8')
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
  labelIds: string[]
}

export interface GmailThreadSummary {
  threadId: string
  subject: string
  participants: string[]
  messageCount: number
  latestSnippet: string
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
        labelIds: Array.isArray(detailData.labelIds) ? detailData.labelIds : [],
      } satisfies GmailMessageSummary
    })
  )

  return detailedMessages
    .filter((message): message is GmailMessageSummary => message !== null)
    .sort((left, right) => Number(right.internalDate || 0) - Number(left.internalDate || 0))
}

export async function sendGmailMessage(accessToken: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  const recipients = getEmailHeader(parameters.to) || String(parameters.to || '')
  const cc = getEmailHeader(parameters.cc)
  const bcc = getEmailHeader(parameters.bcc)
  const subject = String(parameters.subject || 'Kova message')
  const body = String(parameters.body || '')
  const mime = buildPlainTextMimeMessage({
    to: recipients,
    cc,
    bcc,
    subject,
    body,
  })

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
      cc: cc || null,
      bcc: bcc || null,
      subject,
    },
  }
}

async function fetchGmailThreadMessageIds(accessToken: string, threadId: string) {
  const response = await googleFetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=metadata&metadataHeaders=Subject`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    { timeoutMs: GOOGLE_READ_TIMEOUT_MS, retries: 1 }
  )

  if (!response.ok) {
    throw new Error(`Gmail thread read failed: ${response.status}`)
  }

  const data = await response.json() as {
    messages?: Array<{
      id?: string
      payload?: {
        headers?: Array<{ name?: string; value?: string }>
      }
    }>
  }

  return (data.messages || []).map((message) => ({
    id: message.id || '',
    subject: getHeaderValue(message.payload?.headers || [], 'Subject'),
  })).filter((message) => message.id)
}

async function fetchGmailMessageSubject(accessToken: string, messageId: string) {
  const response = await googleFetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=metadata&metadataHeaders=Subject`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    { timeoutMs: GOOGLE_READ_TIMEOUT_MS, retries: 1 }
  )

  if (!response.ok) {
    throw new Error(`Gmail metadata read failed: ${response.status}`)
  }

  const data = await response.json() as {
    threadId?: string
    payload?: {
      headers?: Array<{ name?: string; value?: string }>
    }
  }

  return {
    threadId: data.threadId || null,
    subject: getHeaderValue(data.payload?.headers || [], 'Subject'),
  }
}

async function modifyGmailThreadLabels(accessToken: string, threadId: string, payload: {
  addLabelIds?: string[]
  removeLabelIds?: string[]
}) {
  const response = await googleFetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}/modify`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
    { timeoutMs: GOOGLE_WRITE_TIMEOUT_MS }
  )

  if (!response.ok) {
    throw new Error(`Gmail thread modify failed: ${response.status}`)
  }
}

async function listGmailLabels(accessToken: string) {
  const response = await googleFetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/labels',
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    { timeoutMs: GOOGLE_READ_TIMEOUT_MS, retries: 1 }
  )

  if (!response.ok) {
    throw new Error(`Gmail labels read failed: ${response.status}`)
  }

  const data = await response.json() as {
    labels?: Array<{ id?: string; name?: string; type?: string }>
  }

  return (data.labels || []).map((label) => ({
    id: label.id || '',
    name: label.name || '',
    type: label.type || '',
  })).filter((label) => label.id && label.name)
}

async function ensureGmailLabels(accessToken: string, labelNames: string[]) {
  const existingLabels = await listGmailLabels(accessToken)
  const labelIds: string[] = []

  for (const rawLabelName of labelNames) {
    const labelName = rawLabelName.trim()
    if (!labelName) continue
    const existing = existingLabels.find((label) => label.name.toLowerCase() === labelName.toLowerCase())
    if (existing) {
      labelIds.push(existing.id)
      continue
    }

    const createResponse = await googleFetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/labels',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: labelName,
          labelListVisibility: 'labelShow',
          messageListVisibility: 'show',
        }),
      },
      { timeoutMs: GOOGLE_WRITE_TIMEOUT_MS }
    )

    if (!createResponse.ok) {
      throw new Error(`Gmail label creation failed: ${createResponse.status}`)
    }

    const created = await createResponse.json() as { id?: string }
    if (created.id) {
      labelIds.push(created.id)
    }
  }

  return labelIds
}

export async function findGoogleContactEmail(accessToken: string, name: string) {
  const normalizedName = name.toLowerCase()
  const nameTokens = normalizedName
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)

  const sentQueries: string[] = [
    `in:sent to:"${name}"`,
    `in:sent "${name}"`,
  ]
  for (const token of nameTokens.filter((t) => t.length >= 4)) {
    sentQueries.push(`in:sent to:${token}`)
  }

  const generalQueries: string[] = [
    `"${name}"`,
    `to:"${name}"`,
    `from:"${name}"`,
    ...(nameTokens.length <= 2
      ? nameTokens
          .filter((token) => token.length >= 4)
          .flatMap((token) => [`from:"${token}"`, `to:"${token}"`])
      : []),
  ]

  const queries = Array.from(new Set([...sentQueries, ...generalQueries]))
  const candidateScores = new Map<string, number>()
  const inspectedMessageIds = new Set<string>()
  let inspectedCount = 0
  const maxInspect = 18

  for (const query of queries) {
    const listResponse = await googleFetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=15&q=${encodeURIComponent(query)}`,
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

    const queryIsSent = query.toLowerCase().includes('in:sent')

    for (const message of listData.messages || []) {
      if (inspectedCount >= maxInspect) {
        break
      }
      if (inspectedMessageIds.has(message.id)) {
        continue
      }
      inspectedMessageIds.add(message.id)
      inspectedCount += 1

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

      const scoreHeaderBlock = (headerName: 'from' | 'to' | 'cc', rawValue: string) => {
        const decoded = decodeMimeWords(rawValue)
        if (!decoded) return

        const isRecipientField = headerName === 'to' || headerName === 'cc'
        const emails = extractAllEmailAddressesFromHeader(decoded)
        const normalizedValue = decoded.toLowerCase()

        for (const email of emails) {
          let score = 0

          if (normalizedValue.includes(normalizedName)) {
            score += 6
          }

          for (const token of nameTokens) {
            if (normalizedValue.includes(token)) {
              score += 2
            }
          }

          const local = email.split('@')[0]?.toLowerCase() || ''
          if (score === 0 && local && normalizedName.includes(local)) {
            score += 2
          }
          if (score === 0 && nameTokens.some((t) => local.includes(t) || t.includes(local))) {
            score += 1
          }

          if (queryIsSent && isRecipientField && score > 0) {
            score += 5
          }

          if (queryIsSent && isRecipientField && normalizedValue.includes(normalizedName)) {
            score += 3
          }

          if (score > 0) {
            candidateScores.set(email, (candidateScores.get(email) || 0) + score)
          }
        }
      }

      for (const header of headers) {
        const hn = (header.name || '').toLowerCase()
        if (hn === 'from' || hn === 'to' || hn === 'cc') {
          scoreHeaderBlock(hn, header.value || '')
        }
      }
    }

    if (inspectedCount >= maxInspect) {
      break
    }
  }

  const ranked = Array.from(candidateScores.entries()).sort((left, right) => right[1] - left[1])
  if (!ranked[0] || ranked[0][1] < 4) {
    return null
  }

  if (ranked[1] && ranked[0][1] - ranked[1][1] < 1) {
    return null
  }

  return ranked[0][0]
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

export async function archiveGmailThread(accessToken: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  const threadId = String(parameters.threadId || '')
  if (!threadId) {
    throw new Error('threadId is required to archive a Gmail thread.')
  }

  await modifyGmailThreadLabels(accessToken, threadId, {
    removeLabelIds: ['INBOX'],
  })

  return {
    details: 'Gmail thread archived.',
    output: {
      provider: 'gmail',
      threadId,
      archived: true,
    },
  }
}

export async function unarchiveGmailThread(accessToken: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  const threadId = String(parameters.threadId || '')
  if (!threadId) {
    throw new Error('threadId is required to unarchive a Gmail thread.')
  }

  await modifyGmailThreadLabels(accessToken, threadId, {
    addLabelIds: ['INBOX'],
  })

  return {
    details: 'Gmail thread restored to inbox.',
    output: {
      provider: 'gmail',
      threadId,
      archived: false,
    },
  }
}

export async function setGmailThreadStarredState(
  accessToken: string,
  parameters: Record<string, unknown>,
  options: { starred: boolean }
): Promise<IntegrationExecutionResult> {
  const threadId = String(parameters.threadId || '')
  if (!threadId) {
    throw new Error('threadId is required to update a Gmail thread star state.')
  }

  await modifyGmailThreadLabels(accessToken, threadId, options.starred
    ? { addLabelIds: ['STARRED'] }
    : { removeLabelIds: ['STARRED'] })

  return {
    details: options.starred ? 'Gmail thread starred.' : 'Gmail thread unstarred.',
    output: {
      provider: 'gmail',
      threadId,
      starred: options.starred,
    },
  }
}

export async function trashGmailThread(accessToken: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  const threadId = String(parameters.threadId || '')
  if (!threadId) {
    throw new Error('threadId is required to trash a Gmail thread.')
  }

  const response = await googleFetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}/trash`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    { timeoutMs: GOOGLE_WRITE_TIMEOUT_MS }
  )

  if (!response.ok) {
    throw new Error(`Gmail thread trash failed: ${response.status}`)
  }

  return {
    details: 'Gmail thread moved to trash.',
    output: {
      provider: 'gmail',
      threadId,
      trashed: true,
    },
  }
}

export async function deleteGmailThreadPermanently(accessToken: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  const threadId = String(parameters.threadId || '')
  if (!threadId) {
    throw new Error('threadId is required to permanently delete a Gmail thread.')
  }

  const response = await googleFetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    { timeoutMs: GOOGLE_WRITE_TIMEOUT_MS }
  )

  if (!response.ok && response.status !== 204) {
    throw new Error(`Gmail thread permanent deletion failed: ${response.status}`)
  }

  return {
    details: 'Gmail thread permanently deleted.',
    output: {
      provider: 'gmail',
      threadId,
      deleted: true,
    },
  }
}

export async function labelGmailThread(accessToken: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  const threadId = String(parameters.threadId || '')
  const labelNames = Array.isArray(parameters.labelNames)
    ? parameters.labelNames.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []

  if (!threadId) {
    throw new Error('threadId is required to label a Gmail thread.')
  }

  if (labelNames.length === 0) {
    throw new Error('labelNames is required to label a Gmail thread.')
  }

  const labelIds = await ensureGmailLabels(accessToken, labelNames)
  await modifyGmailThreadLabels(accessToken, threadId, {
    addLabelIds: labelIds,
  })

  return {
    details: 'Gmail thread labelled.',
    output: {
      provider: 'gmail',
      threadId,
      labels: labelNames,
    },
  }
}

export async function removeGmailThreadLabels(accessToken: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  const threadId = String(parameters.threadId || '')
  const labelNames = Array.isArray(parameters.labelNames)
    ? parameters.labelNames.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : []

  if (!threadId) {
    throw new Error('threadId is required to remove labels from a Gmail thread.')
  }

  if (labelNames.length === 0) {
    throw new Error('labelNames is required to remove labels from a Gmail thread.')
  }

  const existingLabels = await listGmailLabels(accessToken)
  const labelIds = labelNames
    .map((labelName) => existingLabels.find((label) => label.name.toLowerCase() === labelName.toLowerCase())?.id || null)
    .filter((value): value is string => Boolean(value))

  if (labelIds.length === 0) {
    throw new Error('No matching Gmail labels were found.')
  }

  await modifyGmailThreadLabels(accessToken, threadId, {
    removeLabelIds: labelIds,
  })

  return {
    details: 'Labels removed from Gmail thread.',
    output: {
      provider: 'gmail',
      threadId,
      removedLabels: labelNames,
    },
  }
}

export async function setGmailThreadReadState(
  accessToken: string,
  parameters: Record<string, unknown>,
  options: { unread: boolean }
): Promise<IntegrationExecutionResult> {
  const threadId = String(parameters.threadId || '')
  if (!threadId) {
    throw new Error('threadId is required to update a Gmail thread read state.')
  }

  await modifyGmailThreadLabels(accessToken, threadId, options.unread
    ? { addLabelIds: ['UNREAD'] }
    : { removeLabelIds: ['UNREAD'] })

  return {
    details: options.unread ? 'Gmail thread marked as unread.' : 'Gmail thread marked as read.',
    output: {
      provider: 'gmail',
      threadId,
      unread: options.unread,
    },
  }
}

export async function forwardGmailMessage(accessToken: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  let messageId = String(parameters.messageId || '')
  let subject = ''

  if (!messageId && typeof parameters.threadId === 'string' && parameters.threadId.trim()) {
    const threadMessages = await fetchGmailThreadMessageIds(accessToken, parameters.threadId.trim())
    messageId = threadMessages[threadMessages.length - 1]?.id || ''
    subject = threadMessages[threadMessages.length - 1]?.subject || ''
  }

  if (!messageId) {
    throw new Error('messageId is required to forward an email.')
  }

  if (!subject) {
    const metadata = await fetchGmailMessageSubject(accessToken, messageId)
    subject = metadata.subject
  }

  const originalBody = await readGmailMessageBody(accessToken, messageId)
  const recipients = Array.isArray(parameters.to)
    ? parameters.to.filter((value): value is string => typeof value === 'string' && value.includes('@'))
    : []
  const note = typeof parameters.note === 'string' ? parameters.note.trim() : ''

  if (recipients.length === 0) {
    throw new Error('to is required to forward an email.')
  }

  const body = [
    ...(note ? [note, ''] : []),
    '---------- Forwarded message ----------',
    '',
    originalBody,
  ].join('\n')

  return sendGmailMessage(accessToken, {
    to: recipients,
    subject: subject.toLowerCase().startsWith('fwd:') ? subject : `Fwd: ${subject || 'Message'}`,
    body,
  })
}

export async function createGmailDraft(accessToken: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  const to = getEmailHeader(parameters.to) || String(parameters.to || '')
  const cc = getEmailHeader(parameters.cc)
  const bcc = getEmailHeader(parameters.bcc)
  const subject = String(parameters.subject || 'Kova draft')
  const body = String(parameters.body || '')

  const mime = buildPlainTextMimeMessage({
    to,
    cc,
    bcc,
    subject,
    body,
  })

  const response = await googleFetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        raw: toBase64Url(mime),
      },
    }),
  }, { timeoutMs: GOOGLE_WRITE_TIMEOUT_MS })

  if (!response.ok) {
    throw new Error(`Gmail draft creation failed: ${response.status}`)
  }

  const data = await response.json() as {
    id?: string
    message?: { id?: string }
  }

  return {
    details: 'Draft created in Gmail.',
    output: {
      provider: 'gmail',
      draftId: data.id || null,
      messageId: data.message?.id || null,
      recipients: to,
      cc: cc || null,
      bcc: bcc || null,
      subject,
    },
  }
}

export async function updateGmailDraft(accessToken: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  const draftId = String(parameters.draftId || '')

  if (!draftId) {
    throw new Error('draftId is required to update a Gmail draft.')
  }

  const existingResponse = await googleFetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${draftId}?format=full`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    { timeoutMs: GOOGLE_READ_TIMEOUT_MS, retries: 1 }
  )

  if (!existingResponse.ok) {
    throw new Error(`Gmail draft read failed: ${existingResponse.status}`)
  }

  const existingData = await existingResponse.json() as {
    message?: {
      payload?: {
        headers?: Array<{ name?: string; value?: string }>
        mimeType?: string
        body?: { data?: string }
        parts?: Array<{
          mimeType?: string
          body?: { data?: string }
          parts?: Array<{ mimeType?: string; body?: { data?: string } }>
        }>
      }
    }
  }

  type GmailPayload = {
    headers?: Array<{ name?: string; value?: string }>
    mimeType?: string
    body?: { data?: string }
    parts?: Array<{
      mimeType?: string
      body?: { data?: string }
      parts?: Array<{ mimeType?: string; body?: { data?: string } }>
    }>
  }

  const existingHeaders = existingData.message?.payload?.headers || []
  const extractPayloadText = (payload?: GmailPayload): string => {
    if (!payload) return ''
    if (payload.mimeType === 'text/plain' && payload.body?.data) {
      return decodeBase64Url(payload.body.data).trim()
    }

    for (const part of payload.parts || []) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBase64Url(part.body.data).trim()
      }

      for (const sub of part.parts || []) {
        if (sub.mimeType === 'text/plain' && sub.body?.data) {
          return decodeBase64Url(sub.body.data).trim()
        }
      }
    }

    return ''
  }

  const to =
    (Array.isArray(parameters.to) ? parameters.to.join(', ') : String(parameters.to || '')).trim()
    || getHeaderValue(existingHeaders, 'To')
  const cc =
    getEmailHeader(parameters.cc).trim()
    || getHeaderValue(existingHeaders, 'Cc')
  const bcc =
    getEmailHeader(parameters.bcc).trim()
    || getHeaderValue(existingHeaders, 'Bcc')
  const subject = String(parameters.subject || '').trim() || getHeaderValue(existingHeaders, 'Subject') || 'Kova draft'
  const body = String(parameters.body || '').trim() || extractPayloadText(existingData.message?.payload)

  const mime = buildPlainTextMimeMessage({
    to,
    cc,
    bcc,
    subject,
    body,
  })

  const response = await googleFetch(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${draftId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: draftId,
      message: {
        raw: toBase64Url(mime),
      },
    }),
  }, { timeoutMs: GOOGLE_WRITE_TIMEOUT_MS })

  if (!response.ok) {
    throw new Error(`Gmail draft update failed: ${response.status}`)
  }

  const data = await response.json() as {
    id?: string
    message?: { id?: string }
  }

  return {
    details: 'Draft updated in Gmail.',
    output: {
      provider: 'gmail',
      draftId: data.id || draftId,
      messageId: data.message?.id || null,
      recipients: to,
      cc: cc || null,
      bcc: bcc || null,
      subject,
    },
  }
}

export async function sendGmailDraft(accessToken: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  const draftId = String(parameters.draftId || '')
  if (!draftId) {
    throw new Error('draftId is required to send a Gmail draft.')
  }

  const response = await googleFetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: draftId,
    }),
  }, { timeoutMs: GOOGLE_WRITE_TIMEOUT_MS })

  if (!response.ok) {
    throw new Error(`Gmail draft send failed: ${response.status}`)
  }

  const data = await response.json() as { id?: string; threadId?: string; labelIds?: string[] }
  return {
    details: 'Draft sent via Gmail.',
    output: {
      provider: 'gmail',
      draftId,
      messageId: data.id || null,
      threadId: data.threadId || null,
      labelIds: Array.isArray(data.labelIds) ? data.labelIds : [],
    },
  }
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

export async function replyToGmailMessage(accessToken: string, parameters: Record<string, unknown>): Promise<IntegrationExecutionResult> {
  const threadId = String(parameters.threadId || '')
  const to = getEmailHeader(parameters.to) || String(parameters.to || '')
  const cc = getEmailHeader(parameters.cc)
  const bcc = getEmailHeader(parameters.bcc)
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

  const mime = buildPlainTextMimeMessage({
    to,
    cc,
    bcc,
    subject,
    body,
    headers: [
      ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`] : []),
      ...(references ? [`References: ${references}`] : []),
    ],
  })

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
      cc: cc || null,
      bcc: bcc || null,
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
